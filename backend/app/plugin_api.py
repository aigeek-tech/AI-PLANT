from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from starlette.responses import FileResponse

from .authorization import AuthenticatedUser, require_authenticated_user
from .plugin_repository import list_plugin_summaries
from .plugin_runtime import (
    disable_plugin,
    enable_plugin,
    enabled_manifest_payload,
    install_plugin,
    purge_plugin,
    resolve_asset_path,
    store_uploaded_package,
    uninstall_plugin,
)
from .settings.config import get_settings


router = APIRouter(prefix="/api/plugins", tags=["plugins"])
PLUGIN_MANAGEMENT_PERMISSIONS = ("system.plugin.manage",)


def _bad_request(error: ValueError) -> HTTPException:
    return HTTPException(status_code=400, detail=str(error))


def require_plugin_management_user(
    current_user: AuthenticatedUser = Depends(require_authenticated_user),
) -> AuthenticatedUser:
    if not any(current_user.has_system_permission(permission) for permission in PLUGIN_MANAGEMENT_PERMISSIONS):
        raise HTTPException(status_code=403, detail="Not enough permissions")
    return current_user


@router.get("")
def plugins_list(_current_user: AuthenticatedUser = Depends(require_plugin_management_user)) -> dict:
    return {"data": list_plugin_summaries()}


@router.post("/packages")
async def upload_plugin_package(
    file: UploadFile = File(...),
    current_user: AuthenticatedUser = Depends(require_plugin_management_user),
) -> dict:
    filename = (file.filename or "").strip()
    if not filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="Plugin package filename must end with .zip")
    settings = get_settings().plugin
    content = await file.read(settings.max_package_bytes + 1)
    if len(content) > settings.max_package_bytes:
        raise HTTPException(status_code=400, detail="Plugin package exceeds the configured size limit")
    try:
        row = store_uploaded_package(filename=filename, package_bytes=content, actor_user_id=current_user.id)
    except ValueError as error:
        raise _bad_request(error) from error
    return {"data": row}


@router.post("/{plugin_id}/install")
def install_uploaded_plugin(
    plugin_id: str,
    current_user: AuthenticatedUser = Depends(require_plugin_management_user),
) -> dict:
    try:
        return {"data": install_plugin(plugin_id, actor_user_id=current_user.id)}
    except ValueError as error:
        raise _bad_request(error) from error


@router.post("/{plugin_id}/enable")
def enable_uploaded_plugin(
    plugin_id: str,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_plugin_management_user),
) -> dict:
    try:
        return {"data": enable_plugin(request.app, plugin_id, actor_user_id=current_user.id)}
    except ValueError as error:
        raise _bad_request(error) from error


@router.post("/{plugin_id}/disable")
def disable_uploaded_plugin(
    plugin_id: str,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_plugin_management_user),
) -> dict:
    try:
        return {"data": disable_plugin(plugin_id, actor_user_id=current_user.id, app=request.app)}
    except ValueError as error:
        raise _bad_request(error) from error


@router.post("/{plugin_id}/uninstall")
def uninstall_uploaded_plugin(
    plugin_id: str,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_plugin_management_user),
) -> dict:
    try:
        return {"data": uninstall_plugin(plugin_id, actor_user_id=current_user.id, app=request.app)}
    except ValueError as error:
        raise _bad_request(error) from error


@router.post("/{plugin_id}/purge")
def purge_uploaded_plugin(
    plugin_id: str,
    current_user: AuthenticatedUser = Depends(require_plugin_management_user),
) -> dict:
    try:
        return {"data": purge_plugin(plugin_id, actor_user_id=current_user.id)}
    except ValueError as error:
        raise _bad_request(error) from error


@router.get("/enabled-manifest")
def enabled_manifest(_current_user: AuthenticatedUser = Depends(require_authenticated_user)) -> dict:
    return {"data": enabled_manifest_payload()}


@router.get("/{plugin_id}/assets/{asset_path:path}")
def plugin_asset(
    plugin_id: str,
    asset_path: str,
    _current_user: AuthenticatedUser = Depends(require_authenticated_user),
) -> FileResponse:
    try:
        path = resolve_asset_path(plugin_id, asset_path)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="Plugin asset not found")
    return FileResponse(Path(path))
