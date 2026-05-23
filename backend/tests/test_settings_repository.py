import unittest
from unittest.mock import patch

from psycopg.types.json import Json

from app.repository import (
    AI_SETTINGS_KEY,
    BRANDING_SETTINGS_KEY,
    clear_branding_login_background,
    get_branding_login_background_storage_object,
    get_ai_settings,
    get_ai_settings_secret,
    get_branding_settings,
    resolve_ai_runtime_settings,
    upsert_branding_login_background,
    upsert_ai_settings,
    upsert_branding_settings,
)


class SettingsRepositoryTest(unittest.TestCase):
    def test_get_ai_settings_returns_defaults_without_row(self):
        with patch("app.repository.fetch_one", return_value=None) as fetch_one:
            result = get_ai_settings()

        self.assertEqual(
            result,
            {
                "name": "default",
                "provider": "openai-compatible",
                "base_url": "",
                "endpoint_path": "/v1/chat/completions",
                "model": "",
                "temperature": 0.2,
                "max_tokens": None,
                "timeout_seconds": 60,
                "is_enabled": True,
                "has_api_key": False,
                "updated_at": None,
            },
        )
        fetch_one.assert_called_once()

    def test_get_ai_settings_secret_reads_from_json_value(self):
        with patch(
            "app.repository.fetch_one",
            return_value={
                "key": AI_SETTINGS_KEY,
                "value": {
                    "provider": "openai-compatible",
                    "base_url": "https://llm.example.com",
                    "endpoint_path": "/v1/chat/completions",
                    "model": "engineering-assistant",
                    "api_key": "sk-test",
                    "temperature": 0.3,
                    "max_tokens": 4096,
                    "timeout_seconds": 45,
                    "is_enabled": True,
                },
                "updated_at": "2026-04-15T00:00:00Z",
            },
        ):
            result = get_ai_settings_secret()

        self.assertEqual(
            result,
            {
                "name": "default",
                "provider": "openai-compatible",
                "base_url": "https://llm.example.com",
                "endpoint_path": "/v1/chat/completions",
                "model": "engineering-assistant",
                "api_key": "sk-test",
                "temperature": 0.3,
                "max_tokens": 4096,
                "timeout_seconds": 45,
                "is_enabled": True,
                "updated_at": "2026-04-15T00:00:00Z",
            },
        )

    def test_upsert_ai_settings_persists_json_value_and_keeps_existing_api_key(self):
        with (
            patch(
                "app.repository.get_ai_settings_secret",
                return_value={
                    "name": "default",
                    "provider": "openai-compatible",
                    "base_url": "https://old.example.com",
                    "endpoint_path": "/v1/chat/completions",
                    "model": "existing-model",
                    "api_key": "saved-secret",
                    "temperature": 0.2,
                    "max_tokens": None,
                    "timeout_seconds": 60,
                    "is_enabled": True,
                    "updated_at": None,
                },
            ),
            patch(
                "app.repository.execute_one",
                return_value={
                    "key": AI_SETTINGS_KEY,
                    "value": {
                        "provider": "openai-compatible",
                        "base_url": "https://llm.example.com",
                        "endpoint_path": "/v1/chat/completions",
                        "model": "engineering-assistant",
                        "api_key": "saved-secret",
                        "temperature": 0.3,
                        "max_tokens": 4096,
                        "timeout_seconds": 45,
                        "is_enabled": True,
                    },
                    "updated_at": "2026-04-15T00:00:00Z",
                },
            ) as execute_one,
        ):
            result = upsert_ai_settings(
                {
                    "provider": "openai-compatible",
                    "base_url": "https://llm.example.com",
                    "endpoint_path": "/v1/chat/completions",
                    "model": "engineering-assistant",
                    "temperature": 0.3,
                    "max_tokens": 4096,
                    "timeout_seconds": 45,
                    "is_enabled": True,
                }
            )

        self.assertEqual(
            result,
            {
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
                "updated_at": "2026-04-15T00:00:00Z",
            },
        )

        execute_one.assert_called_once()
        _, params = execute_one.call_args.args
        self.assertEqual(params[0], AI_SETTINGS_KEY)
        self.assertIsInstance(params[1], Json)
        self.assertEqual(
            params[1].obj,
            {
                "provider": "openai-compatible",
                "base_url": "https://llm.example.com",
                "endpoint_path": "/v1/chat/completions",
                "model": "engineering-assistant",
                "api_key": "saved-secret",
                "temperature": 0.3,
                "max_tokens": 4096,
                "timeout_seconds": 45,
                "is_enabled": True,
            },
        )

    def test_resolve_ai_runtime_settings_uses_existing_values_for_null_text_fields(self):
        with patch(
            "app.repository.get_ai_settings_secret",
            return_value={
                "name": "default",
                "provider": "openai-compatible",
                "base_url": "https://llm.example.com/",
                "endpoint_path": "/v1/chat/completions",
                "model": "existing-model",
                "api_key": "saved-secret",
                "temperature": 0.2,
                "max_tokens": None,
                "timeout_seconds": 60,
                "is_enabled": True,
                "updated_at": None,
            },
        ):
            result = resolve_ai_runtime_settings(
                {
                    "provider": None,
                    "base_url": None,
                    "endpoint_path": None,
                    "model": None,
                    "api_key": None,
                }
            )

        self.assertEqual(result["provider"], "openai-compatible")
        self.assertEqual(result["base_url"], "https://llm.example.com")
        self.assertEqual(result["endpoint_path"], "/v1/chat/completions")
        self.assertEqual(result["model"], "existing-model")
        self.assertEqual(result["api_key"], "saved-secret")

    def test_get_branding_settings_returns_defaults_without_row(self):
        with patch("app.repository.fetch_one", return_value=None) as fetch_one:
            result = get_branding_settings()

        self.assertEqual(
            result,
            {
                "system_name": "AI PLANT",
                "sidebar_title": "智能工厂",
                "logo_data_url": None,
                "login_background_image_url": None,
                "login_background_image_meta": None,
                "updated_at": None,
            },
        )
        fetch_one.assert_called_once()

    def test_upsert_branding_settings_persists_json_value(self):
        with patch(
            "app.repository.execute_one",
            return_value={
                "key": BRANDING_SETTINGS_KEY,
                "value": {
                    "system_name": "Smart Design",
                    "sidebar_title": "智能工厂",
                    "logo_data_url": "data:image/png;base64,ZmFrZQ==",
                    "login_background_image": None,
                },
                "updated_at": "2026-04-25T00:00:00Z",
            },
        ) as execute_one:
            with patch("app.repository.fetch_one", return_value=None):
                result = upsert_branding_settings(
                    {
                        "system_name": "Smart Design",
                        "sidebar_title": "智能工厂",
                        "logo_data_url": "data:image/png;base64,ZmFrZQ==",
                    }
                )

        self.assertEqual(
            result,
            {
                "system_name": "Smart Design",
                "sidebar_title": "智能工厂",
                "logo_data_url": "data:image/png;base64,ZmFrZQ==",
                "login_background_image_url": None,
                "login_background_image_meta": None,
                "updated_at": "2026-04-25T00:00:00Z",
            },
        )

        execute_one.assert_called_once()
        _, params = execute_one.call_args.args
        self.assertEqual(params[0], BRANDING_SETTINGS_KEY)
        self.assertIsInstance(params[1], Json)
        self.assertEqual(
            params[1].obj,
            {
                "system_name": "Smart Design",
                "sidebar_title": "智能工厂",
                "logo_data_url": "data:image/png;base64,ZmFrZQ==",
                "login_background_image": None,
            },
        )

    def test_get_branding_settings_returns_public_login_background_url_without_base64(self):
        with patch(
            "app.repository.fetch_one",
            return_value={
                "key": BRANDING_SETTINGS_KEY,
                "value": {
                    "system_name": "Smart Design",
                    "sidebar_title": "智能工厂",
                    "logo_data_url": None,
                    "login_background_image": {
                        "object_key": "settings/login-background.webp",
                        "file_name": "login-background.webp",
                        "mime_type": "image/webp",
                        "size_bytes": 123456,
                        "width": 1600,
                        "height": 900,
                        "updated_at": "2026-04-25T00:00:00Z",
                    },
                },
                "updated_at": "2026-04-25T00:01:00Z",
            },
        ):
            result = get_branding_settings()

        self.assertEqual(result["login_background_image_url"], "/api/settings/branding/login-background?v=2026-04-25T00%3A00%3A00Z")
        self.assertEqual(
            result["login_background_image_meta"],
            {
                "file_name": "login-background.webp",
                "mime_type": "image/webp",
                "size_bytes": 123456,
                "width": 1600,
                "height": 900,
                "updated_at": "2026-04-25T00:00:00Z",
            },
        )
        self.assertNotIn("object_key", result["login_background_image_meta"])

    def test_get_branding_login_background_storage_object_reads_private_object_key(self):
        with patch(
            "app.repository.fetch_one",
            return_value={
                "value": {
                    "login_background_image": {
                        "object_key": "settings/login-background.webp",
                        "file_name": "login-background.webp",
                        "mime_type": "image/webp",
                        "size_bytes": 123456,
                        "width": 1600,
                        "height": 900,
                        "updated_at": "2026-04-25T00:00:00Z",
                    }
                }
            },
        ):
            result = get_branding_login_background_storage_object()

        self.assertEqual(result["object_key"], "settings/login-background.webp")

    def test_upsert_branding_login_background_preserves_branding_text(self):
        with (
            patch(
                "app.repository.get_branding_settings",
                return_value={
                    "system_name": "Smart Design",
                    "sidebar_title": "智能工厂",
                    "logo_data_url": None,
                    "login_background_image_url": None,
                    "login_background_image_meta": None,
                    "updated_at": None,
                },
            ),
            patch(
                "app.repository.execute_one",
                return_value={
                    "key": BRANDING_SETTINGS_KEY,
                    "value": {
                        "system_name": "Smart Design",
                        "sidebar_title": "智能工厂",
                        "logo_data_url": None,
                        "login_background_image": {
                            "object_key": "settings/login-background.webp",
                            "file_name": "login-background.webp",
                            "mime_type": "image/webp",
                            "size_bytes": 123456,
                            "width": 1600,
                            "height": 900,
                            "updated_at": "2026-04-25T00:00:00Z",
                        },
                    },
                    "updated_at": "2026-04-25T00:00:00Z",
                },
            ) as execute_one,
        ):
            result = upsert_branding_login_background(
                {
                    "object_key": "settings/login-background.webp",
                    "file_name": "login-background.webp",
                    "mime_type": "image/webp",
                    "size_bytes": 123456,
                    "width": 1600,
                    "height": 900,
                    "updated_at": "2026-04-25T00:00:00Z",
                }
            )

        self.assertEqual(result["login_background_image_meta"]["size_bytes"], 123456)
        _, params = execute_one.call_args.args
        self.assertEqual(params[1].obj["system_name"], "Smart Design")
        self.assertEqual(params[1].obj["login_background_image"]["object_key"], "settings/login-background.webp")

    def test_clear_branding_login_background_preserves_branding_text(self):
        with (
            patch(
                "app.repository.get_branding_settings",
                return_value={
                    "system_name": "Smart Design",
                    "sidebar_title": "智能工厂",
                    "logo_data_url": None,
                    "login_background_image_url": "/api/settings/branding/login-background?v=old",
                    "login_background_image_meta": {
                        "file_name": "login-background.webp",
                        "mime_type": "image/webp",
                        "size_bytes": 123456,
                        "width": 1600,
                        "height": 900,
                        "updated_at": "2026-04-25T00:00:00Z",
                    },
                    "updated_at": None,
                },
            ),
            patch(
                "app.repository.execute_one",
                return_value={
                    "key": BRANDING_SETTINGS_KEY,
                    "value": {
                        "system_name": "Smart Design",
                        "sidebar_title": "智能工厂",
                        "logo_data_url": None,
                        "login_background_image": None,
                    },
                    "updated_at": "2026-04-25T00:00:00Z",
                },
            ) as execute_one,
        ):
            result = clear_branding_login_background()

        self.assertIsNone(result["login_background_image_url"])
        _, params = execute_one.call_args.args
        self.assertIsNone(params[1].obj["login_background_image"])


if __name__ == "__main__":
    unittest.main()
