"""Server-side opaque sessions and cookie helpers."""

from __future__ import annotations

from datetime import datetime

from fastapi import Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import Session as UserSession
from app.models import User, utcnow
from app.security.passwords import (
    expiry,
    hash_token,
    new_csrf_token,
    new_opaque_token,
    verify_password,
)

SESSION_COOKIE = "nexora_session"
CSRF_COOKIE = "nexora_csrf"
CSRF_HEADER = "X-CSRF-Token"


def create_session(db: Session, user: User, request: Request) -> tuple[UserSession, str]:
    token = new_opaque_token()
    record = UserSession(
        user_id=user.id,
        token_hash=hash_token(token),
        csrf_token=new_csrf_token(),
        user_agent=(request.headers.get("user-agent") or "")[:400],
        ip_address=(request.client.host if request.client else "")[:64],
        expires_at=expiry(hours=settings.session_ttl_hours),
    )
    db.add(record)
    db.flush()
    return record, token


def set_session_cookies(response: Response, token: str, csrf_token: str) -> None:
    max_age = settings.session_ttl_hours * 3600
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=max_age,
        httponly=True,
        secure=settings.is_production,
        samesite="lax",
        path="/",
    )
    response.set_cookie(
        CSRF_COOKIE,
        csrf_token,
        max_age=max_age,
        httponly=False,
        secure=settings.is_production,
        samesite="lax",
        path="/",
    )


def clear_session_cookies(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/")
    response.delete_cookie(CSRF_COOKIE, path="/")


def resolve_session(db: Session, token: str | None) -> UserSession | None:
    if not token:
        return None
    record = db.scalar(select(UserSession).where(UserSession.token_hash == hash_token(token)))
    if record is None:
        return None
    if record.revoked_at is not None:
        return None
    if record.expires_at <= utcnow():
        return None
    return record


def revoke_session(db: Session, session_id: str) -> None:
    record = db.get(UserSession, session_id)
    if record and record.revoked_at is None:
        record.revoked_at = utcnow()


def revoke_all_sessions(db: Session, user_id: str, except_id: str | None = None) -> int:
    records = db.scalars(
        select(UserSession).where(UserSession.user_id == user_id, UserSession.revoked_at.is_(None))
    ).all()
    count = 0
    for record in records:
        if except_id and record.id == except_id:
            continue
        record.revoked_at: datetime = utcnow()
        count += 1
    return count


def authenticate(db: Session, email: str, password: str) -> User | None:
    user = db.scalar(select(User).where(User.email == email.strip().lower()))
    if user is None or not user.is_active or user.deactivated_at is not None:
        return None
    if not verify_password(user.password_hash, password):
        return None
    return user
