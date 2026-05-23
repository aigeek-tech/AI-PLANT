from pathlib import Path
import importlib.util
import sys


TOOL_PATH = Path(__file__).resolve().parents[1] / "tools" / "apply_attribute_value_remediation.py"

spec = importlib.util.spec_from_file_location("apply_attribute_value_remediation", TOOL_PATH)
remediation = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = remediation
spec.loader.exec_module(remediation)


def _definition(value_type: str):
    return remediation.AttributeDefinition(
        id="attr-1",
        class_id="class-1",
        code="A-001",
        name="Attribute",
        value_type=value_type,
        is_required=True,
        enum_options=(),
    )


def test_coerces_csv_values_to_attribute_types():
    assert remediation._coerce_value(_definition("number"), "12.5", line_number=2) == 12.5
    assert remediation._coerce_value(_definition("integer"), "12", line_number=2) == 12
    assert remediation._coerce_value(_definition("boolean"), "yes", line_number=2) is True
    assert remediation._coerce_value(_definition("string"), "IP 66", line_number=2) == "IP 66"


def test_read_rows_requires_new_value_column(tmp_path):
    csv_path = tmp_path / "missing.csv"
    csv_path.write_text("domain,asset_id,attribute_code\n", encoding="utf-8")

    try:
        remediation._read_rows(csv_path)
    except ValueError as error:
        assert "new_value" in str(error)
    else:
        raise AssertionError("Expected missing new_value column to fail")


def test_read_rows_loads_remediation_rows(tmp_path):
    csv_path = tmp_path / "filled.csv"
    csv_path.write_text(
        "domain,asset_id,attribute_code,new_value\n"
        "equipment,equipment-1,A-001,IP 66\n",
        encoding="utf-8",
    )

    rows = remediation._read_rows(csv_path)

    assert rows == [
        remediation.RemediationRow(
            line_number=2,
            domain="equipment",
            asset_id="equipment-1",
            attribute_code="A-001",
            new_value="IP 66",
        )
    ]
