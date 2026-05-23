from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from pydantic import BaseModel, Field, field_validator


AgentTaskType = Literal[
    "project_qa",
    "standard_import_assist",
    "document_archive_assist",
    "tag_search_assist",
    "drawing_analysis_assist",
]
AgentJobStatus = Literal["queued", "running", "completed", "failed", "cancelled"]
AgentContextScope = Literal["none", "current_page", "project", "database", "workspace"]
AgentCapabilityProfile = Literal["full_access"]
AgentMessageRole = Literal["user", "assistant", "system"]
AGENT_TASK_TYPES = {
    "project_qa",
    "standard_import_assist",
    "document_archive_assist",
    "tag_search_assist",
    "drawing_analysis_assist",
}
TERMINAL_AGENT_JOB_STATUSES = {"completed", "failed", "cancelled"}
TERMINAL_AGENT_RUN_STATUSES = TERMINAL_AGENT_JOB_STATUSES
AGENT_CONTEXT_SCOPES = {"none", "current_page", "project", "database", "workspace"}
AGENT_CAPABILITY_PROFILES = {"full_access"}
DEFAULT_AGENT_BACKEND_ID = "openai-chat"
LEGACY_AGENT_BACKEND_ID = "claw-cli"
DATA_QA_AGENT_BACKEND_ID = "smart-design-data-qa"


class AgentJobCreate(BaseModel):
    task_type: AgentTaskType
    prompt: str = Field(min_length=1, max_length=8000)

    @field_validator("prompt")
    @classmethod
    def normalize_prompt(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Prompt cannot be blank")
        return normalized


class AgentSessionCreate(BaseModel):
    title: str | None = Field(default=None, max_length=120)
    context_scope: AgentContextScope = "none"
    context_ref: dict = Field(default_factory=dict)

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @field_validator("context_ref")
    @classmethod
    def normalize_context_ref(cls, value: dict | None) -> dict:
        return value or {}


class AgentMessageCreate(BaseModel):
    prompt: str = Field(min_length=1, max_length=8000)
    context_scope: AgentContextScope | None = None
    context_ref: dict | None = None
    capability_profile: AgentCapabilityProfile = "full_access"
    backend_id: str | None = Field(default=None, max_length=80)

    @field_validator("prompt")
    @classmethod
    def normalize_prompt(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Prompt cannot be blank")
        return normalized

    @field_validator("context_ref")
    @classmethod
    def normalize_optional_context_ref(cls, value: dict | None) -> dict | None:
        return value or None

    @field_validator("backend_id")
    @classmethod
    def normalize_backend_id(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class AgentRunCreate(BaseModel):
    prompt: str = Field(min_length=1, max_length=8000)
    context_scope: AgentContextScope = "none"
    context_ref: dict = Field(default_factory=dict)
    capability_profile: AgentCapabilityProfile = "full_access"
    runner: str | None = Field(default=None, max_length=80)

    @field_validator("prompt")
    @classmethod
    def normalize_prompt(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Prompt cannot be blank")
        return normalized

    @field_validator("context_ref")
    @classmethod
    def normalize_context_ref(cls, value: dict | None) -> dict:
        return value or {}

    @field_validator("runner")
    @classmethod
    def normalize_runner(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class AgentJobEventRead(BaseModel):
    id: str | None = None
    job_id: str | None = None
    seq: int
    event_type: str
    message: str | None = None
    payload: dict = Field(default_factory=dict)
    created_at: object | None = None


class AgentRunEventRead(BaseModel):
    id: str | None = None
    run_id: str | None = None
    seq: int
    event_type: str
    message: str | None = None
    payload: dict = Field(default_factory=dict)
    created_at: object | None = None


@dataclass(frozen=True)
class AgentRunResult:
    result: dict
    artifacts: list[dict] = field(default_factory=list)
