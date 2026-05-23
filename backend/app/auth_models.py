from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class LoginRequest(BaseModel):
    username: str = Field(min_length=1)
    password: str = Field(min_length=1)

    @field_validator("username", "password")
    @classmethod
    def strip_required_text(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Value cannot be blank")
        return stripped


class UserCreateRequest(BaseModel):
    username: str = Field(min_length=1)
    email: str | None = None
    display_name: str = Field(min_length=1)
    password: str = Field(min_length=8)
    status: Literal["active", "disabled"] = "active"

    @field_validator("username", "display_name", "password")
    @classmethod
    def strip_user_text(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Value cannot be blank")
        return stripped

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip().lower()
        return stripped or None


class UserUpdateRequest(BaseModel):
    email: str | None = None
    display_name: str | None = None
    password: str | None = Field(default=None, min_length=8)
    status: Literal["active", "disabled"] | None = None

    @field_validator("email", "display_name", "password")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class BootstrapAdminRequest(UserCreateRequest):
    pass


class ProjectMemberAssignmentRequest(BaseModel):
    role_codes: list[str] = Field(default_factory=list)

    @field_validator("role_codes")
    @classmethod
    def normalize_role_codes(cls, value: list[str]) -> list[str]:
        normalized: list[str] = []
        seen: set[str] = set()
        for item in value:
            code = item.strip().lower()
            if code and code not in seen:
                normalized.append(code)
                seen.add(code)
        return normalized


class SystemRoleAssignmentRequest(BaseModel):
    role_codes: list[str] = Field(default_factory=list)

    @field_validator("role_codes")
    @classmethod
    def normalize_role_codes(cls, value: list[str]) -> list[str]:
        normalized: list[str] = []
        seen: set[str] = set()
        for item in value:
            code = item.strip().lower()
            if code and code not in seen:
                normalized.append(code)
                seen.add(code)
        return normalized


class UserImportRowPatch(BaseModel):
    values: dict = Field(default_factory=dict)


class UserImportCommitRequest(BaseModel):
    confirm: bool = True


class SessionUserSummary(BaseModel):
    id: str
    username: str
    email: str | None
    display_name: str
    status: Literal["active", "disabled"]
    last_login_at: datetime | None
    created_at: datetime
    updated_at: datetime


class RoleSummary(BaseModel):
    id: str
    code: str
    name: str
    scope_kind: Literal["system", "standard", "project"]
    is_builtin: bool
    status: Literal["active", "archived"]
    permissions: list[str] = Field(default_factory=list)


class ProjectMemberSummary(BaseModel):
    user: SessionUserSummary
    project_id: str
    role_codes: list[str] = Field(default_factory=list)
    role_names: list[str] = Field(default_factory=list)


class AuthMeResponse(BaseModel):
    user: SessionUserSummary
    system_permissions: list[str] = Field(default_factory=list)
    project_permissions: dict[str, list[str]] = Field(default_factory=dict)
    standard_permissions: dict[str, list[str]] = Field(default_factory=dict)
    roles: list[RoleSummary] = Field(default_factory=list)
