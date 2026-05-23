from __future__ import annotations

import logging

from .document_storage import get_document_storage
from .repository import delete_project_record


logger = logging.getLogger(__name__)


def delete_project(project_id: str, storage=None) -> dict | None:
    deleted_project, storage_objects = delete_project_record(project_id)
    if deleted_project is None:
        return None

    if not storage_objects:
        return deleted_project

    storage_client = storage
    if storage_client is None:
        try:
            storage_client = get_document_storage()
        except Exception as error:  # pragma: no cover - environment dependent
            logger.warning("Failed to initialize document storage cleanup for project %s: %s", project_id, error)
            return deleted_project

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
                "Failed to delete document object for project %s: bucket=%s object_key=%s error=%s",
                project_id,
                bucket,
                object_key,
                error,
            )

    return deleted_project
