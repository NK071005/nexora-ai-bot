"""Pytest configuration and shared fixtures.

The environment is configured before importing the application so the test
suite always uses a disposable SQLite database and never talks to a live
provider.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

TEST_DB = BACKEND_DIR / "nexora_pytest.db"
os.environ["NEXORA_TESTING"] = "1"
os.environ["APP_ENV"] = "test"
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB.as_posix()}"
os.environ["SCHEDULER_ENABLED"] = "false"
os.environ["OPENAI_API_KEY"] = ""
os.environ["SEARCH_PROVIDER_API_KEY"] = ""
os.environ["SMTP_HOST"] = ""
os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = ""
os.environ["GOOGLE_CLIENT_ID"] = ""
os.environ["GOOGLE_CLIENT_SECRET"] = ""
os.environ["STORAGE_DIR"] = str(BACKEND_DIR / "nexora_pytest_storage")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.database import SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Base  # noqa: E402

PASSWORD = "TestPassword!2026"


@pytest.fixture(autouse=True)
def clean_database():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def register(
    client: TestClient,
    email: str = "user@example.com",
    *,
    full_name: str = "Test User",
    organization_name: str | None = "Test Workspace",
    password: str = PASSWORD,
):
    return client.post(
        "/api/auth/register",
        json={
            "email": email,
            "password": password,
            "full_name": full_name,
            "organization_name": organization_name,
        },
    )


def login(client: TestClient, email: str = "user@example.com", password: str = PASSWORD):
    return client.post("/api/auth/login", json={"email": email, "password": password})


def csrf_headers(client: TestClient) -> dict[str, str]:
    return {"X-CSRF-Token": client.cookies.get("nexora_csrf") or ""}


def make_org_with_users(db, *, slug: str = "test-org"):
    """Create an org, admin, intern user + profile, and two sequential tasks."""
    from datetime import timedelta

    from app.models import (
        InternProfile,
        Organization,
        OrganizationMembership,
        TaskAssignment,
        TaskTemplate,
        User,
        UserProfile,
        utcnow,
    )
    from app.security.passwords import hash_password

    org = Organization(name="Test Org", slug=slug, kind="team")
    db.add(org)
    db.flush()

    def user(email: str, name: str, role: str):
        account = User(
            email=email,
            full_name=name,
            password_hash=hash_password(PASSWORD),
            email_verified_at=utcnow(),
            default_organization_id=org.id,
        )
        db.add(account)
        db.flush()
        db.add(UserProfile(user_id=account.id, preferences={}, notification_prefs={}))
        db.add(
            OrganizationMembership(
                organization_id=org.id, user_id=account.id, role=role, status="active"
            )
        )
        return account

    admin = user(f"admin-{slug}@example.com", "Org Admin", "owner")
    intern_user = user(f"intern-{slug}@example.com", "Intern One", "intern")
    intern = InternProfile(
        organization_id=org.id,
        user_id=intern_user.id,
        full_name="Intern One",
        email=intern_user.email,
        department="Research",
        role_title="Research Intern",
        timezone="Asia/Kolkata",
        status="active",
    )
    db.add(intern)
    db.flush()

    criteria = [
        {"key": "topic", "label": "Covers the topic", "type": "keywords", "keywords": ["market", "evidence"], "mandatory": True, "weight": 2},
        {"key": "depth", "label": "Substantive", "type": "min_words", "min": 30, "mandatory": False, "weight": 1},
    ]
    first_template = TaskTemplate(
        organization_id=org.id,
        created_by=admin.id,
        title="Research brief",
        slug=f"research-{slug}",
        description="Write a grounded research brief.",
        objectives=["Research", "Recommend"],
        expected_methodology="Use evidence.",
        deliverables=["Brief"],
        acceptance_criteria=criteria,
        rubric={},
        permitted_tools=[],
        submission_formats=["Markdown"],
        deadline_days=5,
        pass_threshold=70,
        max_attempts=3,
        sequence_order=1,
        status="active",
    )
    second_template = TaskTemplate(
        organization_id=org.id,
        created_by=admin.id,
        title="Follow-up memo",
        slug=f"memo-{slug}",
        description="Write the follow-up memo.",
        objectives=["Synthesise"],
        expected_methodology="Use the brief.",
        deliverables=["Memo"],
        acceptance_criteria=criteria,
        rubric={},
        permitted_tools=[],
        submission_formats=["Markdown"],
        deadline_days=3,
        pass_threshold=70,
        max_attempts=2,
        sequence_order=2,
        status="active",
    )
    db.add_all([first_template, second_template])
    db.flush()

    assignment = TaskAssignment(
        organization_id=org.id,
        intern_id=intern.id,
        template_id=first_template.id,
        template_version=1,
        title=first_template.title,
        sequence_order=1,
        status="assigned",
        due_at=utcnow() + timedelta(days=2),
        assigned_by=admin.id,
    )
    db.add(assignment)
    db.flush()
    intern.current_assignment_id = assignment.id
    db.commit()
    return {
        "org": org,
        "admin": admin,
        "intern_user": intern_user,
        "intern": intern,
        "templates": [first_template, second_template],
        "assignment": assignment,
    }



