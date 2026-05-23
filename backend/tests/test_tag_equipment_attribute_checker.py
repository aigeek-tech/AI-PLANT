from pathlib import Path
import importlib.util
import sys


TOOL_PATH = Path(__file__).resolve().parents[1] / "tools" / "check_tag_equipment_attribute_issues.py"

spec = importlib.util.spec_from_file_location("check_tag_equipment_attribute_issues", TOOL_PATH)
checker = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = checker
spec.loader.exec_module(checker)


def test_asset_attribute_issues_require_exact_standard_key_set():
    definitions = {
        "by_standard_id": {},
        "by_class_id": {
            "class-1": [
                checker.AttributeDefinition(
                    id="attr-1",
                    class_id="class-1",
                    code="rated_power",
                    name="Rated power",
                    value_type="number",
                    is_required=False,
                    enum_options=(),
                ),
                checker.AttributeDefinition(
                    id="attr-2",
                    class_id="class-1",
                    code="service",
                    name="Service",
                    value_type="string",
                    is_required=True,
                    enum_options=(),
                ),
            ]
        },
    }

    issues = checker._asset_attribute_issues(
        {
            "standard_id": "standard-1",
            "class_id": "class-1",
            "attribute_values": {"rated_power": 12, "unexpected": "x"},
        },
        definitions,
        domain="tag",
        builtins=set(),
    )

    assert {issue["rule"] for issue in issues} == {"unknown_tag_attribute", "missing_required_tag_attribute"}
    assert {issue["field"] for issue in issues} == {"unexpected", "service"}


def test_asset_attribute_issues_can_include_optional_missing_in_strict_mode():
    definitions = {
        "by_standard_id": {},
        "by_class_id": {
            "class-1": [
                checker.AttributeDefinition(
                    id="attr-1",
                    class_id="class-1",
                    code="rated_power",
                    name="Rated power",
                    value_type="number",
                    is_required=False,
                    enum_options=(),
                )
            ]
        },
    }

    issues = checker._asset_attribute_issues(
        {"standard_id": "standard-1", "class_id": "class-1", "attribute_values": {}},
        definitions,
        domain="tag",
        builtins=set(),
        include_optional_missing=True,
    )

    assert [issue["rule"] for issue in issues] == ["missing_optional_tag_attribute"]


def test_equipment_issues_validate_domain_and_current_assignment():
    definitions = {"by_standard_id": {}, "by_class_id": {}}

    issues = checker._equipment_issues(
        {
            "class_id": "class-1",
            "class_applies_to": "tag",
            "asset_status": "in_service",
            "current_assignment_count": 0,
            "attribute_values": {},
        },
        definitions,
    )

    assert {issue["rule"] for issue in issues} == {
        "invalid_equipment_class_domain",
        "equipment_without_current_tag_implementation",
    }


def test_removed_equipment_does_not_require_current_assignment():
    issues = checker._equipment_issues(
        {
            "class_id": "class-1",
            "class_applies_to": "equipment",
            "asset_status": "removed",
            "current_assignment_count": 0,
            "attribute_values": {},
        },
        {"by_standard_id": {}, "by_class_id": {}},
    )

    assert issues == []


def test_export_reports_writes_reusable_artifacts(tmp_path):
    checker._export_reports(
        tmp_path,
        summary={"total_issue_count": 1},
        tag_problem_rows=[
            {
                "project_code": "P",
                "tag_id": "tag-1",
                "tag_no": "T-001",
                "tag_name": "Tag",
                "class_code": "TAG-CLASS",
                "class_name": "Tag class",
                "equipment_no": "EQ-001",
                "equipment_class_code": "EQ-CLASS",
                "issues": [
                    {
                        "rule": "missing_required_tag_attribute",
                        "field": "A-001",
                        "attribute_name": "Attr",
                        "value_type": "string",
                        "is_required": True,
                        "enum_options": [],
                        "current_value": "-",
                        "expected_value": "标准属性: Attr",
                    }
                ],
            }
        ],
        equipment_problem_rows=[],
        implementation_history=[{"tag_no": "T-001", "equipment_no": "EQ-001"}],
    )

    assert (tmp_path / "summary.json").exists()
    assert "missing_required_tag_attribute" in (tmp_path / "tag-issues.csv").read_text(encoding="utf-8-sig")
    assert "T-001" in (tmp_path / "implementation-history.csv").read_text(encoding="utf-8-sig")


def test_tag_attribute_problem_rows_keep_only_class_attribute_mismatches():
    rows = checker.tag_attribute_problem_rows(
        {
            "tag_problem_rows": [
                {
                    "tag_no": "T-001",
                    "issue_count": 2,
                    "issue_counts": {
                        "unknown_tag_attribute": 1,
                        "missing_equipment_implementation": 1,
                    },
                    "issues": [
                        {
                            "rule": "unknown_tag_attribute",
                            "field": "unexpected",
                            "current_value": "x",
                            "expected_value": "标准中不存在该 tag 属性码",
                        },
                        {
                            "rule": "missing_equipment_implementation",
                            "field": "equipment_implementation",
                            "current_value": "-",
                            "expected_value": "必须存在当前 active equipment implementation",
                        },
                    ],
                }
            ]
        }
    )

    assert rows[0]["issue_count"] == 1
    assert rows[0]["issue_counts"] == {"unknown_tag_attribute": 1}
    assert rows[0]["issues"][0]["field"] == "unexpected"


def test_tags_without_equipment_rows_keep_only_missing_implementation():
    rows = checker.tags_without_equipment_rows(
        {
            "tag_problem_rows": [
                {
                    "tag_no": "T-001",
                    "issue_count": 2,
                    "issue_counts": {
                        "missing_equipment_implementation": 1,
                        "missing_required_tag_attribute": 1,
                    },
                    "issues": [
                        {
                            "rule": "missing_equipment_implementation",
                            "field": "equipment_implementation",
                            "current_value": "-",
                            "expected_value": "必须存在当前 active equipment implementation",
                        },
                        {
                            "rule": "missing_required_tag_attribute",
                            "field": "service",
                            "current_value": "-",
                            "expected_value": "标准属性: Service",
                        },
                    ],
                }
            ]
        }
    )

    assert rows[0]["issue_count"] == 1
    assert rows[0]["issue_counts"] == {"missing_equipment_implementation": 1}
    assert rows[0]["issues"][0]["rule"] == "missing_equipment_implementation"


def test_tag_equipment_standard_problem_rows_reports_current_equipment_issues_by_tag():
    rows = checker.tag_equipment_standard_problem_rows(
        {
            "tag_rows": [
                {
                    "project_id": "project-1",
                    "project_code": "P",
                    "tag_id": "tag-1",
                    "tag_no": "T-001",
                    "name": "Tag",
                    "class_code": "TAG-CLASS",
                    "class_name": "Tag class",
                    "equipment_id": "equipment-1",
                    "equipment_no": "EQ-001",
                    "equipment_class_code": "EQ-CLASS",
                    "has_current_equipment_implementation": True,
                    "is_allowed_equipment_class": True,
                }
            ],
            "equipment_problem_rows": [
                {
                    "equipment_id": "equipment-1",
                    "issues": [
                        {
                            "rule": "missing_required_equipment_attribute",
                            "field": "pressure_rating",
                            "current_value": "-",
                            "expected_value": "标准属性: Pressure rating",
                        }
                    ],
                }
            ],
        }
    )

    assert rows[0]["tag_no"] == "T-001"
    assert rows[0]["equipment_no"] == "EQ-001"
    assert rows[0]["issue_counts"] == {"missing_required_equipment_attribute": 1}
