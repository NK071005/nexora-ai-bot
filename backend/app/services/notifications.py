"""Audit logging and in-app notifications."""

from __future__ import annotations

from fastapi import Request
from sqlalchemy.orm import Session

from app.models import AuditLog, Notification


def audit(
    db: Session,
    *,
    actor_id: str | None,
    action: str,
    entity_type: str,
    entity_id: str | None = None,
    organization_id: str | None = None,
    metadata: dict | None = None,
    request: Request | None = None,
) -> AuditLog:
    entry = AuditLog(
        actor_id=actor_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        organization_id=organization_id,
        metadata_json=metadata or {},
        ip_address=(
            (request.client.host if request and request.client else "")[:64] if request else ""
        ),
    )
    db.add(entry)
    return entry


def notify(
    db: Session,
    *,
    user_id: str,
    title: str,
    body: str = "",
    kind: str = "system",
    link: str | None = None,
    organization_id: str | None = None,
) -> Notification:
    item = Notification(
        user_id=user_id,
        title=title[:240],
        body=body,
        kind=kind,
        link=link,
        organization_id=organization_id,
    )
    db.add(item)
    return item


def notify_many(
    db: Session,
    user_ids: list[str],
    *,
    title: str,
    body: str = "",
    kind: str = "system",
    link: str | None = None,
    organization_id: str | None = None,
) -> list[Notification]:
    seen: set[str] = set()
    created: list[Notification] = []
    for uid in user_ids:
        if not uid or uid in seen:
            continue
        seen.add(uid)
        created.append(
            notify(
                db,
                user_id=uid,
                title=title,
                body=body,
                kind=kind,
                link=link,
                organization_id=organization_id,
            )
        )
    return created


def org_admin_user_ids(db: Session, organization_id: str) -> list[str]:
    from sqlalchemy import select

    from app.models import OrganizationMembership

    rows = db.scalars(
        select(OrganizationMembership).where(
            OrganizationMembership.organization_id == organization_id,
            OrganizationMembership.role.in_(["owner", "admin"]),
            OrganizationMembership.status == "active",
        )
    ).all()
    return [row.user_id for row in rows]


def intern_user_id(intern) -> str | None:
    return getattr(intern, "user_id", None)
