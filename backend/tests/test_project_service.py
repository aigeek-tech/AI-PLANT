import unittest
from unittest.mock import Mock, patch

from app.project_service import delete_project


class ProjectServiceTest(unittest.TestCase):
    def test_deletes_project_and_removes_document_objects(self):
        deleted_project = {"id": "project-1", "name": "海上平台改造"}
        storage_objects = [
            {"bucket": "smart-design-documents", "object_key": "projects/project-1/file-a.pdf"},
            {"bucket": "smart-design-documents", "object_key": "projects/project-1/file-b.pdf"},
            {"bucket": "smart-design-documents", "object_key": "projects/project-1/file-a.pdf"},
        ]
        storage = Mock()

        with patch("app.project_service.delete_project_record", return_value=(deleted_project, storage_objects)) as delete_project_record:
            result = delete_project("project-1", storage=storage)

        self.assertEqual(result, deleted_project)
        delete_project_record.assert_called_once_with("project-1")
        self.assertEqual(storage.delete_object.call_count, 2)
        storage.delete_object.assert_any_call(bucket="smart-design-documents", object_key="projects/project-1/file-a.pdf")
        storage.delete_object.assert_any_call(bucket="smart-design-documents", object_key="projects/project-1/file-b.pdf")

    def test_returns_none_when_project_is_missing(self):
        storage = Mock()

        with patch("app.project_service.delete_project_record", return_value=(None, [])) as delete_project_record:
            result = delete_project("missing", storage=storage)

        self.assertIsNone(result)
        delete_project_record.assert_called_once_with("missing")
        storage.delete_object.assert_not_called()

    def test_keeps_delete_successful_when_storage_cleanup_fails(self):
        deleted_project = {"id": "project-1", "name": "海上平台改造"}
        storage = Mock()
        storage.delete_object.side_effect = RuntimeError("storage unavailable")

        with patch(
            "app.project_service.delete_project_record",
            return_value=(deleted_project, [{"bucket": "smart-design-documents", "object_key": "projects/project-1/file-a.pdf"}]),
        ):
            result = delete_project("project-1", storage=storage)

        self.assertEqual(result, deleted_project)
        storage.delete_object.assert_called_once_with(
            bucket="smart-design-documents",
            object_key="projects/project-1/file-a.pdf",
        )


if __name__ == "__main__":
    unittest.main()
