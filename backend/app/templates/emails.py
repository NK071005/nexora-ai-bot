"""InternFlow email templates. All values come from persisted records."""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.models import InternProfile, Meeting, Organization, TaskAssignment
from app.services.email import OutgoingEmail, render_branded_email


def _tz(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def fmt_datetime(value: datetime | None, timezone: str) -> str:
    if value is None:
        return "To be confirmed"
    aware = value.replace(tzinfo=ZoneInfo("UTC")) if value.tzinfo is None else value
    local = aware.astimezone(_tz(timezone))
    return local.strftime("%d %b %Y, %H:%M") + f" ({timezone})"


def fmt_date(value) -> str:
    if value is None:
        return "To be confirmed"
    return value.strftime("%d %b %Y")


def _list(values: list) -> str:
    if not values:
        return "—"
    lines = []
    for i, value in enumerate(values, start=1):
        if isinstance(value, dict):
            label = value.get("label") or value.get("name") or value.get("title") or "Criterion"
            detail = value.get("detail") or value.get("description") or ""
            mandatory = " (mandatory)" if value.get("mandatory") else ""
            lines.append(f"{i}. {label}{mandatory}" + (f"\n   {detail}" if detail else ""))
        else:
            lines.append(f"{i}. {value}")
    return "\n".join(lines)


def onboarding_email(
    intern: InternProfile,
    task: TaskAssignment,
    activation_url: str,
    organization: Organization,
    meeting: Meeting | None,
) -> OutgoingEmail:
    company = intern.company_name or organization.name
    due = fmt_datetime(task.due_at, intern.timezone)
    meeting_text = ""
    if meeting and meeting.status == "scheduled":
        meeting_text = (
            f"{fmt_datetime(meeting.start_at, meeting.timezone)} — {meeting.title}\n"
            + (f"Google Meet: {meeting.meet_url}\n" if meeting.meet_url else "")
        )
    elif meeting:
        meeting_text = (
            f"A review slot has been proposed for {fmt_datetime(meeting.start_at, meeting.timezone)}. "
            "Your administrator will confirm the calendar invitation separately."
        )

    blocks = [
        ("Internship", f"Role: {intern.role_title}\nDepartment: {intern.department or '—'}\n"
                       f"Company: {company}\nDuration: {intern.duration_weeks or '—'} weeks\n"
                       f"Dates: {fmt_date(intern.start_date)} to {fmt_date(intern.end_date)}"),
        ("First task", f"{task.title}\n\n{task.template.description if task.template else ''}"),
        ("Required methodology", (task.template.expected_methodology if task.template else "") or "Follow the task brief."),
        ("Deliverables", _list(task.template.deliverables if task.template else [])),
        ("Acceptance criteria", _list(task.template.acceptance_criteria if task.template else [])),
        ("Submission deadline", f"{due}\nSubmit through the InternFlow portal in NEXORA AI."),
        ("Review meeting", meeting_text or "No review meeting is scheduled at this time."),
        ("Activate your account", f"Set your password using this single-use link (expires in 72 hours):\n{activation_url}"),
    ]
    intro = (
        f"Hello {intern.full_name}, {company} has invited you to the {intern.role_title} internship "
        "programme. This message confirms your onboarding details and your first assignment."
    )
    footer = (
        "This is an internship onboarding invitation, not a legally binding employment offer. "
        "Terms, stipend and benefits are governed only by any separately signed agreement."
    )
    body_html = render_branded_email(
        "Your internship onboarding", intro, blocks, footer
    )
    body_text = (
        f"Hello {intern.full_name},\n\n{intro}\n\n"
        + "\n\n".join(f"{title}\n{'-' * len(title)}\n{body}" for title, body in blocks)
        + f"\n\n{footer}\n"
    )
    subject = f"{company} internship onboarding — {intern.role_title}"
    return OutgoingEmail(
        to_email=intern.email,
        subject=subject,
        body_text=body_text,
        body_html=body_html,
        kind="onboarding",
        related_type="intern",
        related_id=intern.id,
    )


def task_assigned_email(
    intern: InternProfile, task: TaskAssignment, organization: Organization, portal_url: str
) -> OutgoingEmail:
    template = task.template
    blocks = [
        ("Task", f"{task.title}\n\n{template.description if template else ''}"),
        ("Methodology", (template.expected_methodology if template else "") or "Follow the task brief."),
        ("Deliverables", _list(template.deliverables if template else [])),
        ("Acceptance criteria", _list(template.acceptance_criteria if template else [])),
        ("Deadline", fmt_datetime(task.due_at, intern.timezone)),
        ("Submit here", portal_url),
    ]
    intro = f"Your next internship task is ready, {intern.full_name}."
    body_html = render_branded_email("New internship task", intro, blocks)
    body_text = intro + "\n\n" + "\n\n".join(f"{t}\n{b}" for t, b in blocks)
    return OutgoingEmail(
        to_email=intern.email,
        subject=f"New task: {task.title} — due {fmt_datetime(task.due_at, intern.timezone)}",
        body_text=body_text,
        body_html=body_html,
        kind="task_assigned",
        related_type="assignment",
        related_id=task.id,
    )


def corrections_email(
    intern: InternProfile,
    task: TaskAssignment,
    evaluation,
    organization: Organization,
    portal_url: str,
    meeting: Meeting | None,
) -> OutgoingEmail:
    criteria_lines = []
    for result in evaluation.criteria_results:
        mark = "PASS" if result.status == "passed" else "FAIL"
        criteria_lines.append(
            f"[{mark}] {result.label}\n{result.comment}\nEvidence: {result.evidence or '—'}"
        )
    actions = "\n".join(f"{i}. {action}" for i, action in enumerate(evaluation.corrective_actions, start=1))
    meeting_text = ""
    if meeting:
        meeting_text = (
            f"Review proposed for {fmt_datetime(meeting.start_at, meeting.timezone)}. "
            "Confirm attendance with your administrator."
            if meeting.status != "scheduled"
            else f"Review scheduled for {fmt_datetime(meeting.start_at, meeting.timezone)}."
        )
    blocks = [
        ("Result", f"Corrections required — score {evaluation.score:.0f} / 100 (threshold not met or mandatory criterion failed)."),
        ("What went well", "\n".join(evaluation.strengths) or "—"),
        ("Criterion results", "\n\n".join(criteria_lines)),
        ("Required corrections", actions or "Revise the failed criteria."),
        ("How to validate", "Re-check each correction against the acceptance criteria, then resubmit a new version. "
                            "Your previous submission is preserved."),
        ("Revised deadline", fmt_datetime(task.due_at, intern.timezone)),
        ("Review meeting", meeting_text or "No review meeting is scheduled yet."),
        ("Resubmit", portal_url),
    ]
    intro = (
        f"Hello {intern.full_name}, your submission for “{task.title}” needs corrections before it can be approved."
    )
    body_html = render_branded_email("Corrections required", intro, blocks)
    body_text = intro + "\n\n" + "\n\n".join(f"{t}\n{b}" for t, b in blocks)
    return OutgoingEmail(
        to_email=intern.email,
        subject=f"Corrections required: {task.title}",
        body_text=body_text,
        body_html=body_html,
        kind="corrections",
        related_type="evaluation",
        related_id=evaluation.id,
    )


def approval_email(
    intern: InternProfile, task: TaskAssignment, evaluation, next_task: TaskAssignment | None
) -> OutgoingEmail:
    blocks = [
        ("Result", f"Approved — score {evaluation.score:.0f} / 100."),
        ("Feedback", evaluation.summary),
        ("What worked", "\n".join(evaluation.strengths) or "—"),
    ]
    if next_task:
        blocks.append(
            ("Next task", f"{next_task.title}\nDue {fmt_datetime(next_task.due_at, intern.timezone)}")
        )
    else:
        blocks.append(("Next step", "You have completed the assigned task sequence. Your administrator will confirm internship completion."))
    intro = f"Good work, {intern.full_name}. Your submission for “{task.title}” has been approved."
    body_html = render_branded_email("Submission approved", intro, blocks)
    body_text = intro + "\n\n" + "\n\n".join(f"{t}\n{b}" for t, b in blocks)
    return OutgoingEmail(
        to_email=intern.email,
        subject=f"Approved: {task.title}",
        body_text=body_text,
        body_html=body_html,
        kind="approval",
        related_type="evaluation",
        related_id=evaluation.id,
    )


def completion_email(intern: InternProfile, company: str) -> OutgoingEmail:
    blocks = [
        ("Programme", f"{intern.role_title} · {intern.department or 'General'}\n{fmt_date(intern.start_date)} to {fmt_date(intern.end_date)}"),
        ("Outcome", "All assigned tasks in the programme sequence have been approved."),
    ]
    intro = f"Congratulations {intern.full_name} — you have completed the NEXORA InternFlow programme with {company}."
    body_html = render_branded_email("Internship complete", intro, blocks)
    body_text = intro + "\n\n" + "\n\n".join(f"{t}\n{b}" for t, b in blocks)
    return OutgoingEmail(
        to_email=intern.email,
        subject=f"Internship completed — {company}",
        body_text=body_text,
        body_html=body_html,
        kind="completion",
        related_type="intern",
        related_id=intern.id,
    )


def reminder_email(intern: InternProfile, task: TaskAssignment, kind: str) -> OutgoingEmail:
    if kind == "overdue":
        heading = "Task overdue"
        intro = f"Your task “{task.title}” is past its deadline."
    elif kind == "review":
        heading = "Review meeting reminder"
        intro = f"Reminder for your InternFlow review of “{task.title}”."
    else:
        heading = "Deadline reminder"
        intro = f"Your task “{task.title}” is due soon."
    blocks = [
        ("Deadline", fmt_datetime(task.due_at, intern.timezone)),
        ("Status", task.status.replace("_", " ").title()),
        ("What to do", "Open the InternFlow portal to review requirements, submit your work, or read feedback."),
    ]
    body_html = render_branded_email(heading, intro, blocks)
    body_text = intro + "\n\n" + "\n\n".join(f"{t}\n{b}" for t, b in blocks)
    return OutgoingEmail(
        to_email=intern.email,
        subject=f"{heading}: {task.title}",
        body_text=body_text,
        body_html=body_html,
        kind=f"reminder_{kind}",
        related_type="assignment",
        related_id=task.id,
    )
