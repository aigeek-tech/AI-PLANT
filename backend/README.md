# Smart Design Backend

This directory contains the FastAPI service plus the database baseline assets for Smart Design.

## Contents

- `db/migrations/0001_full_schema.sql`
  PostgreSQL baseline rebuilt from the current database structure. It includes the core schema plus required system catalog seed data for permissions, roles, role permissions, and relation types.
- `db/migrations/0002_standard_import_jobs.sql`
  Incremental schema for standard library Excel import draft jobs and row-level validation results.
- `db/migrations/0003_equipment_implementation.sql`
  Incremental schema for equipment classes, tag-to-equipment-class mappings, project equipment assets, and tag installation history.
- `db/migrations/0004_agent_jobs.sql`
  Incremental schema for project-scoped AI agent jobs, replayable event logs, and draft artifacts.
- `db/migrations/0005_document_visualizations.sql`
  Incremental schema for revision-scoped Spark 3D visualization links.
- `db/migrations/0006_document_conversion_jobs.sql`
  Incremental schema for asynchronous document model conversion jobs.
- `db/migrations/0007_agent_harness.sql`
  Incremental schema for global AI Harness sessions, messages, executable runs, replayable run events, and run-scoped artifacts.
- `db/migrations/0008_discipline_document_requirements.sql`
  Incremental schema for discipline/document-type and class/document requirement rules.
- `db/migrations/0009_equipment_attribute_values.sql`
  Incremental schema for project equipment attribute value storage.
- `db/migrations/0010_spark_visualization_assets.sql`
  Incremental schema for Spark visualization header/chunk assets served through the authenticated backend route.
- `db/migrations/0013_plugin_platform.sql`
  Trusted module plugin registry, installation state, manifest capabilities, migration journal, audit log, and `system.plugin.manage`.
- `db/migrations/0016_strict_equipment_attribute_values.sql`
  Idempotent data normalization that removes tag-only or otherwise standard-outside keys from equipment `attribute_values`.
- `db/migrations/0019_visualization_semantic_objects.sql`
  Incremental schema for semantic objects extracted from visualization assets.
- `db/seeds/0001_stage0_seed.sql`
  Sample standard reference data for local initialization.
- `db/seeds/0002_local_dev_sample_data.sql`
  Bundled local development sample data: CFIHOS, the KBT-CPF sample project, and `pump_room` visualization metadata.
- `db/queries/0001_stage0_queries.sql`
  Example queries for manual inspection and verification.
- `app/`
  FastAPI service exposing the APIs used by the frontend.
- `tools/check_tag_equipment_attribute_issues.py`
  Project data integrity audit for tag/equipment standard attributes and equipment implementation history. Use `--export-dir` to generate full CSV/JSON evidence.
- `tools/check_tag_attribute_class_drift.py`
  Focused read-only check for tags whose attribute keys or values do not match the project standard's common tag attributes plus the tag's own class attributes.
- `tools/check_tags_without_equipment.py`
  Focused read-only check for tags that do not have a current active equipment implementation.
- `tools/check_tag_equipment_attribute_standard_drift.py`
  Focused read-only check for each tag's current equipment class and equipment attributes against the bound standard.
- `tools/apply_attribute_value_remediation.py`
  Dry-run-first importer for manually completed audit CSV rows. Add a `new_value` column, validate values, then use `--apply` to persist.
- `docs/standard-data.md`
  Data model notes for the standard domain.

## Runtime

- PostgreSQL runs through the repository root `docker-compose.yml`.
- The PostgreSQL host port defaults to `55432`; override with `POSTGRES_HOST_PORT`.
- The FastAPI service runs separately on host port `3001` and connects through `DATABASE_URL`.
- Runtime configuration is loaded through `app.settings.config`. `SMART_DESIGN_ENV=development` keeps local defaults such as `postgres/postgres` and `minioadmin/minioadmin`; `SMART_DESIGN_ENV=production` requires explicit `DATABASE_URL`, `SMART_DESIGN_ALLOWED_ORIGINS`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, and `S3_SECRET_KEY` and fails fast when any are missing.
- Cookie-based auth expects trusted browser origins in `SMART_DESIGN_ALLOWED_ORIGINS`; default local origins are `http://localhost:5173` and `http://127.0.0.1:5173`.
- To bootstrap the first admin without the UI, set `SMART_DESIGN_BOOTSTRAP_ADMIN_USERNAME` and `SMART_DESIGN_BOOTSTRAP_ADMIN_PASSWORD` before backend startup. Do not commit real credentials.
- Document preview uses S3 presigned URLs. Set `KKFILEVIEW_ENABLED=true` and `KKFILEVIEW_BASE_URL=http://127.0.0.1:8012` to route preview pages through kkFileView. For local browser uploads and downloads, set `S3_PREVIEW_ENDPOINT=http://127.0.0.1:9000` because `host.docker.internal` is only resolvable from containers, not from the browser.
- `docker-compose.yml` defaults to `ymlisoft/kkfileview:4.4.0-12` for newer kkFileView/CAD support on `linux/amd64`. On ARM machines, override `KKFILEVIEW_IMAGE` with an ARM build such as `swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/ymlisoft/kkfileview:latest-linuxarm64`.
- Local kkFileView is tuned with `KK_OFFICE_PREVIEW_TYPE=pdf` for Office files and `KK_CAD_PREVIEW_TYPE=pdf`, `JAVA_OPTS=-Xms512m -Xmx4g`, `KK_CAD_THREAD=1`, `KK_CAD_TIMEOUT=180` for CAD. The default CAD SVG conversion can expand small DWG files into very large SVG output and stall the preview request.
- 3D model conversion is controlled by `DOCUMENT_CONVERSION_ENABLED`, `DOCUMENT_CONVERSION_MAX_BYTES`, `DOCUMENT_CONVERSION_WORKDIR`, `RVM_CONVERTER_COMMAND`, and `SPARK_BUILD_LOD_COMMAND`. RVM uploads create queued conversion jobs; the `document-converter` Docker service consumes them and writes Spark chunked `.rad + .radc` assets when both external commands are configured. Spark/RVM upload size is controlled separately by `SMART_DESIGN_3D_MODEL_UPLOAD_MAX_BYTES` and defaults to 2 GiB, while ordinary documents still use `SMART_DESIGN_DOCUMENT_UPLOAD_MAX_BYTES` and default to 100 MiB. Before saving the generated assets, the worker validates that the source is a parseable AVEVA PDMS binary RVM with geometry, the intermediate PLY is a Spark-compatible Gaussian splat PLY, and the final file has a valid Spark `RAD0`/`RADC` structure. Spark-native `.rad/.radc/.ply/.spz/.splat/.ksplat/.sog/.zip` files are kept on the Spark path; single embedded `.rad` files are split server-side into header/chunk visualization assets, and `.zip` files containing one `.rad` plus matching `.radc` chunks are unpacked and registered server-side. `.rad` files that reference missing `.radc` chunks are not opened as ordinary previews. Unsupported engineering 3D formats such as `.vue`, IFC, GLB/GLTF, NWD, RVT, OBJ, FBX, and STL are rejected during upload initialization until a Spark conversion path exists.
- Plugin uploads are controlled by `SMART_DESIGN_PLUGIN_STORAGE_DIR`, `SMART_DESIGN_PLUGIN_HMAC_SECRET`, and `SMART_DESIGN_PLUGIN_MAX_PACKAGE_BYTES`. The signing secret has no default; uploading or installing signed plugin ZIP packages fails until it is set. Plugins are treated as trusted module packages: the host owns manifest validation, permission registration, default role grants, route mounting, and lifecycle state; each plugin owns only its implementation, schema, migrations, and declared extension contributions.
- The local `document-converter` image builds `cdyk/rvmparser` and the Spark `build-lod` Rust CLI from `https://github.com/sparkjsdev/spark.git`. It defaults to `DOCUMENT_CONVERTER_BASE_IMAGE=swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/python:3.12-slim`, `DEBIAN_APT_MIRROR=https://mirrors.ustc.edu.cn`, USTC Rust/Cargo mirrors, and `NPM_REGISTRY=https://registry.npmmirror.com` to avoid public registry pull failures; override them with official sources or another trusted mirror when needed. The container compiles Spark `build-lod` with `--no-default-features` for server-side CPU conversion and exposes it through `SPARK_BUILD_LOD_BIN`. Its default commands are `python /workspace/backend/tools/rvm_to_spark_ply.py --input {input} --output {output} --workdir {workdir}` and `python /workspace/backend/tools/spark_build_lod.py --input {input} --output {output} --quality --rad-chunked`. Override `RVMPARSER_REPOSITORY_REF`, `SPARK_REPOSITORY_URL`, or `SPARK_REPOSITORY_REF` if you need to pin a known upstream commit or internal mirror. Spark `.rad` headers and `.radc` chunks are registered in `document_visualization_asset` and served through the authenticated visualization route instead of exposing private object-storage URLs directly.
- Bundled object-storage samples live under `sample-data/minio`. `docker-compose.yml` and the offline compose file mirror those files into the configured MinIO bucket during `minio-init`, so a fresh environment includes the `pump_room` source bundle plus Spark header/chunk assets.
- Agent jobs and global AI Harness runs use `CLAW_EXECUTABLE_PATH` to locate the Claw Code CLI. If it is unset, runs fail with an explicit event while the API service still starts. Runtime limits default to `AGENT_MAX_GLOBAL_CONCURRENCY=4`, `AGENT_MAX_USER_CONCURRENCY=1`, and `AGENT_JOB_TIMEOUT_SECONDS=900`.

## Database Bootstrap

For a fresh database, apply in this order:

1. `db/migrations/0001_full_schema.sql`
2. `db/migrations/0002_standard_import_jobs.sql`
3. `db/migrations/0003_equipment_implementation.sql`
4. `db/migrations/0004_agent_jobs.sql`
5. `db/migrations/0005_document_visualizations.sql`
6. `db/migrations/0006_document_conversion_jobs.sql`
7. `db/migrations/0007_agent_harness.sql`
8. `db/migrations/0008_discipline_document_requirements.sql`
9. `db/migrations/0009_equipment_attribute_values.sql`
10. `db/migrations/0010_spark_visualization_assets.sql`
11. `db/migrations/0013_plugin_platform.sql`
12. `db/migrations/0016_strict_equipment_attribute_values.sql`
13. `db/migrations/0019_visualization_semantic_objects.sql`
14. `db/seeds/0001_stage0_seed.sql`
15. `db/seeds/0002_local_dev_sample_data.sql`
16. Review and adapt `db/queries/0001_stage0_queries.sql`

The repository no longer depends on the historical incremental migration chain. The baseline plus current incremental files are the authoritative schema path for new environments.
Future schema changes must be added as new ordered incrementals starting at the next `NNNN_*.sql` number; do not rewrite `0001_full_schema.sql` unless intentionally rebuilding an unpublished baseline.

## Authorization Notes

- `standard.read` at system scope grants access to the whole standard library.
- `standard.read` at standard scope grants access only to that standard.
- `standard.read` from a project role grants access only to standards bound by authorized projects through `project.reference_attributes.standard_id`.
- Frontend permission hiding is only a UX aid; backend dependencies enforce these RBAC checks.

## Notes

- The baseline intentionally reflects the current runtime table set, including renamed `document*` tables.
- Runtime configuration in `settings`, especially AI endpoint values, is not seeded from a live environment into the repository baseline.
- If you intentionally rebuild the baseline again in the future, regenerate it from a real database instance and re-verify docker/bootstrap behavior.

## License

The backend is distributed under the repository root `LICENSE`. Commercial use is permitted, but copyright notices, the `NOTICE` file, and the Aigeek / 艾极科技 logo and attribution must be retained. Third-party dependencies remain under their own licenses.

## Validation

The baseline should be validated by:

1. Creating an empty database
2. Applying `db/migrations/0001_full_schema.sql`
3. Applying `db/migrations/0002_standard_import_jobs.sql`
4. Applying `db/migrations/0003_equipment_implementation.sql`
5. Applying `db/migrations/0004_agent_jobs.sql`
6. Applying `db/migrations/0005_document_visualizations.sql`
7. Applying `db/migrations/0006_document_conversion_jobs.sql`
8. Applying `db/migrations/0007_agent_harness.sql`
9. Applying `db/migrations/0008_discipline_document_requirements.sql`
10. Applying `db/migrations/0009_equipment_attribute_values.sql`
11. Applying `db/migrations/0010_spark_visualization_assets.sql`
12. Applying `db/migrations/0013_plugin_platform.sql`
13. Applying `db/migrations/0016_strict_equipment_attribute_values.sql`
14. Applying `db/migrations/0019_visualization_semantic_objects.sql`
15. Applying `db/seeds/0001_stage0_seed.sql`
16. Applying `db/seeds/0002_local_dev_sample_data.sql`
17. Verifying the expected core tables, indexes, triggers, and seeded RBAC catalogs exist
