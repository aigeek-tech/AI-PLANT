from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

from fastapi import Depends, HTTPException, Request, status

from .auth_repository import build_user_permission_map, get_session_user_by_token_hash
from .db import fetch_one
from .security import get_session_cookie_settings, hash_session_token


@dataclass
class AuthenticatedUser:
    id: str
    username: str
    email: str | None
    display_name: str
    status: str
    last_login_at: object | None
    created_at: object
    updated_at: object
    system_permissions: set[str] = field(default_factory=set)
    project_permissions: dict[str, set[str]] = field(default_factory=dict)
    standard_permissions: dict[str, set[str]] = field(default_factory=dict)
    roles: list[dict] = field(default_factory=list)

    def has_system_permission(self, permission_code: str) -> bool:
        return permission_code in self.system_permissions

    def has_permission(
        self,
        permission_code: str,
        *,
        project_id: str | None = None,
        standard_id: str | None = None,
    ) -> bool:
        if permission_code in self.system_permissions:
            return True
        if project_id is not None and permission_code in self.project_permissions.get(project_id, set()):
            return True
        if standard_id is not None and permission_code in self.standard_permissions.get(standard_id, set()):
            return True
        return False

    def visible_project_ids(self) -> list[str]:
        return sorted(self.project_permissions.keys())

    def has_any_project_permission(self, permission_code: str) -> bool:
        return any(permission_code in permissions for permissions in self.project_permissions.values())

    def project_ids_with_permission(self, permission_code: str) -> list[str]:
        return sorted(
            project_id
            for project_id, permissions in self.project_permissions.items()
            if permission_code in permissions
        )

    def has_any_standard_permission(self, permission_code: str) -> bool:
        return any(permission_code in permissions for permissions in self.standard_permissions.values())


def _not_authenticated(detail: str = "Not authenticated") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
    )


def _forbidden(detail: str = "Not enough permissions") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=detail,
    )


def build_authenticated_user(row: dict) -> AuthenticatedUser:
    permission_map = build_user_permission_map(str(row["id"]))
    return AuthenticatedUser(
        id=str(row["id"]),
        username=row["username"],
        email=row.get("email"),
        display_name=row["display_name"],
        status=row["status"],
        last_login_at=row.get("last_login_at"),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        system_permissions=permission_map["system_permissions"],
        project_permissions=permission_map["project_permissions"],
        standard_permissions=permission_map["standard_permissions"],
        roles=permission_map["roles"],
    )


def require_authenticated_user(request: Request) -> AuthenticatedUser:
    token = request.cookies.get(get_session_cookie_settings().name)
    if not token:
        raise _not_authenticated()

    session_user = get_session_user_by_token_hash(hash_session_token(token))
    if session_user is None:
        raise _not_authenticated("Session expired or invalid")
    if session_user["status"] != "active":
        raise _forbidden("User is disabled")
    return build_authenticated_user(session_user)


def require_permission(permission_code: str) -> Callable:
    def dependency(current_user: AuthenticatedUser = Depends(require_authenticated_user)) -> AuthenticatedUser:
        if not current_user.has_permission(permission_code):
            raise _forbidden()
        return current_user

    return dependency


def require_project_permission(permission_code: str, *, project_id_param: str = "project_id") -> Callable:
    def dependency(
        request: Request,
        current_user: AuthenticatedUser = Depends(require_authenticated_user),
    ) -> AuthenticatedUser:
        project_id = request.path_params.get(project_id_param)
        if not project_id or not current_user.has_permission(permission_code, project_id=str(project_id)):
            raise _forbidden()
        return current_user

    return dependency


def is_standard_bound_to_authorized_project(
    current_user: AuthenticatedUser,
    permission_code: str,
    standard_id: str,
) -> bool:
    project_ids = current_user.project_ids_with_permission(permission_code)
    if not project_ids:
        return False

    return fetch_one(
        """
        SELECT 1 AS allowed
        FROM project
        WHERE id::text = ANY(%s)
          AND reference_attributes ->> 'standard_id' = %s
        LIMIT 1
        """,
        (project_ids, standard_id),
    ) is not None


def can_read_standard(current_user: AuthenticatedUser, standard_id: str) -> bool:
    return current_user.has_permission(
        "standard.read",
        standard_id=standard_id,
    ) or is_standard_bound_to_authorized_project(
        current_user,
        "standard.read",
        standard_id,
    )


def require_standard_permission(permission_code: str, *, standard_id_param: str = "standard_id") -> Callable:
    def dependency(
        request: Request,
        current_user: AuthenticatedUser = Depends(require_authenticated_user),
    ) -> AuthenticatedUser:
        standard_id = request.path_params.get(standard_id_param)
        if current_user.has_permission(permission_code):
            return current_user
        if not standard_id:
            raise _forbidden()
        if current_user.has_permission(permission_code, standard_id=str(standard_id)):
            return current_user
        if (
            permission_code == "standard.read"
            and is_standard_bound_to_authorized_project(current_user, permission_code, str(standard_id))
        ):
            return current_user
        raise _forbidden()

    return dependency


def require_resource_project_permission(permission_code: str, *, path_param: str, sql: str) -> Callable:
    def dependency(
        request: Request,
        current_user: AuthenticatedUser = Depends(require_authenticated_user),
    ) -> AuthenticatedUser:
        if current_user.has_permission(permission_code):
            return current_user
        resource_id = request.path_params.get(path_param)
        if not resource_id:
            raise _forbidden()
        row = fetch_one(sql, (str(resource_id),))
        if row is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resource not found")
        project_id = str(row["project_id"])
        if not current_user.has_permission(permission_code, project_id=project_id):
            raise _forbidden()
        return current_user

    return dependency


def require_tag_permission(permission_code: str) -> Callable:
    return require_resource_project_permission(
        permission_code,
        path_param="tag_id",
        sql="SELECT project_id FROM tag WHERE id = %s",
    )


def require_pbs_node_permission(permission_code: str) -> Callable:
    return require_resource_project_permission(
        permission_code,
        path_param="node_id",
        sql="SELECT project_id FROM pbs_node WHERE id = %s",
    )


def require_any_standard_permission(permission_code: str) -> Callable:
    def dependency(current_user: AuthenticatedUser = Depends(require_authenticated_user)) -> AuthenticatedUser:
        if current_user.has_system_permission(permission_code):
            return current_user
        if current_user.has_any_standard_permission(permission_code):
            return current_user
        if permission_code == "standard.read" and current_user.has_any_project_permission(permission_code):
            return current_user
        raise _forbidden()

    return dependency


def require_resource_standard_permission(permission_code: str, *, path_param: str, sql: str) -> Callable:
    def dependency(
        request: Request,
        current_user: AuthenticatedUser = Depends(require_authenticated_user),
    ) -> AuthenticatedUser:
        if current_user.has_permission(permission_code):
            return current_user
        resource_id = request.path_params.get(path_param)
        if not resource_id:
            raise _forbidden()
        row = fetch_one(sql, (str(resource_id),))
        if row is None or row.get("standard_id") is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resource not found")
        standard_id = str(row["standard_id"])
        if current_user.has_permission(permission_code, standard_id=standard_id):
            return current_user
        if (
            permission_code == "standard.read"
            and is_standard_bound_to_authorized_project(current_user, permission_code, standard_id)
        ):
            return current_user
        raise _forbidden()

    return dependency


def require_class_standard_permission(permission_code: str) -> Callable:
    return require_resource_standard_permission(
        permission_code,
        path_param="class_id",
        sql="SELECT standard_id FROM class WHERE id = %s",
    )


def require_attribute_standard_permission(permission_code: str) -> Callable:
    return require_resource_standard_permission(
        permission_code,
        path_param="attribute_id",
        sql="""
            SELECT COALESCE(ad.standard_id, c.standard_id) AS standard_id
            FROM attribute_definition ad
            LEFT JOIN class c ON c.id = ad.class_id
            WHERE ad.id = %s
        """,
    )


def require_document_type_standard_permission(permission_code: str) -> Callable:
    return require_resource_standard_permission(
        permission_code,
        path_param="document_type_id",
        sql="SELECT standard_id FROM class WHERE id = %s AND applies_to = 'document'",
    )


def require_document_type_attribute_standard_permission(permission_code: str) -> Callable:
    return require_resource_standard_permission(
        permission_code,
        path_param="attribute_id",
        sql="""
            SELECT COALESCE(ad.standard_id, c.standard_id) AS standard_id
            FROM attribute_definition ad
            LEFT JOIN class c ON c.id = ad.class_id
            WHERE ad.id = %s
              AND (ad.class_id IS NULL OR c.applies_to = 'document')
        """,
    )


def require_pbs_level_standard_permission(permission_code: str) -> Callable:
    return require_resource_standard_permission(
        permission_code,
        path_param="level_id",
        sql="SELECT standard_id FROM pbs_level_template WHERE id = %s",
    )
