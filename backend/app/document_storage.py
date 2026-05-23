from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import mimetypes
import posixpath
import re

from .settings.config import get_settings


INLINE_CONTENT_TYPES = (
    "application/pdf",
    "image/",
    "text/",
)


def resolve_preview_mode(filename: str, content_type: str | None) -> str:
    normalized_type = (content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream").lower()
    if any(
        normalized_type == prefix or normalized_type.startswith(prefix)
        for prefix in INLINE_CONTENT_TYPES
    ):
        return "inline"
    return "download"


def _sanitize_filename(filename: str) -> str:
    sanitized = re.sub(r"[^A-Za-z0-9._-]+", "_", filename.strip())
    sanitized = re.sub(r"_+", "_", sanitized).strip("._")
    return sanitized or "file"


@dataclass(frozen=True)
class DocumentStorageConfig:
    endpoint: str
    preview_endpoint: str | None
    region: str
    bucket: str
    access_key: str
    secret_key: str
    presign_ttl_seconds: int
    key_prefix: str

    @classmethod
    def from_env(cls) -> "DocumentStorageConfig":
        settings = get_settings().document_storage
        return cls(
            endpoint=settings.endpoint,
            preview_endpoint=settings.preview_endpoint,
            region=settings.region,
            bucket=settings.bucket,
            access_key=settings.access_key,
            secret_key=settings.secret_key,
            presign_ttl_seconds=settings.presign_ttl_seconds,
            key_prefix=settings.key_prefix,
        )


def _is_local_minio_endpoint(endpoint: str) -> bool:
    normalized = endpoint.strip().lower()
    return normalized.startswith("http://127.0.0.1:9000") or normalized.startswith("http://localhost:9000")


def get_document_preview_endpoint() -> str | None:
    return get_settings().document_storage.preview_endpoint


class S3PresignStorage:
    provider = "s3"

    def __init__(self, config: DocumentStorageConfig):
        self.config = config

    def build_object_key(
        self,
        project_id: str,
        document_id: str,
        revision_id: str,
        file_id: str,
        filename: str,
    ) -> str:
        filename_part = f"{file_id}-{_sanitize_filename(filename)}"
        suffix = posixpath.join(
            "projects",
            project_id,
            "documents",
            document_id,
            "revisions",
            revision_id,
            filename_part,
        )
        if not self.config.key_prefix:
            return suffix
        return posixpath.join(self.config.key_prefix, suffix)

    def build_settings_object_key(self, filename: str) -> str:
        suffix = posixpath.join("settings", _sanitize_filename(filename))
        if not self.config.key_prefix:
            return suffix
        return posixpath.join(self.config.key_prefix, suffix)

    def put_object(self, *, object_key: str, content: bytes, content_type: str) -> None:
        client = self._create_client()
        client.put_object(
            Bucket=self.config.bucket,
            Key=object_key,
            Body=content,
            ContentType=content_type,
        )

    def get_object_bytes(self, *, object_key: str) -> bytes:
        client = self._create_client()
        response = client.get_object(Bucket=self.config.bucket, Key=object_key)
        return response["Body"].read()

    def create_upload_payload(self, *, object_key: str, content_type: str) -> dict:
        client = self._create_client(endpoint=self.config.preview_endpoint)
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=self.config.presign_ttl_seconds)
        upload_url = client.generate_presigned_url(
            ClientMethod="put_object",
            Params={
                "Bucket": self.config.bucket,
                "Key": object_key,
                "ContentType": content_type,
            },
            ExpiresIn=self.config.presign_ttl_seconds,
        )
        return {
            "upload_url": upload_url,
            "upload_headers": {"Content-Type": content_type},
            "expires_at": expires_at.isoformat(),
            "bucket": self.config.bucket,
            "object_key": object_key,
        }

    def create_access_payload(
        self,
        *,
        object_key: str,
        filename: str,
        content_type: str,
        preview_mode: str,
        endpoint: str | None = None,
    ) -> dict:
        client = self._create_client(endpoint=endpoint)
        disposition = "inline" if preview_mode == "inline" else "attachment"
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=self.config.presign_ttl_seconds)
        url = client.generate_presigned_url(
            ClientMethod="get_object",
            Params={
                "Bucket": self.config.bucket,
                "Key": object_key,
                "ResponseContentDisposition": f'{disposition}; filename="{_sanitize_filename(filename)}"',
                "ResponseContentType": content_type,
            },
            ExpiresIn=self.config.presign_ttl_seconds,
        )
        return {
            "url": url,
            "expires_at": expires_at.isoformat(),
            "disposition": disposition,
        }

    def stat_object(self, *, object_key: str) -> dict:
        client = self._create_client()
        response = client.head_object(Bucket=self.config.bucket, Key=object_key)
        return {
            "etag": str(response.get("ETag", "")).strip('"') or None,
            "content_length": int(response.get("ContentLength", 0)),
            "content_type": response.get("ContentType"),
        }

    def delete_object(self, *, object_key: str, bucket: str | None = None) -> None:
        client = self._create_client()
        client.delete_object(Bucket=(bucket or self.config.bucket), Key=object_key)

    def check_bucket_access(self) -> dict:
        client = self._create_client()
        try:
            client.head_bucket(Bucket=self.config.bucket)
        except Exception as error:
            response = getattr(error, "response", {}) or {}
            error_payload = response.get("Error", {}) or {}
            metadata = response.get("ResponseMetadata", {}) or {}
            return {
                "ok": False,
                "error_code": str(error_payload.get("Code") or type(error).__name__),
                "error_message": str(error_payload.get("Message") or error),
                "http_status": metadata.get("HTTPStatusCode"),
            }

        return {"ok": True}

    def _create_client(self, *, endpoint: str | None = None):
        if not self.config.bucket:
            raise ValueError("S3_BUCKET is required")
        endpoint_url = endpoint or self.config.endpoint
        if not endpoint_url:
            raise ValueError("S3_ENDPOINT is required")
        if not self.config.access_key or not self.config.secret_key:
            raise ValueError("S3_ACCESS_KEY and S3_SECRET_KEY are required")

        try:
            import boto3
            from botocore.config import Config
        except ImportError as error:  # pragma: no cover - exercised through runtime environment
            raise RuntimeError("boto3 is required for S3 document storage support") from error

        return boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            region_name=self.config.region,
            aws_access_key_id=self.config.access_key,
            aws_secret_access_key=self.config.secret_key,
            config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
        )


def get_document_storage() -> S3PresignStorage:
    return S3PresignStorage(DocumentStorageConfig.from_env())


def describe_document_storage() -> dict:
    config = DocumentStorageConfig.from_env()
    return {
        "endpoint": config.endpoint,
        "region": config.region,
        "bucket": config.bucket,
        "key_prefix": config.key_prefix or None,
        "access_key_configured": bool(config.access_key),
        "secret_key_configured": bool(config.secret_key),
        "local_minio_endpoint": _is_local_minio_endpoint(config.endpoint),
    }
