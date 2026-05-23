from __future__ import annotations

from base64 import urlsafe_b64encode
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import os
import secrets


PASSWORD_HASH_SCHEME = "pbkdf2_sha256"
PASSWORD_ITERATIONS = 600_000
SESSION_COOKIE_NAME = "smart_design_session"


@dataclass(frozen=True)
class SessionCookieSettings:
    name: str
    secure: bool
    httponly: bool
    samesite: str
    max_age_seconds: int
    path: str = "/"


def _env_flag(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def get_session_ttl() -> timedelta:
    days = int(os.getenv("SMART_DESIGN_SESSION_DAYS", "7"))
    return timedelta(days=max(1, days))


def get_session_cookie_settings() -> SessionCookieSettings:
    return SessionCookieSettings(
        name=os.getenv("SMART_DESIGN_SESSION_COOKIE_NAME", SESSION_COOKIE_NAME),
        secure=_env_flag("SMART_DESIGN_COOKIE_SECURE", False),
        httponly=True,
        samesite=os.getenv("SMART_DESIGN_COOKIE_SAMESITE", "lax").strip().lower() or "lax",
        max_age_seconds=int(get_session_ttl().total_seconds()),
    )


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _random_token(byte_length: int = 32) -> str:
    return urlsafe_b64encode(secrets.token_bytes(byte_length)).decode("ascii").rstrip("=")


def generate_session_token() -> str:
    return _random_token(32)


def hash_session_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def hash_password(password: str) -> str:
    salt = _random_token(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        PASSWORD_ITERATIONS,
    )
    return f"{PASSWORD_HASH_SCHEME}${PASSWORD_ITERATIONS}${salt}${digest.hex()}"


def verify_password(password: str, password_hash: str) -> bool:
    try:
        scheme, iteration_text, salt, digest_hex = password_hash.split("$", 3)
    except ValueError:
        return False

    if scheme != PASSWORD_HASH_SCHEME:
        return False

    try:
        iterations = int(iteration_text)
    except ValueError:
        return False

    candidate = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        iterations,
    ).hex()
    return hmac.compare_digest(candidate, digest_hex)

