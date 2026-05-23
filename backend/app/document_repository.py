from __future__ import annotations

from collections import defaultdict
from typing import Iterable

from psycopg.types.json import Json

from .db import execute_one, fetch_all, fetch_one, get_connection
from .relation_repository import (
    DOCUMENT_LINKS_PBS_CODE,
    DOCUMENT_LINKS_TAG_CODE,
    get_document_linked_pbs_nodes,
    get_document_linked_tags,
    replace_document_relations,
)


def _normalize_id_list(values: Iterable[str] | None) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for value in values or []:
        text = str(value).strip()
        if text and text not in seen:
            normalized.append(text)
            seen.add(text)
    return normalized


def list_document_types(standard_id: str | None = None) -> list[dict]:
    if standard_id:
        return fetch_all(
            """
            SELECT
                c.id,
                c.standard_id,
                c.code,
                c.name,
                c.parent_id,
                c.level_no,
                c.description,
                c.status,
                COALESCE(c.metadata -> 'document' -> 'allowed_extensions', '[]'::jsonb) AS allowed_extensions,
                c.metadata,
                COUNT(ad.id)::int AS attribute_count,
                c.created_at,
                c.updated_at
            FROM class c
            LEFT JOIN attribute_definition ad
                ON ad.class_id = c.id
               AND ad.status <> 'archived'
            WHERE c.standard_id = %s
              AND c.applies_to IN ('document', 'both')
            GROUP BY c.id
            ORDER BY c.level_no, c.code
            """,
            (standard_id,),
        )

    return fetch_all(
        """
        SELECT
            c.id,
            c.standard_id,
            c.code,
            c.name,
            c.parent_id,
            c.level_no,
            c.description,
            c.status,
            COALESCE(c.metadata -> 'document' -> 'allowed_extensions', '[]'::jsonb) AS allowed_extensions,
            c.metadata,
            COUNT(ad.id)::int AS attribute_count,
            c.created_at,
            c.updated_at
        FROM class c
        LEFT JOIN attribute_definition ad
            ON ad.class_id = c.id
           AND ad.status <> 'archived'
        WHERE c.applies_to IN ('document', 'both')
        GROUP BY c.id
        ORDER BY c.standard_id NULLS LAST, c.level_no, c.code
        """
    )


def get_document_type_detail(document_type_id: str) -> dict | None:
    document_type = fetch_one(
        """
        SELECT
            id,
            standard_id,
            code,
            name,
            parent_id,
            level_no,
            description,
            status,
            COALESCE(metadata -> 'document' -> 'allowed_extensions', '[]'::jsonb) AS allowed_extensions,
            metadata,
            created_at,
            updated_at
        FROM class
        WHERE id = %s
          AND applies_to IN ('document', 'both')
        """,
        (document_type_id,),
    )
    if document_type is None:
        return None

    document_type["common_attributes"] = _fetch_document_type_attributes(None, document_type["standard_id"])
    document_type["attributes"] = _fetch_document_type_attributes(document_type_id)
    return document_type


def list_common_document_type_attributes(standard_id: str) -> list[dict]:
    return _fetch_document_type_attributes(None, standard_id)


def _fetch_document_type_attributes(document_type_id: str | None, standard_id: str | None = None) -> list[dict]:
    if document_type_id is None:
        return fetch_all(
            """
            SELECT
                id,
                class_id AS document_type_id,
                standard_id,
                group_name,
                unit_family,
                code,
                name,
                value_type,
                is_required,
                enum_options,
                description,
                sort_order,
                status,
                created_at,
                updated_at
            FROM attribute_definition
            WHERE class_id IS NULL
              AND standard_id = %s
              AND applies_to IN ('document', 'both')
              AND status <> 'archived'
            ORDER BY sort_order, code
            """,
            (standard_id,),
        )

    return fetch_all(
        """
        SELECT
            id,
            class_id AS document_type_id,
            standard_id,
            group_name,
            unit_family,
            code,
            name,
            value_type,
            is_required,
            enum_options,
            description,
            sort_order,
            status,
            created_at,
            updated_at
        FROM attribute_definition
        WHERE class_id = %s
          AND status <> 'archived'
        ORDER BY sort_order, code
        """,
        (document_type_id,),
    )


def create_document_type(payload: dict) -> dict | None:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            _ensure_standard_exists(cursor, payload["standard_id"])
            level_no = _resolve_document_type_level(
                cursor,
                payload.get("parent_id"),
                standard_id=payload["standard_id"],
            )
            cursor.execute(
                """
                INSERT INTO class (standard_id, code, name, parent_id, level_no, description, status, metadata, applies_to)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'document')
                RETURNING
                    id,
                    standard_id,
                    code,
                    name,
                    parent_id,
                    level_no,
                    description,
                    status,
                    COALESCE(metadata -> 'document' -> 'allowed_extensions', '[]'::jsonb) AS allowed_extensions,
                    metadata,
                    created_at,
                    updated_at
                """,
                (
                    payload["standard_id"],
                    payload["code"],
                    payload["name"],
                    payload.get("parent_id"),
                    level_no,
                    payload.get("description"),
                    payload.get("status", "active"),
                    Json({
                        **payload.get("metadata", {}),
                        "document": {
                            "allowed_extensions": payload.get("allowed_extensions", []),
                        },
                    }),
                ),
            )
            row = cursor.fetchone()
        connection.commit()
    return row


def update_document_type(document_type_id: str, payload: dict) -> dict | None:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, parent_id, metadata
                FROM class
                WHERE id = %s
                  AND applies_to IN ('document', 'both')
                """,
                (document_type_id,),
            )
            existing = cursor.fetchone()
            if existing is None:
                return None

            _ensure_standard_exists(cursor, payload["standard_id"])
            level_no = _resolve_document_type_level(
                cursor,
                payload.get("parent_id"),
                document_type_id=document_type_id,
                standard_id=payload["standard_id"],
            )
            cursor.execute(
                """
                UPDATE class
                SET
                    standard_id = %s,
                    code = %s,
                    name = %s,
                    parent_id = %s,
                    level_no = %s,
                    description = %s,
                    status = %s,
                    metadata = %s,
                    updated_at = now()
                WHERE id = %s
                RETURNING
                    id,
                    standard_id,
                    code,
                    name,
                    parent_id,
                    level_no,
                    description,
                    status,
                    COALESCE(metadata -> 'document' -> 'allowed_extensions', '[]'::jsonb) AS allowed_extensions,
                    metadata,
                    created_at,
                    updated_at
                """,
                (
                    payload["standard_id"],
                    payload["code"],
                    payload["name"],
                    payload.get("parent_id"),
                    level_no,
                    payload.get("description"),
                    payload.get("status", "active"),
                    Json({
                        **(existing.get("metadata") or {}),
                        **payload.get("metadata", {}),
                        "document": {
                            "allowed_extensions": payload.get("allowed_extensions", []),
                        },
                    }),
                    document_type_id,
                ),
            )
            row = cursor.fetchone()
            _refresh_document_type_descendant_levels(cursor, document_type_id)
        connection.commit()
    return row


def create_document_type_attribute(document_type_id: str | None, payload: dict, standard_id: str | None = None) -> dict | None:
    if document_type_id is None:
        if not standard_id:
            raise ValueError("Standard is required for common document attributes")
        with get_connection() as connection:
            with connection.cursor() as cursor:
                _ensure_standard_exists(cursor, standard_id)
                cursor.execute(
                    """
                    INSERT INTO attribute_definition (
                        class_id,
                        standard_id,
                        group_name,
                        unit_family,
                        code,
                        name,
                        value_type,
                        is_required,
                        enum_options,
                        description,
                        sort_order,
                        status,
                        metadata,
                        applies_to
                    )
                    SELECT
                        %s,
                        %s,
                        %s,
                        %s,
                        %s,
                        %s,
                        %s,
                        %s,
                        %s,
                        %s,
                        COALESCE((
                            SELECT MAX(sort_order) + 1
                            FROM attribute_definition
                            WHERE class_id IS NULL
                              AND standard_id = %s
                              AND applies_to IN ('document', 'both')
                              AND status <> 'archived'
                        ), 0),
                        %s,
                        '{}'::jsonb,
                        'document'
                    RETURNING
                        id,
                        class_id AS document_type_id,
                        standard_id,
                        group_name,
                        unit_family,
                        code,
                        name,
                        value_type,
                        is_required,
                        enum_options,
                        description,
                        sort_order,
                        status,
                        applies_to,
                        created_at,
                        updated_at
                    """,
                    (
                        None,
                        standard_id,
                        payload.get("group_name"),
                        payload.get("unit_family"),
                        payload["code"],
                        payload["name"],
                        payload["value_type"],
                        payload["is_required"],
                        Json(payload.get("enum_options", [])),
                        payload.get("description"),
                        standard_id,
                        payload.get("status", "active"),
                    ),
                )
                row = cursor.fetchone()
            connection.commit()
        return row

    return execute_one(
        """
        INSERT INTO attribute_definition (
            class_id,
            standard_id,
            group_name,
            unit_family,
            code,
            name,
            value_type,
            is_required,
            enum_options,
            description,
            sort_order,
            status,
            metadata,
            applies_to
        )
        SELECT
            %s,
            %s,
            %s,
            %s,
            %s,
            %s,
            %s,
            %s,
            %s,
            %s,
            COALESCE((
                SELECT MAX(sort_order) + 1
                FROM attribute_definition
                WHERE class_id = %s
                  AND status <> 'archived'
            ), 0),
            %s,
            '{}'::jsonb,
            'document'
        WHERE EXISTS (
            SELECT 1
            FROM class
            WHERE id = %s
              AND applies_to IN ('document', 'both')
        )
        RETURNING
            id,
            class_id AS document_type_id,
            standard_id,
            group_name,
            unit_family,
            code,
            name,
            value_type,
            is_required,
            enum_options,
            description,
            sort_order,
            status,
            applies_to,
            created_at,
            updated_at
        """,
        (
            document_type_id,
            None,
            payload.get("group_name"),
            payload.get("unit_family"),
            payload["code"],
            payload["name"],
            payload["value_type"],
            payload["is_required"],
            Json(payload.get("enum_options", [])),
            payload.get("description"),
            document_type_id,
            payload.get("status", "active"),
            document_type_id,
        ),
    )


def update_document_type_attribute(attribute_id: str, payload: dict) -> dict | None:
    return execute_one(
        """
        UPDATE attribute_definition
        SET
            group_name = %s,
            unit_family = %s,
            code = %s,
            name = %s,
            value_type = %s,
            is_required = %s,
            enum_options = %s,
            description = %s,
            status = %s,
            updated_at = now()
        WHERE id = %s
        RETURNING
            id,
            class_id AS document_type_id,
            standard_id,
            group_name,
            unit_family,
            code,
            name,
            value_type,
            is_required,
            enum_options,
            description,
            sort_order,
            status,
            applies_to,
            created_at,
            updated_at
        """,
        (
            payload.get("group_name"),
            payload.get("unit_family"),
            payload["code"],
            payload["name"],
            payload["value_type"],
            payload["is_required"],
            Json(payload.get("enum_options", [])),
            payload.get("description"),
            payload.get("status", "active"),
            attribute_id,
        ),
    )


def archive_document_type_attribute(attribute_id: str) -> dict | None:
    return execute_one(
        """
        UPDATE attribute_definition
        SET status = 'archived',
            updated_at = now()
        WHERE id = %s
          AND status <> 'archived'
        RETURNING
            id,
            class_id AS document_type_id,
            standard_id,
            group_name,
            unit_family,
            code,
            name,
            value_type,
            is_required,
            enum_options,
            description,
            sort_order,
            status,
            applies_to,
            created_at,
            updated_at
        """,
        (attribute_id,),
    )


def reorder_document_type_attributes(
    document_type_id: str | None,
    attribute_ids: list[str],
    *,
    standard_id: str | None = None,
) -> list[dict] | None:
    ordered_ids = [str(attribute_id) for attribute_id in attribute_ids]
    if len(ordered_ids) != len(set(ordered_ids)):
        raise ValueError("Attribute ids must be unique")

    with get_connection() as connection:
        with connection.cursor() as cursor:
            if document_type_id is None:
                if not standard_id:
                    raise ValueError("Standard is required")
                _ensure_standard_exists(cursor, standard_id)
                cursor.execute(
                    """
                    SELECT id
                    FROM attribute_definition
                    WHERE class_id IS NULL
                      AND standard_id = %s
                      AND applies_to IN ('document', 'both')
                      AND status <> 'archived'
                    """,
                    (standard_id,),
                )
                existing_ids = {str(row["id"]) for row in cursor.fetchall()}
            else:
                cursor.execute(
                    """
                    SELECT id
                    FROM class
                    WHERE id = %s
                      AND applies_to IN ('document', 'both')
                    """,
                    (document_type_id,),
                )
                if cursor.fetchone() is None:
                    return None

                cursor.execute(
                    """
                    SELECT id
                    FROM attribute_definition
                    WHERE class_id = %s
                      AND applies_to IN ('document', 'both')
                      AND status <> 'archived'
                    """,
                    (document_type_id,),
                )
                existing_ids = {str(row["id"]) for row in cursor.fetchall()}

            if set(ordered_ids) != existing_ids:
                raise ValueError("Attribute order must include every attribute in the scope")

            for sort_order, attribute_id in enumerate(ordered_ids):
                cursor.execute(
                    """
                    UPDATE attribute_definition
                    SET sort_order = %s,
                        updated_at = now()
                    WHERE id = %s
                    """,
                    (sort_order, attribute_id),
                )

            if document_type_id is None:
                cursor.execute(
                    """
                    SELECT
                        id,
                        class_id AS document_type_id,
                        standard_id,
                        group_name,
                        unit_family,
                        code,
                        name,
                        value_type,
                        is_required,
                        enum_options,
                        description,
                        sort_order,
                        status,
                        applies_to,
                        created_at,
                        updated_at
                    FROM attribute_definition
                    WHERE class_id IS NULL
                      AND standard_id = %s
                      AND applies_to IN ('document', 'both')
                      AND status <> 'archived'
                    ORDER BY sort_order, code
                    """,
                    (standard_id,),
                )
            else:
                cursor.execute(
                    """
                    SELECT
                        id,
                        class_id AS document_type_id,
                        standard_id,
                        group_name,
                        unit_family,
                        code,
                        name,
                        value_type,
                        is_required,
                        enum_options,
                        description,
                        sort_order,
                        status,
                        applies_to,
                        created_at,
                        updated_at
                    FROM attribute_definition
                    WHERE class_id = %s
                      AND applies_to IN ('document', 'both')
                      AND status <> 'archived'
                    ORDER BY sort_order, code
                    """,
                    (document_type_id,),
                )
            rows = list(cursor.fetchall())

        connection.commit()
        return rows


def list_project_documents(project_id: str, filters: dict | None = None) -> dict:
    filters = filters or {}
    where_clauses = ["d.project_id = %s"]
    params: list[object] = [project_id]

    keyword = str(filters.get("keyword") or "").strip().lower()
    if keyword:
        like = f"%{keyword}%"
        where_clauses.append("(lower(d.document_no) LIKE %s OR lower(d.title) LIKE %s)")
        params.extend([like, like])

    document_type_id = str(filters.get("document_type_id") or "").strip()
    if document_type_id:
        where_clauses.append("d.class_id = %s")
        params.append(document_type_id)

    discipline = str(filters.get("discipline") or "").strip()
    if discipline:
        where_clauses.append("d.discipline = %s")
        params.append(discipline)

    status = str(filters.get("status") or "").strip()
    if status:
        where_clauses.append("d.status = %s")
        params.append(status)

    pbs_node_id = str(filters.get("pbs_node_id") or "").strip()
    if pbs_node_id:
        where_clauses.append(
            """
            EXISTS (
                SELECT 1
                FROM project_relation pr
                JOIN relation_type rt ON rt.id = pr.relation_type_id
                WHERE pr.project_id = d.project_id
                  AND pr.source_kind = 'document'
                  AND pr.source_id = d.id
                  AND pr.target_kind = 'pbs_node'
                  AND pr.target_id = %s
                  AND lower(rt.code) = lower(%s)
            )
            """
        )
        params.extend([pbs_node_id, DOCUMENT_LINKS_PBS_CODE])

    tag_id = str(filters.get("tag_id") or "").strip()
    if tag_id:
        where_clauses.append(
            """
            EXISTS (
                SELECT 1
                FROM project_relation pr
                JOIN relation_type rt ON rt.id = pr.relation_type_id
                WHERE pr.project_id = d.project_id
                  AND pr.source_kind = 'document'
                  AND pr.source_id = d.id
                  AND pr.target_kind = 'tag'
                  AND pr.target_id = %s
                  AND lower(rt.code) = lower(%s)
            )
            """
        )
        params.extend([tag_id, DOCUMENT_LINKS_TAG_CODE])

    page = max(1, int(filters.get("page") or 1))
    page_size = min(100, max(1, int(filters.get("page_size") or 20)))
    offset = (page - 1) * page_size
    where_sql = " AND ".join(where_clauses)

    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                SELECT COUNT(*)::int AS total
                FROM document d
                WHERE {where_sql}
                """,
                tuple(params),
            )
            total = int(cursor.fetchone()["total"])

            cursor.execute(
                f"""
                SELECT
                    d.id,
                    d.project_id,
                    d.document_no,
                    d.title,
                    d.class_id AS document_type_id,
                    c.code AS document_type_code,
                    c.name AS document_type_name,
                    d.discipline,
                    d.attributes,
                    d.current_revision_id,
                    d.status,
                    d.metadata,
                    d.created_at,
                    d.updated_at,
                    cr.revision_no AS current_revision_no,
                    cr.state AS current_revision_state,
                    COALESCE(file_stats.file_count, 0)::int AS file_count,
                    primary_file.original_filename AS primary_file_name,
                    COALESCE(pbs_stats.linked_pbs_count, 0)::int AS linked_pbs_count,
                    COALESCE(tag_stats.linked_tag_count, 0)::int AS linked_tag_count
                FROM document d
                LEFT JOIN class c ON c.id = d.class_id
                LEFT JOIN document_revision cr ON cr.id = d.current_revision_id
                LEFT JOIN LATERAL (
                    SELECT COUNT(*)::int AS file_count
                    FROM document_file pdf
                    WHERE pdf.revision_id = d.current_revision_id
                      AND pdf.status <> 'deleted'
                ) file_stats ON TRUE
                LEFT JOIN LATERAL (
                    SELECT original_filename
                    FROM document_file pdf
                    WHERE pdf.revision_id = d.current_revision_id
                      AND pdf.file_role = 'primary'
                      AND pdf.status = 'ready'
                    ORDER BY pdf.created_at DESC
                    LIMIT 1
                ) primary_file ON TRUE
                LEFT JOIN LATERAL (
                    SELECT COUNT(*)::int AS linked_pbs_count
                    FROM project_relation pr
                    JOIN relation_type rt ON rt.id = pr.relation_type_id
                    WHERE pr.project_id = d.project_id
                      AND pr.source_kind = 'document'
                      AND pr.source_id = d.id
                      AND pr.target_kind = 'pbs_node'
                      AND lower(rt.code) = lower(%s)
                ) pbs_stats ON TRUE
                LEFT JOIN LATERAL (
                    SELECT COUNT(*)::int AS linked_tag_count
                    FROM project_relation pr
                    JOIN relation_type rt ON rt.id = pr.relation_type_id
                    WHERE pr.project_id = d.project_id
                      AND pr.source_kind = 'document'
                      AND pr.source_id = d.id
                      AND pr.target_kind = 'tag'
                      AND lower(rt.code) = lower(%s)
                ) tag_stats ON TRUE
                WHERE {where_sql}
                ORDER BY d.created_at DESC, d.document_no
                LIMIT %s OFFSET %s
                """,
                tuple([DOCUMENT_LINKS_PBS_CODE, DOCUMENT_LINKS_TAG_CODE, *params, page_size, offset]),
            )
            items = list(cursor.fetchall())

    return {
        "items": items,
        "page": page,
        "page_size": page_size,
        "total": total,
        "total_pages": max(1, (total + page_size - 1) // page_size),
    }


def get_project_document_detail(project_id: str, document_id: str) -> dict | None:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    d.id,
                    d.project_id,
                    d.document_no,
                    d.title,
                    d.class_id AS document_type_id,
                    c.code AS document_type_code,
                    c.name AS document_type_name,
                    d.discipline,
                    d.attributes,
                    d.current_revision_id,
                    d.status,
                    d.metadata,
                    d.created_at,
                    d.updated_at
                FROM document d
                LEFT JOIN class c ON c.id = d.class_id
                WHERE d.project_id = %s
                  AND d.id = %s
                """,
                (project_id, document_id),
            )
            document = cursor.fetchone()
            if document is None:
                return None

            pbs_nodes = get_document_linked_pbs_nodes(cursor, project_id, document_id)
            tags = get_document_linked_tags(cursor, project_id, document_id)

            cursor.execute(
                """
                SELECT
                    id,
                    document_id,
                    revision_no,
                    state,
                    is_current,
                    issued_at,
                    change_summary,
                    created_at,
                    updated_at
                FROM document_revision
                WHERE document_id = %s
                ORDER BY is_current DESC, issued_at DESC NULLS LAST, created_at DESC
                """,
                (document_id,),
            )
            revisions = list(cursor.fetchall())
            revision_ids = [str(revision["id"]) for revision in revisions]

            files_by_revision: dict[str, list[dict]] = defaultdict(list)
            if revision_ids:
                cursor.execute(
                    """
                    SELECT
                        id,
                        revision_id,
                        file_role,
                        original_filename,
                        relative_path,
                        storage_provider,
                        bucket,
                        object_key,
                        mime_type,
                        size_bytes,
                        checksum_sha256,
                        etag,
                        preview_mode,
                        status,
                        created_at,
                        updated_at
                    FROM document_file
                    WHERE revision_id = ANY(%s::uuid[])
                      AND status <> 'deleted'
                    ORDER BY created_at DESC
                    """,
                    (revision_ids,),
                )
                for file_row in cursor.fetchall():
                    files_by_revision[str(file_row["revision_id"])].append(file_row)

    document["pbs_nodes"] = pbs_nodes
    document["pbs_node_ids"] = [node["id"] for node in pbs_nodes]
    document["tags"] = tags
    document["tag_ids"] = [tag["id"] for tag in tags]
    document["revisions"] = [
        {**revision, "files": files_by_revision.get(str(revision["id"]), [])}
        for revision in revisions
    ]
    return document


def create_project_document(project_id: str, payload: dict) -> dict | None:
    pbs_node_ids = _normalize_id_list(payload.get("pbs_node_ids"))
    tag_ids = _normalize_id_list(payload.get("tag_ids"))

    with get_connection() as connection:
        with connection.cursor() as cursor:
            _ensure_project_exists(cursor, project_id)
            _validate_project_document_type(cursor, project_id, payload.get("document_type_id"))
            _validate_project_links(cursor, project_id, pbs_node_ids, tag_ids)

            cursor.execute(
                """
                INSERT INTO document (
                    project_id,
                    document_no,
                    title,
                    class_id,
                    discipline,
                    attributes,
                    status,
                    metadata
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    project_id,
                    payload["document_no"],
                    payload["title"],
                    payload.get("document_type_id"),
                    payload.get("discipline"),
                    Json(payload.get("attributes", {})),
                    payload.get("status", "active"),
                    Json(payload.get("metadata", {})),
                ),
            )
            document_id = str(cursor.fetchone()["id"])
            replace_document_relations(
                cursor,
                project_id,
                document_id,
                pbs_node_ids=pbs_node_ids,
                tag_ids=tag_ids,
            )
        connection.commit()
    return get_project_document_detail(project_id, document_id)


def update_project_document(project_id: str, document_id: str, payload: dict) -> dict | None:
    pbs_node_ids = _normalize_id_list(payload.get("pbs_node_ids"))
    tag_ids = _normalize_id_list(payload.get("tag_ids"))

    with get_connection() as connection:
        with connection.cursor() as cursor:
            existing = _ensure_project_document(cursor, project_id, document_id)
            if existing is None:
                return None

            _validate_project_document_type(cursor, project_id, payload.get("document_type_id"))
            _validate_project_links(cursor, project_id, pbs_node_ids, tag_ids)

            cursor.execute(
                """
                UPDATE document
                SET
                    document_no = %s,
                    title = %s,
                    class_id = %s,
                    discipline = %s,
                    attributes = %s,
                    status = %s,
                    metadata = %s,
                    updated_at = now()
                WHERE id = %s
                """,
                (
                    payload["document_no"],
                    payload["title"],
                    payload.get("document_type_id"),
                    payload.get("discipline"),
                    Json(payload.get("attributes", {})),
                    payload.get("status", "active"),
                    Json(payload.get("metadata", existing.get("metadata", {}))),
                    document_id,
                ),
            )
            replace_document_relations(
                cursor,
                project_id,
                document_id,
                pbs_node_ids=pbs_node_ids,
                tag_ids=tag_ids,
            )
        connection.commit()
    return get_project_document_detail(project_id, document_id)


def delete_project_document_record(project_id: str, document_id: str) -> tuple[dict | None, list[dict]]:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            document = _ensure_project_document(cursor, project_id, document_id)
            if document is None:
                return None, []

            storage_objects = _list_document_storage_objects(cursor, document_id=document_id)
            cursor.execute(
                """
                DELETE FROM document
                WHERE project_id = %s
                  AND id = %s
                RETURNING
                    id,
                    project_id,
                    document_no,
                    title,
                    class_id AS document_type_id,
                    discipline,
                    attributes,
                    current_revision_id,
                    status,
                    metadata,
                    created_at,
                    updated_at
                """,
                (project_id, document_id),
            )
            deleted_document = cursor.fetchone()
        connection.commit()
    return deleted_document, storage_objects


def create_project_document_revision(project_id: str, document_id: str, payload: dict) -> dict | None:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            document = _ensure_project_document(cursor, project_id, document_id)
            if document is None:
                return None

            cursor.execute(
                """
                INSERT INTO document_revision (
                    document_id,
                    revision_no,
                    state,
                    is_current,
                    issued_at,
                    change_summary
                )
                VALUES (%s, %s, %s, false, %s, %s)
                RETURNING
                    id,
                    document_id,
                    revision_no,
                    state,
                    is_current,
                    issued_at,
                    change_summary,
                    created_at,
                    updated_at
                """,
                (
                    document_id,
                    payload["revision_no"],
                    payload.get("state", "draft"),
                    payload.get("issued_at"),
                    payload.get("change_summary"),
                ),
            )
            revision = cursor.fetchone()
            should_set_current = bool(payload.get("set_as_current")) or document["current_revision_id"] is None
            if should_set_current:
                _set_current_revision(cursor, document_id, str(revision["id"]))
        connection.commit()
    return get_project_document_revision(project_id, document_id, str(revision["id"]))


def update_project_document_revision(project_id: str, document_id: str, revision_id: str, payload: dict) -> dict | None:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            if _ensure_project_document(cursor, project_id, document_id) is None:
                return None

            cursor.execute(
                """
                UPDATE document_revision
                SET
                    revision_no = %s,
                    state = %s,
                    issued_at = %s,
                    change_summary = %s,
                    updated_at = now()
                WHERE id = %s
                  AND document_id = %s
                RETURNING
                    id,
                    document_id,
                    revision_no,
                    state,
                    is_current,
                    issued_at,
                    change_summary,
                    created_at,
                    updated_at
                """,
                (
                    payload["revision_no"],
                    payload.get("state", "draft"),
                    payload.get("issued_at"),
                    payload.get("change_summary"),
                    revision_id,
                    document_id,
                ),
            )
            revision = cursor.fetchone()
            if revision is None:
                return None

            if payload.get("set_as_current"):
                _set_current_revision(cursor, document_id, revision_id)
        connection.commit()
    return get_project_document_revision(project_id, document_id, revision_id)


def delete_project_document_revision_record(
    project_id: str,
    document_id: str,
    revision_id: str,
) -> tuple[dict | None, list[dict]]:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            if _ensure_project_document(cursor, project_id, document_id) is None:
                return None, []

            cursor.execute(
                """
                SELECT
                    id,
                    document_id,
                    revision_no,
                    state,
                    is_current,
                    issued_at,
                    change_summary,
                    created_at,
                    updated_at
                FROM document_revision
                WHERE id = %s
                  AND document_id = %s
                """,
                (revision_id, document_id),
            )
            revision = cursor.fetchone()
            if revision is None:
                return None, []

            storage_objects = _list_document_storage_objects(cursor, revision_id=revision_id)
            if revision["is_current"]:
                cursor.execute(
                    """
                    UPDATE document_revision
                    SET is_current = false,
                        updated_at = now()
                    WHERE id = %s
                    """,
                    (revision_id,),
                )
                cursor.execute(
                    """
                    UPDATE document
                    SET current_revision_id = NULL,
                        updated_at = now()
                    WHERE id = %s
                    """,
                    (document_id,),
                )

            cursor.execute(
                """
                DELETE FROM document_revision
                WHERE id = %s
                  AND document_id = %s
                """,
                (revision_id, document_id),
            )

            if revision["is_current"]:
                cursor.execute(
                    """
                    SELECT id
                    FROM document_revision
                    WHERE document_id = %s
                    ORDER BY issued_at DESC NULLS LAST, created_at DESC
                    LIMIT 1
                    """,
                    (document_id,),
                )
                next_revision = cursor.fetchone()
                if next_revision is not None:
                    _set_current_revision(cursor, document_id, str(next_revision["id"]))

        connection.commit()
    return revision, storage_objects


def list_project_document_revisions(project_id: str, document_id: str) -> list[dict] | None:
    detail = get_project_document_detail(project_id, document_id)
    if detail is None:
        return None
    return detail["revisions"]


def get_project_document_revision(project_id: str, document_id: str, revision_id: str) -> dict | None:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            if _ensure_project_document(cursor, project_id, document_id) is None:
                return None

            cursor.execute(
                """
                SELECT
                    id,
                    document_id,
                    revision_no,
                    state,
                    is_current,
                    issued_at,
                    change_summary,
                    created_at,
                    updated_at
                FROM document_revision
                WHERE id = %s
                  AND document_id = %s
                """,
                (revision_id, document_id),
            )
            revision = cursor.fetchone()
            if revision is None:
                return None

            cursor.execute(
                """
                SELECT
                    id,
                    revision_id,
                    file_role,
                    original_filename,
                    relative_path,
                    storage_provider,
                    bucket,
                    object_key,
                    mime_type,
                    size_bytes,
                    checksum_sha256,
                    etag,
                    preview_mode,
                    status,
                    created_at,
                    updated_at
                FROM document_file
                WHERE revision_id = %s
                  AND status <> 'deleted'
                ORDER BY created_at DESC
                """,
                (revision_id,),
            )
            revision["files"] = list(cursor.fetchall())
            return revision


def get_project_document_upload_context(project_id: str, document_id: str, revision_id: str) -> dict | None:
    return fetch_one(
        """
        SELECT
            d.id AS document_id,
            d.class_id AS document_type_id,
            COALESCE(c.metadata -> 'document' -> 'allowed_extensions', '[]'::jsonb) AS allowed_extensions
        FROM document_revision dr
        JOIN document d ON d.id = dr.document_id
        LEFT JOIN class c ON c.id = d.class_id
        WHERE d.project_id = %s
          AND d.id = %s
          AND dr.id = %s
        """,
        (project_id, document_id, revision_id),
    )


def create_project_document_file_record(project_id: str, document_id: str, revision_id: str, payload: dict) -> dict | None:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            if _ensure_project_document_revision(cursor, project_id, document_id, revision_id) is None:
                return None

            cursor.execute(
                """
                INSERT INTO document_file (
                    id,
                    revision_id,
                    file_role,
                    original_filename,
                    relative_path,
                    storage_provider,
                    bucket,
                    object_key,
                    mime_type,
                    size_bytes,
                    checksum_sha256,
                    preview_mode,
                    status
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING
                    id,
                    revision_id,
                    file_role,
                    original_filename,
                    relative_path,
                    storage_provider,
                    bucket,
                    object_key,
                    mime_type,
                    size_bytes,
                    checksum_sha256,
                    etag,
                    preview_mode,
                    status,
                    created_at,
                    updated_at
                """,
                (
                    payload["id"],
                    revision_id,
                    payload["file_role"],
                    payload["original_filename"],
                    payload.get("relative_path"),
                    payload["storage_provider"],
                    payload["bucket"],
                    payload["object_key"],
                    payload["mime_type"],
                    payload["size_bytes"],
                    payload.get("checksum_sha256"),
                    payload["preview_mode"],
                    payload.get("status", "pending_upload"),
                ),
            )
            file_row = cursor.fetchone()
        connection.commit()
    return file_row


def mark_project_document_file_ready(
    project_id: str,
    document_id: str,
    revision_id: str,
    file_id: str,
    payload: dict,
) -> dict | None:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            if _ensure_project_document_revision(cursor, project_id, document_id, revision_id) is None:
                return None

            cursor.execute(
                """
                UPDATE document_file
                SET
                    etag = %s,
                    mime_type = %s,
                    size_bytes = %s,
                    status = 'ready',
                    updated_at = now()
                WHERE id = %s
                  AND revision_id = %s
                RETURNING
                    id,
                    revision_id,
                    file_role,
                    original_filename,
                    relative_path,
                    storage_provider,
                    bucket,
                    object_key,
                    mime_type,
                    size_bytes,
                    checksum_sha256,
                    etag,
                    preview_mode,
                    status,
                    created_at,
                    updated_at
                """,
                (
                    payload.get("etag"),
                    payload["mime_type"],
                    payload["size_bytes"],
                    file_id,
                    revision_id,
                ),
            )
            file_row = cursor.fetchone()
        connection.commit()
    return file_row


def get_project_document_file(project_id: str, document_id: str, revision_id: str, file_id: str) -> dict | None:
    return fetch_one(
        """
        SELECT
            pdf.id,
            pdf.revision_id,
            pdf.file_role,
            pdf.original_filename,
            pdf.relative_path,
            pdf.storage_provider,
            pdf.bucket,
            pdf.object_key,
            pdf.mime_type,
            pdf.size_bytes,
            pdf.checksum_sha256,
            pdf.etag,
            pdf.preview_mode,
            pdf.status,
            pdf.created_at,
            pdf.updated_at
        FROM document_file pdf
        JOIN document_revision pdr ON pdr.id = pdf.revision_id
        JOIN document pd ON pd.id = pdr.document_id
        WHERE pd.project_id = %s
          AND pd.id = %s
          AND pdr.id = %s
          AND pdf.id = %s
        """,
        (project_id, document_id, revision_id, file_id),
    )


def _ensure_project_exists(cursor, project_id: str) -> None:
    cursor.execute("SELECT id FROM project WHERE id = %s", (project_id,))
    if cursor.fetchone() is None:
        raise ValueError("Project not found")


def _ensure_standard_exists(cursor, standard_id: str) -> None:
    cursor.execute("SELECT id FROM standard WHERE id = %s", (standard_id,))
    if cursor.fetchone() is None:
        raise ValueError("Standard not found")


def _validate_document_type(cursor, document_type_id: str | None) -> None:
    if not document_type_id:
        return
    cursor.execute(
        """
        SELECT id
        FROM class
        WHERE id = %s
          AND applies_to IN ('document', 'both')
          AND status <> 'archived'
        """,
        (document_type_id,),
    )
    if cursor.fetchone() is None:
        raise ValueError("Document type not found")


def _validate_project_document_type(cursor, project_id: str, document_type_id: str | None) -> None:
    if not document_type_id:
        return

    cursor.execute(
        """
        SELECT reference_attributes ->> 'standard_id' AS standard_id
        FROM project
        WHERE id = %s
        """,
        (project_id,),
    )
    project = cursor.fetchone()
    project_standard_id = project["standard_id"] if project else None
    if not project_standard_id:
        raise ValueError("Project is not linked to a standard")

    cursor.execute(
        """
        SELECT id
        FROM class
        WHERE id = %s
          AND standard_id = %s
          AND applies_to IN ('document', 'both')
          AND status <> 'archived'
        """,
        (document_type_id, project_standard_id),
    )
    if cursor.fetchone() is None:
        raise ValueError("Document type must belong to the project's standard")


def _resolve_document_type_level(
    cursor,
    parent_id: str | None,
    document_type_id: str | None = None,
    standard_id: str | None = None,
) -> int:
    if not parent_id:
        return 1
    if document_type_id and parent_id == document_type_id:
        raise ValueError("Document type cannot be its own parent")

    cursor.execute(
        """
        SELECT id, parent_id, level_no, standard_id
        FROM class
        WHERE id = %s
          AND applies_to IN ('document', 'both')
        """,
        (parent_id,),
    )
    parent = cursor.fetchone()
    if parent is None:
        raise ValueError("Parent document type not found")
    if standard_id and parent["standard_id"] != standard_id:
        raise ValueError("Parent document type must belong to the same standard")

    if document_type_id:
        cursor.execute(
            """
            WITH RECURSIVE descendants AS (
                SELECT id
                FROM class
                WHERE id = %s
                UNION ALL
                SELECT child.id
                FROM class child
                JOIN descendants parent_node ON child.parent_id = parent_node.id
            )
            SELECT 1
            FROM descendants
            WHERE id = %s
            LIMIT 1
            """,
            (document_type_id, parent_id),
        )
        if cursor.fetchone() is not None:
            raise ValueError("Document type cannot move under its descendant")

    return int(parent["level_no"]) + 1


def _refresh_document_type_descendant_levels(cursor, document_type_id: str) -> None:
    cursor.execute(
        """
        WITH RECURSIVE levels AS (
            SELECT id, parent_id, level_no
            FROM class
            WHERE id = %s
            UNION ALL
            SELECT child.id, child.parent_id, parent.level_no + 1
            FROM class child
            JOIN levels parent ON child.parent_id = parent.id
        )
        UPDATE class dt
        SET level_no = levels.level_no
        FROM levels
        WHERE dt.id = levels.id
        """,
        (document_type_id,),
    )


def _ensure_project_document(cursor, project_id: str, document_id: str) -> dict | None:
    cursor.execute(
        """
        SELECT id, project_id, current_revision_id, metadata
        FROM document
        WHERE project_id = %s
          AND id = %s
        """,
        (project_id, document_id),
    )
    return cursor.fetchone()


def _ensure_project_document_revision(cursor, project_id: str, document_id: str, revision_id: str) -> dict | None:
    cursor.execute(
        """
        SELECT pdr.id, pdr.document_id
        FROM document_revision pdr
        JOIN document pd ON pd.id = pdr.document_id
        WHERE pd.project_id = %s
          AND pd.id = %s
          AND pdr.id = %s
        """,
        (project_id, document_id, revision_id),
    )
    return cursor.fetchone()


def _list_document_storage_objects(cursor, *, document_id: str | None = None, revision_id: str | None = None) -> list[dict]:
    if document_id is None and revision_id is None:
        return []

    file_where_clauses: list[str] = []
    file_params: list[object] = []
    asset_where_clauses: list[str] = []
    asset_params: list[object] = []
    if document_id is not None:
        file_where_clauses.append("dr.document_id = %s")
        file_params.append(document_id)
        asset_where_clauses.append("dr.document_id = %s")
        asset_params.append(document_id)
    if revision_id is not None:
        file_where_clauses.append("df.revision_id = %s")
        file_params.append(revision_id)
        asset_where_clauses.append("dr.id = %s")
        asset_params.append(revision_id)

    cursor.execute(
        f"""
        SELECT DISTINCT
            df.bucket,
            df.object_key
        FROM document_file df
        JOIN document_revision dr ON dr.id = df.revision_id
        WHERE {" AND ".join(file_where_clauses)}
          AND df.bucket IS NOT NULL
          AND df.object_key IS NOT NULL
        """,
        tuple(file_params),
    )
    storage_objects = list(cursor.fetchall())

    cursor.execute(
        f"""
        SELECT DISTINCT
            dva.bucket,
            dva.object_key
        FROM document_visualization_asset dva
        JOIN document_visualization dv ON dv.id = dva.visualization_id
        JOIN document_revision dr ON dr.id = dv.revision_id
        WHERE {" AND ".join(asset_where_clauses)}
          AND dva.bucket IS NOT NULL
          AND dva.object_key IS NOT NULL
        """,
        tuple(asset_params),
    )
    seen = {(item["bucket"], item["object_key"]) for item in storage_objects}
    for item in cursor.fetchall():
        key = (item["bucket"], item["object_key"])
        if key not in seen:
            storage_objects.append(item)
            seen.add(key)
    return storage_objects


def list_project_document_revision_files(project_id: str, document_id: str, revision_id: str) -> list[dict]:
    return fetch_all(
        """
        SELECT
            pdf.id,
            pdf.revision_id,
            pdf.file_role,
            pdf.original_filename,
            pdf.relative_path,
            pdf.storage_provider,
            pdf.bucket,
            pdf.object_key,
            pdf.mime_type,
            pdf.size_bytes,
            pdf.checksum_sha256,
            pdf.etag,
            pdf.preview_mode,
            pdf.status,
            pdf.created_at,
            pdf.updated_at
        FROM document_file pdf
        JOIN document_revision pdr ON pdr.id = pdf.revision_id
        JOIN document pd ON pd.id = pdr.document_id
        WHERE pd.project_id = %s
          AND pd.id = %s
          AND pdr.id = %s
          AND pdf.status <> 'deleted'
        ORDER BY pdf.created_at DESC, pdf.id
        """,
        (project_id, document_id, revision_id),
    )


def _validate_project_links(cursor, project_id: str, pbs_node_ids: list[str], tag_ids: list[str]) -> None:
    if pbs_node_ids:
        cursor.execute(
            """
            SELECT COUNT(*)::int AS matched
            FROM pbs_node
            WHERE project_id = %s
              AND id = ANY(%s::uuid[])
            """,
            (project_id, pbs_node_ids),
        )
        if int(cursor.fetchone()["matched"]) != len(pbs_node_ids):
            raise ValueError("One or more PBS nodes do not belong to the project")

    if tag_ids:
        cursor.execute(
            """
            SELECT COUNT(*)::int AS matched
            FROM tag
            WHERE project_id = %s
              AND id = ANY(%s::uuid[])
            """,
            (project_id, tag_ids),
        )
        if int(cursor.fetchone()["matched"]) != len(tag_ids):
            raise ValueError("One or more tags do not belong to the project")


def _set_current_revision(cursor, document_id: str, revision_id: str) -> None:
    cursor.execute(
        """
        UPDATE document_revision
        SET is_current = (id = %s),
            updated_at = now()
        WHERE document_id = %s
        """,
        (revision_id, document_id),
    )
    cursor.execute(
        """
        UPDATE document
        SET current_revision_id = %s,
            updated_at = now()
        WHERE id = %s
        """,
        (revision_id, document_id),
    )
