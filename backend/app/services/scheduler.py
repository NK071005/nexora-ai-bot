"""Durable, database-backed scheduler and InternFlow reminder worker.

A single background thread claims due work. Idempotency is enforced with a
unique ``(task_id, scheduled_for)`` run key, so duplicate workers or retries
cannot double-execute a slot. Failures are recorded and retried with backoff.
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal
from app.models import (
    InternProfile,
    LibraryItem,
    ScheduledTask,
    ScheduledTaskNotification,
    ScheduledTaskRun,
    TaskAssignment,
    utcnow,
)
from app.services import notifications
from app.services.ai import AttachmentContext, ChatTurn, get_provider
from app.services.email import send_email
from app.services.internflow import process_due_reminders, progress_summary
from app.services.search import web_search
from app.templates.emails import reminder_email

logger = logging.getLogger("nexora.scheduler")


def _tz(name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(name or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def _parse_time(value: str | None) -> tuple[int, int]:
    if not value:
        return (9, 0)
    try:
        hour, minute = value.split(":")
        return (max(0, min(23, int(hour))), max(0, min(59, int(minute))))
    except Exception:
        return (9, 0)


def compute_next_run(task: ScheduledTask, now: datetime | None = None) -> datetime | None:
    """Return the next UTC-naive execution time strictly after ``now``."""
    now = now or utcnow()
    tz = _tz(task.timezone)
    now_local = now.replace(tzinfo=timezone.utc).astimezone(tz)
    hour, minute = _parse_time(task.time_of_day)

    if task.schedule_kind == "once":
        if task.run_at is None:
            return None
        return task.run_at if task.run_at > now else None

    candidate = now_local.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if task.schedule_kind == "daily":
        if candidate <= now_local:
            candidate += timedelta(days=1)
    elif task.schedule_kind == "weekly":
        target = task.day_of_week if task.day_of_week is not None else 0
        days_ahead = (target - now_local.weekday()) % 7
        candidate = (now_local + timedelta(days=days_ahead)).replace(
            hour=hour, minute=minute, second=0, microsecond=0
        )
        if candidate <= now_local:
            candidate += timedelta(days=7)
    elif task.schedule_kind == "monthly":
        day = task.day_of_month or 1
        year, month = now_local.year, now_local.month
        for _ in range(13):
            try:
                candidate = now_local.replace(
                    year=year, month=month, day=min(day, 28), hour=hour, minute=minute, second=0, microsecond=0
                )
            except ValueError:
                candidate = now_local.replace(year=year, month=month, day=28, hour=hour, minute=minute, second=0, microsecond=0)
            if candidate > now_local:
                break
            month += 1
            if month > 12:
                month = 1
                year += 1
    else:
        return None
    return candidate.astimezone(timezone.utc).replace(tzinfo=None)


def create_run(db: Session, task: ScheduledTask, scheduled_for: datetime) -> ScheduledTaskRun | None:
    run = ScheduledTaskRun(
        task_id=task.id, scheduled_for=scheduled_for, status="running", attempt=task.failure_count + 1
    )
    db.add(run)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        return None
    return run


def _summary_for_item(db: Session, task: ScheduledTask) -> str:
    item_id = (task.config or {}).get("library_item_id")
    if item_id:
        item = db.get(LibraryItem, item_id)
        if item is None or item.user_id != task.user_id:
            raise ValueError("The configured library item is unavailable.")
        text = item.content_text or item.description or ""
        if not text.strip():
            raise ValueError("The library item has no extractable text.")
        filename = item.title
    else:
        item = db.scalar(
            select(LibraryItem)
            .where(LibraryItem.user_id == task.user_id, LibraryItem.deleted_at.is_(None))
            .order_by(LibraryItem.updated_at.desc())
        )
        if item is None:
            raise ValueError("Add a document to your library before running a summary task.")
        text = item.content_text or item.description or ""
        filename = item.title
    provider = get_provider()
    prompt = (task.config or {}).get("prompt") or "Summarise this document with key points and open questions."
    chunks = [
        chunk
        for chunk in provider.stream_chat(
            [ChatTurn(role="user", content=prompt)],
            attachments=[AttachmentContext(filename=filename, kind="document", text=text[:20000])],
        )
    ]
    output = "".join(chunks).strip()
    if not output:
        raise ValueError("The configured provider returned an empty summary.")
    return output


def _progress_report(db: Session, task: ScheduledTask) -> str:
    if not task.organization_id:
        raise ValueError("A progress report requires an organization context.")
    summary = progress_summary(db, task.organization_id)
    lines = [
        f"## InternFlow progress report — {utcnow().strftime('%d %b %Y')}",
        "",
        f"- Interns: **{summary['interns_total']}**",
        f"- Active: **{summary['active']}** · Completed: **{summary['completed']}** · Overdue: **{summary['overdue']}**",
        f"- Tasks approved: **{summary['tasks_approved']}** · Pending: **{summary['tasks_pending']}**",
        "",
        "| Intern | Status | Current task | Due |",
        "| --- | --- | --- | --- |",
    ]
    for row in summary["interns"][:40]:
        due = row["due_at"].strftime("%d %b %Y") if row["due_at"] else "—"
        current = (row["current_task"] or "—").replace("|", "/")
        flag = " (overdue)" if row["overdue"] else ""
        lines.append(f"| {row['name']} | {row['status']}{flag} | {current} | {due} |")
    if not summary["interns"]:
        lines.append("| No interns imported yet | — | — | — |")
    return "\n".join(lines)


def _web_check(db: Session, task: ScheduledTask) -> str:
    query = (task.config or {}).get("query") or task.title
    job, results = web_search(db, task.user_id, query, max_results=5)
    if not results:
        raise ValueError("Web search returned no results.")
    lines = [f"## Web check — {query}", ""]
    for item in results:
        lines.append(f"- [{item['title']}]({item['url']}) · {item['domain']}")
        if item.get("snippet"):
            lines.append(f"  {item['snippet'][:300]}")
    lines.append("")
    lines.append(f"Sources retrieved at {utcnow().strftime('%Y-%m-%d %H:%M UTC')} via {job.provider}.")
    return "\n".join(lines)


def _deadline_reminder(db: Session, task: ScheduledTask) -> str:
    assignment_id = (task.config or {}).get("assignment_id")
    if not assignment_id:
        raise ValueError("Configure an assignment for a deadline reminder.")
    assignment = db.get(TaskAssignment, assignment_id)
    if assignment is None:
        raise ValueError("The configured assignment no longer exists.")
    if assignment.status not in {"assigned", "corrections_required", "overdue"}:
        return f"Reminder skipped: task status is {assignment.status}."
    intern = db.get(InternProfile, assignment.intern_id)
    if intern is None:
        raise ValueError("The intern record is missing.")
    email = reminder_email(intern, assignment, "before_due")
    log = send_email(db, email, intern.organization_id)
    if log.status == "failed":
        raise ValueError(f"Email delivery failed: {log.error}")
    if intern.user_id:
        notifications.notify(
            db,
            user_id=intern.user_id,
            organization_id=intern.organization_id,
            title=f"Reminder: {assignment.title}",
            body="A scheduled deadline reminder was delivered.",
            kind="reminder_scheduled",
            link="/internflow",
        )
    return f"Reminder recorded for {intern.email} with provider status **{log.status}**."


def _custom_prompt(db: Session, task: ScheduledTask) -> str:
    prompt = (task.config or {}).get("prompt") or task.description or task.title
    provider = get_provider()
    library_hits: list[str] = []
    item_id = (task.config or {}).get("library_item_id")
    attachments = None
    if item_id:
        item = db.get(LibraryItem, item_id)
        if item and item.user_id == task.user_id:
            attachments = [
                AttachmentContext(
                    filename=item.title,
                    kind=item.kind,
                    text=(item.content_text or item.description or "")[:20000],
                )
            ]
    output = "".join(provider.stream_chat([ChatTurn(role="user", content=prompt)], attachments=attachments)).strip()
    if not output:
        raise ValueError("Provider returned no output.")
    return output


HANDLERS = {
    "summarize_document": _summary_for_item,
    "library_summary": _summary_for_item,
    "progress_report": _progress_report,
    "web_check": _web_check,
    "deadline_reminder": _deadline_reminder,
    "custom_prompt": _custom_prompt,
}


def execute_run(db: Session, task: ScheduledTask, run: ScheduledTaskRun) -> None:
    handler = HANDLERS.get(task.task_type)
    try:
        if handler is None:
            raise ValueError(f"Unknown task type '{task.task_type}'.")
        output = handler(db, task)
        run.status = "succeeded"
        run.output = output[:20000]
        run.finished_at = utcnow()
        task.run_count += 1
        task.last_run_at = utcnow()
        task.last_error = None
        if task.schedule_kind == "once":
            task.status = "completed"
            task.next_run_at = None
        else:
            task.next_run_at = compute_next_run(task)
        if task.notify:
            notifications.notify(
                db,
                user_id=task.user_id,
                organization_id=task.organization_id,
                title=f"Scheduled task completed: {task.title}",
                body=(output or "")[:400],
                kind="scheduled_task",
                link="/scheduled",
            )
        db.add(
            ScheduledTaskNotification(
                run_id=run.id, user_id=task.user_id, channel="in_app", status="sent"
            )
        )
    except Exception as exc:
        run.status = "failed"
        run.error = str(exc)[:1000]
        run.finished_at = utcnow()
        task.failure_count += 1
        task.last_error = str(exc)[:1000]
        task.last_run_at = utcnow()
        backoff_minutes = min(30, 2 ** min(5, task.failure_count)) * 5
        if task.failure_count <= 2 and task.status == "active":
            task.next_run_at = utcnow() + timedelta(minutes=backoff_minutes)
            retry_note = f" Retry scheduled in {backoff_minutes} minutes."
        else:
            task.status = "failed"
            task.next_run_at = None
            retry_note = " Automatic retries exhausted."
        notifications.notify(
            db,
            user_id=task.user_id,
            organization_id=task.organization_id,
            title=f"Scheduled task failed: {task.title}",
            body=(str(exc) + retry_note)[:500],
            kind="scheduled_task_failed",
            link="/scheduled",
        )
        logger.warning("Scheduled task %s failed: %s", task.id, exc)
    db.commit()


def run_task_now(db: Session, task: ScheduledTask) -> ScheduledTaskRun:
    if task.status == "cancelled":
        raise ValueError("Cancelled tasks cannot run.")
    slot = utcnow()
    # A manual run gets its own slot; if two manual runs collide, nudge by a microsecond.
    run = create_run(db, task, slot)
    if run is None:
        run = create_run(db, task, slot + timedelta(microseconds=1))
    if run is None:
        raise ValueError("A run is already in progress for this task.")
    execute_run(db, task, run)
    return run


def tick() -> dict:
    stats = {"tasks": 0, "reminders": 0}
    db = SessionLocal()
    try:
        now = utcnow()
        due_tasks = db.scalars(
            select(ScheduledTask)
            .where(
                ScheduledTask.status == "active",
                ScheduledTask.deleted_at.is_(None),
                ScheduledTask.next_run_at.is_not(None),
                ScheduledTask.next_run_at <= now,
            )
            .order_by(ScheduledTask.next_run_at.asc())
            .limit(20)
        ).all()
        for task in due_tasks:
            slot = task.next_run_at
            if slot is None:
                continue
            run = create_run(db, task, slot)
            if run is None:
                # Already claimed by another worker; move forward.
                task.next_run_at = compute_next_run(task, now)
                db.commit()
                continue
            task.next_run_at = compute_next_run(task, now)  # lease before executing
            db.commit()
            execute_run(db, task, run)
            stats["tasks"] += 1
        stats["reminders"] = process_due_reminders(db, now)
    except Exception:
        logger.exception("Scheduler tick failed")
        db.rollback()
    finally:
        db.close()
    return stats


class SchedulerThread:
    def __init__(self, interval: int | None = None) -> None:
        self.interval = interval or settings.scheduler_interval_seconds
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._thread = threading.Thread(target=self._loop, name="nexora-scheduler", daemon=True)
        self._thread.start()
        logger.info("Scheduler started (interval=%ss)", self.interval)

    def _loop(self) -> None:
        while not self._stop.wait(self.interval):
            try:
                tick()
            except Exception:  # pragma: no cover
                logger.exception("Scheduler loop error")

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=5)


scheduler = SchedulerThread()
