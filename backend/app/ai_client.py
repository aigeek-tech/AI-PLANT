from __future__ import annotations

import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def list_available_ai_models(settings: dict) -> dict:
    provider = settings["provider"]
    _ensure_openai_compatible_protocol(provider)

    response = _request_json(
        _build_models_url(settings["base_url"], settings["endpoint_path"]),
        method="GET",
        api_key=settings.get("api_key"),
        timeout_seconds=settings["timeout_seconds"],
    )
    models = sorted(
        [
            {
                "id": str(item.get("id", "")).strip(),
                "owned_by": item.get("owned_by"),
            }
            for item in response.get("data", [])
            if str(item.get("id", "")).strip()
        ],
        key=lambda item: item["id"],
    )

    return {
        "provider": provider,
        "models": models,
        "count": len(models),
    }


def test_ai_endpoint_connection(settings: dict) -> dict:
    provider = settings["provider"]
    _ensure_openai_compatible_protocol(provider)

    if not settings.get("model"):
        raise ValueError("Model is required for connection testing")

    discovered_models: list[dict] = []
    discovery_error = None
    try:
        discovered = list_available_ai_models(settings)
        discovered_models = discovered["models"]
        available_model_count = discovered["count"]
    except RuntimeError as error:
        available_model_count = None
        discovery_error = str(error)

    response = _request_json(
        f'{settings["base_url"]}{settings["endpoint_path"]}',
        method="POST",
        api_key=settings.get("api_key"),
        timeout_seconds=settings["timeout_seconds"],
        payload={
            "model": settings["model"],
            "messages": [
                {
                    "role": "system",
                    "content": "You are a connectivity check endpoint. Reply in one short sentence.",
                },
                {
                    "role": "user",
                    "content": "Reply with: connection ok",
                },
            ],
            "temperature": settings["temperature"],
            "max_tokens": min(settings.get("max_tokens") or 64, 64),
        },
    )

    sample_text = _extract_chat_completion_text(response)
    available_model_ids = {item["id"] for item in discovered_models}
    return {
        "success": True,
        "provider": provider,
        "base_url": settings["base_url"],
        "endpoint_path": settings["endpoint_path"],
        "requested_model": settings["model"],
        "response_model": response.get("model"),
        "model_found": settings["model"] in available_model_ids if discovered_models else None,
        "available_model_count": available_model_count,
        "discovery_error": discovery_error,
        "sample_text": sample_text,
        "usage": response.get("usage"),
        "raw_id": response.get("id"),
    }


def complete_chat_text(settings: dict, *, system_prompt: str, user_prompt: str) -> str:
    provider = settings["provider"]
    _ensure_openai_compatible_protocol(provider)

    if not settings.get("model"):
        raise ValueError("Model is required")

    response = _request_json(
        f'{settings["base_url"]}{settings["endpoint_path"]}',
        method="POST",
        api_key=settings.get("api_key"),
        timeout_seconds=settings["timeout_seconds"],
        payload={
            "model": settings["model"],
            "messages": [
                {
                    "role": "system",
                    "content": system_prompt,
                },
                {
                    "role": "user",
                    "content": user_prompt,
                },
            ],
            "temperature": settings["temperature"],
            "max_tokens": min(settings.get("max_tokens") or 1024, 2048),
        },
    )
    return _extract_chat_completion_text(response).strip()


def complete_chat_messages(settings: dict, *, messages: list[dict]) -> dict:
    provider = settings["provider"]
    _ensure_openai_compatible_protocol(provider)

    if not settings.get("model"):
        raise ValueError("Model is required")
    if not messages:
        raise ValueError("Messages are required")

    response = _request_json(
        f'{settings["base_url"]}{settings["endpoint_path"]}',
        method="POST",
        api_key=settings.get("api_key"),
        timeout_seconds=settings["timeout_seconds"],
        payload={
            "model": settings["model"],
            "messages": messages,
            "temperature": settings["temperature"],
            "max_tokens": min(settings.get("max_tokens") or 2048, 4096),
        },
    )
    return {
        "text": _extract_chat_completion_text(response).strip(),
        "model": response.get("model"),
        "usage": response.get("usage"),
        "raw_id": response.get("id"),
    }


def _build_models_url(base_url: str, endpoint_path: str) -> str:
    if endpoint_path.endswith("/chat/completions"):
        return f'{base_url}{endpoint_path.removesuffix("/chat/completions")}/models'
    if endpoint_path.endswith("/responses"):
        return f'{base_url}{endpoint_path.removesuffix("/responses")}/models'
    return f"{base_url}/v1/models"


def _ensure_openai_compatible_protocol(provider: str) -> None:
    if not provider or not provider.strip():
        raise ValueError("Provider is required")

    # This settings module currently speaks one protocol only: OpenAI-compatible.
    # The provider field is treated as a user-defined label such as ai-geek, deepseek, qwen, etc.
    return None


def _request_json(
    url: str,
    *,
    method: str,
    timeout_seconds: int,
    api_key: str | None = None,
    payload: dict | None = None,
) -> dict:
    headers = {
        "Accept": "application/json",
    }
    body = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(payload).encode("utf-8")
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    request = Request(url, data=body, method=method, headers=headers)

    try:
        with urlopen(request, timeout=timeout_seconds) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        raise RuntimeError(
            f"上游接口返回 {error.code}: {_read_error_body(error)}"
        ) from error
    except URLError as error:
        raise RuntimeError(f"无法连接到上游接口: {error.reason}") from error
    except TimeoutError as error:
        raise RuntimeError("请求上游接口超时") from error
    except OSError as error:
        raise RuntimeError(f"请求上游接口失败: {error}") from error
    except json.JSONDecodeError as error:
        raise RuntimeError("上游接口返回了非 JSON 响应") from error


def _read_error_body(error: HTTPError) -> str:
    try:
        raw = error.read().decode("utf-8", errors="replace")
    except Exception:
        return "unknown upstream error"

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return raw[:500] or "unknown upstream error"

    if isinstance(parsed, dict):
        error_value = parsed.get("error")
        if isinstance(error_value, dict):
            return str(error_value.get("message") or raw[:500] or "unknown upstream error")
        if error_value:
            return str(error_value)
    return raw[:500] or "unknown upstream error"


def _extract_chat_completion_text(response: dict) -> str:
    choices = response.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""

    message = choices[0].get("message")
    if not isinstance(message, dict):
        return ""

    content = message.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        text_parts = [
            str(item.get("text", ""))
            for item in content
            if isinstance(item, dict) and item.get("type") == "text"
        ]
        return "".join(text_parts)
    return ""
