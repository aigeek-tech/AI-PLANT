# Smart Design Offline Docker Bundle

This directory can run either from the offline image tar or from the Aliyun ACR images.

The Aliyun override file uses images under:

`crpi-xxa0zq9b76nhf9vd.cn-hangzhou.personal.cr.aliyuncs.com/aigeek`

## Run From Aliyun ACR

```sh
chmod +x start-aliyun.sh
docker login crpi-xxa0zq9b76nhf9vd.cn-hangzhou.personal.cr.aliyuncs.com
./start-aliyun.sh
```

## Publish To Aliyun ACR And Update Server

From the repository root on Windows:

```powershell
Copy-Item deploy\offline\deploy.local.example.json deploy\offline\deploy.local.json
# Edit deploy\offline\deploy.local.json and set sshPassword.
.\deploy\offline\publish-aliyun.ps1
```

The publish script generates a tag, runs verification, builds backend/frontend/document-converter images, pushes them to Aliyun ACR, syncs deployment files to the remote server, applies known pending SQL migrations, restarts services, and checks health.

`deploy.local.json` is intentionally ignored by Git because it contains server access details.

Edit `.env` and `config/backend.env` before production use. They are initialized with placeholder defaults.
If the PostgreSQL password contains reserved URL characters such as `@`, `:`, `/`, `?`, or `#`, set `DATABASE_URL` explicitly in `.env` with URL-encoded credentials. Example:

```sh
DATABASE_URL=postgresql://postgres:P%40ssw0rd@postgres:5432/smart_design
```

The default startup path uses the application content baked into the images. This is the safer server mode.
Use `docker-compose.mounts.yml` only for temporary debugging when you explicitly want host files to override image contents.
The backend, converter tools, and frontend build output are normally packaged inside the images and should not be copied into `mounts/`.

When the server already has a MinIO on port `9000`, set these in `.env` before running:

```sh
USE_EXTERNAL_MINIO=true
S3_ENDPOINT=http://host.docker.internal:9000
MINIO_INIT_ENDPOINT=http://host.docker.internal:9000
S3_PREVIEW_ENDPOINT=http://host.docker.internal:9000
```

`start-aliyun.sh` will then skip the bundled `smart-design-minio` service and use the existing MinIO instead. The `minio-init` step will still create the bucket if it does not already exist.

## Run From Offline Tar

## Files to copy to the server

- `images/smart-design-offline-images.tar`
- `docker-compose.offline.yml`
- `.env.example`
- `config/`
- `mounts/postgres/initdb/`
- `docker-compose.mounts.yml`
- `import-images.sh`
- `start.sh`
- `start-aliyun.sh`

## First run on the server

```sh
chmod +x import-images.sh start.sh
./import-images.sh
```

Edit `.env` and `config/backend.env` before production use. They are initialized with placeholder defaults. At minimum replace the default PostgreSQL and MinIO passwords and set public endpoint values such as `S3_PREVIEW_ENDPOINT`, `SMART_DESIGN_ALLOWED_ORIGINS`, and `KKFILEVIEW_BASE_URL`.

Then start:

```sh
./start.sh
```

The default ports are:

- Frontend: `5173`
- Backend API: `3001`
- PostgreSQL: `55432`
- MinIO API: `9000`
- MinIO Console: `9001`
- kkFileView: `8012`

## Mounted replaceable parts

- `config/backend.env`: backend and document-converter runtime settings.
- `config/frontend-nginx.conf`: frontend nginx routing and upload size settings.
- `mounts/postgres/initdb`: SQL files used only when `data/postgres` is empty on first database initialization.
  This directory must contain real `.sql` files before the first PostgreSQL startup. The compose file mounts the whole directory into `/docker-entrypoint-initdb.d`.
- `data/postgres`: PostgreSQL persistent data.
- `data/minio`: MinIO persistent object data.
- `data/document-conversion`: document conversion working directory.

If you change SQL files after the database has already initialized, PostgreSQL will not replay them automatically. Apply migrations manually or recreate `data/postgres` only when data loss is acceptable.
