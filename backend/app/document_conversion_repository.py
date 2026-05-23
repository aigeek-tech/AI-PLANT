from __future__ import annotations

from psycopg.types.json import Json

from .db import execute_one, fetch_all, fetch_one


def list_document_conversion_jobs(project_id: str, document_id: str, revision_id: str) -> list[dict]:
    return fetch_all(
        """
        SELECT
            dcj.id,
            dcj.project_id,
            dcj.document_id,
            dcj.revision_id,
            dcj.source_file_id,
            source_file.original_filename AS source_file_name,
            dcj.output_file_id,
            output_file.original_filename AS output_file_name,
            dcj.status,
            dcj.input_format,
            dcj.output_format,
            dcj.error,
            dcj.metadata,
            dcj.attempts,
            dcj.created_at,
            dcj.started_at,
            dcj.finished_at,
            dcj.updated_at
        FROM document_conversion_job dcj
        JOIN document_file source_file ON source_file.id = dcj.source_file_id
        LEFT JOIN document_file output_file ON output_file.id = dcj.output_file_id
        WHERE dcj.project_id = %s
          AND dcj.document_id = %s
          AND dcj.revision_id = %s
        ORDER BY dcj.created_at DESC, dcj.id
        """,
        (project_id, document_id, revision_id),
    )


def get_active_document_conversion_job_for_source(source_file_id: str) -> dict | None:
    return fetch_one(
        """
        SELECT *
        FROM document_conversion_job
        WHERE source_file_id::text = %s
          AND status IN ('queued', 'running')
        ORDER BY created_at DESC
        LIMIT 1
        """,
        (source_file_id,),
    )


def create_document_conversion_job(
    project_id: str,
    document_id: str,
    revision_id: str,
    source_file_id: str,
    *,
    input_format: str,
    output_format: str = "rad",
    metadata: dict | None = None,
) -> dict:
    row = execute_one(
        """
        INSERT INTO document_conversion_job (
            project_id,
            document_id,
            revision_id,
            source_file_id,
            input_format,
            output_format,
            metadata
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        RETURNING *
        """,
        (
            project_id,
            document_id,
            revision_id,
            source_file_id,
            input_format,
            output_format,
            Json(metadata or {}),
        ),
    )
    if row is None:
        raise RuntimeError("Failed to create document conversion job")
    return row


def ensure_document_conversion_job(
    project_id: str,
    document_id: str,
    revision_id: str,
    source_file_id: str,
    *,
    input_format: str,
    output_format: str = "rad",
    metadata: dict | None = None,
) -> dict:
    active = get_active_document_conversion_job_for_source(source_file_id)
    if active is not None:
        return active
    return create_document_conversion_job(
        project_id,
        document_id,
        revision_id,
        source_file_id,
        input_format=input_format,
        output_format=output_format,
        metadata=metadata,
    )


def retry_document_conversion_job(project_id: str, document_id: str, revision_id: str, job_id: str) -> dict | None:
    return execute_one(
        """
        UPDATE document_conversion_job
        SET
            status = 'queued',
            error = NULL,
            started_at = NULL,
            finished_at = NULL
        WHERE project_id::text = %s
          AND document_id::text = %s
          AND revision_id::text = %s
          AND id::text = %s
          AND status IN ('failed', 'cancelled')
        RETURNING *
        """,
        (project_id, document_id, revision_id, job_id),
    )


def claim_next_document_conversion_job() -> dict | None:
    return execute_one(
        """
        UPDATE document_conversion_job
        SET
            status = 'running',
            attempts = attempts + 1,
            started_at = COALESCE(started_at, now()),
            finished_at = NULL,
            error = NULL
        WHERE id = (
            SELECT id
            FROM document_conversion_job
            WHERE status = 'queued'
            ORDER BY created_at ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
        )
        RETURNING *
        """,
    )


def mark_document_conversion_job_completed(job_id: str, output_file_id: str, metadata: dict | None = None) -> dict | None:
    return execute_one(
        """
        UPDATE document_conversion_job
        SET
            status = 'completed',
            output_file_id = %s,
            error = NULL,
            metadata = %s,
            finished_at = now()
        WHERE id::text = %s
        RETURNING *
        """,
        (output_file_id, Json(metadata or {}), job_id),
    )


def mark_document_conversion_job_failed(job_id: str, error: str, metadata: dict | None = None) -> dict | None:
    return execute_one(
        """
        UPDATE document_conversion_job
        SET
            status = 'failed',
            error = %s,
            metadata = metadata || %s,
            finished_at = now()
        WHERE id::text = %s
        RETURNING *
        """,
        (error, Json(metadata or {}), job_id),
    )
