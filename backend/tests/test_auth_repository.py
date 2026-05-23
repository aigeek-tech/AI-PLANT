import os
from unittest.mock import patch

from app.auth_repository import build_user_permission_map, ensure_bootstrap_admin


def test_build_user_permission_map_does_not_promote_scoped_role_without_scope_id():
    with patch(
        "app.auth_repository.list_user_assignments",
        return_value=[
            {
                "id": "assignment-1",
                "scope_id": None,
                "expires_at": None,
                "role": {
                    "id": "role-project-viewer",
                    "code": "project_viewer",
                    "name": "Project Viewer",
                    "scope_kind": "project",
                    "is_builtin": True,
                    "status": "active",
                    "permissions": ["project.read"],
                },
            }
        ],
    ):
        result = build_user_permission_map("user-1")

    assert result["system_permissions"] == set()
    assert result["project_permissions"] == {}


def test_build_user_permission_map_tracks_standard_permissions_by_scope():
    with patch(
        "app.auth_repository.list_user_assignments",
        return_value=[
            {
                "id": "assignment-1",
                "scope_id": "standard-1",
                "expires_at": None,
                "role": {
                    "id": "role-standard-viewer",
                    "code": "standard_viewer",
                    "name": "Standard Viewer",
                    "scope_kind": "standard",
                    "is_builtin": False,
                    "status": "active",
                    "permissions": ["standard.read"],
                },
            }
        ],
    ):
        result = build_user_permission_map("user-1")

    assert result["standard_permissions"] == {"standard-1": {"standard.read"}}


def test_ensure_bootstrap_admin_uses_atomic_bootstrap_for_missing_user():
    with (
        patch.dict(
            os.environ,
            {
                "SMART_DESIGN_BOOTSTRAP_ADMIN_USERNAME": "admin",
                "SMART_DESIGN_BOOTSTRAP_ADMIN_PASSWORD": "password-123",
                "SMART_DESIGN_BOOTSTRAP_ADMIN_DISPLAY_NAME": "System Admin",
            },
            clear=False,
        ),
        patch("app.auth_repository.get_user_by_username", return_value=None),
        patch("app.auth_repository.bootstrap_first_admin") as bootstrap_first_admin,
        patch("app.auth_repository.assign_system_role") as assign_system_role,
    ):
        ensure_bootstrap_admin()

    bootstrap_first_admin.assert_called_once()
    assign_system_role.assert_not_called()


def test_ensure_bootstrap_admin_repairs_existing_user_role():
    with (
        patch.dict(
            os.environ,
            {
                "SMART_DESIGN_BOOTSTRAP_ADMIN_USERNAME": "admin",
                "SMART_DESIGN_BOOTSTRAP_ADMIN_PASSWORD": "password-123",
            },
            clear=False,
        ),
        patch("app.auth_repository.get_user_by_username", return_value={"id": "user-1"}),
        patch("app.auth_repository.bootstrap_first_admin") as bootstrap_first_admin,
        patch("app.auth_repository.assign_system_role") as assign_system_role,
    ):
        ensure_bootstrap_admin()

    bootstrap_first_admin.assert_not_called()
    assign_system_role.assert_called_once_with("user-1", "system_admin")
