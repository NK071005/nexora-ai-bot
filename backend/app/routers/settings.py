"""Workspace configuration, integration status and audit endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import AuthContext, OrgContext, get_auth, get_org_context, require_admin_ctx
from app.models import AuditLog, IntegrationConnection, Organization
from app.schemas.settings import (
    AuditLogOut,
    ConfigStatusOut,
    IntegrationOut,
    OrganizationOut,
    OrganizationSettingsUpdate,
)
from app.services.capabilities import config_status, integration_rows

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("/status", response_model=ConfigStatusOut)
def status(_: AuthContext = Depends(get_auth)) -> ConfigStatusOut:
    return ConfigStatusOut(**config_status())


@router.get("/integrations", response_model=list[IntegrationOut])
def integrations(
    auth: AuthContext = Depends(get_auth),
    org: OrgContext = Depends(get_org_context),
    db: Session = Depends(get_db),
) -> list[IntegrationOut]:
    connections = {
        row.provider: row
        for row in db.scalars(
            select(IntegrationConnection).where(
                IntegrationConnection.organization_id == org.organization.id
            )
        ).all()
    }
    rows = []
    for item in integration_rows():
        connection = connections.get(item["provider"])
        if connection and connection.status == "connected":
            item = {
                **item,
                "connected_at": connection.connected_at,
                "note": connection.metadata_json.get("note") or item["note"],
            }
        rows.append(IntegrationOut(**item))
    return rows


@router.get("/organization", response_model=OrganizationOut)
def current_organization(
    org: OrgContext = Depends(get_org_context),
) -> OrganizationOut:
    return OrganizationOut.model_validate(org.organization)


@router.patch("/organization", response_model=OrganizationOut)
def update_organization(
    payload: OrganizationSettingsUpdate,
    org: OrgContext = Depends(require_admin_ctx),
    db: Session = Depends(get_db),
) -> OrganizationOut:
    organization = db.get(Organization, org.organization.id)
    if payload.name is not None:
        organization.name = payload.name.strip()
    if payload.settings is not None:
        organization.settings = payload.settings
    db.commit()
    db.refresh(organization)
    return OrganizationOut.model_validate(organization)


@router.get("/audit", response_model=list[AuditLogOut])
def audit_log(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    org: OrgContext = Depends(require_admin_ctx),
    db: Session = Depends(get_db),
) -> list[AuditLogOut]:
    logs = db.scalars(
        select(AuditLog)
        .where(AuditLog.organization_id == org.organization.id)
        .order_by(AuditLog.created_at.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return [AuditLogOut.model_validate(log) for log in logs]
