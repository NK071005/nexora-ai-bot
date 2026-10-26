"""Scheduled automation contracts."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, model_validator

from app.schemas.common import ORMModel, UTCDateTime


class TaskTypeOut(BaseModel):
    key: str
    label: str
    description: str
    config_fields: list[str]
    requires_organization: bool = False
    requires_search: bool = False


class ScheduledTaskCreate(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    description: str = Field(default="", max_length=4000)
    task_type: str = Field(min_length=2, max_length=40)
    schedule_kind: str = Field(pattern="^(once|daily|weekly|monthly)$")
    timezone: str = Field(default="Asia/Kolkata", max_length=64)
    run_at: datetime | None = None
    time_of_day: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    day_of_week: int | None = Field(default=None, ge=0, le=6)
    day_of_month: int | None = Field(default=None, ge=1, le=28)
    notify: bool = True
    config: dict = Field(default_factory=dict)

    @model_validator(mode="after")
    def _validate_schedule(self) -> "ScheduledTaskCreate":
        if self.schedule_kind == "once" and self.run_at is None:
            raise ValueError("A one-time task requires run_at.")
        if self.schedule_kind in {"daily", "weekly", "monthly"} and not self.time_of_day:
            raise ValueError("A recurring task requires time_of_day (HH:MM).")
        if self.schedule_kind == "weekly" and self.day_of_week is None:
            raise ValueError("A weekly task requires day_of_week (0=Monday).")
        if self.schedule_kind == "monthly" and self.day_of_month is None:
            raise ValueError("A monthly task requires day_of_month.")
        return self


class ScheduledTaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=2, max_length=200)
    description: str | None = Field(default=None, max_length=4000)
    schedule_kind: str | None = Field(default=None, pattern="^(once|daily|weekly|monthly)$")
    timezone: str | None = Field(default=None, max_length=64)
    run_at: datetime | None = None
    time_of_day: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    day_of_week: int | None = Field(default=None, ge=0, le=6)
    day_of_month: int | None = Field(default=None, ge=1, le=28)
    notify: bool | None = None
    config: dict | None = None
    status: str | None = Field(default=None, pattern="^(active|paused|cancelled)$")


class ScheduledTaskOut(ORMModel):
    id: str
    title: str
    description: str
    task_type: str
    schedule_kind: str
    timezone: str
    run_at: UTCDateTime | None = None
    time_of_day: str | None = None
    day_of_week: int | None = None
    day_of_month: int | None = None
    next_run_at: UTCDateTime | None = None
    last_run_at: UTCDateTime | None = None
    status: str
    run_count: int
    failure_count: int
    last_error: str | None = None
    notify: bool
    config: dict
    created_at: UTCDateTime
    updated_at: UTCDateTime


class ScheduledRunOut(ORMModel):
    id: str
    task_id: str
    scheduled_for: UTCDateTime
    started_at: UTCDateTime
    finished_at: UTCDateTime | None = None
    status: str
    attempt: int
    output: str | None = None
    error: str | None = None
    created_at: UTCDateTime


class ScheduledTaskDetail(BaseModel):
    task: ScheduledTaskOut
    runs: list[ScheduledRunOut]
    handlers: list[TaskTypeOut]


class ScheduleMeta(BaseModel):
    task_types: list[TaskTypeOut]
    scheduler_enabled: bool
    timezones: list[str]
