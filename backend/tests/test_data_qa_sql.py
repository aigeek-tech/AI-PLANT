import pytest

from app.data_qa_models import DataQaQueryPlan, DataQaMeasure, DataQaSqlDraft
from app.data_qa_sql import DataQaSqlCompiler, DataQaSqlError


def test_compiler_injects_authorized_scope_for_project_domain_dataset():
    plan = DataQaQueryPlan(
        dataset="tags",
        dimensions=["status"],
        measures=[DataQaMeasure(field="id", aggregation="count", alias="tag_count")],
        limit=50,
    )

    compiled = DataQaSqlCompiler().compile(plan, allowed_project_ids=["project-1", "project-2"])

    assert "t.project_id = ANY(%s::uuid[])" in compiled.sql
    assert compiled.params[0] == ["project-1", "project-2"]
    assert "GROUP BY t.status" in compiled.sql
    assert compiled.columns == ["status", "tag_count"]


def test_compiler_filters_relation_dataset_through_project_boundary():
    plan = DataQaQueryPlan(
        dataset="tag_equipment_assignments",
        dimensions=["tag_no"],
        measures=[DataQaMeasure(field="id", aggregation="count", alias="assignment_count")],
    )

    compiled = DataQaSqlCompiler().compile(plan, allowed_project_ids=["project-1"])

    assert "JOIN tag t ON t.id = tea.tag_id" in compiled.sql
    assert "t.project_id = ANY(%s::uuid[])" in compiled.sql


def test_compiler_rejects_unknown_dataset_or_field():
    compiler = DataQaSqlCompiler()

    with pytest.raises(DataQaSqlError):
        compiler.compile(DataQaQueryPlan(dataset="settings", dimensions=[]), allowed_project_ids=["project-1"])

    with pytest.raises(DataQaSqlError):
        compiler.compile(DataQaQueryPlan(dataset="tags", dimensions=["password_hash"]), allowed_project_ids=["project-1"])


def test_compiler_rejects_empty_authorized_scope():
    with pytest.raises(DataQaSqlError):
        DataQaSqlCompiler().compile(DataQaQueryPlan(dataset="tags"), allowed_project_ids=[])


def test_compiler_validates_llm_sql_and_parameterizes_literals():
    draft = DataQaSqlDraft(
        dataset="tags",
        sql="SELECT t.status AS status, COUNT(*) AS tag_count FROM tag t WHERE t.status = 'active' GROUP BY t.status ORDER BY tag_count DESC LIMIT 10",
        tables=["tag"],
        chart_type="bar",
    )

    compiled = DataQaSqlCompiler().compile_sql_draft(draft, allowed_project_ids=["project-1", "project-2"])

    assert "t.project_id = ANY" in compiled.sql
    assert "'active'" not in compiled.sql
    assert "%(authorized_project_ids)s" in compiled.sql
    assert compiled.params["authorized_project_ids"] == ["project-1", "project-2"]
    assert "active" in compiled.params.values()
    assert 10 in compiled.params.values()
    assert compiled.columns == ["status", "tag_count"]


def test_compiler_rejects_llm_sql_without_project_boundary():
    draft = DataQaSqlDraft(
        dataset="tags",
        sql="SELECT u.email AS email FROM user_account u LIMIT 10",
    )

    with pytest.raises(DataQaSqlError):
        DataQaSqlCompiler().compile_sql_draft(draft, allowed_project_ids=["project-1"])


def test_compiler_rejects_helper_table_without_catalog_join():
    draft = DataQaSqlDraft(
        dataset="tags",
        sql="SELECT c.name AS class_name, COUNT(*) AS tag_count FROM tag t LEFT JOIN class c ON true GROUP BY c.name LIMIT 10",
    )

    with pytest.raises(DataQaSqlError):
        DataQaSqlCompiler().compile_sql_draft(draft, allowed_project_ids=["project-1"])


def test_compiler_rejects_select_star_from_llm_sql():
    draft = DataQaSqlDraft(
        dataset="tags",
        sql="SELECT * FROM tag t LIMIT 10",
    )

    with pytest.raises(DataQaSqlError):
        DataQaSqlCompiler().compile_sql_draft(draft, allowed_project_ids=["project-1"])
