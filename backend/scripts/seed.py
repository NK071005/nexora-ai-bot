"""Seed NEXORA AI with a realistic, fully functional demo workspace.

Run from the ``backend`` directory:

    python scripts/seed.py

The script is idempotent: running it twice will not duplicate users, interns,
templates, library items or scheduled tasks. Credentials are printed at the end.
No email is sent externally unless SMTP is configured; every generated email is
recorded in ``email_logs`` with an honest ``demo`` status.
"""

from __future__ import annotations

import sys
from datetime import date, timedelta
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from sqlalchemy import select  # noqa: E402

from app.config import settings  # noqa: E402
from app.database import SessionLocal, init_db  # noqa: E402
from app.models import (  # noqa: E402
    ChatMessage,
    ChatSession,
    Evaluation,
    InternProfile,
    LibraryItem,
    Meeting,
    Notification,
    Organization,
    OrganizationMembership,
    ScheduledTask,
    TaskAssignment,
    TaskTemplate,
    User,
    UserProfile,
    utcnow,
)
from app.security.passwords import hash_password  # noqa: E402
from app.services.internflow import submit_work  # noqa: E402

DEMO_PASSWORD = "NexoraDemo!2026"
SUPER_PASSWORD = "NexoraSuper!2026"
ORG_SLUG = "nexora-labs"

LIBRARY_NOTE = """# Nexora Labs onboarding guide

Nexora Labs is a research and product studio. Interns work in small squads and
ship a visible artefact every week.

## Working rhythm
- Daily async stand-up before 10:30 local time.
- Weekly demo on Friday. Show the artefact, not slides about the artefact.
- Every claim needs a source: a link, a file, a query result or a named interview.

## Review standard
Work is reviewed against the task rubric. Mandatory criteria cannot be waived by
a high score. If a criterion cannot be verified automatically, a human reviewer
decides.

## Tooling
NEXORA AI chat supports document analysis, a lexical library search and optional
live web research. Demo Intelligence is extractive and clearly labelled; connect
an OpenAI key for generative answers.
"""

MARKET_BRIEF = """# Weekly research brief — workplace AI assistants

## Audience
Operations leads at mid-sized Indian service companies (200–1,500 employees).

## Market signal
Three competitors now position around "meeting recall": Otter.ai, Fireflies and
a local entrant, MeetMind. Buyers care about data residency, per-seat pricing and
integration with Google Workspace.

## Competitive table

| Vendor | Positioning | Pricing signal | Residency |
| --- | --- | --- | --- |
| Otter.ai | Meeting notes | Per seat, free tier | US |
| Fireflies | Revenue intelligence | Per seat, annual | US/EU |
| MeetMind | India-first recall | Per seat, INR | India |

## Recommendation
Lead with a compliance-first message, publish transparent per-seat pricing and
ship a Workspace integration before expanding the feature surface.
"""

BOSS_TEXT = """# Market research: AI note-taking for Indian SMBs

## Audience
We interviewed six operations leads at companies with 200 to 900 employees. All
six said meeting recall is a real pain, but only two would approve a US-only data
processor. The competitor set is Otter.ai, Fireflies and MeetMind, with MeetMind
claiming local residency.

## Evidence table

| Competitor | Claim | Buyer reaction |
| --- | --- | --- |
| Otter.ai | Best transcript quality | Trusted but residency concern |
| Fireflies | CRM enrichment | Too heavy for the segment |
| MeetMind | India-first storage | Strong interest, weaker brand |

## Recommendation
Position around local data residency, publish per-seat pricing and integrate with
Google Workspace first. Validate willingness to pay with ten more interviews.
"""

WEAK_TEXT = """I looked at the market briefly. There are several competitors and the
audience seems interested. I think pricing matters. More analysis will follow."""

HUMAN_REVIEW_TEXT = """# Competitive positioning memo

## Summary
The competitor landscape is crowded. Buyers value trust, local data handling and
predictable pricing. Our wedge should be compliance plus a fast Workspace setup.

## Findings
- Otter.ai leads on transcript quality.
- Fireflies bundles CRM enrichment that mid-sized buyers rarely use.
- MeetMind wins on data residency but has weak brand recall.

## Brand judgment
The brand feels credible and differentiated for the compliance-first segment.
"""


def _ensure_user(
    db,
    *,
    email: str,
    full_name: str,
    password: str,
    is_super_admin: bool = False,
    super_admin: bool = False,
) -> User:
    user = db.scalar(select(User).where(User.email == email))
    if user is None:
        user = User(
            email=email,
            full_name=full_name,
            password_hash=hash_password(password),
            is_active=True,
            is_super_admin=is_super_admin or super_admin,
            email_verified_at=utcnow(),
            timezone=settings.default_timezone,
            theme="system",
        )
        db.add(user)
        db.flush()
        db.add(UserProfile(user_id=user.id, preferences={}, notification_prefs={}))
    else:
        if is_super_admin or super_admin:
            user.is_super_admin = True
        if not user.password_hash:
            user.password_hash = hash_password(password)
    return user


def _ensure_membership(db, org: Organization, user: User, role: str) -> None:
    membership = db.scalar(
        select(OrganizationMembership).where(
            OrganizationMembership.organization_id == org.id,
            OrganizationMembership.user_id == user.id,
        )
    )
    if membership is None:
        db.add(
            OrganizationMembership(
                organization_id=org.id, user_id=user.id, role=role, status="active"
            )
        )
    else:
        membership.role = role
        membership.status = "active"
    user.default_organization_id = user.default_organization_id or org.id


TEMPLATES = [
    {
        "title": "Market research brief",
        "slug": "market-research-brief",
        "sequence_order": 1,
        "deadline_days": 7,
        "description": (
            "Produce a sourced market brief for a defined audience. Summarise the "
            "competitive set, show the evidence in a table and end with one clear recommendation."
        ),
        "objectives": [
            "Define the buyer and the problem",
            "Map at least three competitors with evidence",
            "Recommend a positioning wedge",
        ],
        "expected_methodology": (
            "Desk research plus at least three primary conversations. Separate observation "
            "from inference. Cite every external claim."
        ),
        "deliverables": ["Written brief", "Evidence table", "One recommendation"],
        "acceptance_criteria": [
            {
                "key": "market_terms",
                "label": "Defines market, audience and competitor set",
                "type": "keywords",
                "keywords": ["market", "audience", "competitor"],
                "mandatory": True,
                "weight": 2,
                "description": "The brief must name the market, its audience and the competitors.",
            },
            {
                "key": "evidence_table",
                "label": "Includes an evidence table",
                "type": "table",
                "mandatory": False,
                "weight": 1,
                "description": "Claims should be organised in a labelled table.",
            },
            {
                "key": "depth",
                "label": "Substantive analysis (120+ words)",
                "type": "min_words",
                "min": 120,
                "mandatory": False,
                "weight": 2,
                "description": "A short summary is not enough; show the reasoning.",
            },
            {
                "key": "no_placeholders",
                "label": "No placeholder content",
                "type": "forbidden",
                "forbidden": ["lorem ipsum", "todo", "tbd", "placeholder"],
                "mandatory": True,
                "weight": 1,
                "description": "Submitted work must be complete.",
            },
        ],
        "permitted_tools": ["NEXORA AI chat", "Web search", "Spreadsheet"],
        "submission_formats": ["Markdown", "PDF", "DOCX"],
        "pass_threshold": 70,
        "max_attempts": 3,
    },
    {
        "title": "Competitive positioning memo",
        "slug": "competitive-positioning-memo",
        "sequence_order": 2,
        "deadline_days": 5,
        "description": (
            "Turn the market brief into a positioning memo. State the wedge, the proof "
            "and the risks, with a clear recommendation for the next experiment."
        ),
        "objectives": [
            "Convert research into a positioning choice",
            "Show the evidence behind the choice",
            "Name the riskiest assumption",
        ],
        "expected_methodology": "Use the evidence table from task 1. Do not introduce unsourced claims.",
        "deliverables": ["Positioning memo", "Three findings", "Recommendation"],
        "acceptance_criteria": [
            {
                "key": "structure",
                "label": "Summary, Findings and Recommendations sections",
                "type": "sections",
                "sections": ["Summary", "Findings", "Recommendations"],
                "mandatory": True,
                "weight": 2,
                "description": "Use the required memo structure.",
            },
            {
                "key": "positioning_terms",
                "label": "Discusses positioning and pricing",
                "type": "keywords",
                "keywords": ["positioning", "pricing"],
                "mandatory": True,
                "weight": 2,
                "description": "Positioning must be explicit and commercially grounded.",
            },
            {
                "key": "findings_count",
                "label": "At least three structured findings",
                "type": "min_count",
                "min": 3,
                "mandatory": False,
                "weight": 1,
                "description": "Show the evidence as a numbered list.",
            },
            {
                "key": "depth",
                "label": "Substantive memo (100+ words)",
                "type": "min_words",
                "min": 100,
                "mandatory": False,
                "weight": 1,
                "description": "The memo must explain the reasoning.",
            },
        ],
        "permitted_tools": ["NEXORA AI chat", "Library"],
        "submission_formats": ["Markdown", "DOCX"],
        "pass_threshold": 75,
        "max_attempts": 3,
    },
    {
        "title": "Squad analytics review",
        "slug": "squad-analytics-review",
        "sequence_order": 3,
        "deadline_days": 4,
        "description": (
            "Analyse the supplied onboarding funnel export. Identify the largest drop-off, "
            "quantify it and recommend one experiment with a measurable hypothesis."
        ),
        "objectives": [
            "Clean and describe the dataset",
            "Identify the largest drop-off",
            "Propose one measurable experiment",
        ],
        "expected_methodology": "Show the calculation, state assumptions and avoid causal claims from a single week.",
        "deliverables": ["Analysis write-up", "Funnel table", "Experiment hypothesis"],
        "acceptance_criteria": [
            {
                "key": "data_terms",
                "label": "Uses funnel, drop-off and hypothesis language",
                "type": "keywords",
                "keywords": ["funnel", "drop-off", "hypothesis"],
                "mandatory": True,
                "weight": 2,
                "description": "The analysis must be framed as a funnel experiment.",
            },
            {
                "key": "table",
                "label": "Includes a funnel table",
                "type": "table",
                "mandatory": True,
                "weight": 2,
                "description": "Show the funnel in a table.",
            },
            {
                "key": "recommendations",
                "label": "Three numbered recommendations",
                "type": "min_count",
                "min": 3,
                "mandatory": False,
                "weight": 1,
                "description": "Prioritise the next three actions.",
            },
        ],
        "permitted_tools": ["Spreadsheet", "Library", "NEXORA AI chat"],
        "submission_formats": ["Markdown", "XLSX"],
        "pass_threshold": 70,
        "max_attempts": 2,
    },
    {
        "title": "Brand perception review",
        "slug": "brand-perception-review",
        "sequence_order": 4,
        "deadline_days": 3,
        "description": (
            "Summarise interview evidence on brand perception. Deterministic checks cover "
            "structure; a human reviewer assesses tone and brand judgment."
        ),
        "objectives": ["Synthesise interview themes", "Separate evidence from judgment"],
        "expected_methodology": "Quote or paraphrase interviews; never invent a participant.",
        "deliverables": ["Perception memo"],
        "acceptance_criteria": [
            {
                "key": "structure",
                "label": "Summary, Findings and Recommendations sections",
                "type": "sections",
                "sections": ["Summary", "Findings", "Recommendations"],
                "mandatory": True,
                "weight": 2,
            },
            {
                "key": "evidence",
                "label": "Mentions buyer evidence",
                "type": "keywords",
                "keywords": ["buyers", "evidence"],
                "mandatory": True,
                "weight": 1,
            },
            {
                "key": "tone",
                "label": "Brand judgment quality",
                "type": "manual",
                "mandatory": False,
                "weight": 2,
                "description": "A human reviewer assesses whether the brand judgment is supported.",
            },
        ],
        "permitted_tools": ["NEXORA AI chat"],
        "submission_formats": ["Markdown"],
        "pass_threshold": 70,
        "max_attempts": 2,
    },
]


def _ensure_template(db, org: Organization, admin: User, data: dict) -> TaskTemplate:
    template = db.scalar(
        select(TaskTemplate).where(
            TaskTemplate.organization_id == org.id, TaskTemplate.slug == data["slug"]
        )
    )
    if template is None:
        template = TaskTemplate(
            organization_id=org.id,
            created_by=admin.id,
            title=data["title"],
            slug=data["slug"],
            description=data["description"],
            objectives=data["objectives"],
            expected_methodology=data["expected_methodology"],
            deliverables=data["deliverables"],
            acceptance_criteria=data["acceptance_criteria"],
            rubric={"version": 1, "pass_threshold": data["pass_threshold"]},
            permitted_tools=data["permitted_tools"],
            submission_formats=data["submission_formats"],
            deadline_days=data["deadline_days"],
            review_required=True,
            pass_threshold=data["pass_threshold"],
            max_attempts=data["max_attempts"],
            sequence_order=data["sequence_order"],
            version=1,
            status="active",
        )
        db.add(template)
        db.flush()
    return template


def _ensure_intern(
    db,
    org: Organization,
    *,
    user: User,
    full_name: str,
    email: str,
    department: str,
    role_title: str,
    start: date,
    end: date,
    status: str,
) -> InternProfile:
    intern = db.scalar(
        select(InternProfile).where(
            InternProfile.organization_id == org.id, InternProfile.email == email
        )
    )
    if intern is None:
        intern = InternProfile(
            organization_id=org.id,
            user_id=user.id,
            full_name=full_name,
            email=email,
            department=department,
            role_title=role_title,
            company_name=org.name,
            start_date=start,
            end_date=end,
            duration_weeks=max(1, ((end - start).days + 6) // 7),
            timezone=settings.default_timezone,
            status=status,
            onboarding_email_status="demo" if not settings.email_configured else "sent",
        )
        db.add(intern)
        db.flush()
    else:
        intern.user_id = intern.user_id or user.id
    return intern


def seed() -> None:
    init_db()
    db = SessionLocal()
    try:
        super_admin = _ensure_user(
            db,
            email="super@nexora.demo",
            full_name="Samira Rao",
            password=SUPER_PASSWORD,
            super_admin=True,
        )
        admin = _ensure_user(
            db,
            email="admin@nexora.demo",
            full_name="Dev Malhotra",
            password=DEMO_PASSWORD,
        )
        intern_user = _ensure_user(
            db,
            email="intern@nexora.demo",
            full_name="Aarav Mehta",
            password=DEMO_PASSWORD,
        )
        priya_user = _ensure_user(
            db,
            email="priya@nexora.demo",
            full_name="Priya Sharma",
            password=DEMO_PASSWORD,
        )
        rohan_user = _ensure_user(
            db,
            email="rohan@nexora.demo",
            full_name="Rohan Iyer",
            password=DEMO_PASSWORD,
        )
        maya_user = _ensure_user(
            db,
            email="maya@nexora.demo",
            full_name="Maya Nair",
            password=DEMO_PASSWORD,
        )

        org = db.scalar(select(Organization).where(Organization.slug == ORG_SLUG))
        if org is None:
            org = Organization(
                name="Nexora Labs",
                slug=ORG_SLUG,
                kind="team",
                settings={
                    "demo": True,
                    "review_window": "Friday",
                    "data_region": "local",
                },
            )
            db.add(org)
            db.flush()
        _ensure_membership(db, org, super_admin, "owner")
        _ensure_membership(db, org, admin, "owner")
        _ensure_membership(db, org, intern_user, "intern")
        _ensure_membership(db, org, priya_user, "intern")
        _ensure_membership(db, org, rohan_user, "intern")
        _ensure_membership(db, org, maya_user, "member")
        admin.default_organization_id = org.id

        templates = [_ensure_template(db, org, admin, data) for data in TEMPLATES]

        start = date.today() - timedelta(days=18)
        end = start + timedelta(weeks=10)
        aarav = _ensure_intern(
            db,
            org,
            user=intern_user,
            full_name="Aarav Mehta",
            email="intern@nexora.demo",
            department="Research",
            role_title="Research Intern",
            start=start,
            end=end,
            status="active",
        )
        priya = _ensure_intern(
            db,
            org,
            user=priya_user,
            full_name="Priya Sharma",
            email="priya@nexora.demo",
            department="Product",
            role_title="Product Intern",
            start=start,
            end=end,
            status="active",
        )
        rohan = _ensure_intern(
            db,
            org,
            user=rohan_user,
            full_name="Rohan Iyer",
            email="rohan@nexora.demo",
            department="Brand",
            role_title="Brand Intern",
            start=start,
            end=end,
            status="active",
        )

        # --- Library -----------------------------------------------------
        library_item = db.scalar(
            select(LibraryItem).where(
                LibraryItem.user_id == admin.id, LibraryItem.title == "Nexora Labs onboarding guide"
            )
        )
        if library_item is None:
            library_item = LibraryItem(
                user_id=admin.id,
                organization_id=org.id,
                kind="note",
                title="Nexora Labs onboarding guide",
                description="Working rhythm, review standard and tooling for new interns.",
                content_text=LIBRARY_NOTE,
                source_type="seed",
                is_favorite=True,
                metadata_json={"seeded": True, "words": len(LIBRARY_NOTE.split())},
            )
            db.add(library_item)
            db.flush()
        brief_item = db.scalar(
            select(LibraryItem).where(
                LibraryItem.user_id == admin.id, LibraryItem.title == "Market brief — workplace AI assistants"
            )
        )
        if brief_item is None:
            brief_item = LibraryItem(
                user_id=admin.id,
                organization_id=org.id,
                kind="note",
                title="Market brief — workplace AI assistants",
                description="Example evidence table and recommendation used in the demo.",
                content_text=MARKET_BRIEF,
                source_type="seed",
                metadata_json={"seeded": True},
            )
            db.add(brief_item)
            db.flush()

        # --- Assignments, submissions and evaluations ---------------------
        def existing_assignment(intern: InternProfile, sequence: int) -> TaskAssignment | None:
            return db.scalar(
                select(TaskAssignment).where(
                    TaskAssignment.intern_id == intern.id,
                    TaskAssignment.sequence_order == sequence,
                )
            )

        if existing_assignment(aarav, 1) is None:
            first = TaskAssignment(
                organization_id=org.id,
                intern_id=aarav.id,
                template_id=templates[0].id,
                template_version=templates[0].version,
                title=templates[0].title,
                sequence_order=1,
                status="assigned",
                due_at=utcnow() + timedelta(days=4),
                assigned_by=admin.id,
            )
            db.add(first)
            db.flush()
            aarav.current_assignment_id = first.id
            submission, _ = submit_work(db, aarav, first, BOSS_TEXT)
            submission.status = "evaluated"
            db.commit()

        aarav = db.scalar(select(InternProfile).where(InternProfile.id == aarav.id))
        second = existing_assignment(aarav, 2)
        if second is None and aarav.status != "completed":
            second = TaskAssignment(
                organization_id=org.id,
                intern_id=aarav.id,
                template_id=templates[1].id,
                template_version=templates[1].version,
                title=templates[1].title,
                sequence_order=2,
                status="assigned",
                due_at=utcnow() + timedelta(days=3),
                assigned_by=admin.id,
            )
            db.add(second)
            db.flush()
            aarav.current_assignment_id = second.id
            db.commit()
        if second is not None and second.status in {"assigned", "overdue", "corrections_required"}:
            has_submission = db.scalar(
                select(Evaluation).where(Evaluation.assignment_id == second.id)
            )
            if has_submission is None:
                submit_work(db, aarav, second, WEAK_TEXT)
                db.commit()

        if existing_assignment(priya, 1) is None:
            p_first = TaskAssignment(
                organization_id=org.id,
                intern_id=priya.id,
                template_id=templates[0].id,
                template_version=templates[0].version,
                title=templates[0].title,
                sequence_order=1,
                status="assigned",
                due_at=utcnow() + timedelta(days=2),
                assigned_by=admin.id,
            )
            db.add(p_first)
            db.flush()
            priya.current_assignment_id = p_first.id
            submit_work(db, priya, p_first, BOSS_TEXT)
            db.commit()

        if existing_assignment(rohan, 1) is None:
            r_first = TaskAssignment(
                organization_id=org.id,
                intern_id=rohan.id,
                template_id=templates[3].id,
                template_version=templates[3].version,
                title=templates[3].title,
                sequence_order=1,
                status="assigned",
                due_at=utcnow() + timedelta(days=1),
                assigned_by=admin.id,
            )
            db.add(r_first)
            db.flush()
            rohan.current_assignment_id = r_first.id
            submit_work(db, rohan, r_first, HUMAN_REVIEW_TEXT)
            db.commit()

        # Guarantee one pending human-review item even on repeated runs.
        if not db.scalar(
            select(Evaluation)
            .where(Evaluation.status == "human_review_required")
            .where(Evaluation.assignment_id.in_(
                select(TaskAssignment.id).where(TaskAssignment.organization_id == org.id)
            ))
        ):
            rohan = db.scalar(select(InternProfile).where(InternProfile.id == rohan.id))
            current = db.get(TaskAssignment, rohan.current_assignment_id) if rohan.current_assignment_id else None
            if current and current.status in {"assigned", "corrections_required", "overdue"}:
                submit_work(db, rohan, current, HUMAN_REVIEW_TEXT)
                db.commit()

        # --- Chat history -------------------------------------------------
        chat = db.scalar(
            select(ChatSession).where(
                ChatSession.user_id == intern_user.id,
                ChatSession.title == "Welcome to InternFlow",
            )
        )
        if chat is None:
            chat = ChatSession(
                user_id=intern_user.id,
                organization_id=org.id,
                title="Welcome to InternFlow",
                model=None,
                last_message_at=utcnow(),
                message_count=2,
            )
            db.add(chat)
            db.flush()
            db.add_all(
                [
                    ChatMessage(
                        chat_id=chat.id,
                        role="user",
                        content="What is my current task and when is it due?",
                        status="complete",
                    ),
                    ChatMessage(
                        chat_id=chat.id,
                        role="assistant",
                        content=(
                            "## Your current task\n\nOpen InternFlow and submit your work before the due date. "
                            "The assistant answers from your actual assignment record — it never invents a deadline.\n\n"
                            "Try asking: *What feedback did I get?*, *When is my review meeting?* or *How do I submit?*"
                        ),
                        status="complete",
                        provider="demo",
                        tool_activity=[
                            {
                                "tool": "internflow_context",
                                "status": "completed",
                                "summary": "Loaded the signed-in intern's assignment.",
                                "details": {},
                            }
                        ],
                    ),
                ]
            )

        # --- Scheduled automations ---------------------------------------
        daily = db.scalar(
            select(ScheduledTask).where(
                ScheduledTask.user_id == admin.id, ScheduledTask.title == "Weekday InternFlow digest"
            )
        )
        if daily is None:
            daily = ScheduledTask(
                user_id=admin.id,
                organization_id=org.id,
                title="Weekday InternFlow digest",
                description="A concise progress report built from live intern records.",
                task_type="progress_report",
                schedule_kind="daily",
                timezone=settings.default_timezone,
                time_of_day="09:00",
                next_run_at=utcnow() + timedelta(hours=6),
                status="active",
                notify=True,
                config={},
            )
            db.add(daily)
        once = db.scalar(
            select(ScheduledTask).where(
                ScheduledTask.user_id == admin.id, ScheduledTask.title == "Onboarding guide summary"
            )
        )
        if once is None:
            once = ScheduledTask(
                user_id=admin.id,
                organization_id=org.id,
                title="Onboarding guide summary",
                description="Summarise the onboarding guide with key points and open questions.",
                task_type="summarize_document",
                schedule_kind="once",
                timezone=settings.default_timezone,
                run_at=utcnow() + timedelta(days=1),
                next_run_at=utcnow() + timedelta(days=1),
                status="active",
                notify=True,
                config={"library_item_id": library_item.id},
            )
            db.add(once)

        # Welcome notification, deduplicated by title/kind.
        if not db.scalar(
            select(Notification).where(
                Notification.user_id == intern_user.id, Notification.kind == "welcome"
            )
        ):
            db.add(
                Notification(
                    user_id=intern_user.id,
                    organization_id=org.id,
                    title="Welcome to the Nexora Labs demo",
                    body="Your intern profile is linked. Open InternFlow to see tasks, feedback and meetings.",
                    kind="welcome",
                    link="/internflow",
                )
            )

        db.commit()

        meeting_count = len(
            db.scalars(select(Meeting).where(Meeting.organization_id == org.id)).all()
        )
        evaluation_count = len(
            db.scalars(
                select(Evaluation).where(
                    Evaluation.assignment_id.in_(
                        select(TaskAssignment.id).where(TaskAssignment.organization_id == org.id)
                    )
                )
            ).all()
        )

        print("\nNEXORA AI demo workspace seeded successfully.")
        print(f"  Organization : {org.name} ({org.slug})")
        print(f"  Templates    : {len(templates)}")
        print(f"  Evaluations  : {evaluation_count}")
        print(f"  Meetings     : {meeting_count}")
        print("\nSign in:")
        print(f"  Super admin  : super@nexora.demo / {SUPER_PASSWORD}")
        print(f"  Org admin    : admin@nexora.demo / {DEMO_PASSWORD}")
        print(f"  Intern       : intern@nexora.demo / {DEMO_PASSWORD}")
        print(f"  Intern       : priya@nexora.demo / {DEMO_PASSWORD}")
        print(f"  Intern       : rohan@nexora.demo / {DEMO_PASSWORD}")
        print("\nDemo provider status:")
        print(f"  AI           : {'openai' if settings.ai_configured else 'demo (extractive, labelled)'}")
        print(f"  Email        : {'smtp' if settings.email_configured else 'demo (logged, not sent)'}")
        print(f"  Calendar     : {'google' if settings.google_calendar_configured else 'proposed + .ics fallback'}")
        print(f"  Web search   : {'live' if settings.search_configured else 'unconfigured'}")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
