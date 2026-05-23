from __future__ import annotations

from datetime import date
from typing import Any

from psycopg.types.json import Json

from .db import fetch_all, get_connection


ASSET_STATUSES = {"planned", "ordered", "in_service", "spare", "removed", "scrapped", "archived"}
ASSIGNMENT_STATUSES = {"active", "archived"}
TAG_EQUIPMENT_CLASS_RELATIONSHIP = "tag_equipment_class"
LEGACY_ATTRIBUTE_ALIASES = {
    "manufacturer": (
        "manufacturer",
        "manufacturer_company_name",
        "manufacturer company name",
        "CFIHOS-10000158",
    ),
    "model": (
        "model",
        "model_part_name",
        "model part name",
        "CFIHOS-10000159",
    ),
    "serial_no": (
        "serial_no",
        "equipment_manufacturer_serial_number",
        "equipment manufacturer serial number",
        "CFIHOS-10000163",
    ),
    "purchase_order_no": (
        "purchase_order_no",
        "purchase_order_number",
        "purchase order number",
        "CFIHOS-10000128",
    ),
}


def _normalize_text(value: object | None) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _require_text(value: object | None, field_name: str) -> str:
    text = _normalize_text(value)
    if text is None:
        raise ValueError(f"{field_name} is required")
    return text


def _attribute_values(payload: dict) -> dict:
    values = payload.get("attribute_values")
    return values if isinstance(values, dict) else {}


def _lookup_attribute_text(attribute_values: dict, aliases: tuple[str, ...]) -> str | None:
    normalized_aliases = {alias.lower() for alias in aliases}
    for key, value in attribute_values.items():
        if str(key).lower() in normalized_aliases:
            text = _normalize_text(value)
            if text is not None:
                return text
    return None


def _legacy_text(payload: dict, field_name: str) -> str | None:
    direct = _normalize_text(payload.get(field_name))
    if direct is not None:
        return direct
    return _lookup_attribute_text(_attribute_values(payload), LEGACY_ATTRIBUTE_ALIASES[field_name])


def _ensure_project_exists(cursor, project_id: str) -> dict:
    cursor.execute(
        """
        SELECT id, reference_attributes
        FROM project
        WHERE id = %s
        """,
        (project_id,),
    )
    project = cursor.fetchone()
    if project is None:
        raise ValueError("Project not found")
    return project


def _project_standard_id(project: dict) -> str | None:
    reference_attributes = project.get("reference_attributes") or {}
    standard_id = reference_attributes.get("standard_id")
    return str(standard_id) if standard_id else None


def _ensure_tag_belongs_to_project(cursor, project_id: str, tag_id: str) -> dict:
    cursor.execute(
        """
        SELECT
            t.id,
            t.project_id,
            t.tag_no,
            t.name,
            t.class_id,
            c.code AS class_code,
            c.name AS class_name
        FROM tag t
        LEFT JOIN class c ON c.id = t.class_id
        WHERE t.id = %s
          AND t.project_id = %s
        """,
        (tag_id, project_id),
    )
    tag = cursor.fetchone()
    if tag is None:
        raise ValueError("Tag not found")
    return tag


def _ensure_equipment_belongs_to_project(cursor, project_id: str, equipment_id: str) -> dict:
    cursor.execute(
        """
        SELECT
            e.id,
            e.project_id,
            e.equipment_no,
            e.name,
            e.class_id,
            ec.code AS class_code,
            ec.name AS class_name
        FROM equipment e
        LEFT JOIN class ec ON ec.id = e.class_id
            AND ec.applies_to = 'equipment'
        WHERE e.id = %s
          AND e.project_id = %s
        """,
        (equipment_id, project_id),
    )
    equipment = cursor.fetchone()
    if equipment is None:
        raise ValueError("Equipment does not belong to this project")
    return equipment


def _ensure_equipment_class_belongs_to_standard(
    cursor,
    *,
    class_id: str | None,
    standard_id: str | None,
) -> None:
    if class_id is None:
        return
    if standard_id is None:
        raise ValueError("Project must be linked to a standard before selecting an equipment class")

    cursor.execute(
        """
        SELECT id
        FROM class
        WHERE id = %s
          AND standard_id = %s
          AND applies_to = 'equipment'
          AND status <> 'archived'
        """,
        (class_id, standard_id),
    )
    if cursor.fetchone() is None:
        raise ValueError("Equipment class must belong to the project's standard")


def _validate_asset_status(status: object | None) -> str:
    text = _normalize_text(status) or "planned"
    if text not in ASSET_STATUSES:
        raise ValueError(f"Unsupported equipment asset status: {text}")
    return text


def _validate_assignment_status(status: object | None) -> str:
    text = _normalize_text(status) or "active"
    if text not in ASSIGNMENT_STATUSES:
        raise ValueError(f"Unsupported assignment status: {text}")
    return text


def _validate_assignment_dates(installed_from: date | str, installed_to: date | str | None) -> None:
    if installed_to is not None and str(installed_to) < str(installed_from):
        raise ValueError("installed_to cannot be earlier than installed_from")


def _equipment_select_columns() -> str:
    return """
        e.id,
        e.project_id,
        e.equipment_no,
        e.name,
        e.class_id,
        ec.code AS class_code,
        ec.name AS class_name,
        e.manufacturer,
        e.model,
        e.serial_no,
        e.purchase_order_no,
        e.asset_status,
        e.attribute_values,
        e.metadata,
        e.created_at,
        e.updated_at
    """


def _assignment_select_columns() -> str:
    return """
        tea.id,
        tea.tag_id,
        tea.equipment_id,
        tea.installed_from,
        tea.installed_to,
        tea.is_current,
        tea.status,
        tea.notes,
        tea.created_at,
        tea.updated_at,
        e.project_id AS equipment_project_id,
        e.equipment_no,
        e.name AS equipment_name,
        e.class_id,
        ec.code AS class_code,
        ec.name AS class_name,
        e.manufacturer,
        e.model,
        e.serial_no,
        e.purchase_order_no,
        e.asset_status,
        e.attribute_values AS equipment_attribute_values,
        e.metadata AS equipment_metadata,
        e.created_at AS equipment_created_at,
        e.updated_at AS equipment_updated_at
    """


def _equipment_from_assignment(row: dict) -> dict:
    return {
        "id": row["equipment_id"],
        "project_id": row["equipment_project_id"],
        "equipment_no": row["equipment_no"],
        "name": row["equipment_name"],
        "class_id": row["class_id"],
        "class_code": row["class_code"],
        "class_name": row["class_name"],
        "manufacturer": row["manufacturer"],
        "model": row["model"],
        "serial_no": row["serial_no"],
        "purchase_order_no": row["purchase_order_no"],
        "asset_status": row["asset_status"],
        "attribute_values": row["equipment_attribute_values"],
        "metadata": row["equipment_metadata"],
        "created_at": row["equipment_created_at"],
        "updated_at": row["equipment_updated_at"],
    }


def _assignment_from_row(row: dict) -> dict:
    return {
        "id": row["id"],
        "tag_id": row["tag_id"],
        "equipment_id": row["equipment_id"],
        "installed_from": row["installed_from"],
        "installed_to": row["installed_to"],
        "is_current": row["is_current"],
        "status": row["status"],
        "notes": row["notes"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "equipment": _equipment_from_assignment(row),
    }


def _equipment_attribute_definition_columns() -> str:
    return """
        ad.id,
        ad.class_id,
        ad.standard_id,
        ad.group_name,
        ad.code,
        ad.name,
        ad.value_type,
        ad.is_required,
        ad.unit_family,
        ad.enum_options,
        ad.description,
        ad.sort_order,
        ad.status,
        ad.metadata,
        ad.applies_to,
        ad.created_at,
        ad.updated_at
    """


def _list_equipment_attribute_definitions(
    cursor,
    *,
    standard_id: str | None,
    equipment_class_id: str | None,
) -> dict:
    if standard_id is None:
        return {"common_attributes": [], "class_attributes": []}

    cursor.execute(
        f"""
        SELECT
            {_equipment_attribute_definition_columns()}
        FROM attribute_definition ad
        WHERE ad.standard_id = %s
          AND ad.applies_to IN ('equipment', 'both')
          AND ad.status <> 'archived'
        ORDER BY ad.sort_order, ad.name, ad.code
        """,
        (standard_id,),
    )
    common_attributes = list(cursor.fetchall())

    if equipment_class_id is None:
        return {"common_attributes": common_attributes, "class_attributes": []}

    cursor.execute(
        f"""
        SELECT
            {_equipment_attribute_definition_columns()}
        FROM attribute_definition ad
        WHERE ad.class_id = %s
          AND ad.applies_to IN ('equipment', 'both')
          AND ad.status <> 'archived'
        ORDER BY ad.sort_order, ad.name, ad.code
        """,
        (equipment_class_id,),
    )
    return {
        "common_attributes": common_attributes,
        "class_attributes": list(cursor.fetchall()),
    }


def list_project_equipment_classes(project_id: str, tag_id: str | None = None) -> list[dict]:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            project = _ensure_project_exists(cursor, project_id)
            standard_id = _project_standard_id(project)
            if standard_id is None:
                return []

            tag_class_id: str | None = None
            if tag_id:
                tag = _ensure_tag_belongs_to_project(cursor, project_id, tag_id)
                tag_class_id = tag.get("class_id")

            return _list_compatible_equipment_classes(cursor, standard_id=standard_id, tag_class_id=tag_class_id)


def _list_compatible_equipment_classes(cursor, *, standard_id: str, tag_class_id: str | None) -> list[dict]:
    if tag_class_id:
        cursor.execute(
            """
            SELECT
                ec.id,
                ec.standard_id,
                ec.code,
                ec.name,
                ec.parent_id,
                ec.level_no,
                ec.description,
                ec.status,
                ec.metadata,
                cr.reason,
                true AS is_mapped
            FROM class_relationship cr
            JOIN class ec ON ec.id = cr.target_class_id
            WHERE cr.source_class_id = %s
              AND cr.standard_id = %s
              AND cr.relationship_type = %s
              AND cr.status <> 'archived'
              AND ec.applies_to = 'equipment'
              AND ec.status <> 'archived'
            ORDER BY ec.level_no, ec.name, ec.code
            """,
            (tag_class_id, standard_id, TAG_EQUIPMENT_CLASS_RELATIONSHIP),
        )
        mapped = list(cursor.fetchall())
        if mapped:
            return mapped

    cursor.execute(
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
            metadata,
            NULL::text AS reason,
            false AS is_mapped
        FROM class
        WHERE standard_id = %s
          AND applies_to = 'equipment'
          AND status <> 'archived'
        ORDER BY level_no, name, code
        """,
        (standard_id,),
    )
    return list(cursor.fetchall())


def list_project_equipment(project_id: str, filters: dict | None = None) -> list[dict]:
    filters = filters or {}
    where_clauses = ["e.project_id = %s"]
    params: list[Any] = [project_id]

    keyword = _normalize_text(filters.get("keyword"))
    if keyword:
        pattern = f"%{keyword.lower()}%"
        where_clauses.append(
            """
            (
                lower(e.equipment_no) LIKE %s
                OR lower(e.name) LIKE %s
                OR lower(COALESCE(e.manufacturer, '')) LIKE %s
                OR lower(COALESCE(e.model, '')) LIKE %s
                OR lower(COALESCE(e.serial_no, '')) LIKE %s
            )
            """
        )
        params.extend([pattern, pattern, pattern, pattern, pattern])

    class_id = _normalize_text(filters.get("class_id"))
    if class_id:
        where_clauses.append("e.class_id = %s")
        params.append(class_id)

    asset_status = _normalize_text(filters.get("asset_status"))
    if asset_status:
        where_clauses.append("e.asset_status = %s")
        params.append(_validate_asset_status(asset_status))

    where_sql = " AND ".join(where_clauses)
    return fetch_all(
        f"""
        SELECT
            {_equipment_select_columns()}
        FROM equipment e
        LEFT JOIN class ec ON ec.id = e.class_id
            AND ec.applies_to = 'equipment'
        WHERE {where_sql}
        ORDER BY e.created_at DESC, e.equipment_no
        """,
        tuple(params),
    )


def create_project_equipment(project_id: str, payload: dict) -> dict:
    equipment_no = _require_text(payload.get("equipment_no"), "equipment_no")
    name = _require_text(payload.get("name"), "name")
    class_id = _normalize_text(payload.get("class_id"))
    asset_status = _validate_asset_status(payload.get("asset_status"))

    with get_connection() as connection:
        with connection.cursor() as cursor:
            project = _ensure_project_exists(cursor, project_id)
            _ensure_equipment_class_belongs_to_standard(
                cursor,
                class_id=class_id,
                standard_id=_project_standard_id(project),
            )
            cursor.execute(
                """
                INSERT INTO equipment (
                    project_id,
                    equipment_no,
                    name,
                    class_id,
                    manufacturer,
                    model,
                    serial_no,
                    purchase_order_no,
                    asset_status,
                    attribute_values,
                    metadata
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING
                    id,
                    project_id,
                    equipment_no,
                    name,
                    class_id,
                    manufacturer,
                    model,
                    serial_no,
                    purchase_order_no,
                    asset_status,
                    attribute_values,
                    metadata,
                    created_at,
                    updated_at
                """,
                (
                    project_id,
                    equipment_no,
                    name,
                    class_id,
                    _legacy_text(payload, "manufacturer"),
                    _legacy_text(payload, "model"),
                    _legacy_text(payload, "serial_no"),
                    _legacy_text(payload, "purchase_order_no"),
                    asset_status,
                    Json(_attribute_values(payload)),
                    Json(payload.get("metadata") or {}),
                ),
            )
            equipment = cursor.fetchone()
        connection.commit()

    return equipment


def get_tag_equipment_implementation(project_id: str, tag_id: str) -> dict | None:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            project = _ensure_project_exists(cursor, project_id)
            try:
                tag = _ensure_tag_belongs_to_project(cursor, project_id, tag_id)
            except ValueError as error:
                if str(error) == "Tag not found":
                    return None
                raise

            standard_id = _project_standard_id(project)
            compatible_classes = (
                _list_compatible_equipment_classes(cursor, standard_id=standard_id, tag_class_id=tag.get("class_id"))
                if standard_id
                else []
            )

            cursor.execute(
                f"""
                SELECT
                    {_assignment_select_columns()}
                FROM tag_equipment_assignment tea
                JOIN equipment e ON e.id = tea.equipment_id
                LEFT JOIN class ec ON ec.id = e.class_id
                    AND ec.applies_to = 'equipment'
                WHERE tea.tag_id = %s
                  AND tea.is_current
                  AND tea.status <> 'archived'
                ORDER BY tea.installed_from DESC
                LIMIT 1
                """,
                (tag_id,),
            )
            current_row = cursor.fetchone()
            current_assignment = _assignment_from_row(current_row) if current_row else None
            equipment_class_id = (
                current_assignment.get("equipment", {}).get("class_id")
                if current_assignment
                else None
            )
            equipment_attribute_definitions = _list_equipment_attribute_definitions(
                cursor,
                standard_id=standard_id,
                equipment_class_id=equipment_class_id,
            )

            cursor.execute(
                f"""
                SELECT
                    {_assignment_select_columns()}
                FROM tag_equipment_assignment tea
                JOIN equipment e ON e.id = tea.equipment_id
                LEFT JOIN class ec ON ec.id = e.class_id
                    AND ec.applies_to = 'equipment'
                WHERE tea.tag_id = %s
                ORDER BY tea.is_current DESC, tea.installed_from DESC, tea.created_at DESC
                """,
                (tag_id,),
            )
            history = [_assignment_from_row(row) for row in cursor.fetchall()]

    return {
        "tag_id": tag_id,
        "tag_class": (
            {"id": tag["class_id"], "code": tag["class_code"], "name": tag["class_name"]}
            if tag.get("class_id")
            else None
        ),
        "compatible_equipment_classes": compatible_classes,
        "equipment_common_attributes": equipment_attribute_definitions["common_attributes"],
        "equipment_class_attributes": equipment_attribute_definitions["class_attributes"],
        "current_assignment": current_assignment,
        "assignment_history": history,
    }


def assign_equipment_to_tag(project_id: str, tag_id: str, payload: dict) -> dict:
    equipment_id = _require_text(payload.get("equipment_id"), "equipment_id")
    installed_from = payload.get("installed_from")
    if installed_from is None:
        raise ValueError("installed_from is required")
    installed_to = payload.get("installed_to")
    _validate_assignment_dates(installed_from, installed_to)
    status = _validate_assignment_status(payload.get("status"))
    is_current = bool(payload.get("is_current", True))

    with get_connection() as connection:
        with connection.cursor() as cursor:
            _ensure_project_exists(cursor, project_id)
            _ensure_tag_belongs_to_project(cursor, project_id, tag_id)
            _ensure_equipment_belongs_to_project(cursor, project_id, equipment_id)

            if is_current:
                cursor.execute(
                    """
                    SELECT id, tag_id
                    FROM tag_equipment_assignment
                    WHERE equipment_id = %s
                      AND is_current
                      AND status <> 'archived'
                    """,
                    (equipment_id,),
                )
                current_equipment_assignment = cursor.fetchone()
                if current_equipment_assignment and str(current_equipment_assignment["tag_id"]) != tag_id:
                    raise ValueError("Equipment already has a current tag assignment")

                cursor.execute(
                    """
                    UPDATE tag_equipment_assignment
                    SET
                        is_current = false,
                        installed_to = COALESCE(installed_to, %s),
                        updated_at = now()
                    WHERE tag_id = %s
                      AND is_current
                      AND status <> 'archived'
                    """,
                    (installed_from, tag_id),
                )

            cursor.execute(
                """
                INSERT INTO tag_equipment_assignment (
                    tag_id,
                    equipment_id,
                    installed_from,
                    installed_to,
                    is_current,
                    status,
                    notes
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING *
                """,
                (
                    tag_id,
                    equipment_id,
                    installed_from,
                    installed_to,
                    is_current,
                    status,
                    _normalize_text(payload.get("notes")),
                ),
            )
            assignment = cursor.fetchone()
        connection.commit()

    return assignment
