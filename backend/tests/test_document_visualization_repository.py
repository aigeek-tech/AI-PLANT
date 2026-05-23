import unittest
from unittest.mock import Mock, patch

from app.document_visualization_repository import create_document_visualization


class _FakeCursor:
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def execute(self, *_args, **_kwargs):
        return None

    def fetchone(self):
        return {"id": "visualization-1"}


class _FakeConnection:
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def cursor(self):
        return _FakeCursor()

    def commit(self):
        return None


class DocumentVisualizationRepositoryTest(unittest.TestCase):
    def test_rejects_non_spark_preview_asset(self):
        with patch("app.document_visualization_repository.get_connection", return_value=_FakeConnection()), patch(
            "app.document_visualization_repository._ensure_revision_exists"
        ), patch(
            "app.document_visualization_repository._require_ready_file",
            side_effect=[
                {"id": "source-file", "original_filename": "model.ifc", "status": "ready"},
                {"id": "preview-file", "original_filename": "preview.pdf", "status": "ready"},
            ],
        ):
            with self.assertRaisesRegex(ValueError, "Spark-readable"):
                create_document_visualization(
                    "project-1",
                    "doc-1",
                    "rev-1",
                    {
                        "source_file_id": "source-file",
                        "preview_file_id": "preview-file",
                        "metadata": {},
                    },
                )

    def test_rejects_manifest_that_is_not_json(self):
        with patch("app.document_visualization_repository.get_connection", return_value=_FakeConnection()), patch(
            "app.document_visualization_repository._ensure_revision_exists"
        ), patch(
            "app.document_visualization_repository._require_ready_file",
            side_effect=[
                {"id": "source-file", "original_filename": "model.ifc", "status": "ready"},
                {"id": "preview-file", "original_filename": "preview.spz", "status": "ready"},
                {"id": "manifest-file", "original_filename": "annotations.txt", "status": "ready"},
            ],
        ):
            with self.assertRaisesRegex(ValueError, "JSON"):
                create_document_visualization(
                    "project-1",
                    "doc-1",
                    "rev-1",
                    {
                        "source_file_id": "source-file",
                        "preview_file_id": "preview-file",
                        "annotation_manifest_file_id": "manifest-file",
                        "metadata": {},
                    },
                )

    def test_creates_visualization_for_ready_spark_asset(self):
        expected = {
            "id": "visualization-1",
            "source_file_id": "source-file",
            "preview_file_id": "preview-file",
            "annotation_manifest_file_id": "manifest-file",
            "metadata": {"units": "m"},
        }

        with patch("app.document_visualization_repository.get_connection", return_value=_FakeConnection()), patch(
            "app.document_visualization_repository._ensure_revision_exists"
        ), patch(
            "app.document_visualization_repository._require_ready_file",
            side_effect=[
                {"id": "source-file", "original_filename": "model.ifc", "status": "ready"},
                {"id": "preview-file", "original_filename": "preview.spz", "status": "ready"},
                {"id": "manifest-file", "original_filename": "annotations.json", "status": "ready"},
            ],
        ), patch("app.document_visualization_repository._fetch_visualization", return_value=expected):
            result = create_document_visualization(
                "project-1",
                "doc-1",
                "rev-1",
                {
                    "source_file_id": "source-file",
                    "preview_file_id": "preview-file",
                    "annotation_manifest_file_id": "manifest-file",
                    "metadata": {"units": "m"},
                },
            )

        self.assertEqual(result, expected)

    def test_allows_preview_file_to_be_its_own_source(self):
        expected = {
            "id": "visualization-1",
            "source_file_id": "preview-file",
            "preview_file_id": "preview-file",
            "annotation_manifest_file_id": None,
            "metadata": {"units": "m"},
        }

        with patch("app.document_visualization_repository.get_connection", return_value=_FakeConnection()), patch(
            "app.document_visualization_repository._ensure_revision_exists"
        ), patch(
            "app.document_visualization_repository._require_ready_file",
            side_effect=[
                {"id": "preview-file", "original_filename": "model.rad", "status": "ready"},
                {"id": "preview-file", "original_filename": "model.rad", "status": "ready"},
            ],
        ), patch("app.document_visualization_repository._fetch_visualization", return_value=expected):
            result = create_document_visualization(
                "project-1",
                "doc-1",
                "rev-1",
                {
                    "source_file_id": "preview-file",
                    "preview_file_id": "preview-file",
                    "metadata": {"units": "m"},
                },
            )

        self.assertEqual(result, expected)


if __name__ == "__main__":
    unittest.main()
