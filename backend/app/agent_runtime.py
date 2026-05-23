from __future__ import annotations

from dataclasses import asdict, dataclass
import shutil
from typing import Protocol

from .agent_chat_runner import OpenAiChatRunner
from .agent_models import DATA_QA_AGENT_BACKEND_ID, DEFAULT_AGENT_BACKEND_ID, LEGACY_AGENT_BACKEND_ID
from .agent_runner import AgentRunner, ClawCliRunner
from .data_qa_runner import DataQaRunner
from .repository import get_ai_settings_secret
from .settings.config import AppSettings, get_settings


class AgentRuntimeFactory(Protocol):
    def create_runner(self) -> AgentRunner:
        ...

    def describe(self) -> "AgentBackendDescriptor":
        ...


@dataclass(frozen=True)
class AgentBackendDescriptor:
    id: str
    label: str
    kind: str
    status: str
    execution_model: str
    is_default: bool
    capabilities: list[str]
    health_message: str | None = None
    command_path: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)


class ClawCliRuntime:
    def __init__(self, settings: AppSettings | None = None):
        self.settings = settings or get_settings()

    def create_runner(self) -> AgentRunner:
        return ClawCliRunner(self.settings)

    def describe(self) -> AgentBackendDescriptor:
        configured_path = self.settings.agent.claw_executable_path
        resolved_path = shutil.which(configured_path) if configured_path else None
        if not configured_path:
            return AgentBackendDescriptor(
                id=LEGACY_AGENT_BACKEND_ID,
                label="Claw CLI",
                kind="claw",
                status="missing_config",
                execution_model="one_shot_cli",
                is_default=False,
                capabilities=_claw_capabilities(),
                health_message="CLAW_EXECUTABLE_PATH is not configured.",
            )

        return AgentBackendDescriptor(
            id=LEGACY_AGENT_BACKEND_ID,
            label="Claw CLI",
            kind="claw",
            status="available",
            execution_model="one_shot_cli",
            is_default=False,
            capabilities=_claw_capabilities(),
            health_message=None if resolved_path else "Configured executable path was not found on PATH; using configured value directly.",
            command_path=resolved_path or configured_path,
        )


class AgentRuntimeRegistry:
    def __init__(self, runtimes: dict[str, AgentRuntimeFactory] | None = None):
        self._runtimes = runtimes or {
            DEFAULT_AGENT_BACKEND_ID: OpenAiChatRuntime(),
            DATA_QA_AGENT_BACKEND_ID: DataQaRuntime(),
            LEGACY_AGENT_BACKEND_ID: ClawCliRuntime(),
        }

    def list_backends(self) -> list[dict]:
        return [runtime.describe().to_dict() for runtime in self._runtimes.values()]

    def get_backend(self, backend_id: str | None = None) -> AgentBackendDescriptor:
        selected_id = (backend_id or DEFAULT_AGENT_BACKEND_ID).strip() or DEFAULT_AGENT_BACKEND_ID
        runtime = self._runtimes.get(selected_id)
        if runtime is None:
            return AgentBackendDescriptor(
                id=selected_id,
                label=selected_id,
                kind="unknown",
                status="unavailable",
                execution_model="unknown",
                is_default=False,
                capabilities=[],
                health_message="Agent backend is not registered.",
            )
        return runtime.describe()

    def create_runner(self, backend_id: str | None = None) -> AgentRunner:
        selected_id = (backend_id or DEFAULT_AGENT_BACKEND_ID).strip() or DEFAULT_AGENT_BACKEND_ID
        runtime = self._runtimes.get(selected_id)
        if runtime is None:
            raise RuntimeError(f"Agent backend is not registered: {selected_id}")
        return runtime.create_runner()


def get_agent_runtime_registry() -> AgentRuntimeRegistry:
    return AgentRuntimeRegistry(
        {
            DEFAULT_AGENT_BACKEND_ID: OpenAiChatRuntime(),
            DATA_QA_AGENT_BACKEND_ID: DataQaRuntime(),
            LEGACY_AGENT_BACKEND_ID: ClawCliRuntime(),
        }
    )


def ensure_agent_backend_available(backend_id: str | None = None) -> AgentBackendDescriptor:
    backend = get_agent_runtime_registry().get_backend(backend_id)
    if backend.status != "available":
        detail = backend.health_message or f"Agent backend is {backend.status}"
        raise RuntimeError(detail)
    return backend


def select_agent_backend(prompt: str, requested_backend_id: str | None = None) -> AgentBackendDescriptor:
    registry = get_agent_runtime_registry()
    if requested_backend_id:
        backend = registry.get_backend(requested_backend_id)
        if backend.status != "available":
            detail = backend.health_message or f"Agent backend is {backend.status}"
            raise RuntimeError(detail)
        return backend

    data_qa_backend = registry.get_backend(DATA_QA_AGENT_BACKEND_ID)
    if _looks_like_data_qa_task(prompt):
        if data_qa_backend.status == "available":
            return data_qa_backend
        detail = data_qa_backend.health_message or f"Agent backend is {data_qa_backend.status}"
        raise RuntimeError(detail)

    tool_backend = registry.get_backend(LEGACY_AGENT_BACKEND_ID)
    if _looks_like_tool_task(prompt) and tool_backend.status == "available":
        return tool_backend

    chat_backend = registry.get_backend(DEFAULT_AGENT_BACKEND_ID)
    if chat_backend.status == "available":
        return chat_backend
    if tool_backend.status == "available":
        return tool_backend

    detail = chat_backend.health_message or tool_backend.health_message or "No agent backend is available."
    raise RuntimeError(detail)


def create_agent_runner(backend_id: str | None = None) -> AgentRunner:
    return get_agent_runtime_registry().create_runner(backend_id)


def list_agent_backends() -> list[dict]:
    return get_agent_runtime_registry().list_backends()


def _claw_capabilities() -> list[str]:
    return [
        "chat",
        "event_stream",
        "tool_events",
        "cancel",
        "project_context",
        "workspace_cwd",
    ]


class OpenAiChatRuntime:
    def __init__(self, settings: AppSettings | None = None):
        self.settings = settings or get_settings()

    def create_runner(self) -> AgentRunner:
        return OpenAiChatRunner()

    def describe(self) -> AgentBackendDescriptor:
        status, health_message = _openai_backend_health()
        return AgentBackendDescriptor(
            id=DEFAULT_AGENT_BACKEND_ID,
            label="OpenAI Chat",
            kind="openai_compatible",
            status=status,
            execution_model="persistent_session",
            is_default=True,
            capabilities=[
                "chat",
                "persistent_session",
                "event_stream",
                "cancel",
                "project_context",
                "fast_greeting",
            ],
            health_message=health_message,
            command_path=None,
        )


class DataQaRuntime:
    def create_runner(self) -> AgentRunner:
        return DataQaRunner()

    def describe(self) -> AgentBackendDescriptor:
        status, health_message = _openai_backend_health()
        return AgentBackendDescriptor(
            id=DATA_QA_AGENT_BACKEND_ID,
            label="智能问数",
            kind="data_qa",
            status=status,
            execution_model="controlled_runner",
            is_default=False,
            capabilities=[
                "data_qa",
                "structured_result",
                "event_stream",
                "cancel",
                "project_scope",
                "authorized_cross_project_scope",
            ],
            health_message=health_message,
            command_path=None,
        )


def _openai_backend_health() -> tuple[str, str | None]:
    try:
        settings = get_ai_settings_secret()
    except Exception as error:
        return "unavailable", str(error) or "AI settings could not be loaded."
    if not settings.get("is_enabled", True):
        return "missing_config", "AI settings are disabled."
    if not str(settings.get("model") or "").strip():
        return "missing_config", "AI model is not configured."
    if not settings.get("api_key"):
        return "missing_config", "AI API key is not configured."
    if not str(settings.get("base_url") or "").strip():
        return "missing_config", "AI base URL is not configured."
    return "available", None


def _looks_like_tool_task(prompt: str) -> bool:
    normalized = prompt.strip().lower()
    if not normalized:
        return False
    tool_markers = (
        "查资料",
        "联网",
        "搜索",
        "github",
        "读取文件",
        "分析文件",
        "执行",
        "命令",
        "运行",
        "继续做",
        "实现",
        "开发",
        "修复",
        "报错",
        "bug",
        "代码",
        "修改代码",
        "改代码",
        "数据库",
        "sql",
        "bash",
        "powershell",
        "shell",
        "test",
        "build",
        "lint",
    )
    return any(marker in normalized for marker in tool_markers)


def _looks_like_data_qa_task(prompt: str) -> bool:
    normalized = prompt.strip().lower()
    if not normalized:
        return False

    if any(marker in normalized for marker in _DATA_QA_EXCLUSION_MARKERS):
        return False

    has_domain = any(marker in normalized for marker in _DATA_QA_DOMAIN_MARKERS)
    has_metric_intent = any(marker in normalized for marker in _DATA_QA_INTENT_MARKERS)
    if has_domain and has_metric_intent:
        return True

    return any(pattern in normalized for pattern in _DATA_QA_PHRASE_MARKERS)


_DATA_QA_DOMAIN_MARKERS = (
    "tag",
    "位号",
    "标签",
    "文档",
    "文件台账",
    "图纸",
    "设备",
    "资产",
    "项目",
    "pbs",
    "wbs",
    "节点",
    "关系",
    "关联",
    "安装",
    "台账",
    "专业",
    "类别",
    "状态",
)

_DATA_QA_INTENT_MARKERS = (
    "统计",
    "数量",
    "多少",
    "几个",
    "总数",
    "分布",
    "占比",
    "趋势",
    "排行",
    "排名",
    "top",
    "最多",
    "最少",
    "按",
    "各",
    "列表",
    "明细",
    "有哪些",
    "查一下",
    "查询",
)

_DATA_QA_PHRASE_MARKERS = (
    "问数",
    "数据分析",
    "数据统计",
    "当前项目有多少",
    "所有项目有多少",
    "各项目",
    "跨项目统计",
)

_DATA_QA_EXCLUSION_MARKERS = (
    "修复",
    "报错",
    "bug",
    "实现",
    "开发",
    "代码",
    "改代码",
    "修改代码",
    "读取文件",
    "分析文件",
    "执行命令",
    "运行命令",
    "shell",
    "bash",
    "powershell",
    "build",
    "lint",
    "pytest",
    "test",
    "测试失败",
    "sql注入",
    "写sql",
    "写 sql",
    "生成sql",
    "生成 sql",
    "编译为 sql",
    "参数化 sql",
)
