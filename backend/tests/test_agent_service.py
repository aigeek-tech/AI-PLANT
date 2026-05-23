import json
import tempfile
from pathlib import Path
from types import SimpleNamespace
import unittest
from threading import Event
from unittest.mock import Mock, patch

from fastapi import HTTPException

from app.agent_chat_runner import OpenAiChatRunner
from app.agent_models import AgentJobCreate, AgentMessageCreate, AgentRunResult, AgentSessionCreate
from app.agent_runtime import AgentRuntimeRegistry, ClawCliRuntime, OpenAiChatRuntime, select_agent_backend
from app.agent_runner import ClawCliRunner
from app.agent_service import (
    cancel_agent_job_for_project,
    cancel_harness_run_for_user,
    create_harness_message_for_session,
    create_harness_session_for_user,
    run_agent_job_once,
    run_agent_run_once,
)
from app.authorization import AuthenticatedUser
from app.settings.config import load_settings


def user(user_id: str = "user-1", project_permissions: dict | None = None) -> AuthenticatedUser:
    return AuthenticatedUser(
        id=user_id,
        username=user_id,
        email=None,
        display_name="Test User",
        status="active",
        last_login_at=None,
        created_at="2026-04-25T00:00:00Z",
        updated_at="2026-04-25T00:00:00Z",
        system_permissions=set(),
        project_permissions=project_permissions or {"project-1": {"project.read"}},
        standard_permissions={},
        roles=[],
    )


class FakeRunner:
    def __init__(self):
        self.cancel_event_seen = False

    def run(self, job: dict, emit_event, cancel_event: Event) -> AgentRunResult:
        self.cancel_event_seen = cancel_event.is_set()
        emit_event("tool", "读取项目上下文", {"tool": "get_project_context"})
        emit_event("text", "生成建议", {"chunk": "生成建议"})
        return AgentRunResult(result={"answer": f"done:{job['id']}"})


class FakeHarnessRunner:
    def run(self, run: dict, emit_event, cancel_event: Event) -> AgentRunResult:
        emit_event("tool", "查找资料", {"tool": "search"})
        emit_event("runner", "你好！有什么可以帮您解决的问题吗？", {"message": "你好！有什么可以帮您解决的问题吗？"})
        return AgentRunResult(result={"answer": "你好！有什么可以帮您解决的问题吗？"})


class AgentServiceTest(unittest.TestCase):
    def test_creates_harness_session_with_optional_context(self):
        payload = AgentSessionCreate(title="  平台助手  ", context_scope="project", context_ref={"project_id": "project-1"})
        current_user = user("user-1", {"project-1": {"project.read"}})
        session = {"id": "session-1", "title": "平台助手", "context_scope": "project", "context_ref": {"project_id": "project-1"}}

        with patch("app.agent_service.create_harness_session", return_value=session) as create_session:
            result = create_harness_session_for_user(payload, current_user)

        self.assertEqual(result, session)
        self.assertEqual(create_session.call_args.args[0], "user-1")
        self.assertEqual(create_session.call_args.args[1].title, "平台助手")

    def test_harness_project_context_requires_project_read_permission(self):
        payload = AgentSessionCreate(context_scope="project", context_ref={"project_id": "project-1"})

        with self.assertRaises(HTTPException) as ctx:
            create_harness_session_for_user(payload, user("user-1", {"project-2": {"project.read"}}))

        self.assertEqual(ctx.exception.status_code, 403)

    def test_creates_harness_message_and_schedules_run_without_task_type(self):
        session = {"id": "session-1", "created_by": "user-1", "context_scope": "none", "context_ref": {}}
        user_message = {"id": "message-user", "role": "user", "content": "你好"}
        run = {
            "id": "run-1",
            "session_id": "session-1",
            "prompt": "你好",
            "status": "queued",
            "capability_profile": "full_access",
            "context_scope": "none",
            "context_ref": {},
        }
        assistant_message = {"id": "message-assistant", "role": "assistant", "content": "任务已创建，等待运行。"}

        with (
            patch("app.agent_service.get_harness_session", return_value=session),
            patch("app.agent_service.create_harness_user_message", return_value=user_message) as create_user_message,
            patch("app.agent_service.create_harness_run", return_value=run) as create_run,
            patch("app.agent_service.create_harness_assistant_message", return_value=assistant_message),
            patch("app.agent_service.append_agent_run_event") as append_event,
            patch("app.agent_service.get_agent_run_by_id", return_value=run),
            patch(
                "app.agent_service.select_agent_backend",
                return_value=SimpleNamespace(id="openai-chat", execution_model="persistent_session"),
            ),
            patch("app.agent_service.schedule_queued_agent_runs") as schedule_runs,
        ):
            result = create_harness_message_for_session("session-1", AgentMessageCreate(prompt="  你好  "), user("user-1"))

        self.assertEqual(result["run"], run)
        self.assertEqual(create_user_message.call_args.args[1], "你好")
        self.assertNotIn("task_type", create_run.call_args.args[2].model_dump())
        self.assertEqual(create_run.call_args.args[2].runner, "openai-chat")
        append_event.assert_called_once()
        schedule_runs.assert_called_once()

    def test_rejects_harness_message_when_backend_is_unavailable(self):
        session = {"id": "session-1", "created_by": "user-1", "context_scope": "none", "context_ref": {}}

        with (
            patch("app.agent_service.get_harness_session", return_value=session),
            patch("app.agent_service.select_agent_backend", side_effect=RuntimeError("backend missing")),
        ):
            with self.assertRaises(HTTPException) as ctx:
                create_harness_message_for_session("session-1", AgentMessageCreate(prompt="你好"), user("user-1"))

        self.assertEqual(ctx.exception.status_code, 503)
        self.assertEqual(ctx.exception.detail, "backend missing")

    def test_runs_harness_run_with_fake_runner_and_updates_assistant_message(self):
        stored_events: list[tuple[str, str, dict]] = []
        run = {
            "id": "run-1",
            "session_id": "session-1",
            "created_by": "user-1",
            "prompt": "你好",
            "status": "queued",
            "capability_profile": "full_access",
            "context_scope": "none",
            "context_ref": {},
        }

        with (
            patch("app.agent_service.get_agent_run_by_id", return_value=run),
            patch("app.agent_service.mark_agent_run_running") as mark_running,
            patch("app.agent_service.mark_agent_run_completed") as mark_completed,
            patch("app.agent_service.mark_agent_run_failed") as mark_failed,
            patch("app.agent_service.update_harness_assistant_message_for_run") as update_message,
            patch("app.agent_service.list_harness_messages", return_value=[]),
            patch(
                "app.agent_service.append_agent_run_event",
                side_effect=lambda run_id, event_type, message=None, payload=None: stored_events.append(
                    (event_type, message or "", payload or {})
                ),
            ),
            patch("app.agent_service.schedule_queued_agent_runs"),
            patch("app.agent_service.schedule_queued_agent_jobs"),
        ):
            run_agent_run_once("run-1", runner=FakeHarnessRunner())

        mark_running.assert_called_once()
        mark_completed.assert_called_once_with("run-1", {"answer": "你好！有什么可以帮您解决的问题吗？"})
        mark_failed.assert_not_called()
        update_message.assert_called_once()
        self.assertEqual([event[0] for event in stored_events], ["started", "tool", "runner", "completed"])

    def test_cancel_harness_run_requires_creator(self):
        run = {
            "id": "run-2",
            "session_id": "session-1",
            "created_by": "user-2",
            "status": "running",
        }

        with patch("app.agent_service.get_agent_run_by_id", return_value=run):
            with self.assertRaises(HTTPException) as ctx:
                cancel_harness_run_for_user("run-2", user("user-1"))

        self.assertEqual(ctx.exception.status_code, 403)

    def test_runs_agent_job_with_fake_runner_and_persists_event_sequence(self):
        stored_events: list[tuple[str, str, dict]] = []
        job = {
            "id": "job-1",
            "project_id": "project-1",
            "created_by": "user-1",
            "task_type": "project_qa",
            "prompt": "检查项目数据",
            "status": "queued",
        }

        with (
            patch("app.agent_service.get_agent_job_by_id", return_value=job),
            patch("app.agent_service.mark_agent_job_running") as mark_running,
            patch("app.agent_service.mark_agent_job_completed") as mark_completed,
            patch("app.agent_service.mark_agent_job_failed") as mark_failed,
            patch(
                "app.agent_service.append_agent_job_event",
                side_effect=lambda job_id, event_type, message=None, payload=None: stored_events.append(
                    (event_type, message or "", payload or {})
                ),
            ),
            patch("app.agent_service.schedule_queued_agent_jobs"),
            patch("app.agent_service.schedule_queued_agent_runs"),
        ):
            run_agent_job_once("job-1", runner=FakeRunner())

        mark_running.assert_called_once()
        mark_completed.assert_called_once_with("job-1", {"answer": "done:job-1"})
        mark_failed.assert_not_called()
        self.assertEqual([event[0] for event in stored_events], ["started", "tool", "text", "completed"])

    def test_marks_job_failed_when_claw_runner_is_not_configured(self):
        job = {
            "id": "job-2",
            "project_id": "project-1",
            "created_by": "user-1",
            "task_type": "project_qa",
            "prompt": "检查项目数据",
            "status": "queued",
        }

        with (
            patch("app.agent_service.get_agent_job_by_id", return_value=job),
            patch("app.agent_service.mark_agent_job_running"),
            patch("app.agent_service.mark_agent_job_completed") as mark_completed,
            patch("app.agent_service.mark_agent_job_failed") as mark_failed,
            patch("app.agent_service.append_agent_job_event") as append_event,
            patch("app.agent_service.schedule_queued_agent_jobs"),
            patch("app.agent_service.schedule_queued_agent_runs"),
            patch("app.agent_runner.get_settings", return_value=load_settings({})),
        ):
            run_agent_job_once("job-2")

        mark_completed.assert_not_called()
        self.assertTrue(mark_failed.call_args.args[1].startswith("CLAW_EXECUTABLE_PATH is not configured"))
        event_types = [call.args[1] for call in append_event.call_args_list]
        self.assertIn("failed", event_types)

    def test_cancel_requires_creator_or_project_manager(self):
        job = {
            "id": "job-3",
            "project_id": "project-1",
            "created_by": "user-2",
            "status": "running",
        }

        with patch("app.agent_service.get_agent_job", return_value=job):
            with self.assertRaises(HTTPException) as ctx:
                cancel_agent_job_for_project("project-1", "job-3", user("user-1"))

        self.assertEqual(ctx.exception.status_code, 403)

    def test_cancel_allows_project_manager(self):
        job = {
            "id": "job-4",
            "project_id": "project-1",
            "created_by": "user-2",
            "status": "running",
        }
        manager = user("user-1", {"project-1": {"project.read", "project.update"}})

        with (
            patch("app.agent_service.get_agent_job", return_value=job),
            patch("app.agent_service.request_agent_job_cancel", return_value={**job, "cancel_requested": True}) as cancel_job,
            patch("app.agent_service.append_agent_job_event") as append_event,
        ):
            result = cancel_agent_job_for_project("project-1", "job-4", manager)

        self.assertTrue(result["cancel_requested"])
        cancel_job.assert_called_once_with("job-4")
        append_event.assert_called_once()


class AgentModelTest(unittest.TestCase):
    def test_agent_job_create_strips_prompt_and_rejects_blank_text(self):
        payload = AgentJobCreate(task_type="project_qa", prompt="  检查项目  ")
        self.assertEqual(payload.prompt, "检查项目")

        with self.assertRaises(ValueError):
            AgentJobCreate(task_type="project_qa", prompt="   ")


class ClawRunnerSettingsTest(unittest.TestCase):
    def test_openai_chat_runner_uses_persisted_conversation_without_status_placeholders(self):
        emitted: list[tuple[str, str, dict]] = []
        run = {
            "id": "run-chat",
            "session_id": "session-1",
            "prompt": "你好",
            "context_scope": "none",
            "context_ref": {},
            "conversation_messages": [
                {"role": "user", "content": "你好"},
                {"role": "assistant", "run_id": "run-chat", "content": "任务已创建，等待运行。"},
                {"role": "assistant", "run_id": "old-run", "content": "Internal Server Error"},
            ],
        }
        settings = {
            "provider": "ai-geek",
            "base_url": "https://api.example.com",
            "endpoint_path": "/v1/chat/completions",
            "model": "test-model",
            "api_key": "secret-key",
            "temperature": 0.2,
            "max_tokens": 4096,
            "timeout_seconds": 30,
            "is_enabled": True,
        }

        with (
            patch("app.agent_chat_runner.get_ai_settings_secret", return_value=settings),
            patch(
                "app.agent_chat_runner.complete_chat_messages",
                return_value={"text": "你好！有什么可以帮你？", "model": "test-model", "usage": {"total_tokens": 12}},
            ) as complete_chat,
        ):
            result = OpenAiChatRunner().run(
                run,
                lambda event_type, message=None, payload=None: emitted.append((event_type, message or "", payload or {})),
                Event(),
            )

        sent_messages = complete_chat.call_args.kwargs["messages"]
        serialized_messages = json.dumps(sent_messages, ensure_ascii=False)
        self.assertNotIn("Internal Server Error", serialized_messages)
        self.assertNotIn("任务已创建", serialized_messages)
        self.assertEqual(result.result["answer"], "你好！有什么可以帮你？")
        self.assertEqual([event[0] for event in emitted], ["context", "runtime_config", "assistant_message", "usage"])

    def test_openai_chat_runtime_reports_missing_ai_settings(self):
        with patch("app.agent_runtime.get_ai_settings_secret", return_value={"is_enabled": True, "model": "", "api_key": ""}):
            backend = OpenAiChatRuntime().describe()

        self.assertEqual(backend.id, "openai-chat")
        self.assertEqual(backend.status, "missing_config")

    def test_runtime_registry_reports_missing_claw_configuration(self):
        registry = AgentRuntimeRegistry(
            {"claw-cli": ClawCliRuntime(load_settings({}))}
        )

        backends = registry.list_backends()

        self.assertEqual(backends[0]["id"], "claw-cli")
        self.assertEqual(backends[0]["status"], "missing_config")
        self.assertEqual(backends[0]["execution_model"], "one_shot_cli")

    def test_runtime_registry_reports_configured_claw_backend(self):
        registry = AgentRuntimeRegistry(
            {"claw-cli": ClawCliRuntime(load_settings({"CLAW_EXECUTABLE_PATH": "D:\\tools\\claw.exe"}))}
        )

        backend = registry.get_backend("claw-cli")

        self.assertEqual(backend.status, "available")
        self.assertIn("tool_events", backend.capabilities)

    def test_backend_router_uses_claw_for_tool_tasks_when_available(self):
        with patch("app.agent_runtime.get_agent_runtime_registry") as get_registry:
            get_registry.return_value.get_backend.side_effect = lambda backend_id=None: SimpleNamespace(
                id=backend_id or "openai-chat",
                status="available",
                health_message=None,
            )

            backend = select_agent_backend("请读取文件并运行 build")

        self.assertEqual(backend.id, "claw-cli")

    def test_backend_router_uses_data_qa_for_numeric_data_questions(self):
        with patch("app.agent_runtime.get_agent_runtime_registry") as get_registry:
            get_registry.return_value.get_backend.side_effect = lambda backend_id=None: SimpleNamespace(
                id=backend_id or "openai-chat",
                status="available",
                health_message=None,
            )

            backend = select_agent_backend("按状态统计当前项目 TAG 数量")

        self.assertEqual(backend.id, "smart-design-data-qa")

    def test_backend_router_keeps_contextual_quality_questions_on_chat_backend(self):
        with patch("app.agent_runtime.get_agent_runtime_registry") as get_registry:
            get_registry.return_value.get_backend.side_effect = lambda backend_id=None: SimpleNamespace(
                id=backend_id or "openai-chat",
                status="available",
                health_message=None,
            )

            datasheet_backend = select_agent_backend("哪些设备缺少数据表？")
            attribute_backend = select_agent_backend("哪些 TAG 缺少必填属性？")

        self.assertEqual(datasheet_backend.id, "openai-chat")
        self.assertEqual(attribute_backend.id, "openai-chat")

    def test_openai_chat_runner_sends_data_quality_context_to_llm(self):
        emitted: list[tuple[str, str, dict]] = []
        run = {
            "id": "run-quality-chat",
            "session_id": "session-1",
            "prompt": "哪些设备缺少数据表？",
            "context_scope": "project",
            "context_ref": {"project_id": "project-1"},
            "conversation_messages": [],
        }
        settings = {
            "provider": "ai-geek",
            "base_url": "https://api.example.com",
            "endpoint_path": "/v1/chat/completions",
            "model": "test-model",
            "api_key": "secret-key",
            "temperature": 0.2,
            "max_tokens": 4096,
            "timeout_seconds": 30,
            "is_enabled": True,
        }
        context = {
            "pbs_nodes": [],
            "tags": [],
            "equipment": [{"equipment_no": "EQ-1001", "name": "注水泵", "class_name": "泵类"}],
            "documents": [],
            "relations": [],
            "data_quality": {
                "summary": {"issue_count": 1, "document_readiness_score": 80},
                "issues": [
                    {
                        "object_kind": "equipment",
                        "object_code": "EQ-1001",
                        "object_name": "注水泵",
                        "field": "DS",
                        "rule": "required_document",
                        "expected_value": "必须关联该类型文档",
                    }
                ],
                "document_matrix_rows_with_gaps": [
                    {
                        "asset_kind": "equipment",
                        "asset_no": "EQ-1001",
                        "asset_name": "注水泵",
                        "cells_with_gaps": [
                            {
                                "document_type_code": "DS",
                                "document_type_name": "数据表",
                                "status": "missing",
                            }
                        ],
                    }
                ],
            },
        }

        with (
            patch("app.agent_chat_runner.get_ai_settings_secret", return_value=settings),
            patch("app.agent_chat_runner.build_project_agent_context", return_value=context),
            patch(
                "app.agent_chat_runner.complete_chat_messages",
                return_value={"text": "EQ-1001 缺少数据表。", "model": "test-model"},
            ) as complete_chat,
        ):
            result = OpenAiChatRunner().run(
                run,
                lambda event_type, message=None, payload=None: emitted.append((event_type, message or "", payload or {})),
                Event(),
            )

        sent_messages = complete_chat.call_args.kwargs["messages"]
        serialized_messages = json.dumps(sent_messages, ensure_ascii=False)
        self.assertIn("data_quality", serialized_messages)
        self.assertIn("EQ-1001", serialized_messages)
        self.assertIn("数据表", serialized_messages)
        self.assertEqual(result.result["answer"], "EQ-1001 缺少数据表。")
        self.assertEqual([event[0] for event in emitted], ["context", "runtime_config", "assistant_message"])

    def test_backend_router_does_not_treat_database_error_as_data_qa(self):
        with patch("app.agent_runtime.get_agent_runtime_registry") as get_registry:
            get_registry.return_value.get_backend.side_effect = lambda backend_id=None: SimpleNamespace(
                id=backend_id or "openai-chat",
                status="available",
                health_message=None,
            )

            backend = select_agent_backend("帮我修复数据库连接报错")

        self.assertEqual(backend.id, "claw-cli")

    def test_claw_runner_uses_system_ai_settings_as_openai_compatible_runtime(self):
        runner = ClawCliRunner(load_settings({"CLAW_EXECUTABLE_PATH": "D:\\tools\\claw.exe"}))
        job = {
            "id": "job-5",
            "project_id": "project-1",
            "task_type": "project_qa",
            "prompt": "检查项目数据",
        }
        ai_settings = {
            "provider": "ai-geek",
            "base_url": "https://api.siliconflow.cn",
            "endpoint_path": "/v1/chat/completions",
            "model": "Qwen/Qwen3-8B",
            "api_key": "secret-key",
            "is_enabled": True,
        }

        with patch("app.agent_runner.get_ai_settings_secret", return_value=ai_settings):
            runtime = runner._load_ai_runtime_settings()

        command = runner._build_command("claw", job, {"project": {}}, ai_runtime=runtime)
        env = runner._build_environment("agent-session", ai_runtime=runtime)

        self.assertIn("--model", command)
        self.assertEqual(command[command.index("--model") + 1], "openai/smart-design-agent")
        self.assertTrue(command[-1].startswith("/no_think\n"))
        self.assertEqual(runtime["runtime_model"], "openai/Qwen/Qwen3-8B")
        self.assertEqual(env["ANTHROPIC_MODEL"], "openai/Qwen/Qwen3-8B")
        self.assertEqual(env["OPENAI_BASE_URL"], "https://api.siliconflow.cn/v1")
        self.assertEqual(env["OPENAI_API_KEY"], "secret-key")

        with tempfile.TemporaryDirectory() as session_dir:
            runner._write_runtime_config(session_dir, runtime)
            config = json.loads((Path(session_dir) / ".claw" / "settings.json").read_text(encoding="utf-8"))

        self.assertEqual(config["aliases"], {"openai/smart-design-agent": "openai/Qwen/Qwen3-8B"})

    def test_claw_runner_builds_full_access_harness_command_without_task_type(self):
        runner = ClawCliRunner(load_settings({"CLAW_EXECUTABLE_PATH": "D:\\tools\\claw.exe"}))
        run = {
            "id": "run-1",
            "session_id": "session-1",
            "prompt": "查一下资料并给建议",
            "capability_profile": "full_access",
            "context_scope": "none",
            "context_ref": {},
        }

        command = runner._build_command("claw", run, {"scope": "none"}, ai_runtime={"command_model": "openai/test"})
        prompt = command[-1]

        self.assertIn("--permission-mode", command)
        self.assertEqual(command[command.index("--permission-mode") + 1], "danger-full-access")
        self.assertNotIn("--allowedTools", command)
        self.assertIn("Smart Design AI Harness", prompt)
        self.assertNotIn("task_type", prompt)

    def test_harness_prompt_uses_only_current_user_request(self):
        runner = ClawCliRunner(load_settings({"CLAW_EXECUTABLE_PATH": "D:\\tools\\claw.exe"}))
        run = {
            "id": "run-2",
            "session_id": "session-1",
            "prompt": "你好",
            "capability_profile": "full_access",
            "context_scope": "none",
            "context_ref": {},
        }

        prompt = runner._build_prompt(run, {"scope": "none"}, ai_runtime={})
        payload = json.loads(prompt)

        self.assertEqual(payload["user_request"], "你好")
        self.assertNotIn("最近对话", prompt)
        self.assertNotIn("Internal Server Error", prompt)

    def test_runner_line_translates_tool_error_without_using_it_as_answer(self):
        events: list[tuple[str, str, dict]] = []
        text_chunks: list[str] = []
        tool_errors: list[str] = []
        payload = {
            "message": "<system-reminder>出现错误：找不到程序。请检查命令是否拼写正确。</system-reminder>",
            "tool_results": [
                {
                    "tool_name": "bash",
                    "tool_use_id": "tool-1",
                    "is_error": True,
                    "output": "program not found",
                }
            ],
        }

        result = ClawCliRunner._handle_runner_line(
            json.dumps(payload, ensure_ascii=False),
            lambda event_type, message=None, payload=None: events.append((event_type, message or "", payload or {})),
            text_chunks,
            tool_errors,
        )

        self.assertIsNone(result)
        self.assertEqual(text_chunks, [])
        self.assertTrue(tool_errors)
        self.assertEqual([event[0] for event in events], ["tool_result", "runner_error"])


if __name__ == "__main__":
    unittest.main()
