import unittest
from unittest.mock import Mock, patch

from app.document_service import (
    complete_document_file_upload,
    delete_project_document,
    delete_project_document_revision,
    get_document_file_access,
    get_document_visualization_access,
    get_document_visualization_spark_asset,
    initiate_document_file_upload,
)


class DocumentServiceTest(unittest.TestCase):
    def test_initiates_upload_and_persists_pending_file(self):
        storage = Mock()
        storage.provider = "s3"
        storage.build_object_key.return_value = "projects/project-1/documents/doc-1/revisions/rev-1/file-1-a.pdf"
        storage.create_upload_payload.return_value = {
            "upload_url": "http://minio/upload",
            "upload_headers": {"Content-Type": "application/pdf"},
            "expires_at": "2026-04-15T00:15:00Z",
            "bucket": "smart-design-documents",
            "object_key": "projects/project-1/documents/doc-1/revisions/rev-1/file-1-a.pdf",
        }

        with patch(
            "app.document_service.get_project_document_upload_context",
            return_value={"allowed_extensions": ["pdf"]},
        ), patch(
            "app.document_service.create_project_document_file_record",
            return_value={"id": "file-1", "status": "pending_upload"},
        ) as create_record:
            result = initiate_document_file_upload(
                "project-1",
                "doc-1",
                "rev-1",
                {
                    "filename": "a.pdf",
                    "file_role": "primary",
                    "relative_path": "issued/a.pdf",
                    "content_type": "application/pdf",
                    "size_bytes": 1024,
                    "checksum_sha256": "abc",
                },
                storage=storage,
            )

        self.assertIsNotNone(result)
        self.assertEqual(result["preview_mode"], "inline")
        self.assertEqual(result["upload_url"], "http://minio/upload")
        create_record.assert_called_once()
        create_args = create_record.call_args.args
        self.assertEqual(create_args[:3], ("project-1", "doc-1", "rev-1"))
        self.assertEqual(create_record.call_args.args[3]["object_key"], storage.build_object_key.return_value)

    def test_rejects_upload_extension_outside_document_type_policy(self):
        storage = Mock()

        with patch(
            "app.document_service.get_project_document_upload_context",
            return_value={"allowed_extensions": ["pdf"]},
        ):
            with self.assertRaisesRegex(ValueError, "not allowed for this document type"):
                initiate_document_file_upload(
                    "project-1",
                    "doc-1",
                    "rev-1",
                    {
                        "filename": "drawing.dwg",
                        "file_role": "primary",
                        "content_type": "application/acad",
                        "size_bytes": 1024,
                    },
                    storage=storage,
                )

        storage.build_object_key.assert_not_called()

    def test_rejects_upload_with_mismatched_content_type(self):
        with patch(
            "app.document_service.get_project_document_upload_context",
            return_value={"allowed_extensions": ["pdf"]},
        ):
            with self.assertRaisesRegex(ValueError, "Content type does not match"):
                initiate_document_file_upload(
                    "project-1",
                    "doc-1",
                    "rev-1",
                    {
                        "filename": "a.pdf",
                        "file_role": "primary",
                        "content_type": "image/png",
                        "size_bytes": 1024,
                    },
                    storage=Mock(),
                )

    def test_rejects_upload_over_configured_size_limit(self):
        with patch.dict(
            "os.environ",
            {"SMART_DESIGN_DOCUMENT_UPLOAD_MAX_BYTES": "1024"},
            clear=False,
        ), patch(
            "app.document_service.get_project_document_upload_context",
            return_value={"allowed_extensions": ["pdf"]},
        ):
            with self.assertRaisesRegex(ValueError, "1024 bytes or smaller"):
                initiate_document_file_upload(
                    "project-1",
                    "doc-1",
                    "rev-1",
                    {
                        "filename": "a.pdf",
                        "file_role": "primary",
                        "content_type": "application/pdf",
                        "size_bytes": 1025,
                    },
                    storage=Mock(),
                )

    def test_allows_spark_asset_over_general_document_size_limit(self):
        storage = Mock()
        storage.provider = "s3"
        storage.build_object_key.return_value = "projects/project-1/documents/doc-1/revisions/rev-1/file-1-plant.rad"
        storage.create_upload_payload.return_value = {
            "upload_url": "http://minio/upload",
            "upload_headers": {"Content-Type": "application/octet-stream"},
            "expires_at": "2026-04-15T00:15:00Z",
            "bucket": "smart-design-documents",
            "object_key": "projects/project-1/documents/doc-1/revisions/rev-1/file-1-plant.rad",
        }

        with patch.dict(
            "os.environ",
            {
                "SMART_DESIGN_DOCUMENT_UPLOAD_MAX_BYTES": "1024",
                "SMART_DESIGN_3D_MODEL_UPLOAD_MAX_BYTES": "4096",
            },
            clear=False,
        ), patch(
            "app.document_service.get_project_document_upload_context",
            return_value={"allowed_extensions": []},
        ), patch(
            "app.document_service.create_project_document_file_record",
            return_value={"id": "file-1", "status": "pending_upload"},
        ):
            result = initiate_document_file_upload(
                "project-1",
                "doc-1",
                "rev-1",
                {
                    "filename": "plant.rad",
                    "file_role": "reference",
                    "content_type": "application/octet-stream",
                    "size_bytes": 2048,
                },
                storage=storage,
            )

        self.assertEqual(result["preview_mode"], "download")

    def test_rejects_spark_asset_over_3d_size_limit(self):
        with patch.dict(
            "os.environ",
            {
                "SMART_DESIGN_DOCUMENT_UPLOAD_MAX_BYTES": "1024",
                "SMART_DESIGN_3D_MODEL_UPLOAD_MAX_BYTES": "4096",
            },
            clear=False,
        ), patch(
            "app.document_service.get_project_document_upload_context",
            return_value={"allowed_extensions": []},
        ):
            with self.assertRaisesRegex(ValueError, "4096 bytes or smaller"):
                initiate_document_file_upload(
                    "project-1",
                    "doc-1",
                    "rev-1",
                    {
                        "filename": "plant.rad",
                        "file_role": "reference",
                        "content_type": "application/octet-stream",
                        "size_bytes": 4097,
                    },
                    storage=Mock(),
                )

    def test_completes_upload_from_object_storage_metadata(self):
        storage = Mock()
        storage.stat_object.return_value = {
            "etag": "etag-1",
            "content_length": 2048,
            "content_type": "application/pdf",
        }

        with patch(
            "app.document_service.get_project_document_file",
            return_value={
                "id": "file-1",
                "original_filename": "a.pdf",
                "object_key": "projects/project-1/documents/doc-1/revisions/rev-1/file-1-a.pdf",
                "mime_type": "application/pdf",
                "size_bytes": 1024,
            },
        ), patch(
            "app.document_service.get_project_document_upload_context",
            return_value={"allowed_extensions": ["pdf"]},
        ), patch(
            "app.document_service.mark_project_document_file_ready",
            return_value={"id": "file-1", "status": "ready", "etag": "etag-1"},
        ) as mark_ready, patch("app.document_service.handle_uploaded_document_file") as handle_uploaded:
            result = complete_document_file_upload("project-1", "doc-1", "rev-1", "file-1", storage=storage)

        self.assertEqual(result["status"], "ready")
        mark_ready.assert_called_once_with(
            "project-1",
            "doc-1",
            "rev-1",
            "file-1",
            {"etag": "etag-1", "mime_type": "application/pdf", "size_bytes": 2048},
        )
        handle_uploaded.assert_called_once_with("project-1", "doc-1", "rev-1", result)

    def test_allows_rvm_upload_and_rejects_vue_upload(self):
        storage = Mock()
        storage.provider = "s3"
        storage.build_object_key.return_value = "projects/project-1/documents/doc-1/revisions/rev-1/file-1-plant.rvm"
        storage.create_upload_payload.return_value = {
            "upload_url": "http://minio/upload",
            "upload_headers": {"Content-Type": "application/octet-stream"},
            "expires_at": "2026-04-15T00:15:00Z",
            "bucket": "smart-design-documents",
            "object_key": "projects/project-1/documents/doc-1/revisions/rev-1/file-1-plant.rvm",
        }

        with patch(
            "app.document_service.get_project_document_upload_context",
            return_value={"allowed_extensions": []},
        ), patch(
            "app.document_service.create_project_document_file_record",
            return_value={"id": "file-1", "status": "pending_upload"},
        ):
            rvm_result = initiate_document_file_upload(
                "project-1",
                "doc-1",
                "rev-1",
                {
                    "filename": "plant.rvm",
                    "file_role": "source",
                    "content_type": "application/octet-stream",
                    "size_bytes": 1024,
                },
                storage=storage,
            )
            with self.assertRaisesRegex(ValueError, "not supported by the Spark preview pipeline"):
                initiate_document_file_upload(
                    "project-1",
                    "doc-1",
                    "rev-1",
                    {
                        "filename": "plant.vue",
                        "file_role": "source",
                        "content_type": "application/octet-stream",
                        "size_bytes": 1024,
                    },
                    storage=storage,
                )

        self.assertEqual(rvm_result["preview_mode"], "download")

    def test_complete_upload_revalidates_object_storage_metadata(self):
        storage = Mock()
        storage.stat_object.return_value = {
            "etag": "etag-1",
            "content_length": 2048,
            "content_type": "image/png",
        }

        with patch(
            "app.document_service.get_project_document_file",
            return_value={
                "id": "file-1",
                "original_filename": "a.pdf",
                "object_key": "projects/project-1/documents/doc-1/revisions/rev-1/file-1-a.pdf",
                "mime_type": "application/pdf",
                "size_bytes": 1024,
            },
        ), patch(
            "app.document_service.get_project_document_upload_context",
            return_value={"allowed_extensions": ["pdf"]},
        ), patch("app.document_service.mark_project_document_file_ready") as mark_ready:
            with self.assertRaisesRegex(ValueError, "Content type does not match"):
                complete_document_file_upload("project-1", "doc-1", "rev-1", "file-1", storage=storage)

        mark_ready.assert_not_called()

    def test_gets_access_url_for_ready_file(self):
        storage = Mock()
        storage.create_access_payload.return_value = {
            "url": "http://minio/access",
            "expires_at": "2026-04-15T00:15:00Z",
            "disposition": "inline",
        }

        with patch(
            "app.document_service.get_project_document_file",
            return_value={
                "id": "file-1",
                "original_filename": "a.pdf",
                "object_key": "projects/project-1/documents/doc-1/revisions/rev-1/file-1-a.pdf",
                "mime_type": "application/pdf",
                "preview_mode": "inline",
                "status": "ready",
            },
        ):
            result = get_document_file_access("project-1", "doc-1", "rev-1", "file-1", storage=storage)

        self.assertEqual(result["url"], "http://minio/access")
        self.assertEqual(result["preview_mode"], "inline")
        self.assertEqual(result["preview_engine"], "browser")
        self.assertEqual(result["preview_url"], "http://minio/access")

    def test_builds_kkfileview_preview_url_when_enabled(self):
        storage = Mock()
        storage.create_access_payload.return_value = {
            "url": "http://minio/access?X-Amz-Signature=abc",
            "expires_at": "2026-04-15T00:15:00Z",
            "disposition": "attachment",
        }

        with patch.dict(
            "os.environ",
            {
                "KKFILEVIEW_ENABLED": "true",
                "KKFILEVIEW_BASE_URL": "http://127.0.0.1:8012",
            },
            clear=False,
        ), patch(
            "app.document_service.get_project_document_file",
            return_value={
                "id": "file-1",
                "original_filename": "drawing.dwg",
                "object_key": "projects/project-1/documents/doc-1/revisions/rev-1/file-1-drawing.dwg",
                "mime_type": "application/acad",
                "preview_mode": "download",
                "status": "ready",
            },
        ):
            result = get_document_file_access("project-1", "doc-1", "rev-1", "file-1", storage=storage)

        self.assertEqual(result["preview_engine"], "kkfileview")
        self.assertTrue(result["preview_url"].startswith("http://127.0.0.1:8012/onlinePreview?url="))
        self.assertEqual(result["url"], "http://minio/access?X-Amz-Signature=abc")

    def test_gets_access_url_with_preview_endpoint_when_configured(self):
        storage = Mock()
        storage.create_access_payload.return_value = {
            "url": "http://www.waynehuang.top:9000/access?X-Amz-Signature=abc",
            "expires_at": "2026-04-15T00:15:00Z",
            "disposition": "attachment",
        }

        with patch(
            "app.document_service.get_document_preview_endpoint",
            return_value="http://www.waynehuang.top:9000",
        ), patch(
            "app.document_service.get_project_document_file",
            return_value={
                "id": "file-1",
                "original_filename": "drawing.dwg",
                "object_key": "projects/project-1/documents/doc-1/revisions/rev-1/file-1-drawing.dwg",
                "mime_type": "application/acad",
                "preview_mode": "download",
                "status": "ready",
            },
        ):
            result = get_document_file_access("project-1", "doc-1", "rev-1", "file-1", storage=storage)

        storage.create_access_payload.assert_called_once_with(
            object_key="projects/project-1/documents/doc-1/revisions/rev-1/file-1-drawing.dwg",
            filename="drawing.dwg",
            content_type="application/acad",
            preview_mode="download",
            endpoint="http://www.waynehuang.top:9000",
        )
        self.assertEqual(result["url"], "http://www.waynehuang.top:9000/access?X-Amz-Signature=abc")

    def test_rejects_access_for_non_ready_file(self):
        with patch(
            "app.document_service.get_project_document_file",
            return_value={
                "id": "file-1",
                "original_filename": "a.pdf",
                "object_key": "projects/project-1/documents/doc-1/revisions/rev-1/file-1-a.pdf",
                "mime_type": "application/pdf",
                "preview_mode": "inline",
                "status": "pending_upload",
            },
        ):
            with self.assertRaises(ValueError) as ctx:
                get_document_file_access("project-1", "doc-1", "rev-1", "file-1", storage=Mock())

        self.assertEqual(str(ctx.exception), "File is not ready for access")

    def test_gets_visualization_access_with_backend_spark_route(self):
        storage = Mock()
        storage.create_access_payload.side_effect = [
            {
                "url": "http://minio/source",
                "expires_at": "2026-04-15T00:15:00Z",
                "disposition": "attachment",
            }
        ]

        with patch(
            "app.document_service.get_document_visualization",
            return_value={
                "id": "visualization-1",
                "source_object_key": "source-key",
                "source_file_name": "plant.rvm",
                "source_mime_type": "application/octet-stream",
                "source_preview_mode": "download",
                "preview_file_name": "plant.rad",
                "metadata": {"units": "m"},
                "annotation_manifest_file_id": None,
            },
        ), patch(
            "app.document_service.list_document_visualization_assets",
            return_value=[
                {
                    "asset_role": "header",
                    "filename": "plant.rad",
                    "object_key": "header-key",
                    "mime_type": "application/octet-stream",
                },
                {
                    "asset_role": "chunk",
                    "filename": "plant-lod-0.radc",
                    "object_key": "chunk-key",
                    "mime_type": "application/octet-stream",
                },
            ],
        ):
            result = get_document_visualization_access(
                "project-1",
                "doc-1",
                "rev-1",
                "visualization-1",
                storage=storage,
            )

        self.assertEqual(result["asset_mode"], "rad_chunked")
        self.assertEqual(result["source_url"], "http://minio/source")
        self.assertIn("/visualizations/visualization-1/spark/plant.rad", result["viewer_url"])

    def test_gets_visualization_spark_asset_by_registered_filename(self):
        storage = Mock()
        storage.get_object_bytes.return_value = b"RAD0-data"

        with patch(
            "app.document_service.get_document_visualization_asset",
            return_value={
                "filename": "plant.rad",
                "object_key": "header-key",
                "mime_type": "application/octet-stream",
                "size_bytes": 9,
            },
        ):
            result = get_document_visualization_spark_asset(
                "project-1",
                "doc-1",
                "rev-1",
                "visualization-1",
                "plant.rad",
                storage=storage,
            )

        self.assertEqual(result["content"], b"RAD0-data")
        storage.get_object_bytes.assert_called_once_with(object_key="header-key")

    def test_rejects_visualization_spark_asset_path_traversal(self):
        with self.assertRaisesRegex(ValueError, "filename is invalid"):
            get_document_visualization_spark_asset(
                "project-1",
                "doc-1",
                "rev-1",
                "visualization-1",
                "../plant.rad",
                storage=Mock(),
            )

    def test_deletes_document_and_storage_objects(self):
        storage = Mock()
        deleted = {"id": "doc-1", "document_no": "PID-1001"}
        storage_objects = [
            {"bucket": "smart-design-documents", "object_key": "projects/project-1/file-a.pdf"},
            {"bucket": "smart-design-documents", "object_key": "projects/project-1/file-a.pdf"},
            {"bucket": "smart-design-documents", "object_key": "projects/project-1/file-b.pdf"},
        ]

        with patch(
            "app.document_service.delete_project_document_record",
            return_value=(deleted, storage_objects),
        ):
            result = delete_project_document("project-1", "doc-1", storage=storage)

        self.assertEqual(result, deleted)
        storage.delete_object.assert_any_call(
            bucket="smart-design-documents",
            object_key="projects/project-1/file-a.pdf",
        )
        storage.delete_object.assert_any_call(
            bucket="smart-design-documents",
            object_key="projects/project-1/file-b.pdf",
        )
        self.assertEqual(storage.delete_object.call_count, 2)

    def test_deletes_revision_and_storage_objects(self):
        storage = Mock()
        deleted = {"id": "rev-1", "revision_no": "A"}
        storage_objects = [{"bucket": "smart-design-documents", "object_key": "projects/project-1/rev-a.pdf"}]

        with patch(
            "app.document_service.delete_project_document_revision_record",
            return_value=(deleted, storage_objects),
        ):
            result = delete_project_document_revision("project-1", "doc-1", "rev-1", storage=storage)

        self.assertEqual(result, deleted)
        storage.delete_object.assert_called_once_with(
            bucket="smart-design-documents",
            object_key="projects/project-1/rev-a.pdf",
        )


if __name__ == "__main__":
    unittest.main()
