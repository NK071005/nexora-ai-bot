"""Scheduled automations with real durable runs."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.deps import AuthContext, OrgContext, get_auth, get_org_context
from app.errors import AppError, forbidden, not_found
from app.models import (
    LibraryItem,
    ScheduledTask,
    ScheduledTaskRun,
    TaskAssignment,
    User,
    utcnow,
)
from app.schemas.scheduling import (
    ScheduledRunOut,
    ScheduledTaskCreate,
    ScheduledTaskDetail,
    ScheduledTaskOut,
    ScheduledTaskUpdate,
    ScheduleMeta,
    TaskTypeOut,
)
from app.services import notifications
from app.services.scheduler import HANDLERS, compute_next_run, run_task_now

router = APIRouter(prefix="/scheduled", tags=["scheduled"])

TASK_TYPES: list[TaskTypeOut] = [
    TaskTypeOut(
        key="summarize_document",
        label="Summarise a document",
        description="Summarise a library document or the most recent item. Uses the configured provider (demo mode is labeled).",
        config_fields=["library_item_id", "prompt"],
    ),
    TaskTypeOut(
        key="custom_prompt",
        label="Custom prompt",
        description="Run a saved prompt, optionally grounded in one library item.",
        config_fields=["prompt", "library_item_id"],
    ),
    TaskTypeOut(
        key="progress_report",
        label="InternFlow progress report",
        description="Generate an organization progress report from live InternFlow records.",
        config_fields=[],
        requires_organization=True,
    ),
    TaskTypeOut(
        key="web_check",
        label="Web check",
        description="Search the live web and record real sources. Requires a configured search provider.",
        config_fields=["query"],
        requires_search=True,
    ),
    TaskTypeOut(
        key="deadline_reminder",
        label="InternFlow deadline reminder",
        description="Send a reminder for a specific assignment using the configured email transport.",
        config_fields=["assignment_id"],
        requires_organization=True,
    ),
]

TASK_TYPE_KEYS = {item.key for item in TASK_TYPES}
COMMON_TIMEZONES = [
    "UTC",
    "Asia/Kolkata",
    "Asia/Dubai",
    "Asia/Singapore",
    "Europe/London",
    "Europe/Berlin",
    "America/New_York",
    "America/Chicago",
    "America/Los_Angeles",
    "Australia/Sydney",
]


def _owned_task(db: Session, user: User, task_id: str) -> ScheduledTask:
    task = db.get(ScheduledTask, task_id)
    if task is None or task.deleted_at is not None:
        raise not_found("Scheduled task")
    if task.user_id != user.id:
        raise forbidden("This scheduled task belongs to another user.")
    return task


def _validate_type_and_config(
    db: Session, user: User, org: OrgContext, task_type: str, config: dict
) -> None:
    if task_type not in TASK_TYPE_KEYS:
        raise AppError(422, "unknown_task_type", f"Unknown task type '{task_type}'.")
    if task_type in {"progress_report", "deadline_reminder"} and not org.is_admin:
        raise forbidden("This automation requires an organization administrator.")
    if task_type == "web_check" and not settings.search_configured:
        raise AppError(
            409,
            "search_not_configured",
            "Web check requires a search provider. Set SEARCH_PROVIDER_API_KEY before creating this automation.",
        )
    item_id = (config or {}).get("library_item_id")
    if item_id:
        item = db.get(LibraryItem, item_id)
        if item is None or item.deleted_at is not None or item.user_id != user.id:
            raise AppError(422, "invalid_library_item", "The selected library item is unavailable.")
    assignment_id = (config or {}).get("assignment_id")
    if task_type == "deadline_reminder":
        if not assignment_id:
            raise AppError(422, "assignment_required", "Choose an assignment for the deadline reminder.")
        assignment = db.get(TaskAssignment, assignment_id)
        if assignment is None or assignment.organization_id != org.organization.id:
            raise AppError(422, "invalid_assignment", "The selected assignment is unavailable in this organization.")


def _serialize(task: ScheduledTask) -> ScheduledTaskOut:
    return ScheduledTaskOut.model_validate(task)


@router.get("/meta", response_model=ScheduleMeta)
def schedule_meta(
    _: AuthContext = Depends(get_auth), db: Session = Depends(get_db)
) -> ScheduleMeta:
    timezones = sorted({settings.default_timezone, *COMMON_TIMEZONES})
    return ScheduleMeta(
        task_types=TASK_TYPES,
        scheduler_enabled=settings.scheduler_enabled,
        timezones=timezones,
    )


@router.get("", response_model=list[ScheduledTaskOut])
def list_tasks(
    status: str | None = Query(default=None, max_length=16),
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
) -> list[ScheduledTaskOut]:
    stmt = select(ScheduledTask).where(
        ScheduledTask.user_id == auth.user.id, ScheduledTask.deleted_at.is_(None)
    )
    if status:
        stmt = stmt.where(ScheduledTask.status == status)
    tasks = db.scalars(stmt.order_by(ScheduledTask.created_at.desc())).all()
    return [_serialize(task) for task in tasks]


@router.post("", response_model=ScheduledTaskOut, status_code=201)
def create_task(
    payload: ScheduledTaskCreate,
    auth: AuthContext = Depends(get_auth),
    org: OrgContext = Depends(get_org_context),
    db: Session = Depends(get_db),
) -> ScheduledTaskOut:
    _validate_type_and_config(db, auth.user, org, payload.task_type, payload.config)
    task = ScheduledTask(
        user_id=auth.user.id,
        organization_id=org.organization.id,
        title=payload.title.strip(),
        description=payload.description,
        task_type=payload.task_type,
        schedule_kind=payload.schedule_kind,
        timezone=payload.timezone,
        run_at=payload.run_at.replace(tzinfo=None) if payload.run_at and payload.run_at.tzinfo else payload.run_at,
        time_of_day=payload.time_of_day,
        day_of_week=payload.day_of_week,
        day_of_month=payload.day_of_month,
        notify=payload.notify,
        config=payload.config,
        status="active",
    )
    next_run = compute_next_run(task)
    if next_run is None:
        raise AppError(422, "invalid_schedule", "This schedule has no future run time.")
    task.next_run_at = next_run
    db.add(task)
    db.commit()
    db.refresh(task)
    notifications.audit(
        db,
        actor_id=auth.user.id,
        action="scheduled_task_created",
        entity_type="scheduled_task",
        entity_id=task.id,
        organization_id=org.organization.id,
        metadata={"task_type": task.task_type, "schedule": task.schedule_kind},
    )
    db.commit()
    return _serialize(task)


@router.get("/{task_id}", response_model=ScheduledTaskDetail)
def get_task(
    task_id: str,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
) -> ScheduledTaskDetail:
    task = _owned_task(db, auth.user, task_id)
    runs = db.scalars(
        select(ScheduledTaskRun)
        .where(ScheduledTaskRun.task_id == task.id)
        .order_by(ScheduledTaskRun.created_at.desc())
        .limit(50)
    ).all()
    return ScheduledTaskDetail(
        task=_serialize(task),
        runs=[ScheduledRunOut.model_validate(run) for run in runs],
        handlers=TASK_TYPES,
    )


@router.patch("/{task_id}", response_model=ScheduledTaskOut)
def update_task(
    task_id: str,
    payload: ScheduledTaskUpdate,
    auth: AuthContext = Depends(get_auth),
    org: OrgContext = Depends(get_org_context),
    db: Session = Depends(get_db),
) -> ScheduledTaskOut:
    task = _owned_task(db, auth.user, task_id)
    config = payload.config if payload.config is not None else task.config
    _validate_type_and_config(db, auth.user, org, task.task_type, config)
    schedule_changed = False
    for field in (
        "title",
        "description",
        "schedule_kind",
        "timezone",
        "time_of_day",
        "day_of_week",
        "day_of_month",
        "notify",
        "config",
        "status",
    ):
        value = getattr(payload, field)
        if value is not None:
            if field in {"schedule_kind", "timezone", "time_of_day", "day_of_week", "day_of_month"}:
                schedule_changed = schedule_changed or value != getattr(task, field)
            setattr(task, field, value)
    if payload.run_at is not None:
        task.run_at = payload.run_at.replace(tzinfo=None) if payload.run_at.tzinfo else payload.run_at
        schedule_changed = True
    if task.status == "active" and (schedule_changed or task.next_run_at is None):
        task.next_run_at = compute_next_run(task)
        if task.next_run_at is None:
            raise AppError(422, "invalid_schedule", "This schedule has no future run time.")
    if task.status in {"paused", "cancelled"}:
        task.next_run_at = None if task.status == "cancelled" else task.next_run_at
    db.commit()
    db.refresh(task)
    return _serialize(task)


@router.delete("/{task_id}")
def delete_task(
    task_id: str, auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)
) -> dict:
    task = _owned_task(db, auth.user, task_id)
    task.deleted_at = utcnow()
    task.status = "cancelled"
    task.next_run_at = None
    db.commit()
    return {"ok": True, "message": "Scheduled task deleted."}


@router.post("/{task_id}/run", response_model=ScheduledRunOut)
def run_now(
    task_id: str,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
) -> ScheduledRunOut:
    task = _owned_task(db, auth.user, task_id)
    if not settings.scheduler_enabled:
        raise AppError(
            409,
            "scheduler_disabled",
            "The scheduler is disabled by configuration. Enable SCHEDULER_ENABLED to run automations.",
        )
    try:
        run = run_task_now(db, task)
    except ValueError as exc:
        raise AppError(409, "run_failed", str(exc)) from exc
    db.refresh(run)
    if run.status == "failed":
        raise AppError(422, "run_failed", run.error or "The automation failed.", {"run_id": run.id})
    return ScheduledRunOut.model_validate(run)


@router.post("/{task_id}/pause", response_model=ScheduledTaskOut)
def pause_task(
    task_id: str, auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)
) -> ScheduledTaskOut:
    task = _owned_task(db, auth.user, task_id)
    if task.status != "active":
        raise AppError(409, "invalid_state", "Only active tasks can be paused.")
    task.status = "paused"
    db.commit()
    return _serialize(task)


@router.post("/{task_id}/resume", response_model=ScheduledTaskOut)
def resume_task(
    task_id: str, auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)
) -> ScheduledTaskOut:
    task = _owned_task(db, auth.user, task_id)
    if task.status not in {"paused", "failed"}:
        raise AppError(409, "invalid_state", "Only paused or failed tasks can be resumed.")
    task.status = "active"
    task.failure_count = 0
    task.last_error = None
    task.next_run_at = compute_next_run(task)
    if task.next_run_at is None:
        raise AppError(422, "invalid_schedule", "This one-time schedule is in the past. Set a new run time first.")
    db.commit()
    return _serialize(task)


@router.get("/{task_id}/runs", response_model=list[ScheduledRunOut])
def list_runs(
    task_id: str,
    limit: int = Query(default=50, ge=1, le=200),
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
) -> list[ScheduledRunOut]:
    task = _owned_task(db, auth.user, task_id)
    runs = db.scalars(
        select(ScheduledTaskRun)
        .where(ScheduledTaskRun.task_id == task.id)
        .order_by(ScheduledTaskRun.created_at.desc())
        .limit(limit)
    ).all()
    return [ScheduledRunOut.model_validate(run) for run in runs]
