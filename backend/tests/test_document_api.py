import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from psycopg import IntegrityError

from app.main import app


client = TestClient(app)


class DocumentApiTest(unittest.TestCase):
    def test_registers_document_delete_routes(self):
        routes = {
            route.path: set(route.methods)
            for route in app.routes
            if hasattr(route, "path") and hasattr(route, "methods")
        }

        self.assertIn(
            "DELETE",
            routes["/api/projects/{project_id}/documents/{document_id}"],
        )
        self.assertIn(
            "DELETE",
            routes["/api/projects/{project_id}/documents/{document_id}/revisions/{revision_id}"],
        )

    def test_lists_document_types(self):
        document_types = [
            {
                "id": "type-1",
                "code": "PID",
                "name": "P&ID",
                "description": "工艺流程图",
                "status": "active",
                "allowed_extensions": ["pdf", "dwg"],
                "metadata": {},
                "attribute_count": 2,
                "created_at": "2026-04-15T00:00:00Z",
                "updated_at": "2026-04-15T00:00:00Z",
            }
        ]

        with patch("app.main.list_document_types", return_value=document_types):
            response = client.get("/api/document-types")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": document_types})

    def test_creates_project_document(self):
        created = {
            "id": "doc-1",
            "project_id": "project-1",
            "document_no": "PID-1001",
            "title": "海管站总流程图",
            "document_type_id": "type-1",
            "document_type_code": "PID",
            "document_type_name": "P&ID",
            "discipline": "process",
            "attributes": {"area": "A"},
            "current_revision_id": None,
            "status": "active",
            "metadata": {},
            "created_at": "2026-04-15T00:00:00Z",
            "updated_at": "2026-04-15T00:00:00Z",
            "pbs_nodes": [],
            "pbs_node_ids": [],
            "tags": [],
            "tag_ids": [],
            "revisions": [],
        }

        with patch("app.main.create_project_document", return_value=created) as create_project_document:
            response = client.post(
                "/api/projects/project-1/documents",
                json={
                    "document_no": "PID-1001",
                    "title": "海管站总流程图",
                    "document_type_id": "type-1",
                    "discipline": "process",
                    "attributes": {"area": "A"},
                    "pbs_node_ids": [],
                    "tag_ids": [],
                    "status": "active",
                    "metadata": {},
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": created})
        create_project_document.assert_called_once_with(
            "project-1",
            {
                "document_no": "PID-1001",
                "title": "海管站总流程图",
                "document_type_id": "type-1",
                "discipline": "process",
                "attributes": {"area": "A"},
                "pbs_node_ids": [],
                "tag_ids": [],
                "status": "active",
                "metadata": {},
            },
        )

    def test_returns_409_for_duplicate_document_no(self):
        with patch("app.main.create_project_document", side_effect=IntegrityError("duplicate key")):
            response = client.post(
                "/api/projects/project-1/documents",
                json={
                    "document_no": "PID-1001",
                    "title": "海管站总流程图",
                    "document_type_id": "type-1",
                    "discipline": "process",
                    "attributes": {},
                    "pbs_node_ids": [],
                    "tag_ids": [],
                    "status": "active",
                    "metadata": {},
                },
            )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json(), {"detail": "Document number already exists in this project"})

    def test_returns_project_document_detail(self):
        detail = {
            "id": "doc-1",
            "project_id": "project-1",
            "document_no": "PID-1001",
            "title": "海管站总流程图",
            "document_type_id": "type-1",
            "document_type_code": "PID",
            "document_type_name": "P&ID",
            "discipline": "process",
            "attributes": {},
            "current_revision_id": "rev-1",
            "status": "active",
            "metadata": {},
            "created_at": "2026-04-15T00:00:00Z",
            "updated_at": "2026-04-15T00:00:00Z",
            "pbs_nodes": [],
            "pbs_node_ids": [],
            "tags": [],
            "tag_ids": [],
            "revisions": [],
        }

        with patch("app.main.get_project_document_detail", return_value=detail):
            response = client.get("/api/projects/project-1/documents/doc-1")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": detail})

    def test_returns_404_for_missing_document_detail(self):
        with patch("app.main.get_project_document_detail", return_value=None):
            response = client.get("/api/projects/project-1/documents/missing")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {"detail": "Document not found"})

    def test_deletes_project_document(self):
        deleted = {
            "id": "doc-1",
            "project_id": "project-1",
            "document_no": "PID-1001",
            "title": "海管站总流程图",
            "document_type_id": "type-1",
            "discipline": "process",
            "attributes": {},
            "current_revision_id": "rev-1",
            "status": "active",
            "metadata": {},
            "created_at": "2026-04-15T00:00:00Z",
            "updated_at": "2026-04-15T00:00:00Z",
        }

        with patch("app.main.delete_project_document", return_value=deleted) as delete_document:
            response = client.delete("/api/projects/project-1/documents/doc-1")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": deleted})
        delete_document.assert_called_once_with("project-1", "doc-1")

    def test_returns_404_for_missing_document_delete(self):
        with patch("app.main.delete_project_document", return_value=None):
            response = client.delete("/api/projects/project-1/documents/missing")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {"detail": "Document not found"})

    def test_creates_document_revision(self):
        revision = {
            "id": "rev-1",
            "document_id": "doc-1",
            "revision_no": "A",
            "state": "issued",
            "is_current": True,
            "issued_at": "2026-04-15T00:00:00Z",
            "change_summary": "首版发放",
            "created_at": "2026-04-15T00:00:00Z",
            "updated_at": "2026-04-15T00:00:00Z",
            "files": [],
        }

        with patch("app.main.create_project_document_revision", return_value=revision) as create_revision:
            response = client.post(
                "/api/projects/project-1/documents/doc-1/revisions",
                json={
                    "revision_no": "A",
                    "state": "issued",
                    "issued_at": "2026-04-15T00:00:00Z",
                    "change_summary": "首版发放",
                    "set_as_current": True,
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": revision})
        create_revision.assert_called_once()

    def test_deletes_document_revision(self):
        revision = {
            "id": "rev-1",
            "document_id": "doc-1",
            "revision_no": "A",
            "state": "issued",
            "is_current": True,
            "issued_at": "2026-04-15T00:00:00Z",
            "change_summary": "首版发放",
            "created_at": "2026-04-15T00:00:00Z",
            "updated_at": "2026-04-15T00:00:00Z",
        }

        with patch("app.main.delete_project_document_revision", return_value=revision) as delete_revision:
            response = client.delete("/api/projects/project-1/documents/doc-1/revisions/rev-1")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": revision})
        delete_revision.assert_called_once_with("project-1", "doc-1", "rev-1")

    def test_returns_404_for_missing_document_revision_delete(self):
        with patch("app.main.delete_project_document_revision", return_value=None):
            response = client.delete("/api/projects/project-1/documents/doc-1/revisions/missing")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {"detail": "Revision not found"})

    def test_initiates_document_file_upload(self):
        payload = {
            "file_id": "file-1",
            "upload_url": "http://minio/upload",
            "upload_headers": {"Content-Type": "application/pdf"},
            "expires_at": "2026-04-15T00:15:00Z",
            "bucket": "smart-design-documents",
            "object_key": "projects/project-1/documents/doc-1/revisions/rev-1/file-1-a.pdf",
            "preview_mode": "inline",
            "file": {
                "id": "file-1",
                "status": "pending_upload",
            },
        }

        with patch("app.main.initiate_document_file_upload", return_value=payload) as initiate_upload:
            response = client.post(
                "/api/projects/project-1/documents/doc-1/revisions/rev-1/files/initiate",
                json={
                    "filename": "a.pdf",
                    "file_role": "primary",
                    "relative_path": "issued/a.pdf",
                    "content_type": "application/pdf",
                    "size_bytes": 1024,
                    "checksum_sha256": "abc",
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": payload})
        initiate_upload.assert_called_once()

    def test_completes_document_file_upload(self):
        file_payload = {
            "id": "file-1",
            "revision_id": "rev-1",
            "file_role": "primary",
            "original_filename": "a.pdf",
            "relative_path": "issued/a.pdf",
            "storage_provider": "s3",
            "bucket": "smart-design-documents",
            "object_key": "projects/project-1/documents/doc-1/revisions/rev-1/file-1-a.pdf",
            "mime_type": "application/pdf",
            "size_bytes": 1024,
            "checksum_sha256": "abc",
            "etag": "etag-1",
            "preview_mode": "inline",
            "status": "ready",
            "created_at": "2026-04-15T00:00:00Z",
            "updated_at": "2026-04-15T00:01:00Z",
        }

        with patch("app.main.complete_document_file_upload", return_value=file_payload) as complete_upload:
            response = client.post(
                "/api/projects/project-1/documents/doc-1/revisions/rev-1/files/file-1/complete",
                json={"etag": "etag-1"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": file_payload})
        complete_upload.assert_called_once_with(
            "project-1",
            "doc-1",
            "rev-1",
            "file-1",
            {"etag": "etag-1"},
        )

    def test_gets_document_file_access_url(self):
        payload = {
            "file_id": "file-1",
            "preview_mode": "inline",
            "preview_engine": "kkfileview",
            "preview_url": "http://kkfileview/onlinePreview?url=abc",
            "url": "http://minio/access",
            "expires_at": "2026-04-15T00:15:00Z",
            "disposition": "inline",
        }

        with patch("app.main.get_document_file_access", return_value=payload):
            response = client.get(
                "/api/projects/project-1/documents/doc-1/revisions/rev-1/files/file-1/access-url"
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": payload})

    def test_lists_document_visualizations(self):
        payload = [
            {
                "id": "visualization-1",
                "project_id": "project-1",
                "document_id": "doc-1",
                "revision_id": "rev-1",
                "source_file_id": "source-file",
                "source_file_name": "model.ifc",
                "preview_file_id": "preview-file",
                "preview_file_name": "model.spz",
                "annotation_manifest_file_id": "manifest-file",
                "annotation_manifest_file_name": "annotations.json",
                "metadata": {"units": "m"},
                "created_at": "2026-04-25T00:00:00Z",
                "updated_at": "2026-04-25T00:00:00Z",
            }
        ]

        with patch("app.main.list_document_visualizations", return_value=payload):
            response = client.get(
                "/api/projects/project-1/documents/doc-1/revisions/rev-1/visualizations"
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": payload})

    def test_creates_document_visualization(self):
        payload = {
            "id": "visualization-1",
            "project_id": "project-1",
            "document_id": "doc-1",
            "revision_id": "rev-1",
            "source_file_id": "source-file",
            "source_file_name": "model.ifc",
            "preview_file_id": "preview-file",
            "preview_file_name": "model.spz",
            "annotation_manifest_file_id": None,
            "annotation_manifest_file_name": None,
            "metadata": {"units": "m"},
            "created_at": "2026-04-25T00:00:00Z",
            "updated_at": "2026-04-25T00:00:00Z",
        }

        with patch("app.main.create_document_visualization", return_value=payload) as create_visualization:
            response = client.post(
                "/api/projects/project-1/documents/doc-1/revisions/rev-1/visualizations",
                json={
                    "source_file_id": "source-file",
                    "preview_file_id": "preview-file",
                    "metadata": {"units": "m"},
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": payload})
        create_visualization.assert_called_once_with(
            "project-1",
            "doc-1",
            "rev-1",
            {
                "source_file_id": "source-file",
                "preview_file_id": "preview-file",
                "annotation_manifest_file_id": None,
                "metadata": {"units": "m"},
            },
        )

    def test_returns_409_for_duplicate_document_visualization(self):
        with patch("app.main.create_document_visualization", side_effect=IntegrityError("duplicate key")):
            response = client.post(
                "/api/projects/project-1/documents/doc-1/revisions/rev-1/visualizations",
                json={
                    "source_file_id": "source-file",
                    "preview_file_id": "preview-file",
                    "metadata": {},
                },
            )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json(), {"detail": "Visualization already exists for this preview file"})

    def test_gets_document_visualization_access(self):
        payload = {
            "visualization_id": "visualization-1",
            "viewer_url": "/api/projects/project-1/documents/doc-1/revisions/rev-1/visualizations/visualization-1/spark/plant.rad",
            "source_url": "http://minio/source",
            "annotation_manifest_url": None,
            "asset_mode": "rad_chunked",
            "expires_at": "2026-04-15T00:15:00Z",
            "metadata": {"units": "m"},
            "preview_file_name": "plant.rad",
            "source_file_name": "plant.rvm",
        }

        with patch("app.main.get_document_visualization_access", return_value=payload):
            response = client.get(
                "/api/projects/project-1/documents/doc-1/revisions/rev-1/visualizations/visualization-1/access"
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": payload})

    def test_lists_document_visualization_objects(self):
        payload = [
            {
                "id": "object-1",
                "visualization_id": "visualization-1",
                "target_kind": "tag",
                "target_id": "tag-1",
                "label": "Pump P-101",
                "resolver_type": "bbox",
                "coordinate_space": "splat_local",
                "anchor_position": None,
                "primitive": {"type": "box", "center": [0, 0, 0], "size": [1, 1, 1]},
                "geometry_asset_id": None,
                "priority": 10,
                "visible": True,
                "selectable": True,
                "highlightable": True,
                "metadata": {},
                "target_summary": {"id": "tag-1", "kind": "tag", "code": "P-101", "name": "Pump P-101"},
                "created_at": "2026-04-25T00:00:00Z",
                "updated_at": "2026-04-25T00:00:00Z",
            }
        ]

        with patch("app.main.list_document_visualization_objects", return_value=payload):
            response = client.get(
                "/api/projects/project-1/documents/doc-1/revisions/rev-1/visualizations/visualization-1/objects"
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": payload})

    def test_creates_document_visualization_object(self):
        payload = {
            "id": "object-1",
            "visualization_id": "visualization-1",
            "target_kind": "custom",
            "target_id": "pump-1",
            "label": "Pump P-101",
            "resolver_type": "bbox",
            "coordinate_space": "splat_local",
            "anchor_position": None,
            "primitive": {"type": "box", "center": [0, 0, 0], "size": [1, 1, 1]},
            "geometry_asset_id": None,
            "priority": 10,
            "visible": True,
            "selectable": True,
            "highlightable": True,
            "metadata": {},
            "target_summary": None,
            "created_at": "2026-04-25T00:00:00Z",
            "updated_at": "2026-04-25T00:00:00Z",
        }

        with patch("app.main.create_document_visualization_object", return_value=payload) as create_object:
            response = client.post(
                "/api/projects/project-1/documents/doc-1/revisions/rev-1/visualizations/visualization-1/objects",
                json={
                    "target_kind": "custom",
                    "target_id": "pump-1",
                    "label": "Pump P-101",
                    "resolver_type": "bbox",
                    "primitive": {"type": "box", "center": [0, 0, 0], "size": [1, 1, 1]},
                    "priority": 10,
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": payload})
        create_object.assert_called_once_with(
            "project-1",
            "doc-1",
            "rev-1",
            "visualization-1",
            {
                "target_kind": "custom",
                "target_id": "pump-1",
                "label": "Pump P-101",
                "resolver_type": "bbox",
                "coordinate_space": "splat_local",
                "anchor_position": None,
                "primitive": {"type": "box", "center": [0.0, 0.0, 0.0], "size": [1.0, 1.0, 1.0], "radius": None, "height": None, "quaternion": None},
                "geometry_asset_id": None,
                "priority": 10,
                "visible": True,
                "selectable": True,
                "highlightable": True,
                "metadata": {},
            },
        )

    def test_rejects_invalid_document_visualization_object_primitive(self):
        response = client.post(
            "/api/projects/project-1/documents/doc-1/revisions/rev-1/visualizations/visualization-1/objects",
            json={
                "target_kind": "custom",
                "target_id": "pump-1",
                "label": "Pump P-101",
                "resolver_type": "bbox",
                "primitive": {"type": "box", "center": [0, 0, 0]},
            },
        )

        self.assertEqual(response.status_code, 422)

    def test_returns_404_for_missing_document_visualization_object_target(self):
        with patch("app.main.create_document_visualization_object", side_effect=ValueError("Target not found")):
            response = client.post(
                "/api/projects/project-1/documents/doc-1/revisions/rev-1/visualizations/visualization-1/objects",
                json={
                    "target_kind": "tag",
                    "target_id": "missing-tag",
                    "label": "Missing tag",
                    "anchor_position": [0, 0, 0],
                },
            )

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {"detail": "Target not found"})

    def test_streams_document_visualization_spark_asset_with_range(self):
        with patch(
            "app.main.get_document_visualization_spark_asset",
            return_value={
                "filename": "plant.rad",
                "content": b"0123456789",
                "mime_type": "application/octet-stream",
                "size_bytes": 10,
            },
        ):
            response = client.get(
                "/api/projects/project-1/documents/doc-1/revisions/rev-1/visualizations/visualization-1/spark/plant.rad",
                headers={"Range": "bytes=2-5"},
            )

        self.assertEqual(response.status_code, 206)
        self.assertEqual(response.content, b"2345")
        self.assertEqual(response.headers["content-range"], "bytes 2-5/10")

    def test_rejects_invalid_spark_asset_range(self):
        with patch(
            "app.main.get_document_visualization_spark_asset",
            return_value={
                "filename": "plant.rad",
                "content": b"0123456789",
                "mime_type": "application/octet-stream",
                "size_bytes": 10,
            },
        ):
            response = client.get(
                "/api/projects/project-1/documents/doc-1/revisions/rev-1/visualizations/visualization-1/spark/plant.rad",
                headers={"Range": "bytes=20-30"},
            )

        self.assertEqual(response.status_code, 416)

    def test_lists_document_conversion_jobs(self):
        payload = [
            {
                "id": "job-1",
                "project_id": "project-1",
                "document_id": "doc-1",
                "revision_id": "rev-1",
                "source_file_id": "source-file",
                "source_file_name": "plant.rvm",
                "output_file_id": "rad-file",
                "output_file_name": "plant.rad",
                "status": "completed",
                "input_format": "rvm",
                "output_format": "rad",
                "error": None,
                "metadata": {},
                "attempts": 1,
                "created_at": "2026-04-25T00:00:00Z",
                "started_at": "2026-04-25T00:00:01Z",
                "finished_at": "2026-04-25T00:00:10Z",
                "updated_at": "2026-04-25T00:00:10Z",
            }
        ]

        with patch("app.main.list_conversion_jobs_for_revision", return_value=payload):
            response = client.get(
                "/api/projects/project-1/documents/doc-1/revisions/rev-1/conversion-jobs"
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": payload})

    def test_creates_document_conversion_job(self):
        payload = {
            "id": "job-1",
            "source_file_id": "source-file",
            "status": "queued",
            "input_format": "rvm",
            "output_format": "rad",
        }

        with patch("app.main.create_conversion_job_for_file", return_value=payload) as create_job:
            response = client.post(
                "/api/projects/project-1/documents/doc-1/revisions/rev-1/files/source-file/conversion-jobs"
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": payload})
        create_job.assert_called_once_with("project-1", "doc-1", "rev-1", "source-file")

    def test_retries_document_conversion_job(self):
        payload = {
            "id": "job-1",
            "source_file_id": "source-file",
            "status": "queued",
            "input_format": "rvm",
            "output_format": "rad",
        }

        with patch("app.main.retry_conversion_job_for_revision", return_value=payload) as retry_job:
            response = client.post(
                "/api/projects/project-1/documents/doc-1/revisions/rev-1/conversion-jobs/job-1/retry"
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": payload})
        retry_job.assert_called_once_with("project-1", "doc-1", "rev-1", "job-1")


if __name__ == "__main__":
    unittest.main()
