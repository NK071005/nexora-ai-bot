"""InternFlow: imports, onboarding, task templates, assignments, evaluation and meetings."""

from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from fastapi.responses import FileResponse, Response
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.agent.orchestrator import agent
from app.config import settings
from app.database import get_db
from app.deps import AuthContext, OrgContext, get_auth, get_org_context, require_admin_ctx
from app.errors import AppError, conflict, forbidden, not_found
from app.models import (
    AccountActivationToken,
    AuditLog,
    ChatMessage,
    ChatSession,
    EmailLog,
    Evaluation,
    ImportBatch,
    InternProfile,
    Meeting,
    Organization,
    OrganizationMembership,
    Submission,
    SubmissionFile,
    TaskAssignment,
    TaskTemplate,
    User,
    utcnow,
)
from app.schemas.internflow import (
    AssignmentOut,
    AssignmentUpdate,
    AssignTaskRequest,
    CriterionResultOut,
    DecisionRequest,
    EmailLogOut,
    EvaluationListOut,
    EvaluationOut,
    ImportBatchOut,
    InternChatRequest,
    InternChatResponse,
    InternDetailOut,
    InternListOut,
    InternOut,
    InternSelfOut,
    InternUpdate,
    MeetingOut,
    MeetingUpdate,
    OverviewOut,
    ProgressResponse,
    SubmissionFileOut,
    SubmissionOut,
    SubmissionResultOut,
    TaskTemplateCreate,
    TaskTemplateOut,
    TaskTemplateUpdate,
)
from app.security.passwords import expiry, hash_token, new_opaque_token
from app.services import notifications
from app.services.calendar import meeting_ics
from app.services.email import OutgoingEmail, send_email
from app.services.extraction import extract_text
from app.services.internflow import (
    confirm_import,
    create_assignment,
    create_import_batch,
    decide_evaluation,
    get_intern_for_user,
    intern_context,
    map_columns,
    parse_import_file,
    progress_summary,
    submit_work,
)
from app.services.storage import delete_storage_key, resolve_path, save_upload

router = APIRouter(prefix="/internflow", tags=["internflow"])

ALLOWED_CRITERIA = {"keywords", "min_words", "table", "sections", "min_count", "forbidden", "file", "manual"}


# ---------------------------------------------------------------------------
# Serialization helpers
# ---------------------------------------------------------------------------


def _assignment_out(assignment: TaskAssignment) -> AssignmentOut:
    return AssignmentOut(
        id=assignment.id,
        intern_id=assignment.intern_id,
        template_id=assignment.template_id,
        template_version=assignment.template_version,
        title=assignment.title,
        sequence_order=assignment.sequence_order,
        status=assignment.status,
        attempt_count=assignment.attempt_count,
        assigned_at=assignment.assigned_at,
        due_at=assignment.due_at,
        approved_at=assignment.approved_at,
        completed_at=assignment.completed_at,
        escalation_state=assignment.escalation_state,
        next_assignment_id=assignment.next_assignment_id,
        template=TaskTemplateOut.model_validate(assignment.template) if assignment.template else None,
    )


def _submission_out(submission: Submission) -> SubmissionOut:
    return SubmissionOut(
        id=submission.id,
        assignment_id=submission.assignment_id,
        intern_id=submission.intern_id,
        version=submission.version,
        text_content=submission.text_content,
        status=submission.status,
        submitted_at=submission.submitted_at,
        files=[SubmissionFileOut.model_validate(item) for item in submission.files],
    )


def _evaluation_out(evaluation: Evaluation) -> EvaluationOut:
    return EvaluationOut(
        id=evaluation.id,
        submission_id=evaluation.submission_id,
        assignment_id=evaluation.assignment_id,
        status=evaluation.status,
        score=evaluation.score,
        confidence=evaluation.confidence,
        summary=evaluation.summary,
        strengths=evaluation.strengths or [],
        errors=evaluation.errors or [],
        missing_requirements=evaluation.missing_requirements or [],
        corrective_actions=evaluation.corrective_actions or [],
        human_review_required=evaluation.human_review_required,
        human_review_reason=evaluation.human_review_reason,
        evaluator=evaluation.evaluator,
        rubric_version=evaluation.rubric_version,
        decision=evaluation.decision,
        decision_note=evaluation.decision_note,
        decided_at=evaluation.decided_at,
        created_at=evaluation.created_at,
        criteria_results=[CriterionResultOut.model_validate(c) for c in evaluation.criteria_results],
    )


def _intern_out(db: Session, intern: InternProfile) -> InternOut:
    assignments = db.scalars(
        select(TaskAssignment).where(TaskAssignment.intern_id == intern.id)
    ).all()
    current = db.get(TaskAssignment, intern.current_assignment_id) if intern.current_assignment_id else None
    approved = [assignment for assignment in assignments if assignment.status == "approved"]
    overdue = bool(
        current
        and current.due_at
        and current.due_at < utcnow()
        and current.status in {"assigned", "corrections_required", "overdue"}
    )
    return InternOut(
        id=intern.id,
        user_id=intern.user_id,
        full_name=intern.full_name,
        email=intern.email,
        department=intern.department,
        role_title=intern.role_title,
        company_name=intern.company_name,
        start_date=intern.start_date.isoformat() if intern.start_date else None,
        end_date=intern.end_date.isoformat() if intern.end_date else None,
        duration_weeks=intern.duration_weeks,
        timezone=intern.timezone,
        status=intern.status,
        onboarding_email_status=intern.onboarding_email_status,
        current_assignment_id=intern.current_assignment_id,
        current_task=current.title if current else None,
        current_status=current.status if current else None,
        due_at=current.due_at if current else None,
        overdue=overdue,
        tasks_total=len(assignments),
        tasks_approved=len(approved),
        notes=intern.notes,
        created_at=intern.created_at,
    )


def _intern_detail(db: Session, intern: InternProfile) -> InternDetailOut:
    assignments = db.scalars(
        select(TaskAssignment)
        .where(TaskAssignment.intern_id == intern.id)
        .order_by(TaskAssignment.sequence_order)
    ).all()
    submissions = db.scalars(
        select(Submission)
        .where(Submission.intern_id == intern.id)
        .order_by(Submission.submitted_at.desc())
    ).all()
    evaluations = db.scalars(
        select(Evaluation)
        .join(TaskAssignment, Evaluation.assignment_id == TaskAssignment.id)
        .where(TaskAssignment.intern_id == intern.id)
        .order_by(Evaluation.created_at.desc())
    ).all()
    meetings = db.scalars(
        select(Meeting)
        .where(Meeting.intern_id == intern.id)
        .order_by(Meeting.start_at.desc())
    ).all()
    emails = db.scalars(
        select(EmailLog)
        .where(EmailLog.organization_id == intern.organization_id, EmailLog.to_email == intern.email)
        .order_by(EmailLog.created_at.desc())
        .limit(50)
    ).all()
    return InternDetailOut(
        intern=_intern_out(db, intern),
        assignments=[_assignment_out(a) for a in assignments],
        submissions=[_submission_out(s) for s in submissions],
        evaluations=[_evaluation_out(e) for e in evaluations],
        meetings=[MeetingOut.model_validate(m) for m in meetings],
        emails=[EmailLogOut.model_validate(e) for e in emails],
    )


def _intern_for_org(db: Session, org_id: str, intern_id: str) -> InternProfile:
    intern = db.get(InternProfile, intern_id)
    if intern is None or intern.organization_id != org_id:
        raise not_found("Intern")
    return intern


def _validate_criteria(criteria: list[dict]) -> None:
    for index, criterion in enumerate(criteria, start=1):
        if not isinstance(criterion, dict):
            raise AppError(422, "invalid_criteria", f"Criterion {index} must be an object.")
        if str(criterion.get("type") or "keywords") not in ALLOWED_CRITERIA:
            raise AppError(422, "invalid_criteria", f"Criterion {index} has an unsupported type.")
        if not criterion.get("key"):
            raise AppError(422, "invalid_criteria", f"Criterion {index} requires a key.")


def _can_access_submission(db: Session, user: User, org: OrgContext, submission: Submission) -> bool:
    if org.is_admin:
        assignment = db.get(TaskAssignment, submission.assignment_id)
        return bool(assignment and assignment.organization_id == org.organization.id)
    intern = get_intern_for_user(db, user, org.organization.id)
    return bool(intern and submission.intern_id == intern.id)


# ---------------------------------------------------------------------------
# Admin overview, interns and templates
# ---------------------------------------------------------------------------


@router.get("/overview", response_model=OverviewOut)
def overview(
    org: OrgContext = Depends(require_admin_ctx), db: Session = Depends(get_db)
) -> OverviewOut:
    summary = progress_summary(db, org.organization.id)
    evaluations = db.scalars(
        select(Evaluation)
        .join(TaskAssignment, Evaluation.assignment_id == TaskAssignment.id)
        .where(TaskAssignment.organization_id == org.organization.id)
        .order_by(Evaluation.created_at.desc())
        .limit(6)
    ).all()
    meetings = db.scalars(
        select(Meeting)
        .where(
            Meeting.organization_id == org.organization.id,
            Meeting.status.in_(["proposed", "scheduled"]),
        )
        .order_by(Meeting.start_at.asc())
        .limit(6)
    ).all()
    templates = db.scalar(
        select(func.count(TaskTemplate.id)).where(
            TaskTemplate.organization_id == org.organization.id,
            TaskTemplate.status == "active",
        )
    ) or 0
    return OverviewOut(
        summary=summary,
        recent_evaluations=[_evaluation_out(e) for e in evaluations],
        upcoming_meetings=[MeetingOut.model_validate(m) for m in meetings],
        templates=int(templates),
    )


@router.get("/interns", response_model=InternListOut)
def list_interns(
    q: str | None = Query(default=None, max_length=200),
    status: str | None = Query(default=None, max_length=24),
    department: str | None = Query(default=None, max_length=120),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    org: OrgContext = Depends(require_admin_ctx),
    db: Session = Depends(get_db),
) -> InternListOut:
    stmt = select(InternProfile).where(InternProfile.organization_id == org.organization.id)
    if q:
        pattern = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                InternProfile.full_name.ilike(pattern),
                InternProfile.email.ilike(pattern),
                InternProfile.department.ilike(pattern),
            )
        )
    if status:
        stmt = stmt.where(InternProfile.status == status)
    if department:
        stmt = stmt.where(InternProfile.department == department)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    interns = db.scalars(
        stmt.order_by(InternProfile.full_name).limit(limit).offset(offset)
    ).all()
    return InternListOut(
        items=[_intern_out(db, intern) for intern in interns],
        total=int(total),
        limit=limit,
        offset=offset,
        summary=progress_summary(db, org.organization.id),
    )


@router.get("/interns/{intern_id}", response_model=InternDetailOut)
def get_intern(
    intern_id: str,
    org: OrgContext = Depends(require_admin_ctx),
    db: Session = Depends(get_db),
) -> InternDetailOut:
    return _intern_detail(db, _intern_for_org(db, org.organization.id, intern_id))


@router.patch("/interns/{intern_id}", response_model=InternOut)
def update_intern(
    intern_id: str,
    payload: InternUpdate,
    org: OrgContext = Depends(require_admin_ctx),
    db: Session = Depends(get_db),
) -> InternOut:
    intern = _intern_for_org(db, org.organization.id, intern_id)
    for field in ("full_name", "department", "role_title", "company_name", "timezone", "status", "notes"):
        value = getattr(payload, field)
        if value is not None:
            setattr(intern, field, value)
    if payload.full_name:
        user = db.get(User, intern.user_id) if intern.user_id else None
        if user:
            user.full_name = payload.full_name
    notifications.audit(
        db,
        actor_id=org.organization.id and None,
        action="intern_updated",
        entity_type="intern",
        entity_id=intern.id,
        organization_id=org.organization.id,
        metadata={"fields": payload.model_dump(exclude_none=True)},
    )
    db.commit()
    return _intern_out(db, intern)


@router.post("/interns/{intern_id}/assign", response_model=AssignmentOut, status_code=201)
def assign_task(
    intern_id: str,
    payload: AssignTaskRequest,
    auth: AuthContext = Depends(get_auth),
    org: OrgContext = Depends(require_admin_ctx),
    db: Session = Depends(get_db),
) -> AssignmentOut:
    intern = _intern_for_org(db, org.organization.id, intern_id)
    template = db.get(TaskTemplate, payload.template_id)
    if template is None or template.organization_id != org.organization.id:
        raise not_found("Task template")
    if template.status != "active":
        raise AppError(422, "template_inactive", "Activate the template before assigning it.")
    assignment = create_assignment(
        db,
        intern=intern,
        template=template,
        assigned_by=auth.user.id,
        due_days=payload.due_days,
        send_notification=payload.send_notification,
    )
    notifications.audit(
        db,
        actor_id=auth.user.id,
        action="task_assigned",
        entity_type="assignment",
        entity_id=assignment.id,
        organization_id=org.organization.id,
        metadata={"intern_id": intern.id, "template_id": template.id},
    )
    db.commit()
    db.refresh(assignment)
    return _assignment_out(assignment)


@router.post("/interns/{intern_id}/resend-invite")
def resend_invite(
    intern_id: str,
    auth: AuthContext = Depends(get_auth),
    org: OrgContext = Depends(require_admin_ctx),
    db: Session = Depends(get_db),
) -> dict:
    intern = _intern_for_org(db, org.organization.id, intern_id)
    user = db.get(User, intern.user_id) if intern.user_id else None
    if user is None:
        raise AppError(422, "no_linked_user", "This intern has no linked account. Re-import the row to create one.")
    token = new_opaque_token()
    db.add(
        AccountActivationToken(
            user_id=user.id,
            token_hash=hash_token(token),
            expires_at=expiry(hours=settings.activation_ttl_hours),
        )
    )
    url = f"{settings.frontend_url}/activate?token={token}"
    log = send_email(
        db,
        OutgoingEmail(
            to_email=intern.email,
            subject="Your NEXORA InternFlow invitation",
            body_text=(
                f"Hello {intern.full_name},\n\n"
                "Use this single-use link to set your password and access InternFlow:\n"
                f"{url}\n\n"
                f"The link expires in {settings.activation_ttl_hours} hours."
            ),
            body_html=(
                f"<p>Hello {intern.full_name},</p><p>Set your InternFlow password:</p>"
                f'<p><a href="{url}">Activate your account</a></p>'
                f"<p>The link expires in {settings.activation_ttl_hours} hours.</p>"
            ),
            kind="activation_resend",
            related_type="intern",
            related_id=intern.id,
        ),
        org.organization.id,
    )
    intern.onboarding_email_status = log.status
    notifications.audit(
        db,
        actor_id=auth.user.id,
        action="invite_resent",
        entity_type="intern",
        entity_id=intern.id,
        organization_id=org.organization.id,
        metadata={"email_status": log.status},
    )
    db.commit()
    return {
        "ok": True,
        "email_status": log.status,
        "email_mode": "smtp" if settings.email_configured else "demo",
        "message": (
            "Invitation email sent."
            if log.status == "sent"
            else "Demo email recorded (no message left this machine)."
        ),
    }


@router.get("/templates", response_model=list[TaskTemplateOut])
def list_templates(
    include_archived: bool = False,
    org: OrgContext = Depends(require_admin_ctx),
    db: Session = Depends(get_db),
) -> list[TaskTemplateOut]:
    stmt = select(TaskTemplate).where(TaskTemplate.organization_id == org.organization.id)
    if not include_archived:
        stmt = stmt.where(TaskTemplate.status != "archived")
    templates = db.scalars(stmt.order_by(TaskTemplate.sequence_order, TaskTemplate.title)).all()
    return [TaskTemplateOut.model_validate(template) for template in templates]


@router.post("/templates", response_model=TaskTemplateOut, status_code=201)
def create_template(
    payload: TaskTemplateCreate,
    auth: AuthContext = Depends(get_auth),
    org: OrgContext = Depends(require_admin_ctx),
    db: Session = Depends(get_db),
) -> TaskTemplateOut:
    _validate_criteria(payload.acceptance_criteria)
    exists = db.scalar(
        select(TaskTemplate).where(
            TaskTemplate.organization_id == org.organization.id,
            TaskTemplate.slug == payload.slug,
        )
    )
    if exists:
        raise conflict("A template with this slug already exists in this organization.")
    template = TaskTemplate(
        organization_id=org.organization.id,
        created_by=auth.user.id,
        **payload.model_dump(),
    )
    db.add(template)
    db.commit()
    db.refresh(template)
    notifications.audit(
        db,
        actor_id=auth.user.id,
        action="template_created",
        entity_type="task_template",
        entity_id=template.id,
        organization_id=org.organization.id,
    )
    db.commit()
    return TaskTemplateOut.model_validate(template)


@router.get("/templates/{template_id}", response_model=TaskTemplateOut)
def get_template(
    template_id: str,
    org: OrgContext = Depends(require_admin_ctx),
    db: Session = Depends(get_db),
) -> TaskTemplateOut:
    template = db.get(TaskTemplate, template_id)
    if template is None or template.organization_id != org.organization.id:
        raise not_found("Task template")
    return TaskTemplateOut.model_validate(template)


@router.patch("/templates/{template_id}", response_model=TaskTemplateOut)
def update_template(
    template_id: str,
    payload: TaskTemplateUpdate,
    auth: AuthContext = Depends(get_auth),
    org: OrgContext = Depends(require_admin_ctx),
    db: Session = Depends(get_db),
) -> TaskTemplateOut:
    template = db.get(TaskTemplate, template_id)
    if template is None or template.organization_id != org.organization.id:
        raise not_found("Task template")
    changes = payload.model_dump(exclude_unset=True)
    if "acceptance_criteria" in changes and changes["acceptance_criteria"] is not None:
        _validate_criteria(changes["acceptance_criteria"])
    for field, value in changes.items():
        setattr(template, field, value)
    if changes:
        template.version += 1
    db.commit()
    notifications.audit(
        db,
        actor_id=auth.user.id,
        action="template_updated",
        entity_type="task_template",
        entity_id=template.id,
        organization_id=org.organization.id,
        metadata={"version": template.version, "fields": list(changes)},
    )
    db.commit()
    db.refresh(template)
    return TaskTemplateOut.model_validate(template)


@router.delete("/templates/{template_id}")
def archive_template(
    template_id: str,
    auth: AuthContext = Depends(get_auth),
    org: OrgContext = Depends(require_admin_ctx),
    db: Session = Depends(get_db),
) -> dict:
    template = db.get(TaskTemplate, template_id)
    if template is None or template.organization_id != org.organization.id:
        raise not_found("Task template")
    template.status = "archived"
    notifications.audit(
        db,
        actor_id=auth.user.id,
        action="template_archived",
        entity_type="task_template",
        entity_id=template.id,
        organization_id=org.organization.id,
    )
    db.commit()
    return {"ok": True, "message": "Template archived. Existing assignments are preserved."}


# ---------------------------------------------------------------------------
# Imports
# ---------------------------------------------------------------------------


@router.post("/imports", response_model=ImportBatchOut, status_code=201)
def preview_import(
    file: UploadFile = File(...),
    auth: AuthContext = Depends(get_auth),
    org: OrgContext = Depends(require_admin_ctx),
    db: Session = Depends(get_db),
) -> ImportBatchOut:
    extension = Path(file.filename or "").suffix.lower()
    if extension not in {".xlsx", ".xls", ".csv"}:
        raise AppError(415, "unsupported_import", "Upload an .xlsx, .xls or .csv file.")
    stored = save_upload(file, user_id=auth.user.id, organization_id=org.organization.id)
    path = resolve_path(stored.storage_key)
    try:
        columns, rows, errors = parse_import_file(path, extension)
    except Exception:
        delete_storage_key(stored.storage_key)
        raise
    record = __import__("app.models", fromlist=["File"]).File(
        user_id=auth.user.id,
        organization_id=org.organization.id,
        original_name=(file.filename or stored.safe_name)[:255],
        safe_name=stored.safe_name,
        mime_type=stored.mime_type,
        size_bytes=stored.size_bytes,
        sha256=stored.sha256,
        storage_key=stored.storage_key,
        kind="spreadsheet",
        extraction_status="extracted",
        metadata_json={"import": True, "columns": columns},
    )
    db.add(record)
    db.flush()
    batch = create_import_batch(
        db, org.organization, auth.user, file.filename or stored.safe_name, columns, rows, errors
    )
    return ImportBatchOut(
        id=batch.id,
        filename=batch.filename,
        status=batch.status,
        row_count=batch.row_count,
        valid_count=batch.valid_count,
        error_count=batch.error_count,
        rows=batch.rows,
        errors=batch.errors,
        column_mapping=map_columns(columns),
        created_at=batch.created_at,
        confirmed_at=batch.confirmed_at,
    )


@router.get("/imports", response_model=list[ImportBatchOut])
def list_imports(
    limit: int = Query(default=30, ge=1, le=100),
    org: OrgContext = Depends(require_admin_ctx),
    db: Session = Depends(get_db),
) -> list[ImportBatchOut]:
    batches = db.scalars(
        select(ImportBatch)
        .where(ImportBatch.organization_id == org.organization.id)
        .order_by(ImportBatch.created_at.desc())
        .limit(limit)
    ).all()
    return [
        ImportBatchOut(
            id=batch.id,
            filename=batch.filename,
            status=batch.status,
            row_count=batch.row_count,
            valid_count=batch.valid_count,
            error_count=batch.error_count,
            rows=batch.rows,
            errors=batch.errors,
            created_at=batch.created_at,
            confirmed_at=batch.confirmed_at,
        )
        for batch in batches
    ]


@router.get("/imports/{batch_id}", response_model=ImportBatchOut)
def get_import(
    batch_id: str,
    org: OrgContext = Depends(require_admin_ctx),
    db: Session = Depends(get_db),
) -> ImportBatchOut:
    batch = db.get(ImportBatch, batch_id)
    if batch is None or batch.organization_id != org.organization.id:
        raise not_found("Import batch")
    return ImportBatchOut(
        id=batch.id,
        filename=batch.filename,
        status=batch.status,
        row_count=batch.row_count,
        valid_count=batch.valid_count,
        error_count=batch.error_count,
        rows=batch.rows,
        errors=batch.errors,
        created_at=batch.created_at,
        confirmed_at=batch.confirmed_at,
    )


@router.post("/imports/{batch_id}/confirm")
def confirm_import_batch(
    batch_id: str,
    auth: AuthContext = Depends(get_auth),
    org: OrgContext = Depends(require_admin_ctx),
    db: Session = Depends(get_db),
) -> dict:
    batch = db.get(ImportBatch, batch_id)
    if batch is None or batch.organization_id != org.organization.id:
        raise not_found("Import batch")
    if batch.status == "confirmed":
        raise AppError(409, "already_confirmed", "This import was already confirmed.")
    result = confirm_import(db, batch, auth.user)
    return result


# ---------------------------------------------------------------------------
# Evaluations
# ---------------------------------------------------------------------------


@router.get("/evaluations", response_model=EvaluationListOut)
def list_evaluations(
    status: str | None = Query(default=None, max_length=32),
    intern_id: str | None = Query(default=None),
    limit: int = Query(default=30, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    org: OrgContext = Depends(require_admin_ctx),
    db: Session = Depends(get_db),
) -> EvaluationListOut:
    stmt = (
        select(Evaluation)
        .join(TaskAssignment, Evaluation.assignment_id == TaskAssignment.id)
        .where(TaskAssignment.organization_id == org.organization.id)
    )
    if status:
        stmt = stmt.where(Evaluation.status == status)
    if intern_id:
        stmt = stmt.where(TaskAssignment.intern_id == intern_id)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    evaluations = db.scalars(
        stmt.order_by(Evaluation.created_at.desc()).limit(limit).offset(offset)
    ).all()
    return EvaluationListOut(
        items=[_evaluation_out(e) for e in evaluations],
        total=int(total),
        limit=limit,
        offset=offset,
    )


@router.get("/evaluations/{evaluation_id}", response_model=EvaluationOut)
def get_evaluation(
    evaluation_id: str,
    auth: AuthContext = Depends(get_auth),
    org: OrgContext = Depends(get_org_context),
    db: Session = Depends(get_db),
) -> EvaluationOut:
    evaluation = db.get(Evaluation, evaluation_id)
    if evaluation is None:
        raise not_found("Evaluation")
    assignment = db.get(TaskAssignment, evaluation.assignment_id)
    if assignment is None or assignment.organization_id != org.organization.id:
        raise not_found("Evaluation")
    if not org.is_admin:
        intern = get_intern_for_user(db, auth.user, org.organization.id)
        if intern is None or assignment.intern_id != intern.id:
            raise forbidden("This evaluation belongs to another intern.")
    return _evaluation_out(evaluation)


@router.post("/evaluations/{evaluation_id}/decision", response_model=EvaluationOut)
def evaluation_decision(
    evaluation_id: str,
    payload: DecisionRequest,
    auth: AuthContext = Depends(get_auth),
    org: OrgContext = Depends(require_admin_ctx),
    db: Session = Depends(get_db),
) -> EvaluationOut:
    evaluation = db.get(Evaluation, evaluation_id)
    if evaluation is None:
        raise not_found("Evaluation")
    assignment = db.get(TaskAssignment, evaluation.assignment_id)
    if assignment is None or assignment.organization_id != org.organization.id:
        raise not_found("Evaluation")
    if evaluation.status not in {"human_review_required", "corrections_required"}:
        raise AppError(
            409,
            "invalid_state",
            f"This evaluation is already {evaluation.status.replace('_', ' ')} and needs no decision.",
        )
    updated = decide_evaluation(db, evaluation, auth.user, payload.decision, payload.note)
    return _evaluation_out(updated)


# ---------------------------------------------------------------------------
# Meetings and email log
# ---------------------------------------------------------------------------


@router.get("/meetings", response_model=list[MeetingOut])
def list_meetings(
    status: str | None = Query(default=None, max_length=20),
    intern_id: str | None = Query(default=None),
    org: OrgContext = Depends(require_admin_ctx),
    db: Session = Depends(get_db),
) -> list[MeetingOut]:
    stmt = select(Meeting).where(Meeting.organization_id == org.organization.id)
    if status:
        stmt = stmt.where(Meeting.status == status)
    if intern_id:
        stmt = stmt.where(Meeting.intern_id == intern_id)
    meetings = db.scalars(stmt.order_by(Meeting.start_at.desc()).limit(100)).all()
    return [MeetingOut.model_validate(meeting) for meeting in meetings]


@router.patch("/meetings/{meeting_id}", response_model=MeetingOut)
def update_meeting(
    meeting_id: str,
    payload: MeetingUpdate,
    auth: AuthContext = Depends(get_auth),
    org: OrgContext = Depends(require_admin_ctx),
    db: Session = Depends(get_db),
) -> MeetingOut:
    meeting = db.get(Meeting, meeting_id)
    if meeting is None or meeting.organization_id != org.organization.id:
        raise not_found("Meeting")
    if payload.start_at:
        try:
            parsed = datetime.fromisoformat(payload.start_at.replace("Z", "+00:00"))
        except ValueError as exc:
            raise AppError(422, "invalid_datetime", "Use an ISO-8601 date and time.") from exc
        if parsed.tzinfo:
            parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
        duration = (meeting.end_at - meeting.start_at) if meeting.end_at and meeting.start_at else timedelta(minutes=45)
        meeting.start_at = parsed
        meeting.end_at = parsed + duration
    if payload.notes is not None:
        meeting.notes = payload.notes
    meeting.status = payload.status
    if payload.status == "scheduled" and not meeting.meet_url:
        note = (
            "Marked scheduled by an administrator. No Google Meet link exists because the calendar "
            "provider is not configured; confirm the joining method manually."
        )
        if note not in meeting.notes:
            meeting.notes = (meeting.notes + "\n\n" + note).strip()
    notifications.audit(
        db,
        actor_id=auth.user.id,
        action="meeting_updated",
        entity_type="meeting",
        entity_id=meeting.id,
        organization_id=org.organization.id,
        metadata={"status": payload.status},
    )
    db.commit()
    db.refresh(meeting)
    return MeetingOut.model_validate(meeting)


@router.get("/meetings/{meeting_id}/ics")
def download_ics(
    meeting_id: str,
    auth: AuthContext = Depends(get_auth),
    org: OrgContext = Depends(get_org_context),
    db: Session = Depends(get_db),
) -> Response:
    meeting = db.get(Meeting, meeting_id)
    if meeting is None or meeting.organization_id != org.organization.id:
        raise not_found("Meeting")
    if not org.is_admin:
        intern = get_intern_for_user(db, auth.user, org.organization.id)
        if intern is None or meeting.intern_id != intern.id:
            raise forbidden("This meeting belongs to another intern.")
    ics = meeting_ics(meeting)
    return Response(
        content=ics,
        media_type="text/calendar",
        headers={"Content-Disposition": f'attachment; filename="nexora-meeting-{meeting.id[:8]}.ics"'},
    )


@router.get("/emails", response_model=list[EmailLogOut])
def list_emails(
    status: str | None = Query(default=None, max_length=16),
    limit: int = Query(default=50, ge=1, le=200),
    org: OrgContext = Depends(require_admin_ctx),
    db: Session = Depends(get_db),
) -> list[EmailLogOut]:
    stmt = select(EmailLog).where(EmailLog.organization_id == org.organization.id)
    if status:
        stmt = stmt.where(EmailLog.status == status)
    logs = db.scalars(stmt.order_by(EmailLog.created_at.desc()).limit(limit)).all()
    return [EmailLogOut.model_validate(log) for log in logs]


@router.get("/progress", response_model=ProgressResponse)
def progress(
    org: OrgContext = Depends(require_admin_ctx), db: Session = Depends(get_db)
) -> ProgressResponse:
    return ProgressResponse(**progress_summary(db, org.organization.id))


# ---------------------------------------------------------------------------
# Intern self-service
# ---------------------------------------------------------------------------


@router.get("/me", response_model=InternSelfOut)
def intern_me(
    auth: AuthContext = Depends(get_auth),
    org: OrgContext = Depends(get_org_context),
    db: Session = Depends(get_db),
) -> InternSelfOut:
    intern = get_intern_for_user(db, auth.user, org.organization.id)
    if intern is None:
        raise AppError(403, "not_an_intern", "No intern profile is linked to this account in this organization.")
    context = intern_context(db, intern)
    submissions = db.scalars(
        select(Submission)
        .where(Submission.intern_id == intern.id)
        .order_by(Submission.submitted_at.desc())
    ).all()
    evaluations = db.scalars(
        select(Evaluation)
        .join(TaskAssignment, Evaluation.assignment_id == TaskAssignment.id)
        .where(TaskAssignment.intern_id == intern.id)
        .order_by(Evaluation.created_at.desc())
    ).all()
    meetings = db.scalars(
        select(Meeting)
        .where(Meeting.intern_id == intern.id, Meeting.status.in_(["proposed", "scheduled"]))
        .order_by(Meeting.start_at.asc())
    ).all()
    current = context["current"]
    return InternSelfOut(
        intern=_intern_out(db, intern),
        current_assignment=_assignment_out(current) if current else None,
        assignments=[_assignment_out(a) for a in context["assignments"]],
        submissions=[_submission_out(s) for s in submissions],
        evaluations=[_evaluation_out(e) for e in evaluations],
        meetings=[MeetingOut.model_validate(m) for m in meetings],
        next_meeting=MeetingOut.model_validate(meetings[0]) if meetings else None,
    )


@router.get("/assignments/{assignment_id}", response_model=AssignmentOut)
def get_assignment(
    assignment_id: str,
    auth: AuthContext = Depends(get_auth),
    org: OrgContext = Depends(get_org_context),
    db: Session = Depends(get_db),
) -> AssignmentOut:
    assignment = db.get(TaskAssignment, assignment_id)
    if assignment is None or assignment.organization_id != org.organization.id:
        raise not_found("Assignment")
    if not org.is_admin:
        intern = get_intern_for_user(db, auth.user, org.organization.id)
        if intern is None or assignment.intern_id != intern.id:
            raise forbidden("This assignment belongs to another intern.")
    return _assignment_out(assignment)


@router.patch("/assignments/{assignment_id}", response_model=AssignmentOut)
def update_assignment(
    assignment_id: str,
    payload: AssignmentUpdate,
    auth: AuthContext = Depends(get_auth),
    org: OrgContext = Depends(require_admin_ctx),
    db: Session = Depends(get_db),
) -> AssignmentOut:
    assignment = db.get(TaskAssignment, assignment_id)
    if assignment is None or assignment.organization_id != org.organization.id:
        raise not_found("Assignment")
    if payload.due_at:
        try:
            parsed = datetime.fromisoformat(payload.due_at.replace("Z", "+00:00"))
        except ValueError as exc:
            raise AppError(422, "invalid_datetime", "Use an ISO-8601 date and time.") from exc
        assignment.due_at = parsed.astimezone(timezone.utc).replace(tzinfo=None) if parsed.tzinfo else parsed
    if payload.status:
        assignment.status = payload.status
        if payload.status == "approved":
            assignment.approved_at = assignment.approved_at or utcnow()
            assignment.completed_at = assignment.completed_at or utcnow()
    if payload.escalation_state is not None:
        assignment.escalation_state = payload.escalation_state
    notifications.audit(
        db,
        actor_id=auth.user.id,
        action="assignment_updated",
        entity_type="assignment",
        entity_id=assignment.id,
        organization_id=org.organization.id,
        metadata=payload.model_dump(exclude_none=True),
    )
    db.commit()
    db.refresh(assignment)
    return _assignment_out(assignment)


@router.post("/assignments/{assignment_id}/submit", response_model=SubmissionResultOut)
def submit_assignment(
    assignment_id: str,
    text: str = Form(default=""),
    files: list[UploadFile] = File(default_factory=list),
    auth: AuthContext = Depends(get_auth),
    org: OrgContext = Depends(get_org_context),
    db: Session = Depends(get_db),
) -> SubmissionResultOut:
    intern = get_intern_for_user(db, auth.user, org.organization.id)
    if intern is None:
        raise forbidden("Only interns can submit work.")
    assignment = db.get(TaskAssignment, assignment_id)
    if assignment is None or assignment.organization_id != org.organization.id:
        raise not_found("Assignment")
    if assignment.intern_id != intern.id:
        raise forbidden("This task is assigned to another intern.")
    stored_files: list[tuple[str, str, int, str]] = []
    extracted_texts: list[str] = []
    created: list[tuple[str, object]] = []
    for upload in files[:8]:
        if not upload.filename:
            continue
        stored = save_upload(upload, user_id=auth.user.id, organization_id=org.organization.id)
        record = __import__("app.models", fromlist=["File"]).File(
            user_id=auth.user.id,
            organization_id=org.organization.id,
            original_name=(upload.filename or stored.safe_name)[:255],
            safe_name=stored.safe_name,
            mime_type=stored.mime_type,
            size_bytes=stored.size_bytes,
            sha256=stored.sha256,
            storage_key=stored.storage_key,
            kind=stored.kind,
            extraction_status="pending",
        )
        db.add(record)
        db.flush()
        if stored.kind not in {"audio", "video"}:
            try:
                result = extract_text(resolve_path(stored.storage_key), Path(stored.safe_name).suffix.lower())
                record.extracted_text = result.text or None
                record.extraction_status = result.status
                record.page_count = result.page_count
                if result.text:
                    extracted_texts.append(result.text)
            except Exception:
                record.extraction_status = "failed"
        else:
            record.extraction_status = "unsupported"
        stored_files.append((stored.safe_name, stored.mime_type, stored.size_bytes, stored.sha256))
        created.append((stored.sha256, record))
    submission, evaluation = submit_work(
        db,
        intern,
        assignment,
        text,
        files=stored_files,
        extracted_texts=extracted_texts,
    )
    by_sha = {sha: record for sha, record in created}
    for item in db.scalars(
        select(SubmissionFile).where(SubmissionFile.submission_id == submission.id)
    ).all():
        record = by_sha.get(item.sha256)
        if record is not None:
            item.file_id = record.id
    db.commit()
    db.refresh(submission)
    db.refresh(evaluation)
    db.refresh(assignment)
    return SubmissionResultOut(
        submission=_submission_out(submission),
        evaluation=_evaluation_out(evaluation),
        assignment=_assignment_out(assignment),
        message=(
            f"Submission v{submission.version} evaluated: {evaluation.status.replace('_', ' ')}."
        ),
    )


@router.get("/submissions/{submission_id}/files/{submission_file_id}")
def download_submission_file(
    submission_id: str,
    submission_file_id: str,
    auth: AuthContext = Depends(get_auth),
    org: OrgContext = Depends(get_org_context),
    db: Session = Depends(get_db),
) -> FileResponse:
    submission = db.get(Submission, submission_id)
    if submission is None:
        raise not_found("Submission")
    if not _can_access_submission(db, auth.user, org, submission):
        raise forbidden("You cannot access this submission.")
    item = db.get(SubmissionFile, submission_file_id)
    if item is None or item.submission_id != submission.id or not item.file_id:
        raise not_found("Submission file")
    record = __import__("app.models", fromlist=["File"]).File
    from app.models import File as FileRecord

    file_record = db.get(FileRecord, item.file_id)
    if file_record is None or file_record.deleted_at is not None:
        raise not_found("Submission file")
    return FileResponse(
        resolve_path(file_record.storage_key),
        media_type=file_record.mime_type,
        filename=file_record.original_name,
    )


# ---------------------------------------------------------------------------
# Grounded InternFlow assistant and audit
# ---------------------------------------------------------------------------


@router.post("/chat", response_model=InternChatResponse)
def internflow_chat(
    payload: InternChatRequest,
    auth: AuthContext = Depends(get_auth),
    org: OrgContext = Depends(get_org_context),
    db: Session = Depends(get_db),
) -> InternChatResponse:
    result = agent.internflow_chat(db, auth.user, org, payload.message)
    session = ChatSession(
        user_id=auth.user.id,
        organization_id=org.organization.id,
        title=f"InternFlow · {result['intent'].replace('_', ' ')}"[:200],
        model="internflow-agent",
        message_count=2,
        last_message_at=utcnow(),
    )
    db.add(session)
    db.flush()
    db.add(ChatMessage(chat_id=session.id, role="user", content=payload.message))
    db.add(
        ChatMessage(
            chat_id=session.id,
            role="assistant",
            content=result["reply"],
            provider="internflow",
            model="grounded-records-v1",
            status="complete",
        )
    )
    db.commit()
    return InternChatResponse(chat_id=session.id, reply=result["reply"], intent=result["intent"])


@router.get("/audit", response_model=list[dict])
def audit_trail(
    limit: int = Query(default=50, ge=1, le=200),
    org: OrgContext = Depends(require_admin_ctx),
    db: Session = Depends(get_db),
) -> list[dict]:
    logs = db.scalars(
        select(AuditLog)
        .where(AuditLog.organization_id == org.organization.id)
        .order_by(AuditLog.created_at.desc())
        .limit(limit)
    ).all()
    return [
        {
            "id": log.id,
            "action": log.action,
            "entity_type": log.entity_type,
            "entity_id": log.entity_id,
            "actor_id": log.actor_id,
            "metadata": log.metadata_json,
            "created_at": log.created_at.isoformat() + "Z",
        }
        for log in logs
    ]
