from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime
from math import isfinite
from pathlib import Path
from typing import Any

import psycopg

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("PGCONNECT_TIMEOUT", "5")
os.environ.setdefault("PGOPTIONS", "-c statement_timeout=30000")

from app.db import fetch_all  # noqa: E402


TAG_BUILTIN_ATTRIBUTE_CODES = {
    "tag_no",
    "name",
    "class",
    "class_id",
    "pbs",
    "pbs_node_id",
}
TAG_ATTRIBUTE_RULES = {
    "unknown_tag_attribute",
    "invalid_tag_attribute_value",
    "missing_required_tag_attribute",
    "missing_optional_tag_attribute",
}
MISSING_EQUIPMENT_IMPLEMENTATION_RULES = {
    "missing_equipment_implementation",
}
EQUIPMENT_ATTRIBUTE_RULES = {
    "unknown_equipment_attribute",
    "invalid_equipment_attribute_value",
    "missing_required_equipment_attribute",
    "missing_optional_equipment_attribute",
}
EQUIPMENT_STANDARD_RULES = {
    *EQUIPMENT_ATTRIBUTE_RULES,
    "missing_equipment_class",
    "invalid_equipment_class_domain",
    "equipment_class_not_allowed_for_tag_class",
}


@dataclass(frozen=True)
class AttributeDefinition:
    id: str
    class_id: str | None
    code: str
    name: str
    value_type: str
    is_required: bool
    enum_options: tuple[str, ...]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Check project tags, equipment implementations, and attribute values "
            "against the bound standard definitions."
        )
    )
    parser.add_argument("--project-id", help="Limit the check to one project id.")
    parser.add_argument("--limit", type=int, default=20, help="Sample issue rows to print. Defaults to 20.")
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON.")
    parser.add_argument("--export-dir", help="Write full CSV/JSON audit artifacts into this directory.")
    parser.add_argument(
        "--include-optional-missing",
        action="store_true",
        help="Also report optional standard attributes that are absent from asset attribute_values.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        audit = collect_audit(project_id=args.project_id, include_optional_missing=args.include_optional_missing)
    except psycopg.Error as error:
        print(f"Database query failed: {error}", file=sys.stderr)
        return 2

    summary = audit["summary"]
    tag_problem_rows = audit["tag_problem_rows"]
    equipment_problem_rows = audit["equipment_problem_rows"]
    implementation_history = audit["implementation_history"]
    if args.export_dir:
        _export_reports(
            Path(args.export_dir),
            summary=summary,
            tag_problem_rows=tag_problem_rows,
            equipment_problem_rows=equipment_problem_rows,
            implementation_history=implementation_history,
        )

    if args.json:
        print(
            json.dumps(
                {
                    "summary": summary,
                    "tag_issue_samples": tag_problem_rows[: args.limit],
                    "equipment_issue_samples": equipment_problem_rows[: args.limit],
                    "implementation_history_samples": implementation_history[: args.limit],
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0

    _print_text_report(
        summary,
        tag_problem_rows[: args.limit],
        equipment_problem_rows[: args.limit],
        implementation_history[: args.limit],
    )
    return 0


def collect_audit(*, project_id: str | None = None, include_optional_missing: bool = False) -> dict:
    scope_counts = _load_scope_counts(project_id=project_id)
    tag_rows = _load_active_tags(project_id=project_id)
    equipment_rows = _load_active_equipment(project_id=project_id)
    tag_definitions = _load_attribute_definitions(
        _standard_ids(tag_rows),
        _class_ids(tag_rows),
        applies_to=("tag", "both"),
    )
    equipment_definitions = _load_attribute_definitions(
        _standard_ids(equipment_rows),
        _class_ids(equipment_rows),
        applies_to=("equipment", "both"),
    )
    implementation_history = _load_implementation_history(project_id=project_id)

    issues_by_tag_id = {
        str(row["tag_id"]): _tag_issues(row, tag_definitions, include_optional_missing=include_optional_missing)
        for row in tag_rows
    }
    tag_problem_rows = [
        _problem_row(row, issues_by_tag_id[str(row["tag_id"])])
        for row in tag_rows
        if issues_by_tag_id[str(row["tag_id"])]
    ]
    issues_by_equipment_id = {
        str(row["equipment_id"]): _equipment_issues(
            row,
            equipment_definitions,
            include_optional_missing=include_optional_missing,
        )
        for row in equipment_rows
    }
    equipment_problem_rows = [
        _equipment_problem_row(row, issues_by_equipment_id[str(row["equipment_id"])])
        for row in equipment_rows
        if issues_by_equipment_id[str(row["equipment_id"])]
    ]
    return {
        "summary": _summary(
            scope_counts,
            tag_rows,
            tag_problem_rows,
            equipment_rows,
            equipment_problem_rows,
            implementation_history,
        ),
        "tag_rows": tag_rows,
        "tag_problem_rows": tag_problem_rows,
        "equipment_rows": equipment_rows,
        "equipment_problem_rows": equipment_problem_rows,
        "implementation_history": implementation_history,
    }


def tag_attribute_problem_rows(audit: dict) -> list[dict]:
    return _filter_problem_rows(audit["tag_problem_rows"], TAG_ATTRIBUTE_RULES)


def tags_without_equipment_rows(audit: dict) -> list[dict]:
    return _filter_problem_rows(audit["tag_problem_rows"], MISSING_EQUIPMENT_IMPLEMENTATION_RULES)


def tag_equipment_standard_problem_rows(audit: dict) -> list[dict]:
    equipment_issues_by_id = {
        str(row["equipment_id"]): [
            issue for issue in row["issues"] if issue["rule"] in EQUIPMENT_STANDARD_RULES
        ]
        for row in audit["equipment_problem_rows"]
    }
    problem_rows: list[dict] = []
    for row in audit["tag_rows"]:
        if not row.get("has_current_equipment_implementation"):
            continue
        issues: list[dict] = []
        if not row.get("is_allowed_equipment_class"):
            issues.append(
                {
                    "rule": "equipment_class_not_allowed_for_tag_class",
                    "field": "equipment_class",
                    "current_value": _format_value(row.get("equipment_class_code")),
                    "expected_value": "当前设备 class 必须存在 active tag_equipment_class 标准关系",
                }
            )
        issues.extend(equipment_issues_by_id.get(str(row.get("equipment_id")), []))
        if issues:
            problem_rows.append(_problem_row(row, issues))
    return problem_rows


def _filter_problem_rows(rows: list[dict], rules: set[str]) -> list[dict]:
    filtered_rows: list[dict] = []
    for row in rows:
        matching_issues = [issue for issue in row["issues"] if issue["rule"] in rules]
        if matching_issues:
            filtered_rows.append(_replace_row_issues(row, matching_issues))
    return filtered_rows


def _replace_row_issues(row: dict, issues: list[dict]) -> dict:
    issue_counts = Counter(issue["rule"] for issue in issues)
    return {
        **row,
        "issue_count": len(issues),
        "issue_counts": dict(sorted(issue_counts.items())),
        "issues": issues,
    }


def _load_active_tags(*, project_id: str | None) -> list[dict]:
    where_clauses = ["t.status <> 'archived'"]
    params: list[Any] = []
    if project_id:
        where_clauses.append("t.project_id = %s")
        params.append(project_id)
    where_sql = " AND ".join(where_clauses)

    return fetch_all(
        f"""
        SELECT
            t.id::text AS tag_id,
            t.project_id::text AS project_id,
            p.code AS project_code,
            p.name AS project_name,
            p.reference_attributes ->> 'standard_id' AS standard_id,
            t.tag_no,
            t.name,
            t.class_id::text AS class_id,
            c.code AS class_code,
            c.name AS class_name,
            COALESCE(t.attribute_values, '{{}}'::jsonb) AS attribute_values,
            (current_equipment.assignment_id IS NOT NULL) AS has_current_equipment_implementation,
            current_equipment.equipment_id,
            current_equipment.equipment_no,
            current_equipment.equipment_class_id,
            current_equipment.equipment_class_code,
            current_equipment.equipment_class_name,
            current_equipment.is_allowed_equipment_class
        FROM tag t
        JOIN project p ON p.id = t.project_id
        LEFT JOIN class c ON c.id = t.class_id
        LEFT JOIN LATERAL (
            SELECT
                tea.id::text AS assignment_id,
                e.id::text AS equipment_id,
                e.equipment_no,
                e.class_id::text AS equipment_class_id,
                ec.code AS equipment_class_code,
                ec.name AS equipment_class_name,
                EXISTS (
                    SELECT 1
                    FROM class_relationship cr
                    WHERE cr.standard_id = (p.reference_attributes ->> 'standard_id')::uuid
                      AND cr.source_class_id = t.class_id
                      AND cr.target_class_id = e.class_id
                      AND cr.relationship_type = 'tag_equipment_class'
                      AND cr.status <> 'archived'
                ) AS is_allowed_equipment_class
            FROM tag_equipment_assignment tea
            JOIN equipment e ON e.id = tea.equipment_id
                AND e.asset_status <> 'archived'
            LEFT JOIN class ec ON ec.id = e.class_id
            WHERE tea.tag_id = t.id
              AND tea.is_current = true
              AND tea.status <> 'archived'
            ORDER BY tea.created_at DESC
            LIMIT 1
        ) current_equipment ON true
        WHERE {where_sql}
        ORDER BY p.code, t.tag_no, t.name
        """,
        tuple(params),
    )


def _load_active_equipment(*, project_id: str | None) -> list[dict]:
    where_clauses = ["e.asset_status <> 'archived'"]
    params: list[Any] = []
    if project_id:
        where_clauses.append("e.project_id = %s")
        params.append(project_id)
    where_sql = " AND ".join(where_clauses)

    return fetch_all(
        f"""
        SELECT
            e.id::text AS equipment_id,
            e.project_id::text AS project_id,
            p.code AS project_code,
            p.name AS project_name,
            p.reference_attributes ->> 'standard_id' AS standard_id,
            e.equipment_no,
            e.name,
            e.class_id::text AS class_id,
            c.code AS class_code,
            c.name AS class_name,
            c.applies_to AS class_applies_to,
            e.asset_status,
            COALESCE(e.attribute_values, '{{}}'::jsonb) AS attribute_values,
            COALESCE(assignments.assignment_count, 0)::int AS assignment_count,
            COALESCE(assignments.current_assignment_count, 0)::int AS current_assignment_count
        FROM equipment e
        JOIN project p ON p.id = e.project_id
        LEFT JOIN class c ON c.id = e.class_id
        LEFT JOIN LATERAL (
            SELECT
                COUNT(*) AS assignment_count,
                COUNT(*) FILTER (WHERE tea.is_current = true) AS current_assignment_count
            FROM tag_equipment_assignment tea
            WHERE tea.equipment_id = e.id
              AND tea.status <> 'archived'
        ) assignments ON true
        WHERE {where_sql}
        ORDER BY p.code, e.equipment_no, e.name
        """,
        tuple(params),
    )


def _load_implementation_history(*, project_id: str | None) -> list[dict]:
    where_clauses = ["tea.status <> 'archived'", "t.status <> 'archived'", "e.asset_status <> 'archived'"]
    params: list[Any] = []
    if project_id:
        where_clauses.append("t.project_id = %s")
        params.append(project_id)
    where_sql = " AND ".join(where_clauses)

    return fetch_all(
        f"""
        SELECT
            t.project_id::text AS project_id,
            p.code AS project_code,
            t.id::text AS tag_id,
            t.tag_no,
            e.id::text AS equipment_id,
            e.equipment_no,
            ec.code AS equipment_class_code,
            tea.installed_from::text AS installed_from,
            tea.installed_to::text AS installed_to,
            tea.is_current,
            tea.notes,
            COUNT(*) OVER (PARTITION BY t.id)::int AS tag_implementation_count
        FROM tag_equipment_assignment tea
        JOIN tag t ON t.id = tea.tag_id
        JOIN project p ON p.id = t.project_id
        JOIN equipment e ON e.id = tea.equipment_id
        LEFT JOIN class ec ON ec.id = e.class_id
        WHERE {where_sql}
        ORDER BY p.code, t.tag_no, tea.installed_from, e.equipment_no
        """,
        tuple(params),
    )


def _load_scope_counts(*, project_id: str | None) -> dict:
    where_clauses = ["t.status <> 'archived'"]
    params: list[Any] = []
    if project_id:
        where_clauses.append("t.project_id = %s")
        params.append(project_id)
    where_sql = " AND ".join(where_clauses)

    rows = fetch_all(
        f"""
        SELECT
            COUNT(DISTINCT t.project_id)::int AS project_count,
            COUNT(*)::int AS active_tag_count,
            COUNT(*) FILTER (WHERE tea.id IS NOT NULL)::int AS current_equipment_implementation_count
        FROM tag t
        LEFT JOIN tag_equipment_assignment tea ON tea.tag_id = t.id
            AND tea.is_current = true
            AND tea.status <> 'archived'
        WHERE {where_sql}
        """,
        tuple(params),
    )
    return rows[0] if rows else {}


def _load_attribute_definitions(
    standard_ids: list[str],
    class_ids: list[str],
    *,
    applies_to: tuple[str, ...],
) -> dict[str, dict[str, list[AttributeDefinition]]]:
    if not standard_ids and not class_ids:
        return {"by_standard_id": {}, "by_class_id": {}}

    rows = [
        *_load_standard_attribute_definitions(standard_ids, applies_to=applies_to),
        *_load_class_attribute_definitions(class_ids, applies_to=applies_to),
    ]

    by_standard_id: dict[str, list[AttributeDefinition]] = defaultdict(list)
    by_class_id: dict[str, list[AttributeDefinition]] = defaultdict(list)
    for row in rows:
        definition = AttributeDefinition(
            id=str(row["id"]),
            class_id=str(row["class_id"]) if row.get("class_id") else None,
            code=str(row["code"]),
            name=str(row["name"]),
            value_type=str(row["value_type"] or "string"),
            is_required=bool(row["is_required"]),
            enum_options=tuple(str(option) for option in row["enum_options"] or []),
        )
        if row.get("standard_id"):
            by_standard_id[str(row["standard_id"])].append(definition)
        if row.get("class_id"):
            by_class_id[str(row["class_id"])].append(definition)

    return {
        "by_standard_id": dict(by_standard_id),
        "by_class_id": dict(by_class_id),
    }


def _load_standard_attribute_definitions(standard_ids: list[str], *, applies_to: tuple[str, ...]) -> list[dict]:
    if not standard_ids:
        return []
    return fetch_all(
        """
        SELECT
            ad.id::text AS id,
            ad.standard_id::text AS standard_id,
            ad.class_id::text AS class_id,
            ad.code,
            ad.name,
            ad.value_type,
            ad.is_required,
            ad.enum_options
        FROM attribute_definition ad
        WHERE ad.standard_id = ANY(%s::uuid[])
          AND ad.status <> 'archived'
          AND ad.applies_to = ANY(%s)
        ORDER BY ad.sort_order, ad.code
        """,
        (standard_ids, list(applies_to)),
    )


def _load_class_attribute_definitions(class_ids: list[str], *, applies_to: tuple[str, ...]) -> list[dict]:
    if not class_ids:
        return []
    return fetch_all(
        """
        SELECT
            ad.id::text AS id,
            ad.standard_id::text AS standard_id,
            ad.class_id::text AS class_id,
            ad.code,
            ad.name,
            ad.value_type,
            ad.is_required,
            ad.enum_options
        FROM attribute_definition ad
        WHERE ad.class_id = ANY(%s::uuid[])
          AND ad.status <> 'archived'
          AND ad.applies_to = ANY(%s)
        ORDER BY ad.sort_order, ad.code
        """,
        (class_ids, list(applies_to)),
    )


def _tag_issues(
    row: dict,
    definitions: dict[str, dict[str, list[AttributeDefinition]]],
    *,
    include_optional_missing: bool = False,
) -> list[dict]:
    issues: list[dict] = []
    if not row.get("has_current_equipment_implementation"):
        issues.append(
            {
                "rule": "missing_equipment_implementation",
                "field": "equipment_implementation",
                "current_value": "-",
                "expected_value": "必须存在当前 active equipment implementation",
            }
        )
    elif not row.get("is_allowed_equipment_class"):
        issues.append(
            {
                "rule": "equipment_class_not_allowed_for_tag_class",
                "field": "equipment_class",
                "current_value": _format_value(row.get("equipment_class_code")),
                "expected_value": "当前设备 class 必须存在 active tag_equipment_class 标准关系",
            }
        )
    return [
        *issues,
        *_asset_attribute_issues(
            row,
            definitions,
            domain="tag",
            builtins=TAG_BUILTIN_ATTRIBUTE_CODES,
            include_optional_missing=include_optional_missing,
        ),
    ]


def _equipment_issues(
    row: dict,
    definitions: dict[str, dict[str, list[AttributeDefinition]]],
    *,
    include_optional_missing: bool = False,
) -> list[dict]:
    issues: list[dict] = []
    if not _text(row.get("class_id")):
        issues.append(
            {
                "rule": "missing_equipment_class",
                "field": "class_id",
                "current_value": "-",
                "expected_value": "设备必须绑定 equipment class",
            }
        )
    elif row.get("class_applies_to") not in {"equipment", "both"}:
        issues.append(
            {
                "rule": "invalid_equipment_class_domain",
                "field": "class_applies_to",
                "current_value": _format_value(row.get("class_applies_to")),
                "expected_value": "equipment 或 both",
            }
        )
    if row.get("asset_status") in {"planned", "ordered", "in_service"} and int(row.get("current_assignment_count") or 0) == 0:
        issues.append(
            {
                "rule": "equipment_without_current_tag_implementation",
                "field": "tag_equipment_assignment",
                "current_value": "0",
                "expected_value": "设备应被当前 active tag implementation 记录引用",
            }
        )
    return [
        *issues,
        *_asset_attribute_issues(
            row,
            definitions,
            domain="equipment",
            builtins=set(),
            include_optional_missing=include_optional_missing,
        ),
    ]


def _asset_attribute_issues(
    row: dict,
    definitions: dict[str, dict[str, list[AttributeDefinition]]],
    *,
    domain: str,
    builtins: set[str],
    include_optional_missing: bool = False,
) -> list[dict]:
    standard_id = _text(row.get("standard_id"))
    class_id = _text(row.get("class_id"))
    attribute_values = row.get("attribute_values") if isinstance(row.get("attribute_values"), dict) else {}
    standard_definitions = definitions["by_standard_id"].get(standard_id or "", [])
    class_definitions = definitions["by_class_id"].get(class_id or "", [])
    definitions_by_code = {
        definition.code: definition
        for definition in [*standard_definitions, *class_definitions]
        if definition.code
    }
    issues: list[dict] = []

    for code, value in attribute_values.items():
        normalized_code = str(code).strip()
        if normalized_code in builtins:
            continue
        definition = definitions_by_code.get(normalized_code)
        if definition is None:
            issues.append(
                {
                    "rule": f"unknown_{domain}_attribute",
                    "field": normalized_code,
                    "current_value": _format_value(value),
                    "expected_value": f"标准中不存在该 {domain} 属性码",
                }
            )
            continue
        validation_error = _validate_attribute_value(definition, value)
        if validation_error is not None:
            issues.append(
                {
                    "rule": f"invalid_{domain}_attribute_value",
                    "field": normalized_code,
                    "current_value": _format_value(value),
                    "expected_value": validation_error,
                    "attribute_name": definition.name,
                    "value_type": definition.value_type,
                    "is_required": definition.is_required,
                    "enum_options": list(definition.enum_options),
                }
            )

    for definition in definitions_by_code.values():
        if not definition.is_required and not include_optional_missing:
            continue
        value = attribute_values.get(definition.code)
        if _is_missing(value):
            required_label = "required" if definition.is_required else "optional"
            issues.append(
                {
                    "rule": f"missing_{required_label}_{domain}_attribute",
                    "field": definition.code,
                    "current_value": "-",
                    "expected_value": f"标准属性: {definition.name}",
                    "attribute_name": definition.name,
                    "value_type": definition.value_type,
                    "is_required": definition.is_required,
                    "enum_options": list(definition.enum_options),
                }
            )

    return issues


def _validate_attribute_value(definition: AttributeDefinition, value: Any) -> str | None:
    if _is_missing(value):
        return None
    if definition.value_type == "number":
        return None if _is_number(value) else "必须是数字"
    if definition.value_type == "integer":
        return None if _is_integer(value) else "必须是整数"
    if definition.value_type == "boolean":
        return None if isinstance(value, bool) else "必须是布尔值"
    if definition.value_type == "date":
        return None if _is_date(value) else "必须是 ISO 日期"
    if definition.value_type == "enum" and definition.enum_options:
        allowed_values = {str(option) for option in definition.enum_options}
        return None if str(value) in allowed_values else f"必须在枚举范围内: {', '.join(definition.enum_options)}"
    return None


def _problem_row(row: dict, issues: list[dict]) -> dict:
    issue_counts = Counter(issue["rule"] for issue in issues)
    return {
        "project_id": row["project_id"],
        "project_code": row["project_code"],
        "tag_id": row["tag_id"],
        "tag_no": row["tag_no"],
        "tag_name": row["name"],
        "class_code": row["class_code"],
        "class_name": row["class_name"],
        "equipment_no": row.get("equipment_no"),
        "equipment_class_code": row.get("equipment_class_code"),
        "has_current_equipment_implementation": bool(row["has_current_equipment_implementation"]),
        "issue_count": len(issues),
        "issue_counts": dict(sorted(issue_counts.items())),
        "issues": issues,
    }


def _equipment_problem_row(row: dict, issues: list[dict]) -> dict:
    issue_counts = Counter(issue["rule"] for issue in issues)
    return {
        "project_id": row["project_id"],
        "project_code": row["project_code"],
        "equipment_id": row["equipment_id"],
        "equipment_no": row["equipment_no"],
        "equipment_name": row["name"],
        "class_code": row["class_code"],
        "class_name": row["class_name"],
        "asset_status": row.get("asset_status"),
        "assignment_count": int(row.get("assignment_count") or 0),
        "current_assignment_count": int(row.get("current_assignment_count") or 0),
        "issue_count": len(issues),
        "issue_counts": dict(sorted(issue_counts.items())),
        "issues": issues,
    }


def _summary(
    scope_counts: dict,
    tag_rows: list[dict],
    tag_problem_rows: list[dict],
    equipment_rows: list[dict],
    equipment_problem_rows: list[dict],
    implementation_history: list[dict],
) -> dict:
    issue_counts = Counter()
    tag_issue_counts = Counter()
    equipment_issue_counts = Counter()
    for row in tag_problem_rows:
        tag_issue_counts.update(row["issue_counts"])
    for row in equipment_problem_rows:
        equipment_issue_counts.update(row["issue_counts"])
    issue_counts.update(tag_issue_counts)
    issue_counts.update(equipment_issue_counts)
    history_by_tag = defaultdict(list)
    for row in implementation_history:
        history_by_tag[str(row["tag_id"])].append(row)
    replacement_tag_count = sum(1 for rows in history_by_tag.values() if len(rows) > 1)
    current_implementation_count = sum(1 for row in implementation_history if row.get("is_current"))
    missing_equipment_count = int(issue_counts.get("missing_equipment_implementation", 0))
    tag_attribute_issue_count = sum(
        count
        for rule, count in tag_issue_counts.items()
        if "attribute" in rule
    )
    equipment_attribute_issue_count = sum(
        count
        for rule, count in equipment_issue_counts.items()
        if "attribute" in rule
    )
    return {
        "projects_scanned": int(scope_counts.get("project_count") or 0),
        "active_tags_scanned": int(scope_counts.get("active_tag_count") or 0),
        "active_equipment_scanned": len(equipment_rows),
        "implementation_history_rows": len(implementation_history),
        "current_equipment_implementations": current_implementation_count,
        "tags_with_multiple_implementations": replacement_tag_count,
        "tags_without_equipment_implementation": missing_equipment_count,
        "tags_with_attribute_issues": sum(
            1
            for row in tag_problem_rows
            if any("attribute" in issue["rule"] for issue in row["issues"])
        ),
        "equipment_with_attribute_issues": sum(
            1
            for row in equipment_problem_rows
            if any("attribute" in issue["rule"] for issue in row["issues"])
        ),
        "tags_without_equipment_or_with_any_issues": len(tag_problem_rows),
        "equipment_with_any_issues": len(equipment_problem_rows),
        "tag_attribute_issue_count": tag_attribute_issue_count,
        "equipment_attribute_issue_count": equipment_attribute_issue_count,
        "attribute_issue_count": tag_attribute_issue_count + equipment_attribute_issue_count,
        "total_issue_count": sum(issue_counts.values()),
        "tag_issue_counts": dict(sorted(tag_issue_counts.items())),
        "equipment_issue_counts": dict(sorted(equipment_issue_counts.items())),
        "issue_counts": dict(sorted(issue_counts.items())),
    }


def _print_text_report(
    summary: dict,
    tag_samples: list[dict],
    equipment_samples: list[dict],
    implementation_history_samples: list[dict],
) -> None:
    print("Tag / equipment implementation / attribute standard check")
    print("=" * 60)
    print(f"Projects scanned: {summary['projects_scanned']}")
    print(f"Active tags scanned: {summary['active_tags_scanned']}")
    print(f"Active equipment scanned: {summary['active_equipment_scanned']}")
    print(f"Implementation history rows: {summary['implementation_history_rows']}")
    print(f"Current equipment implementations: {summary['current_equipment_implementations']}")
    print(f"Tags with multiple implementations: {summary['tags_with_multiple_implementations']}")
    print(f"Tags without current equipment implementation: {summary['tags_without_equipment_implementation']}")
    print(f"Tags with attribute issues: {summary['tags_with_attribute_issues']}")
    print(f"Equipment with attribute issues: {summary['equipment_with_attribute_issues']}")
    print(f"Tag attribute issues: {summary['tag_attribute_issue_count']}")
    print(f"Equipment attribute issues: {summary['equipment_attribute_issue_count']}")
    print(f"Total issues: {summary['total_issue_count']}")
    print("Issue counts:")
    for rule, count in summary["issue_counts"].items():
        print(f"  - {rule}: {count}")
    if tag_samples:
        print()
        print("Tag issue samples:")
    for row in tag_samples:
        print(
            f"- [{row['project_code']}] {row['tag_no']} ({row['class_code'] or '-'}) "
            f"issues={row['issue_count']}"
        )
        for issue in row["issues"][:5]:
            print(
                f"    {issue['rule']} {issue['field']}: "
                f"{issue['current_value']} -> {issue['expected_value']}"
            )
    if equipment_samples:
        print()
        print("Equipment issue samples:")
    for row in equipment_samples:
        print(
            f"- [{row['project_code']}] {row['equipment_no']} ({row['class_code'] or '-'}) "
            f"issues={row['issue_count']}"
        )
        for issue in row["issues"][:5]:
            print(
                f"    {issue['rule']} {issue['field']}: "
                f"{issue['current_value']} -> {issue['expected_value']}"
            )
    if implementation_history_samples:
        print()
        print("Implementation history samples:")
    for row in implementation_history_samples:
        print(
            f"- [{row['project_code']}] {row['tag_no']} -> {row['equipment_no']} "
            f"{row['installed_from']}..{row['installed_to'] or 'current'} current={row['is_current']}"
        )


def _export_reports(
    export_dir: Path,
    *,
    summary: dict,
    tag_problem_rows: list[dict],
    equipment_problem_rows: list[dict],
    implementation_history: list[dict],
) -> None:
    export_dir.mkdir(parents=True, exist_ok=True)
    (export_dir / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    _write_csv(export_dir / "tag-issues.csv", _flatten_issue_rows("tag", tag_problem_rows))
    _write_csv(export_dir / "equipment-issues.csv", _flatten_issue_rows("equipment", equipment_problem_rows))
    _write_csv(export_dir / "implementation-history.csv", implementation_history)


def _flatten_issue_rows(domain: str, rows: list[dict]) -> list[dict]:
    flattened: list[dict] = []
    for row in rows:
        for issue in row["issues"]:
            base = {
                "domain": domain,
                "project_code": row.get("project_code"),
                "class_code": row.get("class_code"),
                "class_name": row.get("class_name"),
                "rule": issue.get("rule"),
                "attribute_code": issue.get("field"),
                "attribute_name": issue.get("attribute_name") or "",
                "value_type": issue.get("value_type") or "",
                "is_required": issue.get("is_required"),
                "enum_options": json.dumps(issue.get("enum_options") or [], ensure_ascii=False),
                "current_value": issue.get("current_value"),
                "expected_value": issue.get("expected_value"),
                "new_value": "",
            }
            if domain == "tag":
                base.update(
                    {
                        "asset_id": row.get("tag_id"),
                        "asset_no": row.get("tag_no"),
                        "asset_name": row.get("tag_name"),
                        "implemented_equipment_no": row.get("equipment_no"),
                        "implemented_equipment_class_code": row.get("equipment_class_code"),
                    }
                )
            else:
                base.update(
                    {
                        "asset_id": row.get("equipment_id"),
                        "asset_no": row.get("equipment_no"),
                        "asset_name": row.get("equipment_name"),
                        "asset_status": row.get("asset_status"),
                        "assignment_count": row.get("assignment_count"),
                        "current_assignment_count": row.get("current_assignment_count"),
                    }
                )
            flattened.append(base)
    return flattened


def _write_csv(path: Path, rows: list[dict]) -> None:
    fieldnames = sorted({key for row in rows for key in row.keys()})
    with path.open("w", encoding="utf-8-sig", newline="") as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def _standard_ids(rows: list[dict]) -> list[str]:
    return sorted({value for row in rows if (value := _text(row.get("standard_id")))})


def _class_ids(rows: list[dict]) -> list[str]:
    return sorted({value for row in rows if (value := _text(row.get("class_id")))})


def _is_missing(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, (list, tuple, set, dict)):
        return len(value) == 0
    return False


def _is_number(value: Any) -> bool:
    if isinstance(value, bool):
        return False
    if isinstance(value, (int, float)):
        return isfinite(float(value))
    if isinstance(value, str):
        try:
            return isfinite(float(value.strip()))
        except ValueError:
            return False
    return False


def _is_integer(value: Any) -> bool:
    if isinstance(value, bool):
        return False
    if isinstance(value, int):
        return True
    if isinstance(value, str):
        try:
            int(value.strip())
            return True
        except ValueError:
            return False
    return False


def _is_date(value: Any) -> bool:
    if isinstance(value, (date, datetime)):
        return True
    if not isinstance(value, str):
        return False
    try:
        date.fromisoformat(value.strip()[:10])
        return True
    except ValueError:
        return False


def _format_value(value: Any) -> str:
    if value is None:
        return "-"
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    text = str(value).strip()
    return text or "-"


def _text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


if __name__ == "__main__":
    raise SystemExit(main())
