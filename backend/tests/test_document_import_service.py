import unittest
from unittest.mock import patch

from app.document_imports import analyze_document_import_files


class DocumentImportServiceTest(unittest.TestCase):
    def test_filename_document_no_takes_precedence_over_same_title_existing_document(self):
        existing_documents = [
            {
                "id": "doc-70",
                "document_no": "0402-PD02-DWG-70",
                "title": "七中区注入站1号注入泵单元配管部分管道轴测图",
                "revisions": [],
            }
        ]

        with (
            patch("app.document_imports._load_existing_documents", return_value=existing_documents),
            patch("app.document_imports.get_ai_settings_secret") as get_ai_settings_secret,
            patch("app.document_imports._request_llm_suggestion") as request_llm_suggestion,
        ):
            result = analyze_document_import_files(
                "project-1",
                {
                    "files": [
                        {
                            "client_id": "file-80",
                            "filename": "0402-PD02-DWG-80-七中区注入站1号注入泵单元配管部分管道轴测图.pdf",
                            "relative_path": None,
                            "size_bytes": 324709,
                            "content_type": "application/pdf",
                        }
                    ],
                    "use_llm": True,
                },
            )

        item = result["items"][0]
        self.assertEqual(item["suggested_document_no"], "0402-PD02-DWG-80")
        self.assertEqual(item["suggested_title"], "七中区注入站1号注入泵单元配管部分管道轴测图")
        self.assertIsNone(item["matched_document_id"])
        self.assertIsNone(item["matched_document_title"])
        self.assertEqual(item["decision_source"], "manual")
        self.assertTrue(item["needs_confirmation"])
        get_ai_settings_secret.assert_not_called()
        request_llm_suggestion.assert_not_called()

    def test_skips_llm_when_document_no_is_identified_but_revision_is_missing(self):
        with (
            patch("app.document_imports._load_existing_documents", return_value=[]),
            patch("app.document_imports.get_ai_settings_secret") as get_ai_settings_secret,
            patch("app.document_imports._request_llm_suggestion") as request_llm_suggestion,
        ):
            result = analyze_document_import_files(
                "project-1",
                {
                    "files": [
                        {
                            "client_id": "file-1",
                            "filename": "0306-IN01-DWG-04-母液罐操作区单元接线箱安装示意图.pdf",
                            "relative_path": None,
                            "size_bytes": 324709,
                            "content_type": "application/pdf",
                        }
                    ],
                    "use_llm": True,
                },
            )

        item = result["items"][0]
        self.assertEqual(item["suggested_document_no"], "0306-IN01-DWG-04")
        self.assertEqual(item["suggested_title"], "母液罐操作区单元接线箱安装示意图")
        self.assertIsNone(item["suggested_revision_no"])
        self.assertEqual(item["decision_source"], "manual")
        self.assertTrue(item["needs_confirmation"])
        self.assertEqual(result["summary"]["manual_review_count"], 1)
        get_ai_settings_secret.assert_not_called()
        request_llm_suggestion.assert_not_called()

    def test_uses_llm_when_document_no_cannot_be_identified(self):
        settings = {
            "is_enabled": True,
            "base_url": "https://example.test",
            "model": "test-model",
            "api_key": "test-key",
        }
        with (
            patch("app.document_imports._load_existing_documents", return_value=[]),
            patch("app.document_imports.get_ai_settings_secret", return_value=settings) as get_ai_settings_secret,
            patch(
                "app.document_imports._request_llm_suggestion",
                return_value={
                    "document_no": "DOC-001",
                    "title": "母液罐说明",
                    "revision_no": "A",
                    "file_role": "primary",
                    "confidence": 0.8,
                },
            ) as request_llm_suggestion,
        ):
            result = analyze_document_import_files(
                "project-1",
                {
                    "files": [
                        {
                            "client_id": "file-1",
                            "filename": "母液罐说明.pdf",
                            "relative_path": None,
                            "size_bytes": 1024,
                            "content_type": "application/pdf",
                        }
                    ],
                    "use_llm": True,
                },
            )

        item = result["items"][0]
        self.assertEqual(item["suggested_document_no"], "DOC-001")
        self.assertEqual(item["suggested_revision_no"], "A")
        self.assertEqual(item["decision_source"], "llm")
        self.assertTrue(item["needs_confirmation"])
        get_ai_settings_secret.assert_called_once()
        request_llm_suggestion.assert_called_once()


if __name__ == "__main__":
    unittest.main()
