"""Calendar / Google Meet adapter with an honest demo fallback."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta
from pathlib import Path

from sqlalchemy.orm import Session

from app.config import settings
from app.models import Meeting
from app.models.base import utcnow

logger = logging.getLogger("nexora.calendar")


def calendar_status() -> dict:
    configured = settings.google_calendar_configured
    credentials_exist = configured and Path(settings.google_application_credentials).is_file()
    return {
        "configured": bool(credentials_exist),
        "mode": "google" if credentials_exist else "demo",
        "calendar_id": settings.google_calendar_id,
        "note": (
            "Google Calendar credentials found. Meet links are only stored when the API returns one."
            if credentials_exist
            else "No Google service-account credentials. Meetings are proposed locally and require administrator confirmation; no Meet link is invented."
        ),
    }


def default_slot(now: datetime | None = None) -> tuple[datetime, datetime]:
    base = (now or utcnow()) + timedelta(days=2)
    # Next weekday at 10:00 UTC
    while base.weekday() >= 5:
        base += timedelta(days=1)
    start = base.replace(hour=10, minute=0, second=0, microsecond=0)
    return start, start + timedelta(minutes=45)


def _google_event(
    title: str, start: datetime, end: datetime, description: str, attendee_email: str
) -> tuple[str | None, str | None, str | None]:
    """Create a real Calendar event when credentials + libraries are present.

    Returns (event_id, meet_url, error). Never fabricates a link.
    """
    if not settings.google_calendar_configured:
        return None, None, "not_configured"
    path = Path(settings.google_application_credentials)
    if not path.is_file():
        return None, None, "credentials_file_missing"
    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build
    except Exception:
        return None, None, "google_libraries_missing"
    try:
        credentials = service_account.Credentials.from_service_account_file(
            str(path),
            scopes=["https://www.googleapis.com/auth/calendar"],
        )
        service = build("calendar", "v3", credentials=credentials, cache_discovery=False)
        request_id = uuid.uuid4().hex
        body = {
            "summary": title,
            "description": description,
            "start": {"dateTime": start.isoformat() + "Z", "timeZone": "UTC"},
            "end": {"dateTime": end.isoformat() + "Z", "timeZone": "UTC"},
            "attendees": [{"email": attendee_email}],
            "conferenceData": {
                "createRequest": {
                    "requestId": request_id,
                    "conferenceSolutionKey": {"type": "hangoutsMeet"},
                }
            },
        }
        event = (
            service.events()
            .insert(
                calendarId=settings.google_calendar_id,
                body=body,
                conferenceDataVersion=1,
                sendUpdates="all",
            )
            .execute()
        )
        return event.get("id"), event.get("hangoutLink"), None
    except Exception as exc:  # pragma: no cover - external
        logger.warning("Google Calendar event failed: %s", exc)
        return None, None, f"google_error:{str(exc)[:200]}"


def create_meeting(
    db: Session,
    *,
    organization_id: str,
    intern_id: str,
    intern_email: str,
    title: str,
    created_by: str | None,
    assignment_id: str | None = None,
    evaluation_id: str | None = None,
    start_at: datetime | None = None,
    end_at: datetime | None = None,
    timezone: str = "Asia/Kolkata",
    notes: str = "",
    request_meet: bool = True,
) -> Meeting:
    start, end = start_at, end_at
    if start is None or end is None:
        start, end = default_slot()
    meeting = Meeting(
        organization_id=organization_id,
        intern_id=intern_id,
        assignment_id=assignment_id,
        evaluation_id=evaluation_id,
        title=title,
        start_at=start,
        end_at=end,
        timezone=timezone,
        status="proposed",
        provider="demo",
        created_by=created_by,
        notes=notes,
    )
    if request_meet:
        event_id, meet_url, error = _google_event(
            title, start, end, notes or title, intern_email
        )
        if event_id:
            meeting.provider = "google"
            meeting.status = "scheduled"
            meeting.calendar_event_id = event_id
            meeting.meet_url = meet_url
            if not meet_url:
                meeting.notes = (notes + "\n" if notes else "") + (
                    "Calendar event created, but Google returned no Meet link."
                )
        else:
            meeting.provider = "demo"
            meeting.status = "proposed"
            meeting.notes = (notes + "\n" if notes else "") + (
                f"Awaiting confirmation. Calendar provider unavailable ({error})."
            )
    db.add(meeting)
    db.flush()
    return meeting


def meeting_ics(meeting: Meeting) -> str:
    start = meeting.start_at or utcnow()
    end = meeting.end_at or (start + timedelta(minutes=45))
    stamp = utcnow().strftime("%Y%m%dT%H%M%SZ")
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//NEXORA AI//InternFlow//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        f"UID:{meeting.id}@nexora.ai",
        f"DTSTAMP:{stamp}",
        f"DTSTART:{start.strftime('%Y%m%dT%H%M%S')}Z",
        f"DTEND:{end.strftime('%Y%m%dT%H%M%S')}Z",
        f"SUMMARY:{meeting.title.replace(chr(10), ' ')}",
        f"DESCRIPTION:{(meeting.notes or 'InternFlow review').replace(chr(10), ' ')[:800]}",
        "STATUS:TENTATIVE" if meeting.status != "scheduled" else "STATUS:CONFIRMED",
    ]
    if meeting.meet_url:
        lines.append(f"URL:{meeting.meet_url}")
    lines += ["END:VEVENT", "END:VCALENDAR", ""]
    return "\r\n".join(lines)
