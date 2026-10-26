"""Authentication, CSRF and session lifecycle tests."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
from tests.conftest import PASSWORD, csrf_headers, login, register


def test_register_me_logout_and_csrf(client: TestClient):
    response = register(client)
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["user"]["email"] == "user@example.com"
    assert body["active_organization_id"]
    assert client.cookies.get("nexora_session")
    assert client.cookies.get("nexora_csrf")

    me = client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["user"]["email"] == "user@example.com"
    assert me.json()["capabilities"]["ai"]["demo"] is True

    # A session cookie alone is not enough for a state-changing request.
    without = client.patch("/api/auth/profile", json={"headline": "Researcher"})
    assert without.status_code == 403
    assert without.json()["error"]["code"] == "csrf_failed"

    with_csrf = client.patch(
        "/api/auth/profile",
        json={"headline": "Researcher"},
        headers=csrf_headers(client),
    )
    assert with_csrf.status_code == 200
    assert with_csrf.json()["profile"]["headline"] == "Researcher"

    # Browsers must send the exact header value; a forged value fails.
    forged = client.patch(
        "/api/auth/profile",
        json={"headline": "Hijacked"},
        headers={"X-CSRF-Token": "not-the-real-token"},
    )
    assert forged.status_code == 403

    logout = client.post("/api/auth/logout", headers=csrf_headers(client))
    assert logout.status_code == 200
    assert client.get("/api/auth/me").status_code == 401


def test_duplicate_weak_and_wrong_password(client: TestClient):
    assert register(client).status_code == 201

    duplicate = register(client, email="user@example.com")
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "conflict"

    weak = register(client, email="weak@example.com", password="short")
    assert weak.status_code == 422

    wrong = login(client, password="WrongPassword!1")
    assert wrong.status_code == 401
    assert "incorrect" in wrong.json()["error"]["message"].lower()


def test_session_revocation_across_clients():
    with TestClient(app) as first:
        assert register(first).status_code == 201
        with TestClient(app) as second:
            assert login(second).status_code == 200
            sessions = first.get("/api/auth/sessions")
            assert sessions.status_code == 200
            assert len(sessions.json()) >= 2
            assert second.get("/api/auth/me").status_code == 200

            revoke = first.post(
                "/api/auth/sessions/revoke-others", headers=csrf_headers(first)
            )
            assert revoke.status_code == 200
            assert second.get("/api/auth/me").status_code == 401
            assert first.get("/api/auth/me").status_code == 200


def test_password_reset_and_activation_are_single_use(client: TestClient):
    assert register(client).status_code == 201
    client.post("/api/auth/logout", headers=csrf_headers(client))

    forgot = client.post("/api/auth/forgot-password", json={"email": "user@example.com"})
    assert forgot.status_code == 200
    token = forgot.json()["demo_token"]
    assert token, "Development mode must expose the generated reset token for honest testing."

    reset = client.post(
        "/api/auth/reset-password",
        json={"token": token, "password": "BrandNewPass!9"},
    )
    assert reset.status_code == 200
    replay = client.post(
        "/api/auth/reset-password",
        json={"token": token, "password": "AnotherPass!99"},
    )
    assert replay.status_code == 400

    assert login(client, password="BrandNewPass!9").status_code == 200
    assert login(client, password=PASSWORD).status_code == 401


def test_deactivate_clears_session(client: TestClient):
    assert register(client).status_code == 201
    response = client.post(
        "/api/auth/deactivate",
        json={"password": PASSWORD},
        headers=csrf_headers(client),
    )
    assert response.status_code == 200, response.text
    assert client.get("/api/auth/me").status_code == 401
    assert login(client).status_code == 401
