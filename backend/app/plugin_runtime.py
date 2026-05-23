from __future__ import annotations

from dataclasses import dataclass
import hashlib
import hmac
import importlib.util
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import sys
from types import ModuleType
from typing import Any
import zipfile
import io

from fastapi import Depends, HTTPException
from fastapi.routing import APIRoute
from psycopg.errors import UndefinedTable
from psycopg import sql

from .db import get_connection
from .plugin_repository import (
    create_plugin_package,
    grant_default_role_permissions,
    get_installation,
    get_latest_package,
    is_plugin_enabled as _repository_is_plugin_enabled,
    list_enabled_installations,
    record_audit,
    replace_capabilities,
    retire_uploaded_packages,
    set_installation_status,
    upsert_permission_definitions,
    upsert_installation,
)
from .settings.config import get_settings


PLUGIN_ID_PATTERN = re.compile(r"^[a-z][a-z0-9-]{1,62}[a-z0-9]$")
PLUGIN_SCHEMA_PATTERN = re.compile(r"^plugin_[a-z][a-z0-9_]{1,62}$")
PERMISSION_CODE_PATTERN = re.compile(r"^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$")
ROLE_CODE_PATTERN = re.compile(r"^[a-z][a-z0-9_]{1,62}$")
EXTERNAL_URL_PATTERN = re.compile(r"^[a-z][a-z0-9+.-]*://", re.IGNORECASE)
PERMISSION_SCOPE_KINDS = {"system", "standard", "project"}
HOST_VERSION = "0.1.0"
LOADED_PLUGIN_MODULES: dict[str, str] = {}


@dataclass(frozen=True)
class PluginArchive:
    manifest: dict
    checksum: str
    files: dict[str, bytes]


def validate_plugin_archive(package_bytes: bytes, *, secret: str, storage_root: Path) -> PluginArchive:
    if not secret.strip():
        raise ValueError("Plugin signing secret is not configured")
    checksum = hashlib.sha256(package_bytes).hexdigest()
    files = _read_zip_files(package_bytes)
    if "plugin.json" not in files:
        raise ValueError("Plugin package is missing plugin.json")
    if "signature.json" not in files:
        raise ValueError("Plugin package is missing signature.json")

    signature = _read_json(files["signature.json"], "signature.json")
    if signature.get("algorithm") != "HMAC-SHA256":
        raise ValueError("Unsupported plugin signature algorithm")
    expected = _package_digest(
        {name: content for name, content in files.items() if name != "signature.json"},
        secret,
    )
    if not hmac.compare_digest(str(signature.get("digest") or ""), expected):
        raise ValueError("Plugin package signature is invalid")

    manifest = _read_json(files["plugin.json"], "plugin.json")
    _validate_manifest(manifest, files)
    storage_root.mkdir(parents=True, exist_ok=True)
    return PluginArchive(manifest=manifest, checksum=checksum, files=files)


def store_uploaded_package(*, filename: str, package_bytes: bytes, actor_user_id: str | None) -> dict:
    settings = get_settings().plugin
    if not settings.hmac_secret:
        raise ValueError("Plugin signing secret is not configured")
    if len(package_bytes) > settings.max_package_bytes:
        raise ValueError("Plugin package exceeds the configured size limit")

    storage_root = Path(settings.storage_dir)
    archive = validate_plugin_archive(package_bytes, secret=settings.hmac_secret, storage_root=storage_root)
    manifest = archive.manifest
    plugin_id = manifest["id"]
    version = manifest["version"]
    package_dir = storage_root / "packages" / plugin_id / version / archive.checksum[:16]
    _safe_reset_dir(package_dir, storage_root)
    for name, content in archive.files.items():
        if name == "signature.json":
            continue
        destination = _resolve_package_path(package_dir, name)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(content)
    zip_path = package_dir / "package.zip"
    zip_path.write_bytes(package_bytes)

    row = create_plugin_package(
        plugin_id=plugin_id,
        version=version,
        filename=filename,
        checksum=archive.checksum,
        storage_path=str(package_dir),
        manifest=manifest,
    )
    record_audit(plugin_id=plugin_id, action="upload", actor_user_id=actor_user_id, metadata={"filename": filename})
    return row


def install_plugin(plugin_id: str, *, actor_user_id: str | None) -> dict:
    package = get_latest_package(plugin_id)
    if package is None:
        raise ValueError("Plugin package not found")
    try:
        _sync_permissions(package["manifest"])
        _run_migrations(package)
        replace_capabilities(plugin_id, _capabilities_from_manifest(package["manifest"]))
        installation = upsert_installation(package=package, status="disabled")
        record_audit(plugin_id=plugin_id, action="install", actor_user_id=actor_user_id, metadata={"version": package["version"]})
        return installation
    except Exception as error:
        upsert_installation(package=package, status="failed", error_message=str(error))
        raise


def enable_plugin(app, plugin_id: str, *, actor_user_id: str | None) -> dict:
    installation = get_installation(plugin_id)
    if installation is None or installation["status"] in {"failed", "uninstalled", "purged"}:
        installation = install_plugin(plugin_id, actor_user_id=actor_user_id)
    if installation["status"] not in {"disabled", "enabled"}:
        raise ValueError("Plugin must be installed before it can be enabled")
    try:
        load_plugin_routes(app, installation)
        enabled = set_installation_status(plugin_id, "enabled")
        if enabled is None:
            raise ValueError("Plugin installation not found")
        record_audit(plugin_id=plugin_id, action="enable", actor_user_id=actor_user_id)
        return enabled
    except Exception as error:
        set_installation_status(plugin_id, "failed", error_message=str(error))
        record_audit(plugin_id=plugin_id, action="enable_failed", actor_user_id=actor_user_id, metadata={"error": str(error)})
        raise ValueError(f"Plugin could not be enabled: {error}") from error


def disable_plugin(plugin_id: str, *, actor_user_id: str | None, app=None) -> dict:
    if app is not None:
        unload_plugin_routes(app, plugin_id)
    installation = set_installation_status(plugin_id, "disabled")
    if installation is None:
        raise ValueError("Plugin installation not found")
    record_audit(plugin_id=plugin_id, action="disable", actor_user_id=actor_user_id)
    return installation


def uninstall_plugin(plugin_id: str, *, actor_user_id: str | None, app=None) -> dict:
    if app is not None:
        unload_plugin_routes(app, plugin_id)
    installation = set_installation_status(plugin_id, "uninstalled")
    if installation is None:
        raise ValueError("Plugin installation not found")
    retire_uploaded_packages(plugin_id)
    replace_capabilities(plugin_id, [])
    record_audit(plugin_id=plugin_id, action="uninstall", actor_user_id=actor_user_id)
    return installation


def purge_plugin(plugin_id: str, *, actor_user_id: str | None) -> dict:
    installation = get_installation(plugin_id)
    if installation is None:
        raise ValueError("Plugin installation not found")
    if installation["status"] == "enabled":
        raise ValueError("Disable plugin before purging data")
    schemas = _schema_names_from_manifest(plugin_id, installation.get("manifest") or {})
    with get_connection() as connection:
        with connection.cursor() as cursor:
            for schema_name in schemas:
                cursor.execute(sql.SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(sql.Identifier(schema_name)))
        connection.commit()
    purged = set_installation_status(plugin_id, "purged")
    record_audit(plugin_id=plugin_id, action="purge", actor_user_id=actor_user_id)
    return purged or installation


def is_plugin_enabled(plugin_id: str) -> bool:
    try:
        return _repository_is_plugin_enabled(plugin_id)
    except UndefinedTable:
        return False


def require_plugin_enabled(plugin_id: str):
    def dependency():
        if not is_plugin_enabled(plugin_id):
            raise HTTPException(status_code=404, detail="Plugin is not enabled")

    return Depends(dependency)


def load_enabled_plugins(app) -> None:
    try:
        installations = list_enabled_installations()
    except UndefinedTable:
        return
    for installation in installations:
        plugin_id = installation["plugin_id"]
        try:
            load_plugin_routes(app, installation)
        except Exception as error:
            set_installation_status(plugin_id, "failed", error_message=str(error))
            record_audit(plugin_id=plugin_id, action="startup_load_failed", actor_user_id=None, metadata={"error": str(error)})


def load_plugin_routes(app, installation: dict) -> None:
    plugin_id = installation["plugin_id"]
    manifest = installation["manifest"]
    entry = _safe_entry_path(Path(installation["installed_path"]), manifest["backend"]["entry"])
    _remove_plugin_routes(app, plugin_id)
    module = _load_plugin_entry_module(plugin_id, installation, entry)
    contribution = module.activate({"plugin_id": plugin_id, "manifest": manifest})
    for plugin_router in contribution.get("routers", []):
        app.include_router(
            plugin_router,
            prefix=f"/api/plugins/{plugin_id}{manifest['backend']['api_prefix']}",
            dependencies=[require_plugin_enabled(plugin_id)],
        )
    LOADED_PLUGIN_MODULES[plugin_id] = module.__name__


def unload_plugin_routes(app, plugin_id: str) -> None:
    module_name = LOADED_PLUGIN_MODULES.pop(plugin_id, None)
    module = sys.modules.get(module_name) if module_name else None
    try:
        if module is not None:
            deactivate = getattr(module, "deactivate", None)
            if callable(deactivate):
                deactivate()
    finally:
        if module_name:
            _remove_loaded_package(module_name)
        _remove_plugin_routes(app, plugin_id)


def enabled_manifest_payload() -> dict:
    try:
        installations = list_enabled_installations()
    except UndefinedTable:
        return {"plugins": []}
    return {"plugins": [_frontend_manifest(installation) for installation in installations]}


def resolve_asset_path(plugin_id: str, asset_path: str) -> Path:
    if not is_plugin_enabled(plugin_id):
        raise ValueError("Plugin is not enabled")
    installation = get_installation(plugin_id)
    if installation is None:
        raise ValueError("Plugin installation not found")
    _validate_frontend_asset_path(asset_path)
    root = Path(installation["installed_path"])
    return _resolve_package_path(root, asset_path)


def plugin_routes_are_registered(app, plugin_id: str) -> bool:
    prefix = f"/api/plugins/{plugin_id}/"
    return any(isinstance(route, APIRoute) and route.path.startswith(prefix) for route in app.routes)


def _remove_plugin_routes(app, plugin_id: str) -> None:
    prefix = f"/api/plugins/{plugin_id}/"
    app.router.routes = [
        route
        for route in app.router.routes
        if not (isinstance(route, APIRoute) and route.path.startswith(prefix))
    ]


def _read_zip_files(package_bytes: bytes) -> dict[str, bytes]:
    files: dict[str, bytes] = {}
    try:
        with zipfile.ZipFile(io.BytesIO(package_bytes)) as archive:
            for info in archive.infolist():
                if info.is_dir():
                    continue
                safe_name = _validate_archive_name(info.filename)
                files[safe_name] = archive.read(info)
    except zipfile.BadZipFile as error:
        raise ValueError("Plugin package must be a valid ZIP archive") from error
    return files


def _validate_archive_name(raw_name: str) -> str:
    if "\\" in raw_name:
        raise ValueError("Plugin package contains an unsafe path")
    path = PurePosixPath(raw_name)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise ValueError("Plugin package contains an unsafe path")
    return str(path)


def _package_digest(files: dict[str, bytes], secret: str) -> str:
    signer = hmac.new(secret.encode("utf-8"), digestmod=hashlib.sha256)
    for name in sorted(files):
        signer.update(name.encode("utf-8"))
        signer.update(b"\0")
        signer.update(hashlib.sha256(files[name]).hexdigest().encode("ascii"))
        signer.update(b"\0")
    return signer.hexdigest()


def _read_json(content: bytes, label: str) -> dict:
    try:
        value = json.loads(content.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"{label} must be valid JSON") from error
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be a JSON object")
    return value


def _validate_manifest(manifest: dict, files: dict[str, bytes]) -> None:
    plugin_id = str(manifest.get("id") or "")
    if not PLUGIN_ID_PATTERN.fullmatch(plugin_id):
        raise ValueError("Plugin id is invalid")
    for field in ("name", "version", "min_host_version"):
        if not str(manifest.get(field) or "").strip():
            raise ValueError(f"Plugin manifest is missing {field}")
    if _version_tuple(str(manifest["min_host_version"])) > _version_tuple(HOST_VERSION):
        raise ValueError("Plugin requires a newer host version")
    frontend = manifest.get("frontend")
    backend = manifest.get("backend")
    if not isinstance(frontend, dict) or not isinstance(backend, dict):
        raise ValueError("Plugin manifest must define frontend and backend sections")
    _validate_manifest_path(frontend.get("entry"), files, "frontend entry")
    _validate_frontend_asset_path(str(frontend.get("entry") or ""))
    _validate_manifest_path(backend.get("entry"), files, "backend entry")
    api_prefix = str(backend.get("api_prefix") or "")
    if not api_prefix.startswith("/") or EXTERNAL_URL_PATTERN.match(api_prefix):
        raise ValueError("Plugin backend api_prefix is invalid")
    for route in frontend.get("routes") or []:
        if not isinstance(route, dict):
            raise ValueError("Plugin frontend routes must be objects")
        path = str(route.get("path") or "")
        element = str(route.get("element") or "")
        if not path.startswith("/") or EXTERNAL_URL_PATTERN.match(path):
            raise ValueError("Plugin frontend route path is invalid")
        _validate_plugin_route_target(plugin_id, path, "frontend route path")
        if not element.startswith("sd-"):
            raise ValueError("Plugin frontend route element is invalid")
    for item in frontend.get("navigation") or []:
        if not isinstance(item, dict):
            raise ValueError("Plugin frontend navigation items must be objects")
        _validate_plugin_route_target(plugin_id, str(item.get("to") or ""), "frontend navigation target")
    for slot in frontend.get("slots") or []:
        if not isinstance(slot, dict):
            raise ValueError("Plugin frontend slots must be objects")
        _validate_plugin_route_target(plugin_id, str(slot.get("to") or ""), "frontend slot target")
    _validate_permissions(manifest)
    _validate_default_role_grants(manifest)
    _validate_database_manifest(plugin_id, manifest)
    _validate_dependencies(manifest)
    for migration in manifest.get("migrations") or []:
        if not isinstance(migration, dict):
            raise ValueError("Plugin migrations must be objects")
        _validate_manifest_path(migration.get("path"), files, "migration")


def _validate_manifest_path(value: object, files: dict[str, bytes], label: str) -> None:
    path = str(value or "")
    if EXTERNAL_URL_PATTERN.match(path):
        raise ValueError(f"Plugin {label} cannot use external URLs")
    safe_path = _validate_archive_name(path)
    if safe_path not in files:
        raise ValueError(f"Plugin {label} is missing from package")


def _validate_frontend_asset_path(asset_path: str) -> None:
    safe_path = _validate_archive_name(asset_path)
    if not safe_path.startswith("frontend/"):
        raise ValueError("Plugin assets must be served from the frontend directory")


def _validate_plugin_route_target(plugin_id: str, raw_target: str, label: str) -> None:
    target_path = raw_target.split("?", 1)[0].split("#", 1)[0]
    prefix = f"/plugins/{plugin_id}/"
    if target_path != f"/plugins/{plugin_id}" and not target_path.startswith(prefix):
        raise ValueError(f"Plugin {label} must be under /plugins/{plugin_id}/")


def _validate_permissions(manifest: dict) -> None:
    permissions = manifest.get("permissions") or []
    if not isinstance(permissions, list):
        raise ValueError("Plugin permissions must be a list")
    for permission in permissions:
        if not isinstance(permission, dict):
            raise ValueError("Plugin permissions must be objects")
        code = str(permission.get("code") or "")
        scope_kind = str(permission.get("scope_kind") or "")
        resource = str(permission.get("resource") or "")
        action = str(permission.get("action") or "")
        if not PERMISSION_CODE_PATTERN.fullmatch(code):
            raise ValueError("Plugin permission code is invalid")
        if scope_kind not in PERMISSION_SCOPE_KINDS:
            raise ValueError("Plugin permission scope_kind is invalid")
        if not resource.strip() or not action.strip():
            raise ValueError("Plugin permission resource and action are required")


def _validate_default_role_grants(manifest: dict) -> None:
    grants = manifest.get("default_role_grants") or {}
    if not isinstance(grants, dict):
        raise ValueError("Plugin default_role_grants must be an object")
    permission_codes = {permission["code"] for permission in _permissions_from_manifest(manifest)}
    for role_code, granted_permissions in grants.items():
        if not ROLE_CODE_PATTERN.fullmatch(str(role_code)):
            raise ValueError("Plugin default role code is invalid")
        if not isinstance(granted_permissions, list):
            raise ValueError("Plugin default role grants must be lists")
        for permission_code in granted_permissions:
            if str(permission_code) not in permission_codes:
                raise ValueError("Plugin default role grants can only reference plugin permissions")


def _validate_database_manifest(plugin_id: str, manifest: dict) -> None:
    database = manifest.get("database")
    if database is not None and not isinstance(database, dict):
        raise ValueError("Plugin database must be an object")
    for schema_name in _schema_names_from_manifest(plugin_id, manifest):
        if not PLUGIN_SCHEMA_PATTERN.fullmatch(schema_name):
            raise ValueError("Plugin database schema name is invalid")


def _validate_dependencies(manifest: dict) -> None:
    dependencies = manifest.get("dependencies") or []
    if not isinstance(dependencies, list):
        raise ValueError("Plugin dependencies must be a list")
    for dependency in dependencies:
        if not isinstance(dependency, dict):
            raise ValueError("Plugin dependencies must be objects")
        plugin_id = str(dependency.get("plugin") or "")
        if not PLUGIN_ID_PATTERN.fullmatch(plugin_id):
            raise ValueError("Plugin dependency plugin id is invalid")


def _version_tuple(value: str) -> tuple[int, int, int]:
    parts = value.split(".")
    numbers: list[int] = []
    for part in parts[:3]:
        if not part.isdigit():
            raise ValueError("Plugin version fields must use numeric semantic versions")
        numbers.append(int(part))
    while len(numbers) < 3:
        numbers.append(0)
    return tuple(numbers)


def _resolve_package_path(root: Path, archive_path: str) -> Path:
    safe_path = _validate_archive_name(archive_path)
    resolved_root = root.resolve()
    candidate = (resolved_root / Path(*PurePosixPath(safe_path).parts)).resolve()
    if resolved_root != candidate and resolved_root not in candidate.parents:
        raise ValueError("Plugin package contains an unsafe path")
    return candidate


def _safe_entry_path(root: Path, entry: str) -> Path:
    candidate = _resolve_package_path(root, entry)
    if not candidate.exists():
        raise ValueError("Plugin backend entry is missing")
    return candidate


def _safe_reset_dir(path: Path, storage_root: Path) -> None:
    resolved_root = storage_root.resolve()
    resolved_path = path.resolve()
    if resolved_root != resolved_path and resolved_root not in resolved_path.parents:
        raise ValueError("Plugin storage path is unsafe")
    if resolved_path.exists():
        shutil.rmtree(resolved_path)
    resolved_path.mkdir(parents=True, exist_ok=True)


def _run_migrations(package: dict) -> None:
    manifest = package["manifest"]
    plugin_id = package["plugin_id"]
    version = package["version"]
    root = Path(package["storage_path"])
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (f"smart-design-plugin:{plugin_id}",))
            for migration in manifest.get("migrations") or []:
                migration_path = migration["path"]
                sql_path = _resolve_package_path(root, migration_path)
                sql = sql_path.read_text(encoding="utf-8")
                checksum = hashlib.sha256(sql.encode("utf-8")).hexdigest()
                cursor.execute(
                    """
                    SELECT checksum
                    FROM plugin_migration_journal
                    WHERE plugin_id = %s
                      AND plugin_version = %s
                      AND migration_path = %s
                    """,
                    (plugin_id, version, migration_path),
                )
                existing = cursor.fetchone()
                if existing:
                    if existing["checksum"] != checksum:
                        raise ValueError(f"Plugin migration checksum changed: {migration_path}")
                    continue
                cursor.execute(sql)
                cursor.execute(
                    """
                    INSERT INTO plugin_migration_journal (plugin_id, plugin_version, migration_path, checksum)
                    VALUES (%s, %s, %s, %s)
                    """,
                    (plugin_id, version, migration_path, checksum),
                )
        connection.commit()


def _sync_permissions(manifest: dict) -> None:
    upsert_permission_definitions(_permissions_from_manifest(manifest))
    grant_default_role_permissions(_default_role_grants_from_manifest(manifest))


def _permissions_from_manifest(manifest: dict) -> list[dict]:
    return [
        {
            "code": str(permission["code"]),
            "scope_kind": str(permission["scope_kind"]),
            "resource": str(permission["resource"]),
            "action": str(permission["action"]),
            "description": str(permission.get("description") or ""),
        }
        for permission in manifest.get("permissions") or []
    ]


def _default_role_grants_from_manifest(manifest: dict) -> dict[str, list[str]]:
    grants = manifest.get("default_role_grants") or {}
    return {
        str(role_code): [str(permission_code) for permission_code in permission_codes]
        for role_code, permission_codes in grants.items()
    }


def _schema_names_from_manifest(plugin_id: str, manifest: dict) -> list[str]:
    database = manifest.get("database") or {}
    schemas = database.get("schemas") if isinstance(database, dict) else None
    if not schemas:
        return [f"plugin_{plugin_id.replace('-', '_')}"]
    if not isinstance(schemas, list):
        raise ValueError("Plugin database schemas must be a list")
    return [str(schema_name) for schema_name in schemas]


def _capabilities_from_manifest(manifest: dict) -> list[dict]:
    plugin_id = manifest["id"]
    capabilities: list[dict] = []
    for route in manifest.get("frontend", {}).get("routes") or []:
        capabilities.append({"capability_type": "route", "capability_key": route["path"], "definition": route})
    for item in manifest.get("frontend", {}).get("navigation") or []:
        capabilities.append({"capability_type": "navigation", "capability_key": item.get("to") or plugin_id, "definition": item})
    for permission in manifest.get("permissions") or []:
        capabilities.append({"capability_type": "permission", "capability_key": permission["code"], "definition": permission})
    for schema_name in _schema_names_from_manifest(plugin_id, manifest):
        capabilities.append({"capability_type": "database_schema", "capability_key": schema_name, "definition": {"schema": schema_name}})
    for dependency in manifest.get("dependencies") or []:
        if isinstance(dependency, dict):
            capabilities.append({"capability_type": "dependency", "capability_key": dependency.get("plugin") or plugin_id, "definition": dependency})
    return capabilities


def _frontend_manifest(installation: dict) -> dict:
    manifest = installation["manifest"]
    plugin_id = installation["plugin_id"]
    frontend = manifest.get("frontend") or {}
    entry = frontend.get("entry")
    return {
        "id": plugin_id,
        "name": manifest.get("name"),
        "description": manifest.get("description"),
        "icon": manifest.get("icon"),
        "version": installation.get("version"),
        "entry": f"/api/plugins/{plugin_id}/assets/{entry}",
        "routes": frontend.get("routes") or [],
        "navigation": frontend.get("navigation") or [],
        "slots": frontend.get("slots") or [],
    }


def _load_plugin_entry_module(plugin_id: str, installation: dict, entry: Path) -> ModuleType:
    manifest = installation["manifest"]
    package_parts = PurePosixPath(manifest["backend"]["entry"]).with_suffix("").parts
    if package_parts[0] == "backend":
        package_parts = package_parts[1:]
    if len(package_parts) < 2:
        raise ValueError("Plugin backend entry must be inside a package")

    package_dir = entry.parent
    module_stem = entry.stem
    unique = re.sub(r"[^a-zA-Z0-9_]", "_", f"{plugin_id}_{installation['version']}_{installation['package_id'] or installation['id']}")
    package_name = f"_smart_design_plugin_{unique}_{package_dir.name}"
    module_name = f"{package_name}.{module_stem}"

    old_module = LOADED_PLUGIN_MODULES.get(plugin_id)
    if old_module:
        _remove_loaded_package(old_module)

    package_module = ModuleType(package_name)
    package_module.__path__ = [str(package_dir)]  # type: ignore[attr-defined]
    package_module.__package__ = package_name
    sys.modules[package_name] = package_module

    spec = importlib.util.spec_from_file_location(module_name, entry)
    if spec is None or spec.loader is None:
        raise ValueError("Plugin backend entry cannot be loaded")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def _remove_loaded_package(module_name: str) -> None:
    old_package = module_name.rsplit(".", 1)[0]
    for name in list(sys.modules):
        if name == old_package or name.startswith(f"{old_package}."):
            sys.modules.pop(name, None)
