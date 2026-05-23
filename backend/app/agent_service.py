from __future__ import annotations

import json
import time
from threading import Event, Lock, Thread

from fastapi import HTTPException, status

from .agent_models import (
    AgentJobCreate,
    AgentMessageCreate,
    AgentRunCreate,
    AgentSessionCreate,
    TERMINAL_AGENT_JOB_STATUSES,
    TERMINAL_AGENT_RUN_STATUSES,
)
from .agent_repository import (
    append_agent_job_event,
    append_agent_run_event,
    count_running_agent_jobs,
    count_running_agent_runs,
    create_agent_artifact,
    create_agent_job,
    create_agent_run_artifact,
    create_harness_assistant_message,
    create_harness_run,
    create_harness_session,
    create_harness_user_message,
    get_agent_job,
    get_agent_job_by_id,
    get_agent_run_by_id,
    get_harness_session,
    list_agent_job_events,
    list_agent_run_events,
    list_harness_messages,
    list_harness_sessions,
    list_queued_agent_jobs,
    list_queued_agent_runs,
    mark_agent_job_cancelled,
    mark_agent_job_completed,
    mark_agent_job_failed,
    mark_agent_job_running,
    mark_agent_run_cancelled,
    mark_agent_run_completed,
    mark_agent_run_failed,
    mark_agent_run_running,
    request_agent_job_cancel,
    request_agent_run_cancel,
    update_harness_assistant_message_for_run,
)
from .agent_runner import AgentJobCancelled, AgentRunner, ClawCliRunner
from .agent_runtime import create_agent_runner, list_agent_backends, select_agent_backend
from .authorization import AuthenticatedUser
from .settings.config import get_settings


_active_jobs: dict[str, dict] = {}
_active_jobs_lock = Lock()
_active_runs: dict[str, dict] = {}
_active_runs_lock = Lock()


def create_harness_session_for_user(
    payload: AgentSessionCreate,
    current_user: AuthenticatedUser,
) -> dict:
    _ensure_context_allowed(payload.context_scope, payload.context_ref, current_user)
    return create_harness_session(current_user.id, payload)


def list_harness_sessions_for_user(current_user: AuthenticatedUser) -> list[dict]:
    return list_harness_sessions(current_user.id)


def list_harness_backends_for_user(_current_user: AuthenticatedUser) -> list[dict]:
    return list_agent_backends()


def get_harness_session_for_user(session_id: str, current_user: AuthenticatedUser) -> dict:
    session = get_harness_session(session_id, current_user.id)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent session not found")
    return {
        "session": session,
        "messages": list_harness_messages(session_id),
    }


def get_harness_run_for_user(run_id: str, current_user: AuthenticatedUser) -> dict:
    run = get_agent_run_by_id(run_id)
    if run is None or str(run.get("created_by")) != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent run not found")
    return run


def create_harness_message_for_session(
    session_id: str,
    payload: AgentMessageCreate,
    current_user: AuthenticatedUser,
) -> dict:
    session = get_harness_session(session_id, current_user.id)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent session not found")

    context_scope = payload.context_scope or session.get("context_scope") or "none"
    context_ref = payload.context_ref if payload.context_ref is not None else (session.get("context_ref") or {})
    _ensure_context_allowed(str(context_scope), context_ref, current_user)
    try:
        backend = select_agent_backend(payload.prompt, payload.backend_id)
    except RuntimeError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(error) or "Agent backend is unavailable",
        ) from error

    user_message = create_harness_user_message(session_id, payload.prompt)
    run_payload = AgentRunCreate(
        prompt=payload.prompt,
        context_scope=context_scope,
        context_ref=context_ref,
        capability_profile=payload.capability_profile,
        runner=backend.id,
    )
    run = create_harness_run(session_id, current_user.id, run_payload)
    assistant_message = create_harness_assistant_message(session_id, str(run["id"]), "任务已创建，等待运行。")
    append_agent_run_event(
        str(run["id"]),
        "queued",
        "任务已排队",
        {
            "context_scope": context_scope,
            "context_ref": context_ref,
            "capability_profile": payload.capability_profile,
            "backend_id": backend.id,
            "execution_model": backend.execution_model,
        },
    )
    schedule_queued_agent_runs()
    return {
        "session": session,
        "user_message": user_message,
        "assistant_message": assistant_message,
        "run": get_agent_run_by_id(str(run["id"])) or run,
    }


def create_agent_job_for_project(
    project_id: str,
    payload: AgentJobCreate,
    current_user: AuthenticatedUser,
) -> dict:
    job = create_agent_job(project_id, current_user.id, payload)
    append_agent_job_event(
        str(job["id"]),
        "queued",
        "任务已排队",
        {"task_type": payload.task_type},
    )
    schedule_queued_agent_jobs()
    return get_agent_job(project_id, str(job["id"])) or job


def schedule_queued_agent_jobs() -> None:
    settings = get_settings().agent
    queued_jobs = list_queued_agent_jobs(limit=settings.max_global_concurrency * 2)

    with _active_jobs_lock:
        for job in queued_jobs:
            job_id = str(job["id"])
            if job_id in _active_jobs:
                continue
            if _global_running_count() >= settings.max_global_concurrency:
                break
            created_by = str(job["created_by"])
            if _user_running_count(created_by) >= settings.max_user_concurrency:
                continue

            cancel_event = Event()
            runner = ClawCliRunner()
            thread = Thread(
                target=run_agent_job_once,
                args=(job_id,),
                kwargs={"runner": runner, "cancel_event": cancel_event},
                daemon=True,
            )
            _active_jobs[job_id] = {
                "cancel_event": cancel_event,
                "runner": runner,
                "created_by": created_by,
                "thread": thread,
            }
            thread.start()


def schedule_queued_agent_runs() -> None:
    settings = get_settings().agent
    queued_runs = list_queued_agent_runs(limit=settings.max_global_concurrency * 2)

    with _active_runs_lock:
        for run in queued_runs:
            run_id = str(run["id"])
            if run_id in _active_runs:
                continue
            if _global_running_count() >= settings.max_global_concurrency:
                break
            created_by = str(run["created_by"])
            if _user_running_count(created_by) >= settings.max_user_concurrency:
                continue

            cancel_event = Event()
            runner = create_agent_runner(str(run.get("runner") or "claw-cli"))
            thread = Thread(
                target=run_agent_run_once,
                args=(run_id,),
                kwargs={"runner": runner, "cancel_event": cancel_event},
                daemon=True,
            )
            _active_runs[run_id] = {
                "cancel_event": cancel_event,
                "runner": runner,
                "created_by": created_by,
                "thread": thread,
            }
            thread.start()


def run_agent_job_once(
    job_id: str,
    *,
    runner: AgentRunner | None = None,
    cancel_event: Event | None = None,
) -> None:
    job = get_agent_job_by_id(job_id)
    if job is None:
        _forget_active_job(job_id)
        return

    cancel_event = cancel_event or Event()
    runner = runner or ClawCliRunner()

    if job.get("cancel_requested"):
        mark_agent_job_cancelled(job_id, "Agent job was cancelled before start")
        append_agent_job_event(job_id, "cancelled", "任务已取消", {})
        _forget_active_job(job_id)
        schedule_queued_agent_jobs()
        schedule_queued_agent_runs()
        return

    try:
        session_dir = _prepare_runner_session_dir(runner, job_id)
        running_job = mark_agent_job_running(job_id, session_dir)
        if running_job is None:
            return
        if isinstance(running_job, dict):
            job = running_job
        append_agent_job_event(job_id, "started", "任务开始运行", {"runner": job.get("runner") or "claw-cli"})

        def emit_event(event_type: str, message: str | None = None, payload: dict | None = None) -> None:
            append_agent_job_event(job_id, event_type, message, payload or {})

        result = runner.run(job, emit_event, cancel_event)
        refreshed_job = get_agent_job_by_id(job_id) or {}
        if cancel_event.is_set() or refreshed_job.get("cancel_requested"):
            mark_agent_job_cancelled(job_id, "Agent job was cancelled")
            append_agent_job_event(job_id, "cancelled", "任务已取消", {})
            return

        for artifact in result.artifacts:
            create_agent_artifact(job_id, artifact)
        mark_agent_job_completed(job_id, result.result)
        append_agent_job_event(job_id, "completed", "任务已完成", {"result": result.result})
    except AgentJobCancelled as error:
        mark_agent_job_cancelled(job_id, str(error))
        append_agent_job_event(job_id, "cancelled", "任务已取消", {"error": str(error)})
    except Exception as error:
        message = str(error) or error.__class__.__name__
        mark_agent_job_failed(job_id, message)
        append_agent_job_event(job_id, "failed", message, {"error": message})
    finally:
        _forget_active_job(job_id)
        schedule_queued_agent_jobs()
        schedule_queued_agent_runs()


def run_agent_run_once(
    run_id: str,
    *,
    runner: AgentRunner | None = None,
    cancel_event: Event | None = None,
) -> None:
    run = get_agent_run_by_id(run_id)
    if run is None:
        _forget_active_run(run_id)
        return

    cancel_event = cancel_event or Event()
    runner = runner or ClawCliRunner()

    if run.get("cancel_requested"):
        mark_agent_run_cancelled(run_id, "Agent run was cancelled before start")
        append_agent_run_event(run_id, "cancelled", "任务已取消", {})
        update_harness_assistant_message_for_run(run_id, "任务已取消", {"error": "Agent run was cancelled before start"})
        _forget_active_run(run_id)
        schedule_queued_agent_jobs()
        schedule_queued_agent_runs()
        return

    try:
        session_dir = _prepare_runner_session_dir(runner, run_id)
        running_run = mark_agent_run_running(run_id, session_dir)
        if running_run is None:
            return
        if isinstance(running_run, dict):
            run = running_run
        append_agent_run_event(run_id, "started", "任务开始运行", {"runner": run.get("runner") or "claw-cli"})

        def emit_event(event_type: str, message: str | None = None, payload: dict | None = None) -> None:
            append_agent_run_event(run_id, event_type, message, payload or {})

        run_with_context = _attach_conversation_messages(run)
        result = runner.run(run_with_context, emit_event, cancel_event)
        refreshed_run = get_agent_run_by_id(run_id) or {}
        if cancel_event.is_set() or refreshed_run.get("cancel_requested"):
            mark_agent_run_cancelled(run_id, "Agent run was cancelled")
            append_agent_run_event(run_id, "cancelled", "任务已取消", {})
            update_harness_assistant_message_for_run(run_id, "任务已取消", {"error": "Agent run was cancelled"})
            return

        for artifact in result.artifacts:
            create_agent_run_artifact(run_id, artifact)
        mark_agent_run_completed(run_id, result.result)
        answer = _extract_result_text(result.result) or "任务已完成，但没有返回内容。"
        update_harness_assistant_message_for_run(run_id, answer, result.result)
        append_agent_run_event(run_id, "completed", "任务已完成", {"result": result.result})
    except AgentJobCancelled as error:
        mark_agent_run_cancelled(run_id, str(error))
        append_agent_run_event(run_id, "cancelled", "任务已取消", {"error": str(error)})
        update_harness_assistant_message_for_run(run_id, "任务已取消", {"error": str(error)})
    except Exception as error:
        message = str(error) or error.__class__.__name__
        mark_agent_run_failed(run_id, message)
        append_agent_run_event(run_id, "failed", message, {"error": message})
        update_harness_assistant_message_for_run(run_id, message, {"error": message})
    finally:
        _forget_active_run(run_id)
        schedule_queued_agent_jobs()
        schedule_queued_agent_runs()


def cancel_agent_job_for_project(
    project_id: str,
    job_id: str,
    current_user: AuthenticatedUser,
) -> dict:
    job = get_agent_job(project_id, job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent job not found")

    is_creator = str(job["created_by"]) == current_user.id
    is_manager = current_user.has_permission(
        "project.update",
        project_id=project_id,
    ) or current_user.has_permission("project.member.manage", project_id=project_id)
    if not (is_creator or is_manager):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to cancel this agent job")

    cancelled_job = request_agent_job_cancel(job_id)
    append_agent_job_event(job_id, "cancel_requested", "已请求取消任务", {})

    with _active_jobs_lock:
        active = _active_jobs.get(job_id)
        if active is not None:
            active["cancel_event"].set()
            runner = active.get("runner")
            if hasattr(runner, "terminate"):
                runner.terminate()

    return cancelled_job or job


def cancel_harness_run_for_user(run_id: str, current_user: AuthenticatedUser) -> dict:
    run = get_agent_run_by_id(run_id)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent run not found")
    if str(run["created_by"]) != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to cancel this agent run")

    cancelled_run = request_agent_run_cancel(run_id)
    append_agent_run_event(run_id, "cancel_requested", "已请求取消任务", {})

    with _active_runs_lock:
        active = _active_runs.get(run_id)
        if active is not None:
            active["cancel_event"].set()
            runner = active.get("runner")
            if hasattr(runner, "terminate"):
                runner.terminate()

    return cancelled_run or run


def stream_agent_job_events(project_id: str, job_id: str, after_seq: int = 0):
    last_seq = max(0, int(after_seq or 0))
    last_keepalive = time.monotonic()

    while True:
        job = get_agent_job(project_id, job_id)
        if job is None:
            yield _format_sse("agent-error", {"message": "Agent job not found"})
            return

        events = list_agent_job_events(job_id, after_seq=last_seq, limit=100)
        for event in events:
            last_seq = int(event["seq"])
            yield _format_sse("agent-event", _json_safe_event(event))

        if job["status"] in TERMINAL_AGENT_JOB_STATUSES and not events:
            return

        if time.monotonic() - last_keepalive > 15:
            last_keepalive = time.monotonic()
            yield ": keep-alive\n\n"
        time.sleep(1)


def stream_agent_run_events(run_id: str, after_seq: int = 0):
    last_seq = max(0, int(after_seq or 0))
    last_keepalive = time.monotonic()

    while True:
        run = get_agent_run_by_id(run_id)
        if run is None:
            yield _format_sse("agent-error", {"message": "Agent run not found"})
            return

        events = list_agent_run_events(run_id, after_seq=last_seq, limit=100)
        for event in events:
            last_seq = int(event["seq"])
            yield _format_sse("agent-event", _json_safe_event(event, owner_key="run_id"))

        if run["status"] in TERMINAL_AGENT_RUN_STATUSES and not events:
            return

        if time.monotonic() - last_keepalive > 15:
            last_keepalive = time.monotonic()
            yield ": keep-alive\n\n"
        time.sleep(1)


def _prepare_runner_session_dir(runner: AgentRunner, job_id: str) -> str | None:
    create_session_dir = getattr(runner, "create_session_dir", None)
    if create_session_dir is None:
        return None
    settings = getattr(runner, "settings", None)
    agent_settings = getattr(settings, "agent", None)
    if agent_settings is not None and not agent_settings.claw_executable_path:
        return None
    return create_session_dir(job_id)


def _format_sse(event_name: str, payload: dict) -> str:
    return f"event: {event_name}\ndata: {json.dumps(payload, ensure_ascii=False, default=str)}\n\n"


def _json_safe_event(event: dict, *, owner_key: str = "job_id") -> dict:
    return {
        "id": str(event.get("id")) if event.get("id") is not None else None,
        owner_key: str(event.get(owner_key)) if event.get(owner_key) is not None else None,
        "seq": event.get("seq"),
        "event_type": event.get("event_type"),
        "message": event.get("message"),
        "payload": event.get("payload") or {},
        "created_at": event.get("created_at"),
    }


def _global_running_count() -> int:
    active_count = len(_active_jobs) + len(_active_runs)
    stored_count = count_running_agent_jobs() + count_running_agent_runs()
    return max(active_count, stored_count)


def _user_running_count(created_by: str) -> int:
    active_count = sum(1 for job in _active_jobs.values() if job.get("created_by") == created_by)
    active_count += sum(1 for run in _active_runs.values() if run.get("created_by") == created_by)
    stored_count = count_running_agent_jobs(created_by=created_by) + count_running_agent_runs(created_by=created_by)
    return max(active_count, stored_count)


def _forget_active_job(job_id: str) -> None:
    with _active_jobs_lock:
        _active_jobs.pop(job_id, None)


def _forget_active_run(run_id: str) -> None:
    with _active_runs_lock:
        _active_runs.pop(run_id, None)


def _attach_conversation_messages(run: dict) -> dict:
    session_id = run.get("session_id")
    if session_id is None:
        return run
    return {
        **run,
        "conversation_messages": list_harness_messages(str(session_id)),
    }


def _ensure_context_allowed(context_scope: str, context_ref: dict | None, current_user: AuthenticatedUser) -> None:
    if context_scope not in {"none", "current_page", "project", "database", "workspace"}:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid agent context scope")

    context = context_ref or {}
    project_id = context.get("project_id")
    if context_scope == "project" or (context_scope == "current_page" and project_id):
        if not isinstance(project_id, str) or not project_id.strip():
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Project context requires project_id")
        if not current_user.has_permission("project.read", project_id=project_id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to use this project context")
    if context_scope == "database":
        requested_project_ids = []
        if isinstance(project_id, str) and project_id.strip():
            requested_project_ids.append(project_id.strip())
        raw_project_ids = context.get("project_ids")
        if isinstance(raw_project_ids, list):
            requested_project_ids.extend(str(item).strip() for item in raw_project_ids if str(item).strip())
        for requested_project_id in requested_project_ids:
            if not current_user.has_permission("project.read", project_id=requested_project_id):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to query this project")


def _extract_result_text(result: dict) -> str | None:
    for key in ("answer", "text", "message", "content", "summary", "output", "recommendation"):
        value = result.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    nested = result.get("result")
    if isinstance(nested, dict):
        return _extract_result_text(nested)
    return None
