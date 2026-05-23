from __future__ import annotations

from typing import Any

from psycopg.types.json import Json

from .db import execute_one, fetch_all, fetch_one, get_connection


def list_plugin_summaries() -> list[dict]:
    rows = fetch_all(
        """
        SELECT
            pp.plugin_id,
            pp.version AS package_version,
            pp.filename,
            pp.checksum,
            pp.created_at AS uploaded_at,
            pi.version AS installed_version,
            pi.status,
            pi.enabled_at,
            pi.disabled_at,
            pi.error_message,
            pp.manifest AS package_manifest,
            pi.manifest AS installation_manifest,
            COALESCE(
                jsonb_agg(
                    jsonb_build_object(
                        'capability_type', pc.capability_type,
                        'capability_key', pc.capability_key,
                        'definition', pc.definition
                    )
                    ORDER BY pc.capability_type, pc.capability_key
                ) FILTER (WHERE pc.id IS NOT NULL),
                '[]'::jsonb
            ) AS capabilities
        FROM (
            SELECT DISTINCT ON (plugin_id) *
            FROM plugin_package
            WHERE status = 'uploaded'
            ORDER BY plugin_id, created_at DESC
        ) pp
        LEFT JOIN plugin_installation pi ON pi.plugin_id = pp.plugin_id
        LEFT JOIN plugin_capability pc ON pc.plugin_id = pp.plugin_id
        GROUP BY pp.plugin_id, pp.version, pp.filename, pp.checksum, pp.created_at,
            pp.manifest, pi.version, pi.status, pi.enabled_at, pi.disabled_at, pi.error_message, pi.manifest
        ORDER BY pp.plugin_id, pp.created_at DESC
        """
    )
    return [_normalize_summary(row) for row in rows]


def create_plugin_package(
    *,
    plugin_id: str,
    version: str,
    filename: str,
    checksum: str,
    storage_path: str,
    manifest: dict,
) -> dict:
    existing = fetch_one(
        """
        SELECT id
        FROM plugin_package
        WHERE plugin_id = %s
          AND version = %s
          AND status = 'uploaded'
        LIMIT 1
        """,
        (plugin_id, version),
    )
    if existing is not None:
        raise ValueError(f"Plugin {plugin_id} version {version} has already been uploaded")

    row = execute_one(
        """
        INSERT INTO plugin_package (plugin_id, version, filename, checksum, storage_path, manifest, status)
        VALUES (%s, %s, %s, %s, %s, %s, 'uploaded')
        RETURNING *
        """,
        (plugin_id, version, filename, checksum, storage_path, Json(manifest)),
    )
    return _normalize_package(row)


def get_latest_package(plugin_id: str) -> dict | None:
    row = fetch_one(
        """
        SELECT *
        FROM plugin_package
        WHERE plugin_id = %s
          AND status = 'uploaded'
        ORDER BY created_at DESC
        LIMIT 1
        """,
        (plugin_id,),
    )
    return _normalize_package(row) if row else None


def get_installation(plugin_id: str) -> dict | None:
    row = fetch_one("SELECT * FROM plugin_installation WHERE plugin_id = %s", (plugin_id,))
    return _normalize_installation(row) if row else None


def list_enabled_installations() -> list[dict]:
    rows = fetch_all(
        """
        SELECT *
        FROM plugin_installation
        WHERE status = 'enabled'
        ORDER BY plugin_id
        """
    )
    return [_normalize_installation(row) for row in rows]


def upsert_installation(*, package: dict, status: str, error_message: str | None = None) -> dict:
    row = execute_one(
        """
        INSERT INTO plugin_installation (
            plugin_id, package_id, version, status, manifest, installed_path, installed_at,
            enabled_at, disabled_at, error_message
        )
        VALUES (
            %s, %s, %s, %s, %s, %s, now(),
            CASE WHEN %s = 'enabled' THEN now() ELSE NULL END,
            CASE WHEN %s = 'disabled' THEN now() ELSE NULL END,
            %s
        )
        ON CONFLICT (plugin_id) DO UPDATE
        SET package_id = EXCLUDED.package_id,
            version = EXCLUDED.version,
            status = EXCLUDED.status,
            manifest = EXCLUDED.manifest,
            installed_path = EXCLUDED.installed_path,
            updated_at = now(),
            enabled_at = CASE WHEN EXCLUDED.status = 'enabled' THEN now() ELSE plugin_installation.enabled_at END,
            disabled_at = CASE WHEN EXCLUDED.status = 'disabled' THEN now() ELSE plugin_installation.disabled_at END,
            error_message = EXCLUDED.error_message
        RETURNING *
        """,
        (
            package["plugin_id"],
            package["id"],
            package["version"],
            status,
            Json(package["manifest"]),
            package["storage_path"],
            status,
            status,
            error_message,
        ),
    )
    return _normalize_installation(row)


def set_installation_status(plugin_id: str, status: str, *, error_message: str | None = None) -> dict | None:
    row = execute_one(
        """
        UPDATE plugin_installation
        SET status = %s,
            enabled_at = CASE WHEN %s = 'enabled' THEN now() ELSE enabled_at END,
            disabled_at = CASE WHEN %s IN ('disabled', 'uninstalled') THEN now() ELSE disabled_at END,
            error_message = %s,
            updated_at = now()
        WHERE plugin_id = %s
        RETURNING *
        """,
        (status, status, status, error_message, plugin_id),
    )
    return _normalize_installation(row) if row else None


def retire_uploaded_packages(plugin_id: str) -> None:
    execute_one(
        """
        UPDATE plugin_package
        SET status = 'rejected'
        WHERE plugin_id = %s
          AND status = 'uploaded'
        RETURNING id
        """,
        (plugin_id,),
    )


def replace_capabilities(plugin_id: str, capabilities: list[dict]) -> None:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute("DELETE FROM plugin_capability WHERE plugin_id = %s", (plugin_id,))
            for capability in capabilities:
                cursor.execute(
                    """
                    INSERT INTO plugin_capability (plugin_id, capability_type, capability_key, definition)
                    VALUES (%s, %s, %s, %s)
                    """,
                    (
                        plugin_id,
                        capability["capability_type"],
                        capability["capability_key"],
                        Json(capability["definition"]),
                    ),
                )
        connection.commit()


def upsert_permission_definitions(permissions: list[dict]) -> None:
    if not permissions:
        return
    with get_connection() as connection:
        with connection.cursor() as cursor:
            for permission in permissions:
                cursor.execute(
                    """
                    INSERT INTO permission_definition (code, scope_kind, resource, action, description)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (code) DO UPDATE
                    SET scope_kind = EXCLUDED.scope_kind,
                        resource = EXCLUDED.resource,
                        action = EXCLUDED.action,
                        description = EXCLUDED.description
                    """,
                    (
                        permission["code"],
                        permission["scope_kind"],
                        permission["resource"],
                        permission["action"],
                        permission.get("description") or "",
                    ),
                )
        connection.commit()


def grant_default_role_permissions(role_grants: dict[str, list[str]]) -> None:
    if not role_grants:
        return
    with get_connection() as connection:
        with connection.cursor() as cursor:
            for role_code, permission_codes in role_grants.items():
                for permission_code in permission_codes:
                    cursor.execute(
                        """
                        INSERT INTO role_permission (role_id, permission_code)
                        SELECT id, %s
                        FROM role_definition
                        WHERE code = %s
                          AND status = 'active'
                        ON CONFLICT DO NOTHING
                        """,
                        (permission_code, role_code),
                    )
        connection.commit()


def get_migration_record(plugin_id: str, version: str, migration_path: str) -> dict | None:
    row = fetch_one(
        """
        SELECT *
        FROM plugin_migration_journal
        WHERE plugin_id = %s
          AND plugin_version = %s
          AND migration_path = %s
        """,
        (plugin_id, version, migration_path),
    )
    return row


def record_migration(plugin_id: str, version: str, migration_path: str, checksum: str) -> None:
    execute_one(
        """
        INSERT INTO plugin_migration_journal (plugin_id, plugin_version, migration_path, checksum)
        VALUES (%s, %s, %s, %s)
        RETURNING id
        """,
        (plugin_id, version, migration_path, checksum),
    )


def record_audit(
    *,
    plugin_id: str,
    action: str,
    actor_user_id: str | None,
    metadata: dict | None = None,
) -> None:
    execute_one(
        """
        INSERT INTO plugin_audit_log (plugin_id, action, actor_user_id, metadata)
        VALUES (%s, %s, %s, %s)
        RETURNING id
        """,
        (plugin_id, action, actor_user_id, Json(metadata or {})),
    )


def is_plugin_enabled(plugin_id: str) -> bool:
    row = fetch_one(
        """
        SELECT 1 AS enabled
        FROM plugin_installation
        WHERE plugin_id = %s
          AND status = 'enabled'
        """,
        (plugin_id,),
    )
    return row is not None


def _normalize_package(row: dict) -> dict:
    return {
        **row,
        "id": str(row["id"]),
        "manifest": dict(row.get("manifest") or {}),
    }


def _normalize_installation(row: dict) -> dict:
    return {
        **row,
        "id": str(row["id"]),
        "package_id": str(row["package_id"]) if row.get("package_id") is not None else None,
        "manifest": dict(row.get("manifest") or {}),
    }


def _normalize_summary(row: dict) -> dict:
    return {
        "plugin_id": row["plugin_id"],
        "package_version": row["package_version"],
        "filename": row["filename"],
        "checksum": row["checksum"],
        "uploaded_at": row["uploaded_at"],
        "installed_version": row.get("installed_version"),
        "status": row.get("status") or "uploaded",
        "enabled_at": row.get("enabled_at"),
        "disabled_at": row.get("disabled_at"),
        "error_message": row.get("error_message"),
        "manifest": dict(row.get("package_manifest") or row.get("installation_manifest") or {}),
        "capabilities": list(row.get("capabilities") or []),
    }
