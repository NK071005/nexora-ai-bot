"""Notifications, integration status and workspace settings contracts."""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel, UTCDateTime


class NotificationOut(ORMModel):
    id: str
    title: str
    body: str
    kind: str
    link: str | None = None
    read_at: UTCDateTime | None = None
    created_at: UTCDateTime


class NotificationListOut(BaseModel):
    items: list[NotificationOut]
    total: int
    unread: int
    limit: int
    offset: int


class UnreadCountOut(BaseModel):
    unread: int


class IntegrationOut(BaseModel):
    provider: str
    label: str
    category: str
    configured: bool
    mode: str
    status: str
    note: str
    required_env: list[str] = Field(default_factory=list)
    connected_at: UTCDateTime | None = None


class ConfigStatusOut(BaseModel):
    app: dict
    ai: dict
    search: dict
    email: dict
    calendar: dict
    google_oauth: dict
    storage: dict
    scheduler: dict
    video: dict
    integrations: list[IntegrationOut]


class OrganizationSettingsUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=200)
    settings: dict | None = None


class OrganizationOut(ORMModel):
    id: str
    name: str
    slug: str
    kind: str
    settings: dict
    created_at: UTCDateTime


class AuditLogOut(ORMModel):
    id: str
    action: str
    entity_type: str
    entity_id: str | None = None
    actor_id: str | None = None
    metadata_json: dict
    created_at: UTCDateTime
