import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


class BrandingSettingsApiTest(unittest.TestCase):
    def test_gets_public_branding_settings(self):
        settings = {
            "system_name": "AI PLANT",
            "sidebar_title": "智能工厂",
            "logo_data_url": None,
            "login_background_image_url": None,
            "login_background_image_meta": None,
            "updated_at": None,
        }

        with patch("app.main.get_branding_settings", return_value=settings) as get_branding_settings:
            response = client.get("/api/settings/branding/public")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": settings})
        get_branding_settings.assert_called_once_with()

    def test_gets_protected_branding_settings(self):
        settings = {
            "system_name": "AI PLANT",
            "sidebar_title": "智能工厂",
            "logo_data_url": None,
            "login_background_image_url": None,
            "login_background_image_meta": None,
            "updated_at": None,
        }

        with patch("app.main.get_branding_settings", return_value=settings) as get_branding_settings:
            response = client.get("/api/settings/branding")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": settings})
        get_branding_settings.assert_called_once_with()

    def test_updates_branding_settings(self):
        settings = {
            "system_name": "Smart Design",
            "sidebar_title": "智能工厂",
            "logo_data_url": "data:image/png;base64,ZmFrZQ==",
            "login_background_image_url": None,
            "login_background_image_meta": None,
            "updated_at": None,
        }

        with patch("app.main.upsert_branding_settings", return_value=settings) as upsert_branding_settings:
            response = client.patch(
                "/api/settings/branding",
                json={
                    "system_name": "  Smart Design  ",
                    "sidebar_title": "  智能工厂  ",
                    "logo_data_url": "data:image/png;base64,ZmFrZQ==",
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": settings})
        upsert_branding_settings.assert_called_once_with(
            {
                "system_name": "Smart Design",
                "sidebar_title": "智能工厂",
                "logo_data_url": "data:image/png;base64,ZmFrZQ==",
            }
        )

    def test_streams_public_login_background_image(self):
        image = {
            "object_key": "settings/login-background.webp",
            "file_name": "login-background.webp",
            "mime_type": "image/webp",
            "size_bytes": 16,
            "width": 1600,
            "height": 900,
            "updated_at": "2026-04-25T00:00:00Z",
        }

        class FakeStorage:
            def get_object_bytes(self, *, object_key: str) -> bytes:
                self.object_key = object_key
                return b"RIFFxxxxWEBPdata"

        storage = FakeStorage()
        with (
            patch("app.main.get_branding_login_background_storage_object", return_value=image),
            patch("app.main.get_document_storage", return_value=storage),
        ):
            response = client.get("/api/settings/branding/login-background")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "image/webp")
        self.assertEqual(response.content, b"RIFFxxxxWEBPdata")
        self.assertEqual(storage.object_key, "settings/login-background.webp")

    def test_uploads_login_background_image_without_data_url_payload(self):
        saved = {
            "system_name": "Smart Design",
            "sidebar_title": "智能工厂",
            "logo_data_url": None,
            "login_background_image_url": "/api/settings/branding/login-background?v=123",
            "login_background_image_meta": {
                "file_name": "login-background.webp",
                "mime_type": "image/webp",
                "size_bytes": 16,
                "width": 1600,
                "height": 900,
                "updated_at": "2026-04-25T00:00:00Z",
            },
            "updated_at": None,
        }

        class FakeStorage:
            def build_settings_object_key(self, filename: str) -> str:
                self.filename = filename
                return f"settings/{filename}"

            def put_object(self, *, object_key: str, content: bytes, content_type: str) -> None:
                self.object_key = object_key
                self.content = content
                self.content_type = content_type

        storage = FakeStorage()
        with (
            patch("app.main.get_document_storage", return_value=storage),
            patch("app.main.upsert_branding_login_background", return_value=saved) as upsert_background,
        ):
            response = client.put(
                "/api/settings/branding/login-background",
                data={
                    "source_file_name": "hero.png",
                    "width": "1600",
                    "height": "900",
                },
                files={
                    "file": ("login-background.webp", b"RIFFxxxxWEBPdata", "image/webp"),
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": saved})
        self.assertEqual(storage.filename, "login-background.webp")
        self.assertEqual(storage.object_key, "settings/login-background.webp")
        self.assertEqual(storage.content, b"RIFFxxxxWEBPdata")
        self.assertEqual(storage.content_type, "image/webp")
        payload = upsert_background.call_args.args[0]
        self.assertEqual(payload["object_key"], "settings/login-background.webp")
        self.assertEqual(payload["file_name"], "hero.png")
        self.assertEqual(payload["mime_type"], "image/webp")
        self.assertEqual(payload["size_bytes"], 16)
        self.assertEqual(payload["width"], 1600)
        self.assertEqual(payload["height"], 900)
        self.assertNotIn("data_url", payload)

    def test_rejects_invalid_branding_logo(self):
        with patch("app.main.upsert_branding_settings") as upsert_branding_settings:
            response = client.patch(
                "/api/settings/branding",
                json={
                    "system_name": "Smart Design",
                    "sidebar_title": "智能工厂",
                    "logo_data_url": "https://example.com/logo.png",
                },
            )

        self.assertEqual(response.status_code, 422)
        upsert_branding_settings.assert_not_called()


if __name__ == "__main__":
    unittest.main()
