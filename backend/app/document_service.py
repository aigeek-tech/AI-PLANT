from __future__ import annotations

import base64
import logging
import mimetypes
import os
import re
from urllib.parse import quote
from uuid import uuid4

from .document_repository import (
    create_project_document_file_record,
    delete_project_document_record,
    delete_project_document_revision_record,
    get_project_document_upload_context,
    get_project_document_file,
    mark_project_document_file_ready,
)
from .document_conversion_service import handle_uploaded_document_file
from .document_storage import get_document_preview_endpoint, get_document_storage, resolve_preview_mode
from .document_visualization_repository import (
    get_document_visualization,
    get_document_visualization_asset,
    list_document_visualization_assets,
)


DOCUMENT_UPLOAD_MAX_BYTES_ENV = "SMART_DESIGN_DOCUMENT_UPLOAD_MAX_BYTES"
THREE_D_MODEL_UPLOAD_MAX_BYTES_ENV = "SMART_DESIGN_3D_MODEL_UPLOAD_MAX_BYTES"
DEFAULT_DOCUMENT_UPLOAD_MAX_BYTES = 100 * 1024 * 1024
DEFAULT_3D_MODEL_UPLOAD_MAX_BYTES = 2 * 1024 * 1024 * 1024
logger = logging.getLogger(__name__)
DEFAULT_DOCUMENT_ALLOWED_EXTENSIONS = frozenset(
    {
        "csv",
        "doc",
        "docx",
        "dwg",
        "dxf",
        "glb",
        "gltf",
        "ifc",
        "json",
        "jpeg",
        "jpg",
        "nwd",
        "pdf",
        "ply",
        "png",
        "ppt",
        "pptx",
        "rad",
        "radc",
        "rvm",
        "rvt",
        "sog",
        "spz",
        "splat",
        "txt",
        "vue",
        "webp",
        "xls",
        "xlsx",
        "zip",
        "ksplat",
    }
)
UNSUPPORTED_3D_MODEL_EXTENSIONS = frozenset({"vue", "ifc", "glb", "gltf", "nwd", "rvt", "obj", "fbx", "stl"})
SPARK_3D_UPLOAD_EXTENSIONS = frozenset({"rad", "radc", "rvm", "ply", "spz", "splat", "ksplat", "sog", "zip"})
BLOCKED_DOCUMENT_MIME_TYPES = frozenset(
    {
        "application/javascript",
        "application/x-msdownload",
        "image/svg+xml",
        "text/html",
        "text/javascript",
    }
)
DOCUMENT_EXTENSION_MIME_TYPES = {
    "csv": {"text/csv", "application/csv", "application/vnd.ms-excel", "text/plain"},
    "doc": {"application/msword", "application/octet-stream", "binary/octet-stream"},
    "docx": {
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/octet-stream",
        "application/zip",
        "binary/octet-stream",
    },
    "dwg": {
        "application/acad",
        "application/autocad",
        "application/dwg",
        "application/octet-stream",
        "application/x-acad",
        "application/x-autocad",
        "application/x-dwg",
        "binary/octet-stream",
        "image/vnd.dwg",
    },
    "dxf": {
        "application/dxf",
        "application/octet-stream",
        "application/x-dxf",
        "binary/octet-stream",
        "image/vnd.dxf",
    },
    "glb": {"model/gltf-binary", "application/octet-stream", "binary/octet-stream"},
    "gltf": {"model/gltf+json", "application/json", "application/octet-stream", "binary/octet-stream"},
    "ifc": {"application/octet-stream", "application/x-step", "binary/octet-stream"},
    "json": {"application/json", "text/json", "application/octet-stream", "binary/octet-stream"},
    "jpeg": {"image/jpeg"},
    "jpg": {"image/jpeg"},
    "pdf": {"application/pdf", "application/octet-stream", "binary/octet-stream"},
    "ply": {"application/octet-stream", "application/ply", "application/x-ply", "binary/octet-stream"},
    "png": {"image/png"},
    "ppt": {"application/vnd.ms-powerpoint", "application/octet-stream", "binary/octet-stream"},
    "pptx": {
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/octet-stream",
        "application/zip",
        "binary/octet-stream",
    },
    "rad": {"application/octet-stream", "binary/octet-stream"},
    "radc": {"application/octet-stream", "binary/octet-stream"},
    "rvm": {"application/octet-stream", "binary/octet-stream"},
    "sog": {"application/octet-stream", "application/zip", "binary/octet-stream"},
    "spz": {"application/octet-stream", "binary/octet-stream"},
    "splat": {"application/octet-stream", "binary/octet-stream"},
    "ksplat": {"application/octet-stream", "binary/octet-stream"},
    "txt": {"text/plain"},
    "vue": {"application/octet-stream", "binary/octet-stream"},
    "webp": {"image/webp"},
    "xls": {"application/vnd.ms-excel", "application/octet-stream", "binary/octet-stream"},
    "xlsx": {
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/octet-stream",
        "application/zip",
        "binary/octet-stream",
    },
    "zip": {"application/zip", "application/x-zip-compressed", "application/octet-stream", "binary/octet-stream"},
}


def _normalize_content_type(filename: str, content_type: str | None) -> str:
    detected = content_type or mimetypes.guess_type(filename)[0]
    if detected:
        detected = detected.split(";", 1)[0]
    return (detected or "application/octet-stream").strip().lower()


def _upload_max_bytes(env_name: str, default_value: int) -> int:
    value = os.getenv(env_name, "").strip()
    if not value:
        return default_value
    try:
        parsed = int(value)
    except ValueError:
        return default_value
    return max(1, parsed)


def _document_upload_max_bytes() -> int:
    return _upload_max_bytes(DOCUMENT_UPLOAD_MAX_BYTES_ENV, DEFAULT_DOCUMENT_UPLOAD_MAX_BYTES)


def _max_upload_bytes_for_extension(extension: str) -> int:
    if extension in SPARK_3D_UPLOAD_EXTENSIONS:
        return _upload_max_bytes(THREE_D_MODEL_UPLOAD_MAX_BYTES_ENV, DEFAULT_3D_MODEL_UPLOAD_MAX_BYTES)
    return _document_upload_max_bytes()


def _normalize_allowed_extensions(value: object) -> set[str]:
    if not isinstance(value, list):
        return set()
    normalized: set[str] = set()
    for item in value:
        extension = str(item).strip().lower().lstrip(".")
        if extension:
            normalized.add(extension)
    return normalized


def _extract_file_extension(filename: str) -> str:
    stripped = filename.strip()
    if not stripped:
        raise ValueError("Filename is required")
    if "/" in stripped or "\\" in stripped or re.search(r"[\x00-\x1f]", stripped):
        raise ValueError("Filename must not contain paths or control characters")
    if stripped in {".", ".."} or "." not in stripped.strip("."):
        raise ValueError("Filename must include a file extension")
    extension = stripped.rsplit(".", 1)[1].strip().lower()
    if not extension:
        raise ValueError("Filename must include a file extension")
    return extension


def _validate_document_content_type(extension: str, content_type: str) -> None:
    if content_type in BLOCKED_DOCUMENT_MIME_TYPES:
        raise ValueError(f"Content type {content_type} is not allowed")
    expected_types = DOCUMENT_EXTENSION_MIME_TYPES.get(extension)
    if expected_types is not None and content_type not in expected_types:
        raise ValueError("Content type does not match file extension")


def _validate_document_upload_payload(payload: dict, upload_context: dict) -> str:
    filename = str(payload.get("filename") or "").strip()
    extension = _extract_file_extension(filename)
    if extension in UNSUPPORTED_3D_MODEL_EXTENSIONS:
        raise ValueError(f"3D model extension .{extension} is not supported by the Spark preview pipeline")
    size_bytes = int(payload.get("size_bytes") or 0)
    if size_bytes <= 0:
        raise ValueError("File size must be greater than 0")

    max_bytes = _max_upload_bytes_for_extension(extension)
    if size_bytes > max_bytes:
        raise ValueError(f"File size must be {max_bytes} bytes or smaller")

    document_extensions = _normalize_allowed_extensions(upload_context.get("allowed_extensions"))
    allowed_extensions = document_extensions or set(DEFAULT_DOCUMENT_ALLOWED_EXTENSIONS)
    if extension not in allowed_extensions:
        if document_extensions:
            raise ValueError(f"File extension .{extension} is not allowed for this document type")
        raise ValueError(f"File extension .{extension} is not allowed")

    content_type = _normalize_content_type(filename, payload.get("content_type"))
    _validate_document_content_type(extension, content_type)
    return content_type


def _build_kkfileview_preview_url(source_url: str) -> str | None:
    if os.getenv("KKFILEVIEW_ENABLED", "").strip().lower() not in {"1", "true", "yes", "on"}:
        return None

    base_url = os.getenv("KKFILEVIEW_BASE_URL", "").strip().rstrip("/")
    if not base_url:
        return None

    encoded_source = base64.b64encode(source_url.encode("utf-8")).decode("ascii")
    preview_url = f"{base_url}/onlinePreview?url={quote(encoded_source, safe='')}"
    access_key = os.getenv("KKFILEVIEW_KEY", "").strip()
    if access_key:
        preview_url = f"{preview_url}&key={quote(access_key, safe='')}"
    return preview_url


def initiate_document_file_upload(
    project_id: str,
    document_id: str,
    revision_id: str,
    payload: dict,
    storage=None,
) -> dict | None:
    upload_context = get_project_document_upload_context(project_id, document_id, revision_id)
    if upload_context is None:
        return None
    content_type = _validate_document_upload_payload(payload, upload_context)
    storage = storage or get_document_storage()
    file_id = str(uuid4())
    object_key = storage.build_object_key(
        project_id=project_id,
        document_id=document_id,
        revision_id=revision_id,
        file_id=file_id,
        filename=payload["filename"],
    )
    upload = storage.create_upload_payload(object_key=object_key, content_type=content_type)
    preview_mode = resolve_preview_mode(payload["filename"], content_type)

    file_row = create_project_document_file_record(
        project_id,
        document_id,
        revision_id,
        {
            "id": file_id,
            "file_role": payload["file_role"],
            "original_filename": payload["filename"],
            "relative_path": payload.get("relative_path"),
            "storage_provider": storage.provider,
            "bucket": upload["bucket"],
            "object_key": upload["object_key"],
            "mime_type": content_type,
            "size_bytes": payload["size_bytes"],
            "checksum_sha256": payload.get("checksum_sha256"),
            "preview_mode": preview_mode,
            "status": "pending_upload",
        },
    )
    if file_row is None:
        return None

    return {
        "file_id": file_id,
        "upload_url": upload["upload_url"],
        "upload_headers": upload["upload_headers"],
        "expires_at": upload["expires_at"],
        "bucket": upload["bucket"],
        "object_key": upload["object_key"],
        "preview_mode": preview_mode,
        "file": file_row,
    }


def complete_document_file_upload(
    project_id: str,
    document_id: str,
    revision_id: str,
    file_id: str,
    payload: dict | None = None,
    storage=None,
) -> dict | None:
    payload = payload or {}
    storage = storage or get_document_storage()
    file_row = get_project_document_file(project_id, document_id, revision_id, file_id)
    if file_row is None:
        return None
    upload_context = get_project_document_upload_context(project_id, document_id, revision_id)
    if upload_context is None:
        return None

    try:
        object_stats = storage.stat_object(object_key=file_row["object_key"])
    except Exception as error:
        raise ValueError("Uploaded object not found") from error

    if object_stats["content_length"] <= 0:
        raise ValueError("Uploaded object is empty")
    content_type = _validate_document_upload_payload(
        {
            "filename": file_row["original_filename"],
            "content_type": object_stats.get("content_type") or file_row["mime_type"],
            "size_bytes": object_stats["content_length"],
        },
        upload_context,
    )

    file_row = mark_project_document_file_ready(
        project_id,
        document_id,
        revision_id,
        file_id,
        {
            "etag": payload.get("etag") or object_stats.get("etag"),
            "mime_type": content_type,
            "size_bytes": object_stats.get("content_length") or file_row["size_bytes"],
        },
    )
    if file_row is not None:
        handle_uploaded_document_file(project_id, document_id, revision_id, file_row)
    return file_row


def get_document_file_access(
    project_id: str,
    document_id: str,
    revision_id: str,
    file_id: str,
    storage=None,
) -> dict | None:
    storage = storage or get_document_storage()
    file_row = get_project_document_file(project_id, document_id, revision_id, file_id)
    if file_row is None:
        return None
    if file_row["status"] != "ready":
        raise ValueError("File is not ready for access")

    preview_endpoint = get_document_preview_endpoint()
    access = storage.create_access_payload(
        object_key=file_row["object_key"],
        filename=file_row["original_filename"],
        content_type=file_row["mime_type"],
        preview_mode=file_row["preview_mode"],
        endpoint=preview_endpoint,
    )

    preview_url = _build_kkfileview_preview_url(access["url"])

    return {
        "file_id": file_row["id"],
        "preview_mode": file_row["preview_mode"],
        "preview_engine": "kkfileview" if preview_url else "browser",
        "preview_url": preview_url or access["url"],
        **access,
    }


def get_document_visualization_access(
    project_id: str,
    document_id: str,
    revision_id: str,
    visualization_id: str,
    storage=None,
) -> dict | None:
    storage = storage or get_document_storage()
    visualization = get_document_visualization(project_id, document_id, revision_id, visualization_id)
    if visualization is None:
        return None

    assets = list_document_visualization_assets(project_id, visualization_id)
    header_asset = next((asset for asset in assets if asset["asset_role"] == "header"), None)
    if header_asset is None:
        raise ValueError("Spark visualization assets are missing")

    preview_endpoint = get_document_preview_endpoint()
    source_access = storage.create_access_payload(
        object_key=visualization["source_object_key"],
        filename=visualization["source_file_name"],
        content_type=visualization["source_mime_type"],
        preview_mode=visualization["source_preview_mode"],
        endpoint=preview_endpoint,
    )
    manifest_access = None
    if visualization.get("annotation_manifest_file_id"):
        manifest_access = storage.create_access_payload(
            object_key=visualization["annotation_manifest_object_key"],
            filename=visualization["annotation_manifest_file_name"],
            content_type=visualization["annotation_manifest_mime_type"],
            preview_mode=visualization["annotation_manifest_preview_mode"],
            endpoint=preview_endpoint,
        )

    preview_name = quote(str(header_asset["filename"]), safe="")
    viewer_url = (
        f"/api/projects/{quote(project_id, safe='')}/documents/{quote(document_id, safe='')}"
        f"/revisions/{quote(revision_id, safe='')}/visualizations/{quote(visualization_id, safe='')}"
        f"/spark/{preview_name}"
    )
    has_chunks = any(asset["asset_role"] == "chunk" for asset in assets)
    preview_extension = _extract_file_extension(str(header_asset["filename"]))
    if has_chunks:
        asset_mode = "rad_chunked"
    elif preview_extension == "rad":
        asset_mode = "rad_single"
    else:
        asset_mode = "spark_native"

    return {
        "visualization_id": visualization["id"],
        "viewer_url": viewer_url,
        "source_url": source_access["url"],
        "annotation_manifest_url": manifest_access["url"] if manifest_access else None,
        "asset_mode": asset_mode,
        "expires_at": source_access["expires_at"],
        "metadata": visualization["metadata"],
        "preview_file_name": visualization["preview_file_name"],
        "source_file_name": visualization["source_file_name"],
    }


def get_document_visualization_spark_asset(
    project_id: str,
    document_id: str,
    revision_id: str,
    visualization_id: str,
    filename: str,
    storage=None,
) -> dict | None:
    normalized_filename = filename.strip()
    if not normalized_filename or "/" in normalized_filename or "\\" in normalized_filename or re.search(r"[\x00-\x1f]", normalized_filename):
        raise ValueError("Spark asset filename is invalid")
    asset = get_document_visualization_asset(
        project_id,
        document_id,
        revision_id,
        visualization_id,
        normalized_filename,
    )
    if asset is None:
        return None
    storage = storage or get_document_storage()
    return {
        "filename": asset["filename"],
        "content": storage.get_object_bytes(object_key=asset["object_key"]),
        "mime_type": asset["mime_type"],
        "size_bytes": asset["size_bytes"],
    }


def delete_project_document(project_id: str, document_id: str, storage=None) -> dict | None:
    deleted_document, storage_objects = delete_project_document_record(project_id, document_id)
    if deleted_document is None:
        return None

    _delete_storage_objects(
        storage_objects,
        storage=storage,
        context=f"document {document_id} in project {project_id}",
    )
    return deleted_document


def delete_project_document_revision(
    project_id: str,
    document_id: str,
    revision_id: str,
    storage=None,
) -> dict | None:
    deleted_revision, storage_objects = delete_project_document_revision_record(project_id, document_id, revision_id)
    if deleted_revision is None:
        return None

    _delete_storage_objects(
        storage_objects,
        storage=storage,
        context=f"revision {revision_id} of document {document_id} in project {project_id}",
    )
    return deleted_revision


def _delete_storage_objects(storage_objects: list[dict], *, storage=None, context: str) -> None:
    if not storage_objects:
        return

    storage_client = storage
    if storage_client is None:
        try:
            storage_client = get_document_storage()
        except Exception as error:  # pragma: no cover - environment dependent
            logger.warning("Failed to initialize document storage cleanup for %s: %s", context, error)
            return

    seen_objects: set[tuple[str, str]] = set()
    for item in storage_objects:
        bucket = str(item.get("bucket") or "").strip()
        object_key = str(item.get("object_key") or "").strip()
        if not bucket or not object_key:
            continue

        identity = (bucket, object_key)
        if identity in seen_objects:
            continue
        seen_objects.add(identity)

        try:
            storage_client.delete_object(bucket=bucket, object_key=object_key)
        except Exception as error:  # pragma: no cover - best-effort cleanup
            logger.warning(
                "Failed to delete document object for %s: bucket=%s object_key=%s error=%s",
                context,
                bucket,
                object_key,
                error,
            )
