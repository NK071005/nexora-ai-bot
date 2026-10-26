"""Super-admin endpoints: cross-tenant overview with strict role gating."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import AuthContext, get_auth
from app.errors import forbidden, not_found
from app.models import (
    ChatSession,
    InternProfile,
    Organization,
    OrganizationMembership,
    ScheduledTask,
    User,
    utcnow,
)

router = APIRouter(prefix="/admin", tags=["admin"])


def require_super_admin(auth: AuthContext = Depends(get_auth)) -> AuthContext:
    if not auth.user.is_super_admin:
        raise forbidden("This area is restricted to NEXORA super administrators.")
    return auth


@router.get("/overview")
def overview(
    auth: AuthContext = Depends(require_super_admin), db: Session = Depends(get_db)
) -> dict:
    return {
        "organizations": int(db.scalar(select(func.count(Organization.id))) or 0),
        "users": int(db.scalar(select(func.count(User.id))) or 0),
        "active_users": int(
            db.scalar(select(func.count(User.id)).where(User.is_active.is_(True))) or 0
        ),
        "interns": int(db.scalar(select(func.count(InternProfile.id))) or 0),
        "chats": int(
            db.scalar(select(func.count(ChatSession.id)).where(ChatSession.deleted_at.is_(None)))
            or 0
        ),
        "scheduled_tasks": int(
            db.scalar(
                select(func.count(ScheduledTask.id)).where(ScheduledTask.deleted_at.is_(None))
            )
            or 0
        ),
        "you": {"id": auth.user.id, "email": auth.user.email},
    }


@router.get("/organizations")
def list_organizations(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    _: AuthContext = Depends(require_super_admin),
    db: Session = Depends(get_db),
) -> list[dict]:
    organizations = db.scalars(
        select(Organization).order_by(Organization.created_at.desc()).limit(limit).offset(offset)
    ).all()
    output = []
    for organization in organizations:
        members = db.scalar(
            select(func.count(OrganizationMembership.id)).where(
                OrganizationMembership.organization_id == organization.id,
                OrganizationMembership.status == "active",
            )
        ) or 0
        interns = db.scalar(
            select(func.count(InternProfile.id)).where(
                InternProfile.organization_id == organization.id
            )
        ) or 0
        output.append(
            {
                "id": organization.id,
                "name": organization.name,
                "slug": organization.slug,
                "kind": organization.kind,
                "members": int(members),
                "interns": int(interns),
                "created_at": organization.created_at.isoformat() + "Z",
            }
        )
    return output


@router.get("/users")
def list_users(
    q: str | None = Query(default=None, max_length=200),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    _: AuthContext = Depends(require_super_admin),
    db: Session = Depends(get_db),
) -> list[dict]:
    stmt = select(User)
    if q:
        pattern = f"%{q.strip()}%"
        stmt = stmt.where(User.email.ilike(pattern) | User.full_name.ilike(pattern))
    users = db.scalars(
        stmt.order_by(User.created_at.desc()).limit(limit).offset(offset)
    ).all()
    output = []
    for user in users:
        memberships = db.execute(
            select(OrganizationMembership, Organization)
            .join(Organization, OrganizationMembership.organization_id == Organization.id)
            .where(OrganizationMembership.user_id == user.id)
        ).all()
        output.append(
            {
                "id": user.id,
                "email": user.email,
                "full_name": user.full_name,
                "is_active": user.is_active,
                "is_super_admin": user.is_super_admin,
                "email_verified": user.email_verified_at is not None,
                "last_login_at": (user.last_login_at.isoformat() + "Z") if user.last_login_at else None,
                "organizations": [
                    {
                        "id": organization.id,
                        "name": organization.name,
                        "role": membership.role,
                        "status": membership.status,
                    }
                    for membership, organization in memberships
                ],
            }
        )
    return output


@router.post("/users/{user_id}/toggle-active")
def toggle_user(
    user_id: str,
    auth: AuthContext = Depends(require_super_admin),
    db: Session = Depends(get_db),
) -> dict:
    user = db.get(User, user_id)
    if user is None:
        raise not_found("User")
    if user.id == auth.user.id:
        raise forbidden("You cannot deactivate your own account here.")
    user.is_active = not user.is_active
    user.deactivated_at = None if user.is_active else utcnow()
    db.commit()
    return {
        "ok": True,
        "user_id": user.id,
        "is_active": user.is_active,
        "message": "Account reactivated." if user.is_active else "Account deactivated.",
    }
