from __future__ import annotations

from psycopg.types.json import Json

from .db import fetch_all, fetch_one, get_connection


SPARK_PREVIEW_EXTENSIONS = frozenset({"ply", "spz", "splat", "ksplat", "sog", "zip", "rad"})
ANNOTATION_MANIFEST_EXTENSIONS = frozenset({"json"})


def _file_extension(filename: str) -> str:
    if "." not in filename.strip("."):
        return ""
    return filename.rsplit(".", 1)[1].strip().lower()


def _fetch_revision_file(cursor, project_id: str, document_id: str, revision_id: str, file_id: str) -> dict | None:
    cursor.execute(
        """
        SELECT
            df.id,
            df.revision_id,
            df.original_filename,
            df.mime_type,
            df.status
        FROM document_file df
        JOIN document_revision dr ON dr.id = df.revision_id
        JOIN document d ON d.id = dr.document_id
        WHERE d.project_id = %s
          AND d.id = %s
          AND dr.id = %s
          AND df.id = %s
          AND df.status <> 'deleted'
        """,
        (project_id, document_id, revision_id, file_id),
    )
    return cursor.fetchone()


def _ensure_revision_exists(cursor, project_id: str, document_id: str, revision_id: str) -> None:
    cursor.execute(
        """
        SELECT dr.id
        FROM document_revision dr
        JOIN document d ON d.id = dr.document_id
        WHERE d.project_id = %s
          AND d.id = %s
          AND dr.id = %s
        """,
        (project_id, document_id, revision_id),
    )
    if cursor.fetchone() is None:
        raise ValueError("Revision not found")


def _require_ready_file(
    cursor,
    project_id: str,
    document_id: str,
    revision_id: str,
    file_id: str,
    *,
    label: str,
) -> dict:
    file_row = _fetch_revision_file(cursor, project_id, document_id, revision_id, file_id)
    if file_row is None:
        raise ValueError(f"{label} file not found in this revision")
    if file_row["status"] != "ready":
        raise ValueError(f"{label} file is not ready")
    return file_row


def _fetch_visualization(cursor, project_id: str, visualization_id: str) -> dict | None:
    cursor.execute(
        """
        SELECT
            dv.id,
            d.project_id,
            d.id AS document_id,
            dv.revision_id,
            dv.source_file_id,
            source_file.original_filename AS source_file_name,
            dv.preview_file_id,
            preview_file.original_filename AS preview_file_name,
            dv.annotation_manifest_file_id,
            manifest_file.original_filename AS annotation_manifest_file_name,
            dv.metadata,
            dv.created_at,
            dv.updated_at
        FROM document_visualization dv
        JOIN document_revision dr ON dr.id = dv.revision_id
        JOIN document d ON d.id = dr.document_id
        JOIN document_file source_file ON source_file.id = dv.source_file_id
        JOIN document_file preview_file ON preview_file.id = dv.preview_file_id
        LEFT JOIN document_file manifest_file ON manifest_file.id = dv.annotation_manifest_file_id
        WHERE d.project_id = %s
          AND dv.id = %s
        """,
        (project_id, visualization_id),
    )
    return cursor.fetchone()


def get_document_visualization(
    project_id: str,
    document_id: str,
    revision_id: str,
    visualization_id: str,
) -> dict | None:
    return fetch_one(
        """
        SELECT
            dv.id,
            d.project_id,
            d.id AS document_id,
            dv.revision_id,
            dv.source_file_id,
            source_file.original_filename AS source_file_name,
            source_file.object_key AS source_object_key,
            source_file.mime_type AS source_mime_type,
            source_file.preview_mode AS source_preview_mode,
            dv.preview_file_id,
            preview_file.original_filename AS preview_file_name,
            preview_file.object_key AS preview_object_key,
            preview_file.mime_type AS preview_mime_type,
            preview_file.preview_mode AS preview_preview_mode,
            dv.annotation_manifest_file_id,
            manifest_file.original_filename AS annotation_manifest_file_name,
            manifest_file.object_key AS annotation_manifest_object_key,
            manifest_file.mime_type AS annotation_manifest_mime_type,
            manifest_file.preview_mode AS annotation_manifest_preview_mode,
            dv.metadata,
            dv.created_at,
            dv.updated_at
        FROM document_visualization dv
        JOIN document_revision dr ON dr.id = dv.revision_id
        JOIN document d ON d.id = dr.document_id
        JOIN document_file source_file ON source_file.id = dv.source_file_id
        JOIN document_file preview_file ON preview_file.id = dv.preview_file_id
        LEFT JOIN document_file manifest_file ON manifest_file.id = dv.annotation_manifest_file_id
        WHERE d.project_id = %s
          AND d.id = %s
          AND dv.revision_id = %s
          AND dv.id = %s
        """,
        (project_id, document_id, revision_id, visualization_id),
    )


def get_document_visualization_by_preview(
    project_id: str,
    document_id: str,
    revision_id: str,
    preview_file_id: str,
) -> dict | None:
    return fetch_one(
        """
        SELECT
            dv.id,
            d.project_id,
            d.id AS document_id,
            dv.revision_id,
            dv.source_file_id,
            source_file.original_filename AS source_file_name,
            dv.preview_file_id,
            preview_file.original_filename AS preview_file_name,
            dv.annotation_manifest_file_id,
            manifest_file.original_filename AS annotation_manifest_file_name,
            dv.metadata,
            dv.created_at,
            dv.updated_at
        FROM document_visualization dv
        JOIN document_revision dr ON dr.id = dv.revision_id
        JOIN document d ON d.id = dr.document_id
        JOIN document_file source_file ON source_file.id = dv.source_file_id
        JOIN document_file preview_file ON preview_file.id = dv.preview_file_id
        LEFT JOIN document_file manifest_file ON manifest_file.id = dv.annotation_manifest_file_id
        WHERE d.project_id = %s
          AND d.id = %s
          AND dv.revision_id = %s
          AND dv.preview_file_id = %s
        """,
        (project_id, document_id, revision_id, preview_file_id),
    )


def replace_document_visualization_assets(project_id: str, visualization_id: str, assets: list[dict]) -> list[dict]:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            visualization = _fetch_visualization(cursor, project_id, visualization_id)
            if visualization is None:
                raise ValueError("Visualization not found")

            cursor.execute(
                "DELETE FROM document_visualization_asset WHERE visualization_id = %s",
                (visualization_id,),
            )
            rows: list[dict] = []
            for asset in assets:
                filename = str(asset.get("filename") or "").strip()
                asset_role = str(asset.get("asset_role") or "").strip()
                if not filename or "/" in filename or "\\" in filename:
                    raise ValueError("Spark asset filename is invalid")
                cursor.execute(
                    """
                    INSERT INTO document_visualization_asset (
                        visualization_id,
                        asset_role,
                        filename,
                        storage_provider,
                        bucket,
                        object_key,
                        mime_type,
                        size_bytes,
                        checksum_sha256
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING
                        id,
                        visualization_id,
                        asset_role,
                        filename,
                        storage_provider,
                        bucket,
                        object_key,
                        mime_type,
                        size_bytes,
                        checksum_sha256,
                        created_at,
                        updated_at
                    """,
                    (
                        visualization_id,
                        asset_role,
                        filename,
                        asset.get("storage_provider", "s3"),
                        asset["bucket"],
                        asset["object_key"],
                        asset["mime_type"],
                        asset["size_bytes"],
                        asset.get("checksum_sha256"),
                    ),
                )
                rows.append(cursor.fetchone())
        connection.commit()
    return rows


def list_document_visualization_assets(project_id: str, visualization_id: str) -> list[dict]:
    return fetch_all(
        """
        SELECT
            dva.id,
            dva.visualization_id,
            dva.asset_role,
            dva.filename,
            dva.storage_provider,
            dva.bucket,
            dva.object_key,
            dva.mime_type,
            dva.size_bytes,
            dva.checksum_sha256,
            dva.created_at,
            dva.updated_at
        FROM document_visualization_asset dva
        JOIN document_visualization dv ON dv.id = dva.visualization_id
        JOIN document_revision dr ON dr.id = dv.revision_id
        JOIN document d ON d.id = dr.document_id
        WHERE d.project_id = %s
          AND dva.visualization_id = %s
        ORDER BY
            CASE dva.asset_role WHEN 'header' THEN 0 WHEN 'chunk' THEN 1 ELSE 2 END,
            dva.filename
        """,
        (project_id, visualization_id),
    )


def get_document_visualization_asset(
    project_id: str,
    document_id: str,
    revision_id: str,
    visualization_id: str,
    filename: str,
) -> dict | None:
    return fetch_one(
        """
        SELECT
            dva.id,
            dva.visualization_id,
            dva.asset_role,
            dva.filename,
            dva.storage_provider,
            dva.bucket,
            dva.object_key,
            dva.mime_type,
            dva.size_bytes,
            dva.checksum_sha256,
            dva.created_at,
            dva.updated_at
        FROM document_visualization_asset dva
        JOIN document_visualization dv ON dv.id = dva.visualization_id
        JOIN document_revision dr ON dr.id = dv.revision_id
        JOIN document d ON d.id = dr.document_id
        WHERE d.project_id = %s
          AND d.id = %s
          AND dv.revision_id = %s
          AND dv.id = %s
          AND dva.filename = %s
        """,
        (project_id, document_id, revision_id, visualization_id, filename),
    )


def list_document_visualizations(project_id: str, document_id: str, revision_id: str) -> list[dict]:
    return fetch_all(
        """
        SELECT
            dv.id,
            d.project_id,
            d.id AS document_id,
            dv.revision_id,
            dv.source_file_id,
            source_file.original_filename AS source_file_name,
            dv.preview_file_id,
            preview_file.original_filename AS preview_file_name,
            dv.annotation_manifest_file_id,
            manifest_file.original_filename AS annotation_manifest_file_name,
            dv.metadata,
            dv.created_at,
            dv.updated_at
        FROM document_visualization dv
        JOIN document_revision dr ON dr.id = dv.revision_id
        JOIN document d ON d.id = dr.document_id
        JOIN document_file source_file ON source_file.id = dv.source_file_id
        JOIN document_file preview_file ON preview_file.id = dv.preview_file_id
        LEFT JOIN document_file manifest_file ON manifest_file.id = dv.annotation_manifest_file_id
        WHERE d.project_id = %s
          AND d.id = %s
          AND dv.revision_id = %s
        ORDER BY dv.created_at DESC, dv.id
        """,
        (project_id, document_id, revision_id),
    )


def create_document_visualization(project_id: str, document_id: str, revision_id: str, payload: dict) -> dict:
    source_file_id = str(payload.get("source_file_id") or "").strip()
    preview_file_id = str(payload.get("preview_file_id") or "").strip()
    annotation_manifest_file_id = str(payload.get("annotation_manifest_file_id") or "").strip() or None
    if not source_file_id or not preview_file_id:
        raise ValueError("source_file_id and preview_file_id are required")
    if annotation_manifest_file_id in {source_file_id, preview_file_id}:
        raise ValueError("Annotation manifest file must be separate from source and preview files")

    with get_connection() as connection:
        with connection.cursor() as cursor:
            _ensure_revision_exists(cursor, project_id, document_id, revision_id)
            _require_ready_file(
                cursor,
                project_id,
                document_id,
                revision_id,
                source_file_id,
                label="Source",
            )
            preview_file = _require_ready_file(
                cursor,
                project_id,
                document_id,
                revision_id,
                preview_file_id,
                label="Preview",
            )
            if _file_extension(preview_file["original_filename"]) not in SPARK_PREVIEW_EXTENSIONS:
                raise ValueError("Preview file must be a Spark-readable splat asset")

            if annotation_manifest_file_id:
                manifest_file = _require_ready_file(
                    cursor,
                    project_id,
                    document_id,
                    revision_id,
                    annotation_manifest_file_id,
                    label="Annotation manifest",
                )
                if _file_extension(manifest_file["original_filename"]) not in ANNOTATION_MANIFEST_EXTENSIONS:
                    raise ValueError("Annotation manifest must be a JSON file")

            cursor.execute(
                """
                INSERT INTO document_visualization (
                    revision_id,
                    source_file_id,
                    preview_file_id,
                    annotation_manifest_file_id,
                    metadata
                )
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    revision_id,
                    source_file_id,
                    preview_file_id,
                    annotation_manifest_file_id,
                    Json(payload.get("metadata", {})),
                ),
            )
            visualization_id = str(cursor.fetchone()["id"])
        connection.commit()

    with get_connection() as connection:
        with connection.cursor() as cursor:
            result = _fetch_visualization(cursor, project_id, visualization_id)
            if result is None:
                raise ValueError("Visualization not found")
            return result
