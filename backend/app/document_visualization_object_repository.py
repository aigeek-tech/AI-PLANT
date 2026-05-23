from __future__ import annotations

import math
from typing import Any

from psycopg.types.json import Json

from .db import get_connection


TARGET_KINDS = frozenset({"tag", "equipment", "document", "pbs_node", "custom"})
RESOLVER_TYPES = frozenset({"mesh", "primitive", "bbox", "anchor"})
COORDINATE_SPACES = frozenset({"splat_local", "world"})


def _normalize_required_text(value: Any, field_name: str) -> str:
    stripped = str(value or "").strip()
    if not stripped:
        raise ValueError(f"{field_name} is required")
    return stripped


def _normalize_optional_text(value: Any) -> str | None:
    if value is None:
        return None
    stripped = str(value).strip()
    return stripped or None


def _normalize_position(value: Any, field_name: str) -> list[float] | None:
    if value is None:
        return None
    if not isinstance(value, list | tuple) or len(value) != 3:
        raise ValueError(f"{field_name} must contain exactly three numbers")
    position = [float(item) for item in value]
    if any(not math.isfinite(item) for item in position):
        raise ValueError(f"{field_name} must contain finite numbers")
    return position


def _normalize_json_object(value: Any, field_name: str) -> dict:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValueError(f"{field_name} must be an object")
    return value


def _normalize_payload(payload: dict, *, partial: bool = False) -> dict:
    normalized: dict[str, Any] = {}

    if not partial or "target_kind" in payload:
        target_kind = _normalize_required_text(payload.get("target_kind"), "target_kind")
        if target_kind not in TARGET_KINDS:
            raise ValueError("target_kind is invalid")
        normalized["target_kind"] = target_kind

    if not partial or "target_id" in payload:
        normalized["target_id"] = _normalize_required_text(payload.get("target_id"), "target_id")

    if not partial or "label" in payload:
        normalized["label"] = _normalize_required_text(payload.get("label"), "label")

    if not partial or "resolver_type" in payload:
        resolver_type = _normalize_required_text(payload.get("resolver_type", "anchor"), "resolver_type")
        if resolver_type not in RESOLVER_TYPES:
            raise ValueError("resolver_type is invalid")
        normalized["resolver_type"] = resolver_type

    if not partial or "coordinate_space" in payload:
        coordinate_space = _normalize_required_text(payload.get("coordinate_space", "splat_local"), "coordinate_space")
        if coordinate_space not in COORDINATE_SPACES:
            raise ValueError("coordinate_space is invalid")
        normalized["coordinate_space"] = coordinate_space

    if not partial or "anchor_position" in payload:
        normalized["anchor_position"] = _normalize_position(payload.get("anchor_position"), "anchor_position")

    if not partial or "primitive" in payload:
        normalized["primitive"] = _normalize_json_object(payload.get("primitive"), "primitive")

    if not partial or "geometry_asset_id" in payload:
        normalized["geometry_asset_id"] = _normalize_optional_text(payload.get("geometry_asset_id"))

    if not partial or "priority" in payload:
        normalized["priority"] = int(payload.get("priority", 0) or 0)

    for field_name, default_value in {
        "visible": True,
        "selectable": True,
        "highlightable": True,
    }.items():
        if not partial or field_name in payload:
            normalized[field_name] = bool(payload.get(field_name, default_value))

    if not partial or "metadata" in payload:
        normalized["metadata"] = _normalize_json_object(payload.get("metadata"), "metadata")

    return normalized


def _validate_resolver_payload(payload: dict) -> None:
    resolver_type = payload["resolver_type"]
    if resolver_type == "anchor" and payload.get("anchor_position") is None:
        raise ValueError("anchor_position is required for anchor resolver")
    if resolver_type in {"primitive", "bbox"} and not payload.get("primitive"):
        raise ValueError("primitive is required for primitive and bbox resolvers")


def _ensure_visualization(cursor, project_id: str, document_id: str, revision_id: str, visualization_id: str) -> None:
    cursor.execute(
        """
        SELECT dv.id
        FROM document_visualization dv
        JOIN document_revision dr ON dr.id = dv.revision_id
        JOIN document d ON d.id = dr.document_id
        WHERE d.project_id = %s
          AND d.id = %s
          AND dr.id = %s
          AND dv.id = %s
        """,
        (project_id, document_id, revision_id, visualization_id),
    )
    if cursor.fetchone() is None:
        raise ValueError("Visualization not found")


def _ensure_target_exists(cursor, project_id: str, target_kind: str, target_id: str) -> None:
    if target_kind == "custom":
        return

    target_queries = {
        "tag": "SELECT id FROM tag WHERE project_id = %s AND id::text = %s",
        "equipment": "SELECT id FROM equipment WHERE project_id = %s AND id::text = %s",
        "document": "SELECT id FROM document WHERE project_id = %s AND id::text = %s",
        "pbs_node": "SELECT id FROM pbs_node WHERE project_id = %s AND id::text = %s",
    }
    cursor.execute(target_queries[target_kind], (project_id, target_id))
    if cursor.fetchone() is None:
        raise ValueError("Target not found")


def _normalize_row(row: dict) -> dict:
    normalized = dict(row)
    for field_name in ("id", "visualization_id"):
        normalized[field_name] = str(normalized[field_name])
    normalized["anchor_position"] = list(normalized["anchor_position"]) if normalized.get("anchor_position") else None
    normalized["primitive"] = normalized["primitive"] if isinstance(normalized.get("primitive"), dict) else {}
    normalized["metadata"] = normalized["metadata"] if isinstance(normalized.get("metadata"), dict) else {}
    return normalized


def _fetch_object(
    cursor,
    project_id: str,
    document_id: str,
    revision_id: str,
    visualization_id: str,
    object_id: str,
) -> dict | None:
    cursor.execute(
        """
        SELECT
            dvo.id,
            dvo.visualization_id,
            dvo.target_kind,
            dvo.target_id,
            dvo.label,
            dvo.resolver_type,
            dvo.coordinate_space,
            dvo.anchor_position,
            dvo.primitive,
            dvo.geometry_asset_id,
            dvo.priority,
            dvo.visible,
            dvo.selectable,
            dvo.highlightable,
            dvo.metadata,
            dvo.created_at,
            dvo.updated_at
        FROM document_visualization_object dvo
        JOIN document_visualization dv ON dv.id = dvo.visualization_id
        JOIN document_revision dr ON dr.id = dv.revision_id
        JOIN document d ON d.id = dr.document_id
        WHERE d.project_id = %s
          AND d.id = %s
          AND dr.id = %s
          AND dv.id = %s
          AND dvo.id = %s
        """,
        (project_id, document_id, revision_id, visualization_id, object_id),
    )
    row = cursor.fetchone()
    return _normalize_row(row) if row else None


def _list_objects(
    cursor,
    project_id: str,
    document_id: str,
    revision_id: str,
    visualization_id: str,
) -> list[dict]:
    cursor.execute(
        """
        SELECT
            dvo.id,
            dvo.visualization_id,
            dvo.target_kind,
            dvo.target_id,
            dvo.label,
            dvo.resolver_type,
            dvo.coordinate_space,
            dvo.anchor_position,
            dvo.primitive,
            dvo.geometry_asset_id,
            dvo.priority,
            dvo.visible,
            dvo.selectable,
            dvo.highlightable,
            dvo.metadata,
            dvo.created_at,
            dvo.updated_at
        FROM document_visualization_object dvo
        JOIN document_visualization dv ON dv.id = dvo.visualization_id
        JOIN document_revision dr ON dr.id = dv.revision_id
        JOIN document d ON d.id = dr.document_id
        WHERE d.project_id = %s
          AND d.id = %s
          AND dr.id = %s
          AND dv.id = %s
        ORDER BY dvo.visible DESC, dvo.selectable DESC, dvo.priority DESC, dvo.created_at DESC, dvo.id
        """,
        (project_id, document_id, revision_id, visualization_id),
    )
    return [_normalize_row(row) for row in cursor.fetchall()]


def _fetch_project_standard_id(cursor, project_id: str) -> str | None:
    cursor.execute(
        "SELECT reference_attributes ->> 'standard_id' AS standard_id FROM project WHERE id = %s",
        (project_id,),
    )
    row = cursor.fetchone()
    return str(row["standard_id"]) if row and row.get("standard_id") else None


def _fetch_attribute_definitions(
    cursor,
    *,
    project_id: str,
    class_ids: list[str],
    applies_to: str,
) -> dict[str, dict]:
    standard_id = _fetch_project_standard_id(cursor, project_id)
    definitions: list[dict] = []
    if standard_id:
        cursor.execute(
            """
            SELECT
                ad.id::text AS id,
                ad.class_id::text AS class_id,
                ad.code,
                ad.name,
                ad.group_name,
                ad.value_type,
                ad.unit_family,
                ad.sort_order,
                ad.applies_to
            FROM attribute_definition ad
            WHERE ad.standard_id::text = %s
              AND ad.class_id IS NULL
              AND ad.applies_to IN (%s, 'both')
              AND ad.status <> 'archived'
            ORDER BY ad.sort_order, ad.name, ad.code
            """,
            (standard_id, applies_to),
        )
        definitions.extend(dict(row) for row in cursor.fetchall())

    if class_ids:
        cursor.execute(
            """
            SELECT
                ad.id::text AS id,
                ad.class_id::text AS class_id,
                ad.code,
                ad.name,
                ad.group_name,
                ad.value_type,
                ad.unit_family,
                ad.sort_order,
                ad.applies_to
            FROM attribute_definition ad
            WHERE ad.class_id::text = ANY(%s)
              AND ad.applies_to IN (%s, 'both')
              AND ad.status <> 'archived'
            ORDER BY ad.sort_order, ad.name, ad.code
            """,
            (class_ids, applies_to),
        )
        definitions.extend(dict(row) for row in cursor.fetchall())

    definitions_by_code: dict[str, dict] = {}
    for definition in definitions:
        code = str(definition.get("code") or "").strip()
        if code:
            definitions_by_code[code] = definition
    return definitions_by_code


def _build_attribute_items(attribute_values: dict, definitions_by_code: dict[str, dict]) -> list[dict]:
    items: list[dict] = []
    added_codes: set[str] = set()

    for code, definition in definitions_by_code.items():
        if code not in attribute_values:
            continue
        added_codes.add(code)
        items.append(
            {
                "code": code,
                "name": definition.get("name") or code,
                "value": attribute_values.get(code),
                "group_name": definition.get("group_name"),
                "value_type": definition.get("value_type"),
                "unit_family": definition.get("unit_family"),
                "sort_order": definition.get("sort_order", 0),
            }
        )

    for code, value in attribute_values.items():
        code_text = str(code)
        if code_text in added_codes:
            continue
        items.append(
            {
                "code": code_text,
                "name": code_text,
                "value": value,
                "group_name": None,
                "value_type": None,
                "unit_family": None,
                "sort_order": 999999,
            }
        )

    return items


def _attach_attribute_items(cursor, project_id: str, summaries: dict[tuple[str, str], dict]) -> None:
    class_ids_by_domain = {
        "tag": sorted(
            {
                str(summary["class_id"])
                for summary in summaries.values()
                if summary.get("kind") == "tag" and summary.get("class_id")
            }
        ),
        "equipment": sorted(
            {
                str(summary["class_id"])
                for summary in summaries.values()
                if summary.get("kind") == "equipment" and summary.get("class_id")
            }
        ),
        "document": sorted(
            {
                str(summary["class_id"])
                for summary in summaries.values()
                if summary.get("kind") == "document" and summary.get("class_id")
            }
        ),
    }
    definitions_by_domain = {
        domain: _fetch_attribute_definitions(
            cursor,
            project_id=project_id,
            class_ids=class_ids,
            applies_to=domain,
        )
        for domain, class_ids in class_ids_by_domain.items()
    }

    for summary in summaries.values():
        kind = summary.get("kind")
        attribute_values = summary.get("attribute_values")
        if kind not in definitions_by_domain or not isinstance(attribute_values, dict):
            summary["attribute_items"] = []
            continue
        summary["attribute_items"] = _build_attribute_items(attribute_values, definitions_by_domain[kind])


def _attach_target_summaries(cursor, project_id: str, rows: list[dict]) -> list[dict]:
    targets_by_kind: dict[str, list[str]] = {}
    for row in rows:
        if row["target_kind"] == "custom":
            continue
        targets_by_kind.setdefault(row["target_kind"], []).append(row["target_id"])

    summaries: dict[tuple[str, str], dict] = {}
    summary_queries = {
        "tag": """
            SELECT
                t.id::text AS id,
                'tag' AS kind,
                t.tag_no AS code,
                t.name,
                t.status,
                t.attribute_values,
                t.class_id::text AS class_id,
                c.code AS class_code,
                c.name AS class_name,
                p.code AS pbs_node_code,
                p.name AS pbs_node_name
            FROM tag t
            LEFT JOIN class c ON c.id = t.class_id
            LEFT JOIN pbs_node p ON p.id = t.pbs_node_id
            WHERE t.project_id = %s
              AND t.id::text = ANY(%s)
        """,
        "equipment": """
            SELECT
                e.id::text AS id,
                'equipment' AS kind,
                e.equipment_no AS code,
                e.name,
                e.asset_status AS status,
                e.manufacturer,
                e.model,
                e.serial_no,
                COALESCE(e.attribute_values, '{}'::jsonb) AS attribute_values,
                e.class_id::text AS class_id,
                c.code AS class_code,
                c.name AS class_name
            FROM equipment e
            LEFT JOIN class c ON c.id = e.class_id
            WHERE e.project_id = %s
              AND e.id::text = ANY(%s)
        """,
        "document": """
            SELECT
                d.id::text AS id,
                'document' AS kind,
                d.document_no AS code,
                d.title AS name,
                d.status,
                d.attributes AS attribute_values,
                d.class_id::text AS class_id
            FROM document d
            WHERE d.project_id = %s
              AND d.id::text = ANY(%s)
        """,
        "pbs_node": """
            SELECT
                p.id::text AS id,
                'pbs_node' AS kind,
                p.code,
                p.name,
                p.node_type,
                p.status
            FROM pbs_node p
            WHERE p.project_id = %s
              AND p.id::text = ANY(%s)
        """,
    }

    for target_kind, target_ids in targets_by_kind.items():
        if not target_ids:
            continue
        cursor.execute(summary_queries[target_kind], (project_id, sorted(set(target_ids))))
        for summary in cursor.fetchall():
            summary_row = dict(summary)
            summary_row["attribute_values"] = (
                summary_row["attribute_values"] if isinstance(summary_row.get("attribute_values"), dict) else {}
            )
            summaries[(target_kind, summary_row["id"])] = summary_row

    _attach_attribute_items(cursor, project_id, summaries)

    for row in rows:
        row["target_summary"] = summaries.get((row["target_kind"], row["target_id"]))
    return rows


def list_document_visualization_objects(
    project_id: str,
    document_id: str,
    revision_id: str,
    visualization_id: str,
) -> list[dict]:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            _ensure_visualization(cursor, project_id, document_id, revision_id, visualization_id)
            rows = _list_objects(cursor, project_id, document_id, revision_id, visualization_id)
            return _attach_target_summaries(cursor, project_id, rows)


def create_document_visualization_object(
    project_id: str,
    document_id: str,
    revision_id: str,
    visualization_id: str,
    payload: dict,
) -> dict:
    normalized = _normalize_payload(payload)
    _validate_resolver_payload(normalized)

    with get_connection() as connection:
        with connection.cursor() as cursor:
            _ensure_visualization(cursor, project_id, document_id, revision_id, visualization_id)
            _ensure_target_exists(cursor, project_id, normalized["target_kind"], normalized["target_id"])
            cursor.execute(
                """
                INSERT INTO document_visualization_object (
                    visualization_id,
                    target_kind,
                    target_id,
                    label,
                    resolver_type,
                    coordinate_space,
                    anchor_position,
                    primitive,
                    geometry_asset_id,
                    priority,
                    visible,
                    selectable,
                    highlightable,
                    metadata
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    visualization_id,
                    normalized["target_kind"],
                    normalized["target_id"],
                    normalized["label"],
                    normalized["resolver_type"],
                    normalized["coordinate_space"],
                    normalized["anchor_position"],
                    Json(normalized["primitive"]),
                    normalized["geometry_asset_id"],
                    normalized["priority"],
                    normalized["visible"],
                    normalized["selectable"],
                    normalized["highlightable"],
                    Json(normalized["metadata"]),
                ),
            )
            object_id = str(cursor.fetchone()["id"])
        connection.commit()

    with get_connection() as connection:
        with connection.cursor() as cursor:
            row = _fetch_object(cursor, project_id, document_id, revision_id, visualization_id, object_id)
            if row is None:
                raise ValueError("Visualization object not found")
            return _attach_target_summaries(cursor, project_id, [row])[0]


def update_document_visualization_object(
    project_id: str,
    document_id: str,
    revision_id: str,
    visualization_id: str,
    object_id: str,
    payload: dict,
) -> dict | None:
    normalized_patch = _normalize_payload(payload, partial=True)

    with get_connection() as connection:
        with connection.cursor() as cursor:
            existing = _fetch_object(cursor, project_id, document_id, revision_id, visualization_id, object_id)
            if existing is None:
                return None
            merged = {**existing, **normalized_patch}
            _validate_resolver_payload(merged)
            if "target_kind" in normalized_patch or "target_id" in normalized_patch:
                _ensure_target_exists(cursor, project_id, merged["target_kind"], merged["target_id"])

            cursor.execute(
                """
                UPDATE document_visualization_object
                SET
                    target_kind = %s,
                    target_id = %s,
                    label = %s,
                    resolver_type = %s,
                    coordinate_space = %s,
                    anchor_position = %s,
                    primitive = %s,
                    geometry_asset_id = %s,
                    priority = %s,
                    visible = %s,
                    selectable = %s,
                    highlightable = %s,
                    metadata = %s
                WHERE id = %s
                """,
                (
                    merged["target_kind"],
                    merged["target_id"],
                    merged["label"],
                    merged["resolver_type"],
                    merged["coordinate_space"],
                    merged.get("anchor_position"),
                    Json(merged.get("primitive", {})),
                    merged.get("geometry_asset_id"),
                    merged["priority"],
                    merged["visible"],
                    merged["selectable"],
                    merged["highlightable"],
                    Json(merged.get("metadata", {})),
                    object_id,
                ),
            )
        connection.commit()

    with get_connection() as connection:
        with connection.cursor() as cursor:
            row = _fetch_object(cursor, project_id, document_id, revision_id, visualization_id, object_id)
            return _attach_target_summaries(cursor, project_id, [row])[0] if row else None


def delete_document_visualization_object(
    project_id: str,
    document_id: str,
    revision_id: str,
    visualization_id: str,
    object_id: str,
) -> dict | None:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            existing = _fetch_object(cursor, project_id, document_id, revision_id, visualization_id, object_id)
            if existing is None:
                return None
            existing = _attach_target_summaries(cursor, project_id, [existing])[0]
            cursor.execute("DELETE FROM document_visualization_object WHERE id = %s", (object_id,))
        connection.commit()
        return existing
