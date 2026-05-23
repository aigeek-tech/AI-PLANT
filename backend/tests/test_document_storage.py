import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock, patch

from app.document_storage import DocumentStorageConfig, S3PresignStorage, describe_document_storage


class DocumentStorageConfigTest(unittest.TestCase):
    def test_uses_local_minio_credentials_for_default_endpoint(self):
        with TemporaryDirectory() as temp_dir:
            empty_env_file = Path(temp_dir) / ".env"
            with patch.dict(os.environ, {}, clear=True), patch(
                "app.settings.config._default_env_file",
                return_value=empty_env_file,
            ):
                config = DocumentStorageConfig.from_env()

        self.assertEqual(config.endpoint, "http://127.0.0.1:9000")
        self.assertIsNone(config.preview_endpoint)
        self.assertEqual(config.bucket, "smart-design-documents")
        self.assertEqual(config.access_key, "minioadmin")
        self.assertEqual(config.secret_key, "minioadmin")

    def test_requires_explicit_credentials_for_non_local_endpoint(self):
        with patch.dict(os.environ, {"S3_ENDPOINT": "https://s3.example.com"}, clear=True):
            config = DocumentStorageConfig.from_env()

        self.assertEqual(config.endpoint, "https://s3.example.com")
        self.assertEqual(config.access_key, "")
        self.assertEqual(config.secret_key, "")

    def test_create_upload_payload_uses_preview_endpoint_for_browser_presigned_url(self):
        config = DocumentStorageConfig(
            endpoint="http://host.docker.internal:9000",
            preview_endpoint="http://www.waynehuang.top:9000",
            region="us-east-1",
            bucket="smart-design-documents",
            access_key="minioadmin",
            secret_key="minioadmin",
            presign_ttl_seconds=900,
            key_prefix="",
        )
        storage = S3PresignStorage(config)
        client = Mock()
        client.generate_presigned_url.return_value = "http://www.waynehuang.top:9000/signed-upload"

        with patch.object(storage, "_create_client", return_value=client) as create_client:
            result = storage.create_upload_payload(
                object_key="projects/project-1/file.rad",
                content_type="application/octet-stream",
            )

        create_client.assert_called_once_with(endpoint="http://www.waynehuang.top:9000")
        self.assertEqual(result["upload_url"], "http://www.waynehuang.top:9000/signed-upload")

    def test_describe_document_storage_hides_secrets(self):
        with patch.dict(
            os.environ,
            {
                "S3_ENDPOINT": "http://127.0.0.1:9000",
                "S3_BUCKET": "smart-design-documents",
                "S3_ACCESS_KEY": "minioadmin",
                "S3_SECRET_KEY": "minioadmin",
            },
            clear=True,
        ):
            result = describe_document_storage()

        self.assertEqual(result["endpoint"], "http://127.0.0.1:9000")
        self.assertEqual(result["bucket"], "smart-design-documents")
        self.assertTrue(result["access_key_configured"])
        self.assertTrue(result["secret_key_configured"])
        self.assertNotIn("minioadmin", str(result))

    def test_check_bucket_access_returns_minio_error_details(self):
        config = DocumentStorageConfig(
            endpoint="http://127.0.0.1:9000",
            preview_endpoint=None,
            region="us-east-1",
            bucket="smart-design-documents",
            access_key="minioadmin",
            secret_key="minioadmin",
            presign_ttl_seconds=900,
            key_prefix="",
        )
        storage = S3PresignStorage(config)

        class FakeClient:
            def head_bucket(self, **_kwargs):
                error = RuntimeError("Access denied")
                error.response = {
                    "Error": {
                        "Code": "InvalidAccessKeyId",
                        "Message": "The Access Key Id you provided does not exist in our records.",
                    },
                    "ResponseMetadata": {"HTTPStatusCode": 403},
                }
                raise error

        with patch.object(storage, "_create_client", return_value=FakeClient()):
            result = storage.check_bucket_access()

        self.assertEqual(
            result,
            {
                "ok": False,
                "error_code": "InvalidAccessKeyId",
                "error_message": "The Access Key Id you provided does not exist in our records.",
                "http_status": 403,
            },
        )


if __name__ == "__main__":
    unittest.main()
