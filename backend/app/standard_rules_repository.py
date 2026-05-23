import math
import re
from typing import Any

from psycopg.types.json import Json

from .db import fetch_all, fetch_one, get_connection


def _standard_exists(standard_id: str) -> bool:
    return fetch_one("SELECT id FROM standard WHERE id = %s", (standard_id,)) is not None


def _clean_filter(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def _normalize_context_code(value: str | None, default: str | None = None) -> str | None:
    text = (value or "").strip().lower()
    if not text:
        return default
    normalized = re.sub(r"[^a-z0-9]+", "_", text).strip("_")
    return normalized or default


def _page_bounds(page: int, page_size: int) -> tuple[int, int, int]:
    normalized_page = max(1, page)
    normalized_page_size = max(1, min(page_size, 200))
    offset = (normalized_page - 1) * normalized_page_size
    return normalized_page, normalized_page_size, offset


def _page_response(items: list[dict], total: int, *, page: int, page_size: int) -> dict:
    return {
        "items": items,
        "page": page,
        "page_size": page_size,
        "total": total,
        "total_pages": max(1, math.ceil(total / page_size)) if total else 1,
    }


def _discipline_row(discipline_id: str) -> dict | None:
    return fetch_one(
        """
        SELECT
            id,
            standard_id,
            cfihos_unique_code,
            code,
            name,
            description,
            status,
            metadata,
            created_at,
            updated_at
        FROM discipline
        WHERE id = %s
        """,
        (discipline_id,),
    )


def list_standard_disciplines(standard_id: str) -> list[dict] | None:
    if not _standard_exists(standard_id):
        return None
    return fetch_all(
        """
        SELECT
            id,
            standard_id,
            cfihos_unique_code,
            code,
            name,
            description,
            status,
            metadata,
            created_at,
            updated_at
        FROM discipline
        WHERE standard_id = %s
          AND status <> 'archived'
        ORDER BY code, name
        """,
        (standard_id,),
    )


def create_standard_discipline(standard_id: str, payload: dict) -> dict | None:
    if not _standard_exists(standard_id):
        return None
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO discipline (
                    standard_id, cfihos_unique_code, code, name, description, status, metadata
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    standard_id,
                    payload.get("cfihos_unique_code"),
                    payload["code"],
                    payload["name"],
                    payload.get("description"),
                    payload.get("status", "active"),
                    Json(payload.get("metadata") or {}),
                ),
            )
            discipline_id = str(cursor.fetchone()["id"])
        connection.commit()
    return _discipline_row(discipline_id)


def update_standard_discipline(standard_id: str, discipline_id: str, payload: dict) -> dict | None:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE discipline
                SET cfihos_unique_code = %s,
                    code = %s,
                    name = %s,
                    description = %s,
                    status = %s,
                    metadata = %s,
                    updated_at = now()
                WHERE id = %s
                  AND standard_id = %s
                RETURNING id
                """,
                (
                    payload.get("cfihos_unique_code"),
                    payload["code"],
                    payload["name"],
                    payload.get("description"),
                    payload.get("status", "active"),
                    Json(payload.get("metadata") or {}),
                    discipline_id,
                    standard_id,
                ),
            )
            row = cursor.fetchone()
        connection.commit()
    return _discipline_row(str(row["id"])) if row else None


def archive_standard_discipline(standard_id: str, discipline_id: str) -> dict | None:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE discipline
                SET status = 'archived',
                    updated_at = now()
                WHERE id = %s
                  AND standard_id = %s
                RETURNING id
                """,
                (discipline_id, standard_id),
            )
            row = cursor.fetchone()
            if row:
                cursor.execute(
                    """
                    UPDATE discipline_document_type
                    SET status = 'archived',
                        updated_at = now()
                    WHERE standard_id = %s
                      AND discipline_id = %s
                      AND status <> 'archived'
                    """,
                    (standard_id, discipline_id),
                )
        connection.commit()
    return _discipline_row(str(row["id"])) if row else None


def _discipline_document_type_select(where_sql: str) -> str:
    return f"""
        SELECT
            ddt.id,
            ddt.standard_id,
            ddt.discipline_id,
            d.code AS discipline_code,
            d.name AS discipline_name,
            ddt.document_type_id,
            dt.code AS document_type_code,
            dt.name AS document_type_name,
            ddt.cfihos_unique_code,
            ddt.short_code,
            ddt.asset_scope,
            ddt.representation_type,
            ddt.native_file_delivery_timing,
            ddt.perspective,
            ddt.lifecycle_phase,
            ddt.status,
            ddt.metadata,
            ddt.created_at,
            ddt.updated_at
        FROM discipline_document_type ddt
        JOIN discipline d ON d.id = ddt.discipline_id
        JOIN class dt ON dt.id = ddt.document_type_id
        WHERE {where_sql}
    """


def _discipline_document_type_row(rule_id: str) -> dict | None:
    return fetch_one(
        _discipline_document_type_select("ddt.id = %s"),
        (rule_id,),
    )


def list_standard_discipline_document_types(
    standard_id: str,
    filters: dict[str, Any] | None = None,
    *,
    page: int = 1,
    page_size: int = 50,
) -> dict | None:
    if not _standard_exists(standard_id):
        return None
    filters = filters or {}
    where = [
        "ddt.standard_id = %s",
        "ddt.status <> 'archived'",
    ]
    params: list[Any] = [standard_id]
    for field in ["discipline_id", "document_type_id"]:
        value = _clean_filter(filters.get(field))
        if value:
            where.append(f"ddt.{field} = %s")
            params.append(value)
    for field in ["asset_scope", "perspective", "lifecycle_phase"]:
        value = _clean_filter(filters.get(field))
        if value:
            where.append(f"lower(ddt.{field}) = lower(%s)")
            params.append(value)

    normalized_page, normalized_page_size, offset = _page_bounds(page, page_size)
    where_sql = " AND ".join(where)
    total_row = fetch_one(
        f"""
        SELECT COUNT(*)::int AS total
        FROM discipline_document_type ddt
        WHERE {where_sql}
        """,
        tuple(params),
    )
    items = fetch_all(
        f"""
        {_discipline_document_type_select(where_sql)}
        ORDER BY d.code, dt.code, ddt.short_code NULLS LAST, ddt.asset_scope NULLS LAST
        LIMIT %s OFFSET %s
        """,
        (*params, normalized_page_size, offset),
    )
    return _page_response(items, total_row["total"] if total_row else 0, page=normalized_page, page_size=normalized_page_size)


def _validate_discipline_rule_refs(cursor, standard_id: str, payload: dict) -> None:
    cursor.execute(
        """
        SELECT id
        FROM discipline
        WHERE id = %s
          AND standard_id = %s
          AND status <> 'archived'
        """,
        (payload["discipline_id"], standard_id),
    )
    if cursor.fetchone() is None:
        raise ValueError("Discipline not found")

    cursor.execute(
        """
        SELECT id
        FROM class
        WHERE id = %s
          AND standard_id = %s
          AND applies_to IN ('document', 'both')
          AND status <> 'archived'
        """,
        (payload["document_type_id"], standard_id),
    )
    if cursor.fetchone() is None:
        raise ValueError("Document type not found")


def _normalize_discipline_rule_payload(payload: dict) -> dict:
    return {
        **payload,
        "asset_scope": _normalize_context_code(payload.get("asset_scope")),
        "perspective": _normalize_context_code(payload.get("perspective"), "standard") or "standard",
        "lifecycle_phase": _normalize_context_code(payload.get("lifecycle_phase"), "unspecified") or "unspecified",
    }


def create_standard_discipline_document_type(standard_id: str, payload: dict) -> dict | None:
    if not _standard_exists(standard_id):
        return None
    normalized = _normalize_discipline_rule_payload(payload)
    with get_connection() as connection:
        with connection.cursor() as cursor:
            _validate_discipline_rule_refs(cursor, standard_id, normalized)
            cursor.execute(
                """
                INSERT INTO discipline_document_type (
                    standard_id, discipline_id, document_type_id, cfihos_unique_code, short_code,
                    asset_scope, representation_type, native_file_delivery_timing,
                    perspective, lifecycle_phase, status, metadata
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    standard_id,
                    normalized["discipline_id"],
                    normalized["document_type_id"],
                    normalized.get("cfihos_unique_code"),
                    normalized.get("short_code"),
                    normalized.get("asset_scope"),
                    normalized.get("representation_type"),
                    normalized.get("native_file_delivery_timing"),
                    normalized.get("perspective", "standard"),
                    normalized.get("lifecycle_phase", "unspecified"),
                    normalized.get("status", "active"),
                    Json(normalized.get("metadata") or {}),
                ),
            )
            rule_id = str(cursor.fetchone()["id"])
        connection.commit()
    return _discipline_document_type_row(rule_id)


def update_standard_discipline_document_type(standard_id: str, rule_id: str, payload: dict) -> dict | None:
    normalized = _normalize_discipline_rule_payload(payload)
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT id FROM discipline_document_type WHERE id = %s AND standard_id = %s",
                (rule_id, standard_id),
            )
            if cursor.fetchone() is None:
                return None
            _validate_discipline_rule_refs(cursor, standard_id, normalized)
            cursor.execute(
                """
                UPDATE discipline_document_type
                SET discipline_id = %s,
                    document_type_id = %s,
                    cfihos_unique_code = %s,
                    short_code = %s,
                    asset_scope = %s,
                    representation_type = %s,
                    native_file_delivery_timing = %s,
                    perspective = %s,
                    lifecycle_phase = %s,
                    status = %s,
                    metadata = %s,
                    updated_at = now()
                WHERE id = %s
                  AND standard_id = %s
                RETURNING id
                """,
                (
                    normalized["discipline_id"],
                    normalized["document_type_id"],
                    normalized.get("cfihos_unique_code"),
                    normalized.get("short_code"),
                    normalized.get("asset_scope"),
                    normalized.get("representation_type"),
                    normalized.get("native_file_delivery_timing"),
                    normalized.get("perspective", "standard"),
                    normalized.get("lifecycle_phase", "unspecified"),
                    normalized.get("status", "active"),
                    Json(normalized.get("metadata") or {}),
                    rule_id,
                    standard_id,
                ),
            )
            row = cursor.fetchone()
        connection.commit()
    return _discipline_document_type_row(str(row["id"])) if row else None


def archive_standard_discipline_document_type(standard_id: str, rule_id: str) -> dict | None:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE discipline_document_type
                SET status = 'archived',
                    updated_at = now()
                WHERE id = %s
                  AND standard_id = %s
                RETURNING id
                """,
                (rule_id, standard_id),
            )
            row = cursor.fetchone()
        connection.commit()
    return _discipline_document_type_row(str(row["id"])) if row else None


def _class_document_requirement_select(where_sql: str) -> str:
    return f"""
        SELECT
            cdr.id,
            cdr.standard_id,
            cdr.class_id,
            c.code AS class_code,
            c.name AS class_name,
            c.applies_to AS class_applies_to,
            cdr.document_type_id,
            dt.code AS document_type_code,
            dt.name AS document_type_name,
            cdr.cfihos_unique_code,
            cdr.asset_scope,
            cdr.source_standard_cfihos_code,
            cdr.source_standard_code,
            cdr.perspective,
            cdr.lifecycle_phase,
            cdr.status,
            cdr.metadata,
            cdr.created_at,
            cdr.updated_at
        FROM class_document_requirement cdr
        JOIN class c ON c.id = cdr.class_id
        JOIN class dt ON dt.id = cdr.document_type_id
        WHERE {where_sql}
    """


def _class_document_requirement_row(requirement_id: str) -> dict | None:
    return fetch_one(
        _class_document_requirement_select("cdr.id = %s"),
        (requirement_id,),
    )


def list_standard_class_document_requirements(
    standard_id: str,
    filters: dict[str, Any] | None = None,
    *,
    page: int = 1,
    page_size: int = 50,
) -> dict | None:
    if not _standard_exists(standard_id):
        return None
    filters = filters or {}
    where = [
        "cdr.standard_id = %s",
        "cdr.status <> 'archived'",
    ]
    params: list[Any] = [standard_id]
    for field in ["class_id", "document_type_id"]:
        value = _clean_filter(filters.get(field))
        if value:
            where.append(f"cdr.{field} = %s")
            params.append(value)
    for field in ["asset_scope", "perspective", "lifecycle_phase"]:
        value = _clean_filter(filters.get(field))
        if value:
            where.append(f"lower(cdr.{field}) = lower(%s)")
            params.append(value)

    normalized_page, normalized_page_size, offset = _page_bounds(page, page_size)
    where_sql = " AND ".join(where)
    total_row = fetch_one(
        f"""
        SELECT COUNT(*)::int AS total
        FROM class_document_requirement cdr
        WHERE {where_sql}
        """,
        tuple(params),
    )
    items = fetch_all(
        f"""
        {_class_document_requirement_select(where_sql)}
        ORDER BY c.code, dt.code, cdr.asset_scope NULLS LAST
        LIMIT %s OFFSET %s
        """,
        (*params, normalized_page_size, offset),
    )
    return _page_response(items, total_row["total"] if total_row else 0, page=normalized_page, page_size=normalized_page_size)


def _validate_class_requirement_refs(cursor, standard_id: str, payload: dict) -> None:
    cursor.execute(
        """
        SELECT id
        FROM class
        WHERE id = %s
          AND standard_id = %s
          AND applies_to IN ('tag', 'equipment', 'both')
          AND status <> 'archived'
        """,
        (payload["class_id"], standard_id),
    )
    if cursor.fetchone() is None:
        raise ValueError("Class not found")

    cursor.execute(
        """
        SELECT id
        FROM class
        WHERE id = %s
          AND standard_id = %s
          AND applies_to IN ('document', 'both')
          AND status <> 'archived'
        """,
        (payload["document_type_id"], standard_id),
    )
    if cursor.fetchone() is None:
        raise ValueError("Document type not found")


def _normalize_class_requirement_payload(payload: dict) -> dict:
    return {
        **payload,
        "asset_scope": _normalize_context_code(payload.get("asset_scope")),
        "perspective": _normalize_context_code(payload.get("perspective"), "standard") or "standard",
        "lifecycle_phase": _normalize_context_code(payload.get("lifecycle_phase"), "unspecified") or "unspecified",
    }


def create_standard_class_document_requirement(standard_id: str, payload: dict) -> dict | None:
    if not _standard_exists(standard_id):
        return None
    normalized = _normalize_class_requirement_payload(payload)
    with get_connection() as connection:
        with connection.cursor() as cursor:
            _validate_class_requirement_refs(cursor, standard_id, normalized)
            cursor.execute(
                """
                INSERT INTO class_document_requirement (
                    standard_id, class_id, document_type_id, cfihos_unique_code, asset_scope,
                    source_standard_cfihos_code, source_standard_code,
                    perspective, lifecycle_phase, status, metadata
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    standard_id,
                    normalized["class_id"],
                    normalized["document_type_id"],
                    normalized.get("cfihos_unique_code"),
                    normalized.get("asset_scope"),
                    normalized.get("source_standard_cfihos_code"),
                    normalized.get("source_standard_code"),
                    normalized.get("perspective", "standard"),
                    normalized.get("lifecycle_phase", "unspecified"),
                    normalized.get("status", "active"),
                    Json(normalized.get("metadata") or {}),
                ),
            )
            requirement_id = str(cursor.fetchone()["id"])
        connection.commit()
    return _class_document_requirement_row(requirement_id)


def update_standard_class_document_requirement(standard_id: str, requirement_id: str, payload: dict) -> dict | None:
    normalized = _normalize_class_requirement_payload(payload)
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT id FROM class_document_requirement WHERE id = %s AND standard_id = %s",
                (requirement_id, standard_id),
            )
            if cursor.fetchone() is None:
                return None
            _validate_class_requirement_refs(cursor, standard_id, normalized)
            cursor.execute(
                """
                UPDATE class_document_requirement
                SET class_id = %s,
                    document_type_id = %s,
                    cfihos_unique_code = %s,
                    asset_scope = %s,
                    source_standard_cfihos_code = %s,
                    source_standard_code = %s,
                    perspective = %s,
                    lifecycle_phase = %s,
                    status = %s,
                    metadata = %s,
                    updated_at = now()
                WHERE id = %s
                  AND standard_id = %s
                RETURNING id
                """,
                (
                    normalized["class_id"],
                    normalized["document_type_id"],
                    normalized.get("cfihos_unique_code"),
                    normalized.get("asset_scope"),
                    normalized.get("source_standard_cfihos_code"),
                    normalized.get("source_standard_code"),
                    normalized.get("perspective", "standard"),
                    normalized.get("lifecycle_phase", "unspecified"),
                    normalized.get("status", "active"),
                    Json(normalized.get("metadata") or {}),
                    requirement_id,
                    standard_id,
                ),
            )
            row = cursor.fetchone()
        connection.commit()
    return _class_document_requirement_row(str(row["id"])) if row else None


def archive_standard_class_document_requirement(standard_id: str, requirement_id: str) -> dict | None:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE class_document_requirement
                SET status = 'archived',
                    updated_at = now()
                WHERE id = %s
                  AND standard_id = %s
                RETURNING id
                """,
                (requirement_id, standard_id),
            )
            row = cursor.fetchone()
        connection.commit()
    return _class_document_requirement_row(str(row["id"])) if row else None
