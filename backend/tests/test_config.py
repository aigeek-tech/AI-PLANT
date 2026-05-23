import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from app.settings.config import load_settings


class AppSettingsTest(unittest.TestCase):
    def test_development_uses_local_defaults(self):
        settings = load_settings({})

        self.assertEqual(settings.environment, "development")
        self.assertEqual(settings.database_url, "postgresql://postgres:postgres@localhost:55432/smart_design")
        self.assertEqual(settings.allowed_origins, ["http://localhost:5173", "http://127.0.0.1:5173"])
        self.assertEqual(settings.document_storage.endpoint, "http://127.0.0.1:9000")
        self.assertEqual(settings.document_storage.access_key, "minioadmin")
        self.assertEqual(settings.document_storage.secret_key, "minioadmin")
        self.assertTrue(settings.document_conversion.enabled)
        self.assertEqual(settings.document_conversion.max_bytes, 500 * 1024 * 1024)
        self.assertIsNone(settings.document_conversion.rvm_converter_command)
        self.assertIsNone(settings.document_conversion.spark_build_lod_command)

    def test_production_requires_runtime_configuration(self):
        with self.assertRaisesRegex(RuntimeError, "DATABASE_URL"):
            load_settings({"SMART_DESIGN_ENV": "production"})

    def test_production_loads_explicit_runtime_configuration(self):
        settings = load_settings(
            {
                "SMART_DESIGN_ENV": "production",
                "DATABASE_URL": "postgresql://user:pass@db:5432/smart_design",
                "SMART_DESIGN_ALLOWED_ORIGINS": "https://smart-design.example.com",
                "S3_ENDPOINT": "https://s3.example.com",
                "S3_BUCKET": "smart-design-documents",
                "S3_ACCESS_KEY": "example-access-key",
                "S3_SECRET_KEY": "example-secret-key",
            }
        )

        self.assertTrue(settings.is_production)
        self.assertEqual(settings.allowed_origins, ["https://smart-design.example.com"])
        self.assertEqual(settings.document_storage.endpoint, "https://s3.example.com")

    def test_development_rewrites_container_only_preview_endpoint_for_browser_uploads(self):
        settings = load_settings({"S3_PREVIEW_ENDPOINT": "http://host.docker.internal:9000"})

        self.assertEqual(settings.document_storage.preview_endpoint, "http://127.0.0.1:9000")

    def test_production_keeps_explicit_public_preview_endpoint(self):
        settings = load_settings(
            {
                "SMART_DESIGN_ENV": "production",
                "DATABASE_URL": "postgresql://user:pass@db:5432/smart_design",
                "SMART_DESIGN_ALLOWED_ORIGINS": "https://smart-design.example.com",
                "S3_ENDPOINT": "http://host.docker.internal:9000",
                "S3_PREVIEW_ENDPOINT": "http://www.waynehuang.top:9000",
                "S3_BUCKET": "smart-design-documents",
                "S3_ACCESS_KEY": "example-access-key",
                "S3_SECRET_KEY": "example-secret-key",
            }
        )

        self.assertEqual(settings.document_storage.preview_endpoint, "http://www.waynehuang.top:9000")

    def test_development_uses_agent_defaults_without_claw_path(self):
        settings = load_settings({})

        self.assertIsNone(settings.agent.claw_executable_path)
        self.assertEqual(settings.agent.max_global_concurrency, 4)
        self.assertEqual(settings.agent.max_user_concurrency, 1)
        self.assertEqual(settings.agent.job_timeout_seconds, 900)

    def test_loads_agent_runtime_configuration(self):
        settings = load_settings(
            {
                "CLAW_EXECUTABLE_PATH": "D:\\tools\\claw.exe",
                "AGENT_MAX_GLOBAL_CONCURRENCY": "8",
                "AGENT_MAX_USER_CONCURRENCY": "2",
                "AGENT_JOB_TIMEOUT_SECONDS": "120",
            }
        )

        self.assertEqual(settings.agent.claw_executable_path, "D:\\tools\\claw.exe")
        self.assertEqual(settings.agent.max_global_concurrency, 8)
        self.assertEqual(settings.agent.max_user_concurrency, 2)
        self.assertEqual(settings.agent.job_timeout_seconds, 120)

    def test_loads_local_env_file_before_runtime_overrides(self):
        with TemporaryDirectory() as temp_dir:
            env_file = Path(temp_dir) / ".env"
            env_file.write_text(
                "\n".join(
                    [
                        "CLAW_EXECUTABLE_PATH=D:\\tools\\claw.exe",
                        "AGENT_MAX_GLOBAL_CONCURRENCY=8",
                        "AGENT_MAX_USER_CONCURRENCY=2",
                    ]
                ),
                encoding="utf-8",
            )

            settings = load_settings(
                {"AGENT_MAX_USER_CONCURRENCY": "3"},
                env_file=env_file,
            )

        self.assertEqual(settings.agent.claw_executable_path, "D:\\tools\\claw.exe")
        self.assertEqual(settings.agent.max_global_concurrency, 8)
        self.assertEqual(settings.agent.max_user_concurrency, 3)

    def test_loads_document_conversion_runtime_configuration(self):
        settings = load_settings(
            {
                "DOCUMENT_CONVERSION_ENABLED": "false",
                "DOCUMENT_CONVERSION_MAX_BYTES": "4096",
                "DOCUMENT_CONVERSION_WORKDIR": "D:\\tmp\\smart-design-conversion",
                "RVM_CONVERTER_COMMAND": "rvm-to-spark --input {input} --output {output}",
                "SPARK_BUILD_LOD_COMMAND": "spark-build-lod {input} {output}",
            }
        )

        self.assertFalse(settings.document_conversion.enabled)
        self.assertEqual(settings.document_conversion.max_bytes, 4096)
        self.assertEqual(settings.document_conversion.workdir, "D:\\tmp\\smart-design-conversion")
        self.assertEqual(settings.document_conversion.rvm_converter_command, "rvm-to-spark --input {input} --output {output}")
        self.assertEqual(settings.document_conversion.spark_build_lod_command, "spark-build-lod {input} {output}")

    def test_loads_plugin_runtime_configuration(self):
        settings = load_settings(
            {
                "SMART_DESIGN_PLUGIN_STORAGE_DIR": "D:\\smart-design\\plugins",
                "SMART_DESIGN_PLUGIN_HMAC_SECRET": "dev-secret",
            }
        )

        self.assertEqual(settings.plugin.storage_dir, "D:\\smart-design\\plugins")
        self.assertEqual(settings.plugin.hmac_secret, "dev-secret")


if __name__ == "__main__":
    unittest.main()
