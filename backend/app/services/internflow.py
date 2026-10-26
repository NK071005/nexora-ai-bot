"""InternFlow domain workflow: import, onboarding, assignment, evaluation, progression.

State transitions are guarded and auditable. The agent never invents external
success: email/calendar adapters report demo/sent/failed states.
"""

from __future__ import annotations

import hashlib
import re
from datetime import date, datetime, timedelta, timezone as dt_timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import pandas as pd
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.errors import AppError, conflict, not_found
from app.models import (
    AccountActivationToken,
    EmailLog,
    Evaluation,
    EvaluationCriterionResult,
    InternProfile,
    ImportBatch,
    Meeting,
    Organization,
    OrganizationMembership,
    ReminderJob,
    Submission,
    SubmissionFile,
    TaskAssignment,
    TaskTemplate,
    User,
    UserProfile,
    utcnow,
)
from app.models.base import new_id
from app.security.passwords import expiry, hash_token, new_opaque_token
from app.services import notifications
from app.services.calendar import create_meeting, default_slot
from app.services.email import send_email
from app.services.evaluation import EvaluationOutcome, evaluate_submission
from app.services.extraction import extract_text
from app.services.storage import resolve_path
from app.templates.emails import (
    approval_email,
    completion_email,
    corrections_email,
    onboarding_email,
    reminder_email,
    task_assigned_email,
)

REQUIRED_FIELDS = {"full_name", "email"}
COLUMN_ALIASES = {
    "full_name": {"full name", "name", "intern name", "candidate name", "student name"},
    "email": {"email", "email address", "e-mail", "mail"},
    "role_title": {"role", "assigned role", "position", "title", "internship role"},
    "department": {"department", "team", "function", "division"},
    "company_name": {"company", "company name", "organization", "organisation"},
    "start_date": {"start date", "internship start date", "start", "from"},
    "end_date": {"end date", "internship end date", "end", "to"},
    "duration_weeks": {"duration", "duration weeks", "internship duration", "weeks"},
    "username": {"username", "user name", "login"},
    "initial_task": {"initial task", "initial task identifier", "first task", "task", "task id"},
    "timezone": {"timezone", "time zone", "tz"},
}


def _tz(name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(name or settings.default_timezone)
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def due_datetime(days: int, tz_name: str | None, hour: int = 18) -> datetime:
    tz = _tz(tz_name)
    local_now = datetime.now(tz)
    due_local = (local_now + timedelta(days=max(1, days))).replace(
        hour=hour, minute=0, second=0, microsecond=0
    )
    return due_local.astimezone(dt_timezone.utc).replace(tzinfo=None)


def _parse_date(value) -> date | None:
    if value in (None, "", "nan", "NaT"):
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, (int, float)):
        try:
            return (datetime(1899, 12, 30) + timedelta(days=float(value))).date()
        except Exception:
            return None
    text = str(value).strip()
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%m/%d/%Y", "%Y/%m/%d", "%d %b %Y", "%d %B %Y", "%b %d, %Y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    try:
        return pd.to_datetime(text, dayfirst=True).date()
    except Exception:
        return None


def _parse_int(value) -> int | None:
    if value in (None, "", "nan"):
        return None
    try:
        return int(float(str(value).strip()))
    except Exception:
        return None


def _normalise_header(name: str) -> str:
    return re.sub(r"[\s_\-]+", " ", str(name)).strip().lower()


def map_columns(columns: list[str]) -> dict[str, str]:
    mapping: dict[str, str] = {}
    normalised = {_normalise_header(c): c for c in columns}
    for target, aliases in COLUMN_ALIASES.items():
        for alias in aliases:
            if alias in normalised:
                mapping[target] = normalised[alias]
                break
    return mapping


def parse_import_file(path, extension: str) -> tuple[list[str], list[dict], list[dict]]:
    try:
        if extension == ".csv":
            df = pd.read_csv(path)
        else:
            df = pd.read_excel(path)
    except Exception as exc:
        raise AppError(422, "import_parse_failed", "The spreadsheet could not be read.", {"detail": str(exc)[:300]})
    df = df.dropna(how="all")
    if len(df) > 2_000:
        raise AppError(413, "import_too_large", "Import files are limited to 2,000 intern rows.")
    columns = [str(c).strip() for c in df.columns]
    df.columns = columns
    mapping = map_columns(columns)
    missing = REQUIRED_FIELDS - set(mapping)
    if missing:
        raise AppError(
            422,
            "import_columns_missing",
            "Required columns are missing from the spreadsheet.",
            {"missing": sorted(missing), "detected_columns": columns, "mapping": mapping},
        )
    rows: list[dict] = []
    errors: list[dict] = []
    seen_emails: set[str] = set()
    for index, record in df.iterrows():
        row_number = int(index) + 2
        raw = {str(k): ("" if pd.isna(v) else v) for k, v in record.items()}
        values = {}
        for target, column in mapping.items():
            values[target] = raw.get(column)
        email = str(values.get("email") or "").strip().lower()
        full_name = str(values.get("full_name") or "").strip()
        row_errors: list[str] = []
        if not full_name:
            row_errors.append("Full name is required.")
        if not email or not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
            row_errors.append("A valid email address is required.")
        if email in seen_emails:
            row_errors.append("Duplicate email inside this file.")
        if email:
            seen_emails.add(email)
        start = _parse_date(values.get("start_date"))
        end = _parse_date(values.get("end_date"))
        if values.get("start_date") not in (None, "") and start is None:
            row_errors.append("Start date could not be parsed.")
        if values.get("end_date") not in (None, "") and end is None:
            row_errors.append("End date could not be parsed.")
        if start and end and end < start:
            row_errors.append("End date is before the start date.")
        duration = _parse_int(values.get("duration_weeks"))
        if duration is None and start and end:
            duration = max(1, ((end - start).days + 6) // 7)
        timezone_name = str(values.get("timezone") or settings.default_timezone).strip()
        try:
            ZoneInfo(timezone_name)
        except Exception:
            row_errors.append(f"Unknown timezone '{timezone_name}'.")
            timezone_name = settings.default_timezone
        rows.append(
            {
                "row_number": row_number,
                "raw": raw,
                "values": {
                    "full_name": full_name,
                    "email": email,
                    "role_title": str(values.get("role_title") or "Intern").strip(),
                    "department": str(values.get("department") or "").strip(),
                    "company_name": str(values.get("company_name") or "").strip(),
                    "start_date": start.isoformat() if start else None,
                    "end_date": end.isoformat() if end else None,
                    "duration_weeks": duration,
                    "username": str(values.get("username") or "").strip(),
                    "initial_task": str(values.get("initial_task") or "").strip(),
                    "timezone": timezone_name,
                },
                "errors": row_errors,
            }
        )
        if row_errors:
            errors.append({"row": row_number, "email": email, "messages": row_errors})
    return columns, rows, errors


def create_import_batch(
    db: Session, org: Organization, user: User, filename: str, columns: list[str], rows: list[dict], errors: list[dict]
) -> ImportBatch:
    for row in rows:
        email = row["values"]["email"]
        if not email:
            continue
        existing = db.scalar(
            select(InternProfile).where(
                InternProfile.organization_id == org.id, InternProfile.email == email
            )
        )
        if existing:
            row["errors"].append("An intern with this email already exists in this organization.")
            errors.append({"row": row["row_number"], "email": email, "messages": ["Already onboarded."]})
    valid = [row for row in rows if not row["errors"]]
    batch = ImportBatch(
        organization_id=org.id,
        created_by=user.id,
        filename=filename,
        status="preview",
        row_count=len(rows),
        valid_count=len(valid),
        error_count=len(errors),
        rows=rows,
        errors=errors,
    )
    db.add(batch)
    db.commit()
    return batch


def _find_first_template(db: Session, org_id: str, initial_task: str = "") -> TaskTemplate | None:
    if initial_task:
        template = db.scalar(
            select(TaskTemplate).where(
                TaskTemplate.organization_id == org_id,
                TaskTemplate.status == "active",
                (TaskTemplate.slug == initial_task) | (TaskTemplate.id == initial_task),
            )
        )
        if template:
            return template
        if initial_task.isdigit():
            template = db.scalar(
                select(TaskTemplate).where(
                    TaskTemplate.organization_id == org_id,
                    TaskTemplate.status == "active",
                    TaskTemplate.sequence_order == int(initial_task),
                )
            )
            if template:
                return template
    return db.scalar(
        select(TaskTemplate)
        .where(TaskTemplate.organization_id == org_id, TaskTemplate.status == "active")
        .order_by(TaskTemplate.sequence_order.asc())
    )


def create_assignment(
    db: Session,
    *,
    intern: InternProfile,
    template: TaskTemplate,
    assigned_by: str | None,
    due_days: int | None = None,
    send_notification: bool = True,
) -> TaskAssignment:
    if intern.current_assignment_id:
        current = db.get(TaskAssignment, intern.current_assignment_id)
        if current and current.status in {"assigned", "corrections_required", "overdue", "human_review_required", "submitted"}:
            raise conflict("This intern already has an active assignment.")
    due = due_datetime(due_days or template.deadline_days, intern.timezone)
    assignment = TaskAssignment(
        organization_id=intern.organization_id,
        intern_id=intern.id,
        template_id=template.id,
        template_version=template.version,
        title=template.title,
        sequence_order=template.sequence_order,
        status="assigned",
        due_at=due,
        assigned_by=assigned_by,
    )
    db.add(assignment)
    db.flush()
    intern.current_assignment_id = assignment.id
    intern.status = "active"
    _schedule_reminders(db, assignment)
    if send_notification and intern.user_id:
        org = db.get(Organization, intern.organization_id)
        email = task_assigned_email(
            intern, assignment, org, f"{settings.frontend_url}/internflow"
        )
        log = send_email(db, email, intern.organization_id)
        notifications.notify(
            db,
            user_id=intern.user_id,
            organization_id=intern.organization_id,
            title=f"New task: {template.title}",
            body=f"Due {due.strftime('%d %b %Y, %H:%M')} UTC. Review the requirements in InternFlow.",
            kind="task_assigned",
            link="/internflow",
        )
        if log.status == "failed":
            append_audit(db, intern, "email_failed", {"email_id": log.id, "kind": "task_assigned"})
    return assignment


def _schedule_reminders(db: Session, assignment: TaskAssignment) -> None:
    if not assignment.due_at:
        return
    slots = [
        ("before_due", assignment.due_at - timedelta(hours=24)),
        ("overdue", assignment.due_at + timedelta(hours=24)),
    ]
    for kind, when in slots:
        existing = db.scalar(
            select(ReminderJob).where(
                ReminderJob.assignment_id == assignment.id,
                ReminderJob.kind == kind,
                ReminderJob.scheduled_for == when,
            )
        )
        if existing is None:
            db.add(
                ReminderJob(
                    organization_id=assignment.organization_id,
                    assignment_id=assignment.id,
                    kind=kind,
                    scheduled_for=when,
                    status="pending",
                )
            )


def confirm_import(db: Session, batch: ImportBatch, admin: User) -> dict:
    if batch.status == "confirmed":
        return {
            "batch_id": batch.id,
            "status": batch.status,
            "created": 0,
            "skipped": batch.valid_count,
            "message": "This import batch was already confirmed. No duplicate accounts were created.",
        }
    org = db.get(Organization, batch.organization_id)
    if org is None:
        raise not_found("Organization")
    created: list[dict] = []
    skipped: list[dict] = []
    first_template = _find_first_template(db, org.id)
    for row in batch.rows:
        if row.get("errors"):
            skipped.append({"row": row["row_number"], "email": row["values"].get("email"), "reason": row["errors"]})
            continue
        values = row["values"]
        email = values["email"].lower()
        if db.scalar(select(InternProfile).where(InternProfile.organization_id == org.id, InternProfile.email == email)):
            skipped.append({"row": row["row_number"], "email": email, "reason": ["Already onboarded."]})
            continue
        user = db.scalar(select(User).where(User.email == email))
        if user is None:
            user = User(
                email=email,
                full_name=values["full_name"],
                password_hash=None,
                is_active=True,
                default_organization_id=org.id,
                timezone=values["timezone"],
            )
            db.add(user)
            db.flush()
            db.add(UserProfile(user_id=user.id, preferences={}, notification_prefs={}))
        membership = db.scalar(
            select(OrganizationMembership).where(
                OrganizationMembership.organization_id == org.id,
                OrganizationMembership.user_id == user.id,
            )
        )
        if membership is None:
            db.add(
                OrganizationMembership(
                    organization_id=org.id, user_id=user.id, role="intern", status="active"
                )
            )
        intern = InternProfile(
            organization_id=org.id,
            user_id=user.id,
            import_batch_id=batch.id,
            full_name=values["full_name"],
            email=email,
            department=values["department"],
            role_title=values["role_title"],
            company_name=values["company_name"] or org.name,
            start_date=date.fromisoformat(values["start_date"]) if values["start_date"] else None,
            end_date=date.fromisoformat(values["end_date"]) if values["end_date"] else None,
            duration_weeks=values["duration_weeks"],
            timezone=values["timezone"],
            status="invited",
        )
        db.add(intern)
        db.flush()

        template = _find_first_template(db, org.id, values.get("initial_task", ""))
        assignment = None
        if template:
            assignment = TaskAssignment(
                organization_id=org.id,
                intern_id=intern.id,
                template_id=template.id,
                template_version=template.version,
                title=template.title,
                sequence_order=template.sequence_order,
                status="assigned",
                due_at=due_datetime(template.deadline_days, intern.timezone),
                assigned_by=admin.id,
            )
            db.add(assignment)
            db.flush()
            intern.current_assignment_id = assignment.id
            intern.status = "active"
            _schedule_reminders(db, assignment)

        activation_token = new_opaque_token()
        db.add(
            AccountActivationToken(
                user_id=user.id,
                token_hash=hash_token(activation_token),
                expires_at=expiry(hours=settings.activation_ttl_hours),
            )
        )
        activation_url = f"{settings.frontend_url}/activate?token={activation_token}"
        meeting = None
        if assignment:
            start, end = default_slot()
            meeting = create_meeting(
                db,
                organization_id=org.id,
                intern_id=intern.id,
                intern_email=intern.email,
                title=f"Kick-off review — {intern.full_name}",
                created_by=admin.id,
                assignment_id=assignment.id,
                start_at=start,
                end_at=end,
                timezone=intern.timezone,
                notes="First InternFlow review. Confirm attendance.",
            )
        email = onboarding_email(intern, assignment, activation_url, org, meeting) if assignment else onboarding_email(
            intern,
            TaskAssignment(
                title="Onboarding (task to be assigned)",
                template=None,  # type: ignore[arg-type]
                due_at=None,
            ),
            activation_url,
            org,
            meeting,
        )
        log = send_email(db, email, org.id)
        intern.onboarding_email_status = log.status
        notifications.notify(
            db,
            user_id=user.id,
            organization_id=org.id,
            title="Your internship onboarding is ready",
            body=f"Activate your account and review your first task. Deadline: "
                 + (assignment.due_at.strftime('%d %b %Y, %H:%M UTC') if assignment and assignment.due_at else "to be assigned"),
            kind="onboarding",
            link="/internflow",
        )
        created.append(
            {
                "intern_id": intern.id,
                "email": intern.email,
                "user_id": user.id,
                "assignment_id": assignment.id if assignment else None,
                "email_status": log.status,
                "activation_required": True,
                "activation_expires_hours": settings.activation_ttl_hours,
            }
        )
        append_audit(db, intern, "intern_onboarded", {"batch_id": batch.id, "email": intern.email})
    batch.status = "confirmed"
    batch.confirmed_at = utcnow()
    batch.valid_count = len(created)
    batch.error_count = len(skipped)
    batch.errors = batch.errors + skipped
    notifications.notify(
        db,
        user_id=admin.id,
        organization_id=org.id,
        title=f"Import confirmed: {len(created)} intern(s)",
        body=f"{len(skipped)} row(s) skipped. Onboarding emails recorded with provider status.",
        kind="import_confirmed",
        link="/internflow/interns",
    )
    append_audit(
        db, None, "import_confirmed",
        {"batch_id": batch.id, "created": len(created), "skipped": len(skipped)},
        org_id=org.id, actor_id=admin.id,
    )
    db.commit()
    return {
        "batch_id": batch.id,
        "status": batch.status,
        "created": len(created),
        "skipped": len(skipped),
        "interns": created,
        "email_mode": "smtp" if settings.email_configured else "demo",
    }


def append_audit(db: Session, intern: InternProfile | None, action: str, metadata: dict, org_id: str | None = None, actor_id: str | None = None) -> None:
    from app.models import AuditLog

    db.add(
        AuditLog(
            organization_id=org_id or (intern.organization_id if intern else None),
            actor_id=actor_id,
            action=action,
            entity_type="intern" if intern else "system",
            entity_id=intern.id if intern else metadata.get("batch_id"),
            metadata_json=metadata,
        )
    )


def get_intern_for_user(db: Session, user: User, organization_id: str | None = None) -> InternProfile | None:
    stmt = select(InternProfile).where(InternProfile.user_id == user.id)
    if organization_id:
        stmt = stmt.where(InternProfile.organization_id == organization_id)
    return db.scalar(stmt)


def submit_work(
    db: Session,
    intern: InternProfile,
    assignment: TaskAssignment,
    text: str,
    files: list[tuple[str, str, int, str]] | None = None,
    extracted_texts: list[str] | None = None,
) -> tuple[Submission, Evaluation]:
    if assignment.intern_id != intern.id:
        raise AppError(403, "forbidden", "This task is not assigned to you.")
    if assignment.status not in {"assigned", "corrections_required", "overdue"}:
        raise conflict("This task is not accepting submissions in its current state.")
    template = assignment.template
    if template and assignment.attempt_count >= template.max_attempts:
        raise conflict("Maximum attempts reached. Ask your administrator for a review.")
    if not (text or "").strip() and not files:
        raise AppError(422, "empty_submission", "Provide a written response or attach at least one file.")
    last_version = db.scalar(
        select(func.max(Submission.version)).where(Submission.assignment_id == assignment.id)
    ) or 0
    submission = Submission(
        assignment_id=assignment.id,
        intern_id=intern.id,
        version=last_version + 1,
        text_content=text or "",
        status="submitted",
        content_sha256=hashlib.sha256((text or "").encode("utf-8")).hexdigest(),
    )
    db.add(submission)
    db.flush()
    for filename, mime, size, sha in files or []:
        db.add(
            SubmissionFile(
                submission_id=submission.id,
                filename=filename[:255],
                mime_type=mime[:160],
                size_bytes=size,
                sha256=sha,
            )
        )
    assignment.attempt_count += 1
    assignment.status = "submitted"
    db.flush()

    outcome = evaluate_submission(
        assignment,
        submission,
        attachment_texts=extracted_texts,
        attachment_names=[f[0] for f in files or []],
    )
    evaluation = _persist_evaluation(db, assignment, submission, outcome)
    submission.status = "evaluated"
    db.flush()
    append_audit(db, intern, "submission_evaluated", {"submission_id": submission.id, "status": outcome.status})
    _apply_evaluation(db, intern, assignment, evaluation, outcome)
    db.commit()
    return submission, evaluation


def _persist_evaluation(
    db: Session, assignment: TaskAssignment, submission: Submission, outcome: EvaluationOutcome
) -> Evaluation:
    evaluation = Evaluation(
        submission_id=submission.id,
        assignment_id=assignment.id,
        status=outcome.status,
        score=outcome.score,
        confidence=outcome.confidence,
        summary=outcome.summary,
        strengths=outcome.strengths,
        errors=outcome.errors,
        missing_requirements=outcome.missing_requirements,
        corrective_actions=outcome.corrective_actions,
        human_review_required=outcome.human_review_required,
        human_review_reason=outcome.human_review_reason,
        evaluator=outcome.evaluator,
        rubric_version=f"v{assignment.template_version}",
    )
    db.add(evaluation)
    db.flush()
    for criterion in outcome.criteria:
        db.add(
            EvaluationCriterionResult(
                evaluation_id=evaluation.id,
                criterion_key=criterion.key,
                label=criterion.label,
                mandatory=criterion.mandatory,
                weight=criterion.weight,
                status=criterion.status,
                score=criterion.score,
                evidence=criterion.evidence,
                comment=criterion.comment,
            )
        )
    db.flush()
    return evaluation


def _apply_evaluation(
    db: Session, intern: InternProfile, assignment: TaskAssignment, evaluation: Evaluation, outcome: EvaluationOutcome
) -> None:
    org = db.get(Organization, intern.organization_id)
    if outcome.status == "passed":
        evaluation.decision = "auto_approved"
        evaluation.decided_at = utcnow()
        db.flush()
        _handle_pass(db, intern, assignment, evaluation, org, decided_by=None)
    elif outcome.status == "human_review_required":
        assignment.status = "human_review_required"
        evaluation.status = "human_review_required"
        admin_ids = notifications.org_admin_user_ids(db, intern.organization_id)
        notifications.notify_many(
            db,
            admin_ids,
            title=f"Review needed: {intern.full_name}",
            body=f"{outcome.human_review_reason or 'Evaluation requires a human decision.'} Submission v{evaluation.submission_id[:8]}.",
            kind="human_review",
            link="/internflow/evaluations",
            organization_id=intern.organization_id,
        )
        if intern.user_id:
            notifications.notify(
                db,
                user_id=intern.user_id,
                organization_id=intern.organization_id,
                title="Submission received — review pending",
                body="Your work is being checked by a reviewer. You will be notified of the decision.",
                kind="submission_review",
                link="/internflow",
            )
    else:
        evaluation.decision = "corrections_requested"
        evaluation.decided_at = utcnow()
        db.flush()
        _handle_corrections(db, intern, assignment, evaluation, org)


def _handle_pass(
    db: Session,
    intern: InternProfile,
    assignment: TaskAssignment,
    evaluation: Evaluation,
    org: Organization,
    decided_by: str | None,
) -> None:
    assignment.status = "approved"
    assignment.approved_at = assignment.approved_at or utcnow()
    assignment.completed_at = assignment.completed_at or utcnow()
    evaluation.status = "passed"
    evaluation.decision = "approved"
    evaluation.decided_at = evaluation.decided_at or utcnow()
    evaluation.decided_by = decided_by or evaluation.decided_by

    next_task: TaskAssignment | None = None
    if not assignment.next_assignment_id:
        template = db.scalar(
            select(TaskTemplate)
            .where(
                TaskTemplate.organization_id == org.id,
                TaskTemplate.status == "active",
                TaskTemplate.sequence_order > assignment.sequence_order,
            )
            .order_by(TaskTemplate.sequence_order.asc())
        )
        if template:
            next_task = TaskAssignment(
                organization_id=org.id,
                intern_id=intern.id,
                template_id=template.id,
                template_version=template.version,
                title=template.title,
                sequence_order=template.sequence_order,
                status="assigned",
                due_at=due_datetime(template.deadline_days, intern.timezone),
                assigned_by=decided_by,
            )
            db.add(next_task)
            db.flush()
            assignment.next_assignment_id = next_task.id
            intern.current_assignment_id = next_task.id
            intern.status = "active"
            _schedule_reminders(db, next_task)
        else:
            intern.status = "completed"
            intern.current_assignment_id = None
    else:
        next_task = db.get(TaskAssignment, assignment.next_assignment_id)

    if intern.user_id:
        email = approval_email(intern, assignment, evaluation, next_task)
        log = send_email(db, email, org.id)
        notifications.notify(
            db,
            user_id=intern.user_id,
            organization_id=org.id,
            title=f"Task approved: {assignment.title}",
            body=(
                f"Your next task is “{next_task.title}”." if next_task
                else "You have completed the assigned task sequence."
            ),
            kind="task_approved",
            link="/internflow",
        )
        if next_task:
            task_email = task_assigned_email(intern, next_task, org, f"{settings.frontend_url}/internflow")
            send_email(db, task_email, org.id)
        else:
            send_email(db, completion_email(intern, intern.company_name or org.name), org.id)
            notifications.notify_many(
                db,
                notifications.org_admin_user_ids(db, org.id),
                title=f"Internship completed: {intern.full_name}",
                body="All assigned tasks have been approved. A completion notification was generated.",
                kind="intern_completed",
                link="/internflow/interns",
                organization_id=org.id,
            )
        if log.status == "failed":
            append_audit(db, intern, "email_failed", {"kind": "approval"})
    append_audit(db, intern, "task_approved", {"assignment_id": assignment.id, "next": next_task.id if next_task else None})


def _handle_corrections(
    db: Session,
    intern: InternProfile,
    assignment: TaskAssignment,
    evaluation: Evaluation,
    org: Organization,
) -> None:
    template = assignment.template
    assignment.status = "corrections_required"
    assignment.due_at = due_datetime(
        max(2, int((template.deadline_days if template else 7) / 2)), intern.timezone
    )
    assignment.attempt_count = assignment.attempt_count
    # Replace future pending reminders with ones for the new due date.
    pending = db.scalars(
        select(ReminderJob).where(
            ReminderJob.assignment_id == assignment.id,
            ReminderJob.status == "pending",
            ReminderJob.kind == "before_due",
        )
    ).all()
    for job in pending:
        job.status = "skipped"
        job.error = "Deadline revised after corrections."
    _schedule_reminders(db, assignment)

    start, end = default_slot()
    meeting = create_meeting(
        db,
        organization_id=org.id,
        intern_id=intern.id,
        intern_email=intern.email,
        title=f"Corrections review — {assignment.title}",
        created_by=None,
        assignment_id=assignment.id,
        evaluation_id=evaluation.id,
        start_at=start,
        end_at=end,
        timezone=intern.timezone,
        notes="Review failed criteria and agree a correction plan.",
    )
    if intern.user_id:
        email = corrections_email(
            intern, assignment, evaluation, org, f"{settings.frontend_url}/internflow", meeting
        )
        log = send_email(db, email, org.id)
        notifications.notify(
            db,
            user_id=intern.user_id,
            organization_id=org.id,
            title=f"Corrections required: {assignment.title}",
            body=f"Score {evaluation.score:.0f}. Revised deadline "
                 + (assignment.due_at.strftime('%d %b %Y, %H:%M UTC') if assignment.due_at else "pending") + ".",
            kind="corrections",
            link="/internflow",
        )
        if log.status == "failed":
            append_audit(db, intern, "email_failed", {"kind": "corrections"})
    notifications.notify_many(
        db,
        notifications.org_admin_user_ids(db, org.id),
        title=f"Corrections sent: {intern.full_name}",
        body=f"{assignment.title} — score {evaluation.score:.0f}. Attempt {assignment.attempt_count}.",
        kind="corrections_sent",
        link="/internflow/evaluations",
        organization_id=org.id,
    )
    append_audit(db, intern, "corrections_requested", {"assignment_id": assignment.id, "evaluation_id": evaluation.id})


def decide_evaluation(db: Session, evaluation: Evaluation, admin: User, decision: str, note: str = "") -> Evaluation:
    assignment = db.get(TaskAssignment, evaluation.assignment_id)
    if assignment is None:
        raise not_found("Assignment")
    intern = db.get(InternProfile, assignment.intern_id)
    if intern is None:
        raise not_found("Intern")
    if decision == "approve":
        evaluation.decision = "approved"
        evaluation.decided_by = admin.id
        evaluation.decided_at = utcnow()
        evaluation.decision_note = note
        evaluation.status = "passed"
        db.flush()
        _handle_pass(db, intern, assignment, evaluation, db.get(Organization, intern.organization_id), admin.id)
    elif decision == "request_corrections":
        evaluation.decision = "corrections_requested"
        evaluation.decided_by = admin.id
        evaluation.decided_at = utcnow()
        evaluation.decision_note = note
        evaluation.status = "corrections_required"
        db.flush()
        _handle_corrections(db, intern, assignment, evaluation, db.get(Organization, intern.organization_id))
    elif decision == "escalate":
        evaluation.status = "human_review_required"
        evaluation.decision = "escalated"
        evaluation.decision_note = note
        evaluation.decided_by = admin.id
        evaluation.decided_at = utcnow()
        assignment.status = "human_review_required"
    else:
        raise AppError(422, "invalid_decision", "Decision must be approve, request_corrections or escalate.")
    from app.models import HumanReviewDecision

    db.add(
        HumanReviewDecision(
            evaluation_id=evaluation.id,
            reviewer_id=admin.id,
            decision=decision,
            notes=note,
        )
    )
    append_audit(
        db, intern, "evaluation_decided",
        {"evaluation_id": evaluation.id, "decision": decision},
        org_id=intern.organization_id, actor_id=admin.id,
    )
    db.commit()
    return evaluation


def process_due_reminders(db: Session, now: datetime | None = None) -> int:
    now = now or utcnow()
    jobs = db.scalars(
        select(ReminderJob)
        .where(ReminderJob.status == "pending", ReminderJob.scheduled_for <= now)
        .order_by(ReminderJob.scheduled_for.asc())
        .limit(50)
    ).all()
    processed = 0
    for job in jobs:
        assignment = db.get(TaskAssignment, job.assignment_id)
        if assignment is None:
            job.status = "skipped"
            job.error = "Assignment no longer exists."
            continue
        if assignment.status not in {"assigned", "corrections_required", "overdue"}:
            job.status = "skipped"
            job.error = f"Task is {assignment.status}; reminder not needed."
            continue
        job.attempts += 1
        intern = db.get(InternProfile, assignment.intern_id)
        if intern is None or not intern.email:
            job.status = "failed"
            job.error = "Intern email missing."
            continue
        if job.kind == "overdue" and assignment.due_at and assignment.due_at < now:
            assignment.status = "overdue"
        email = reminder_email(intern, assignment, job.kind)
        log = send_email(db, email, intern.organization_id)
        if log.status in {"sent", "demo"}:
            job.status = "sent"
            job.sent_at = now
            if intern.user_id:
                notifications.notify(
                    db,
                    user_id=intern.user_id,
                    organization_id=intern.organization_id,
                    title=(
                        f"Overdue: {assignment.title}" if job.kind == "overdue"
                        else f"Deadline reminder: {assignment.title}"
                    ),
                    body=f"Due {assignment.due_at.strftime('%d %b %Y, %H:%M UTC') if assignment.due_at else '—'}.",
                    kind=f"reminder_{job.kind}",
                    link="/internflow",
                )
        else:
            job.status = "failed"
            job.error = log.error or "Email delivery failed."
        processed += 1
    db.commit()
    return processed


def progress_summary(db: Session, org_id: str) -> dict:
    interns = db.scalars(
        select(InternProfile).where(InternProfile.organization_id == org_id).order_by(InternProfile.full_name)
    ).all()
    rows = []
    for intern in interns:
        assignments = db.scalars(
            select(TaskAssignment).where(TaskAssignment.intern_id == intern.id)
        ).all()
        approved = [a for a in assignments if a.status == "approved"]
        pending = [
            a for a in assignments
            if a.status in {"assigned", "corrections_required", "overdue", "submitted", "human_review_required"}
        ]
        current = db.get(TaskAssignment, intern.current_assignment_id) if intern.current_assignment_id else None
        overdue = bool(current and current.due_at and current.due_at < utcnow() and current.status in {"assigned", "corrections_required", "overdue"})
        rows.append(
            {
                "intern_id": intern.id,
                "name": intern.full_name,
                "email": intern.email,
                "status": intern.status,
                "department": intern.department,
                "tasks_total": len(assignments),
                "tasks_approved": len(approved),
                "tasks_pending": len(pending),
                "current_task": current.title if current else None,
                "current_status": current.status if current else None,
                "due_at": current.due_at if current else None,
                "overdue": overdue,
                "onboarding_email_status": intern.onboarding_email_status,
            }
        )
    total = len(rows)
    return {
        "organization_id": org_id,
        "interns_total": total,
        "active": len([r for r in rows if r["status"] == "active"]),
        "completed": len([r for r in rows if r["status"] == "completed"]),
        "overdue": len([r for r in rows if r["overdue"]]),
        "tasks_approved": sum(r["tasks_approved"] for r in rows),
        "tasks_pending": sum(r["tasks_pending"] for r in rows),
        "interns": rows,
    }


def intern_context(db: Session, intern: InternProfile) -> dict:
    assignments = db.scalars(
        select(TaskAssignment)
        .where(TaskAssignment.intern_id == intern.id)
        .order_by(TaskAssignment.sequence_order)
    ).all()
    current = db.get(TaskAssignment, intern.current_assignment_id) if intern.current_assignment_id else None
    evaluation = None
    if current:
        submission = db.scalar(
            select(Submission)
            .where(Submission.assignment_id == current.id)
            .order_by(Submission.version.desc())
        )
        if submission:
            evaluation = db.scalar(
                select(Evaluation).where(Evaluation.submission_id == submission.id)
            )
    meeting = db.scalar(
        select(Meeting)
        .where(Meeting.intern_id == intern.id, Meeting.status.in_(["proposed", "scheduled"]))
        .order_by(Meeting.start_at.desc())
    )
    return {
        "intern": intern,
        "current": current,
        "assignments": assignments,
        "evaluation": evaluation,
        "meeting": meeting,
    }
