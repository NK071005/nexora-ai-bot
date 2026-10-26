"""In-app notification endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import AuthContext, get_auth
from app.errors import not_found
from app.models import Notification, utcnow
from app.schemas.settings import (
    NotificationListOut,
    NotificationOut,
    UnreadCountOut,
)

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=NotificationListOut)
def list_notifications(
    unread_only: bool = False,
    limit: int = Query(default=30, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
) -> NotificationListOut:
    base = select(Notification).where(Notification.user_id == auth.user.id)
    if unread_only:
        base = base.where(Notification.read_at.is_(None))
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    unread = db.scalar(
        select(func.count(Notification.id)).where(
            Notification.user_id == auth.user.id, Notification.read_at.is_(None)
        )
    ) or 0
    items = db.scalars(
        base.order_by(Notification.created_at.desc()).limit(limit).offset(offset)
    ).all()
    return NotificationListOut(
        items=[NotificationOut.model_validate(item) for item in items],
        total=int(total),
        unread=int(unread),
        limit=limit,
        offset=offset,
    )


@router.get("/unread-count", response_model=UnreadCountOut)
def unread_count(
    auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)
) -> UnreadCountOut:
    count = db.scalar(
        select(func.count(Notification.id)).where(
            Notification.user_id == auth.user.id, Notification.read_at.is_(None)
        )
    ) or 0
    return UnreadCountOut(unread=int(count))


@router.post("/{notification_id}/read", response_model=NotificationOut)
def mark_read(
    notification_id: str,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
) -> NotificationOut:
    item = db.get(Notification, notification_id)
    if item is None or item.user_id != auth.user.id:
        raise not_found("Notification")
    if item.read_at is None:
        item.read_at = utcnow()
        db.commit()
    return NotificationOut.model_validate(item)


@router.post("/read-all")
def mark_all_read(
    auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)
) -> dict:
    items = db.scalars(
        select(Notification).where(
            Notification.user_id == auth.user.id, Notification.read_at.is_(None)
        )
    ).all()
    now = utcnow()
    for item in items:
        item.read_at = now
    db.commit()
    return {"ok": True, "updated": len(items)}


@router.delete("/{notification_id}")
def delete_notification(
    notification_id: str,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
) -> dict:
    item = db.get(Notification, notification_id)
    if item is None or item.user_id != auth.user.id:
        raise not_found("Notification")
    db.delete(item)
    db.commit()
    return {"ok": True, "message": "Notification removed."}
