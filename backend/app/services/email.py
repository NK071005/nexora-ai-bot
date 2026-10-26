"""Email delivery with an explicit demo transport.

When SMTP is not configured, emails are recorded with ``status='demo'`` and
``provider='demo'`` — never marked as sent. This makes the demo workflow
inspectable without claiming an external action happened.
"""

from __future__ import annotations

import html
import smtplib
from dataclasses import dataclass
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from sqlalchemy.orm import Session

from app.config import settings
from app.models import EmailLog
from app.models.base import utcnow


@dataclass
class OutgoingEmail:
    to_email: str
    subject: str
    body_text: str
    body_html: str
    kind: str = "general"
    related_type: str | None = None
    related_id: str | None = None


def send_email(db: Session, email: OutgoingEmail, organization_id: str | None = None) -> EmailLog:
    log = EmailLog(
        organization_id=organization_id,
        to_email=email.to_email,
        subject=email.subject[:300],
        body_text=email.body_text,
        body_html=email.body_html,
        kind=email.kind,
        related_type=email.related_type,
        related_id=email.related_id,
        provider="smtp" if settings.email_configured else "demo",
        status="queued",
    )
    db.add(log)
    db.flush()

    if not settings.email_configured:
        log.status = "demo"
        log.sent_at = None
        db.flush()
        return log

    message = MIMEMultipart("alternative")
    message["Subject"] = email.subject
    message["From"] = settings.gmail_sender_email or settings.smtp_username
    message["To"] = email.to_email
    message.attach(MIMEText(email.body_text, "plain", "utf-8"))
    message.attach(MIMEText(email.body_html, "html", "utf-8"))
    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=25) as server:
            if settings.smtp_use_tls:
                server.starttls()
            server.login(settings.smtp_username, settings.smtp_password)
            server.sendmail(
                settings.gmail_sender_email or settings.smtp_username,
                [email.to_email],
                message.as_string(),
            )
        log.status = "sent"
        log.sent_at = utcnow()
    except Exception as exc:
        log.status = "failed"
        log.error = str(exc)[:400]
    db.flush()
    return log


def email_status() -> dict:
    return {
        "configured": settings.email_configured,
        "mode": "smtp" if settings.email_configured else "demo",
        "sender": settings.gmail_sender_email or settings.smtp_username or "demo@nexora.local",
        "note": (
            "SMTP credentials are configured."
            if settings.email_configured
            else "Demo transport: messages are stored in the email log with status 'demo'. No email leaves this machine."
        ),
    }


def render_branded_email(heading: str, intro: str, blocks: list[tuple[str, str]], footer: str = "") -> str:
    """Minimal, original NEXORA email layout using inline styles."""
    escaped_heading = html.escape(heading)
    escaped_intro = html.escape(intro)
    block_html = ""
    for title, body in blocks:
        block_html += (
            f'<div style="margin:0 0 18px;padding:16px 18px;border:1px solid #e2e6ee;'
            f'border-radius:12px;background:#fbfcff;">'
            f'<div style="font:600 12px/1.4 Arial,sans-serif;letter-spacing:.08em;'
            f'text-transform:uppercase;color:#5b6780;margin-bottom:6px;">{html.escape(title)}</div>'
            f'<div style="font:14px/1.65 Arial,sans-serif;color:#1b2436;white-space:pre-line;">'
            f"{html.escape(body)}</div></div>"
        )
    return f"""<!doctype html>
<html><body style="margin:0;background:#f4f6fb;padding:28px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center">
<table role="presentation" width="620" cellpadding="0" cellspacing="0"
 style="max-width:620px;background:#ffffff;border:1px solid #e2e6ee;border-radius:16px;overflow:hidden;">
<tr><td style="padding:22px 28px;background:#0b1424;">
  <span style="font:700 18px/1 Arial,sans-serif;letter-spacing:.16em;color:#ffffff;">NEXORA</span>
  <span style="font:600 10px/1 Arial,sans-serif;letter-spacing:.18em;color:#8fb3ff;margin-left:8px;">INTERNFLOW</span>
</td></tr>
<tr><td style="padding:30px 28px 8px;">
  <h1 style="margin:0 0 10px;font:600 22px/1.3 Arial,sans-serif;color:#101828;">{escaped_heading}</h1>
  <p style="margin:0 0 22px;font:14px/1.7 Arial,sans-serif;color:#475467;">{escaped_intro}</p>
  {block_html}
  <p style="margin:18px 0 0;font:12px/1.6 Arial,sans-serif;color:#667085;">{html.escape(footer)}</p>
</td></tr>
<tr><td style="padding:18px 28px 26px;border-top:1px solid #eef1f6;">
  <p style="margin:0;font:11px/1.6 Arial,sans-serif;color:#98a2b3;">
    Sent by NEXORA AI on behalf of your organization. If you were not expecting this message,
    you can ignore it. Activation links expire and are single-use.
  </p>
</td></tr>
</table>
</td></tr></table>
</body></html>"""
