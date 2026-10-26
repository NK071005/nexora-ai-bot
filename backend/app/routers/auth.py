"""Authentication, profile, sessions and Google OAuth endpoints."""

from __future__ import annotations

import logging
import re
import secrets
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.deps import AuthContext, get_auth, get_current_user
from app.errors import AppError, bad_request, conflict, unauthorized
from app.models import (
    AccountActivationToken,
    OAuthAccount,
    Organization,
    OrganizationMembership,
    PasswordResetToken,
    Session as UserSession,
    User,
    UserProfile,
    utcnow,
)
from app.schemas.auth import (
    ActivationResult,
    ActivateRequest,
    ChangePasswordRequest,
    DeactivateAccountRequest,
    ForgotPasswordRequest,
    ForgotResponse,
    LoginRequest,
    MeResponse,
    MessageOut,
    ProfileUpdateRequest,
    RegisterRequest,
    ResetPasswordRequest,
    SessionOut,
    SettingsUpdateRequest,
)
from app.security.passwords import (
    hash_password,
    hash_token,
    new_opaque_token,
    password_problems,
    verify_password,
)
from app.security.sessions import (
    SESSION_COOKIE,
    authenticate,
    clear_session_cookies,
    create_session,
    revoke_all_sessions,
    revoke_session,
    set_session_cookies,
)
from app.services import notifications
from app.services.capabilities import auth_capabilities
from app.services.email import OutgoingEmail, send_email

logger = logging.getLogger("nexora.auth")
router = APIRouter(prefix="/auth", tags=["auth"])

OAUTH_STATE_COOKIE = "nexora_oauth_state"


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")
    return (slug or "workspace")[:100]


def _unique_slug(db: Session, name: str) -> str:
    base = _slugify(name)
    candidate = base
    index = 2
    while db.scalar(select(Organization.id).where(Organization.slug == candidate)):
        candidate = f"{base}-{index}"
        index += 1
    return candidate


def _membership_rows(db: Session, user: User) -> list[dict]:
    rows = db.execute(
        select(OrganizationMembership, Organization)
        .join(Organization, OrganizationMembership.organization_id == Organization.id)
        .where(
            OrganizationMembership.user_id == user.id,
            OrganizationMembership.status == "active",
        )
        .order_by(Organization.name)
    ).all()
    return [
        {
            "organization_id": org.id,
            "organization_name": org.name,
            "organization_slug": org.slug,
            "role": membership.role,
            "status": membership.status,
        }
        for membership, org in rows
    ]


def _is_internflow_admin(db: Session, user: User, organization_id: str | None) -> bool:
    if user.is_super_admin:
        return True
    if not organization_id:
        return False
    membership = db.scalar(
        select(OrganizationMembership).where(
            OrganizationMembership.user_id == user.id,
            OrganizationMembership.organization_id == organization_id,
            OrganizationMembership.status == "active",
        )
    )
    return bool(membership and membership.role in {"owner", "admin"})


def build_me(db: Session, user: User, organization_id: str | None = None) -> MeResponse:
    memberships = _membership_rows(db, user)
    active_id = organization_id or user.default_organization_id
    if active_id and not any(m["organization_id"] == active_id for m in memberships):
        active_id = None
    if not active_id and memberships:
        active_id = memberships[0]["organization_id"]
    profile = db.get(UserProfile, user.id)
    role = next((m["role"] for m in memberships if m["organization_id"] == active_id), "member")
    return MeResponse(
        user=user,
        profile={
            "headline": profile.headline if profile else "",
            "bio": profile.bio if profile else "",
            "preferences": profile.preferences if profile else {},
            "notification_prefs": profile.notification_prefs if profile else {},
        },
        organizations=memberships,
        active_organization_id=active_id,
        is_internflow_admin=_is_internflow_admin(db, user, active_id),
        is_intern=role == "intern",
        capabilities=auth_capabilities(),
    )


def _verification_email(user: User, token: str) -> OutgoingEmail:
    url = f"{settings.frontend_url}/verify-email?token={token}"
    text = (
        f"Hello {user.full_name},\n\n"
        "Confirm your NEXORA AI email address using this single-use link:\n"
        f"{url}\n\n"
        f"The link expires in {settings.activation_ttl_hours} hours. "
        "If you did not create this account, you can ignore this message."
    )
    html = (
        f"<p>Hello {user.full_name},</p><p>Confirm your NEXORA AI email address:</p>"
        f'<p><a href="{url}">Verify email</a></p>'
        f"<p>The link expires in {settings.activation_ttl_hours} hours.</p>"
    )
    return OutgoingEmail(
        to_email=user.email,
        subject="Verify your NEXORA AI email",
        body_text=text,
        body_html=html,
        kind="email_verification",
        related_type="user",
        related_id=user.id,
    )


def _issue_verification(db: Session, user: User, organization_id: str | None) -> str:
    token = new_opaque_token()
    db.add(
        AccountActivationToken(
            user_id=user.id,
            token_hash=hash_token(token),
            expires_at=utcnow().replace(microsecond=0)
            + __import__("datetime").timedelta(hours=settings.activation_ttl_hours),
        )
    )
    send_email(db, _verification_email(user, token), organization_id)
    return token


def _login_response(db: Session, user: User, request: Request, response: Response) -> MeResponse:
    session, token = create_session(db, user, request)
    user.last_login_at = utcnow()
    db.commit()
    set_session_cookies(response, token, session.csrf_token)
    return build_me(db, user, user.default_organization_id)


@router.post("/register", response_model=MeResponse, status_code=201)
def register(
    payload: RegisterRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> MeResponse:
    email = payload.email.strip().lower()
    problems = password_problems(payload.password)
    if problems:
        raise AppError(422, "weak_password", "Choose a stronger password.", problems)
    if db.scalar(select(User).where(User.email == email)):
        raise conflict("An account with this email already exists.")
    user = User(
        email=email,
        password_hash=hash_password(payload.password),
        full_name=payload.full_name.strip(),
        timezone=payload.timezone or settings.default_timezone,
        email_verified_at=None if settings.require_email_verification else utcnow(),
    )
    db.add(user)
    db.flush()
    db.add(UserProfile(user_id=user.id, preferences={}, notification_prefs={}))
    org = Organization(
        name=(payload.organization_name or f"{payload.full_name.strip()}'s workspace").strip(),
        slug=_unique_slug(db, payload.organization_name or payload.full_name),
        kind="team" if payload.organization_name else "personal",
    )
    db.add(org)
    db.flush()
    db.add(
        OrganizationMembership(
            organization_id=org.id, user_id=user.id, role="owner", status="active"
        )
    )
    user.default_organization_id = org.id
    db.flush()
    if settings.require_email_verification:
        _issue_verification(db, user, org.id)
    notifications.notify(
        db,
        user_id=user.id,
        organization_id=org.id,
        title="Welcome to NEXORA AI",
        body="Start a conversation, add documents to your library, or open InternFlow from the sidebar.",
        kind="welcome",
        link="/chat",
    )
    notifications.audit(
        db,
        actor_id=user.id,
        action="account_registered",
        entity_type="user",
        entity_id=user.id,
        organization_id=org.id,
        request=request,
    )
    return _login_response(db, user, request, response)


@router.post("/login", response_model=MeResponse)
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> MeResponse:
    user = authenticate(db, payload.email, payload.password)
    if user is None:
        notifications.audit(
            db,
            actor_id=None,
            action="login_failed",
            entity_type="user",
            metadata={"email": payload.email[:320]},
            request=request,
        )
        db.commit()
        raise unauthorized("Email or password is incorrect.")
    if settings.require_email_verification and user.email_verified_at is None and not user.is_super_admin:
        raise AppError(
            403,
            "email_not_verified",
            "Confirm your email address before signing in. Use 'Resend verification' to get a new link.",
        )
    notifications.audit(
        db,
        actor_id=user.id,
        action="login_succeeded",
        entity_type="user",
        entity_id=user.id,
        organization_id=user.default_organization_id,
        request=request,
    )
    return _login_response(db, user, request, response)


@router.post("/logout", response_model=MessageOut)
def logout(
    request: Request,
    response: Response,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
) -> MessageOut:
    revoke_session(db, auth.session.id)
    notifications.audit(
        db,
        actor_id=auth.user.id,
        action="logout",
        entity_type="session",
        entity_id=auth.session.id,
        request=request,
    )
    db.commit()
    clear_session_cookies(response)
    return MessageOut(message="Signed out.")


@router.get("/me", response_model=MeResponse)
def me(auth: AuthContext = Depends(get_auth)) -> MeResponse:
    return build_me(auth.db, auth.user)


@router.get("/capabilities")
def capabilities() -> dict:
    return auth_capabilities()


@router.patch("/profile", response_model=MeResponse)
def update_profile(
    payload: ProfileUpdateRequest,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
) -> MeResponse:
    user = auth.user
    profile = db.get(UserProfile, user.id) or UserProfile(user_id=user.id)
    if payload.full_name is not None:
        user.full_name = payload.full_name.strip()
    if payload.timezone is not None:
        user.timezone = payload.timezone
    if payload.theme is not None:
        user.theme = payload.theme
    if payload.headline is not None:
        profile.headline = payload.headline
    if payload.bio is not None:
        profile.bio = payload.bio
    if payload.notification_prefs is not None:
        profile.notification_prefs = payload.notification_prefs
    db.add(profile)
    db.commit()
    return build_me(db, user)


@router.patch("/settings", response_model=MeResponse)
def update_settings(
    payload: SettingsUpdateRequest,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
) -> MeResponse:
    user = auth.user
    if payload.timezone is not None:
        user.timezone = payload.timezone
    if payload.theme is not None:
        user.theme = payload.theme
    if payload.default_organization_id is not None:
        allowed = {
            m.organization_id
            for m in db.scalars(
                select(OrganizationMembership).where(
                    OrganizationMembership.user_id == user.id,
                    OrganizationMembership.status == "active",
                )
            ).all()
        }
        if payload.default_organization_id not in allowed:
            raise AppError(403, "forbidden", "You are not a member of that organization.")
        user.default_organization_id = payload.default_organization_id
    if payload.notification_prefs is not None:
        profile = db.get(UserProfile, user.id) or UserProfile(user_id=user.id)
        profile.notification_prefs = payload.notification_prefs
        db.add(profile)
    db.commit()
    return build_me(db, user)


@router.post("/change-password", response_model=MessageOut)
def change_password(
    payload: ChangePasswordRequest,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
) -> MessageOut:
    if not verify_password(auth.user.password_hash, payload.current_password):
        raise AppError(422, "invalid_password", "Your current password is incorrect.")
    problems = password_problems(payload.new_password)
    if problems:
        raise AppError(422, "weak_password", "Choose a stronger password.", problems)
    auth.user.password_hash = hash_password(payload.new_password)
    revoke_all_sessions(db, auth.user.id, except_id=auth.session.id)
    db.commit()
    return MessageOut(message="Password updated. Other sessions were signed out.")


@router.get("/sessions", response_model=list[SessionOut])
def list_sessions(auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)) -> list[SessionOut]:
    rows = db.scalars(
        select(UserSession)
        .where(UserSession.user_id == auth.user.id, UserSession.revoked_at.is_(None))
        .order_by(UserSession.last_seen_at.desc())
    ).all()
    return [
        SessionOut(
            id=row.id,
            created_at=row.created_at,
            last_seen_at=row.last_seen_at,
            expires_at=row.expires_at,
            user_agent=row.user_agent,
            ip_address=row.ip_address,
            current=row.id == auth.session.id,
        )
        for row in rows
    ]


@router.delete("/sessions/{session_id}", response_model=MessageOut)
def delete_session(
    session_id: str,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
) -> MessageOut:
    record = db.get(UserSession, session_id)
    if record is None or record.user_id != auth.user.id:
        raise AppError(404, "not_found", "Session not found.")
    revoke_session(db, session_id)
    db.commit()
    return MessageOut(message="Session revoked.")


@router.post("/sessions/revoke-others", response_model=MessageOut)
def revoke_other_sessions(
    auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)
) -> MessageOut:
    count = revoke_all_sessions(db, auth.user.id, except_id=auth.session.id)
    db.commit()
    return MessageOut(message=f"{count} other session(s) revoked.")


@router.post("/forgot-password", response_model=ForgotResponse)
def forgot_password(payload: ForgotPasswordRequest, db: Session = Depends(get_db)) -> ForgotResponse:
    generic = "If an account exists for that email, a reset link has been generated."
    user = db.scalar(select(User).where(User.email == payload.email.strip().lower()))
    demo_token = None
    if user:
        token = new_opaque_token()
        db.add(
            PasswordResetToken(
                user_id=user.id,
                token_hash=hash_token(token),
                expires_at=utcnow().replace(microsecond=0)
                + __import__("datetime").timedelta(minutes=settings.reset_ttl_minutes),
            )
        )
        url = f"{settings.frontend_url}/reset-password?token={token}"
        send_email(
            db,
            OutgoingEmail(
                to_email=user.email,
                subject="Reset your NEXORA AI password",
                body_text=(
                    f"Hello {user.full_name},\n\nReset your password using this single-use link:\n{url}\n\n"
                    f"The link expires in {settings.reset_ttl_minutes} minutes."
                ),
                body_html=f'<p>Reset your NEXORA AI password:</p><p><a href="{url}">Choose a new password</a></p>',
                kind="password_reset",
                related_type="user",
                related_id=user.id,
            ),
            user.default_organization_id,
        )
        db.commit()
        if not settings.is_production:
            demo_token = token
    return ForgotResponse(message=generic, demo_token=demo_token)


@router.post("/reset-password", response_model=MessageOut)
def reset_password(payload: ResetPasswordRequest, db: Session = Depends(get_db)) -> MessageOut:
    problems = password_problems(payload.password)
    if problems:
        raise AppError(422, "weak_password", "Choose a stronger password.", problems)
    record = db.scalar(
        select(PasswordResetToken).where(PasswordResetToken.token_hash == hash_token(payload.token))
    )
    if record is None or record.used_at is not None or record.expires_at <= utcnow():
        raise bad_request("This reset link is invalid or has expired.")
    user = db.get(User, record.user_id)
    if user is None:
        raise bad_request("This reset link is invalid or has expired.")
    user.password_hash = hash_password(payload.password)
    user.email_verified_at = user.email_verified_at or utcnow()
    record.used_at = utcnow()
    revoke_all_sessions(db, user.id)
    db.commit()
    return MessageOut(message="Password reset. Sign in with your new password.")


@router.post("/activate", response_model=ActivationResult)
def activate(payload: ActivateRequest, db: Session = Depends(get_db)) -> ActivationResult:
    problems = password_problems(payload.password)
    if problems:
        raise AppError(422, "weak_password", "Choose a stronger password.", problems)
    record = db.scalar(
        select(AccountActivationToken).where(
            AccountActivationToken.token_hash == hash_token(payload.token)
        )
    )
    if record is None or record.used_at is not None or record.expires_at <= utcnow():
        raise bad_request("This activation link is invalid or has expired. Ask your administrator for a new invite.")
    user = db.get(User, record.user_id)
    if user is None:
        raise bad_request("This activation link is invalid or has expired.")
    user.password_hash = hash_password(payload.password)
    user.email_verified_at = utcnow()
    user.is_active = True
    user.deactivated_at = None
    if payload.full_name:
        user.full_name = payload.full_name.strip()
    record.used_at = utcnow()
    membership = db.scalar(
        select(OrganizationMembership).where(
            OrganizationMembership.user_id == user.id,
            OrganizationMembership.status == "active",
        )
    )
    if membership:
        user.default_organization_id = user.default_organization_id or membership.organization_id
    from app.models import InternProfile

    intern = db.scalar(select(InternProfile).where(InternProfile.user_id == user.id))
    if intern and intern.status == "invited":
        intern.status = "active"
        intern.onboarding_email_status = intern.onboarding_email_status or "demo"
    notifications.notify(
        db,
        user_id=user.id,
        organization_id=user.default_organization_id,
        title="Account activated",
        body="Your password is set. Sign in to review your onboarding and tasks.",
        kind="account_activated",
        link="/login",
    )
    db.commit()
    return ActivationResult(user=user, activated=True)


@router.get("/verify-email", response_model=MessageOut)
def verify_email(token: str, db: Session = Depends(get_db)) -> MessageOut:
    record = db.scalar(
        select(AccountActivationToken).where(
            AccountActivationToken.token_hash == hash_token(token)
        )
    )
    if record is None or record.expires_at <= utcnow():
        raise bad_request("This verification link is invalid or has expired.")
    if record.used_at is not None:
        return MessageOut(message="This email address is already verified.")
    user = db.get(User, record.user_id)
    if user is None:
        raise bad_request("This verification link is invalid or has expired.")
    user.email_verified_at = utcnow()
    record.used_at = utcnow()
    db.commit()
    return MessageOut(message="Email verified. You can sign in now.")


@router.post("/resend-verification", response_model=ForgotResponse)
def resend_verification(
    payload: ForgotPasswordRequest, db: Session = Depends(get_db)
) -> ForgotResponse:
    user = db.scalar(select(User).where(User.email == payload.email.strip().lower()))
    demo_token = None
    if user and user.email_verified_at is None:
        token = _issue_verification(db, user, user.default_organization_id)
        db.commit()
        if not settings.is_production:
            demo_token = token
    return ForgotResponse(
        message="If the account needs verification, a new link has been generated.",
        demo_token=demo_token,
    )


@router.post("/deactivate", response_model=MessageOut)
def deactivate_account(
    payload: DeactivateAccountRequest,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
    response: Response = None,  # type: ignore[assignment]
) -> MessageOut:
    if not verify_password(auth.user.password_hash, payload.password):
        raise AppError(422, "invalid_password", "Your password is incorrect.")
    auth.user.is_active = False
    auth.user.deactivated_at = utcnow()
    revoke_all_sessions(db, auth.user.id)
    notifications.audit(
        db,
        actor_id=auth.user.id,
        action="account_deactivated",
        entity_type="user",
        entity_id=auth.user.id,
    )
    db.commit()
    clear_session_cookies(response)
    return MessageOut(message="Account deactivated.")


# ---------------------------------------------------------------------------
# Google OAuth
# ---------------------------------------------------------------------------


@router.get("/google/start")
def google_start() -> RedirectResponse:
    if not settings.google_oauth_configured:
        raise AppError(
            409,
            "google_oauth_not_configured",
            "Google sign-in is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
        )
    state = secrets.token_urlsafe(32)
    params = urlencode(
        {
            "client_id": settings.google_client_id,
            "redirect_uri": settings.google_redirect_uri,
            "response_type": "code",
            "scope": "openid email profile",
            "state": state,
            "access_type": "offline",
            "prompt": "select_account",
        }
    )
    response = RedirectResponse(f"https://accounts.google.com/o/oauth2/v2/auth?{params}")
    response.set_cookie(
        OAUTH_STATE_COOKIE,
        state,
        max_age=600,
        httponly=True,
        secure=settings.is_production,
        samesite="lax",
        path="/",
    )
    return response


@router.get("/google/callback")
def google_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: Session = Depends(get_db),
) -> RedirectResponse:
    if error or not code:
        return RedirectResponse(f"{settings.frontend_url}/login?google=cancelled")
    expected = request.cookies.get(OAUTH_STATE_COOKIE)
    if not expected or not state or not secrets.compare_digest(expected, state):
        return RedirectResponse(f"{settings.frontend_url}/login?google=invalid_state")
    if not settings.google_oauth_configured:
        return RedirectResponse(f"{settings.frontend_url}/login?google=not_configured")
    try:
        with httpx.Client(timeout=20) as client:
            token_response = client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "client_id": settings.google_client_id,
                    "client_secret": settings.google_client_secret,
                    "code": code,
                    "grant_type": "authorization_code",
                    "redirect_uri": settings.google_redirect_uri,
                },
            )
            token_response.raise_for_status()
            access_token = token_response.json().get("access_token")
            info_response = client.get(
                "https://openidconnect.googleapis.com/v1/userinfo",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            info_response.raise_for_status()
            profile = info_response.json()
    except Exception:
        logger.exception("Google OAuth exchange failed")
        return RedirectResponse(f"{settings.frontend_url}/login?google=exchange_failed")
    email = str(profile.get("email") or "").strip().lower()
    subject = str(profile.get("sub") or "")
    if not email or not subject or not profile.get("email_verified", True):
        return RedirectResponse(f"{settings.frontend_url}/login?google=email_unverified")
    account = db.scalar(
        select(OAuthAccount).where(OAuthAccount.provider == "google", OAuthAccount.subject == subject)
    )
    user = db.get(User, account.user_id) if account else db.scalar(select(User).where(User.email == email))
    if user is None:
        user = User(
            email=email,
            full_name=str(profile.get("name") or email.split("@")[0]),
            password_hash=None,
            email_verified_at=utcnow(),
            timezone=settings.default_timezone,
        )
        db.add(user)
        db.flush()
        db.add(UserProfile(user_id=user.id, preferences={}, notification_prefs={}))
        org = Organization(name=f"{user.full_name}'s workspace", slug=_unique_slug(db, user.full_name), kind="personal")
        db.add(org)
        db.flush()
        db.add(OrganizationMembership(organization_id=org.id, user_id=user.id, role="owner", status="active"))
        user.default_organization_id = org.id
        db.flush()
    if account is None:
        db.add(
            OAuthAccount(
                user_id=user.id,
                provider="google",
                subject=subject,
                email=email,
            )
        )
    user.last_login_at = utcnow()
    user.email_verified_at = user.email_verified_at or utcnow()
    session, token = create_session(db, user, request)
    notifications.audit(
        db,
        actor_id=user.id,
        action="google_login",
        entity_type="user",
        entity_id=user.id,
        organization_id=user.default_organization_id,
        request=request,
    )
    db.commit()
    response = RedirectResponse(f"{settings.frontend_url}/chat")
    set_session_cookies(response, token, session.csrf_token)
    response.delete_cookie(OAUTH_STATE_COOKIE, path="/")
    return response
