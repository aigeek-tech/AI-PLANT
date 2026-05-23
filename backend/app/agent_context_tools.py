from __future__ import annotations

from .data_quality_repository import get_project_data_quality
from .document_repository import list_project_documents
from .equipment_repository import list_project_equipment
from .relation_repository import list_project_relations
from .repository import get_pbs_nodes, get_project_detail, get_project_tags


DATA_QUALITY_CONTEXT_ISSUE_LIMIT = 100
DATA_QUALITY_CONTEXT_MATRIX_LIMIT = 80
EQUIPMENT_CONTEXT_LIMIT = 80


def _trim_items(items: list[dict], keys: tuple[str, ...], limit: int) -> list[dict]:
    trimmed: list[dict] = []
    for item in items[:limit]:
        trimmed.append({key: item.get(key) for key in keys if key in item})
    return trimmed


def build_project_agent_context(project_id: str) -> dict:
    project = get_project_detail(project_id)
    if project is None:
        raise ValueError("Project not found")

    pbs_nodes = get_pbs_nodes(project_id)
    tags = get_project_tags(project_id)
    equipment = list_project_equipment(project_id)
    documents = list_project_documents(project_id, {"page": 1, "page_size": 50})
    relations = list_project_relations(project_id)
    data_quality = _build_data_quality_context(project_id)

    return {
        "project": {
            "id": str(project["id"]),
            "code": project.get("code"),
            "name": project.get("name"),
            "overview": project.get("overview"),
            "status": project.get("status"),
            "reference_attributes": project.get("reference_attributes") or {},
            "metadata": project.get("metadata") or {},
        },
        "pbs_nodes": _trim_items(
            pbs_nodes,
            ("id", "parent_id", "code", "name", "node_type", "status", "level_code", "level_name"),
            80,
        ),
        "tags": _trim_items(
            tags,
            ("id", "tag_no", "name", "pbs_node_id", "class_id", "class_name", "parent_tag_id", "status"),
            80,
        ),
        "equipment": _trim_items(
            equipment,
            (
                "id",
                "equipment_no",
                "name",
                "class_id",
                "class_code",
                "class_name",
                "manufacturer",
                "model",
                "serial_no",
                "asset_status",
            ),
            EQUIPMENT_CONTEXT_LIMIT,
        ),
        "documents": _trim_items(
            documents.get("items", []),
            (
                "id",
                "document_no",
                "title",
                "document_type_name",
                "discipline",
                "current_revision_no",
                "status",
                "linked_pbs_count",
                "linked_tag_count",
            ),
            50,
        ),
        "relations": _trim_items(
            relations,
            (
                "id",
                "relation_type_code",
                "source_kind",
                "source_id",
                "target_kind",
                "target_id",
                "note",
            ),
            80,
        ),
        "limits": {
            "pbs_nodes": min(len(pbs_nodes), 80),
            "tags": min(len(tags), 80),
            "equipment": min(len(equipment), EQUIPMENT_CONTEXT_LIMIT),
            "documents": min(int(documents.get("total") or 0), 50),
            "relations": min(len(relations), 80),
        },
        "data_quality": data_quality,
    }


def _build_data_quality_context(project_id: str) -> dict:
    try:
        quality = get_project_data_quality(project_id)
    except Exception as error:
        return {
            "error": str(error) or error.__class__.__name__,
            "error_type": error.__class__.__name__,
        }

    summary = quality.get("summary") or {}
    issues = quality.get("issues") or []
    matrix = quality.get("document_matrix") or []
    gap_rows = [
        row
        for row in matrix
        if isinstance(row, dict) and int(row.get("missing_count") or 0) > 0
    ]

    return {
        "summary": _trim_data_quality_summary(summary),
        "issues": _trim_items(
            issues,
            (
                "severity",
                "dimension",
                "object_kind",
                "object_id",
                "object_code",
                "object_name",
                "field",
                "rule",
                "current_value",
                "expected_value",
                "linked_document_no",
                "suggestion",
            ),
            DATA_QUALITY_CONTEXT_ISSUE_LIMIT,
        ),
        "document_matrix_rows_with_gaps": [
            _trim_document_matrix_row(row)
            for row in gap_rows[:DATA_QUALITY_CONTEXT_MATRIX_LIMIT]
        ],
        "limits": {
            "issues_included": min(len(issues), DATA_QUALITY_CONTEXT_ISSUE_LIMIT),
            "issues_total": len(issues),
            "document_matrix_rows_with_gaps_included": min(len(gap_rows), DATA_QUALITY_CONTEXT_MATRIX_LIMIT),
            "document_matrix_rows_with_gaps_total": len(gap_rows),
            "document_matrix_total_rows": len(matrix),
        },
    }


def _trim_data_quality_summary(summary: dict) -> dict:
    return {
        key: summary.get(key)
        for key in (
            "overall_score",
            "completeness_score",
            "accuracy_score",
            "consistency_score",
            "document_readiness_score",
            "critical_issue_count",
            "issue_count",
            "matrix_row_count",
            "scope",
        )
        if key in summary
    }


def _trim_document_matrix_row(row: dict) -> dict:
    values = {
        "asset_kind": row.get("asset_kind"),
        "asset_id": row.get("asset_id"),
        "asset_no": row.get("asset_no"),
        "asset_name": row.get("asset_name"),
        "class_code": row.get("class_code"),
        "class_name": row.get("class_name"),
        "pbs_node_code": row.get("pbs_node_code"),
        "pbs_node_name": row.get("pbs_node_name"),
        "equipment_no": row.get("equipment_no"),
        "equipment_name": row.get("equipment_name"),
        "required_count": row.get("required_count"),
        "satisfied_count": row.get("satisfied_count"),
        "missing_count": row.get("missing_count"),
        "cells_with_gaps": _trim_matrix_gap_cells(row.get("cells")),
    }
    return {key: value for key, value in values.items() if value not in (None, "", [])}


def _trim_matrix_gap_cells(cells: object) -> list[dict]:
    if not isinstance(cells, list):
        return []
    return _trim_items(
        [cell for cell in cells if isinstance(cell, dict) and cell.get("status") != "ok"],
        (
            "document_type_code",
            "document_type_name",
            "asset_scope",
            "lifecycle_phase",
            "status",
            "document_no",
            "revision_no",
            "revision_state",
            "file_count",
        ),
        20,
    )
