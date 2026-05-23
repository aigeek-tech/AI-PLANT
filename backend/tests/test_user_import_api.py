import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


class UserImportApiTest(unittest.TestCase):
    def test_downloads_user_import_template(self):
        with patch("app.auth_api.build_user_import_template", return_value=b"template-bytes") as build_template:
            response = client.get("/api/auth/users/import-template")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.headers["content-type"],
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        self.assertEqual(response.content, b"template-bytes")
        build_template.assert_called_once()

    def test_downloads_user_export_workbook(self):
        with patch("app.auth_api.build_user_export_workbook", return_value=b"export-bytes") as build_export:
            response = client.get("/api/auth/users/export")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.headers["content-type"],
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        self.assertEqual(response.content, b"export-bytes")
        build_export.assert_called_once()

    def test_validates_uploaded_user_import_file(self):
        payload = {
            "job_id": "job-1",
            "summary": {
                "total_rows": 1,
                "create_rows": 1,
                "update_rows": 0,
                "skip_rows": 0,
                "ready_rows": 1,
                "error_rows": 0,
                "warning_rows": 0,
                "can_commit": True,
            },
            "rows": [],
        }
        with patch("app.auth_api.create_user_import_job_from_upload", return_value=payload) as create_job:
            response = client.post(
                "/api/auth/users/imports/validate",
                files={"file": ("users.xlsx", b"fake-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": payload})
        create_job.assert_called_once()

    def test_lists_user_import_job(self):
        payload = {
            "job_id": "job-1",
            "summary": {"total_rows": 2, "error_rows": 1, "warning_rows": 0, "can_commit": False},
            "rows": [{"id": "row-1", "status": "error"}],
            "page": 2,
            "page_size": 20,
            "total_pages": 1,
        }
        with patch("app.auth_api.get_user_import_job_detail", return_value=payload) as get_job:
            response = client.get("/api/auth/users/imports/job-1?status=error&page=2&page_size=20")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": payload})
        get_job.assert_called_once_with("job-1", status="error", page=2, page_size=20)

    def test_updates_user_import_row(self):
        payload = {
            "job_id": "job-1",
            "summary": {"total_rows": 1, "error_rows": 0, "warning_rows": 0, "can_commit": True},
            "row": {"id": "row-1", "status": "ready"},
        }
        with patch("app.auth_api.patch_user_import_row", return_value=payload) as patch_row:
            response = client.patch(
                "/api/auth/users/imports/job-1/rows/row-1",
                json={"values": {"display_name": "Alice Updated"}},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": payload})
        patch_row.assert_called_once_with("job-1", "row-1", {"values": {"display_name": "Alice Updated"}}, allow_role_management=True)

    def test_commits_user_import_job(self):
        payload = {
            "job_id": "job-1",
            "created_count": 1,
            "updated_count": 1,
            "skipped_count": 0,
            "failed_count": 0,
            "failures": [],
        }
        with (
            patch("app.auth_api.commit_user_import_job", return_value=payload) as commit_job,
            patch("app.auth_api.record_authorization_audit_log") as record_authorization_audit_log,
        ):
            response = client.post("/api/auth/users/imports/job-1/commit", json={})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": payload})
        commit_job.assert_called_once_with("job-1", granted_by="test-admin", allow_role_management=True)
        audit_metadata = record_authorization_audit_log.call_args.kwargs["metadata"]
        self.assertNotIn("password", audit_metadata)
        self.assertEqual(audit_metadata["created_count"], 1)


if __name__ == "__main__":
    unittest.main()
