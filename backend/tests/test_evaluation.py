"""Deterministic evaluation rules and the human-review boundary."""

from __future__ import annotations

from app.models import Submission, TaskAssignment, TaskTemplate
from app.services.evaluation import evaluate_submission


def _evaluate(criteria, text, *, filenames=None, attempt_count=0, max_attempts=3, threshold=70):
    template = TaskTemplate(
        title="Test task",
        description="Test description",
        acceptance_criteria=criteria,
        pass_threshold=threshold,
        max_attempts=max_attempts,
        deadline_days=5,
        status="active",
    )
    assignment = TaskAssignment(
        title="Test task",
        template=template,
        attempt_count=attempt_count,
        sequence_order=1,
        status="assigned",
        template_version=1,
    )
    submission = Submission(
        text_content=text,
        version=1,
        status="submitted",
        assignment_id="assignment-test",
        intern_id="intern-test",
    )
    return evaluate_submission(
        assignment, submission, attachment_names=filenames or [], attachment_texts=[]
    )


def test_mandatory_failure_cannot_be_overridden_by_a_high_weighted_score():
    outcome = _evaluate(
        [
            {"key": "source", "label": "Cites evidence", "type": "keywords", "keywords": ["market"], "mandatory": True, "weight": 1},
            {"key": "depth", "label": "Substantive", "type": "min_words", "min": 10, "mandatory": False, "weight": 100},
        ],
        "This submission is long enough and covers many relevant points in detail, but it never names the required source material. "
        "The analysis discusses customers, pricing, distribution and retention at length without providing the specific evidence requested by the brief.",
    )
    assert outcome.status == "corrections_required"
    assert "mandatory" in outcome.summary.lower()
    assert outcome.missing_requirements == ["Cites evidence"]
    by_key = {item.key: item for item in outcome.criteria}
    assert by_key["source"].status == "failed"
    assert by_key["depth"].status == "passed"


def test_unverified_manual_criterion_forces_human_review_even_when_everything_else_passes():
    outcome = _evaluate(
        [
            {"key": "length", "label": "Minimum length", "type": "min_words", "min": 3, "mandatory": True, "weight": 1},
            {"key": "judgement", "label": "Strategic quality", "type": "manual", "mandatory": False, "weight": 1},
        ],
        "This answer is long enough and clearly written, with several concrete observations about the market, the customers and the operating constraints. "
        "It explains the trade-offs and gives a recommendation, but the strategic quality still needs a human judgement.",
    )
    assert outcome.status == "human_review_required"
    assert outcome.human_review_required is True
    assert "human judgment" in (outcome.human_review_reason or "").lower()
    assert outcome.score == 50.0


def test_too_brief_submission_is_told_what_to_fix():
    outcome = _evaluate([{"key": "x", "type": "min_words", "min": 30, "mandatory": True}], "Too short.")
    assert outcome.status == "corrections_required"
    assert outcome.score == 0
    assert outcome.corrective_actions
    assert outcome.criteria == []


def test_structural_criteria_pass_with_real_evidence():
    text = """# Summary

This brief explains the market evidence and the recommendation.

## Findings

| Segment | Growth | Priority |
| --- | --- | --- |
| Mid-market | 18% | 1 |
| Enterprise | 7% | 2 |

1. Prioritise mid-market because payback is faster.
2. Validate retention before expanding spend.
3. Recheck channel conflict in the next quarter.

All statements are based on the supplied interview evidence.
"""
    outcome = _evaluate(
        [
            {"key": "sections", "label": "Required sections", "type": "sections", "sections": ["Summary", "Findings"], "mandatory": True},
            {"key": "table", "label": "Comparison table", "type": "table", "mandatory": True},
            {"key": "items", "label": "Recommendations", "type": "min_count", "min": 3, "mandatory": True},
            {"key": "clean", "label": "No placeholders", "type": "forbidden", "forbidden": ["lorem ipsum", "TODO"], "mandatory": True},
            {"key": "file", "label": "Workbook", "type": "file", "extensions": [".xlsx"], "mandatory": True},
        ],
        text,
        filenames=["findings.xlsx"],
    )
    assert outcome.status == "passed"
    assert outcome.score == 100.0
    assert all(item.status == "passed" for item in outcome.criteria)
    assert outcome.strengths


def test_structural_failures_expose_missing_requirements_and_corrections():
    outcome = _evaluate(
        [
            {"key": "table", "label": "Comparison table", "type": "table", "mandatory": True},
            {"key": "clean", "label": "No placeholders", "type": "forbidden", "forbidden": ["lorem ipsum"], "mandatory": True},
            {"key": "items", "label": "Recommendations", "type": "min_count", "min": 3, "mandatory": True},
            {"key": "file", "label": "Workbook", "type": "file", "extensions": [".xlsx"], "mandatory": True},
        ],
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. "
        "The submission contains enough words to pass the length guard, but it still lacks the required table, the attached workbook "
        "and three clearly numbered recommendations. Only a single item appears below.\n\n1. One recommendation only.",
    )
    assert outcome.status == "corrections_required"
    statuses = {item.key: item.status for item in outcome.criteria}
    assert statuses == {"table": "failed", "clean": "failed", "items": "failed", "file": "failed"}
    assert len(outcome.missing_requirements) == 4
    assert len(outcome.corrective_actions) == 4


def test_exhausted_attempts_route_to_a_human_instead_of_silent_failure():
    outcome = _evaluate(
        [{"key": "length", "label": "Minimum length", "type": "min_words", "min": 100, "mandatory": True}],
        "Still too short, even though this sentence adds a few more words to pass the minimum content guard. "
        "The response remains well below the one hundred words required by the configured criterion.",
        attempt_count=3,
        max_attempts=3,
    )
    assert outcome.status == "human_review_required"
    assert "Maximum automatic attempts" in (outcome.human_review_reason or "")
    assert outcome.human_review_required is True
