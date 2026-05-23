import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


class DataQualityApiTest(unittest.TestCase):
    def test_returns_project_data_quality_summary(self):
        summary = {
            "project_id": "project-1",
            "generated_at": "2026-04-26T00:00:00Z",
            "standard": None,
            "scope": {
                "tag_count": 0,
                "equipment_count": 0,
                "document_count": 0,
                "pbs_node_count": 0,
                "requirement_count": 0,
            },
            "overall_score": 100,
            "completeness_score": 100,
            "accuracy_score": 100,
            "consistency_score": 100,
            "document_readiness_score": 100,
            "critical_issue_count": 0,
            "issue_count": 0,
            "matrix_row_count": 0,
            "dimension_cards": [],
        }

        with patch("app.main.get_project_data_quality_summary", return_value=summary) as get_summary:
            response = client.get("/api/projects/project-1/data-quality/summary")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": summary})
        get_summary.assert_called_once_with("project-1")

    def test_returns_project_data_quality_issues(self):
        issues = [
            {
                "id": "issue-1",
                "severity": "high",
                "dimension": "completeness",
                "object_kind": "tag",
                "object_id": "tag-1",
                "object_code": "P-1001",
                "object_name": "泵",
                "field": "rated_power",
                "rule": "required_attribute",
                "current_value": "-",
                "expected_value": "必填",
                "linked_document_no": None,
                "suggestion": "补充必填属性。",
            }
        ]

        with patch("app.main.get_project_data_quality_issues", return_value=issues) as get_issues:
            response = client.get("/api/projects/project-1/data-quality/issues")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": issues})
        get_issues.assert_called_once_with("project-1")

    def test_returns_project_document_matrix(self):
        rows = [
            {
                "row_id": "tag:tag-1",
                "asset_kind": "tag",
                "asset_id": "tag-1",
                "asset_no": "P-1001",
                "asset_name": "泵",
                "class_id": "class-pump",
                "class_code": "PUMP",
                "class_name": "泵类",
                "pbs_node_id": None,
                "pbs_node_code": None,
                "pbs_node_name": None,
                "equipment_id": None,
                "equipment_no": None,
                "equipment_name": None,
                "required_count": 1,
                "satisfied_count": 0,
                "missing_count": 1,
                "completeness_percent": 0,
                "cells": [],
            }
        ]

        with patch("app.main.get_project_data_quality_document_matrix", return_value=rows) as get_matrix:
            response = client.get("/api/projects/project-1/data-quality/document-matrix")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": rows})
        get_matrix.assert_called_once_with("project-1")

    def test_returns_404_when_project_quality_target_is_missing(self):
        with patch("app.main.get_project_data_quality_summary", side_effect=ValueError("Project not found")):
            response = client.get("/api/projects/missing/data-quality/summary")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {"detail": "Project not found"})


if __name__ == "__main__":
    unittest.main()

