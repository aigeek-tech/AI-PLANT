from app import data_quality_repository
from app.data_quality_repository import build_project_data_quality


def test_load_equipment_reads_equipment_attribute_values_column(monkeypatch):
    captured: dict[str, object] = {}

    def fake_fetch_all(sql, params):
        captured["sql"] = sql
        captured["params"] = params
        return []

    monkeypatch.setattr(data_quality_repository, "fetch_all", fake_fetch_all)

    assert data_quality_repository._load_equipment("project-1") == []
    assert "COALESCE(e.attribute_values, '{}'::jsonb) AS attribute_values" in str(captured["sql"])
    assert "e.metadata -> 'attribute_values'" not in str(captured["sql"])
    assert captured["params"] == ("project-1",)


def test_builds_empty_project_quality_result():
    result = build_project_data_quality(
        project={
            "id": "project-1",
            "code": "P-001",
            "name": "示例项目",
            "reference_attributes": {},
            "standard_id": None,
            "standard_code": None,
            "standard_name": None,
            "standard_version_label": None,
        },
        tags=[],
        equipment=[],
        documents=[],
        document_tag_links=[],
        required_attributes=[],
        document_requirements=[],
    )

    assert result["summary"]["overall_score"] == 100
    assert result["summary"]["issue_count"] == 0
    assert result["issues"] == []
    assert result["document_matrix"] == []


def test_reports_missing_required_tag_attribute_and_missing_document():
    result = build_project_data_quality(
        project={
            "id": "project-1",
            "code": "P-001",
            "name": "示例项目",
            "reference_attributes": {"standard_id": "standard-1"},
            "standard_id": "standard-1",
            "standard_code": "DEC",
            "standard_name": "DEC",
            "standard_version_label": "2026",
        },
        tags=[
            {
                "id": "tag-1",
                "tag_no": "P-1001",
                "name": "泵",
                "class_id": "class-pump",
                "class_code": "PUMP",
                "class_name": "泵类",
                "pbs_node_id": "pbs-1",
                "pbs_node_code": "U-01",
                "pbs_node_name": "单元一",
                "attribute_values": {},
                "status": "active",
            }
        ],
        equipment=[],
        documents=[],
        document_tag_links=[],
        required_attributes=[
            {
                "id": "attr-1",
                "owner_kind": "class",
                "class_id": "class-pump",
                "code": "rated_power",
                "name": "额定功率",
                "value_type": "number",
                "enum_options": [],
                "applies_to": "tag",
            }
        ],
        document_requirements=[
            {
                "id": "req-1",
                "class_id": "class-pump",
                "class_code": "PUMP",
                "class_name": "泵类",
                "class_applies_to": "tag",
                "document_type_id": "doctype-datasheet",
                "document_type_code": "DS",
                "document_type_name": "数据表",
                "asset_scope": "tag",
                "lifecycle_phase": "handover",
            }
        ],
    )

    assert result["summary"]["issue_count"] == 2
    assert result["summary"]["critical_issue_count"] == 0
    assert {issue["rule"] for issue in result["issues"]} == {"required_attribute", "required_document"}
    assert result["document_matrix"][0]["required_count"] == 1
    assert result["document_matrix"][0]["missing_count"] == 1
    assert result["document_matrix"][0]["cells"][0]["status"] == "missing"


def test_equipment_required_attribute_uses_equipment_attribute_values():
    result = build_project_data_quality(
        project={
            "id": "project-1",
            "code": "P-001",
            "name": "示例项目",
            "reference_attributes": {"standard_id": "standard-1"},
            "standard_id": "standard-1",
        },
        tags=[],
        equipment=[
            {
                "id": "equipment-1",
                "equipment_no": "EQ-1001",
                "name": "泵设备",
                "class_id": "equipment-class-pump",
                "class_code": "PUMP-EQ",
                "class_name": "泵设备类",
                "attribute_values": {"rated_power": 55},
                "asset_status": "in_service",
            }
        ],
        documents=[],
        document_tag_links=[],
        required_attributes=[
            {
                "id": "attr-1",
                "owner_kind": "class",
                "class_id": "equipment-class-pump",
                "code": "rated_power",
                "name": "额定功率",
                "value_type": "number",
                "enum_options": [],
                "applies_to": "equipment",
            }
        ],
        document_requirements=[],
    )

    assert result["summary"]["issue_count"] == 0
    assert result["issues"] == []


def test_document_matrix_marks_current_issued_primary_file_as_ok():
    result = build_project_data_quality(
        project={"id": "project-1", "code": "P-001", "name": "示例项目"},
        tags=[
            {
                "id": "tag-1",
                "tag_no": "P-1001",
                "name": "泵",
                "class_id": "class-pump",
                "class_code": "PUMP",
                "class_name": "泵类",
                "pbs_node_id": None,
                "pbs_node_code": None,
                "pbs_node_name": None,
                "attribute_values": {},
                "status": "active",
            }
        ],
        equipment=[],
        documents=[
            {
                "id": "doc-1",
                "document_no": "DS-1001",
                "title": "泵数据表",
                "document_type_id": "doctype-datasheet",
                "document_type_code": "DS",
                "document_type_name": "数据表",
                "status": "active",
                "current_revision_id": "rev-1",
                "current_revision_no": "A",
                "current_revision_state": "issued",
                "ready_file_count": 1,
                "primary_ready_file_count": 1,
                "linked_tag_count": 1,
                "linked_pbs_count": 0,
            }
        ],
        document_tag_links=[{"document_id": "doc-1", "tag_id": "tag-1"}],
        required_attributes=[],
        document_requirements=[
            {
                "id": "req-1",
                "class_id": "class-pump",
                "class_code": "PUMP",
                "class_name": "泵类",
                "class_applies_to": "tag",
                "document_type_id": "doctype-datasheet",
                "document_type_code": "DS",
                "document_type_name": "数据表",
                "asset_scope": "tag",
                "lifecycle_phase": "handover",
            }
        ],
    )

    matrix_row = result["document_matrix"][0]
    assert matrix_row["satisfied_count"] == 1
    assert matrix_row["missing_count"] == 0
    assert matrix_row["cells"][0]["status"] == "ok"
    assert all(issue["rule"] != "required_document" for issue in result["issues"])
