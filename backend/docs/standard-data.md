# Standard Data Module

The backend currently keeps only the Standard module data model:

- `standard` stores the standard family, code, version, icon, status, and metadata.
- `class` stores class definitions under a standard.
- `attribute_definition` stores attributes owned by each class, including `sort_order` for persisted display order and `status` for soft delete.
- `standard_import_job` stores standard Excel import drafts, validation summaries, and same-code conflict choices.
- `standard_import_row` stores row-level standard import values, normalized values, issues, and preview status.

The removed stage-0 domains are project, document, object, evidence, review, rule, and integration tracking. Add them back only when a product requirement needs them.

## Runtime

Use the repository root `docker-compose.yml` to start a standalone PostgreSQL 16 database on host port `55432`.

The FastAPI service reads `DATABASE_URL`; when it is not set, it connects to:

```text
postgresql://postgres:postgres@localhost:55432/smart_design
```

## API Surface

- `GET /health`
- `GET /api/standards`
- `POST /api/standards`
- `GET /api/standards/import-template`
- `POST /api/standards/imports/validate`
- `GET /api/standards/imports/{job_id}`
- `PATCH /api/standards/imports/{job_id}`
- `POST /api/standards/imports/{job_id}/commit`
- `GET /api/standards/{standard_id}`
- `GET /api/standards/{standard_id}/export`
- `PATCH /api/standards/{standard_id}/icon`
- `POST /api/standards/{standard_id}/classes`
- `PATCH /api/classes/{class_id}`
- `POST /api/classes/{class_id}/attributes`
- `PATCH /api/classes/{class_id}/attributes/order`
- `PATCH /api/attributes/{attribute_id}`
- `DELETE /api/attributes/{attribute_id}`
