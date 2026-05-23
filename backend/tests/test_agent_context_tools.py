from app import agent_context_tools


def test_build_project_agent_context_includes_equipment_and_data_quality(monkeypatch):
    monkeypatch.setattr(
        agent_context_tools,
        "get_project_detail",
        lambda project_id: {
            "id": project_id,
            "code": "P-001",
            "name": "项目一",
            "overview": None,
            "status": "active",
            "reference_attributes": {},
            "metadata": {},
        },
    )
    monkeypatch.setattr(agent_context_tools, "get_pbs_nodes", lambda _project_id: [])
    monkeypatch.setattr(agent_context_tools, "get_project_tags", lambda _project_id: [])
    monkeypatch.setattr(
        agent_context_tools,
        "list_project_equipment",
        lambda _project_id: [
            {
                "id": "eq-1",
                "equipment_no": "EQ-1001",
                "name": "注水泵",
                "class_name": "泵类",
                "asset_status": "in_service",
            }
        ],
    )
    monkeypatch.setattr(agent_context_tools, "list_project_documents", lambda _project_id, _filters: {"items": [], "total": 0})
    monkeypatch.setattr(agent_context_tools, "list_project_relations", lambda _project_id: [])
    monkeypatch.setattr(
        agent_context_tools,
        "get_project_data_quality",
        lambda _project_id: {
            "summary": {
                "overall_score": 90,
                "document_readiness_score": 75,
                "issue_count": 1,
                "scope": {"equipment_count": 1},
            },
            "issues": [
                {
                    "severity": "high",
                    "dimension": "document_readiness",
                    "object_kind": "equipment",
                    "object_code": "EQ-1001",
                    "object_name": "注水泵",
                    "field": "DS",
                    "rule": "required_document",
                    "expected_value": "必须关联该类型文档",
                    "suggestion": "补齐数据表。",
                }
            ],
            "document_matrix": [
                {
                    "asset_kind": "equipment",
                    "asset_id": "eq-1",
                    "asset_no": "EQ-1001",
                    "asset_name": "注水泵",
                    "class_name": "泵类",
                    "required_count": 1,
                    "satisfied_count": 0,
                    "missing_count": 1,
                    "cells": [
                        {
                            "document_type_code": "DS",
                            "document_type_name": "数据表",
                            "status": "missing",
                        },
                        {
                            "document_type_code": "PID",
                            "document_type_name": "P&ID",
                            "status": "ok",
                        },
                    ],
                }
            ],
        },
    )

    context = agent_context_tools.build_project_agent_context("project-1")

    assert context["equipment"] == [
        {
            "id": "eq-1",
            "equipment_no": "EQ-1001",
            "name": "注水泵",
            "class_name": "泵类",
            "asset_status": "in_service",
        }
    ]
    data_quality = context["data_quality"]
    assert data_quality["summary"]["document_readiness_score"] == 75
    assert data_quality["issues"][0]["object_code"] == "EQ-1001"
    assert data_quality["document_matrix_rows_with_gaps"][0]["cells_with_gaps"] == [
        {
            "document_type_code": "DS",
            "document_type_name": "数据表",
            "status": "missing",
        }
    ]
