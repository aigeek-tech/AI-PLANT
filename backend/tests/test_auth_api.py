from contextlib import contextmanager
from datetime import datetime, UTC
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.authorization import AuthenticatedUser, require_authenticated_user
from app.main import app
from app.security import hash_password


client = TestClient(app)


@contextmanager
def auth_override_disabled():
    previous = app.dependency_overrides.pop(require_authenticated_user, None)
    try:
        yield
    finally:
        if previous is not None:
            app.dependency_overrides[require_authenticated_user] = previous


@contextmanager
def override_authenticated_user(user: AuthenticatedUser):
    previous = app.dependency_overrides.get(require_authenticated_user)
    app.dependency_overrides[require_authenticated_user] = lambda: user
    try:
        yield
    finally:
        if previous is not None:
            app.dependency_overrides[require_authenticated_user] = previous


def _user_row(password_hash: str | None = None) -> dict:
    now = datetime(2026, 4, 23, tzinfo=UTC)
    return {
        "id": "user-1",
        "username": "alice",
        "email": "alice@example.test",
        "display_name": "Alice",
        "password_hash": password_hash or hash_password("correct-password"),
        "status": "active",
        "last_login_at": None,
        "created_at": now,
        "updated_at": now,
    }


def test_login_sets_session_cookie_and_returns_permissions():
    client.cookies.clear()
    with auth_override_disabled():
        user = _user_row()
        with (
            patch("app.auth_api.get_user_by_username", return_value=user),
            patch("app.auth_api.create_session", return_value=("raw-session-token", {"id": "session-1"})),
            patch("app.auth_api.mark_user_logged_in"),
            patch("app.auth_api.get_user_by_id", return_value=user),
            patch(
                "app.authorization.build_user_permission_map",
                return_value={
                    "system_permissions": {"project.create"},
                    "project_permissions": {"project-1": {"project.read"}},
                    "standard_permissions": {},
                    "roles": [],
                },
            ),
        ):
            response = client.post(
                "/api/auth/login",
                json={"username": "alice", "password": "correct-password"},
            )

    assert response.status_code == 200
    assert "smart_design_session=" in response.headers["set-cookie"]
    payload = response.json()["data"]
    assert payload["user"]["username"] == "alice"
    assert payload["system_permissions"] == ["project.create"]
    assert payload["project_permissions"] == {"project-1": ["project.read"]}


def test_bootstrap_admin_returns_409_when_already_complete():
    client.cookies.clear()
    with (
        patch("app.auth_api.bootstrap_first_admin", return_value=None),
    ):
        response = client.post(
            "/api/auth/bootstrap/admin",
            json={
                "username": "admin",
                "display_name": "Admin",
                "password": "correct-password",
            },
        )

    assert response.status_code == 409
    assert response.json() == {"detail": "Bootstrap is already complete"}


def test_login_rejects_invalid_password():
    client.cookies.clear()
    with auth_override_disabled():
        with patch("app.auth_api.get_user_by_username", return_value=_user_row()):
            response = client.post(
                "/api/auth/login",
                json={"username": "alice", "password": "wrong-password"},
            )

    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid username or password"}


def test_login_rejects_invalid_password_with_localized_error_contract():
    client.cookies.clear()
    with auth_override_disabled():
        with patch("app.auth_api.get_user_by_username", return_value=_user_row()):
            response = client.post(
                "/api/auth/login",
                headers={"X-Locale": "en-US"},
                json={"username": "alice", "password": "wrong-password"},
            )

    assert response.status_code == 401
    assert response.json() == {
        "detail": {
            "code": "authInvalidCredentials",
            "message": "Invalid username or password.",
            "params": {},
        }
    }


def test_me_requires_authentication_without_session():
    client.cookies.clear()
    with auth_override_disabled():
        response = client.get("/api/auth/me")

    assert response.status_code == 401
    assert response.json() == {"detail": "Not authenticated"}


def test_project_viewer_cannot_create_tag():
    viewer = AuthenticatedUser(
        id="viewer",
        username="viewer",
        email=None,
        display_name="Viewer",
        status="active",
        last_login_at=None,
        created_at="2026-04-23T00:00:00Z",
        updated_at="2026-04-23T00:00:00Z",
        project_permissions={"project-1": {"project.read", "project.tag.read"}},
    )
    with override_authenticated_user(viewer):
        response = client.post(
            "/api/projects/project-1/tags",
            json={"tag_no": "P-1001", "name": "Pump", "attribute_values": {}},
        )

    assert response.status_code == 403
    assert response.json() == {"detail": "Not enough permissions"}


def test_project_viewer_can_read_project_detail():
    viewer = AuthenticatedUser(
        id="viewer",
        username="viewer",
        email=None,
        display_name="Viewer",
        status="active",
        last_login_at=None,
        created_at="2026-04-23T00:00:00Z",
        updated_at="2026-04-23T00:00:00Z",
        project_permissions={"project-1": {"project.read"}},
    )
    detail = {"id": "project-1", "code": "PRJ-001", "name": "Project"}
    with override_authenticated_user(viewer):
        with patch("app.main.get_project_detail", return_value=detail):
            response = client.get("/api/projects/project-1")

    assert response.status_code == 200
    assert response.json() == {"data": detail}


def test_project_editor_can_create_tag():
    editor = AuthenticatedUser(
        id="editor",
        username="editor",
        email=None,
        display_name="Editor",
        status="active",
        last_login_at=None,
        created_at="2026-04-23T00:00:00Z",
        updated_at="2026-04-23T00:00:00Z",
        project_permissions={"project-1": {"project.read", "project.tag.write"}},
    )
    created = {"id": "tag-1", "project_id": "project-1", "tag_no": "P-1001", "name": "Pump"}
    with override_authenticated_user(editor):
        with patch("app.main.create_project_tag", return_value=created):
            response = client.post(
                "/api/projects/project-1/tags",
                json={"tag_no": "P-1001", "name": "Pump", "attribute_values": {}},
            )

    assert response.status_code == 200
    assert response.json() == {"data": created}


def test_project_viewer_cannot_delete_tag():
    viewer = AuthenticatedUser(
        id="viewer",
        username="viewer",
        email=None,
        display_name="Viewer",
        status="active",
        last_login_at=None,
        created_at="2026-04-23T00:00:00Z",
        updated_at="2026-04-23T00:00:00Z",
        project_permissions={"project-1": {"project.read", "project.tag.read"}},
    )
    with override_authenticated_user(viewer):
        with patch("app.authorization.fetch_one", return_value={"project_id": "project-1"}):
            response = client.delete("/api/tags/tag-1")

    assert response.status_code == 403
    assert response.json() == {"detail": "Not enough permissions"}


def test_project_editor_can_delete_tag():
    editor = AuthenticatedUser(
        id="editor",
        username="editor",
        email=None,
        display_name="Editor",
        status="active",
        last_login_at=None,
        created_at="2026-04-23T00:00:00Z",
        updated_at="2026-04-23T00:00:00Z",
        project_permissions={"project-1": {"project.read", "project.tag.write"}},
    )
    with override_authenticated_user(editor):
        with patch("app.authorization.fetch_one", return_value={"project_id": "project-1"}):
            with patch("app.main.delete_project_tag", return_value=True) as delete_project_tag:
                response = client.delete("/api/tags/tag-1")

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    delete_project_tag.assert_called_once_with("tag-1")


def test_ai_settings_write_requires_system_permission():
    limited = AuthenticatedUser(
        id="limited",
        username="limited",
        email=None,
        display_name="Limited",
        status="active",
        last_login_at=None,
        created_at="2026-04-23T00:00:00Z",
        updated_at="2026-04-23T00:00:00Z",
        system_permissions=set(),
        project_permissions={"project-1": {"project.read"}},
    )
    with override_authenticated_user(limited):
        response = client.patch(
            "/api/settings/ai",
            json={
                "provider": "openai-compatible",
                "base_url": "https://llm.example.com",
                "endpoint_path": "/v1/chat/completions",
                "model": "engineering-assistant",
            },
        )

    assert response.status_code == 403
    assert response.json() == {"detail": "Not enough permissions"}


def test_branding_settings_write_requires_system_permission():
    limited = AuthenticatedUser(
        id="limited",
        username="limited",
        email=None,
        display_name="Limited",
        status="active",
        last_login_at=None,
        created_at="2026-04-23T00:00:00Z",
        updated_at="2026-04-23T00:00:00Z",
        system_permissions=set(),
        project_permissions={"project-1": {"project.read"}},
    )
    with override_authenticated_user(limited):
        response = client.patch(
            "/api/settings/branding",
            json={
                "system_name": "AI PLANT",
                "sidebar_title": "智能工厂",
                "logo_data_url": None,
            },
        )

    assert response.status_code == 403
    assert response.json() == {"detail": "Not enough permissions"}


def test_standard_read_requires_permission():
    limited = AuthenticatedUser(
        id="limited",
        username="limited",
        email=None,
        display_name="Limited",
        status="active",
        last_login_at=None,
        created_at="2026-04-23T00:00:00Z",
        updated_at="2026-04-23T00:00:00Z",
    )
    with override_authenticated_user(limited):
        response = client.get("/api/standards")

    assert response.status_code == 403
    assert response.json() == {"detail": "Not enough permissions"}


def test_project_member_can_read_standards_when_project_role_grants_standard_read():
    member = AuthenticatedUser(
        id="member",
        username="member",
        email=None,
        display_name="Member",
        status="active",
        last_login_at=None,
        created_at="2026-04-23T00:00:00Z",
        updated_at="2026-04-23T00:00:00Z",
        project_permissions={"project-1": {"standard.read"}},
    )
    standards = [{"id": "standard-1", "code": "DEC", "name": "DEC", "class_count": 0, "attribute_count": 0}]
    with override_authenticated_user(member):
        with (
            patch("app.main.get_project_standard_ids", return_value=["standard-1"]) as get_project_standard_ids,
            patch("app.main.get_standards_by_ids", return_value=standards) as get_standards_by_ids,
            patch("app.main.get_standards") as get_standards,
        ):
            response = client.get("/api/standards")

    assert response.status_code == 200
    assert response.json() == {"data": standards}
    get_project_standard_ids.assert_called_once_with(["project-1"])
    get_standards_by_ids.assert_called_once_with(["standard-1"])
    get_standards.assert_not_called()


def test_project_member_can_read_bound_standard_detail():
    member = AuthenticatedUser(
        id="member",
        username="member",
        email=None,
        display_name="Member",
        status="active",
        last_login_at=None,
        created_at="2026-04-23T00:00:00Z",
        updated_at="2026-04-23T00:00:00Z",
        project_permissions={"project-1": {"standard.read"}},
    )
    detail = {"id": "standard-1", "code": "DEC", "name": "DEC", "classes": []}
    with override_authenticated_user(member):
        with (
            patch("app.authorization.fetch_one", return_value={"allowed": 1}),
            patch("app.main.get_standard_detail", return_value=detail),
        ):
            response = client.get("/api/standards/standard-1")

    assert response.status_code == 200
    assert response.json() == {"data": detail}


def test_project_member_cannot_read_unbound_standard_detail():
    member = AuthenticatedUser(
        id="member",
        username="member",
        email=None,
        display_name="Member",
        status="active",
        last_login_at=None,
        created_at="2026-04-23T00:00:00Z",
        updated_at="2026-04-23T00:00:00Z",
        project_permissions={"project-1": {"standard.read"}},
    )
    with override_authenticated_user(member):
        with (
            patch("app.authorization.fetch_one", return_value=None),
            patch("app.main.get_standard_detail") as get_standard_detail,
        ):
            response = client.get("/api/standards/standard-2")

    assert response.status_code == 403
    assert response.json() == {"detail": "Not enough permissions"}
    get_standard_detail.assert_not_called()


def test_user_update_audit_redacts_password():
    user = {
        "id": "user-1",
        "username": "alice",
        "email": "alice@example.test",
        "display_name": "Alice",
        "status": "active",
        "last_login_at": None,
        "created_at": "2026-04-23T00:00:00Z",
        "updated_at": "2026-04-23T00:00:00Z",
    }
    with (
        patch("app.auth_api.update_user", return_value=user),
        patch("app.auth_api.revoke_all_user_sessions") as revoke_all_user_sessions,
        patch("app.auth_api.record_authorization_audit_log") as record_authorization_audit_log,
    ):
        response = client.patch(
            "/api/auth/users/user-1",
            json={"display_name": "Alice Updated", "password": "new-password-123"},
        )

    assert response.status_code == 200
    audit_metadata = record_authorization_audit_log.call_args.kwargs["metadata"]
    assert "password" not in audit_metadata
    assert audit_metadata["password_changed"] is True
    revoke_all_user_sessions.assert_called_once_with("user-1")


def test_current_user_can_change_password_with_current_password():
    current_user = AuthenticatedUser(
        id="user-1",
        username="alice",
        email="alice@example.test",
        display_name="Alice",
        status="active",
        last_login_at=None,
        created_at="2026-04-23T00:00:00Z",
        updated_at="2026-04-23T00:00:00Z",
    )
    with override_authenticated_user(current_user):
        with (
            patch("app.auth_api.get_user_by_id", return_value=_user_row()),
            patch("app.auth_api.update_user_password") as update_user_password,
            patch("app.auth_api.revoke_all_user_sessions") as revoke_all_user_sessions,
            patch("app.auth_api.record_authorization_audit_log") as record_authorization_audit_log,
        ):
            response = client.post(
                "/api/auth/me/password",
                json={"current_password": "correct-password", "new_password": "new-password-123"},
            )

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    update_user_password.assert_called_once_with("user-1", "new-password-123")
    revoke_all_user_sessions.assert_called_once_with("user-1")
    assert "smart_design_session=" in response.headers["set-cookie"]
    audit_metadata = record_authorization_audit_log.call_args.kwargs["metadata"]
    assert audit_metadata == {"password_changed": True, "self_service": True}


def test_current_user_password_change_rejects_wrong_current_password():
    current_user = AuthenticatedUser(
        id="user-1",
        username="alice",
        email="alice@example.test",
        display_name="Alice",
        status="active",
        last_login_at=None,
        created_at="2026-04-23T00:00:00Z",
        updated_at="2026-04-23T00:00:00Z",
    )
    with override_authenticated_user(current_user):
        with (
            patch("app.auth_api.get_user_by_id", return_value=_user_row()),
            patch("app.auth_api.update_user_password") as update_user_password,
        ):
            response = client.post(
                "/api/auth/me/password",
                json={"current_password": "wrong-password", "new_password": "new-password-123"},
            )

    assert response.status_code == 400
    assert response.json() == {"detail": "Current password is incorrect"}
    update_user_password.assert_not_called()


def test_admin_can_reset_user_password_and_revoke_sessions():
    user = {
        "id": "user-1",
        "username": "alice",
        "email": "alice@example.test",
        "display_name": "Alice",
        "status": "active",
        "last_login_at": None,
        "created_at": "2026-04-23T00:00:00Z",
        "updated_at": "2026-04-23T00:00:00Z",
    }
    with (
        patch("app.auth_api.update_user_password", return_value=user) as update_user_password,
        patch("app.auth_api.revoke_all_user_sessions") as revoke_all_user_sessions,
        patch("app.auth_api.record_authorization_audit_log") as record_authorization_audit_log,
    ):
        response = client.post(
            "/api/auth/users/user-1/password",
            json={"new_password": "new-password-123"},
        )

    assert response.status_code == 200
    assert response.json() == {"data": user}
    update_user_password.assert_called_once_with("user-1", "new-password-123")
    revoke_all_user_sessions.assert_called_once_with("user-1")
    audit_metadata = record_authorization_audit_log.call_args.kwargs["metadata"]
    assert audit_metadata == {"password_changed": True, "reset_by_admin": True}


def test_updates_user_system_roles():
    with patch("app.auth_api.sync_system_user_roles", return_value=["system_admin", "project_creator"]) as sync_system_user_roles:
        response = client.put(
            "/api/auth/users/user-1/system-roles",
            json={"role_codes": ["system_admin", "project_creator"]},
        )

    assert response.status_code == 200
    assert response.json() == {"data": {"user_id": "user-1", "role_codes": ["system_admin", "project_creator"]}}
    sync_system_user_roles.assert_called_once_with(
        "user-1",
        ["system_admin", "project_creator"],
        granted_by="test-admin",
    )


def test_lists_project_member_candidates():
    candidates = [
        {
            "id": "user-1",
            "username": "alice",
            "email": "alice@example.test",
            "display_name": "Alice",
            "status": "active",
            "last_login_at": None,
            "created_at": "2026-04-23T00:00:00Z",
            "updated_at": "2026-04-23T00:00:00Z",
        }
    ]
    with patch("app.auth_api.list_user_candidates", return_value=candidates) as list_user_candidates:
        response = client.get("/api/projects/project-1/members/candidates")

    assert response.status_code == 200
    assert response.json() == {"data": candidates}
    list_user_candidates.assert_called_once_with()


def test_lists_project_member_roles():
    roles = [
        {
            "id": "role-editor",
            "code": "project_editor",
            "name": "Project Editor",
            "scope_kind": "project",
            "is_builtin": True,
            "status": "active",
            "permissions": ["project.read", "project.update"],
        }
    ]
    with patch("app.auth_api.list_roles_by_scope", return_value=roles) as list_roles_by_scope:
        response = client.get("/api/projects/project-1/members/roles")

    assert response.status_code == 200
    assert response.json() == {"data": roles}
    list_roles_by_scope.assert_called_once_with("project")
