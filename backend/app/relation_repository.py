from __future__ import annotations

from collections.abc import Iterable

from psycopg.types.json import Json

from .db import fetch_all, get_connection


ENTITY_KINDS = ("document", "tag", "pbs_node")
RELATION_DIRECTIONS = ("outbound", "inbound", "both")

DOCUMENT_LINKS_TAG_CODE = "document_links_tag"
DOCUMENT_LINKS_PBS_CODE = "document_links_pbs"
TAG_RELATES_TAG_CODE = "tag_relates_tag"

_ENTITY_SQL = {
    "document": "SELECT id FROM document WHERE project_id = %s AND id = %s",
    "tag": "SELECT id FROM tag WHERE project_id = %s AND id = %s",
    "pbs_node": "SELECT id FROM pbs_node WHERE project_id = %s AND id = %s",
}


def _normalize_text(value: object | None) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _normalize_kind(value: object | None, *, field_name: str) -> str:
    kind = _normalize_text(value)
    if kind is None:
        raise ValueError(f"{field_name} is required")
    if kind not in ENTITY_KINDS:
        raise ValueError(f"Unsupported {field_name}: {kind}")
    return kind


def _normalize_direction(value: object | None) -> str:
    direction = _normalize_text(value) or "both"
    if direction not in RELATION_DIRECTIONS:
        raise ValueError(f"Unsupported direction: {direction}")
    return direction


def _normalize_id_list(values: Iterable[str] | None) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for value in values or []:
        text = _normalize_text(value)
        if text is not None and text not in seen:
            normalized.append(text)
            seen.add(text)
    return normalized


def _ensure_project_exists(cursor, project_id: str) -> None:
    cursor.execute("SELECT id FROM project WHERE id = %s", (project_id,))
    if cursor.fetchone() is None:
        raise ValueError("Project not found")


def _get_relation_type_by_code(cursor, relation_type_code: str) -> dict | None:
    cursor.execute(
        """
        SELECT
            id,
            code,
            name,
            source_kind,
            target_kind,
            is_symmetric,
            status,
            metadata,
            created_at,
            updated_at
        FROM relation_type
        WHERE lower(code) = lower(%s)
          AND status <> 'archived'
        """,
        (relation_type_code,),
    )
    return cursor.fetchone()


def _entity_exists(cursor, project_id: str, entity_kind: str, entity_id: str) -> bool:
    cursor.execute(_ENTITY_SQL[entity_kind], (project_id, entity_id))
    return cursor.fetchone() is not None


def _validate_entity_belongs_to_project(cursor, project_id: str, entity_kind: str, entity_id: str) -> None:
    if not _entity_exists(cursor, project_id, entity_kind, entity_id):
        raise ValueError(f"{entity_kind} does not belong to the project")


def _canonicalize_relation_endpoints(
    relation_type: dict,
    source_kind: str,
    source_id: str,
    target_kind: str,
    target_id: str,
) -> tuple[str, str, str, str]:
    if not relation_type["is_symmetric"]:
        return source_kind, source_id, target_kind, target_id

    left = (source_kind, source_id)
    right = (target_kind, target_id)
    if right < left:
        return target_kind, target_id, source_kind, source_id
    return source_kind, source_id, target_kind, target_id


def _fetch_relation_detail(cursor, project_id: str, relation_id: str) -> dict | None:
    cursor.execute(
        """
        SELECT
            pr.id,
            pr.project_id,
            pr.relation_type_id,
            rt.code AS relation_type_code,
            rt.name AS relation_type_name,
            rt.is_symmetric,
            pr.source_kind,
            pr.source_id,
            pr.target_kind,
            pr.target_id,
            pr.sort_order,
            pr.note,
            pr.source_system,
            pr.metadata,
            pr.created_at,
            pr.updated_at
        FROM project_relation pr
        JOIN relation_type rt ON rt.id = pr.relation_type_id
        WHERE pr.project_id = %s
          AND pr.id = %s
        """,
        (project_id, relation_id),
    )
    return cursor.fetchone()


def list_project_relations(project_id: str, filters: dict | None = None) -> list[dict]:
    filters = filters or {}
    where_clauses = ["pr.project_id = %s"]
    params: list[object] = [project_id]

    relation_type_code = _normalize_text(filters.get("relation_type"))
    if relation_type_code is not None:
        where_clauses.append("lower(rt.code) = lower(%s)")
        params.append(relation_type_code)

    source_kind = _normalize_text(filters.get("source_kind"))
    if source_kind is not None:
        where_clauses.append("pr.source_kind = %s")
        params.append(_normalize_kind(source_kind, field_name="source_kind"))

    target_kind = _normalize_text(filters.get("target_kind"))
    if target_kind is not None:
        where_clauses.append("pr.target_kind = %s")
        params.append(_normalize_kind(target_kind, field_name="target_kind"))

    entity_kind = _normalize_text(filters.get("entity_kind"))
    entity_id = _normalize_text(filters.get("entity_id"))
    if (entity_kind is None) != (entity_id is None):
        raise ValueError("entity_kind and entity_id must be provided together")
    if entity_kind is not None and entity_id is not None:
        normalized_entity_kind = _normalize_kind(entity_kind, field_name="entity_kind")
        direction = _normalize_direction(filters.get("direction"))
        if direction == "outbound":
            where_clauses.append("(pr.source_kind = %s AND pr.source_id = %s)")
            params.extend([normalized_entity_kind, entity_id])
        elif direction == "inbound":
            where_clauses.append("(pr.target_kind = %s AND pr.target_id = %s)")
            params.extend([normalized_entity_kind, entity_id])
        else:
            where_clauses.append(
                "((pr.source_kind = %s AND pr.source_id = %s) OR (pr.target_kind = %s AND pr.target_id = %s))"
            )
            params.extend([normalized_entity_kind, entity_id, normalized_entity_kind, entity_id])

    where_sql = " AND ".join(where_clauses)
    return fetch_all(
        f"""
        SELECT
            pr.id,
            pr.project_id,
            pr.relation_type_id,
            rt.code AS relation_type_code,
            rt.name AS relation_type_name,
            rt.is_symmetric,
            pr.source_kind,
            pr.source_id,
            pr.target_kind,
            pr.target_id,
            pr.sort_order,
            pr.note,
            pr.source_system,
            pr.metadata,
            pr.created_at,
            pr.updated_at
        FROM project_relation pr
        JOIN relation_type rt ON rt.id = pr.relation_type_id
        WHERE {where_sql}
        ORDER BY rt.code, pr.sort_order, pr.created_at, pr.id
        """,
        tuple(params),
    )


def create_project_relation(project_id: str, payload: dict) -> dict | None:
    relation_type_code = _normalize_text(payload.get("relation_type_code"))
    if relation_type_code is None:
        raise ValueError("relation_type_code is required")

    source_kind = _normalize_kind(payload.get("source_kind"), field_name="source_kind")
    target_kind = _normalize_kind(payload.get("target_kind"), field_name="target_kind")
    source_id = _normalize_text(payload.get("source_id"))
    target_id = _normalize_text(payload.get("target_id"))
    if source_id is None or target_id is None:
        raise ValueError("source_id and target_id are required")

    with get_connection() as connection:
        with connection.cursor() as cursor:
            _ensure_project_exists(cursor, project_id)
            relation_type = _get_relation_type_by_code(cursor, relation_type_code)
            if relation_type is None:
                raise ValueError("Relation type not found")
            if relation_type["source_kind"] != source_kind or relation_type["target_kind"] != target_kind:
                raise ValueError("Relation endpoints do not match the relation type")

            source_kind, source_id, target_kind, target_id = _canonicalize_relation_endpoints(
                relation_type,
                source_kind,
                source_id,
                target_kind,
                target_id,
            )
            if source_kind == target_kind and source_id == target_id:
                raise ValueError("Self relation is not allowed")

            _validate_entity_belongs_to_project(cursor, project_id, source_kind, source_id)
            _validate_entity_belongs_to_project(cursor, project_id, target_kind, target_id)

            cursor.execute(
                """
                INSERT INTO project_relation (
                    project_id,
                    relation_type_id,
                    source_kind,
                    source_id,
                    target_kind,
                    target_id,
                    sort_order,
                    note,
                    source_system,
                    metadata
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    project_id,
                    relation_type["id"],
                    source_kind,
                    source_id,
                    target_kind,
                    target_id,
                    int(payload.get("sort_order") or 0),
                    _normalize_text(payload.get("note")),
                    _normalize_text(payload.get("source_system")),
                    Json(payload.get("metadata", {})),
                ),
            )
            relation_id = str(cursor.fetchone()["id"])
        connection.commit()

    with get_connection() as connection:
        with connection.cursor() as cursor:
            return _fetch_relation_detail(cursor, project_id, relation_id)


def delete_project_relation(project_id: str, relation_id: str) -> bool:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                DELETE FROM project_relation
                WHERE project_id = %s
                  AND id = %s
                RETURNING id
                """,
                (project_id, relation_id),
            )
            deleted = cursor.fetchone() is not None
        connection.commit()
    return deleted


def replace_document_relations(
    cursor,
    project_id: str,
    document_id: str,
    *,
    pbs_node_ids: Iterable[str] | None = None,
    tag_ids: Iterable[str] | None = None,
) -> None:
    _replace_relations_for_source(
        cursor,
        project_id,
        source_kind="document",
        source_id=document_id,
        relation_type_code=DOCUMENT_LINKS_PBS_CODE,
        target_kind="pbs_node",
        target_ids=_normalize_id_list(pbs_node_ids),
    )
    _replace_relations_for_source(
        cursor,
        project_id,
        source_kind="document",
        source_id=document_id,
        relation_type_code=DOCUMENT_LINKS_TAG_CODE,
        target_kind="tag",
        target_ids=_normalize_id_list(tag_ids),
    )


def get_document_linked_pbs_nodes(cursor, project_id: str, document_id: str) -> list[dict]:
    cursor.execute(
        """
        SELECT n.id, n.code, n.name
        FROM project_relation pr
        JOIN relation_type rt ON rt.id = pr.relation_type_id
        JOIN pbs_node n ON n.id = pr.target_id
        WHERE pr.project_id = %s
          AND pr.source_kind = 'document'
          AND pr.source_id = %s
          AND pr.target_kind = 'pbs_node'
          AND lower(rt.code) = lower(%s)
        ORDER BY pr.sort_order, n.code, n.name
        """,
        (project_id, document_id, DOCUMENT_LINKS_PBS_CODE),
    )
    return list(cursor.fetchall())


def get_document_linked_tags(cursor, project_id: str, document_id: str) -> list[dict]:
    cursor.execute(
        """
        SELECT t.id, t.tag_no, t.name
        FROM project_relation pr
        JOIN relation_type rt ON rt.id = pr.relation_type_id
        JOIN tag t ON t.id = pr.target_id
        WHERE pr.project_id = %s
          AND pr.source_kind = 'document'
          AND pr.source_id = %s
          AND pr.target_kind = 'tag'
          AND lower(rt.code) = lower(%s)
        ORDER BY pr.sort_order, t.tag_no, t.name
        """,
        (project_id, document_id, DOCUMENT_LINKS_TAG_CODE),
    )
    return list(cursor.fetchall())


def _replace_relations_for_source(
    cursor,
    project_id: str,
    *,
    source_kind: str,
    source_id: str,
    relation_type_code: str,
    target_kind: str,
    target_ids: list[str],
) -> None:
    relation_type = _get_relation_type_by_code(cursor, relation_type_code)
    if relation_type is None:
        raise ValueError("Relation type not found")

    cursor.execute(
        """
        DELETE FROM project_relation
        WHERE project_id = %s
          AND relation_type_id = %s
          AND source_kind = %s
          AND source_id = %s
          AND target_kind = %s
        """,
        (project_id, relation_type["id"], source_kind, source_id, target_kind),
    )

    for sort_order, target_id in enumerate(target_ids):
        cursor.execute(
            """
            INSERT INTO project_relation (
                project_id,
                relation_type_id,
                source_kind,
                source_id,
                target_kind,
                target_id,
                sort_order,
                metadata
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, '{}'::jsonb)
            """,
            (project_id, relation_type["id"], source_kind, source_id, target_kind, target_id, sort_order),
        )
