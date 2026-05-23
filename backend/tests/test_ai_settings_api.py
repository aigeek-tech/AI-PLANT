import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


class AiSettingsApiTest(unittest.TestCase):
    def test_gets_ai_settings(self):
        settings = {
            "name": "default",
            "provider": "openai-compatible",
            "base_url": "https://llm.example.com",
            "endpoint_path": "/v1/chat/completions",
            "model": "engineering-assistant",
            "temperature": 0.3,
            "max_tokens": 4096,
            "timeout_seconds": 45,
            "is_enabled": True,
            "has_api_key": True,
            "updated_at": None,
        }

        with patch("app.main.get_ai_settings", return_value=settings) as get_ai_settings:
            response = client.get("/api/settings/ai")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": settings})
        get_ai_settings.assert_called_once_with()

    def test_updates_ai_settings(self):
        settings = {
            "name": "default",
            "provider": "openai-compatible",
            "base_url": "https://llm.example.com",
            "endpoint_path": "/v1/chat/completions",
            "model": "engineering-assistant",
            "temperature": 0.3,
            "max_tokens": 4096,
            "timeout_seconds": 45,
            "is_enabled": True,
            "has_api_key": True,
            "updated_at": None,
        }

        with patch("app.main.upsert_ai_settings", return_value=settings) as upsert_ai_settings:
            response = client.patch(
                "/api/settings/ai",
                json={
                    "provider": "openai-compatible",
                    "base_url": "https://llm.example.com/",
                    "endpoint_path": "/v1/chat/completions",
                    "model": "engineering-assistant",
                    "api_key": "sk-test",
                    "temperature": 0.3,
                    "max_tokens": 4096,
                    "timeout_seconds": 45,
                    "is_enabled": True,
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": settings})
        upsert_ai_settings.assert_called_once_with(
            {
                "provider": "openai-compatible",
                "base_url": "https://llm.example.com",
                "endpoint_path": "/v1/chat/completions",
                "model": "engineering-assistant",
                "api_key": "sk-test",
                "clear_api_key": False,
                "temperature": 0.3,
                "max_tokens": 4096,
                "timeout_seconds": 45,
                "is_enabled": True,
            }
        )

    def test_rejects_invalid_ai_settings_base_url(self):
        with patch("app.main.upsert_ai_settings") as upsert_ai_settings:
            response = client.patch(
                "/api/settings/ai",
                json={
                    "provider": "openai-compatible",
                    "base_url": "ftp://llm.example.com",
                    "endpoint_path": "/v1/chat/completions",
                    "model": "engineering-assistant",
                },
            )

        self.assertEqual(response.status_code, 422)
        upsert_ai_settings.assert_not_called()

    def test_discovers_ai_models(self):
        discovered = {
            "provider": "ai-geek",
            "models": [{"id": "gpt-4o-mini", "owned_by": "openai"}],
            "count": 1,
        }

        with (
            patch("app.main.resolve_ai_runtime_settings", return_value={"provider": "ai-geek"}) as resolve_settings,
            patch("app.main.list_available_ai_models", return_value=discovered) as list_models,
        ):
            response = client.post(
                "/api/settings/ai/models",
                json={
                    "provider": "ai-geek",
                    "base_url": "https://llm.example.com",
                    "endpoint_path": "/v1/chat/completions",
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": discovered})
        resolve_settings.assert_called_once()
        list_models.assert_called_once_with({"provider": "ai-geek"})

    def test_returns_502_when_model_discovery_fails(self):
        with (
            patch("app.main.resolve_ai_runtime_settings", return_value={"provider": "openai-compatible"}),
            patch("app.main.list_available_ai_models", side_effect=RuntimeError("上游接口返回 401")),
        ):
            response = client.post(
                "/api/settings/ai/models",
                json={
                    "provider": "openai-compatible",
                    "base_url": "https://llm.example.com",
                    "endpoint_path": "/v1/chat/completions",
                },
            )

        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json(), {"detail": "上游接口返回 401"})

    def test_tests_ai_endpoint(self):
        result = {
            "success": True,
            "provider": "ai-geek",
            "base_url": "https://llm.example.com",
            "endpoint_path": "/v1/chat/completions",
            "requested_model": "gpt-4o-mini",
            "response_model": "gpt-4o-mini",
            "model_found": True,
            "available_model_count": 12,
            "discovery_error": None,
            "sample_text": "connection ok",
            "usage": {"prompt_tokens": 10, "completion_tokens": 2, "total_tokens": 12},
            "raw_id": "chatcmpl-1",
        }

        with (
            patch("app.main.resolve_ai_runtime_settings", return_value={"provider": "ai-geek"}) as resolve_settings,
            patch("app.main.test_ai_endpoint_connection", return_value=result) as test_connection,
        ):
            response = client.post(
                "/api/settings/ai/test",
                json={
                    "provider": "ai-geek",
                    "base_url": "https://llm.example.com",
                    "endpoint_path": "/v1/chat/completions",
                    "model": "gpt-4o-mini",
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": result})
        resolve_settings.assert_called_once()
        test_connection.assert_called_once_with({"provider": "ai-geek"})


if __name__ == "__main__":
    unittest.main()
