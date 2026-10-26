"""Durable scheduler: time computation, unique run slots, retries and API states."""

from __future__ import annotations

from datetime import datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.main import app
from app.models import ScheduledTask, ScheduledTaskRun, utcnow
from app.services.scheduler import compute_next_run, create_run, run_task_now, tick
from tests.conftest import csrf_headers, register


def _task(**overrides):
    base = dict(
        schedule_kind="daily",
        timezone="UTC",
        time_of_day="09:00",
        status="active",
        run_at=None,
        day_of_week=None,
        day_of_month=None,
    )
    base.update(overrides)

    class _Task:
        pass

    task = _Task()
    for key, value in base.items():
        setattr(task, key, value)
    return task


def test_compute_next_run_for_each_schedule_kind():
    now = datetime(2026, 1, 1, 10, 30)  # Thursday
    assert compute_next_run(_task(schedule_kind="daily"), now) == datetime(2026, 1, 2, 9, 0)
    assert compute_next_run(_task(schedule_kind="weekly", day_of_week=0), now) == datetime(2026, 1, 5, 9, 0)
    assert compute_next_run(_task(schedule_kind="weekly", day_of_week=3), now) == datetime(2026, 1, 8, 9, 0)
    assert compute_next_run(_task(schedule_kind="monthly", day_of_month=15), now) == datetime(2026, 1, 15, 9, 0)
    assert compute_next_run(_task(schedule_kind="monthly", day_of_month=1), now) == datetime(2026, 2, 1, 9, 0)
    assert compute_next_run(_task(schedule_kind="once", run_at=now - timedelta(hours=1)), now) is None
    assert compute_next_run(_task(schedule_kind="once", run_at=now + timedelta(hours=1)), now) == now + timedelta(hours=1)
    # Invalid zones fall back to UTC rather than crashing.
    assert compute_next_run(_task(timezone="Mars/Olympus"), now) == datetime(2026, 1, 2, 9, 0)


def _create_custom_task(client: TestClient, *, schedule_kind="once", run_at=None, prompt="Give a short demo summary"):
    payload = {
        "title": "Demo automation",
        "description": "Created by tests",
        "task_type": "custom_prompt",
        "schedule_kind": schedule_kind,
        "timezone": "UTC",
        "notify": True,
        "config": {"prompt": prompt},
    }
    if run_at is not None:
        payload["run_at"] = run_at
    if schedule_kind != "once":
        payload["time_of_day"] = "09:00"
    response = client.post("/api/scheduled", json=payload, headers=csrf_headers(client))
    assert response.status_code == 201, response.text
    return response.json()


def test_scheduler_api_meta_validation_pause_and_disabled_run(client: TestClient):
    assert register(client).status_code == 201

    meta = client.get("/api/scheduled/meta")
    assert meta.status_code == 200
    assert meta.json()["scheduler_enabled"] is False
    assert {item["key"] for item in meta.json()["task_types"]} >= {"custom_prompt", "progress_report", "web_check"}

    missing_run_at = client.post(
        "/api/scheduled",
        json={"title": "Bad once", "task_type": "custom_prompt", "schedule_kind": "once"},
        headers=csrf_headers(client),
    )
    assert missing_run_at.status_code == 422

    web = client.post(
        "/api/scheduled",
        json={
            "title": "Web check",
            "task_type": "web_check",
            "schedule_kind": "daily",
            "time_of_day": "09:00",
            "config": {"query": "market data"},
        },
        headers=csrf_headers(client),
    )
    assert web.status_code == 409
    assert web.json()["error"]["code"] == "search_not_configured"

    future = (utcnow() + timedelta(days=1)).isoformat() + "Z"
    task = _create_custom_task(client, run_at=future)
    assert task["status"] == "active"
    assert task["next_run_at"]

    paused = client.post(f"/api/scheduled/{task['id']}/pause", headers=csrf_headers(client))
    assert paused.status_code == 200
    assert paused.json()["status"] == "paused"
    again = client.post(f"/api/scheduled/{task['id']}/pause", headers=csrf_headers(client))
    assert again.status_code == 409

    run = client.post(f"/api/scheduled/{task['id']}/run", headers=csrf_headers(client))
    assert run.status_code == 409
    assert run.json()["error"]["code"] == "scheduler_disabled"

    resumed = client.post(f"/api/scheduled/{task['id']}/resume", headers=csrf_headers(client))
    assert resumed.status_code == 200
    assert resumed.json()["status"] == "active"

    detail = client.get(f"/api/scheduled/{task['id']}")
    assert detail.status_code == 200
    assert detail.json()["runs"] == []

    deleted = client.delete(f"/api/scheduled/{task['id']}", headers=csrf_headers(client))
    assert deleted.status_code == 200
    assert client.get(f"/api/scheduled/{task['id']}").status_code == 404


def test_run_slots_are_unique_and_tick_executes_each_slot_once(db, client: TestClient):
    assert register(client).status_code == 201
    task_json = _create_custom_task(
        client, schedule_kind="daily", prompt="Summarise the NEXORA workspace in three bullets."
    )

    task = db.get(ScheduledTask, task_json["id"])
    slot = utcnow()
    first = create_run(db, task, slot)
    assert first is not None
    db.commit()
    duplicate = create_run(db, task, slot)
    assert duplicate is None
    db.rollback()
    assert db.scalar(select(func.count(ScheduledTaskRun.id))) == 1

    # Force the task due, then let a real scheduler tick claim and execute it.
    task.next_run_at = utcnow() - timedelta(minutes=1)
    task.schedule_kind = "once"
    task.run_at = task.next_run_at
    db.commit()

    first_tick = tick()
    assert first_tick["tasks"] >= 1
    db.expire_all()
    runs = db.scalars(select(ScheduledTaskRun).where(ScheduledTaskRun.task_id == task.id)).all()
    assert len(runs) == 2
    assert {run.status for run in runs} == {"running", "succeeded"}
    task = db.get(ScheduledTask, task.id)
    assert task.status == "completed"
    assert task.run_count == 1
    assert task.next_run_at is None

    second_tick = tick()
    assert second_tick["tasks"] == 0
    db.expire_all()
    assert db.scalar(
        select(func.count(ScheduledTaskRun.id)).where(ScheduledTaskRun.task_id == task.id)
    ) == 2


def test_failed_automation_records_error_and_schedules_a_retry(db, client: TestClient):
    assert register(client).status_code == 201
    task_json = client.post(
        "/api/scheduled",
        json={
            "title": "Summary without a document",
            "task_type": "summarize_document",
            "schedule_kind": "daily",
            "time_of_day": "09:00",
            "timezone": "UTC",
            "config": {},
        },
        headers=csrf_headers(client),
    ).json()

    task = db.get(ScheduledTask, task_json["id"])
    run = run_task_now(db, task)
    assert run.status == "failed"
    assert "library" in (run.error or "").lower()
    db.refresh(task)
    assert task.failure_count == 1
    assert task.status == "active"
    assert task.next_run_at is not None
    assert task.next_run_at > utcnow()
    assert task.last_error

    # A second failure exhausts the automatic retry budget honestly.
    task.next_run_at = utcnow() - timedelta(minutes=1)
    db.commit()
    tick()
    db.expire_all()
    task = db.get(ScheduledTask, task.id)
    assert task.failure_count == 2
    assert task.status == "active"
    assert task.next_run_at > utcnow()

    task.next_run_at = utcnow() - timedelta(minutes=1)
    db.commit()
    tick()
    db.expire_all()
    task = db.get(ScheduledTask, task.id)
    assert task.failure_count == 3
    assert task.status == "failed"
    assert task.next_run_at is None

    notifications = client.get("/api/notifications")
    assert notifications.status_code == 200
    kinds = {item["kind"] for item in notifications.json()["items"]}
    assert "scheduled_task_failed" in kinds
