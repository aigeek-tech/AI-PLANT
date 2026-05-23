from __future__ import annotations

from collections import defaultdict
from datetime import datetime
import os
from typing import Any

from psycopg.types.json import Json

from .db import execute_one, fetch_all, fetch_one, get_connection
from .security import generate_session_token, get_session_ttl, hash_password, hash_session_token, utcnow


def _normalize_text(value: object | None) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _normalize_email(value: object | None) -> str | None:
    text = _normalize_text(value)
    return text.lower() if text else None


def _user_row_public(row: dict | None) -> dict | None:
    if row is None:
        return None
    payload = {
        "id": str(row["id"]),
        "username": row["username"],
        "email": row.get("email"),
        "display_name": row["display_name"],
        "status": row["status"],
        "last_login_at": row.get("last_login_at"),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }
    if "role_codes" in row:
        payload["role_codes"] = list(row.get("role_codes") or [])
    if "role_names" in row:
        payload["role_names"] = list(row.get("role_names") or [])
    return payload


def get_user_by_username(username: str) -> dict | None:
    normalized = _normalize_text(username)
    if normalized is None:
        return None
    return fetch_one(
        """
        SELECT
            id,
            username,
            email,
            display_name,
            password_hash,
            status,
            last_login_at,
            created_at,
            updated_at
        FROM user_account
        WHERE lower(username) = lower(%s)
        """,
        (normalized,),
    )


def get_user_by_id(user_id: str) -> dict | None:
    row = fetch_one(
        """
        SELECT
            id,
            username,
            email,
            display_name,
            password_hash,
            status,
            last_login_at,
            created_at,
            updated_at
        FROM user_account
        WHERE id = %s
        """,
        (user_id,),
    )
    return row


def list_users() -> list[dict]:
    rows = fetch_all(
        """
        SELECT
            u.id,
            u.username,
            u.email,
            u.display_name,
            u.status,
            u.last_login_at,
            u.created_at,
            u.updated_at,
            COALESCE(
                array_agg(rd.code ORDER BY rd.code)
                    FILTER (WHERE rd.scope_kind = 'system' AND rd.code IS NOT NULL),
                '{}'::text[]
            ) AS role_codes,
            COALESCE(
                array_agg(rd.name ORDER BY rd.code)
                    FILTER (WHERE rd.scope_kind = 'system' AND rd.name IS NOT NULL),
                '{}'::text[]
            ) AS role_names
        FROM user_account u
        LEFT JOIN user_role_assignment ura
            ON ura.user_id = u.id
           AND (ura.expires_at IS NULL OR ura.expires_at > now())
        LEFT JOIN role_definition rd
            ON rd.id = ura.role_id
           AND rd.status = 'active'
        GROUP BY u.id, u.username, u.email, u.display_name, u.status, u.last_login_at, u.created_at, u.updated_at
        ORDER BY u.created_at DESC, u.username ASC
        """
    )
    return [_user_row_public(row) for row in rows]


def list_user_candidates() -> list[dict]:
    rows = fetch_all(
        """
        SELECT
            id,
            username,
            email,
            display_name,
            status,
            last_login_at,
            created_at,
            updated_at
        FROM user_account
        WHERE status = 'active'
        ORDER BY display_name ASC, username ASC
        """
    )
    return [_user_row_public(row) for row in rows]


def count_users() -> int:
    row = fetch_one("SELECT COUNT(*)::int AS total FROM user_account")
    return int(row["total"]) if row else 0


def create_user(payload: dict) -> dict:
    created = execute_one(
        """
        INSERT INTO user_account (username, email, display_name, password_hash, status, metadata)
        VALUES (%s, %s, %s, %s, %s, %s)
        RETURNING id
        """,
        (
            payload["username"].strip(),
            _normalize_email(payload.get("email")),
            payload["display_name"].strip(),
            hash_password(payload["password"]),
            payload.get("status", "active"),
            Json(payload.get("metadata", {})),
        ),
    )
    if created is None:
        raise ValueError("User was not created")
    user = get_user_by_id(str(created["id"]))
    if user is None:
        raise ValueError("User was not created")
    return _user_row_public(user)


def bootstrap_first_admin(payload: dict) -> dict | None:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", ("smart-design-bootstrap-admin",))
            cursor.execute("SELECT COUNT(*)::int AS total FROM user_account")
            if int(cursor.fetchone()["total"]) > 0:
                connection.rollback()
                return None

            cursor.execute(
                """
                INSERT INTO user_account (username, email, display_name, password_hash, status, metadata)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING
                    id,
                    username,
                    email,
                    display_name,
                    status,
                    last_login_at,
                    created_at,
                    updated_at
                """,
                (
                    payload["username"].strip(),
                    _normalize_email(payload.get("email")),
                    payload["display_name"].strip(),
                    hash_password(payload["password"]),
                    payload.get("status", "active"),
                    Json(payload.get("metadata", {"bootstrap": True})),
                ),
            )
            user = cursor.fetchone()

            cursor.execute(
                """
                INSERT INTO user_role_assignment (user_id, role_id, scope_id, granted_by)
                SELECT %s, rd.id, NULL, NULL
                FROM role_definition rd
                WHERE rd.scope_kind = 'system'
                  AND rd.code = 'system_admin'
                  AND rd.status = 'active'
                """,
                (user["id"],),
            )
            cursor.execute(
                """
                INSERT INTO authorization_audit_log (
                    actor_user_id,
                    action,
                    scope_kind,
                    scope_id,
                    target_type,
                    target_id,
                    metadata
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    user["id"],
                    "bootstrap.admin.create",
                    "system",
                    None,
                    "user",
                    user["id"],
                    Json({"username": user["username"]}),
                ),
            )
        connection.commit()

    return _user_row_public(user)


def update_user(user_id: str, payload: dict) -> dict | None:
    existing = get_user_by_id(user_id)
    if existing is None:
        return None

    password_hash = existing["password_hash"]
    if payload.get("password"):
        password_hash = hash_password(payload["password"])

    updated = execute_one(
        """
        UPDATE user_account
        SET
            email = %s,
            display_name = %s,
            password_hash = %s,
            status = %s,
            updated_at = now()
        WHERE id = %s
        RETURNING id
        """,
        (
            _normalize_email(payload.get("email", existing.get("email"))),
            payload.get("display_name") or existing["display_name"],
            password_hash,
            payload.get("status") or existing["status"],
            user_id,
        ),
    )
    if updated is None:
        return None
    user = get_user_by_id(user_id)
    return _user_row_public(user)


def create_session(user_id: str, *, user_agent: str | None, ip_address: str | None) -> tuple[str, dict]:
    token = generate_session_token()
    token_hash = hash_session_token(token)
    expires_at = utcnow() + get_session_ttl()
    session = execute_one(
        """
        INSERT INTO user_session (user_id, session_token_hash, expires_at, user_agent, ip_address)
        VALUES (%s, %s, %s, %s, %s)
        RETURNING id, user_id, expires_at, created_at, updated_at
        """,
        (user_id, token_hash, expires_at, user_agent, ip_address),
    )
    if session is None:
        raise ValueError("Session was not created")
    return token, {
        "id": str(session["id"]),
        "user_id": str(session["user_id"]),
        "expires_at": session["expires_at"],
        "created_at": session["created_at"],
        "updated_at": session["updated_at"],
    }


def revoke_session_by_token_hash(token_hash: str) -> None:
    execute_one(
        """
        UPDATE user_session
        SET
            revoked_at = now(),
            updated_at = now()
        WHERE session_token_hash = %s
          AND revoked_at IS NULL
        RETURNING id
        """,
        (token_hash,),
    )


def revoke_all_user_sessions(user_id: str) -> None:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE user_session
                SET
                    revoked_at = now(),
                    updated_at = now()
                WHERE user_id = %s
                  AND revoked_at IS NULL
                """,
                (user_id,),
            )
        connection.commit()


def mark_user_logged_in(user_id: str) -> None:
    execute_one(
        """
        UPDATE user_account
        SET
            last_login_at = now(),
            updated_at = now()
        WHERE id = %s
        RETURNING id
        """,
        (user_id,),
    )


def get_session_user_by_token_hash(token_hash: str) -> dict | None:
    return fetch_one(
        """
        SELECT
            s.id AS session_id,
            s.user_id,
            s.expires_at,
            s.revoked_at,
            u.id,
            u.username,
            u.email,
            u.display_name,
            u.password_hash,
            u.status,
            u.last_login_at,
            u.created_at,
            u.updated_at
        FROM user_session s
        JOIN user_account u ON u.id = s.user_id
        WHERE s.session_token_hash = %s
          AND s.revoked_at IS NULL
          AND s.expires_at > now()
        """,
        (token_hash,),
    )


def list_roles() -> list[dict]:
    rows = fetch_all(
        """
        SELECT
            rd.id,
            rd.code,
            rd.name,
            rd.scope_kind,
            rd.is_builtin,
            rd.status,
            COALESCE(array_agg(rp.permission_code ORDER BY rp.permission_code)
                FILTER (WHERE rp.permission_code IS NOT NULL), '{}'::text[]) AS permissions
        FROM role_definition rd
        LEFT JOIN role_permission rp ON rp.role_id = rd.id
        GROUP BY rd.id, rd.code, rd.name, rd.scope_kind, rd.is_builtin, rd.status
        ORDER BY rd.scope_kind, rd.code
        """
    )
    return [
        {
            "id": str(row["id"]),
            "code": row["code"],
            "name": row["name"],
            "scope_kind": row["scope_kind"],
            "is_builtin": row["is_builtin"],
            "status": row["status"],
            "permissions": list(row.get("permissions") or []),
        }
        for row in rows
    ]


def list_roles_by_scope(scope_kind: str) -> list[dict]:
    rows = fetch_all(
        """
        SELECT
            rd.id,
            rd.code,
            rd.name,
            rd.scope_kind,
            rd.is_builtin,
            rd.status,
            COALESCE(array_agg(rp.permission_code ORDER BY rp.permission_code)
                FILTER (WHERE rp.permission_code IS NOT NULL), '{}'::text[]) AS permissions
        FROM role_definition rd
        LEFT JOIN role_permission rp ON rp.role_id = rd.id
        WHERE rd.scope_kind = %s
          AND rd.status = 'active'
        GROUP BY rd.id, rd.code, rd.name, rd.scope_kind, rd.is_builtin, rd.status
        ORDER BY rd.code
        """,
        (scope_kind,),
    )
    return [
        {
            "id": str(row["id"]),
            "code": row["code"],
            "name": row["name"],
            "scope_kind": row["scope_kind"],
            "is_builtin": row["is_builtin"],
            "status": row["status"],
            "permissions": list(row.get("permissions") or []),
        }
        for row in rows
    ]


def list_user_assignments(user_id: str) -> list[dict]:
    rows = fetch_all(
        """
        SELECT
            ura.id,
            ura.scope_id,
            ura.expires_at,
            rd.id AS role_id,
            rd.code,
            rd.name,
            rd.scope_kind,
            rd.is_builtin,
            rd.status,
            COALESCE(array_agg(rp.permission_code ORDER BY rp.permission_code)
                FILTER (WHERE rp.permission_code IS NOT NULL), '{}'::text[]) AS permissions
        FROM user_role_assignment ura
        JOIN role_definition rd ON rd.id = ura.role_id
        LEFT JOIN role_permission rp ON rp.role_id = rd.id
        WHERE ura.user_id = %s
          AND (ura.expires_at IS NULL OR ura.expires_at > now())
          AND rd.status = 'active'
        GROUP BY ura.id, ura.scope_id, ura.expires_at, rd.id, rd.code, rd.name, rd.scope_kind, rd.is_builtin, rd.status
        ORDER BY rd.scope_kind, rd.code
        """,
        (user_id,),
    )
    return [
        {
            "id": str(row["id"]),
            "scope_id": str(row["scope_id"]) if row.get("scope_id") is not None else None,
            "expires_at": row.get("expires_at"),
            "role": {
                "id": str(row["role_id"]),
                "code": row["code"],
                "name": row["name"],
                "scope_kind": row["scope_kind"],
                "is_builtin": row["is_builtin"],
                "status": row["status"],
                "permissions": list(row.get("permissions") or []),
            },
        }
        for row in rows
    ]


def list_project_members(project_id: str) -> list[dict]:
    rows = fetch_all(
        """
        SELECT
            u.id,
            u.username,
            u.email,
            u.display_name,
            u.status,
            u.last_login_at,
            u.created_at,
            u.updated_at,
            array_agg(rd.code ORDER BY rd.code) AS role_codes,
            array_agg(rd.name ORDER BY rd.code) AS role_names
        FROM user_role_assignment ura
        JOIN role_definition rd ON rd.id = ura.role_id
        JOIN user_account u ON u.id = ura.user_id
        WHERE ura.scope_id = %s
          AND rd.scope_kind = 'project'
          AND rd.status = 'active'
          AND (ura.expires_at IS NULL OR ura.expires_at > now())
        GROUP BY u.id, u.username, u.email, u.display_name, u.status, u.last_login_at, u.created_at, u.updated_at
        ORDER BY u.display_name, u.username
        """,
        (project_id,),
    )
    return [
        {
            "user": _user_row_public(row),
            "project_id": project_id,
            "role_codes": list(row.get("role_codes") or []),
            "role_names": list(row.get("role_names") or []),
        }
        for row in rows
    ]


def sync_system_user_roles(user_id: str, role_codes: list[str], *, granted_by: str | None = None) -> list[str]:
    normalized = sorted({code.strip().lower() for code in role_codes if code.strip()})
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT id FROM user_account WHERE id = %s", (user_id,))
            if cursor.fetchone() is None:
                raise ValueError("User not found")

            cursor.execute(
                """
                SELECT id, code
                FROM role_definition
                WHERE scope_kind = 'system'
                  AND status = 'active'
                  AND code = ANY(%s::text[])
                """,
                (normalized,),
            )
            roles = list(cursor.fetchall())
            found_codes = {row["code"] for row in roles}
            missing = [code for code in normalized if code not in found_codes]
            if missing:
                raise ValueError(f"Unknown system role codes: {', '.join(missing)}")

            cursor.execute(
                """
                DELETE FROM user_role_assignment
                WHERE user_id = %s
                  AND role_id IN (
                      SELECT id
                      FROM role_definition
                      WHERE scope_kind = 'system'
                  )
                """,
                (user_id,),
            )

            for role in roles:
                cursor.execute(
                    """
                    INSERT INTO user_role_assignment (user_id, role_id, scope_id, granted_by)
                    VALUES (%s, %s, NULL, %s)
                    ON CONFLICT DO NOTHING
                    """,
                    (user_id, role["id"], granted_by),
                )
        connection.commit()

    record_authorization_audit_log(
        actor_user_id=granted_by,
        action="user.system_roles.sync",
        scope_kind="system",
        scope_id=None,
        target_type="user",
        target_id=user_id,
        metadata={"role_codes": normalized},
    )
    updated_user = next((user for user in list_users() if user["id"] == user_id), None)
    return list(updated_user.get("role_codes") or []) if updated_user else []


def sync_project_member_roles(project_id: str, user_id: str, role_codes: list[str], *, granted_by: str | None = None) -> list[dict]:
    normalized = sorted({code.strip().lower() for code in role_codes if code.strip()})
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT id FROM project WHERE id = %s", (project_id,))
            if cursor.fetchone() is None:
                raise ValueError("Project not found")

            cursor.execute("SELECT id FROM user_account WHERE id = %s", (user_id,))
            if cursor.fetchone() is None:
                raise ValueError("User not found")

            cursor.execute(
                """
                SELECT id, code
                FROM role_definition
                WHERE scope_kind = 'project'
                  AND status = 'active'
                  AND code = ANY(%s::text[])
                """,
                (normalized,),
            )
            roles = list(cursor.fetchall())
            found_codes = {row["code"] for row in roles}
            missing = [code for code in normalized if code not in found_codes]
            if missing:
                raise ValueError(f"Unknown project role codes: {', '.join(missing)}")

            cursor.execute(
                """
                DELETE FROM user_role_assignment
                WHERE user_id = %s
                  AND scope_id = %s
                  AND role_id IN (
                      SELECT id
                      FROM role_definition
                      WHERE scope_kind = 'project'
                  )
                """,
                (user_id, project_id),
            )

            for role in roles:
                cursor.execute(
                    """
                    INSERT INTO user_role_assignment (user_id, role_id, scope_id, granted_by)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT DO NOTHING
                    """,
                    (user_id, role["id"], project_id, granted_by),
                )

        connection.commit()

    record_authorization_audit_log(
        actor_user_id=granted_by,
        action="project.member.sync",
        scope_kind="project",
        scope_id=project_id,
        target_type="user",
        target_id=user_id,
        metadata={"role_codes": normalized},
    )
    return list_project_members(project_id)


def remove_project_member(project_id: str, user_id: str, *, granted_by: str | None = None) -> None:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                DELETE FROM user_role_assignment
                WHERE user_id = %s
                  AND scope_id = %s
                  AND role_id IN (
                      SELECT id
                      FROM role_definition
                      WHERE scope_kind = 'project'
                  )
                """,
                (user_id, project_id),
            )
        connection.commit()

    record_authorization_audit_log(
        actor_user_id=granted_by,
        action="project.member.remove",
        scope_kind="project",
        scope_id=project_id,
        target_type="user",
        target_id=user_id,
        metadata={},
    )


def assign_project_role(project_id: str, user_id: str, role_code: str, *, granted_by: str | None = None) -> None:
    sync_project_member_roles(project_id, user_id, [role_code], granted_by=granted_by)


def assign_system_role(user_id: str, role_code: str) -> None:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO user_role_assignment (user_id, role_id, scope_id, granted_by)
                SELECT %s, rd.id, NULL, NULL
                FROM role_definition rd
                WHERE rd.scope_kind = 'system'
                  AND rd.code = %s
                  AND rd.status = 'active'
                ON CONFLICT DO NOTHING
                """,
                (user_id, role_code),
            )
        connection.commit()


def record_authorization_audit_log(
    *,
    actor_user_id: str | None,
    action: str,
    scope_kind: str | None,
    scope_id: str | None,
    target_type: str | None,
    target_id: str | None,
    metadata: dict[str, Any] | None,
) -> None:
    execute_one(
        """
        INSERT INTO authorization_audit_log (
            actor_user_id,
            action,
            scope_kind,
            scope_id,
            target_type,
            target_id,
            metadata
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        RETURNING id
        """,
        (
            actor_user_id,
            action,
            scope_kind,
            scope_id,
            target_type,
            target_id,
            Json(metadata or {}),
        ),
    )


def list_authorization_audit_logs(limit: int = 100) -> list[dict]:
    rows = fetch_all(
        """
        SELECT
            id,
            actor_user_id,
            action,
            scope_kind,
            scope_id,
            target_type,
            target_id,
            metadata,
            created_at
        FROM authorization_audit_log
        ORDER BY created_at DESC
        LIMIT %s
        """,
        (limit,),
    )
    return [
        {
            **row,
            "id": str(row["id"]),
            "actor_user_id": str(row["actor_user_id"]) if row.get("actor_user_id") else None,
            "scope_id": str(row["scope_id"]) if row.get("scope_id") else None,
            "target_id": str(row["target_id"]) if row.get("target_id") else None,
        }
        for row in rows
    ]


def build_user_permission_map(user_id: str) -> dict[str, Any]:
    system_permissions: set[str] = set()
    project_permissions: dict[str, set[str]] = defaultdict(set)
    standard_permissions: dict[str, set[str]] = defaultdict(set)
    roles: list[dict] = []

    for assignment in list_user_assignments(user_id):
        role = assignment["role"]
        scope_id = assignment["scope_id"]
        permissions = set(role["permissions"])
        role_summary = {
            "id": role["id"],
            "code": role["code"],
            "name": role["name"],
            "scope_kind": role["scope_kind"],
            "is_builtin": role["is_builtin"],
            "status": role["status"],
            "permissions": sorted(permissions),
        }
        roles.append(role_summary)
        if role["scope_kind"] == "system" and scope_id is None:
            system_permissions.update(permissions)
        elif role["scope_kind"] == "project" and scope_id is not None:
            project_permissions[scope_id].update(permissions)
        elif role["scope_kind"] == "standard" and scope_id is not None:
            standard_permissions[scope_id].update(permissions)

    return {
        "system_permissions": {code for code in system_permissions},
        "project_permissions": {scope_id: set(values) for scope_id, values in project_permissions.items()},
        "standard_permissions": {scope_id: set(values) for scope_id, values in standard_permissions.items()},
        "roles": roles,
    }


def ensure_bootstrap_admin() -> None:
    username = _normalize_text(os.getenv("SMART_DESIGN_BOOTSTRAP_ADMIN_USERNAME"))
    password = _normalize_text(os.getenv("SMART_DESIGN_BOOTSTRAP_ADMIN_PASSWORD"))
    display_name = _normalize_text(os.getenv("SMART_DESIGN_BOOTSTRAP_ADMIN_DISPLAY_NAME")) or "System Admin"
    email = _normalize_email(os.getenv("SMART_DESIGN_BOOTSTRAP_ADMIN_EMAIL"))
    if not username or not password:
        return

    existing = get_user_by_username(username)
    if existing is None:
        bootstrap_first_admin(
            {
                "username": username,
                "email": email,
                "display_name": display_name,
                "password": password,
                "status": "active",
                "metadata": {"bootstrap": True},
            }
        )
        return
    else:
        user_id = str(existing["id"])

    assign_system_role(user_id, "system_admin")
