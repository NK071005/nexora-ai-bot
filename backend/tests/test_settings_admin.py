"""Capability honesty, organization settings and super-admin isolation."""

from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.models import User
from tests.conftest import PASSWORD, csrf_headers, login, make_org_with_users, register


def test_capabilities_and_integrations_report_demo_states_honestly(client: TestClient):
    assert register(client).status_code == 201

    meta = client.get("/api/meta")
    assert meta.status_code == 200
    body = meta.json()
    assert body["demo_mode"] is True
    assert body["capabilities"]["ai"]["demo"] is True
    assert body["capabilities"]["search"]["configured"] is False
    assert body["capabilities"]["search"]["mode"] == "unconfigured"
    assert body["capabilities"]["email"]["configured"] is False
    assert body["capabilities"]["google_oauth"]["configured"] is False
    assert body["demo_login"] is True

    status = client.get("/api/settings/status")
    assert status.status_code == 200
    payload = status.json()
    assert payload["ai"]["demo"] is True
    import json

    notes = json.dumps(payload["ai"]["notes"])
    assert "OPENAI_API_KEY" in notes or "image generation" in notes.lower()
    assert payload["scheduler"]["enabled"] is False
    assert payload["storage"]["configured"] is True

    integrations = client.get("/api/settings/integrations")
    assert integrations.status_code == 200
    rows = {row["provider"]: row for row in integrations.json()}
    assert rows["openai"]["status"] == "demo"
    assert rows["openai"]["configured"] is False
    assert rows["search"]["status"] == "not_connected"
    assert rows["google_oauth"]["status"] == "not_connected"
    assert rows["ffmpeg"]["mode"] in {"unavailable", "ffmpeg"}
    assert "OPENAI_API_KEY" in rows["openai"]["required_env"]


def test_organization_settings_and_audit_are_role_gated(db):
    make_org_with_users(db, slug="settings-org")

    with TestClient(app) as admin:
        assert login(admin, email="admin-settings-org@example.com", password=PASSWORD).status_code == 200
        current = admin.get("/api/settings/organization")
        assert current.status_code == 200
        assert current.json()["name"] == "Test Org"

        updated = admin.patch(
            "/api/settings/organization",
            json={"name": "Renamed Workspace", "settings": {"default_language": "en"}},
            headers=csrf_headers(admin),
        )
        assert updated.status_code == 200
        assert updated.json()["name"] == "Renamed Workspace"

        audit = admin.get("/api/settings/audit")
        assert audit.status_code == 200

    with TestClient(app) as intern:
        assert login(intern, email="intern-settings-org@example.com", password=PASSWORD).status_code == 200
        assert intern.get("/api/settings/organization").status_code == 200
        denied = intern.patch(
            "/api/settings/organization",
            json={"name": "Intern Takeover"},
            headers=csrf_headers(intern),
        )
        assert denied.status_code == 403
        assert intern.get("/api/settings/audit").status_code == 403


def test_super_admin_area_and_account_toggle(db: TestClient):
    with TestClient(app) as owner:
        assert register(owner, email="owner-admin@example.com").status_code == 201
        assert owner.get("/api/admin/overview").status_code == 403

        with TestClient(app) as member:
            assert register(member, email="plain-user@example.com").status_code == 201
            assert member.get("/api/auth/me").status_code == 200

        user = db.scalar(select(User).where(User.email == "owner-admin@example.com"))
        user.is_super_admin = True
        db.commit()

        overview = owner.get("/api/admin/overview")
        assert overview.status_code == 200, overview.text
        assert overview.json()["users"] >= 2
        assert overview.json()["organizations"] >= 2

        organizations = owner.get("/api/admin/organizations")
        assert organizations.status_code == 200
        assert organizations.json()

        users = owner.get("/api/admin/users", params={"q": "plain-user"})
        assert users.status_code == 200
        target = users.json()[0]
        assert target["email"] == "plain-user@example.com"

        self_toggle = owner.post(
            f"/api/admin/users/{overview.json()['you']['id']}/toggle-active",
            headers=csrf_headers(owner),
        )
        assert self_toggle.status_code == 403

        deactivated = owner.post(
            f"/api/admin/users/{target['id']}/toggle-active",
            headers=csrf_headers(owner),
        )
        assert deactivated.status_code == 200
        assert deactivated.json()["is_active"] is False

        with TestClient(app) as member:
            assert login(member, email="plain-user@example.com").status_code == 401

        reactivated = owner.post(
            f"/api/admin/users/{target['id']}/toggle-active",
            headers=csrf_headers(owner),
        )
        assert reactivated.status_code == 200
        assert reactivated.json()["is_active"] is True

        with TestClient(app) as member:
            assert login(member, email="plain-user@example.com").status_code == 200
