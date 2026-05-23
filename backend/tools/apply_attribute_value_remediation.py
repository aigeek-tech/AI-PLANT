from __future__ import annotations

import argparse
import csv
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from psycopg.types.json import Json

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("PGCONNECT_TIMEOUT", "5")
os.environ.setdefault("PGOPTIONS", "-c statement_timeout=30000")

from app.db import get_connection  # noqa: E402
from tools.check_tag_equipment_attribute_issues import AttributeDefinition, _validate_attribute_value  # noqa: E402


@dataclass(frozen=True)
class RemediationRow:
    line_number: int
    domain: str
    asset_id: str
    attribute_code: str
    new_value: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate and optionally apply filled attribute remediation CSV rows."
    )
    parser.add_argument("csv_path", help="CSV exported from the audit report, with a filled new_value column.")
    parser.add_argument("--apply", action="store_true", help="Persist updates. Defaults to dry-run validation only.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        rows = _read_rows(Path(args.csv_path))
        result = _apply_rows(rows, apply=args.apply)
    except (OSError, ValueError) as error:
        print(f"Remediation failed: {error}", file=sys.stderr)
        return 2

    print(f"Rows read: {result['rows_read']}")
    print(f"Rows skipped blank new_value: {result['rows_skipped_blank']}")
    print(f"Rows valid: {result['rows_valid']}")
    print(f"Rows updated: {result['rows_updated']}")
    print(f"Mode: {'apply' if args.apply else 'dry-run'}")
    return 0


def _read_rows(path: Path) -> list[RemediationRow]:
    with path.open("r", encoding="utf-8-sig", newline="") as csv_file:
        reader = csv.DictReader(csv_file)
        if reader.fieldnames is None:
            raise ValueError("CSV must have a header row")
        required_columns = {"domain", "asset_id", "attribute_code", "new_value"}
        missing_columns = sorted(required_columns - set(reader.fieldnames))
        if missing_columns:
            raise ValueError(f"CSV missing required columns: {', '.join(missing_columns)}")

        rows: list[RemediationRow] = []
        for line_number, row in enumerate(reader, start=2):
            rows.append(
                RemediationRow(
                    line_number=line_number,
                    domain=(row.get("domain") or "").strip(),
                    asset_id=(row.get("asset_id") or "").strip(),
                    attribute_code=(row.get("attribute_code") or "").strip(),
                    new_value=(row.get("new_value") or "").strip(),
                )
            )
        return rows


def _apply_rows(rows: list[RemediationRow], *, apply: bool) -> dict:
    stats = {"rows_read": len(rows), "rows_skipped_blank": 0, "rows_valid": 0, "rows_updated": 0}
    with get_connection() as connection:
        with connection.cursor() as cursor:
            for row in rows:
                if not row.new_value:
                    stats["rows_skipped_blank"] += 1
                    continue
                asset = _load_asset(cursor, row)
                definition = _load_definition(cursor, asset, row)
                value = _coerce_value(definition, row.new_value, line_number=row.line_number)
                validation_error = _validate_attribute_value(definition, value)
                if validation_error:
                    raise ValueError(f"line {row.line_number}: {row.attribute_code} {validation_error}")
                stats["rows_valid"] += 1
                if apply:
                    next_values = {**asset["attribute_values"], row.attribute_code: value}
                    _update_asset_values(cursor, row.domain, row.asset_id, next_values)
                    stats["rows_updated"] += 1
        if apply:
            connection.commit()
        else:
            connection.rollback()
    return stats


def _load_asset(cursor, row: RemediationRow) -> dict:
    if row.domain == "tag":
        cursor.execute(
            """
            SELECT
                t.id::text AS asset_id,
                t.class_id::text AS class_id,
                COALESCE(t.attribute_values, '{}'::jsonb) AS attribute_values,
                p.reference_attributes ->> 'standard_id' AS standard_id
            FROM tag t
            JOIN project p ON p.id = t.project_id
            WHERE t.id = %s
              AND t.status <> 'archived'
            """,
            (row.asset_id,),
        )
    elif row.domain == "equipment":
        cursor.execute(
            """
            SELECT
                e.id::text AS asset_id,
                e.class_id::text AS class_id,
                COALESCE(e.attribute_values, '{}'::jsonb) AS attribute_values,
                p.reference_attributes ->> 'standard_id' AS standard_id
            FROM equipment e
            JOIN project p ON p.id = e.project_id
            WHERE e.id = %s
              AND e.asset_status <> 'archived'
            """,
            (row.asset_id,),
        )
    else:
        raise ValueError(f"line {row.line_number}: unknown domain {row.domain!r}")
    asset = cursor.fetchone()
    if asset is None:
        raise ValueError(f"line {row.line_number}: {row.domain} asset not found: {row.asset_id}")
    return dict(asset)


def _load_definition(cursor, asset: dict, row: RemediationRow) -> AttributeDefinition:
    applies_to = ("tag", "both") if row.domain == "tag" else ("equipment", "both")
    cursor.execute(
        """
        SELECT
            ad.id::text AS id,
            ad.class_id::text AS class_id,
            ad.code,
            ad.name,
            ad.value_type,
            ad.is_required,
            ad.enum_options
        FROM attribute_definition ad
        WHERE ad.code = %s
          AND ad.status <> 'archived'
          AND ad.applies_to = ANY(%s)
          AND (
            ad.standard_id = %s::uuid
            OR ad.class_id = %s::uuid
          )
        ORDER BY ad.class_id NULLS FIRST
        LIMIT 1
        """,
        (row.attribute_code, list(applies_to), asset["standard_id"], asset["class_id"]),
    )
    definition = cursor.fetchone()
    if definition is None:
        raise ValueError(
            f"line {row.line_number}: {row.attribute_code} is not a valid {row.domain} attribute for this asset"
        )
    return AttributeDefinition(
        id=str(definition["id"]),
        class_id=str(definition["class_id"]) if definition["class_id"] else None,
        code=str(definition["code"]),
        name=str(definition["name"]),
        value_type=str(definition["value_type"] or "string"),
        is_required=bool(definition["is_required"]),
        enum_options=tuple(str(option) for option in definition["enum_options"] or []),
    )


def _coerce_value(definition: AttributeDefinition, raw_value: str, *, line_number: int) -> Any:
    value = raw_value.strip()
    if definition.value_type == "number":
        try:
            return float(value)
        except ValueError as error:
            raise ValueError(f"line {line_number}: {definition.code} must be a number") from error
    if definition.value_type == "integer":
        try:
            return int(value)
        except ValueError as error:
            raise ValueError(f"line {line_number}: {definition.code} must be an integer") from error
    if definition.value_type == "boolean":
        normalized = value.lower()
        if normalized in {"true", "1", "yes", "y"}:
            return True
        if normalized in {"false", "0", "no", "n"}:
            return False
        raise ValueError(f"line {line_number}: {definition.code} must be a boolean")
    return value


def _update_asset_values(cursor, domain: str, asset_id: str, values: dict) -> None:
    if domain == "tag":
        cursor.execute("UPDATE tag SET attribute_values = %s WHERE id = %s", (Json(values), asset_id))
    else:
        cursor.execute("UPDATE equipment SET attribute_values = %s WHERE id = %s", (Json(values), asset_id))


if __name__ == "__main__":
    raise SystemExit(main())
