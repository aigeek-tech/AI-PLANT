import math
from urllib.parse import quote

from psycopg.types.json import Json

from .db import execute_one, fetch_all, fetch_one, get_connection


AI_SETTINGS_NAME = "default"
AI_SETTINGS_KEY = "ai"
BRANDING_SETTINGS_KEY = "branding"


DEFAULT_AI_SETTINGS = {
    "name": AI_SETTINGS_NAME,
    "provider": "openai-compatible",
    "base_url": "",
    "endpoint_path": "/v1/chat/completions",
    "model": "",
    "temperature": 0.2,
    "max_tokens": None,
    "timeout_seconds": 60,
    "is_enabled": True,
    "has_api_key": False,
    "updated_at": None,
}

DEFAULT_BRANDING_SETTINGS = {
    "system_name": "AI PLANT",
    "sidebar_title": "智能工厂",
    "logo_data_url": None,
    "login_background_image": None,
    "updated_at": None,
}


def _build_ai_settings_secret(row: dict | None) -> dict:
    if row is None:
        return {
            "name": AI_SETTINGS_NAME,
            "provider": DEFAULT_AI_SETTINGS["provider"],
            "base_url": DEFAULT_AI_SETTINGS["base_url"],
            "endpoint_path": DEFAULT_AI_SETTINGS["endpoint_path"],
            "model": DEFAULT_AI_SETTINGS["model"],
            "api_key": None,
            "temperature": DEFAULT_AI_SETTINGS["temperature"],
            "max_tokens": DEFAULT_AI_SETTINGS["max_tokens"],
            "timeout_seconds": DEFAULT_AI_SETTINGS["timeout_seconds"],
            "is_enabled": DEFAULT_AI_SETTINGS["is_enabled"],
            "updated_at": None,
        }

    value = row.get("value") or {}
    return {
        "name": AI_SETTINGS_NAME,
        "provider": value.get("provider", DEFAULT_AI_SETTINGS["provider"]),
        "base_url": value.get("base_url", DEFAULT_AI_SETTINGS["base_url"]),
        "endpoint_path": value.get("endpoint_path", DEFAULT_AI_SETTINGS["endpoint_path"]),
        "model": value.get("model", DEFAULT_AI_SETTINGS["model"]),
        "api_key": value.get("api_key"),
        "temperature": float(value.get("temperature", DEFAULT_AI_SETTINGS["temperature"])),
        "max_tokens": value.get("max_tokens", DEFAULT_AI_SETTINGS["max_tokens"]),
        "timeout_seconds": value.get("timeout_seconds", DEFAULT_AI_SETTINGS["timeout_seconds"]),
        "is_enabled": value.get("is_enabled", DEFAULT_AI_SETTINGS["is_enabled"]),
        "updated_at": row.get("updated_at"),
    }


def _build_ai_settings_public(row: dict | None) -> dict:
    secret = _build_ai_settings_secret(row)
    return {
        "name": secret["name"],
        "provider": secret["provider"],
        "base_url": secret["base_url"],
        "endpoint_path": secret["endpoint_path"],
        "model": secret["model"],
        "temperature": secret["temperature"],
        "max_tokens": secret["max_tokens"],
        "timeout_seconds": secret["timeout_seconds"],
        "is_enabled": secret["is_enabled"],
        "has_api_key": bool(secret["api_key"]),
        "updated_at": secret["updated_at"],
    }


def _build_login_background_public_meta(image: dict | None) -> dict | None:
    if not isinstance(image, dict) or not image.get("object_key"):
        return None

    return {
        "file_name": image.get("file_name") or "login-background.webp",
        "mime_type": image.get("mime_type") or "image/webp",
        "size_bytes": int(image.get("size_bytes") or 0),
        "width": int(image.get("width") or 0),
        "height": int(image.get("height") or 0),
        "updated_at": image.get("updated_at"),
    }


def _build_login_background_url(meta: dict | None) -> str | None:
    if meta is None:
        return None

    updated_at = meta.get("updated_at")
    if not updated_at:
        return "/api/settings/branding/login-background"

    return f"/api/settings/branding/login-background?v={quote(str(updated_at), safe='')}"


def _resolve_text_setting(payload: dict, key: str, fallback: object, *, trim_trailing_slash: bool = False) -> str:
    value = payload.get(key)
    if value is None:
        value = fallback

    text = str(value or "").strip()
    if trim_trailing_slash:
        return text.rstrip("/")
    return text


def _build_branding_settings(row: dict | None) -> dict:
    if row is None:
        return {
            "system_name": DEFAULT_BRANDING_SETTINGS["system_name"],
            "sidebar_title": DEFAULT_BRANDING_SETTINGS["sidebar_title"],
            "logo_data_url": DEFAULT_BRANDING_SETTINGS["logo_data_url"],
            "login_background_image_url": None,
            "login_background_image_meta": None,
            "updated_at": None,
        }

    value = row.get("value") or {}
    login_background_meta = _build_login_background_public_meta(value.get("login_background_image"))
    return {
        "system_name": value.get("system_name", DEFAULT_BRANDING_SETTINGS["system_name"]),
        "sidebar_title": value.get("sidebar_title", DEFAULT_BRANDING_SETTINGS["sidebar_title"]),
        "logo_data_url": value.get("logo_data_url", DEFAULT_BRANDING_SETTINGS["logo_data_url"]),
        "login_background_image_url": _build_login_background_url(login_background_meta),
        "login_background_image_meta": login_background_meta,
        "updated_at": row.get("updated_at"),
    }


def get_ai_settings_secret() -> dict:
    row = fetch_one(
        """
        SELECT
            key,
            value,
            updated_at
        FROM settings
        WHERE key = %s
        """,
        (AI_SETTINGS_KEY,),
    )
    return _build_ai_settings_secret(row)


def resolve_ai_runtime_settings(payload: dict) -> dict:
    existing = get_ai_settings_secret()
    next_api_key = payload.get("api_key")
    if payload.get("clear_api_key"):
        next_api_key = None
    elif next_api_key is None:
        next_api_key = existing.get("api_key")

    return {
        "provider": _resolve_text_setting(payload, "provider", existing["provider"]),
        "base_url": _resolve_text_setting(
            payload,
            "base_url",
            existing["base_url"],
            trim_trailing_slash=True,
        ),
        "endpoint_path": _resolve_text_setting(payload, "endpoint_path", existing["endpoint_path"]),
        "model": _resolve_text_setting(payload, "model", existing["model"]),
        "api_key": next_api_key,
        "temperature": payload.get("temperature", existing["temperature"]),
        "max_tokens": payload.get("max_tokens", existing["max_tokens"]),
        "timeout_seconds": payload.get("timeout_seconds", existing["timeout_seconds"]),
        "is_enabled": payload.get("is_enabled", existing["is_enabled"]),
    }


def get_ai_settings() -> dict:
    row = fetch_one(
        """
        SELECT
            key,
            value,
            updated_at
        FROM settings
        WHERE key = %s
        """,
        (AI_SETTINGS_KEY,),
    )
    return _build_ai_settings_public(row)


def upsert_ai_settings(payload: dict) -> dict | None:
    existing = get_ai_settings_secret()

    next_api_key = payload.get("api_key")
    if payload.get("clear_api_key"):
        next_api_key = None
    elif next_api_key is None:
        next_api_key = existing["api_key"]

    stored_settings = {
        "provider": payload["provider"],
        "base_url": payload["base_url"],
        "endpoint_path": payload["endpoint_path"],
        "model": payload["model"],
        "api_key": next_api_key,
        "temperature": payload["temperature"],
        "max_tokens": payload.get("max_tokens"),
        "timeout_seconds": payload["timeout_seconds"],
        "is_enabled": payload["is_enabled"],
    }

    row = execute_one(
        """
        INSERT INTO settings (
            key,
            value
        )
        VALUES (%s, %s)
        ON CONFLICT (key) DO UPDATE SET
            value = EXCLUDED.value,
            updated_at = now()
        RETURNING
            key,
            value,
            updated_at
        """,
        (
            AI_SETTINGS_KEY,
            Json(stored_settings),
        ),
    )
    return _build_ai_settings_public(row)


def get_branding_settings() -> dict:
    row = fetch_one(
        """
        SELECT
            key,
            value,
            updated_at
        FROM settings
        WHERE key = %s
        """,
        (BRANDING_SETTINGS_KEY,),
    )
    return _build_branding_settings(row)


def get_branding_login_background_storage_object() -> dict | None:
    row = fetch_one(
        """
        SELECT
            value
        FROM settings
        WHERE key = %s
        """,
        (BRANDING_SETTINGS_KEY,),
    )
    value = row.get("value") if row else {}
    image = value.get("login_background_image") if isinstance(value, dict) else None
    if not isinstance(image, dict) or not image.get("object_key"):
        return None

    return {
        "object_key": image["object_key"],
        "file_name": image.get("file_name") or "login-background.webp",
        "mime_type": image.get("mime_type") or "image/webp",
        "size_bytes": int(image.get("size_bytes") or 0),
        "width": int(image.get("width") or 0),
        "height": int(image.get("height") or 0),
        "updated_at": image.get("updated_at"),
    }


def _upsert_branding_value(stored_settings: dict) -> dict | None:
    row = execute_one(
        """
        INSERT INTO settings (
            key,
            value
        )
        VALUES (%s, %s)
        ON CONFLICT (key) DO UPDATE SET
            value = EXCLUDED.value,
            updated_at = now()
        RETURNING
            key,
            value,
            updated_at
        """,
        (
            BRANDING_SETTINGS_KEY,
            Json(stored_settings),
        ),
    )
    return _build_branding_settings(row)


def upsert_branding_settings(payload: dict) -> dict | None:
    existing_row = fetch_one(
        """
        SELECT
            value
        FROM settings
        WHERE key = %s
        """,
        (BRANDING_SETTINGS_KEY,),
    )
    existing_value = existing_row.get("value") if existing_row else {}
    stored_settings = {
        "system_name": payload["system_name"],
        "sidebar_title": payload["sidebar_title"],
        "logo_data_url": payload.get("logo_data_url"),
        "login_background_image": (
            existing_value.get("login_background_image")
            if isinstance(existing_value, dict)
            else None
        ),
    }

    return _upsert_branding_value(stored_settings)


def upsert_branding_login_background(payload: dict) -> dict | None:
    existing = get_branding_settings()
    stored_settings = {
        "system_name": existing["system_name"],
        "sidebar_title": existing["sidebar_title"],
        "logo_data_url": existing["logo_data_url"],
        "login_background_image": {
            "object_key": payload["object_key"],
            "file_name": payload["file_name"],
            "mime_type": payload["mime_type"],
            "size_bytes": int(payload["size_bytes"]),
            "width": int(payload["width"]),
            "height": int(payload["height"]),
            "updated_at": payload["updated_at"],
        },
    }

    return _upsert_branding_value(stored_settings)


def clear_branding_login_background() -> dict | None:
    existing = get_branding_settings()
    stored_settings = {
        "system_name": existing["system_name"],
        "sidebar_title": existing["sidebar_title"],
        "logo_data_url": existing["logo_data_url"],
        "login_background_image": None,
    }

    return _upsert_branding_value(stored_settings)


def get_standards() -> list[dict]:
    return fetch_all(
        """
        SELECT
            s.id,
            s.code,
            s.name,
            s.version_label,
            s.thumbnail_url,
            s.status,
            s.metadata,
            COUNT(DISTINCT c.id)::int AS class_count,
            COUNT(DISTINCT ad.id)::int AS attribute_count
        FROM standard s
        LEFT JOIN class c ON c.standard_id = s.id
        LEFT JOIN attribute_definition ad ON ad.class_id = c.id
            AND ad.status <> 'archived'
        GROUP BY s.id
        ORDER BY s.code
        """
    )


def get_standards_by_ids(standard_ids: list[str]) -> list[dict]:
    if not standard_ids:
        return []
    return fetch_all(
        """
        SELECT
            s.id,
            s.code,
            s.name,
            s.version_label,
            s.thumbnail_url,
            s.status,
            s.metadata,
            COUNT(DISTINCT c.id)::int AS class_count,
            COUNT(DISTINCT ad.id)::int AS attribute_count
        FROM standard s
        LEFT JOIN class c ON c.standard_id = s.id
        LEFT JOIN attribute_definition ad ON ad.class_id = c.id
            AND ad.status <> 'archived'
        WHERE s.id = ANY(%s::uuid[])
        GROUP BY s.id
        ORDER BY s.code
        """,
        (standard_ids,),
    )


def get_project_standard_ids(project_ids: list[str]) -> list[str]:
    if not project_ids:
        return []
    rows = fetch_all(
        """
        SELECT DISTINCT reference_attributes ->> 'standard_id' AS standard_id
        FROM project
        WHERE id::text = ANY(%s)
          AND reference_attributes ->> 'standard_id' IS NOT NULL
          AND length(trim(reference_attributes ->> 'standard_id')) > 0
        ORDER BY standard_id
        """,
        (project_ids,),
    )
    return [str(row["standard_id"]) for row in rows]


def create_standard(payload: dict) -> dict | None:
    return execute_one(
        """
        INSERT INTO standard (code, name, version_label, thumbnail_url, status)
        VALUES (%s, %s, %s, %s, %s)
        RETURNING *
        """,
        (
            payload["code"],
            payload["name"],
            payload.get("version_label"),
            payload.get("thumbnail_url"),
            payload.get("status", "active"),
        ),
    )


def update_standard_icon(standard_id: str, icon_data_url: str) -> dict | None:
    return execute_one(
        """
        UPDATE standard
        SET thumbnail_url = %s,
            updated_at = now()
        WHERE id = %s
        RETURNING id, thumbnail_url
        """,
        (icon_data_url, standard_id),
    )


def _count_standard_delete_blockers(cursor, standard_id: str) -> dict[str, int]:
    cursor.execute(
        """
        SELECT COUNT(*)::int AS count
        FROM project
        WHERE reference_attributes ->> 'standard_id' = %s
        """,
        (standard_id,),
    )
    project_count = cursor.fetchone()["count"]

    cursor.execute(
        """
        SELECT COUNT(*)::int AS count
        FROM tag t
        JOIN class c ON c.id = t.class_id
        WHERE c.standard_id = %s
        """,
        (standard_id,),
    )
    tag_count = cursor.fetchone()["count"]

    cursor.execute(
        """
        SELECT COUNT(*)::int AS count
        FROM document d
        JOIN class c ON c.id = d.class_id
        WHERE c.standard_id = %s
        """,
        (standard_id,),
    )
    document_count = cursor.fetchone()["count"]

    cursor.execute(
        """
        SELECT COUNT(*)::int AS count
        FROM pbs_node pn
        JOIN pbs_level_template plt ON plt.id = pn.level_template_id
        WHERE plt.standard_id = %s
        """,
        (standard_id,),
    )
    pbs_node_count = cursor.fetchone()["count"]

    return {
        "project_count": project_count,
        "tag_count": tag_count,
        "document_count": document_count,
        "pbs_node_count": pbs_node_count,
    }


def delete_standard_record(standard_id: str) -> tuple[dict | None, dict[str, int]]:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    id,
                    code,
                    name,
                    version_label,
                    thumbnail_url,
                    status,
                    metadata,
                    created_at,
                    updated_at
                FROM standard
                WHERE id = %s
                """,
                (standard_id,),
            )
            standard = cursor.fetchone()
            if standard is None:
                return None, {}

            blockers = _count_standard_delete_blockers(cursor, standard_id)
            if any(count > 0 for count in blockers.values()):
                return standard, blockers

            cursor.execute(
                """
                DELETE FROM user_role_assignment ura
                USING role_definition rd
                WHERE ura.role_id = rd.id
                  AND rd.scope_kind = 'standard'
                  AND ura.scope_id = %s
                """,
                (standard_id,),
            )
            cursor.execute(
                """
                DELETE FROM authorization_audit_log
                WHERE scope_kind = 'standard'
                  AND scope_id = %s
                """,
                (standard_id,),
            )
            cursor.execute(
                """
                DELETE FROM standard
                WHERE id = %s
                RETURNING
                    id,
                    code,
                    name,
                    version_label,
                    thumbnail_url,
                    status,
                    metadata,
                    created_at,
                    updated_at
                """,
                (standard_id,),
            )
            deleted_standard = cursor.fetchone()

        connection.commit()
        return deleted_standard, blockers


def move_class(class_id: str, parent_id: str | None) -> dict | None:
    if parent_id == class_id:
        raise ValueError("Cannot move a class under itself")

    class_row = fetch_one(
        """
        SELECT id, standard_id
        FROM class
        WHERE id = %s
        """,
        (class_id,),
    )

    if class_row is None:
        return None

    next_level = 1
    if parent_id is not None:
        parent_row = fetch_one(
            """
            SELECT id, standard_id, level_no
            FROM class
            WHERE id = %s
            """,
            (parent_id,),
        )

        if parent_row is None:
            raise ValueError("Parent class not found")

        if parent_row["standard_id"] != class_row["standard_id"]:
            raise ValueError("Parent class must belong to the same standard")

        cycle = fetch_one(
            """
            WITH RECURSIVE descendants AS (
                SELECT id
                FROM class
                WHERE id = %s
                UNION ALL
                SELECT child.id
                FROM class child
                JOIN descendants parent ON child.parent_id = parent.id
            )
            SELECT id
            FROM descendants
            WHERE id = %s
            LIMIT 1
            """,
            (class_id, parent_id),
        )

        if cycle is not None:
            raise ValueError("Cannot move a class under its descendant")

        next_level = parent_row["level_no"] + 1

    return execute_one(
        """
        UPDATE class
        SET parent_id = %s,
            level_no = %s,
            updated_at = now()
        WHERE id = %s
        RETURNING id, code, name, parent_id, level_no, description, status
        """,
        (parent_id, next_level, class_id),
    )


def _applies_to_values(applies_to: str) -> tuple[str, ...]:
    if applies_to == "equipment":
        return ("equipment", "both")
    if applies_to == "document":
        return ("document", "both")
    if applies_to == "both":
        return ("tag", "document", "equipment", "both")
    return ("tag", "both")


def _applies_to_condition(column_name: str, applies_to: str) -> str:
    values = ", ".join(f"'{value}'" for value in _applies_to_values(applies_to))
    return f"{column_name} IN ({values})"


def _resolve_class_parent(class_id: str | None, standard_id: str, parent_id: str | None, applies_to: str | None = None) -> int:
    if parent_id is None:
        return 1

    if parent_id == class_id:
        raise ValueError("Cannot move a class under itself")

    parent_row = fetch_one(
        """
        SELECT id, standard_id, level_no, applies_to
        FROM class
        WHERE id = %s
        """,
        (parent_id,),
    )

    if parent_row is None:
        raise ValueError("Parent class not found")

    if parent_row["standard_id"] != standard_id:
        raise ValueError("Parent class must belong to the same standard")

    if applies_to and parent_row["applies_to"] not in _applies_to_values(applies_to):
        raise ValueError("Parent class must belong to the same definition domain")

    if class_id is not None:
        cycle = fetch_one(
            """
            WITH RECURSIVE descendants AS (
                SELECT id
                FROM class
                WHERE id = %s
                UNION ALL
                SELECT child.id
                FROM class child
                JOIN descendants parent ON child.parent_id = parent.id
            )
            SELECT id
            FROM descendants
            WHERE id = %s
            LIMIT 1
            """,
            (class_id, parent_id),
        )

        if cycle is not None:
            raise ValueError("Cannot move a class under its descendant")

    return parent_row["level_no"] + 1


def create_class(payload: dict, standard_id: str) -> dict | None:
    applies_to = payload.get("applies_to", "tag")
    standard_row = fetch_one(
        """
        SELECT id
        FROM standard
        WHERE id = %s
        """,
        (standard_id,),
    )

    if standard_row is None:
        return None

    parent_id = payload.get("parent_id")
    next_level = _resolve_class_parent(None, standard_id, parent_id, applies_to)

    return execute_one(
        """
        INSERT INTO class (
            standard_id,
            code,
            name,
            parent_id,
            level_no,
            description,
            status,
            applies_to
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING
            id,
            code,
            name,
            parent_id,
            level_no,
            description,
            status,
            applies_to
        """,
        (
            standard_id,
            payload["code"],
            payload["name"],
            parent_id,
            next_level,
            payload.get("description"),
            payload.get("status", "active"),
            applies_to,
        ),
    )


def update_class(class_id: str, payload: dict) -> dict | None:
    class_row = fetch_one(
        """
        SELECT id, standard_id, applies_to
        FROM class
        WHERE id = %s
        """,
        (class_id,),
    )

    if class_row is None:
        return None

    parent_id = payload.get("parent_id")
    next_level = _resolve_class_parent(class_id, class_row["standard_id"], parent_id, class_row["applies_to"])

    return execute_one(
        """
        UPDATE class
        SET code = %s,
            name = %s,
            parent_id = %s,
            level_no = %s,
            description = %s,
            status = %s,
            updated_at = now()
        WHERE id = %s
        RETURNING
            id,
            code,
            name,
            parent_id,
            level_no,
            description,
            status,
            applies_to
        """,
        (
            payload["code"],
            payload["name"],
            parent_id,
            next_level,
            payload.get("description"),
            payload.get("status", "active"),
            class_id,
        ),
    )


def create_attribute(payload: dict, class_id: str | None = None, standard_id: str | None = None) -> dict | None:
    if not class_id and not standard_id:
        raise ValueError("Must provide either class_id or standard_id")

    applies_to = payload.get("applies_to")
    if class_id:
        class_row = fetch_one(
            """
            SELECT id, applies_to
            FROM class
            WHERE id = %s
            """,
            (class_id,),
        )
        if class_row is None:
            return None
        applies_to = applies_to or ("equipment" if class_row["applies_to"] == "equipment" else "tag")
        if applies_to not in _applies_to_values(class_row["applies_to"]):
            raise ValueError("Attribute domain must match the parent class domain")
    elif standard_id:
        standard_row = fetch_one("SELECT id FROM standard WHERE id = %s", (standard_id,))
        if standard_row is None:
            return None
        applies_to = applies_to or "tag"

    return execute_one(
        """
        INSERT INTO attribute_definition (
            class_id,
            standard_id,
            group_name,
            code,
            name,
            value_type,
            is_required,
            unit_family,
            enum_options,
            description,
            sort_order,
            applies_to
        )
        SELECT
            %s,
            %s,
            %s,
            %s,
            %s,
            %s,
            %s,
            %s,
            %s,
            %s,
            COALESCE((
                SELECT MAX(sort_order) + 1
                FROM attribute_definition
                WHERE (class_id = %s OR standard_id = %s)
                  AND applies_to = %s
                  AND status <> 'archived'
            ), 0),
            %s
        RETURNING
            id,
            class_id,
            standard_id,
            group_name,
            code,
            name,
            value_type,
            is_required,
            unit_family,
            enum_options,
            description,
            sort_order,
            status,
            applies_to
        """,
        (
            class_id,
            standard_id,
            payload.get("group_name"),
            payload["code"],
            payload["name"],
            payload["value_type"],
            payload["is_required"],
            payload.get("unit_family"),
            Json(payload.get("enum_options", [])),
            payload.get("description"),
            class_id,
            standard_id,
            applies_to,
            applies_to,
        ),
    )


def update_attribute(attribute_id: str, payload: dict) -> dict | None:
    return execute_one(
        """
        UPDATE attribute_definition
        SET
            group_name = %s,
            code = %s,
            name = %s,
            value_type = %s,
            is_required = %s,
            unit_family = %s,
            enum_options = %s,
            description = %s,
            updated_at = now()
        WHERE id = %s
          AND status <> 'archived'
        RETURNING
            id,
            class_id,
            standard_id,
            group_name,
            code,
            name,
            value_type,
            is_required,
            unit_family,
            enum_options,
            description,
            sort_order,
            status
        """,
        (
            payload.get("group_name"),
            payload["code"],
            payload["name"],
            payload["value_type"],
            payload["is_required"],
            payload.get("unit_family"),
            Json(payload.get("enum_options", [])),
            payload.get("description"),
            attribute_id,
        ),
    )


def soft_delete_attribute(attribute_id: str) -> dict | None:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT class_id
                FROM attribute_definition
                WHERE id = %s
                  AND status <> 'archived'
                """,
                (attribute_id,),
            )
            attribute_row = cursor.fetchone()
            if attribute_row is None:
                return None

            cursor.execute(
                """
                UPDATE attribute_definition
                SET status = 'archived',
                    updated_at = now()
                WHERE id = %s
                RETURNING
                    id,
                    class_id,
                    code,
                    name,
                    value_type,
                    is_required,
                    unit_family,
                    enum_options,
                    description,
                    sort_order,
                    status
                """,
                (attribute_id,),
            )
            deleted_attribute = cursor.fetchone()

            cursor.execute(
                """
                SELECT
                    id,
                    (ROW_NUMBER() OVER (ORDER BY sort_order, code, id) - 1)::integer AS next_sort_order
                FROM attribute_definition
                WHERE class_id = %s
                  AND status <> 'archived'
                """,
                (attribute_row["class_id"],),
            )
            remaining_attributes = list(cursor.fetchall())

            for attribute in remaining_attributes:
                cursor.execute(
                    """
                    UPDATE attribute_definition
                    SET sort_order = %s,
                        updated_at = now()
                    WHERE id = %s
                    """,
                    (attribute["next_sort_order"], attribute["id"]),
                )

        connection.commit()
        return deleted_attribute


def reorder_attributes(class_id: str, attribute_ids: list[str]) -> list[dict] | None:
    ordered_ids = [str(attribute_id) for attribute_id in attribute_ids]
    if len(ordered_ids) != len(set(ordered_ids)):
        raise ValueError("Attribute ids must be unique")

    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id
                FROM class
                WHERE id = %s
                """,
                (class_id,),
            )
            if cursor.fetchone() is None:
                return None

            cursor.execute(
                """
                SELECT id
                FROM attribute_definition
                WHERE class_id = %s
                  AND status <> 'archived'
                """,
                (class_id,),
            )
            existing_ids = {str(row["id"]) for row in cursor.fetchall()}
            if set(ordered_ids) != existing_ids:
                raise ValueError("Attribute order must include every attribute in the class")

            for sort_order, attribute_id in enumerate(ordered_ids):
                cursor.execute(
                    """
                    UPDATE attribute_definition
                    SET sort_order = %s,
                        updated_at = now()
                    WHERE id = %s
                      AND class_id = %s
                    """,
                    (sort_order, attribute_id, class_id),
                )

            cursor.execute(
                """
                SELECT
                    id,
                    class_id,
                    code,
                    name,
                    value_type,
                    is_required,
                    unit_family,
                    enum_options,
                    description,
                    sort_order,
                    status
                FROM attribute_definition
                WHERE class_id = %s
                  AND status <> 'archived'
                ORDER BY sort_order, code
                """,
                (class_id,),
            )
            rows = list(cursor.fetchall())

        connection.commit()
        return rows


def _get_standard_definition_group(standard_id: str, *, applies_to: str, include_attributes: bool) -> dict:
    classes = fetch_all(
        f"""
        SELECT
            c.id,
            c.code,
            c.name,
            c.parent_id,
            c.level_no,
            c.description,
            c.status,
            c.applies_to,
            COUNT(ad.id)::int AS attribute_count
        FROM class c
        LEFT JOIN attribute_definition ad ON ad.class_id = c.id
          AND {_applies_to_condition("ad.applies_to", applies_to)}
          AND ad.status <> 'archived'
        WHERE c.standard_id = %s
          AND {_applies_to_condition("c.applies_to", applies_to)}
        GROUP BY c.id
        ORDER BY c.level_no, c.code
        """,
        (standard_id,),
    )

    common_attribute_count_row = fetch_one(
        f"""
        SELECT COUNT(*)::int AS total
        FROM attribute_definition
        WHERE standard_id = %s
          AND {_applies_to_condition("applies_to", applies_to)}
          AND status <> 'archived'
        """,
        (standard_id,),
    )

    attributes = fetch_all(
        f"""
        SELECT
            ad.id,
            ad.class_id,
            ad.standard_id,
            ad.group_name,
            ad.code,
            ad.name,
            ad.value_type,
            ad.is_required,
            ad.unit_family,
            ad.enum_options,
            ad.description,
            ad.sort_order,
            ad.status,
            ad.applies_to
        FROM attribute_definition ad
        LEFT JOIN class c ON c.id = ad.class_id
        WHERE (c.standard_id = %s OR ad.standard_id = %s)
          AND {_applies_to_condition("ad.applies_to", applies_to)}
          AND ad.status <> 'archived'
        ORDER BY ad.sort_order, ad.code
        """,
        (standard_id, standard_id),
    ) if include_attributes else []

    common_attributes = [attr for attr in attributes if attr["standard_id"] is not None]

    mapped_classes = []
    for cls in classes:
        mapped_classes.append(
            {
                **cls,
                "attributes": [attr for attr in attributes if attr["class_id"] == cls["id"]],
            }
        )

    return {
        "classes": mapped_classes,
        "common_attributes": common_attributes,
        "common_attribute_count": common_attribute_count_row["total"] if common_attribute_count_row else 0,
    }


def get_standard_detail(
    standard_id: str,
    *,
    include_attributes: bool = True,
    include_tag_classes: bool = True,
    include_equipment_classes: bool = True,
    include_pbs_levels: bool = True,
) -> dict | None:
    standard = fetch_one(
        """
        SELECT
            id,
            code,
            name,
            version_label,
            thumbnail_url,
            status,
            metadata
        FROM standard
        WHERE id = %s
        """,
        (standard_id,),
    )

    if standard is None:
        return None

    tag_definitions = (
        _get_standard_definition_group(
            standard_id,
            applies_to="tag",
            include_attributes=include_attributes,
        )
        if include_tag_classes
        else {"classes": [], "common_attributes": [], "common_attribute_count": 0}
    )
    equipment_definitions = (
        _get_standard_definition_group(
            standard_id,
            applies_to="equipment",
            include_attributes=include_attributes,
        )
        if include_equipment_classes
        else {"classes": [], "common_attributes": [], "common_attribute_count": 0}
    )

    pbs_levels = (
        fetch_all(
            """
            SELECT id, standard_id, level_no, code, name, description, created_at, updated_at
            FROM pbs_level_template
            WHERE standard_id = %s
            ORDER BY level_no ASC
            """,
            (standard_id,),
        )
        if include_pbs_levels
        else []
    )

    return {
        **standard,
        "common_attributes": tag_definitions["common_attributes"],
        "common_attribute_count": tag_definitions["common_attribute_count"],
        "classes": tag_definitions["classes"],
        "equipment_common_attributes": equipment_definitions["common_attributes"],
        "equipment_common_attribute_count": equipment_definitions["common_attribute_count"],
        "equipment_classes": equipment_definitions["classes"],
        "pbs_levels": pbs_levels,
    }


def list_standard_common_attributes(
    standard_id: str,
    *,
    page: int = 1,
    page_size: int = 50,
    applies_to: str = "tag",
) -> dict | None:
    standard = fetch_one("SELECT id FROM standard WHERE id = %s", (standard_id,))
    if standard is None:
        return None
    return _list_attributes_page(
        f"""
        FROM attribute_definition ad
        WHERE ad.standard_id = %s
          AND {_applies_to_condition("ad.applies_to", applies_to)}
          AND ad.status <> 'archived'
        """,
        (standard_id,),
        page=page,
        page_size=page_size,
    )


def list_class_attributes(class_id: str, *, page: int = 1, page_size: int = 50) -> dict | None:
    class_row = fetch_one("SELECT id, applies_to FROM class WHERE id = %s", (class_id,))
    if class_row is None:
        return None
    return _list_attributes_page(
        f"""
        FROM attribute_definition ad
        WHERE ad.class_id = %s
          AND {_applies_to_condition("ad.applies_to", class_row["applies_to"])}
          AND ad.status <> 'archived'
        """,
        (class_id,),
        page=page,
        page_size=page_size,
    )


def _list_attributes_page(where_sql: str, params: tuple, *, page: int, page_size: int) -> dict:
    normalized_page = max(1, page)
    normalized_page_size = max(1, min(page_size, 200))
    total_row = fetch_one(f"SELECT COUNT(*)::int AS total {where_sql}", params)
    total = total_row["total"] if total_row else 0
    items = fetch_all(
        f"""
        SELECT
            ad.id,
            ad.class_id,
            ad.standard_id,
            ad.group_name,
            ad.code,
            ad.name,
            ad.value_type,
            ad.is_required,
            ad.unit_family,
            ad.enum_options,
            ad.description,
            ad.sort_order,
            ad.status
        {where_sql}
        ORDER BY ad.sort_order, ad.code
        LIMIT %s OFFSET %s
        """,
        (*params, normalized_page_size, (normalized_page - 1) * normalized_page_size),
    )
    return {
        "items": items,
        "page": normalized_page,
        "page_size": normalized_page_size,
        "total": total,
        "total_pages": max(1, math.ceil(total / normalized_page_size)) if total else 1,
    }


def get_projects() -> list[dict]:
    return fetch_all(
        """
        SELECT
            id,
            code,
            name,
            overview,
            reference_attributes,
            thumbnail_url,
            status,
            metadata,
            created_at,
            updated_at
        FROM project
        ORDER BY created_at DESC
        """
    )


def get_projects_by_ids(project_ids: list[str]) -> list[dict]:
    if not project_ids:
        return []
    return fetch_all(
        """
        SELECT
            id,
            code,
            name,
            overview,
            reference_attributes,
            thumbnail_url,
            status,
            metadata,
            created_at,
            updated_at
        FROM project
        WHERE id = ANY(%s::uuid[])
        ORDER BY created_at DESC
        """,
        (project_ids,),
    )


def create_project(payload: dict) -> dict | None:
    return execute_one(
        """
        INSERT INTO project (code, name, overview, reference_attributes, thumbnail_url, status)
        VALUES (%s, %s, %s, %s, %s, %s)
        RETURNING *
        """,
        (
            payload["code"],
            payload["name"],
            payload.get("overview"),
            Json(payload.get("reference_attributes", {})),
            payload.get("thumbnail_url"),
            payload.get("status", "active"),
        ),
    )


def update_project(project_id: str, payload: dict) -> dict | None:
    return execute_one(
        """
        UPDATE project
        SET
            code = %s,
            name = %s,
            overview = %s,
            reference_attributes = %s,
            thumbnail_url = %s,
            status = %s,
            updated_at = now()
        WHERE id = %s
        RETURNING *
        """,
        (
            payload["code"],
            payload["name"],
            payload.get("overview"),
            Json(payload.get("reference_attributes", {})),
            payload.get("thumbnail_url"),
            payload.get("status", "active"),
            project_id,
        ),
    )


def delete_project_record(project_id: str) -> tuple[dict | None, list[dict]]:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    id,
                    code,
                    name,
                    overview,
                    reference_attributes,
                    thumbnail_url,
                    status,
                    metadata,
                    created_at,
                    updated_at
                FROM project
                WHERE id = %s
                """,
                (project_id,),
            )
            project = cursor.fetchone()
            if project is None:
                return None, []

            cursor.execute(
                """
                SELECT DISTINCT df.bucket, df.object_key
                FROM document_file df
                JOIN document_revision dr ON dr.id = df.revision_id
                JOIN document d ON d.id = dr.document_id
                WHERE d.project_id = %s
                ORDER BY df.bucket, df.object_key
                """,
                (project_id,),
            )
            storage_objects = [
                {"bucket": row["bucket"], "object_key": row["object_key"]}
                for row in cursor.fetchall()
                if row.get("object_key")
            ]
            cursor.execute(
                """
                SELECT DISTINCT dva.bucket, dva.object_key
                FROM document_visualization_asset dva
                JOIN document_visualization dv ON dv.id = dva.visualization_id
                JOIN document_revision dr ON dr.id = dv.revision_id
                JOIN document d ON d.id = dr.document_id
                WHERE d.project_id = %s
                ORDER BY dva.bucket, dva.object_key
                """,
                (project_id,),
            )
            seen_storage_objects = {(item["bucket"], item["object_key"]) for item in storage_objects}
            for row in cursor.fetchall():
                if not row.get("object_key"):
                    continue
                key = (row["bucket"], row["object_key"])
                if key in seen_storage_objects:
                    continue
                storage_objects.append({"bucket": row["bucket"], "object_key": row["object_key"]})
                seen_storage_objects.add(key)

            cursor.execute(
                """
                DELETE FROM user_role_assignment ura
                USING role_definition rd
                WHERE ura.role_id = rd.id
                  AND rd.scope_kind = 'project'
                  AND ura.scope_id = %s
                """,
                (project_id,),
            )
            cursor.execute(
                """
                DELETE FROM authorization_audit_log
                WHERE scope_kind = 'project'
                  AND scope_id = %s
                """,
                (project_id,),
            )
            cursor.execute("DELETE FROM project WHERE id = %s", (project_id,))

        connection.commit()

    return project, storage_objects


def get_project_detail(project_id: str) -> dict | None:
    return fetch_one(
        """
        SELECT
            id,
            code,
            name,
            overview,
            reference_attributes,
            thumbnail_url,
            status,
            metadata,
            created_at,
            updated_at
        FROM project
        WHERE id = %s
        """,
        (project_id,),
    )


def _ensure_project_exists(cursor, project_id: str) -> None:
    cursor.execute("SELECT id FROM project WHERE id = %s", (project_id,))
    if cursor.fetchone() is None:
        raise ValueError("Project not found")


def _normalize_project_tag_page(filters: dict) -> tuple[int, int, int]:
    page = max(1, int(filters.get("page") or 1))
    page_size = min(100, max(1, int(filters.get("page_size") or 20)))
    return page, page_size, (page - 1) * page_size


def _has_more_pages(*, page: int, page_size: int, total: int) -> bool:
    return page * page_size < total


def _append_project_tag_attribute_condition(
    where_clauses: list[str],
    params: list[object],
    attribute_filter: dict,
) -> None:
    code = str(attribute_filter.get("code") or "").strip()
    operator = str(attribute_filter.get("operator") or "").strip().lower()
    value = attribute_filter.get("value")

    if not code:
        raise ValueError("Attribute filter code is required")

    if operator == "contains":
        if not isinstance(value, str):
            raise ValueError(f"Operator contains requires a string value for {code}")
        where_clauses.append("lower(COALESCE(t.attribute_values ->> %s, '')) LIKE %s")
        params.extend([code, f"%{value.strip().lower()}%"])
        return

    if operator == "equals":
        if isinstance(value, str):
            where_clauses.append("lower(COALESCE(t.attribute_values ->> %s, '')) = %s")
            params.extend([code, value.strip().lower()])
            return
        where_clauses.append("t.attribute_values @> %s::jsonb")
        params.append(Json({code: value}))
        return

    if operator in {"gte", "lte"}:
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            raise ValueError(f"Operator {operator} requires a numeric value for {code}")
        comparator = ">=" if operator == "gte" else "<="
        where_clauses.append(
            f"COALESCE(t.attribute_values ->> %s, '') ~ '^-?\\d+(\\.\\d+)?$' "
            f"AND ((t.attribute_values ->> %s)::numeric {comparator} %s)"
        )
        params.extend([code, code, float(value)])
        return

    raise ValueError(f"Unsupported operator: {operator}")


def _group_project_tag_children(root_items: list[dict], child_items: list[dict]) -> list[dict]:
    children_by_parent: dict[str, list[dict]] = {}
    for child in child_items:
        parent_id = child.get("parent_tag_id")
        if parent_id is None:
            continue
        children_by_parent.setdefault(str(parent_id), []).append(child)

    return [{**item, "children": children_by_parent.get(str(item["id"]), [])} for item in root_items]


def _project_tag_select_columns() -> str:
    return """
        t.id,
        t.project_id,
        t.tag_no,
        t.name,
        t.pbs_node_id,
        p.code AS pbs_node_code,
        p.name AS pbs_node_name,
        t.class_id,
        c.name AS class_name,
        t.parent_tag_id,
        parent.tag_no AS parent_tag_no,
        parent.name AS parent_tag_name,
        t.attribute_values,
        t.status,
        t.created_at,
        t.updated_at
    """


def _project_tag_attribute_definition_columns() -> str:
    return """
        ad.id,
        ad.class_id,
        ad.standard_id,
        ad.group_name,
        ad.code,
        ad.name,
        ad.value_type,
        ad.is_required,
        ad.unit_family,
        ad.enum_options,
        ad.description,
        ad.sort_order,
        ad.status,
        ad.applies_to
    """


def _fetch_project_tag_attribute_definitions(cursor, project_id: str, class_id: object | None) -> dict[str, list[dict]]:
    cursor.execute(
        f"""
        SELECT
            {_project_tag_attribute_definition_columns()}
        FROM attribute_definition ad
        JOIN project p ON p.id = %s
        WHERE ad.standard_id::text = p.reference_attributes ->> 'standard_id'
          AND ad.class_id IS NULL
          AND ad.applies_to IN ('tag', 'both')
          AND ad.status <> 'archived'
        ORDER BY ad.sort_order, ad.code
        """,
        (project_id,),
    )
    common_attributes = list(cursor.fetchall())

    if class_id is None:
        return {"common_attributes": common_attributes, "class_attributes": []}

    cursor.execute(
        f"""
        SELECT
            {_project_tag_attribute_definition_columns()}
        FROM attribute_definition ad
        JOIN class c ON c.id = ad.class_id
        JOIN project p ON p.id = %s
        WHERE ad.class_id = %s
          AND c.standard_id::text = p.reference_attributes ->> 'standard_id'
          AND c.applies_to IN ('tag', 'both')
          AND ad.applies_to IN ('tag', 'both')
          AND ad.status <> 'archived'
        ORDER BY ad.sort_order, ad.code
        """,
        (project_id, class_id),
    )
    return {
        "common_attributes": common_attributes,
        "class_attributes": list(cursor.fetchall()),
    }


def _matched_project_tag_attribute_codes(
    attribute_values: object,
    attribute_definitions: dict[str, list[dict]],
) -> list[str]:
    if not isinstance(attribute_values, dict):
        return []

    defined_codes = {
        str(attribute.get("code"))
        for attribute_group in (
            attribute_definitions.get("common_attributes", []),
            attribute_definitions.get("class_attributes", []),
        )
        for attribute in attribute_group
        if attribute.get("code")
    }
    return [str(code) for code in attribute_values.keys() if str(code) in defined_codes]


def search_project_tags(project_id: str, filters: dict | None = None) -> dict:
    filters = filters or {}
    mode = str(filters.get("mode") or "browse").strip().lower()
    if mode == "ai":
        raise ValueError("AI tag search is not implemented yet")
    if mode not in {"browse", "structured"}:
        raise ValueError(f"Unsupported search mode: {mode}")

    pbs_node_id = str(filters.get("pbs_node_id") or "").strip() or None
    include_descendants = bool(filters.get("include_descendants", True))
    include_children_value = filters.get("include_children")
    include_children = True if include_children_value is None else bool(include_children_value)
    keyword = str(filters.get("keyword") or "").strip().lower()
    class_id = str(filters.get("class_id") or "").strip() or None
    status = str(filters.get("status") or "").strip() or None
    attribute_filters = [item for item in (filters.get("attribute_filters") or []) if isinstance(item, dict)]
    page, page_size, offset = _normalize_project_tag_page(filters)

    where_clauses = ["t.project_id = %s"]
    params: list[object] = [project_id]

    scope_cte = ""
    scope_params: list[object] = []
    if pbs_node_id:
        if include_descendants:
            scope_cte = """
                WITH RECURSIVE pbs_scope AS (
                    SELECT id
                    FROM pbs_node
                    WHERE project_id = %s
                      AND id = %s
                    UNION ALL
                    SELECT child.id
                    FROM pbs_node child
                    JOIN pbs_scope parent_scope ON child.parent_id = parent_scope.id
                    WHERE child.project_id = %s
                )
            """
            scope_params = [project_id, pbs_node_id, project_id]
        else:
            scope_cte = """
                WITH pbs_scope AS (
                    SELECT id
                    FROM pbs_node
                    WHERE project_id = %s
                      AND id = %s
                )
            """
            scope_params = [project_id, pbs_node_id]
        where_clauses.append("t.pbs_node_id IN (SELECT id FROM pbs_scope)")

    if keyword:
        where_clauses.append("(lower(t.tag_no) LIKE %s OR lower(t.name) LIKE %s)")
        params.extend([f"%{keyword}%", f"%{keyword}%"])

    if class_id:
        where_clauses.append("t.class_id = %s")
        params.append(class_id)

    if status:
        where_clauses.append("t.status = %s")
        params.append(status)

    matched_attribute_codes: list[str] = []
    for attribute_filter in attribute_filters:
        _append_project_tag_attribute_condition(where_clauses, params, attribute_filter)
        code = str(attribute_filter.get("code") or "").strip()
        if code:
            matched_attribute_codes.append(code)

    where_sql = " AND ".join(where_clauses)

    with get_connection() as connection:
        with connection.cursor() as cursor:
            if pbs_node_id:
                cursor.execute(
                    """
                    SELECT id
                    FROM pbs_node
                    WHERE project_id = %s
                      AND id = %s
                    """,
                    (project_id, pbs_node_id),
                )
                if cursor.fetchone() is None:
                    raise LookupError("PBS node not found")

            if mode == "structured":
                cursor.execute(
                    f"""
                    {scope_cte}
                    SELECT COUNT(*)::int AS total
                    FROM tag t
                    WHERE {where_sql}
                    """,
                    tuple([*scope_params, *params]),
                )
                total = int(cursor.fetchone()["total"])

                cursor.execute(
                    f"""
                    {scope_cte}
                    SELECT
                        {_project_tag_select_columns()}
                    FROM tag t
                    LEFT JOIN class c ON c.id = t.class_id
                    LEFT JOIN pbs_node p ON p.id = t.pbs_node_id
                    LEFT JOIN tag parent ON parent.id = t.parent_tag_id
                    WHERE {where_sql}
                    ORDER BY t.created_at DESC, t.tag_no
                    LIMIT %s OFFSET %s
                    """,
                    tuple([*scope_params, *params, page_size, offset]),
                )
                items = list(cursor.fetchall())
                for item in items:
                    item["matched_attribute_codes"] = matched_attribute_codes
            else:
                browse_where_sql = f"{where_sql} AND t.parent_tag_id IS NULL"
                cursor.execute(
                    f"""
                    {scope_cte}
                    SELECT COUNT(*)::int AS total
                    FROM tag t
                    WHERE {browse_where_sql}
                    """,
                    tuple([*scope_params, *params]),
                )
                total = int(cursor.fetchone()["total"])

                cursor.execute(
                    f"""
                    {scope_cte}
                    SELECT
                        {_project_tag_select_columns()}
                    FROM tag t
                    LEFT JOIN class c ON c.id = t.class_id
                    LEFT JOIN pbs_node p ON p.id = t.pbs_node_id
                    LEFT JOIN tag parent ON parent.id = t.parent_tag_id
                    WHERE {browse_where_sql}
                    ORDER BY t.created_at DESC, t.tag_no
                    LIMIT %s OFFSET %s
                    """,
                    tuple([*scope_params, *params, page_size, offset]),
                )
                root_items = list(cursor.fetchall())

                root_ids = [str(item["id"]) for item in root_items]
                child_items: list[dict] = []
                if include_children and root_ids:
                    cursor.execute(
                        f"""
                        SELECT
                            {_project_tag_select_columns()}
                        FROM tag t
                        LEFT JOIN class c ON c.id = t.class_id
                        LEFT JOIN pbs_node p ON p.id = t.pbs_node_id
                        LEFT JOIN tag parent ON parent.id = t.parent_tag_id
                        WHERE t.project_id = %s
                          AND t.parent_tag_id = ANY(%s::uuid[])
                        ORDER BY t.created_at ASC, t.tag_no
                        """,
                        (project_id, root_ids),
                    )
                    child_items = list(cursor.fetchall())

                items = _group_project_tag_children(root_items, child_items)
                for item in items:
                    item["matched_attribute_codes"] = []
                    for child in item["children"]:
                        child["matched_attribute_codes"] = []

    total_pages = max(1, (total + page_size - 1) // page_size)
    return {
        "items": items,
        "page": page,
        "page_size": page_size,
        "total": total,
        "total_pages": total_pages,
        "has_more": _has_more_pages(page=page, page_size=page_size, total=total),
        "mode": mode,
    }


def get_project_tags(project_id: str) -> list[dict]:
    return fetch_all(
        """
        SELECT
            t.id,
            t.project_id,
            t.tag_no,
            t.name,
            t.pbs_node_id,
            t.class_id,
            t.parent_tag_id,
            t.attribute_values,
            t.status,
            t.created_at,
            t.updated_at,
            c.name AS class_name
        FROM tag t
        LEFT JOIN class c ON c.id = t.class_id
        WHERE t.project_id = %s
        ORDER BY t.created_at ASC
        """,
        (project_id,),
    )


def get_project_tag_detail(project_id: str, tag_id: str) -> dict | None:
    from .document_repository import list_project_documents
    from .equipment_repository import get_tag_equipment_implementation
    from .relation_repository import list_project_relations

    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                SELECT
                    {_project_tag_select_columns()}
                FROM tag t
                LEFT JOIN class c ON c.id = t.class_id
                LEFT JOIN pbs_node p ON p.id = t.pbs_node_id
                LEFT JOIN tag parent ON parent.id = t.parent_tag_id
                WHERE t.project_id = %s
                  AND t.id = %s
                """,
                (project_id, tag_id),
            )
            tag = cursor.fetchone()
            if tag is None:
                return None

            cursor.execute(
                f"""
                SELECT
                    {_project_tag_select_columns()}
                FROM tag t
                LEFT JOIN class c ON c.id = t.class_id
                LEFT JOIN pbs_node p ON p.id = t.pbs_node_id
                LEFT JOIN tag parent ON parent.id = t.parent_tag_id
                WHERE t.project_id = %s
                  AND t.parent_tag_id = %s
                ORDER BY t.created_at ASC, t.tag_no
                """,
                (project_id, tag_id),
            )
            children = list(cursor.fetchall())
            attribute_definitions = _fetch_project_tag_attribute_definitions(cursor, project_id, tag["class_id"])
            tag["matched_attribute_codes"] = _matched_project_tag_attribute_codes(
                tag.get("attribute_values"),
                attribute_definitions,
            )
            for child in children:
                child["matched_attribute_codes"] = []

    documents = list_project_documents(
        project_id,
        {
            "tag_id": tag_id,
            "page": 1,
            "page_size": 100,
        },
    )
    relations = list_project_relations(
        project_id,
        {
            "entity_kind": "tag",
            "entity_id": tag_id,
            "direction": "both",
        },
    )
    equipment_implementation = get_tag_equipment_implementation(project_id, tag_id)

    return {
        **tag,
        **attribute_definitions,
        "children": children,
        "linked_documents": documents["items"],
        "relations": relations,
        "equipment_implementation": equipment_implementation,
    }


def _optional_text_id(value: object | None) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _validate_project_tag_references(
    cursor,
    *,
    project_id: str,
    payload: dict,
    tag_id: str | None = None,
) -> None:
    pbs_node_id = _optional_text_id(payload.get("pbs_node_id"))
    if pbs_node_id:
        cursor.execute(
            """
            SELECT id
            FROM pbs_node
            WHERE id = %s
              AND project_id = %s
            """,
            (pbs_node_id, project_id),
        )
        if cursor.fetchone() is None:
            raise ValueError("PBS node does not belong to this project")

    class_id = _optional_text_id(payload.get("class_id"))
    if class_id:
        cursor.execute(
            """
            SELECT c.id
            FROM class c
            JOIN project p ON p.id = %s
            WHERE c.id = %s
              AND c.applies_to IN ('tag', 'both')
              AND c.status <> 'archived'
              AND p.reference_attributes ->> 'standard_id' = c.standard_id::text
            """,
            (project_id, class_id),
        )
        if cursor.fetchone() is None:
            raise ValueError("Class must belong to the project's standard")

    parent_tag_id = _optional_text_id(payload.get("parent_tag_id"))
    if not parent_tag_id:
        return

    if tag_id is not None and parent_tag_id == tag_id:
        raise ValueError("Tag cannot be its own parent")

    cursor.execute(
        """
        SELECT id, project_id
        FROM tag
        WHERE id = %s
        """,
        (parent_tag_id,),
    )
    parent = cursor.fetchone()
    if parent is None or str(parent["project_id"]) != project_id:
        raise ValueError("Parent tag does not belong to this project")

    if tag_id is None:
        return

    cursor.execute(
        """
        WITH RECURSIVE tag_descendants AS (
            SELECT id
            FROM tag
            WHERE id = %s
              AND project_id = %s
            UNION ALL
            SELECT child.id
            FROM tag child
            JOIN tag_descendants parent ON child.parent_tag_id = parent.id
            WHERE child.project_id = %s
        )
        SELECT id
        FROM tag_descendants
        WHERE id = %s
        """,
        (tag_id, project_id, project_id, parent_tag_id),
    )
    if cursor.fetchone() is not None:
        raise ValueError("Tag parent would create a cycle")


def create_project_tag(project_id: str, payload: dict) -> dict | None:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            _ensure_project_exists(cursor, project_id)
            _validate_project_tag_references(cursor, project_id=project_id, payload=payload)
            cursor.execute(
                """
                INSERT INTO tag (project_id, tag_no, name, pbs_node_id, class_id, parent_tag_id, attribute_values, status)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING *
                """,
                (
                    project_id,
                    payload["tag_no"],
                    payload["name"],
                    payload.get("pbs_node_id"),
                    payload.get("class_id"),
                    payload.get("parent_tag_id"),
                    Json(payload.get("attribute_values", {})),
                    payload.get("status", "active"),
                ),
            )
            row = cursor.fetchone()
        connection.commit()
    return row


def update_project_tag(tag_id: str, payload: dict) -> dict | None:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT project_id
                FROM tag
                WHERE id = %s
                """,
                (tag_id,),
            )
            existing = cursor.fetchone()
            if existing is None:
                return None
            project_id = str(existing["project_id"])
            _validate_project_tag_references(cursor, project_id=project_id, payload=payload, tag_id=tag_id)
            cursor.execute(
                """
                UPDATE tag
                SET
                    tag_no = %s,
                    name = %s,
                    pbs_node_id = %s,
                    class_id = %s,
                    parent_tag_id = %s,
                    attribute_values = %s,
                    status = %s,
                    updated_at = now()
                WHERE id = %s
                RETURNING *
                """,
                (
                    payload["tag_no"],
                    payload["name"],
                    payload.get("pbs_node_id"),
                    payload.get("class_id"),
                    payload.get("parent_tag_id"),
                    Json(payload.get("attribute_values", {})),
                    payload.get("status", "active"),
                    tag_id,
                ),
            )
            row = cursor.fetchone()
        connection.commit()
    return row


def delete_project_tag(tag_id: str) -> bool:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                WITH RECURSIVE tag_scope AS (
                    SELECT id
                    FROM tag
                    WHERE id = %s
                    UNION ALL
                    SELECT child.id
                    FROM tag child
                    JOIN tag_scope parent ON child.parent_tag_id = parent.id
                )
                SELECT id
                FROM tag_scope
                """,
                (tag_id,),
            )
            tag_ids = [str(row["id"]) for row in cursor.fetchall()]
            if not tag_ids:
                return False

            cursor.execute(
                """
                DELETE FROM project_relation
                WHERE (source_kind = 'tag' AND source_id = ANY(%s::uuid[]))
                   OR (target_kind = 'tag' AND target_id = ANY(%s::uuid[]))
                """,
                (tag_ids, tag_ids),
            )
            cursor.execute(
                """
                DELETE FROM tag
                WHERE id = %s
                """,
                (tag_id,),
            )

        connection.commit()
    return True


def get_pbs_nodes(project_id: str) -> list[dict]:
    return fetch_all(
        """
        SELECT
            n.id,
            n.project_id,
            n.parent_id,
            n.code,
            n.name,
            n.description,
            n.node_type,
            n.level_template_id,
            n.status,
            n.created_at,
            n.updated_at,
            lt.level_no,
            lt.code AS level_code,
            lt.name AS level_name
        FROM pbs_node n
        LEFT JOIN pbs_level_template lt ON lt.id = n.level_template_id
        WHERE n.project_id = %s
        ORDER BY n.created_at ASC
        """,
        (project_id,),
    )

def create_pbs_node(project_id: str, payload: dict) -> dict | None:
    created = execute_one(
        """
        INSERT INTO pbs_node (project_id, parent_id, code, name, description, node_type, level_template_id, status)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING id
        """,
        (
            project_id,
            payload.get("parent_id"),
            payload["code"],
            payload["name"],
            payload.get("description"),
            payload.get("node_type", "folder"),
            payload.get("level_template_id"),
            payload.get("status", "active"),
        ),
    )
    if created is None:
        return None
    return get_pbs_node_by_id(str(created["id"]))

def update_pbs_node(node_id: str, payload: dict) -> dict | None:
    updated = execute_one(
        """
        UPDATE pbs_node
        SET
            parent_id = %s,
            code = %s,
            name = %s,
            description = %s,
            node_type = %s,
            level_template_id = %s,
            status = %s,
            updated_at = now()
        WHERE id = %s
        RETURNING *
        """,
        (
            payload.get("parent_id"),
            payload["code"],
            payload["name"],
            payload.get("description"),
            payload.get("node_type", "folder"),
            payload.get("level_template_id"),
            payload.get("status", "active"),
            node_id,
        ),
    )
    if updated is None:
        return None
    return get_pbs_node_by_id(node_id)


# ── PBS Level Template ───────────────────────────────────────

def get_pbs_level_templates(standard_id: str) -> list[dict]:
    return fetch_all(
        """
        SELECT id, standard_id, level_no, code, name, description, created_at, updated_at
        FROM pbs_level_template
        WHERE standard_id = %s
        ORDER BY level_no ASC
        """,
        (standard_id,),
    )


def create_pbs_level(standard_id: str, payload: dict) -> dict | None:
    return execute_one(
        """
        INSERT INTO pbs_level_template (standard_id, level_no, code, name, description)
        VALUES (%s, %s, %s, %s, %s)
        RETURNING *
        """,
        (
            standard_id,
            payload["level_no"],
            payload["code"],
            payload["name"],
            payload.get("description"),
        ),
    )


def update_pbs_level(level_id: str, payload: dict) -> dict | None:
    return execute_one(
        """
        UPDATE pbs_level_template
        SET code = %s, name = %s, description = %s, updated_at = now()
        WHERE id = %s
        RETURNING *
        """,
        (
            payload["code"],
            payload["name"],
            payload.get("description"),
            level_id,
        ),
    )


def delete_pbs_level(level_id: str) -> bool:
    result = execute_one(
        "DELETE FROM pbs_level_template WHERE id = %s RETURNING id",
        (level_id,),
    )
    return result is not None


def get_pbs_node_by_id(node_id: str) -> dict | None:
    return fetch_one(
        """
        SELECT n.*, lt.level_no, lt.code AS level_code, lt.name AS level_name
        FROM pbs_node n
        LEFT JOIN pbs_level_template lt ON lt.id = n.level_template_id
        WHERE n.id = %s
        """,
        (node_id,),
    )
