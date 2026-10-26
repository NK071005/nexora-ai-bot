"""Chat persistence, SSE streaming, stop/regenerate and tenant isolation."""

from __future__ import annotations

import threading
import time

from fastapi.testclient import TestClient

from app.agent import orchestrator
from app.main import app
from tests.conftest import csrf_headers, register


def _new_chat(client: TestClient, title: str | None = None) -> str:
    response = client.post(
        "/api/chats",
        json={"title": title} if title else {},
        headers=csrf_headers(client),
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def test_chat_persists_stream_and_supports_search_controls(client: TestClient):
    assert register(client).status_code == 201
    chat_id = _new_chat(client)
    response = client.post(
        f"/api/chats/{chat_id}/messages",
        json={"content": "Hello NEXORA, what can you do?"},
        headers=csrf_headers(client),
    )
    assert response.status_code == 200, response.text
    assert "event: meta" in response.text
    assert "event: done" in response.text

    messages = client.get(f"/api/chats/{chat_id}/messages")
    assert messages.status_code == 200
    payload = messages.json()
    assert len(payload) == 2
    assert payload[0]["role"] == "user"
    assert payload[1]["role"] == "assistant"
    assert payload[1]["status"] == "complete"
    assert payload[1]["content"].strip()
    assert payload[1]["provider"] == "demo"

    detail = client.get(f"/api/chats/{chat_id}")
    assert detail.status_code == 200
    assert detail.json()["chat"]["message_count"] == 2

    listed = client.get("/api/chats").json()
    assert listed["total"] == 1
    assert listed["items"][0]["preview"].startswith("Hello NEXORA")

    updated = client.patch(
        f"/api/chats/{chat_id}",
        json={"title": "Capabilities review", "is_pinned": True, "tags": ["demo", "product"]},
        headers=csrf_headers(client),
    )
    assert updated.status_code == 200
    assert updated.json()["title"] == "Capabilities review"
    assert updated.json()["is_pinned"] is True
    assert set(updated.json()["tags"]) == {"demo", "product"}

    search = client.get("/api/search/chats", params={"q": "NEXORA"})
    assert search.status_code == 200
    assert search.json()


def test_web_search_unconfigured_returns_explicit_409(client: TestClient):
    assert register(client).status_code == 201
    chat_id = _new_chat(client)
    response = client.post(
        f"/api/chats/{chat_id}/messages",
        json={"content": "Find recent market data", "use_search": True},
        headers=csrf_headers(client),
    )
    assert response.status_code == 409
    body = response.json()
    assert body["error"]["code"] == "search_not_configured"
    assert "SEARCH_PROVIDER_API_KEY" in body["error"]["message"]
    # The failed request must not leave a phantom user message behind.
    assert client.get(f"/api/chats/{chat_id}/messages").json() == []


def test_chat_idor_is_blocked_and_delete_is_soft(client: TestClient):
    assert register(client, email="owner@example.com").status_code == 201
    chat_id = _new_chat(client)
    client.post(
        f"/api/chats/{chat_id}/messages",
        json={"content": "Private plan"},
        headers=csrf_headers(client),
    )

    with TestClient(app) as intruder:
        assert register(intruder, email="intruder@example.com").status_code == 201
        assert intruder.get(f"/api/chats/{chat_id}").status_code == 403
        assert intruder.get(f"/api/chats/{chat_id}/messages").status_code == 403
        assert intruder.patch(
            f"/api/chats/{chat_id}", json={"title": "Hijacked"}, headers=csrf_headers(intruder)
        ).status_code == 403
        assert intruder.delete(f"/api/chats/{chat_id}", headers=csrf_headers(intruder)).status_code == 403

    deleted = client.delete(f"/api/chats/{chat_id}", headers=csrf_headers(client))
    assert deleted.status_code == 200
    assert client.get(f"/api/chats/{chat_id}").status_code == 404
    assert client.get("/api/chats").json()["total"] == 0


def test_stop_generation_marks_message_stopped(client: TestClient, monkeypatch):
    assert register(client).status_code == 201
    chat_id = _new_chat(client)
    started = threading.Event()

    def slow_stream(self, messages, context, model=None):
        yield "partial answer "
        started.set()
        time.sleep(1.2)
        yield "this should never be appended"

    monkeypatch.setattr(orchestrator.agent, "stream_answer", slow_stream.__get__(orchestrator.agent))

    cookies = {
        "nexora_session": client.cookies.get("nexora_session"),
        "nexora_csrf": client.cookies.get("nexora_csrf"),
    }
    result: dict = {}

    def send():
        result["response"] = client.post(
            f"/api/chats/{chat_id}/messages",
            json={"content": "Give me a long answer"},
            headers={"X-CSRF-Token": cookies["nexora_csrf"]},
        )

    worker = threading.Thread(target=send)
    worker.start()
    assert started.wait(5), "generation never started"
    with TestClient(app) as stopper:
        stopper.cookies.set("nexora_session", cookies["nexora_session"])
        stopper.cookies.set("nexora_csrf", cookies["nexora_csrf"])
        stop = stopper.post(
            f"/api/chats/{chat_id}/stop", headers={"X-CSRF-Token": cookies["nexora_csrf"]}
        )
        assert stop.status_code == 200
        assert stop.json()["stopped"] is True
    worker.join(timeout=10)
    assert not worker.is_alive()
    assert result["response"].status_code == 200

    messages = client.get(f"/api/chats/{chat_id}/messages").json()
    assistant = [m for m in messages if m["role"] == "assistant"][-1]
    assert assistant["status"] == "stopped"
    assert "this should never be appended" not in assistant["content"]

    # With no active generation, stop is an honest no-op.
    idle = client.post(f"/api/chats/{chat_id}/stop", headers=csrf_headers(client))
    assert idle.status_code == 200
    assert idle.json()["stopped"] is False


def test_regenerate_marks_previous_answer_superseded(client: TestClient):
    assert register(client).status_code == 201
    chat_id = _new_chat(client)
    client.post(
        f"/api/chats/{chat_id}/messages",
        json={"content": "Summarise the onboarding steps"},
        headers=csrf_headers(client),
    )
    regenerate = client.post(
        f"/api/chats/{chat_id}/regenerate",
        json={},
        headers=csrf_headers(client),
    )
    assert regenerate.status_code == 200, regenerate.text
    assert "event: done" in regenerate.text

    messages = client.get(f"/api/chats/{chat_id}/messages").json()
    assistants = [m for m in messages if m["role"] == "assistant"]
    assert len(assistants) == 2
    assert assistants[0]["status"] == "superseded"
    assert assistants[1]["status"] == "complete"
