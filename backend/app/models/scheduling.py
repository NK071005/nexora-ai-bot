"""Scheduled automations, runs and search persistence."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, IdMixin, SoftDeleteMixin, TimestampMixin, utcnow


class ScheduledTask(Base, IdMixin, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "scheduled_tasks"
    __table_args__ = (
        Index("ix_scheduled_due", "status", "next_run_at"),
        Index("ix_scheduled_user", "user_id", "status"),
    )

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    organization_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    task_type: Mapped[str] = mapped_column(String(40), nullable=False)
    schedule_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Kolkata", nullable=False)
    run_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    time_of_day: Mapped[str | None] = mapped_column(String(5), nullable=True)
    day_of_week: Mapped[int | None] = mapped_column(Integer, nullable=True)
    day_of_month: Mapped[int | None] = mapped_column(Integer, nullable=True)
    next_run_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="active", nullable=False)
    run_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    failure_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    notify: Mapped[bool] = mapped_column(default=True, nullable=False)
    config: Mapped[dict] = mapped_column(default=dict, nullable=False)


class ScheduledTaskRun(Base, IdMixin):
    __tablename__ = "scheduled_task_runs"
    __table_args__ = (
        UniqueConstraint("task_id", "scheduled_for", name="uq_task_run_slot"),
        Index("ix_task_runs_task_created", "task_id", "created_at"),
    )

    task_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("scheduled_tasks.id", ondelete="CASCADE"), nullable=False
    )
    scheduled_for: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="running", nullable=False)
    attempt: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    output: Mapped[str | None] = mapped_column(Text, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


class ScheduledTaskNotification(Base, IdMixin):
    __tablename__ = "scheduled_task_notifications"

    run_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("scheduled_task_runs.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    channel: Mapped[str] = mapped_column(String(16), default="in_app", nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="queued", nullable=False)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


class SearchJob(Base, IdMixin):
    __tablename__ = "search_jobs"

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    query: Mapped[str] = mapped_column(String(500), nullable=False)
    scope: Mapped[str] = mapped_column(String(16), nullable=False)
    provider: Mapped[str] = mapped_column(String(32), default="none", nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="completed", nullable=False)
    result_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


class SearchResult(Base, IdMixin):
    __tablename__ = "search_results"
    __table_args__ = (Index("ix_search_results_job", "search_job_id", "rank"),)

    search_job_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("search_jobs.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(400), nullable=False)
    url: Mapped[str] = mapped_column(String(1000), nullable=False)
    snippet: Mapped[str] = mapped_column(Text, default="", nullable=False)
    domain: Mapped[str] = mapped_column(String(200), default="", nullable=False)
    published_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    rank: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
