from __future__ import annotations

from psycopg.types.json import Json

from .agent_models import DEFAULT_AGENT_BACKEND_ID, AgentJobCreate, AgentRunCreate, AgentSessionCreate
from .db import execute_one, fetch_all, fetch_one, get_connection


def create_agent_job(project_id: str, created_by: str, payload: AgentJobCreate) -> dict:
    row = execute_one(
        """
        INSERT INTO agent_job (
            project_id,
            created_by,
            task_type,
            prompt,
            status,
            runner
        )
        VALUES (%s, %s, %s, %s, 'queued', 'claw-cli')
        RETURNING *
        """,
        (project_id, created_by, payload.task_type, payload.prompt),
    )
    if row is None:
        raise RuntimeError("Failed to create agent job")
    return row


def get_agent_job(project_id: str, job_id: str) -> dict | None:
    return fetch_one(
        """
        SELECT *
        FROM agent_job
        WHERE project_id::text = %s
          AND id::text = %s
        """,
        (project_id, job_id),
    )


def get_agent_job_by_id(job_id: str) -> dict | None:
    return fetch_one(
        """
        SELECT *
        FROM agent_job
        WHERE id::text = %s
        """,
        (job_id,),
    )


def list_queued_agent_jobs(limit: int = 10) -> list[dict]:
    return fetch_all(
        """
        SELECT *
        FROM agent_job
        WHERE status = 'queued'
          AND cancel_requested = false
        ORDER BY created_at ASC
        LIMIT %s
        """,
        (limit,),
    )


def count_running_agent_jobs(*, created_by: str | None = None) -> int:
    if created_by is None:
        row = fetch_one(
            """
            SELECT COUNT(*)::int AS total
            FROM agent_job
            WHERE status = 'running'
            """,
        )
    else:
        row = fetch_one(
            """
            SELECT COUNT(*)::int AS total
            FROM agent_job
            WHERE status = 'running'
              AND created_by = %s
            """,
            (created_by,),
        )
    return int(row["total"]) if row else 0


def mark_agent_job_running(job_id: str, session_dir: str | None = None) -> dict | None:
    return execute_one(
        """
        UPDATE agent_job
        SET
            status = 'running',
            session_dir = COALESCE(%s, session_dir),
            started_at = COALESCE(started_at, now()),
            error = NULL
        WHERE id::text = %s
          AND status IN ('queued', 'running')
        RETURNING *
        """,
        (session_dir, job_id),
    )


def mark_agent_job_completed(job_id: str, result: dict) -> dict | None:
    return execute_one(
        """
        UPDATE agent_job
        SET
            status = 'completed',
            result = %s,
            error = NULL,
            finished_at = now()
        WHERE id::text = %s
        RETURNING *
        """,
        (Json(result), job_id),
    )


def mark_agent_job_failed(job_id: str, error: str) -> dict | None:
    return execute_one(
        """
        UPDATE agent_job
        SET
            status = 'failed',
            error = %s,
            finished_at = now()
        WHERE id::text = %s
        RETURNING *
        """,
        (error, job_id),
    )


def mark_agent_job_cancelled(job_id: str, error: str | None = None) -> dict | None:
    return execute_one(
        """
        UPDATE agent_job
        SET
            status = 'cancelled',
            error = %s,
            cancel_requested = true,
            finished_at = now()
        WHERE id::text = %s
        RETURNING *
        """,
        (error, job_id),
    )


def request_agent_job_cancel(job_id: str) -> dict | None:
    return execute_one(
        """
        UPDATE agent_job
        SET
            cancel_requested = true,
            status = CASE WHEN status = 'queued' THEN 'cancelled' ELSE status END,
            finished_at = CASE WHEN status = 'queued' THEN now() ELSE finished_at END
        WHERE id::text = %s
        RETURNING *
        """,
        (job_id,),
    )


def append_agent_job_event(
    job_id: str,
    event_type: str,
    message: str | None = None,
    payload: dict | None = None,
) -> dict:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id
                FROM agent_job
                WHERE id::text = %s
                FOR UPDATE
                """,
                (job_id,),
            )
            if cursor.fetchone() is None:
                raise LookupError("Agent job not found")
            cursor.execute(
                """
                INSERT INTO agent_job_event (
                    job_id,
                    seq,
                    event_type,
                    message,
                    payload
                )
                VALUES (
                    %s,
                    (
                        SELECT COALESCE(MAX(seq), 0) + 1
                        FROM agent_job_event
                        WHERE job_id::text = %s
                    ),
                    %s,
                    %s,
                    %s
                )
                RETURNING *
                """,
                (job_id, job_id, event_type, message, Json(payload or {})),
            )
            row = cursor.fetchone()
        connection.commit()
    if row is None:
        raise RuntimeError("Failed to append agent event")
    return row


def list_agent_job_events(job_id: str, after_seq: int = 0, limit: int = 100) -> list[dict]:
    return fetch_all(
        """
        SELECT *
        FROM agent_job_event
        WHERE job_id::text = %s
          AND seq > %s
        ORDER BY seq ASC
        LIMIT %s
        """,
        (job_id, after_seq, limit),
    )


def create_agent_artifact(job_id: str, payload: dict) -> dict | None:
    return execute_one(
        """
        INSERT INTO agent_artifact (
            job_id,
            artifact_type,
            title,
            payload,
            status
        )
        VALUES (%s, %s, %s, %s, COALESCE(%s, 'draft'))
        RETURNING *
        """,
        (
            job_id,
            str(payload.get("artifact_type") or "draft"),
            str(payload.get("title") or "Agent draft"),
            Json(payload.get("payload") or {}),
            payload.get("status"),
        ),
    )


def create_harness_session(created_by: str, payload: AgentSessionCreate) -> dict:
    row = execute_one(
        """
        INSERT INTO agent_session (
            created_by,
            title,
            context_scope,
            context_ref,
            status
        )
        VALUES (%s, %s, %s, %s, 'active')
        RETURNING *
        """,
        (
            created_by,
            payload.title or "新会话",
            payload.context_scope,
            Json(payload.context_ref),
        ),
    )
    if row is None:
        raise RuntimeError("Failed to create agent session")
    return row


def list_harness_sessions(created_by: str, limit: int = 30) -> list[dict]:
    return fetch_all(
        """
        SELECT *
        FROM agent_session
        WHERE created_by = %s
          AND status = 'active'
        ORDER BY updated_at DESC
        LIMIT %s
        """,
        (created_by, limit),
    )


def get_harness_session(session_id: str, created_by: str | None = None) -> dict | None:
    if created_by is None:
        return fetch_one(
            """
            SELECT *
            FROM agent_session
            WHERE id::text = %s
            """,
            (session_id,),
        )
    return fetch_one(
        """
        SELECT *
        FROM agent_session
        WHERE id::text = %s
          AND created_by = %s
        """,
        (session_id, created_by),
    )


def list_harness_messages(session_id: str) -> list[dict]:
    return fetch_all(
        """
        SELECT *
        FROM agent_message
        WHERE session_id::text = %s
        ORDER BY created_at ASC
        """,
        (session_id,),
    )


def create_harness_user_message(session_id: str, content: str) -> dict:
    row = execute_one(
        """
        INSERT INTO agent_message (
            session_id,
            role,
            content,
            structured_content
        )
        VALUES (%s, 'user', %s, '{}'::jsonb)
        RETURNING *
        """,
        (session_id, content),
    )
    touch_harness_session(session_id)
    if row is None:
        raise RuntimeError("Failed to create agent message")
    return row


def create_harness_assistant_message(session_id: str, run_id: str, content: str) -> dict:
    row = execute_one(
        """
        INSERT INTO agent_message (
            session_id,
            run_id,
            role,
            content,
            structured_content
        )
        VALUES (%s, %s, 'assistant', %s, '{}'::jsonb)
        RETURNING *
        """,
        (session_id, run_id, content),
    )
    touch_harness_session(session_id)
    if row is None:
        raise RuntimeError("Failed to create assistant message")
    return row


def update_harness_assistant_message_for_run(
    run_id: str,
    content: str,
    structured_content: dict | None = None,
) -> dict | None:
    row = execute_one(
        """
        UPDATE agent_message
        SET
            content = %s,
            structured_content = %s
        WHERE run_id::text = %s
          AND role = 'assistant'
        RETURNING *
        """,
        (content, Json(structured_content or {}), run_id),
    )
    if row is not None:
        touch_harness_session(str(row["session_id"]))
    return row


def create_harness_run(session_id: str, created_by: str, payload: AgentRunCreate) -> dict:
    row = execute_one(
        """
        INSERT INTO agent_run (
            session_id,
            created_by,
            prompt,
            status,
            runner,
            capability_profile,
            context_scope,
            context_ref
        )
        VALUES (%s, %s, %s, 'queued', %s, %s, %s, %s)
        RETURNING *
        """,
        (
            session_id,
            created_by,
            payload.prompt,
            payload.runner or DEFAULT_AGENT_BACKEND_ID,
            payload.capability_profile,
            payload.context_scope,
            Json(payload.context_ref),
        ),
    )
    touch_harness_session(session_id)
    if row is None:
        raise RuntimeError("Failed to create agent run")
    return row


def get_agent_run_by_id(run_id: str) -> dict | None:
    return fetch_one(
        """
        SELECT *
        FROM agent_run
        WHERE id::text = %s
        """,
        (run_id,),
    )


def list_queued_agent_runs(limit: int = 10) -> list[dict]:
    return fetch_all(
        """
        SELECT *
        FROM agent_run
        WHERE status = 'queued'
          AND cancel_requested = false
        ORDER BY created_at ASC
        LIMIT %s
        """,
        (limit,),
    )


def count_running_agent_runs(*, created_by: str | None = None) -> int:
    if created_by is None:
        row = fetch_one(
            """
            SELECT COUNT(*)::int AS total
            FROM agent_run
            WHERE status = 'running'
            """,
        )
    else:
        row = fetch_one(
            """
            SELECT COUNT(*)::int AS total
            FROM agent_run
            WHERE status = 'running'
              AND created_by = %s
            """,
            (created_by,),
        )
    return int(row["total"]) if row else 0


def mark_agent_run_running(run_id: str, session_dir: str | None = None) -> dict | None:
    return execute_one(
        """
        UPDATE agent_run
        SET
            status = 'running',
            session_dir = COALESCE(%s, session_dir),
            started_at = COALESCE(started_at, now()),
            error = NULL
        WHERE id::text = %s
          AND status IN ('queued', 'running')
        RETURNING *
        """,
        (session_dir, run_id),
    )


def mark_agent_run_completed(run_id: str, result: dict) -> dict | None:
    return execute_one(
        """
        UPDATE agent_run
        SET
            status = 'completed',
            result = %s,
            error = NULL,
            finished_at = now()
        WHERE id::text = %s
        RETURNING *
        """,
        (Json(result), run_id),
    )


def mark_agent_run_failed(run_id: str, error: str) -> dict | None:
    return execute_one(
        """
        UPDATE agent_run
        SET
            status = 'failed',
            error = %s,
            finished_at = now()
        WHERE id::text = %s
        RETURNING *
        """,
        (error, run_id),
    )


def mark_agent_run_cancelled(run_id: str, error: str | None = None) -> dict | None:
    return execute_one(
        """
        UPDATE agent_run
        SET
            status = 'cancelled',
            error = %s,
            cancel_requested = true,
            finished_at = now()
        WHERE id::text = %s
        RETURNING *
        """,
        (error, run_id),
    )


def request_agent_run_cancel(run_id: str) -> dict | None:
    return execute_one(
        """
        UPDATE agent_run
        SET
            cancel_requested = true,
            status = CASE WHEN status = 'queued' THEN 'cancelled' ELSE status END,
            finished_at = CASE WHEN status = 'queued' THEN now() ELSE finished_at END
        WHERE id::text = %s
        RETURNING *
        """,
        (run_id,),
    )


def append_agent_run_event(
    run_id: str,
    event_type: str,
    message: str | None = None,
    payload: dict | None = None,
) -> dict:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id
                FROM agent_run
                WHERE id::text = %s
                FOR UPDATE
                """,
                (run_id,),
            )
            if cursor.fetchone() is None:
                raise LookupError("Agent run not found")
            cursor.execute(
                """
                INSERT INTO agent_run_event (
                    run_id,
                    seq,
                    event_type,
                    message,
                    payload
                )
                VALUES (
                    %s,
                    (
                        SELECT COALESCE(MAX(seq), 0) + 1
                        FROM agent_run_event
                        WHERE run_id::text = %s
                    ),
                    %s,
                    %s,
                    %s
                )
                RETURNING *
                """,
                (run_id, run_id, event_type, message, Json(payload or {})),
            )
            row = cursor.fetchone()
        connection.commit()
    if row is None:
        raise RuntimeError("Failed to append agent run event")
    return row


def list_agent_run_events(run_id: str, after_seq: int = 0, limit: int = 100) -> list[dict]:
    return fetch_all(
        """
        SELECT *
        FROM agent_run_event
        WHERE run_id::text = %s
          AND seq > %s
        ORDER BY seq ASC
        LIMIT %s
        """,
        (run_id, after_seq, limit),
    )


def create_agent_run_artifact(run_id: str, payload: dict) -> dict | None:
    return execute_one(
        """
        INSERT INTO agent_artifact (
            run_id,
            artifact_type,
            title,
            payload,
            status
        )
        VALUES (%s, %s, %s, %s, COALESCE(%s, 'draft'))
        RETURNING *
        """,
        (
            run_id,
            str(payload.get("artifact_type") or "draft"),
            str(payload.get("title") or "Agent artifact"),
            Json(payload.get("payload") or {}),
            payload.get("status"),
        ),
    )


def touch_harness_session(session_id: str) -> dict | None:
    return execute_one(
        """
        UPDATE agent_session
        SET updated_at = now()
        WHERE id::text = %s
        RETURNING id
        """,
        (session_id,),
    )
