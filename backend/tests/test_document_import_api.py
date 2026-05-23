import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


class DocumentImportApiTest(unittest.TestCase):
    def test_analyzes_document_import_files(self):
        result = {
            "items": [
                {
                    "client_id": "f-1",
                    "filename": "PID-1001-REV-A.pdf",
                    "suggested_document_no": "PID-1001",
                    "suggested_revision_no": "A",
                    "decision_source": "rule",
                    "needs_confirmation": False,
                    "match_reasons": ["rule matched"],
                }
            ],
            "summary": {
                "total_files": 1,
                "rule_auto_count": 1,
                "ai_suggested_count": 0,
                "manual_review_count": 0,
                "needs_confirmation_count": 0,
            },
        }

        with patch("app.main.analyze_document_import_files", return_value=result) as analyze_files:
            response = client.post(
                "/api/projects/project-1/document-imports/analyze",
                json={
                    "files": [
                        {
                            "client_id": "f-1",
                            "filename": "PID-1001-REV-A.pdf",
                            "relative_path": "issued/PID-1001-REV-A.pdf",
                            "size_bytes": 1024,
                            "content_type": "application/pdf",
                        }
                    ],
                    "use_llm": True,
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": result})
        analyze_files.assert_called_once_with(
            "project-1",
            {
                "files": [
                    {
                        "client_id": "f-1",
                        "filename": "PID-1001-REV-A.pdf",
                        "relative_path": "issued/PID-1001-REV-A.pdf",
                        "size_bytes": 1024,
                        "content_type": "application/pdf",
                    }
                ],
                "use_llm": True,
            },
        )

    def test_returns_400_when_import_analysis_fails(self):
        with patch("app.main.analyze_document_import_files", side_effect=ValueError("Project not found")):
            response = client.post(
                "/api/projects/project-1/document-imports/analyze",
                json={
                    "files": [
                        {
                            "client_id": "f-1",
                            "filename": "A.pdf",
                        }
                    ]
                },
            )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"detail": "Project not found"})


if __name__ == "__main__":
    unittest.main()
