from __future__ import annotations

from typing import Mapping

from fastapi import Request


SUPPORTED_LOCALES = ("zh-CN", "en-US")
DEFAULT_LOCALE = "zh-CN"


MESSAGES: dict[str, dict[str, str]] = {
    "authInvalidCredentials": {
        "zh-CN": "账号或密码无效。",
        "en-US": "Invalid username or password.",
    },
    "authUserDisabled": {
        "zh-CN": "用户已停用。",
        "en-US": "User is disabled.",
    },
    "authUserLoadFailed": {
        "zh-CN": "已认证用户加载失败。",
        "en-US": "Authenticated user could not be loaded.",
    },
    "authDuplicateUser": {
        "zh-CN": "用户名或邮箱已存在。",
        "en-US": "Username or email already exists.",
    },
    "authBootstrapComplete": {
        "zh-CN": "系统初始化已完成。",
        "en-US": "Bootstrap is already complete.",
    },
    "uploadMissingFilename": {
        "zh-CN": "上传文件必须包含文件名。",
        "en-US": "Uploaded file must have a filename.",
    },
    "userImportHeaderUsername": {
        "zh-CN": "用户名",
        "en-US": "Username",
    },
    "userImportHeaderDisplayName": {
        "zh-CN": "显示名称",
        "en-US": "Display name",
    },
    "userImportHeaderEmail": {
        "zh-CN": "邮箱",
        "en-US": "Email",
    },
    "userImportHeaderStatus": {
        "zh-CN": "状态",
        "en-US": "Status",
    },
    "userImportHeaderPassword": {
        "zh-CN": "密码",
        "en-US": "Password",
    },
    "userImportHeaderSystemRoleCodes": {
        "zh-CN": "系统角色编码",
        "en-US": "System role codes",
    },
    "userImportSheet": {
        "zh-CN": "用户导入",
        "en-US": "User Import",
    },
    "roleReferenceSheet": {
        "zh-CN": "角色参考",
        "en-US": "Role Reference",
    },
    "roleCode": {
        "zh-CN": "角色编码",
        "en-US": "Code",
    },
    "roleName": {
        "zh-CN": "角色名称",
        "en-US": "Name",
    },
    "permissions": {
        "zh-CN": "权限",
        "en-US": "Permissions",
    },
}


def normalize_locale(value: str | None) -> str:
    if not value:
        return DEFAULT_LOCALE
    normalized = value.strip().lower()
    if normalized.startswith("en"):
        return "en-US"
    if normalized.startswith("zh"):
        return "zh-CN"
    return DEFAULT_LOCALE


def request_locale(request: Request | None) -> str:
    if request is None:
        return DEFAULT_LOCALE
    return normalize_locale(request.headers.get("x-locale") or request.headers.get("accept-language"))


def request_has_explicit_locale(request: Request | None) -> bool:
    if request is None:
        return False
    return bool(request.headers.get("x-locale") or request.headers.get("accept-language"))


def translate(code: str, locale: str = DEFAULT_LOCALE, params: Mapping[str, object] | None = None) -> str:
    template = MESSAGES.get(code, {}).get(normalize_locale(locale)) or MESSAGES.get(code, {}).get(DEFAULT_LOCALE) or code
    if not params:
        return template
    return template.format(**params)
