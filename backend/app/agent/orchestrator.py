"""NexoraAgent: bounded orchestration for chat and InternFlow queries.

The agent selects tools from a fixed registry. Every tool call is executed by
the backend after authorization; the language model never runs SQL, shell or
unrestricted external actions. InternFlow chat answers are assembled from the
authenticated user's actual records.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.agent.tools import (
    TOOLS,
    AgentContext,
    ToolInvocation,
    document_context,
    library_hits,
    library_note_text,
    web_search,
)
from app.deps import OrgContext
from app.errors import forbidden
from app.models import (
    Evaluation,
    InternProfile,
    Submission,
    TaskAssignment,
    TaskTemplate,
    User,
    utcnow,
)
from app.models.base import new_id
from app.services.ai import ChatTurn, get_provider
from app.services.internflow import intern_context, progress_summary


class NexoraAgent:
    def prepare_chat(
        self,
        db: Session,
        user: User,
        *,
        organization_id: str | None,
        message: str,
        attachment_ids: list[str] | None = None,
        use_search: bool = False,
        use_library: bool = False,
    ) -> AgentContext:
        context = AgentContext()
        if attachment_ids:
            context.attachments = document_context(db, user, organization_id, attachment_ids)
            context.invocations.append(
                ToolInvocation(
                    tool="document_analysis",
                    status="completed",
                    summary=f"Extracted {len(context.attachments)} attachment(s).",
                    details={"files": [a.filename for a in context.attachments]},
                )
            )
        if use_library:
            hits = library_hits(db, user, message)
            context.library_hits = hits
            context.invocations.append(
                ToolInvocation(
                    tool="library_retrieval",
                    status="completed" if hits else "empty",
                    summary=f"{len(hits)} library passage(s) retrieved.",
                )
            )
        if use_search:
            results, meta = web_search(db, user, message)
            context.search_results = results
            context.search_meta = meta
            context.invocations.append(
                ToolInvocation(
                    tool="web_search",
                    status="completed",
                    summary=f"{len(results)} web source(s) via {meta.get('provider')}.",
                    details={"job_id": meta.get("job_id")},
                )
            )
        return context

    def stream_answer(
        self, messages: list[ChatTurn], context: AgentContext, model: str | None = None
    ) -> Iterator[str]:
        provider = get_provider()
        yield from provider.stream_chat(
            messages,
            attachments=context.attachments,
            search_results=context.search_results,  # type: ignore[arg-type]
            library_hits=library_note_text(context.library_hits),
            model=model,
        )

    # ------------------------------------------------------------------
    # InternFlow grounded assistant
    # ------------------------------------------------------------------
    def internflow_chat(
        self, db: Session, user: User, org: OrgContext, message: str
    ) -> dict:
        text = (message or "").strip()
        lowered = text.lower()
        if org.is_admin:
            return self._admin_reply(db, org, text, lowered)
        intern = db.scalar(
            select(InternProfile).where(
                InternProfile.organization_id == org.organization.id,
                InternProfile.user_id == user.id,
            )
        )
        if intern is None:
            raise forbidden("No intern profile is linked to this account in this organization.")
        return self._intern_reply(db, intern, text, lowered)

    def _intern_reply(self, db: Session, intern: InternProfile, text: str, lowered: str) -> dict:
        ctx = intern_context(db, intern)
        current: TaskAssignment | None = ctx["current"]
        evaluation: Evaluation | None = ctx["evaluation"]
        meeting = ctx["meeting"]
        assignments = ctx["assignments"]
        approved = [a for a in assignments if a.status == "approved"]

        if any(word in lowered for word in ("meeting", "review", "call", "meet")):
            if meeting:
                status = meeting.status.replace("_", " ").title()
                when = meeting.start_at.strftime("%d %b %Y, %H:%M UTC") if meeting.start_at else "to be confirmed"
                reply = (
                    f"## Review meeting\n\n- **Status:** {status}\n- **When:** {when}\n"
                    f"- **Title:** {meeting.title}\n"
                    + (f"- **Google Meet:** {meeting.meet_url}\n" if meeting.meet_url else
                       "- **Link:** Not created. The slot is proposed until your administrator confirms it. "
                       "You can download the `.ics` proposal from InternFlow.\n")
                    + (f"\n{meeting.notes}" if meeting.notes else "")
                )
            else:
                reply = "No review meeting is currently scheduled or proposed."
            return {"reply": reply, "intent": "meeting"}

        if any(word in lowered for word in ("incorrect", "correction", "wrong", "feedback", "failed", "improve")):
            if evaluation and evaluation.status in {"corrections_required", "human_review_required"}:
                failed = [c for c in evaluation.criteria_results if c.status != "passed"]
                lines = [
                    f"## Feedback on your submission\n\n**Score:** {evaluation.score:.0f} / 100 · "
                    f"**Status:** {evaluation.status.replace('_', ' ').title()}\n",
                    evaluation.summary,
                    "",
                ]
                if failed:
                    lines.append("### Criteria needing work")
                    for criterion in failed:
                        lines.append(
                            f"- **{criterion.label}** — {criterion.comment}\n"
                            f"  - Evidence reviewed: {criterion.evidence or 'none found'}"
                        )
                if evaluation.corrective_actions:
                    lines.append("\n### What to do next")
                    for index, action in enumerate(evaluation.corrective_actions, start=1):
                        lines.append(f"{index}. {action}")
                lines.append("\nResubmit through InternFlow. Your previous version is preserved.")
                reply = "\n".join(lines)
            else:
                reply = "You have no open correction feedback right now."
            return {"reply": reply, "intent": "feedback"}

        if "deadline" in lowered or ("when" in lowered and "due" in lowered):
            if current and current.due_at:
                extra = " **This task is overdue.**" if current.due_at < utcnow() and current.status != "approved" else ""
                reply = (
                    f"Your current task **{current.title}** is due "
                    f"**{current.due_at.strftime('%d %b %Y, %H:%M')} UTC**.{extra}\n\n"
                    f"Status: {current.status.replace('_', ' ')}. Attempts used: {current.attempt_count}."
                )
            else:
                reply = "You do not have an active task with a deadline."
            return {"reply": reply, "intent": "deadline"}

        if any(word in lowered for word in ("progress", "status", "how am i", "complete")):
            lines = [
                f"## Your progress\n\n- **Internship status:** {intern.status.title()}\n"
                f"- **Tasks approved:** {len(approved)} of {len(assignments)}\n"
                f"- **Current task:** {current.title if current else 'None'}\n"
            ]
            for assignment in assignments:
                mark = "✓" if assignment.status == "approved" else "•"
                due = assignment.due_at.strftime("%d %b %Y") if assignment.due_at else "—"
                lines.append(f"{mark} **{assignment.title}** — {assignment.status.replace('_', ' ')} · due {due}")
            return {"reply": "\n".join(lines), "intent": "progress"}

        if any(word in lowered for word in ("next task", "next assignment")):
            if current and current.status == "approved":
                nxt = next(
                    (a for a in assignments if a.sequence_order > current.sequence_order), None
                )
                reply = (
                    f"Your next task is **{nxt.title}**, due "
                    f"**{nxt.due_at.strftime('%d %b %Y') if nxt and nxt.due_at else 'to be set'}**."
                    if nxt else "You have completed the current task sequence."
                )
            else:
                reply = (
                    f"Your next task unlocks after **{current.title if current else 'your current task'}** is approved."
                )
            return {"reply": reply, "intent": "next_task"}

        if any(word in lowered for word in ("how do i", "how to", "methodology", "criteria", "deliverable", "submit")):
            if current:
                template = current.template
                lines = [
                    f"## How to complete: {current.title}\n",
                    (template.description if template else ""),
                    "\n### Required methodology",
                    (template.expected_methodology if template else "Follow the task brief."),
                    "\n### Deliverables",
                ]
                for item in (template.deliverables if template else []):
                    lines.append(f"- {item}")
                lines.append("\n### Acceptance criteria")
                for criterion in (template.acceptance_criteria if template else []):
                    label = criterion.get("label") or criterion.get("key") or "Criterion"
                    lines.append(f"- {label}{' (mandatory)' if criterion.get('mandatory') else ''}")
                lines.append(
                    f"\n### Deadline\n{current.due_at.strftime('%d %b %Y, %H:%M UTC') if current.due_at else 'To be confirmed'}"
                    f"\n\nSubmit via **InternFlow → Submit work**. Each resubmission creates a new version."
                )
                reply = "\n".join(line for line in lines if line is not None)
            else:
                reply = "You have no active task. Your administrator will assign one."
            return {"reply": reply, "intent": "guidance"}

        # Default: current task overview
        if current:
            template = current.template
            lines = [
                f"## Your current task\n\n**{current.title}**\n",
                template.description if template else "",
                "",
                f"- **Status:** {current.status.replace('_', ' ')}",
                f"- **Due:** {current.due_at.strftime('%d %b %Y, %H:%M UTC') if current.due_at else '—'}",
                f"- **Attempts:** {current.attempt_count} of {template.max_attempts if template else '—'}",
                "",
                "Ask me about the deadline, requirements, feedback, your progress, or the review meeting.",
            ]
            return {"reply": "\n".join(lines), "intent": "current_task"}
        return {
            "reply": "You have no active task yet. Your administrator will assign the first task after onboarding.",
            "intent": "empty",
        }

    def _admin_reply(self, db: Session, org: OrgContext, text: str, lowered: str) -> dict:
        org_id = org.organization.id
        summary = progress_summary(db, org_id)

        if "overdue" in lowered:
            rows = [r for r in summary["interns"] if r["overdue"]]
            lines = ["## Overdue tasks", ""]
            if not rows:
                lines.append("No tasks are currently overdue.")
            for row in rows:
                due = row["due_at"].strftime("%d %b %Y") if row["due_at"] else "—"
                lines.append(
                    f"- **{row['name']}** — {row['current_task'] or '—'} · due {due} · {row['email']}"
                )
            return {"reply": "\n".join(lines), "intent": "overdue"}

        if any(word in lowered for word in ("await", "pending evaluation", "review", "evaluation queue")):
            pending = db.scalars(
                select(Evaluation)
                .where(Evaluation.status == "human_review_required")
                .join(TaskAssignment, Evaluation.assignment_id == TaskAssignment.id)
                .where(TaskAssignment.organization_id == org_id)
            ).all()
            lines = ["## Evaluation queue", ""]
            if not pending:
                lines.append("No evaluations are waiting for a human decision.")
            for evaluation in pending:
                assignment = db.get(TaskAssignment, evaluation.assignment_id)
                intern = db.get(InternProfile, assignment.intern_id) if assignment else None
                lines.append(
                    f"- **{intern.full_name if intern else 'Intern'}** — {assignment.title if assignment else '—'}"
                    f" · score {evaluation.score:.0f} · {evaluation.human_review_reason or 'review requested'}"
                )
            return {"reply": "\n".join(lines), "intent": "awaiting_evaluation"}

        if any(phrase in lowered for phrase in ("failed first", "first evaluation", "first attempt")):
            rows = db.execute(
                select(Evaluation, TaskAssignment, InternProfile)
                .join(TaskAssignment, Evaluation.assignment_id == TaskAssignment.id)
                .join(InternProfile, TaskAssignment.intern_id == InternProfile.id)
                .join(Submission, Evaluation.submission_id == Submission.id)
                .where(
                    TaskAssignment.organization_id == org_id,
                    Submission.version == 1,
                    Evaluation.status.in_(["corrections_required", "human_review_required"]),
                )
            ).all()
            lines = ["## Failed first evaluations", ""]
            if not rows:
                lines.append("No first submissions require corrections.")
            for evaluation, assignment, intern in rows:
                lines.append(
                    f"- **{intern.full_name}** — {assignment.title} · score {evaluation.score:.0f} · {evaluation.status.replace('_', ' ')}"
                )
            return {"reply": "\n".join(lines), "intent": "failed_first"}

        if any(word in lowered for word in ("completed", "finished", "graduated")):
            completed = [r for r in summary["interns"] if r["status"] == "completed"]
            lines = ["## Completed internships", ""]
            if not completed:
                lines.append("No interns have completed all tasks yet.")
            for row in completed:
                lines.append(f"- **{row['name']}** — {row['department'] or 'General'} · {row['email']}")
            return {"reply": "\n".join(lines), "intent": "completed"}

        if "email" in lowered and any(word in lowered for word in ("fail", "sent", "deliver", "status")):
            from app.models import EmailLog

            logs = db.scalars(
                select(EmailLog)
                .where(EmailLog.organization_id == org_id)
                .order_by(EmailLog.created_at.desc())
                .limit(20)
            ).all()
            failed = [log for log in logs if log.status == "failed"]
            demo = [log for log in logs if log.status == "demo"]
            lines = [
                "## Email delivery status",
                "",
                f"- Sent: **{len([l for l in logs if l.status == 'sent'])}**",
                f"- Demo (not delivered externally): **{len(demo)}**",
                f"- Failed: **{len(failed)}**",
                "",
            ]
            for log in failed[:8]:
                lines.append(f"- FAILED · {log.to_email} · {log.subject} · {log.error or 'unknown error'}")
            for log in demo[:5]:
                lines.append(f"- demo · {log.to_email} · {log.subject}")
            return {"reply": "\n".join(lines), "intent": "email_status"}

        if any(word in lowered for word in ("progress report", "report", "summary")):
            lines = [
                f"## InternFlow progress — {datetime.utcnow().strftime('%d %b %Y')}",
                "",
                f"- Interns: **{summary['interns_total']}** · Active **{summary['active']}** · "
                f"Completed **{summary['completed']}** · Overdue **{summary['overdue']}**",
                f"- Tasks approved: **{summary['tasks_approved']}** · Pending: **{summary['tasks_pending']}**",
                "",
                "| Intern | Status | Current task | Approved |",
                "| --- | --- | --- | --- |",
            ]
            for row in summary["interns"][:30]:
                lines.append(
                    f"| {row['name']} | {row['status']}{' (overdue)' if row['overdue'] else ''} | "
                    f"{(row['current_task'] or '—')} | {row['tasks_approved']}/{row['tasks_total']} |"
                )
            if not summary["interns"]:
                lines.append("| No interns yet | — | — | — |")
            return {"reply": "\n".join(lines), "intent": "progress_report"}

        if "task" in lowered:
            templates = db.scalars(
                select(TaskTemplate)
                .where(TaskTemplate.organization_id == org_id)
                .order_by(TaskTemplate.sequence_order)
            ).all()
            lines = ["## Task sequence", ""]
            if not templates:
                lines.append("No task templates exist yet. Create one under InternFlow → Task templates.")
            for template in templates:
                lines.append(
                    f"{template.sequence_order}. **{template.title}** — {len(template.deliverables)} deliverable(s), "
                    f"{template.deadline_days}-day deadline, pass {template.pass_threshold:.0f}, v{template.version}."
                )
            return {"reply": "\n".join(lines), "intent": "tasks"}

        # Default overview
        lines = [
            "## InternFlow overview",
            "",
            f"- **Interns:** {summary['interns_total']} total, {summary['active']} active, {summary['completed']} completed",
            f"- **Overdue:** {summary['overdue']}",
            f"- **Tasks:** {summary['tasks_approved']} approved, {summary['tasks_pending']} pending",
            "",
            "Ask me about overdue tasks, the evaluation queue, failed first attempts, completed interns, email delivery, or a progress report.",
        ]
        return {"reply": "\n".join(lines), "intent": "overview"}


agent = NexoraAgent()
