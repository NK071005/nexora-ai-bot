"""FastAPI dependencies: authentication, organization context and roles."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.errors import forbidden, unauthorized
from app.models import Organization, OrganizationMembership, Session as UserSession, User, utcnow
from app.security.sessions import SESSION_COOKIE, resolve_session

ADMIN_ROLES = {"owner", "admin"}
INTERN_ROLES = {"intern"}
ALL_ROLES = {"owner", "admin", "member", "intern"}


@dataclass
class AuthContext:
    user: User
    session: UserSession
    db: Session


@dataclass
class OrgContext:
    organization: Organization
    membership: OrganizationMembership | None
    role: str
    is_super_admin: bool

    @property
    def is_admin(self) -> bool:
        return self.is_super_admin or self.role in ADMIN_ROLES

    @property
    def is_intern(self) -> bool:
        return self.role in INTERN_ROLES


def _load_auth(request: Request, db: Session) -> AuthContext:
    token = request.cookies.get(SESSION_COOKIE)
    session = resolve_session(db, token)
    if session is None:
        raise unauthorized("Your session has expired. Please sign in again.")
    user = db.get(User, session.user_id)
    if user is None or not user.is_active or user.deactivated_at is not None:
        raise unauthorized("This account is not active.")
    request.state.user_id = user.id
    request.state.organization_id = user.default_organization_id
    now = utcnow()
    if (now - session.last_seen_at) > timedelta(minutes=5):
        session.last_seen_at = now
        db.commit()
    return AuthContext(user=user, session=session, db=db)


def get_auth(request: Request, db: Session = Depends(get_db)) -> AuthContext:
    return _load_auth(request, db)


def get_current_user(auth: AuthContext = Depends(get_auth)) -> User:
    return auth.user


def get_optional_user(request: Request, db: Session = Depends(get_db)) -> User | None:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    session = resolve_session(db, token)
    if session is None:
        return None
    user = db.get(User, session.user_id)
    if user is None or not user.is_active:
        return None
    return user


def resolve_org_context(auth: AuthContext, request: Request) -> OrgContext:
    user = auth.user
    db = auth.db
    requested = request.headers.get("X-Organization-Id") or user.default_organization_id
    memberships = db.scalars(
        select(OrganizationMembership).where(
            OrganizationMembership.user_id == user.id,
            OrganizationMembership.status == "active",
        )
    ).all()
    membership: OrganizationMembership | None = None
    if requested:
        membership = next((m for m in memberships if m.organization_id == requested), None)
        if membership is None and not user.is_super_admin:
            raise forbidden("You do not have access to this organization.")
    elif memberships:
        membership = memberships[0]
    organization = (
        db.get(Organization, membership.organization_id)
        if membership
        else (db.get(Organization, requested) if requested else None)
    )
    if organization is None:
        raise forbidden("No organization context is available for this action.")
    role = "owner" if user.is_super_admin and membership is None else (membership.role if membership else "member")
    return OrgContext(
        organization=organization,
        membership=membership,
        role=role,
        is_super_admin=user.is_super_admin,
    )


def get_org_context(
    request: Request, auth: AuthContext = Depends(get_auth)
) -> OrgContext:
    ctx = resolve_org_context(auth, request)
    request.state.organization_id = ctx.organization.id
    return ctx


def require_org_roles(*roles: str):
    """Dependency factory enforcing organization-level role membership."""

    def _dependency(ctx: OrgContext = Depends(get_org_context)) -> OrgContext:
        if ctx.is_super_admin:
            return ctx
        if ctx.role not in roles:
            raise forbidden("This area is restricted to authorized organization administrators.")
        return ctx

    return _dependency


def require_admin_ctx(ctx: OrgContext = Depends(require_org_roles(*ADMIN_ROLES))) -> OrgContext:
    return ctx


def require_intern_ctx(ctx: OrgContext = Depends(require_org_roles("intern"))) -> OrgContext:
    return ctx


def get_org_member_for_user(db: Session, user_id: str, organization_id: str) -> OrganizationMembership | None:
    return db.scalar(
        select(OrganizationMembership).where(
            OrganizationMembership.user_id == user_id,
            OrganizationMembership.organization_id == organization_id,
            OrganizationMembership.status == "active",
        )
    )


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()[:64]
    return (request.client.host if request.client else "")[:64]
