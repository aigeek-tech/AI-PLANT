import hashlib
import hmac
import io
import json
import zipfile
from pathlib import Path

import pytest
from fastapi import APIRouter, FastAPI
from fastapi.testclient import TestClient

from app.authorization import AuthenticatedUser


SECRET = "test-plugin-secret"


def _build_package(files: dict[str, bytes], *, secret: str = SECRET) -> bytes:
    unsigned = dict(files)
    digest = _package_digest(unsigned, secret)
    unsigned["signature.json"] = json.dumps(
        {"algorithm": "HMAC-SHA256", "digest": digest},
        separators=(",", ":"),
    ).encode("utf-8")
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in unsigned.items():
            archive.writestr(name, content)
    return buffer.getvalue()


def _package_digest(files: dict[str, bytes], secret: str) -> str:
    signer = hmac.new(secret.encode("utf-8"), digestmod=hashlib.sha256)
    for name in sorted(files):
        signer.update(name.encode("utf-8"))
        signer.update(b"\0")
        signer.update(hashlib.sha256(files[name]).hexdigest().encode("ascii"))
        signer.update(b"\0")
    return signer.hexdigest()


def _manifest(**overrides):
    manifest = {
        "id": "sample-module",
        "name": "Sample Module",
        "version": "1.0.0",
        "min_host_version": "0.1.0",
        "frontend": {
            "entry": "frontend/sample-module.js",
            "routes": [
                {
                    "path": "/plugins/sample-module/dashboard",
                    "element": "sd-sample-module-dashboard",
                    "permissions": ["project.example.read", "project.example.audit"],
                    "requireAny": True,
                }
            ],
            "navigation": [
                {
                    "sectionLabelKey": "navigation.extensions",
                    "labelKey": "navigation.sampleModule",
                    "to": "/plugins/sample-module/dashboard",
                }
            ],
        },
        "backend": {"entry": "backend/sample_plugin/plugin.py", "api_prefix": "/api"},
        "permissions": [
            {"code": "project.example.read", "scope_kind": "project", "resource": "project.example", "action": "read"},
        ],
        "default_role_grants": {"project_viewer": ["project.example.read"]},
        "database": {"schemas": ["plugin_sample_plugin"]},
        "migrations": [{"path": "migrations/0001_sample_plugin.sql"}],
        "capabilities": ["routes", "navigation", "api", "migrations"],
    }
    manifest.update(overrides)
    return manifest


def _package_files(manifest: dict | None = None) -> dict[str, bytes]:
    return {
        "plugin.json": json.dumps(manifest or _manifest(), separators=(",", ":")).encode("utf-8"),
        "backend/sample_plugin/plugin.py": b"def activate(context):\n    return {'routers': []}\n",
        "frontend/sample-module.js": b"customElements.define('sd-sample-module-dashboard', class extends HTMLElement {})",
        "migrations/0001_sample_plugin.sql": b"SELECT 1;\n",
    }


def test_plugin_package_validation_accepts_signed_package(tmp_path):
    from app.plugin_runtime import validate_plugin_archive

    package = _build_package(_package_files())
    result = validate_plugin_archive(package, secret=SECRET, storage_root=tmp_path)

    assert result.manifest["id"] == "sample-module"
    assert result.checksum == hashlib.sha256(package).hexdigest()


def test_plugin_package_validation_rejects_zip_slip(tmp_path):
    from app.plugin_runtime import validate_plugin_archive

    files = _package_files()
    files["../escape.txt"] = b"escape"
    package = _build_package(files)

    with pytest.raises(ValueError, match="unsafe path"):
        validate_plugin_archive(package, secret=SECRET, storage_root=tmp_path)


def test_plugin_package_validation_rejects_external_frontend_entry(tmp_path):
    from app.plugin_runtime import validate_plugin_archive

    manifest = _manifest(frontend={**_manifest()["frontend"], "entry": "https://example.com/plugin.js"})
    package = _build_package(_package_files(manifest))

    with pytest.raises(ValueError, match="external"):
        validate_plugin_archive(package, secret=SECRET, storage_root=tmp_path)


def test_plugin_package_validation_rejects_bad_signature(tmp_path):
    from app.plugin_runtime import validate_plugin_archive

    package = _build_package(_package_files(), secret="wrong-secret")

    with pytest.raises(ValueError, match="signature"):
        validate_plugin_archive(package, secret=SECRET, storage_root=tmp_path)


def test_plugin_package_validation_rejects_newer_host_requirement(tmp_path):
    from app.plugin_runtime import validate_plugin_archive

    manifest = _manifest(min_host_version="999.0.0")
    package = _build_package(_package_files(manifest))

    with pytest.raises(ValueError, match="newer host"):
        validate_plugin_archive(package, secret=SECRET, storage_root=tmp_path)


def test_plugin_package_validation_requires_namespaced_frontend_routes(tmp_path):
    from app.plugin_runtime import validate_plugin_archive

    manifest = _manifest(frontend={**_manifest()["frontend"], "routes": [{"path": "/alerts", "element": "sd-alerts"}]})
    package = _build_package(_package_files(manifest))

    with pytest.raises(ValueError, match="under /plugins/sample-module/"):
        validate_plugin_archive(package, secret=SECRET, storage_root=tmp_path)


def test_plugin_package_validation_rejects_backend_asset_entry(tmp_path):
    from app.plugin_runtime import validate_plugin_archive

    manifest = _manifest(frontend={**_manifest()["frontend"], "entry": "backend/sample_plugin/plugin.py"})
    package = _build_package(_package_files(manifest))

    with pytest.raises(ValueError, match="frontend directory"):
        validate_plugin_archive(package, secret=SECRET, storage_root=tmp_path)


def test_plugin_package_validation_rejects_unknown_default_role_permission(tmp_path):
    from app.plugin_runtime import validate_plugin_archive

    manifest = _manifest(default_role_grants={"project_viewer": ["project.missing.read"]})
    package = _build_package(_package_files(manifest))

    with pytest.raises(ValueError, match="default role grants"):
        validate_plugin_archive(package, secret=SECRET, storage_root=tmp_path)


def test_plugin_enabled_dependency_blocks_disabled_plugin(monkeypatch):
    from app.plugin_runtime import require_plugin_enabled

    monkeypatch.setattr("app.plugin_runtime.is_plugin_enabled", lambda plugin_id: False)
    router = APIRouter(dependencies=[require_plugin_enabled("sample-module")])

    @router.get("/ping")
    def ping():
        return {"ok": True}

    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)

    response = client.get("/ping")

    assert response.status_code == 404


def test_plugin_management_upload_requires_manage_permission(tmp_path, monkeypatch):
    from app.authorization import require_authenticated_user
    from app.plugin_api import router

    monkeypatch.setenv("SMART_DESIGN_PLUGIN_HMAC_SECRET", SECRET)
    monkeypatch.setenv("SMART_DESIGN_PLUGIN_STORAGE_DIR", str(tmp_path))

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[require_authenticated_user] = lambda: AuthenticatedUser(
        id="user-1",
        username="viewer",
        email=None,
        display_name="Viewer",
        status="active",
        last_login_at=None,
        created_at="2026-05-05T00:00:00Z",
        updated_at="2026-05-05T00:00:00Z",
        system_permissions=set(),
        project_permissions={},
        standard_permissions={},
    )
    client = TestClient(app)

    response = client.post(
        "/api/plugins/packages",
        files={"file": ("sample-module.zip", _build_package(_package_files()), "application/zip")},
    )

    assert response.status_code == 403


def test_plugin_management_requires_plugin_manage_permission():
    from app.plugin_api import require_plugin_management_user

    role_manager = AuthenticatedUser(
        id="user-1",
        username="role-manager",
        email=None,
        display_name="Role Manager",
        status="active",
        last_login_at=None,
        created_at="2026-05-05T00:00:00Z",
        updated_at="2026-05-05T00:00:00Z",
        system_permissions={"system.role.manage"},
        project_permissions={},
        standard_permissions={},
    )
    plugin_manager = AuthenticatedUser(
        id="user-2",
        username="plugin-manager",
        email=None,
        display_name="Plugin Manager",
        status="active",
        last_login_at=None,
        created_at="2026-05-05T00:00:00Z",
        updated_at="2026-05-05T00:00:00Z",
        system_permissions={"system.plugin.manage"},
        project_permissions={},
        standard_permissions={},
    )

    with pytest.raises(Exception) as forbidden:
        require_plugin_management_user(role_manager)
    assert getattr(forbidden.value, "status_code", None) == 403
    assert require_plugin_management_user(plugin_manager).id == "user-2"


def test_plugin_package_repository_rejects_duplicate_plugin_version(monkeypatch):
    from app import plugin_repository

    monkeypatch.setattr(plugin_repository, "fetch_one", lambda *_args, **_kwargs: {"id": "package-1"})

    with pytest.raises(ValueError, match="already been uploaded"):
        plugin_repository.create_plugin_package(
            plugin_id="sample-module",
            version="1.0.0",
            filename="sample-module.zip",
            checksum="checksum",
            storage_path="D:/plugins/sample-module",
            manifest=_manifest(),
        )


def test_plugin_uninstall_hides_uploaded_package_and_capabilities(monkeypatch):
    from app import plugin_runtime

    calls: list[tuple[str, str]] = []

    monkeypatch.setattr(
        plugin_runtime,
        "set_installation_status",
        lambda plugin_id, status: {"plugin_id": plugin_id, "status": status},
    )
    monkeypatch.setattr(plugin_runtime, "retire_uploaded_packages", lambda plugin_id: calls.append(("retire", plugin_id)))
    monkeypatch.setattr(plugin_runtime, "replace_capabilities", lambda plugin_id, capabilities: calls.append(("capabilities", plugin_id)))
    monkeypatch.setattr(plugin_runtime, "record_audit", lambda **kwargs: calls.append(("audit", kwargs["plugin_id"])))

    result = plugin_runtime.uninstall_plugin("sample-module", actor_user_id="user-1")

    assert result["status"] == "uninstalled"
    assert calls == [
        ("retire", "sample-module"),
        ("capabilities", "sample-module"),
        ("audit", "sample-module"),
    ]


def test_plugin_install_syncs_manifest_permissions_before_migrations(monkeypatch):
    from app import plugin_runtime

    calls: list[str] = []
    package = {
        "id": "package-1",
        "plugin_id": "sample-module",
        "version": "1.0.0",
        "storage_path": "D:/plugins/sample-module",
        "manifest": _manifest(),
    }

    monkeypatch.setattr(plugin_runtime, "get_latest_package", lambda plugin_id: package)
    monkeypatch.setattr(plugin_runtime, "upsert_permission_definitions", lambda permissions: calls.append("permissions"))
    monkeypatch.setattr(plugin_runtime, "grant_default_role_permissions", lambda grants: calls.append("role-grants"))
    monkeypatch.setattr(plugin_runtime, "_run_migrations", lambda package: calls.append("migrations"))
    monkeypatch.setattr(plugin_runtime, "replace_capabilities", lambda plugin_id, capabilities: calls.append("capabilities"))
    monkeypatch.setattr(plugin_runtime, "upsert_installation", lambda package, status: {"plugin_id": package["plugin_id"], "status": status})
    monkeypatch.setattr(plugin_runtime, "record_audit", lambda **kwargs: calls.append("audit"))

    result = plugin_runtime.install_plugin("sample-module", actor_user_id="user-1")

    assert result["status"] == "disabled"
    assert calls[:4] == ["permissions", "role-grants", "migrations", "capabilities"]


def test_plugin_enable_marks_failed_when_route_loading_fails(monkeypatch):
    from app import plugin_runtime

    calls: list[tuple[str, str]] = []
    installation = {
        "plugin_id": "sample-module",
        "status": "disabled",
        "manifest": _manifest(),
    }

    monkeypatch.setattr(plugin_runtime, "get_installation", lambda plugin_id: installation)
    monkeypatch.setattr(plugin_runtime, "load_plugin_routes", lambda app, installation: (_ for _ in ()).throw(RuntimeError("boom")))
    monkeypatch.setattr(plugin_runtime, "set_installation_status", lambda plugin_id, status, **kwargs: calls.append((plugin_id, status)) or {"plugin_id": plugin_id, "status": status})
    monkeypatch.setattr(plugin_runtime, "record_audit", lambda **kwargs: calls.append((kwargs["plugin_id"], kwargs["action"])))

    with pytest.raises(ValueError, match="could not be enabled"):
        plugin_runtime.enable_plugin(FastAPI(), "sample-module", actor_user_id="user-1")

    assert ("sample-module", "failed") in calls
    assert ("sample-module", "enable_failed") in calls


def test_plugin_asset_resolution_blocks_backend_files(monkeypatch, tmp_path):
    from app import plugin_runtime

    package_dir = tmp_path / "package"
    backend_entry = package_dir / "backend" / "sample_plugin" / "plugin.py"
    backend_entry.parent.mkdir(parents=True)
    backend_entry.write_text("secret = True", encoding="utf-8")

    monkeypatch.setattr(plugin_runtime, "is_plugin_enabled", lambda plugin_id: True)
    monkeypatch.setattr(
        plugin_runtime,
        "get_installation",
        lambda plugin_id: {"plugin_id": plugin_id, "installed_path": str(package_dir), "manifest": _manifest()},
    )

    with pytest.raises(ValueError, match="frontend directory"):
        plugin_runtime.resolve_asset_path("sample-module", "backend/sample_plugin/plugin.py")


def test_plugin_routes_reload_from_isolated_backend_package(tmp_path, monkeypatch):
    from app import plugin_runtime

    def write_package(root: Path, value: str) -> None:
        package_dir = root / "backend" / "sample_plugin"
        package_dir.mkdir(parents=True)
        (package_dir / "__init__.py").write_text("", encoding="utf-8")
        (package_dir / "api.py").write_text(
            "from fastapi import APIRouter\n"
            "router = APIRouter()\n"
            "@router.get('/ping')\n"
            "def ping():\n"
            f"    return {{'version': '{value}'}}\n",
            encoding="utf-8",
        )
        (package_dir / "plugin.py").write_text(
            "from .api import router\n"
            "def activate(context):\n"
            "    return {'routers': [router]}\n",
            encoding="utf-8",
        )

    package_v1 = tmp_path / "v1"
    package_v2 = tmp_path / "v2"
    write_package(package_v1, "v1")
    write_package(package_v2, "v2")

    manifest = {
        "backend": {"entry": "backend/sample_plugin/plugin.py", "api_prefix": "/api"},
    }
    app = FastAPI()
    monkeypatch.setattr(plugin_runtime, "is_plugin_enabled", lambda plugin_id: True)

    plugin_runtime.load_plugin_routes(
        app,
        {
            "id": "install-v1",
            "package_id": "package-v1",
            "plugin_id": "sample-module",
            "version": "1.0.0",
            "manifest": manifest,
            "installed_path": str(package_v1),
        },
    )
    client = TestClient(app)
    assert client.get("/api/plugins/sample-module/api/ping").json() == {"version": "v1"}

    plugin_runtime.load_plugin_routes(
        app,
        {
            "id": "install-v2",
            "package_id": "package-v2",
            "plugin_id": "sample-module",
            "version": "1.0.1",
            "manifest": manifest,
            "installed_path": str(package_v2),
        },
    )
    assert client.get("/api/plugins/sample-module/api/ping").json() == {"version": "v2"}
