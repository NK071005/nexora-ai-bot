"""Capability reporting shared by auth, settings and health endpoints."""

from __future__ import annotations

import shutil
from pathlib import Path

from app.config import settings
from app.services.ai import provider_capabilities
from app.services.calendar import calendar_status
from app.services.email import email_status


def _storage_status() -> dict:
    root: Path = settings.storage_dir
    try:
        root.mkdir(parents=True, exist_ok=True)
        writable = True
        probe = root / ".write-probe"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink(missing_ok=True)
    except Exception:
        writable = False
    return {
        "provider": settings.storage_provider,
        "configured": writable,
        "mode": "local",
        "path": str(root),
        "max_upload_mb": settings.max_upload_size_mb,
        "note": "Local disk storage. Files are isolated by organization and user.",
    }


def _search_status() -> dict:
    return {
        "configured": settings.search_configured,
        "provider": settings.search_provider if settings.search_configured else "none",
        "mode": "live" if settings.search_configured else "unconfigured",
        "note": (
            f"Live {settings.search_provider} search is active."
            if settings.search_configured
            else "Set SEARCH_PROVIDER_API_KEY and SEARCH_PROVIDER to enable live web search."
        ),
    }


def _video_status() -> dict:
    ffmpeg = shutil.which("ffmpeg")
    return {
        "configured": bool(ffmpeg),
        "ffmpeg": ffmpeg or None,
        "mode": "ffmpeg" if ffmpeg else "unavailable",
        "note": (
            "FFmpeg found; video probing and frame extraction can run."
            if ffmpeg
            else "FFmpeg is not installed. Video uploads are stored, but frame extraction and transcoding are unavailable."
        ),
    }


def auth_capabilities() -> dict:
    ai = provider_capabilities()
    calendar = calendar_status()
    email = email_status()
    return {
        "ai": {
            "provider": ai["provider"],
            "label": ai["label"],
            "model": ai["model"],
            "demo": ai["demo"],
            "configured": settings.ai_configured,
            "capabilities": ai["capabilities"],
            "notes": ai["notes"],
        },
        "search": _search_status(),
        "email": email,
        "calendar": calendar,
        "google_oauth": settings.google_oauth_configured,
        "storage": _storage_status(),
    }


def integration_rows() -> list[dict]:
    ai = provider_capabilities()
    calendar = calendar_status()
    email = email_status()
    video = _video_status()
    return [
        {
            "provider": "openai",
            "label": "OpenAI (chat, vision, transcription, images)",
            "category": "AI",
            "configured": settings.ai_configured,
            "mode": "openai" if settings.ai_configured else "demo",
            "status": "connected" if settings.ai_configured else "demo",
            "note": (
                f"Using {settings.openai_model}."
                if settings.ai_configured
                else "Demo Intelligence is active. Answers are extractive and clearly labeled; no model calls are made."
            ),
            "required_env": ["OPENAI_API_KEY"],
        },
        {
            "provider": "search",
            "label": "Web search (Tavily / Serper)",
            "category": "Research",
            "configured": settings.search_configured,
            "mode": "live" if settings.search_configured else "unconfigured",
            "status": "connected" if settings.search_configured else "not_connected",
            "note": _search_status()["note"],
            "required_env": ["SEARCH_PROVIDER", "SEARCH_PROVIDER_API_KEY"],
        },
        {
            "provider": "smtp",
            "label": "Email delivery",
            "category": "Communication",
            "configured": settings.email_configured,
            "mode": email["mode"],
            "status": "connected" if settings.email_configured else "demo",
            "note": email["note"],
            "required_env": ["SMTP_HOST", "SMTP_PORT", "SMTP_USERNAME", "SMTP_PASSWORD", "GMAIL_SENDER_EMAIL"],
        },
        {
            "provider": "google_calendar",
            "label": "Google Calendar / Meet",
            "category": "Scheduling",
            "configured": calendar["configured"],
            "mode": calendar["mode"],
            "status": "connected" if calendar["configured"] else "demo",
            "note": calendar["note"],
            "required_env": ["GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_CALENDAR_ID"],
        },
        {
            "provider": "google_oauth",
            "label": "Google sign-in",
            "category": "Identity",
            "configured": settings.google_oauth_configured,
            "mode": "oauth" if settings.google_oauth_configured else "unconfigured",
            "status": "connected" if settings.google_oauth_configured else "not_connected",
            "note": (
                "Google OAuth is configured."
                if settings.google_oauth_configured
                else "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable Google sign-in."
            ),
            "required_env": ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
        },
        {
            "provider": "ffmpeg",
            "label": "Video processing",
            "category": "Media",
            "configured": video["configured"],
            "mode": video["mode"],
            "status": "connected" if video["configured"] else "not_connected",
            "note": video["note"],
            "required_env": ["FFMPEG_PATH (or ffmpeg on PATH)"],
        },
    ]


def config_status() -> dict:
    ai = provider_capabilities()
    return {
        "app": {
            "name": settings.app_name,
            "environment": settings.app_env,
            "base_url": settings.app_base_url,
            "frontend_url": settings.frontend_url,
            "timezone": settings.default_timezone,
            "require_email_verification": settings.require_email_verification,
        },
        "ai": ai,
        "search": _search_status(),
        "email": email_status(),
        "calendar": calendar_status(),
        "google_oauth": {
            "configured": settings.google_oauth_configured,
            "redirect_uri": settings.google_redirect_uri,
            "mode": "oauth" if settings.google_oauth_configured else "unconfigured",
        },
        "storage": _storage_status(),
        "scheduler": {
            "enabled": settings.scheduler_enabled,
            "interval_seconds": settings.scheduler_interval_seconds,
            "mode": "database-thread",
        },
        "video": _video_status(),
        "integrations": integration_rows(),
    }
