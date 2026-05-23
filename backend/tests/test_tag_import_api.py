import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


class TagImportApiTest(unittest.TestCase):
    def test_downloads_tag_import_template(self):
        project = {
            "id": "project-1",
            "code": "PRJ-001",
            "name": "项目1",
            "reference_attributes": {"standard_id": "standard-1"},
        }
        standard = {"id": "standard-1", "code": "DEC", "name": "DEC", "classes": [], "common_attributes": []}
        pbs_nodes = [{"id": "pbs-1", "code": "UNIT-100", "name": "装置100"}]

        with (
            patch("app.main.get_project_detail", return_value=project),
            patch("app.main.get_standard_detail", return_value=standard),
            patch("app.main.get_pbs_nodes", return_value=pbs_nodes),
            patch("app.main.build_tag_import_template", return_value=b"excel-content"),
        ):
            response = client.get("/api/projects/project-1/tag-import-template")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.headers["content-type"],
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        self.assertEqual(response.content, b"excel-content")

    def test_validates_uploaded_tag_import_file(self):
        validate_result = {
            "job_id": "job-1",
            "summary": {"total_rows": 1, "ready_rows": 1, "error_rows": 0, "warning_rows": 0, "conflict_rows": 0, "can_commit": True},
            "rows": [],
        }

        with patch("app.main.create_tag_import_job_from_upload", return_value=validate_result) as create_job:
            response = client.post(
                "/api/projects/project-1/tag-imports/validate",
                files={"file": ("tags.xlsx", b"fake-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": validate_result})
        create_job.assert_called_once()

    def test_returns_400_for_invalid_excel_upload(self):
        with patch("app.main.create_tag_import_job_from_upload", side_effect=ValueError("Uploaded file is not a valid .xlsx workbook")):
            response = client.post(
                "/api/projects/project-1/tag-imports/validate",
                files={"file": ("tags.xlsx", b"", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"detail": "Uploaded file is not a valid .xlsx workbook"})

    def test_updates_tag_import_row(self):
        patched = {
            "job_id": "job-1",
            "summary": {"total_rows": 1, "ready_rows": 1, "error_rows": 0, "warning_rows": 0, "conflict_rows": 0, "can_commit": True},
            "row": {"id": "row-1", "status": "ready"},
        }

        with patch("app.main.patch_tag_import_row", return_value=patched) as patch_row:
            response = client.patch(
                "/api/projects/project-1/tag-imports/job-1/rows/row-1",
                json={"values": {"pbs_code": "UNIT-100"}},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": patched})
        patch_row.assert_called_once_with("project-1", "job-1", "row-1", {"values": {"pbs_code": "UNIT-100"}})

    def test_lists_tag_import_rows(self):
        listing = {
            "job_id": "job-1",
            "summary": {"total_rows": 5, "ready_rows": 3, "error_rows": 1, "warning_rows": 0, "conflict_rows": 1, "can_commit": False},
            "rows": [{"id": "row-1", "status": "error"}],
            "page": 2,
            "page_size": 10,
            "total_pages": 1,
        }

        with patch("app.main.get_tag_import_job_detail", return_value=listing) as get_job:
            response = client.get("/api/projects/project-1/tag-imports/job-1?status=error&page=2&page_size=10")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": listing})
        get_job.assert_called_once_with("project-1", "job-1", status="error", page=2, page_size=10)

    def test_commits_tag_import_job(self):
        result = {
            "job_id": "job-1",
            "created_count": 2,
            "updated_count": 1,
            "skipped_count": 1,
            "failed_count": 0,
            "failures": [],
        }

        with patch("app.main.commit_tag_import_job", return_value=result) as commit_job:
            response = client.post(
                "/api/projects/project-1/tag-imports/job-1/commit",
                json={"conflict_actions": [{"row_id": "row-2", "action": "update"}]},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": result})
        commit_job.assert_called_once_with(
            "project-1",
            "job-1",
            [{"row_id": "row-2", "action": "update"}],
        )


if __name__ == "__main__":
    unittest.main()
