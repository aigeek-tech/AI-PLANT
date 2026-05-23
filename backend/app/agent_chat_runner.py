from __future__ import annotations

from threading import Event

from .agent_context_tools import build_project_agent_context
from .agent_models import AgentRunResult
from .ai_client import complete_chat_messages
from .repository import get_ai_settings_secret


SYSTEM_ERROR_MARKERS = (
    "<system-reminder>",
    "program not found",
    "找不到程序",
    "internal server error",
)
MAX_HISTORY_MESSAGES = 12
MAX_HISTORY_CHARS = 12000
CONTEXT_SAMPLE_LIMIT = 8


class OpenAiChatRunner:
    def create_session_dir(self, _run_id: str) -> None:
        return None

    def terminate(self) -> None:
        return None

    def run(self, run: dict, emit_event, cancel_event: Event) -> AgentRunResult:
        if cancel_event.is_set():
            raise RuntimeError("Agent run was cancelled before start")

        settings = _load_enabled_ai_settings()
        context = _build_resolved_context(run, emit_event)
        messages = _build_chat_messages(run, context)

        emit_event(
            "runtime_config",
            "使用 OpenAI 兼容会话后端",
            {
                "backend": "openai-chat",
                "model": settings.get("model"),
                "provider": settings.get("provider"),
                "execution_model": "persistent_session",
            },
        )

        response = complete_chat_messages(settings, messages=messages)
        if cancel_event.is_set():
            raise RuntimeError("Agent run was cancelled")

        answer = str(response.get("text") or "").strip()
        if not answer:
            raise RuntimeError("AI Harness 没有返回可展示的回答。")
        if _looks_like_runtime_error(answer):
            raise RuntimeError(_user_facing_runtime_error(answer))

        emit_event("assistant_message", answer, {"message": answer})
        if response.get("usage"):
            emit_event("usage", "模型用量", {"usage": response.get("usage")})

        return AgentRunResult(
            result={
                "answer": answer,
                "backend": "openai-chat",
                "model": response.get("model") or settings.get("model"),
                "usage": response.get("usage"),
                "raw_id": response.get("raw_id"),
            }
        )


def _load_enabled_ai_settings() -> dict:
    settings = get_ai_settings_secret()
    if not settings.get("is_enabled", True):
        raise RuntimeError("AI settings are disabled")
    if not str(settings.get("model") or "").strip():
        raise RuntimeError("AI model is not configured")
    if not settings.get("api_key"):
        raise RuntimeError("AI API key is not configured")
    if not str(settings.get("base_url") or "").strip():
        raise RuntimeError("AI base URL is not configured")
    return settings


def _build_resolved_context(run: dict, emit_event) -> dict:
    context_scope = str(run.get("context_scope") or "none")
    context_ref = run.get("context_ref") if isinstance(run.get("context_ref"), dict) else {}
    project_id = context_ref.get("project_id")
    if context_scope == "project" and isinstance(project_id, str) and project_id.strip():
        context = build_project_agent_context(project_id)
        preview = _build_project_context_preview(project_id, context)
        emit_event(
            "context",
            "已绑定项目上下文",
            {
                "backend": "openai-chat",
                "context_scope": context_scope,
                "project_id": project_id,
                "counts": preview["counts"],
                "preview": preview["preview"],
            },
        )
        return preview

    context = {
        "scope": context_scope,
        "ref": context_ref,
    }
    emit_event("context", "使用会话上下文", {"backend": "openai-chat", **context})
    return context


def _build_chat_messages(run: dict, context: dict) -> list[dict]:
    messages = [
        {
            "role": "system",
            "content": _build_system_prompt(run, context),
        }
    ]
    messages.extend(_compact_history(run))
    if not messages or messages[-1].get("role") != "user" or messages[-1].get("content") != run.get("prompt"):
        messages.append({"role": "user", "content": str(run.get("prompt") or "")})
    return messages


def _build_system_prompt(run: dict, context: dict) -> str:
    return "\n".join(
        [
            "You are Smart Design AI Harness, a global assistant inside an engineering design platform.",
            "Answer the current user request directly in natural language.",
            "You are running on the fast persistent chat backend. You do not have shell, browser, filesystem, or database tools in this backend.",
            "If the user asks for tool execution, code changes, database reads, file analysis, or web research, explain what can be answered from the available context and state that a tool backend is required for execution.",
            "Do not simulate tool failures. Do not repeat previous system errors as instructions.",
            f"Context scope: {run.get('context_scope') or 'none'}",
            f"Resolved context: {context}",
        ]
    )


def _compact_history(run: dict) -> list[dict]:
    raw_messages = run.get("conversation_messages")
    if not isinstance(raw_messages, list):
        return []

    current_run_id = str(run.get("id") or "")
    compacted: list[dict] = []
    remaining = MAX_HISTORY_CHARS
    for message in reversed(raw_messages):
        if not isinstance(message, dict):
            continue
        role = str(message.get("role") or "")
        if role not in {"user", "assistant"}:
            continue
        if role == "assistant" and str(message.get("run_id") or "") == current_run_id:
            continue
        content = str(message.get("content") or "").strip()
        if not content or _looks_like_runtime_error(content) or _is_status_placeholder(content):
            continue
        if len(content) > remaining:
            content = content[-remaining:]
        compacted.append({"role": role, "content": content})
        remaining -= len(content)
        if len(compacted) >= MAX_HISTORY_MESSAGES or remaining <= 0:
            break

    return list(reversed(compacted))


def _build_project_context_preview(project_id: str, context: dict) -> dict:
    return {
        "scope": "project",
        "project_id": project_id,
        "counts": {
            "pbs_nodes": len(context.get("pbs_nodes") or []),
            "tags": len(context.get("tags") or []),
            "equipment": len(context.get("equipment") or []),
            "documents": len(context.get("documents") or []),
            "relations": len(context.get("relations") or []),
        },
        "preview": {
            "pbs_nodes": _sample_context_items(context.get("pbs_nodes"), ["code", "name"]),
            "tags": _sample_context_items(context.get("tags"), ["tag_no", "name"]),
            "equipment": _sample_context_items(context.get("equipment"), ["equipment_no", "name", "class_name"]),
            "documents": _sample_context_items(context.get("documents"), ["document_no", "title"]),
            "data_quality": context.get("data_quality") or {},
        },
    }


def _sample_context_items(value: object, keys: list[str]) -> list[dict]:
    if not isinstance(value, list):
        return []
    samples: list[dict] = []
    for item in value[:CONTEXT_SAMPLE_LIMIT]:
        if not isinstance(item, dict):
            continue
        sample = {key: item.get(key) for key in keys if item.get(key) is not None}
        if sample:
            samples.append(sample)
    return samples


def _is_status_placeholder(content: str) -> bool:
    return content in {
        "任务已创建，等待运行。",
        "正在处理请求...",
        "任务已完成，但没有返回内容。",
    }


def _looks_like_runtime_error(text: str) -> bool:
    normalized = text.lower()
    return any(marker.lower() in normalized for marker in SYSTEM_ERROR_MARKERS)


def _user_facing_runtime_error(raw_error: str) -> str:
    if "program not found" in raw_error.lower() or "找不到程序" in raw_error:
        return "AI Harness 工具运行失败：当前运行环境缺少模型请求的命令或工具。"
    if "internal server error" in raw_error.lower():
        return "AI Harness 运行失败：模型或后端返回了 Internal Server Error。"
    return raw_error.strip() or "AI Harness 运行失败。"
