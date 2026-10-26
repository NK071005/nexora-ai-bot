"""InternFlow entities: imports, interns, tasks, submissions, evaluations, meetings."""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, IdMixin, TimestampMixin, utcnow


class ImportBatch(Base, IdMixin, TimestampMixin):
    __tablename__ = "import_batches"

    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_by: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="preview", nullable=False)
    row_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    valid_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    error_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    rows: Mapped[list] = mapped_column(default=list, nullable=False)
    errors: Mapped[list] = mapped_column(default=list, nullable=False)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class InternProfile(Base, IdMixin, TimestampMixin):
    __tablename__ = "intern_profiles"
    __table_args__ = (
        UniqueConstraint("organization_id", "email", name="uq_intern_org_email"),
        Index("ix_intern_org_status", "organization_id", "status"),
    )

    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    import_batch_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("import_batches.id", ondelete="SET NULL"), nullable=True
    )
    full_name: Mapped[str] = mapped_column(String(200), nullable=False)
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    department: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    role_title: Mapped[str] = mapped_column(String(160), default="Intern", nullable=False)
    company_name: Mapped[str] = mapped_column(String(200), default="", nullable=False)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    duration_weeks: Mapped[int | None] = mapped_column(Integer, nullable=True)
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Kolkata", nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="invited", nullable=False)
    current_assignment_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    onboarding_email_status: Mapped[str | None] = mapped_column(String(16), nullable=True)
    notes: Mapped[str] = mapped_column(Text, default="", nullable=False)


class TaskTemplate(Base, IdMixin, TimestampMixin):
    __tablename__ = "task_templates"
    __table_args__ = (Index("ix_templates_org_sequence", "organization_id", "sequence_order"),)

    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    created_by: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    objectives: Mapped[list] = mapped_column(default=list, nullable=False)
    expected_methodology: Mapped[str] = mapped_column(Text, default="", nullable=False)
    deliverables: Mapped[list] = mapped_column(default=list, nullable=False)
    acceptance_criteria: Mapped[list] = mapped_column(default=list, nullable=False)
    rubric: Mapped[dict] = mapped_column(default=dict, nullable=False)
    permitted_tools: Mapped[list] = mapped_column(default=list, nullable=False)
    submission_formats: Mapped[list] = mapped_column(default=list, nullable=False)
    deadline_days: Mapped[int] = mapped_column(Integer, default=7, nullable=False)
    review_required: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    pass_threshold: Mapped[float] = mapped_column(Float, default=70.0, nullable=False)
    max_attempts: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    escalation_policy: Mapped[str] = mapped_column(String(40), default="human_review", nullable=False)
    sequence_order: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="active", nullable=False)


class TaskAssignment(Base, IdMixin, TimestampMixin):
    __tablename__ = "task_assignments"
    __table_args__ = (
        Index("ix_assignment_intern_status", "intern_id", "status"),
        Index("ix_assignment_org_status", "organization_id", "status"),
        Index("ix_assignment_due", "status", "due_at"),
    )

    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    intern_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("intern_profiles.id", ondelete="CASCADE"), nullable=False
    )
    template_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("task_templates.id", ondelete="RESTRICT"), nullable=False
    )
    template_version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    sequence_order: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="assigned", nullable=False)
    attempt_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    assigned_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    due_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    assigned_by: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    next_assignment_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    escalation_state: Mapped[str | None] = mapped_column(String(32), nullable=True)

    template: Mapped[TaskTemplate] = relationship(lazy="joined")
    submissions: Mapped[list["Submission"]] = relationship(
        back_populates="assignment", cascade="all, delete-orphan", order_by="Submission.version"
    )


class Submission(Base, IdMixin, TimestampMixin):
    __tablename__ = "submissions"
    __table_args__ = (
        UniqueConstraint("assignment_id", "version", name="uq_submission_version"),
        Index("ix_submission_intern", "intern_id", "submitted_at"),
    )

    assignment_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("task_assignments.id", ondelete="CASCADE"), nullable=False
    )
    intern_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("intern_profiles.id", ondelete="CASCADE"), nullable=False
    )
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    text_content: Mapped[str] = mapped_column(Text, default="", nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="submitted", nullable=False)
    content_sha256: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    submitted_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    assignment: Mapped[TaskAssignment] = relationship(back_populates="submissions")
    files: Mapped[list["SubmissionFile"]] = relationship(
        back_populates="submission", cascade="all, delete-orphan"
    )


class SubmissionFile(Base, IdMixin):
    __tablename__ = "submission_files"

    submission_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("submissions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    file_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("files.id", ondelete="SET NULL"), nullable=True
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    submission: Mapped[Submission] = relationship(back_populates="files")


class Evaluation(Base, IdMixin, TimestampMixin):
    __tablename__ = "evaluations"
    __table_args__ = (Index("ix_evaluation_submission", "submission_id"),)

    submission_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("submissions.id", ondelete="CASCADE"), nullable=False
    )
    assignment_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("task_assignments.id", ondelete="CASCADE"), nullable=False, index=True
    )
    status: Mapped[str] = mapped_column(String(24), nullable=False)
    score: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    confidence: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    summary: Mapped[str] = mapped_column(Text, default="", nullable=False)
    strengths: Mapped[list] = mapped_column(default=list, nullable=False)
    errors: Mapped[list] = mapped_column(default=list, nullable=False)
    missing_requirements: Mapped[list] = mapped_column(default=list, nullable=False)
    corrective_actions: Mapped[list] = mapped_column(default=list, nullable=False)
    human_review_required: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    human_review_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    evaluator: Mapped[str] = mapped_column(String(32), default="rule_engine", nullable=False)
    rubric_version: Mapped[str] = mapped_column(String(32), default="v1", nullable=False)
    decided_by: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    decision: Mapped[str | None] = mapped_column(String(24), nullable=True)
    decision_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    criteria_results: Mapped[list["EvaluationCriterionResult"]] = relationship(
        cascade="all, delete-orphan", lazy="selectin"
    )


class EvaluationCriterionResult(Base, IdMixin):
    __tablename__ = "evaluation_criteria_results"

    evaluation_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("evaluations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    criterion_key: Mapped[str] = mapped_column(String(80), nullable=False)
    label: Mapped[str] = mapped_column(String(240), nullable=False)
    mandatory: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    weight: Mapped[float] = mapped_column(Float, default=1.0, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    score: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    evidence: Mapped[str] = mapped_column(Text, default="", nullable=False)
    comment: Mapped[str] = mapped_column(Text, default="", nullable=False)


class Meeting(Base, IdMixin, TimestampMixin):
    __tablename__ = "meetings"
    __table_args__ = (Index("ix_meeting_org_status", "organization_id", "status"),)

    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    intern_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("intern_profiles.id", ondelete="CASCADE"), nullable=False
    )
    assignment_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("task_assignments.id", ondelete="SET NULL"), nullable=True
    )
    evaluation_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("evaluations.id", ondelete="SET NULL"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(240), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="proposed", nullable=False)
    start_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    end_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Kolkata", nullable=False)
    meet_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    calendar_event_id: Mapped[str | None] = mapped_column(String(500), nullable=True)
    provider: Mapped[str] = mapped_column(String(16), default="demo", nullable=False)
    created_by: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    notes: Mapped[str] = mapped_column(Text, default="", nullable=False)


class EmailLog(Base, IdMixin):
    __tablename__ = "email_logs"
    __table_args__ = (Index("ix_email_org_created", "organization_id", "created_at"),)

    organization_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True
    )
    to_email: Mapped[str] = mapped_column(String(320), nullable=False)
    subject: Mapped[str] = mapped_column(String(300), nullable=False)
    body_text: Mapped[str] = mapped_column(Text, default="", nullable=False)
    body_html: Mapped[str] = mapped_column(Text, default="", nullable=False)
    kind: Mapped[str] = mapped_column(String(40), default="general", nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="queued", nullable=False)
    provider: Mapped[str] = mapped_column(String(16), default="demo", nullable=False)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    related_type: Mapped[str | None] = mapped_column(String(40), nullable=True)
    related_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


class ReminderJob(Base, IdMixin):
    __tablename__ = "reminder_jobs"
    __table_args__ = (
        UniqueConstraint("assignment_id", "kind", "scheduled_for", name="uq_reminder_slot"),
        Index("ix_reminder_due", "status", "scheduled_for"),
    )

    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    assignment_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("task_assignments.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(24), nullable=False)
    scheduled_for: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="pending", nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


class Notification(Base, IdMixin):
    __tablename__ = "notifications"
    __table_args__ = (Index("ix_notification_user_read", "user_id", "read_at", "created_at"),)

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    organization_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(240), nullable=False)
    body: Mapped[str] = mapped_column(Text, default="", nullable=False)
    kind: Mapped[str] = mapped_column(String(40), default="system", nullable=False)
    link: Mapped[str | None] = mapped_column(String(300), nullable=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


class HumanReviewDecision(Base, IdMixin):
    __tablename__ = "human_review_decisions"

    evaluation_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("evaluations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    reviewer_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    decision: Mapped[str] = mapped_column(String(24), nullable=False)
    notes: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
