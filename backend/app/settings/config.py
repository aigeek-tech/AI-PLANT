from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
from typing import Mapping


LOCAL_DATABASE_URL = "postgresql://postgres:postgres@localhost:55432/smart_design"
LOCAL_ALLOWED_ORIGINS = ("http://localhost:5173", "http://127.0.0.1:5173")
LOCAL_S3_ENDPOINT = "http://127.0.0.1:9000"
LOCAL_S3_BUCKET = "smart-design-documents"
LOCAL_S3_ACCESS_KEY = "minioadmin"
LOCAL_S3_SECRET_KEY = "minioadmin"
PRODUCTION_ENVIRONMENTS = {"prod", "production"}


@dataclass(frozen=True)
class DocumentStorageSettings:
    endpoint: str
    region: str
    bucket: str
    access_key: str
    secret_key: str
    presign_ttl_seconds: int
    key_prefix: str
    preview_endpoint: str | None


@dataclass(frozen=True)
class AgentSettings:
    claw_executable_path: str | None
    max_global_concurrency: int
    max_user_concurrency: int
    job_timeout_seconds: int


@dataclass(frozen=True)
class DocumentConversionSettings:
    enabled: bool
    max_bytes: int
    workdir: str
    rvm_converter_command: str | None
    spark_build_lod_command: str | None


@dataclass(frozen=True)
class PluginSettings:
    storage_dir: str
    hmac_secret: str | None
    max_package_bytes: int


@dataclass(frozen=True)
class AppSettings:
    environment: str
    database_url: str
    allowed_origins: list[str]
    document_storage: DocumentStorageSettings
    agent: AgentSettings
    document_conversion: DocumentConversionSettings
    plugin: PluginSettings

    @property
    def is_production(self) -> bool:
        return self.environment.lower() in PRODUCTION_ENVIRONMENTS


def _read_env(env: Mapping[str, str], name: str) -> str:
    return (env.get(name) or "").strip()


def _first_env(env: Mapping[str, str], names: tuple[str, ...]) -> str:
    for name in names:
        value = _read_env(env, name)
        if value:
            return value
    return ""


def _is_local_minio_endpoint(endpoint: str) -> bool:
    normalized = endpoint.strip().lower()
    return normalized.startswith("http://127.0.0.1:9000") or normalized.startswith("http://localhost:9000")


def _normalize_preview_endpoint(endpoint: str, *, is_production: bool) -> str:
    if not is_production and endpoint.strip().lower().startswith("http://host.docker.internal:9000"):
        return LOCAL_S3_ENDPOINT
    return endpoint


def _parse_allowed_origins(raw_value: str, *, is_production: bool, missing: list[str]) -> list[str]:
    if raw_value:
        return [origin.strip().rstrip("/") for origin in raw_value.split(",") if origin.strip()]
    if is_production:
        missing.append("SMART_DESIGN_ALLOWED_ORIGINS")
        return []
    return list(LOCAL_ALLOWED_ORIGINS)


def _parse_int_setting(env: Mapping[str, str], name: str, *, default: int, minimum: int) -> int:
    raw_value = _read_env(env, name)
    if not raw_value:
        return default
    try:
        return max(minimum, int(raw_value))
    except ValueError as error:
        raise RuntimeError(f"{name} must be an integer") from error


def _parse_bool_setting(env: Mapping[str, str], name: str, *, default: bool) -> bool:
    raw_value = _read_env(env, name).lower()
    if not raw_value:
        return default
    if raw_value in {"1", "true", "yes", "on"}:
        return True
    if raw_value in {"0", "false", "no", "off"}:
        return False
    raise RuntimeError(f"{name} must be a boolean")


def _default_env_file() -> Path:
    return Path(__file__).resolve().parents[2] / ".env"


def _read_env_file(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}

    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, raw_value = line.split("=", 1)
        key = key.strip()
        value = raw_value.strip()
        if not key:
            continue
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        values[key] = value
    return values


def _settings_source(env: Mapping[str, str] | None, env_file: Path | None) -> Mapping[str, str]:
    if env is None:
        file_values = _read_env_file(env_file or _default_env_file())
        return {**file_values, **os.environ}
    if env_file is not None:
        return {**_read_env_file(env_file), **env}
    return env


def load_settings(env: Mapping[str, str] | None = None, *, env_file: Path | None = None) -> AppSettings:
    source = _settings_source(env, env_file)
    environment = _first_env(source, ("SMART_DESIGN_ENV", "APP_ENV")) or "development"
    is_production = environment.lower() in PRODUCTION_ENVIRONMENTS
    missing: list[str] = []

    database_url = _read_env(source, "DATABASE_URL")
    if not database_url:
        if is_production:
            missing.append("DATABASE_URL")
        database_url = LOCAL_DATABASE_URL

    allowed_origins = _parse_allowed_origins(
        _read_env(source, "SMART_DESIGN_ALLOWED_ORIGINS"),
        is_production=is_production,
        missing=missing,
    )

    s3_endpoint = _read_env(source, "S3_ENDPOINT")
    if not s3_endpoint:
        if is_production:
            missing.append("S3_ENDPOINT")
        s3_endpoint = LOCAL_S3_ENDPOINT

    s3_bucket = _read_env(source, "S3_BUCKET")
    if not s3_bucket:
        if is_production:
            missing.append("S3_BUCKET")
        s3_bucket = LOCAL_S3_BUCKET

    s3_access_key = _first_env(source, ("S3_ACCESS_KEY", "AWS_ACCESS_KEY_ID", "MINIO_ROOT_USER"))
    s3_secret_key = _first_env(source, ("S3_SECRET_KEY", "AWS_SECRET_ACCESS_KEY", "MINIO_ROOT_PASSWORD"))
    if _is_local_minio_endpoint(s3_endpoint) and not is_production:
        s3_access_key = s3_access_key or LOCAL_S3_ACCESS_KEY
        s3_secret_key = s3_secret_key or LOCAL_S3_SECRET_KEY
    if not s3_access_key and is_production:
        missing.append("S3_ACCESS_KEY")
    if not s3_secret_key and is_production:
        missing.append("S3_SECRET_KEY")

    if missing:
        unique_missing = ", ".join(sorted(set(missing)))
        raise RuntimeError(f"Missing required production configuration: {unique_missing}")

    preview_endpoint = _read_env(source, "S3_PREVIEW_ENDPOINT")

    document_storage = DocumentStorageSettings(
        endpoint=s3_endpoint,
        region=_read_env(source, "S3_REGION") or "us-east-1",
        bucket=s3_bucket,
        access_key=s3_access_key,
        secret_key=s3_secret_key,
        presign_ttl_seconds=_parse_int_setting(
            source,
            "S3_PRESIGN_TTL_SECONDS",
            default=900,
            minimum=60,
        ),
        key_prefix=_read_env(source, "S3_KEY_PREFIX").strip("/"),
        preview_endpoint=_normalize_preview_endpoint(preview_endpoint, is_production=is_production) if preview_endpoint else None,
    )
    agent = AgentSettings(
        claw_executable_path=_read_env(source, "CLAW_EXECUTABLE_PATH") or None,
        max_global_concurrency=_parse_int_setting(
            source,
            "AGENT_MAX_GLOBAL_CONCURRENCY",
            default=4,
            minimum=1,
        ),
        max_user_concurrency=_parse_int_setting(
            source,
            "AGENT_MAX_USER_CONCURRENCY",
            default=1,
            minimum=1,
        ),
        job_timeout_seconds=_parse_int_setting(
            source,
            "AGENT_JOB_TIMEOUT_SECONDS",
            default=900,
            minimum=30,
        ),
    )
    document_conversion = DocumentConversionSettings(
        enabled=_parse_bool_setting(source, "DOCUMENT_CONVERSION_ENABLED", default=True),
        max_bytes=_parse_int_setting(
            source,
            "DOCUMENT_CONVERSION_MAX_BYTES",
            default=500 * 1024 * 1024,
            minimum=1,
        ),
        workdir=_read_env(source, "DOCUMENT_CONVERSION_WORKDIR")
        or str(Path(os.getenv("TEMP") or "/tmp") / "smart-design-document-conversion"),
        rvm_converter_command=_read_env(source, "RVM_CONVERTER_COMMAND") or None,
        spark_build_lod_command=_read_env(source, "SPARK_BUILD_LOD_COMMAND") or None,
    )
    plugin = PluginSettings(
        storage_dir=_read_env(source, "SMART_DESIGN_PLUGIN_STORAGE_DIR")
        or str(Path(os.getenv("LOCALAPPDATA") or os.getenv("TEMP") or "/tmp") / "smart-design" / "plugins"),
        hmac_secret=_read_env(source, "SMART_DESIGN_PLUGIN_HMAC_SECRET") or None,
        max_package_bytes=_parse_int_setting(
            source,
            "SMART_DESIGN_PLUGIN_MAX_PACKAGE_BYTES",
            default=50 * 1024 * 1024,
            minimum=1,
        ),
    )
    return AppSettings(
        environment=environment,
        database_url=database_url,
        allowed_origins=allowed_origins,
        document_storage=document_storage,
        agent=agent,
        document_conversion=document_conversion,
        plugin=plugin,
    )


def get_settings() -> AppSettings:
    return load_settings()
