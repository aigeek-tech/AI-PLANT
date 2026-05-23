from pathlib import Path
import sys


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.authorization import AuthenticatedUser, require_authenticated_user
from app.main import app


ALL_TEST_PERMISSIONS = {
    "system.user.manage",
    "system.role.manage",
    "system.audit.read",
    "system.settings.ai.read",
    "system.settings.ai.write",
    "system.settings.branding.read",
    "system.settings.branding.write",
    "system.plugin.manage",
    "project.create",
    "standard.read",
    "standard.write",
    "project.read",
    "project.delete",
    "project.update",
    "project.member.manage",
    "project.pbs.read",
    "project.pbs.write",
    "project.tag.read",
    "project.tag.write",
    "project.tag.import",
    "project.document.read",
    "project.document.write",
    "project.document.upload",
    "project.relation.read",
    "project.relation.write",
}


def fake_admin_user() -> AuthenticatedUser:
    return AuthenticatedUser(
        id="test-admin",
        username="admin",
        email="admin@example.test",
        display_name="Test Admin",
        status="active",
        last_login_at=None,
        created_at="2026-04-23T00:00:00Z",
        updated_at="2026-04-23T00:00:00Z",
        system_permissions=set(ALL_TEST_PERMISSIONS),
        project_permissions={},
        standard_permissions={},
        roles=[
            {
                "id": "role-system-admin",
                "code": "system_admin",
                "name": "System Administrator",
                "scope_kind": "system",
                "is_builtin": True,
                "status": "active",
                "permissions": sorted(ALL_TEST_PERMISSIONS),
            }
        ],
    )


app.dependency_overrides[require_authenticated_user] = fake_admin_user
