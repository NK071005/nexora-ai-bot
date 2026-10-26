"""Authentication, profile, session and settings schemas."""

from __future__ import annotations

from pydantic import BaseModel, EmailStr, Field

from app.schemas.common import ORMModel, UTCDateTime


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=10, max_length=200)
    full_name: str = Field(min_length=2, max_length=200)
    organization_name: str | None = Field(default=None, max_length=200)
    timezone: str = "Asia/Kolkata"


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=200)


class ActivateRequest(BaseModel):
    token: str = Field(min_length=20, max_length=200)
    password: str = Field(min_length=10, max_length=200)
    full_name: str | None = Field(default=None, max_length=200)


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str = Field(min_length=20, max_length=200)
    password: str = Field(min_length=10, max_length=200)


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=10, max_length=200)


class DeactivateAccountRequest(BaseModel):
    password: str


class UserOut(ORMModel):
    id: str
    email: str
    full_name: str
    is_super_admin: bool
    email_verified_at: UTCDateTime | None = None
    timezone: str
    theme: str
    created_at: UTCDateTime


class MembershipOut(BaseModel):
    organization_id: str
    organization_name: str
    organization_slug: str
    role: str
    status: str


class CapabilityOut(BaseModel):
    ai: dict
    search: dict
    email: dict
    calendar: dict
    google_oauth: bool
    storage: dict


class MeResponse(BaseModel):
    user: UserOut
    profile: dict
    organizations: list[MembershipOut]
    active_organization_id: str | None
    is_internflow_admin: bool
    is_intern: bool
    capabilities: CapabilityOut


class ProfileUpdateRequest(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=200)
    headline: str | None = Field(default=None, max_length=200)
    bio: str | None = Field(default=None, max_length=2000)
    timezone: str | None = Field(default=None, max_length=64)
    theme: str | None = Field(default=None, pattern="^(light|dark|system)$")
    notification_prefs: dict | None = None


class SettingsUpdateRequest(BaseModel):
    timezone: str | None = Field(default=None, max_length=64)
    theme: str | None = Field(default=None, pattern="^(light|dark|system)$")
    default_organization_id: str | None = None
    notification_prefs: dict | None = None


class SessionOut(BaseModel):
    id: str
    created_at: UTCDateTime
    last_seen_at: UTCDateTime
    expires_at: UTCDateTime
    user_agent: str
    ip_address: str
    current: bool


class MessageOut(BaseModel):
    message: str
    ok: bool = True


class ActivationResult(BaseModel):
    user: UserOut
    activated: bool = True


class ForgotResponse(BaseModel):
    message: str
    demo_token: str | None = None
