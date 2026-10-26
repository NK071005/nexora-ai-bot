"""InternFlow API contracts: interns, templates, assignments, evaluations, meetings."""

from __future__ import annotations

from pydantic import BaseModel, Field, field_validator

from app.schemas.common import ORMModel, UTCDateTime


class TaskTemplateCreate(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    slug: str = Field(min_length=2, max_length=120, pattern=r"^[a-z0-9][a-z0-9-]*$")
    description: str = Field(min_length=10, max_length=8000)
    objectives: list[str] = Field(default_factory=list, max_length=20)
    expected_methodology: str = Field(default="", max_length=6000)
    deliverables: list[str] = Field(default_factory=list, max_length=20)
    acceptance_criteria: list[dict] = Field(default_factory=list, max_length=30)
    rubric: dict = Field(default_factory=dict)
    permitted_tools: list[str] = Field(default_factory=list, max_length=20)
    submission_formats: list[str] = Field(default_factory=list, max_length=20)
    deadline_days: int = Field(default=7, ge=1, le=90)
    review_required: bool = True
    pass_threshold: float = Field(default=70.0, ge=0, le=100)
    max_attempts: int = Field(default=3, ge=1, le=10)
    escalation_policy: str = Field(default="human_review", pattern="^(human_review|auto_fail|notify_admin)$")
    sequence_order: int = Field(default=1, ge=1, le=100)
    status: str = Field(default="active", pattern="^(active|draft|archived)$")

    @field_validator("acceptance_criteria")
    @classmethod
    def _validate_criteria(cls, criteria: list[dict]) -> list[dict]:
        allowed = {"keywords", "min_words", "table", "sections", "min_count", "forbidden", "file", "manual"}
        for index, criterion in enumerate(criteria, start=1):
            if not isinstance(criterion, dict):
                raise ValueError(f"Criterion {index} must be an object.")
            kind = str(criterion.get("type") or "keywords")
            if kind not in allowed:
                raise ValueError(f"Criterion {index} has unsupported type '{kind}'.")
            if not criterion.get("key"):
                raise ValueError(f"Criterion {index} requires a key.")
        return criteria


class TaskTemplateUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=3, max_length=200)
    description: str | None = Field(default=None, min_length=10, max_length=8000)
    objectives: list[str] | None = None
    expected_methodology: str | None = Field(default=None, max_length=6000)
    deliverables: list[str] | None = None
    acceptance_criteria: list[dict] | None = None
    rubric: dict | None = None
    permitted_tools: list[str] | None = None
    submission_formats: list[str] | None = None
    deadline_days: int | None = Field(default=None, ge=1, le=90)
    review_required: bool | None = None
    pass_threshold: float | None = Field(default=None, ge=0, le=100)
    max_attempts: int | None = Field(default=None, ge=1, le=10)
    escalation_policy: str | None = Field(default=None, pattern="^(human_review|auto_fail|notify_admin)$")
    sequence_order: int | None = Field(default=None, ge=1, le=100)
    status: str | None = Field(default=None, pattern="^(active|draft|archived)$")


class TaskTemplateOut(ORMModel):
    id: str
    title: str
    slug: str
    description: str
    objectives: list[str]
    expected_methodology: str
    deliverables: list[str]
    acceptance_criteria: list[dict]
    rubric: dict
    permitted_tools: list[str]
    submission_formats: list[str]
    deadline_days: int
    review_required: bool
    pass_threshold: float
    max_attempts: int
    escalation_policy: str
    sequence_order: int
    version: int
    status: str
    created_at: UTCDateTime
    updated_at: UTCDateTime


class InternUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=200)
    department: str | None = Field(default=None, max_length=120)
    role_title: str | None = Field(default=None, max_length=160)
    company_name: str | None = Field(default=None, max_length=200)
    timezone: str | None = Field(default=None, max_length=64)
    status: str | None = Field(default=None, pattern="^(invited|active|completed|paused|withdrawn)$")
    notes: str | None = Field(default=None, max_length=4000)


class InternOut(BaseModel):
    id: str
    user_id: str | None = None
    full_name: str
    email: str
    department: str
    role_title: str
    company_name: str
    start_date: str | None = None
    end_date: str | None = None
    duration_weeks: int | None = None
    timezone: str
    status: str
    onboarding_email_status: str | None = None
    current_assignment_id: str | None = None
    current_task: str | None = None
    current_status: str | None = None
    due_at: UTCDateTime | None = None
    overdue: bool = False
    tasks_total: int = 0
    tasks_approved: int = 0
    notes: str = ""
    created_at: UTCDateTime


class AssignmentOut(ORMModel):
    id: str
    intern_id: str
    template_id: str
    template_version: int
    title: str
    sequence_order: int
    status: str
    attempt_count: int
    assigned_at: UTCDateTime
    due_at: UTCDateTime | None = None
    approved_at: UTCDateTime | None = None
    completed_at: UTCDateTime | None = None
    escalation_state: str | None = None
    next_assignment_id: str | None = None
    template: TaskTemplateOut | None = None


class SubmissionFileOut(ORMModel):
    id: str
    filename: str
    mime_type: str
    size_bytes: int
    sha256: str
    created_at: UTCDateTime


class SubmissionOut(ORMModel):
    id: str
    assignment_id: str
    intern_id: str
    version: int
    text_content: str
    status: str
    submitted_at: UTCDateTime
    files: list[SubmissionFileOut] = Field(default_factory=list)


class CriterionResultOut(ORMModel):
    id: str
    criterion_key: str
    label: str
    mandatory: bool
    weight: float
    status: str
    score: float
    evidence: str
    comment: str


class EvaluationOut(ORMModel):
    id: str
    submission_id: str
    assignment_id: str
    status: str
    score: float
    confidence: float
    summary: str
    strengths: list[str]
    errors: list[str]
    missing_requirements: list[str]
    corrective_actions: list[str]
    human_review_required: bool
    human_review_reason: str | None = None
    evaluator: str
    rubric_version: str
    decision: str | None = None
    decision_note: str | None = None
    decided_at: UTCDateTime | None = None
    created_at: UTCDateTime
    criteria_results: list[CriterionResultOut] = Field(default_factory=list)


class SubmissionResultOut(BaseModel):
    submission: SubmissionOut
    evaluation: EvaluationOut
    assignment: AssignmentOut
    message: str


class DecisionRequest(BaseModel):
    decision: str = Field(pattern="^(approve|request_corrections|escalate)$")
    note: str = Field(default="", max_length=4000)


class AssignTaskRequest(BaseModel):
    template_id: str
    due_days: int | None = Field(default=None, ge=1, le=90)
    send_notification: bool = True


class AssignmentUpdate(BaseModel):
    due_at: str | None = Field(default=None, max_length=40)
    status: str | None = Field(
        default=None,
        pattern="^(assigned|corrections_required|overdue|submitted|human_review_required|approved|completed|cancelled)$",
    )
    escalation_state: str | None = Field(default=None, max_length=32)


class ImportRowOut(BaseModel):
    row_number: int
    values: dict
    errors: list[str] = Field(default_factory=list)


class ImportBatchOut(BaseModel):
    id: str
    filename: str
    status: str
    row_count: int
    valid_count: int
    error_count: int
    rows: list[ImportRowOut] = Field(default_factory=list)
    errors: list[dict] = Field(default_factory=list)
    column_mapping: dict = Field(default_factory=dict)
    created_at: UTCDateTime
    confirmed_at: UTCDateTime | None = None


class MeetingOut(ORMModel):
    id: str
    intern_id: str
    assignment_id: str | None = None
    evaluation_id: str | None = None
    title: str
    status: str
    start_at: UTCDateTime | None = None
    end_at: UTCDateTime | None = None
    timezone: str
    meet_url: str | None = None
    provider: str
    notes: str
    created_at: UTCDateTime


class MeetingUpdate(BaseModel):
    status: str = Field(pattern="^(proposed|scheduled|completed|cancelled)$")
    start_at: str | None = Field(default=None, max_length=40)
    notes: str | None = Field(default=None, max_length=4000)


class EmailLogOut(ORMModel):
    id: str
    to_email: str
    subject: str
    kind: str
    status: str
    provider: str
    error: str | None = None
    sent_at: UTCDateTime | None = None
    created_at: UTCDateTime


class InternDetailOut(BaseModel):
    intern: InternOut
    assignments: list[AssignmentOut]
    submissions: list[SubmissionOut]
    evaluations: list[EvaluationOut]
    meetings: list[MeetingOut]
    emails: list[EmailLogOut]


class EvaluationListOut(BaseModel):
    items: list[EvaluationOut]
    total: int
    limit: int
    offset: int


class InternListOut(BaseModel):
    items: list[InternOut]
    total: int
    limit: int
    offset: int
    summary: dict


class OverviewOut(BaseModel):
    summary: dict
    recent_evaluations: list[EvaluationOut]
    upcoming_meetings: list[MeetingOut]
    templates: int


class InternSelfOut(BaseModel):
    intern: InternOut
    current_assignment: AssignmentOut | None = None
    assignments: list[AssignmentOut]
    submissions: list[SubmissionOut]
    evaluations: list[EvaluationOut]
    meetings: list[MeetingOut]
    next_meeting: MeetingOut | None = None


class InternChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)


class InternChatResponse(BaseModel):
    chat_id: str
    reply: str
    intent: str


class ProgressResponse(BaseModel):
    organization_id: str
    interns_total: int
    active: int
    completed: int
    overdue: int
    tasks_approved: int
    tasks_pending: int
    interns: list[dict]
