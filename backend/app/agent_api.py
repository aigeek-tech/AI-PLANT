from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from starlette.responses import StreamingResponse

from .agent_models import AgentJobCreate, AgentMessageCreate, AgentSessionCreate
from .agent_repository import get_agent_job
from .agent_service import (
    cancel_agent_job_for_project,
    cancel_harness_run_for_user,
    create_agent_job_for_project,
    create_harness_message_for_session,
    create_harness_session_for_user,
    get_harness_run_for_user,
    get_harness_session_for_user,
    list_harness_backends_for_user,
    list_harness_sessions_for_user,
    stream_agent_job_events,
    stream_agent_run_events,
)
from .authorization import AuthenticatedUser, require_authenticated_user, require_project_permission


router = APIRouter(tags=["agent"])


@router.post("/api/agent/sessions")
def create_harness_session(
    payload: AgentSessionCreate,
    current_user: AuthenticatedUser = Depends(require_authenticated_user),
) -> dict:
    return {"data": create_harness_session_for_user(payload, current_user)}


@router.get("/api/agent/sessions")
def list_harness_sessions(
    current_user: AuthenticatedUser = Depends(require_authenticated_user),
) -> dict:
    return {"data": list_harness_sessions_for_user(current_user)}


@router.get("/api/agent/backends")
def list_harness_backends(
    current_user: AuthenticatedUser = Depends(require_authenticated_user),
) -> dict:
    return {"data": list_harness_backends_for_user(current_user)}


@router.get("/api/agent/sessions/{session_id}")
def get_harness_session(
    session_id: str,
    current_user: AuthenticatedUser = Depends(require_authenticated_user),
) -> dict:
    return {"data": get_harness_session_for_user(session_id, current_user)}


@router.post("/api/agent/sessions/{session_id}/messages")
def create_harness_message(
    session_id: str,
    payload: AgentMessageCreate,
    current_user: AuthenticatedUser = Depends(require_authenticated_user),
) -> dict:
    return {"data": create_harness_message_for_session(session_id, payload, current_user)}


@router.get("/api/agent/runs/{run_id}")
def get_harness_run(
    run_id: str,
    current_user: AuthenticatedUser = Depends(require_authenticated_user),
) -> dict:
    return {"data": get_harness_run_for_user(run_id, current_user)}


@router.get("/api/agent/runs/{run_id}/events")
def stream_harness_run_events(
    run_id: str,
    after_seq: int = Query(default=0, ge=0),
    current_user: AuthenticatedUser = Depends(require_authenticated_user),
) -> StreamingResponse:
    get_harness_run_for_user(run_id, current_user)
    return StreamingResponse(
        stream_agent_run_events(run_id, after_seq=after_seq),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/api/agent/runs/{run_id}/cancel")
def cancel_harness_run(
    run_id: str,
    current_user: AuthenticatedUser = Depends(require_authenticated_user),
) -> dict:
    return {"data": cancel_harness_run_for_user(run_id, current_user)}


@router.post("/api/projects/{project_id}/agent-jobs")
def create_project_agent_job(
    project_id: str,
    payload: AgentJobCreate,
    current_user: AuthenticatedUser = Depends(require_project_permission("project.read")),
) -> dict:
    return {"data": create_agent_job_for_project(project_id, payload, current_user)}


@router.get("/api/projects/{project_id}/agent-jobs/{job_id}")
def get_project_agent_job(
    project_id: str,
    job_id: str,
    _current_user: AuthenticatedUser = Depends(require_project_permission("project.read")),
) -> dict:
    job = get_agent_job(project_id, job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent job not found")
    return {"data": job}


@router.get("/api/projects/{project_id}/agent-jobs/{job_id}/events")
def stream_project_agent_job_events(
    project_id: str,
    job_id: str,
    after_seq: int = Query(default=0, ge=0),
    _current_user: AuthenticatedUser = Depends(require_project_permission("project.read")),
) -> StreamingResponse:
    job = get_agent_job(project_id, job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent job not found")
    return StreamingResponse(
        stream_agent_job_events(project_id, job_id, after_seq=after_seq),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/api/projects/{project_id}/agent-jobs/{job_id}/cancel")
def cancel_project_agent_job(
    project_id: str,
    job_id: str,
    current_user: AuthenticatedUser = Depends(require_project_permission("project.read")),
) -> dict:
    return {"data": cancel_agent_job_for_project(project_id, job_id, current_user)}
