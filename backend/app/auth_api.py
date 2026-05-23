from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, Response, UploadFile, status
from psycopg import IntegrityError

from .auth_models import (
    AuthMeResponse,
    BootstrapAdminRequest,
    LoginRequest,
    ProjectMemberAssignmentRequest,
    UserImportRowPatch,
    SystemRoleAssignmentRequest,
    UserImportCommitRequest,
    UserCreateRequest,
    UserUpdateRequest,
)
from .auth_repository import (
    create_session,
    create_user,
    bootstrap_first_admin,
    count_users,
    get_user_by_id,
    get_user_by_username,
    list_authorization_audit_logs,
    list_project_members,
    list_roles,
    list_roles_by_scope,
    list_user_candidates,
    list_users,
    mark_user_logged_in,
    record_authorization_audit_log,
    remove_project_member,
    revoke_all_user_sessions,
    revoke_session_by_token_hash,
    sync_project_member_roles,
    sync_system_user_roles,
    update_user,
)
from .authorization import AuthenticatedUser, build_authenticated_user, require_authenticated_user, require_permission, require_project_permission
from .errors import localized_http_exception
from .i18n import request_locale
from .security import get_session_cookie_settings, hash_session_token, verify_password
from .user_imports import (
    build_user_export_workbook,
    build_user_import_template,
    commit_user_import_job,
    create_user_import_job_from_upload,
    get_user_import_job_detail,
    patch_user_import_row,
)


router = APIRouter(prefix="/api/auth", tags=["auth"])


def _me_payload(current_user: AuthenticatedUser) -> dict:
    return AuthMeResponse(
        user={
            "id": current_user.id,
            "username": current_user.username,
            "email": current_user.email,
            "display_name": current_user.display_name,
            "status": current_user.status,
            "last_login_at": current_user.last_login_at,
            "created_at": current_user.created_at,
            "updated_at": current_user.updated_at,
        },
        system_permissions=sorted(current_user.system_permissions),
        project_permissions={project_id: sorted(values) for project_id, values in current_user.project_permissions.items()},
        standard_permissions={standard_id: sorted(values) for standard_id, values in current_user.standard_permissions.items()},
        roles=current_user.roles,
    ).model_dump()


@router.post("/login")
def login(payload: LoginRequest, request: Request, response: Response) -> dict:
    user = get_user_by_username(payload.username)
    if user is None or not verify_password(payload.password, user["password_hash"]):
        raise localized_http_exception(
            request,
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="authInvalidCredentials",
            fallback="Invalid username or password",
        )
    if user["status"] != "active":
        raise localized_http_exception(
            request,
            status_code=status.HTTP_403_FORBIDDEN,
            code="authUserDisabled",
            fallback="User is disabled",
        )

    token, _session = create_session(
        str(user["id"]),
        user_agent=request.headers.get("user-agent"),
        ip_address=request.client.host if request.client else None,
    )
    mark_user_logged_in(str(user["id"]))

    cookie = get_session_cookie_settings()
    response.set_cookie(
        cookie.name,
        token,
        max_age=cookie.max_age_seconds,
        httponly=cookie.httponly,
        secure=cookie.secure,
        samesite=cookie.samesite,
        path=cookie.path,
    )

    refreshed_user = get_user_by_id(str(user["id"]))
    if refreshed_user is None:
        raise localized_http_exception(
            request,
            status_code=500,
            code="authUserLoadFailed",
            fallback="Authenticated user could not be loaded",
        )
    current_user = build_authenticated_user(refreshed_user)
    return {"data": _me_payload(current_user)}


@router.get("/bootstrap/status")
def bootstrap_status() -> dict:
    return {"data": {"needs_bootstrap": count_users() == 0}}


@router.post("/bootstrap/admin")
def bootstrap_admin(payload: BootstrapAdminRequest, request: Request) -> dict:
    try:
        user = bootstrap_first_admin(payload.model_dump())
    except IntegrityError as error:
        raise localized_http_exception(
            request,
            status_code=409,
            code="authDuplicateUser",
            fallback="Username or email already exists",
        ) from error
    if user is None:
        raise localized_http_exception(
            request,
            status_code=status.HTTP_409_CONFLICT,
            code="authBootstrapComplete",
            fallback="Bootstrap is already complete",
        )
    return {"data": user}


@router.post("/logout")
def logout(request: Request, response: Response, current_user: AuthenticatedUser = Depends(require_authenticated_user)) -> dict:
    token = request.cookies.get(get_session_cookie_settings().name)
    if token:
        revoke_session_by_token_hash(hash_session_token(token))
    response.delete_cookie(get_session_cookie_settings().name, path="/")
    record_authorization_audit_log(
        actor_user_id=current_user.id,
        action="auth.logout",
        scope_kind="system",
        scope_id=None,
        target_type="user",
        target_id=current_user.id,
        metadata={},
    )
    return {"ok": True}


@router.get("/me")
def me(current_user: AuthenticatedUser = Depends(require_authenticated_user)) -> dict:
    return {"data": _me_payload(current_user)}


@router.get("/users")
def users_list(_current_user: AuthenticatedUser = Depends(require_permission("system.user.manage"))) -> dict:
    return {"data": list_users()}


@router.post("/users")
def create_new_user(
    payload: UserCreateRequest,
    current_user: AuthenticatedUser = Depends(require_permission("system.user.manage")),
) -> dict:
    try:
        user = create_user(payload.model_dump())
    except IntegrityError as error:
        raise HTTPException(status_code=409, detail="Username or email already exists") from error
    record_authorization_audit_log(
        actor_user_id=current_user.id,
        action="user.create",
        scope_kind="system",
        scope_id=None,
        target_type="user",
        target_id=user["id"],
        metadata={"username": user["username"]},
    )
    return {"data": user}


@router.patch("/users/{user_id}")
def update_existing_user(
    user_id: str,
    payload: UserUpdateRequest,
    current_user: AuthenticatedUser = Depends(require_permission("system.user.manage")),
) -> dict:
    try:
        user = update_user(user_id, payload.model_dump(exclude_none=True))
    except IntegrityError as error:
        raise HTTPException(status_code=409, detail="Username or email already exists") from error
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if payload.status == "disabled":
        revoke_all_user_sessions(user_id)
    audit_metadata = payload.model_dump(exclude_none=True, exclude={"password"})
    if payload.password:
        audit_metadata["password_changed"] = True
    record_authorization_audit_log(
        actor_user_id=current_user.id,
        action="user.update",
        scope_kind="system",
        scope_id=None,
        target_type="user",
        target_id=user_id,
        metadata=audit_metadata,
    )
    return {"data": user}


@router.put("/users/{user_id}/system-roles")
def update_user_system_roles(
    user_id: str,
    payload: SystemRoleAssignmentRequest,
    current_user: AuthenticatedUser = Depends(require_permission("system.role.manage")),
) -> dict:
    try:
        role_codes = sync_system_user_roles(user_id, payload.role_codes, granted_by=current_user.id)
    except ValueError as error:
        message = str(error)
        status_code = 404 if message == "User not found" else 400
        raise HTTPException(status_code=status_code, detail=message) from error
    return {"data": {"user_id": user_id, "role_codes": role_codes}}


@router.get("/roles")
def roles_list(_current_user: AuthenticatedUser = Depends(require_permission("system.role.manage"))) -> dict:
    return {"data": list_roles()}


@router.get("/users/import-template")
def download_user_import_template(
    request: Request,
    _current_user: AuthenticatedUser = Depends(require_permission("system.user.manage")),
) -> Response:
    content = build_user_import_template(locale=request_locale(request))
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="user-import-template.xlsx"'},
    )


@router.get("/users/export")
def export_users(_current_user: AuthenticatedUser = Depends(require_permission("system.user.manage"))) -> Response:
    content = build_user_export_workbook()
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="users-export.xlsx"'},
    )


@router.post("/users/imports/validate")
async def validate_user_import(
    request: Request,
    file: UploadFile = File(...),
    current_user: AuthenticatedUser = Depends(require_permission("system.user.manage")),
) -> dict:
    if not file.filename:
        raise localized_http_exception(
            request,
            status_code=400,
            code="uploadMissingFilename",
            fallback="Uploaded file must have a filename",
        )
    allow_role_management = current_user.has_permission("system.role.manage")
    try:
        payload = create_user_import_job_from_upload(file.filename, await file.read(), allow_role_management=allow_role_management)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return {"data": payload}


@router.get("/users/imports/{job_id}")
def get_user_import_job(
    job_id: str,
    status: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    _current_user: AuthenticatedUser = Depends(require_permission("system.user.manage")),
) -> dict:
    try:
        payload = get_user_import_job_detail(job_id, status=status, page=page, page_size=page_size)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return {"data": payload}


@router.patch("/users/imports/{job_id}/rows/{row_id}")
def update_user_import_row(
    job_id: str,
    row_id: str,
    payload: UserImportRowPatch,
    current_user: AuthenticatedUser = Depends(require_permission("system.user.manage")),
) -> dict:
    allow_role_management = current_user.has_permission("system.role.manage")
    try:
        result = patch_user_import_row(job_id, row_id, payload.model_dump(exclude_none=True), allow_role_management=allow_role_management)
    except ValueError as error:
        message = str(error)
        status_code = 404 if "not found" in message.lower() else 400
        raise HTTPException(status_code=status_code, detail=message) from error
    return {"data": result}


@router.post("/users/imports/{job_id}/commit")
def commit_users_import(
    job_id: str,
    _payload: UserImportCommitRequest,
    current_user: AuthenticatedUser = Depends(require_permission("system.user.manage")),
) -> dict:
    allow_role_management = current_user.has_permission("system.role.manage")
    try:
        result = commit_user_import_job(job_id, granted_by=current_user.id, allow_role_management=allow_role_management)
    except ValueError as error:
        message = str(error)
        status_code = 404 if "not found" in message.lower() else 400
        raise HTTPException(status_code=status_code, detail=message) from error
    except IntegrityError as error:
        raise HTTPException(status_code=409, detail="User import commit failed due to duplicate username or email") from error

    record_authorization_audit_log(
        actor_user_id=current_user.id,
        action="user.import",
        scope_kind="system",
        scope_id=None,
        target_type="user_import_job",
        target_id=job_id,
        metadata={
            "created_count": result["created_count"],
            "updated_count": result["updated_count"],
            "skipped_count": result["skipped_count"],
            "failed_count": result["failed_count"],
            "password_change_count": result.get("password_change_count", 0),
            "disabled_count": result.get("disabled_count", 0),
        },
    )
    return {"data": result}


@router.get("/audit-log")
def audit_log_list(_current_user: AuthenticatedUser = Depends(require_permission("system.audit.read"))) -> dict:
    return {"data": list_authorization_audit_logs()}


project_members_router = APIRouter(prefix="/api/projects/{project_id}/members", tags=["project-members"])


@project_members_router.get("")
def project_members_list(
    project_id: str,
    _current_user: AuthenticatedUser = Depends(require_project_permission("project.member.manage")),
) -> dict:
    return {"data": list_project_members(project_id)}


@project_members_router.get("/candidates")
def project_member_candidates(
    project_id: str,
    _current_user: AuthenticatedUser = Depends(require_project_permission("project.member.manage")),
) -> dict:
    return {"data": list_user_candidates()}


@project_members_router.get("/roles")
def project_member_roles(
    project_id: str,
    _current_user: AuthenticatedUser = Depends(require_project_permission("project.member.manage")),
) -> dict:
    return {"data": list_roles_by_scope("project")}


@project_members_router.put("/{user_id}")
def upsert_project_member_roles(
    project_id: str,
    user_id: str,
    payload: ProjectMemberAssignmentRequest,
    current_user: AuthenticatedUser = Depends(require_project_permission("project.member.manage")),
) -> dict:
    try:
        data = sync_project_member_roles(project_id, user_id, payload.role_codes, granted_by=current_user.id)
    except ValueError as error:
        message = str(error)
        status_code = 404 if message in {"Project not found", "User not found"} else 400
        raise HTTPException(status_code=status_code, detail=message) from error
    return {"data": data}


@project_members_router.delete("/{user_id}")
def delete_project_member_roles(
    project_id: str,
    user_id: str,
    current_user: AuthenticatedUser = Depends(require_project_permission("project.member.manage")),
) -> dict:
    remove_project_member(project_id, user_id, granted_by=current_user.id)
    return {"ok": True}
