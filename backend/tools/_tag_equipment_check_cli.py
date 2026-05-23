from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path
from typing import Callable

import psycopg

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from tools.check_tag_equipment_attribute_issues import collect_audit  # noqa: E402


RowsBuilder = Callable[[dict], list[dict]]
ISSUE_CSV_FIELDS = [
    "project_id",
    "project_code",
    "tag_id",
    "tag_no",
    "tag_name",
    "tag_class_code",
    "tag_class_name",
    "equipment_no",
    "equipment_class_code",
    "rule",
    "field",
    "current_value",
    "expected_value",
    "attribute_name",
    "value_type",
    "is_required",
    "enum_options",
]


def run_check(*, description: str, result_key: str, rows_builder: RowsBuilder) -> int:
    args = _parse_args(description)
    try:
        audit = collect_audit(project_id=args.project_id, include_optional_missing=args.include_optional_missing)
    except psycopg.Error as error:
        print(f"Database query failed: {error}", file=sys.stderr)
        return 2

    rows = rows_builder(audit)
    if args.csv:
        _write_csv(Path(args.csv), _flatten_issue_rows(rows))

    payload = {
        "project_id": args.project_id,
        "active_tags_scanned": audit["summary"]["active_tags_scanned"],
        "issue_row_count": len(rows),
        result_key: rows[: args.limit],
    }
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        _print_text_report(description, rows[: args.limit], total_count=len(rows))

    return 1 if args.fail_on_issues and rows else 0


def _parse_args(description: str) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument("--project-id", help="Limit the check to one project id.")
    parser.add_argument("--limit", type=int, default=50, help="Rows to print. Defaults to 50.")
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON.")
    parser.add_argument("--csv", help="Write full issue rows to a CSV file.")
    parser.add_argument(
        "--include-optional-missing",
        action="store_true",
        help="Also report optional standard attributes that are absent from asset attribute_values.",
    )
    parser.add_argument(
        "--fail-on-issues",
        action="store_true",
        help="Exit with code 1 when this check finds any issue rows.",
    )
    return parser.parse_args()


def _print_text_report(description: str, rows: list[dict], *, total_count: int) -> None:
    print(description)
    print("=" * 60)
    print(f"Issue rows: {total_count}")
    for row in rows:
        print(
            f"- [{row.get('project_code')}] {row.get('tag_no')} "
            f"tag_class={row.get('class_code') or '-'} "
            f"equipment={row.get('equipment_no') or '-'} "
            f"equipment_class={row.get('equipment_class_code') or '-'} "
            f"issues={row.get('issue_count')}"
        )
        for issue in row.get("issues", [])[:5]:
            print(
                f"    {issue['rule']} {issue['field']}: "
                f"{issue['current_value']} -> {issue['expected_value']}"
            )


def _flatten_issue_rows(rows: list[dict]) -> list[dict]:
    flattened: list[dict] = []
    for row in rows:
        for issue in row.get("issues", []):
            flattened.append(
                {
                    "project_id": row.get("project_id"),
                    "project_code": row.get("project_code"),
                    "tag_id": row.get("tag_id"),
                    "tag_no": row.get("tag_no"),
                    "tag_name": row.get("tag_name"),
                    "tag_class_code": row.get("class_code"),
                    "tag_class_name": row.get("class_name"),
                    "equipment_no": row.get("equipment_no"),
                    "equipment_class_code": row.get("equipment_class_code"),
                    "rule": issue.get("rule"),
                    "field": issue.get("field"),
                    "current_value": issue.get("current_value"),
                    "expected_value": issue.get("expected_value"),
                    "attribute_name": issue.get("attribute_name") or "",
                    "value_type": issue.get("value_type") or "",
                    "is_required": issue.get("is_required"),
                    "enum_options": json.dumps(issue.get("enum_options") or [], ensure_ascii=False),
                }
            )
    return flattened


def _write_csv(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=ISSUE_CSV_FIELDS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
