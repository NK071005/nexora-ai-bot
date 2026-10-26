"""NEXORA AI configuration.

All settings come from environment variables / ``.env``. Optional third-party
credentials are never required to boot: adapters report ``configured: false``
and the UI labels demo behaviour explicitly.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BACKEND_DIR.parent

# Prefer a project-level .env, then backend/.env (first existing wins).
for candidate in (PROJECT_ROOT / ".env", BACKEND_DIR / ".env"):
    if candidate.exists():
        load_dotenv(candidate)
        break
else:
    load_dotenv()


def _bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    app_name: str = "NEXORA AI"
    app_env: str = os.getenv("APP_ENV", "development").lower()
    app_base_url: str = os.getenv("APP_BASE_URL", "http://localhost:8000").rstrip("/")
    frontend_url: str = os.getenv("FRONTEND_URL", "http://localhost:5173").rstrip("/")
    secret_key: str = os.getenv("SECRET_KEY", "dev-only-change-me-nexora-0123456789abcdef")

    database_url: str = os.getenv("DATABASE_URL", f"sqlite:///{(BACKEND_DIR / 'nexora.db').as_posix()}")

    # AI
    openai_api_key: str = os.getenv("OPENAI_API_KEY", "").strip()
    openai_model: str = os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip()
    image_generation_model: str = os.getenv("IMAGE_GENERATION_MODEL", "").strip()
    transcription_model: str = os.getenv("TRANSCRIPTION_MODEL", "whisper-1").strip()

    # Google
    google_client_id: str = os.getenv("GOOGLE_CLIENT_ID", "").strip()
    google_client_secret: str = os.getenv("GOOGLE_CLIENT_SECRET", "").strip()
    google_redirect_uri: str = os.getenv(
        "GOOGLE_REDIRECT_URI", "http://localhost:8000/api/auth/google/callback"
    ).strip()
    google_application_credentials: str = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
    google_calendar_id: str = os.getenv("GOOGLE_CALENDAR_ID", "primary").strip()
    google_sheets_spreadsheet_id: str = os.getenv("GOOGLE_SHEETS_SPREADSHEET_ID", "").strip()

    # Email
    gmail_sender_email: str = os.getenv("GMAIL_SENDER_EMAIL", "").strip()
    smtp_host: str = os.getenv("SMTP_HOST", "").strip()
    smtp_port: int = _int("SMTP_PORT", 587)
    smtp_username: str = os.getenv("SMTP_USERNAME", "").strip()
    smtp_password: str = os.getenv("SMTP_PASSWORD", "")
    smtp_use_tls: bool = _bool("SMTP_USE_TLS", True)

    # Search
    search_provider: str = os.getenv("SEARCH_PROVIDER", "tavily").strip().lower()
    search_provider_api_key: str = os.getenv("SEARCH_PROVIDER_API_KEY", "").strip()

    redis_url: str = os.getenv("REDIS_URL", "").strip()

    # Storage
    storage_provider: str = os.getenv("STORAGE_PROVIDER", "local").strip().lower()
    storage_dir: Path = field(
        default_factory=lambda: Path(
            os.getenv("STORAGE_DIR", str(PROJECT_ROOT / "storage"))
        ).resolve()
    )
    max_upload_size_mb: int = _int("MAX_UPLOAD_SIZE_MB", 20)
    default_timezone: str = os.getenv("DEFAULT_TIMEZONE", "Asia/Kolkata").strip()

    session_ttl_hours: int = _int("SESSION_TTL_HOURS", 24 * 7)
    activation_ttl_hours: int = _int("ACTIVATION_TTL_HOURS", 72)
    reset_ttl_minutes: int = _int("RESET_TTL_MINUTES", 60)

    scheduler_enabled: bool = _bool("SCHEDULER_ENABLED", True)
    scheduler_interval_seconds: int = _int("SCHEDULER_INTERVAL_SECONDS", 15)
    require_email_verification: bool = _bool("REQUIRE_EMAIL_VERIFICATION", False)
    allow_demo_login: bool = _bool("ALLOW_DEMO_LOGIN", True)

    @property
    def is_production(self) -> bool:
        return self.app_env in {"production", "prod"}

    @property
    def is_test(self) -> bool:
        return self.app_env in {"test", "testing"} or bool(os.getenv("NEXORA_TESTING"))

    @property
    def ai_configured(self) -> bool:
        return bool(self.openai_api_key)

    @property
    def image_generation_configured(self) -> bool:
        return bool(self.openai_api_key and self.image_generation_model)

    @property
    def transcription_configured(self) -> bool:
        return bool(self.openai_api_key and self.transcription_model)

    @property
    def search_configured(self) -> bool:
        return bool(self.search_provider_api_key)

    @property
    def google_oauth_configured(self) -> bool:
        return bool(self.google_client_id and self.google_client_secret)

    @property
    def google_calendar_configured(self) -> bool:
        return bool(self.google_application_credentials)

    @property
    def email_configured(self) -> bool:
        return bool(self.smtp_host and self.smtp_username and self.smtp_password)

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_size_mb * 1024 * 1024


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
