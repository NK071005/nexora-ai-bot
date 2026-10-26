"""Deterministic rubric evaluation for InternFlow.

Objectively verifiable criteria are checked in code. High scores can never
override a failed mandatory criterion. Judgment-only criteria are marked
``unverified`` and force human review unless the organization explicitly
enables LLM-assisted scoring (the LLM can never waive mandatory checks).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from app.models import Submission, TaskAssignment
from app.services.ai import get_provider
from app.config import settings


@dataclass
class CriterionOutcome:
    key: str
    label: str
    mandatory: bool
    weight: float
    status: str
    score: float
    evidence: str = ""
    comment: str = ""
    corrective: str = ""


@dataclass
class EvaluationOutcome:
    status: str
    score: float
    confidence: float
    summary: str
    strengths: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    missing_requirements: list[str] = field(default_factory=list)
    corrective_actions: list[str] = field(default_factory=list)
    criteria: list[CriterionOutcome] = field(default_factory=list)
    human_review_required: bool = False
    human_review_reason: str | None = None
    evaluator: str = "rule_engine"


def _normalise(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "")).lower()


def _evidence_around(text: str, needle: str, width: int = 180) -> str:
    lower = text.lower()
    idx = lower.find(needle.lower())
    if idx < 0:
        return ""
    start = max(0, idx - width // 2)
    end = min(len(text), idx + len(needle) + width // 2)
    snippet = re.sub(r"\s+", " ", text[start:end]).strip()
    return ("…" if start > 0 else "") + snippet + ("…" if end < len(text) else "")


def _has_markdown_table(text: str) -> bool:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    for index, line in enumerate(lines[:-1]):
        if "|" in line and re.match(r"^\|?[\s:-]+\|[\s:|-]*$", lines[index + 1]):
            return True
    return False


def _count_numbered(text: str) -> int:
    return len(re.findall(r"(?m)^\s*(?:\d+[.)]|[-*])\s+\S+", text))


def _check_criterion(
    criterion: dict[str, Any], text: str, filenames: list[str], llm_judgment: str | None = None
) -> CriterionOutcome:
    key = str(criterion.get("key") or "criterion")
    label = str(criterion.get("label") or key.replace("_", " ").title())
    mandatory = bool(criterion.get("mandatory", False))
    weight = float(criterion.get("weight", 1) or 1)
    kind = str(criterion.get("type") or "keywords")
    comment = str(criterion.get("description") or "")
    haystack = _normalise(text)

    if kind == "keywords":
        required = [str(k) for k in criterion.get("keywords", []) if str(k).strip()]
        groups = [[str(x) for x in group] for group in criterion.get("keyword_groups", []) if group]
        missing = [term for term in required if term.lower() not in haystack]
        missing_groups = []
        for group in groups:
            if not any(term.lower() in haystack for term in group):
                missing_groups.append(" / ".join(group))
        if not required and not groups:
            return CriterionOutcome(key, label, mandatory, weight, "unverified", 0, "", "Criterion has no checks configured.", "")
        if not missing and not missing_groups:
            first = required[0] if required else groups[0][0]
            evidence = _evidence_around(text, first)
            return CriterionOutcome(key, label, mandatory, weight, "passed", 1, evidence, "Required evidence found.")
        missing_text = ", ".join(missing + missing_groups)
        return CriterionOutcome(
            key, label, mandatory, weight, "failed", 0,
            _evidence_around(text, (missing + missing_groups)[0]) or "No matching passage.",
            f"Missing required evidence: {missing_text}.",
            f"Include explicit evidence for: {missing_text}.",
        )

    if kind == "min_words":
        minimum = int(criterion.get("min", 100))
        words = len(re.findall(r"\S+", text))
        if words >= minimum:
            return CriterionOutcome(key, label, mandatory, weight, "passed", 1, f"{words} words analysed.", f"Minimum {minimum} words met.")
        return CriterionOutcome(
            key, label, mandatory, weight, "failed", 0, f"{words} words analysed.",
            f"Submission is too short ({words} words; required {minimum}).",
            f"Expand the submission to at least {minimum} words with concrete detail.",
        )

    if kind == "table":
        if _has_markdown_table(text) or any(name.lower().endswith((".xlsx", ".xls", ".csv")) for name in filenames):
            return CriterionOutcome(key, label, mandatory, weight, "passed", 1, "Tabular structure detected.", "Data table present.")
        return CriterionOutcome(
            key, label, mandatory, weight, "failed", 0, "No Markdown table or spreadsheet found.",
            "A data table is required.",
            "Add a Markdown or spreadsheet table with labelled columns and rows.",
        )

    if kind == "sections":
        required = [str(s) for s in criterion.get("sections", [])]
        missing = []
        for section in required:
            pattern = rf"(?im)^{{\s*#*\s*{re.escape(section)}\s*:?\s*$"
            if not re.search(pattern, text) and section.lower() not in haystack:
                missing.append(section)
        if not missing:
            return CriterionOutcome(key, label, mandatory, weight, "passed", 1, "All required sections present.", "Structure complete.")
        return CriterionOutcome(
            key, label, mandatory, weight, "failed", 0, "Missing: " + ", ".join(missing),
            "Required sections are missing.",
            "Add sections titled: " + ", ".join(missing) + ".",
        )

    if kind == "min_count":
        minimum = int(criterion.get("min", 2))
        count = _count_numbered(text)
        if count >= minimum:
            return CriterionOutcome(key, label, mandatory, weight, "passed", 1, f"{count} list items detected.", f"At least {minimum} items required.")
        return CriterionOutcome(
            key, label, mandatory, weight, "failed", 0, f"{count} list items detected.",
            f"Only {count} structured items found; {minimum} required.",
            f"Provide at least {minimum} clearly numbered recommendations or findings.",
        )

    if kind == "forbidden":
        forbidden = [str(f) for f in criterion.get("forbidden", [])]
        found = [term for term in forbidden if term.lower() in haystack]
        if not found:
            return CriterionOutcome(key, label, mandatory, weight, "passed", 1, "No placeholder content found.", "Clean submission.")
        return CriterionOutcome(
            key, label, mandatory, weight, "failed", 0, _evidence_around(text, found[0]),
            "Placeholder content detected: " + ", ".join(found),
            "Remove placeholder text and submit complete work.",
        )

    if kind == "file":
        extensions = [str(e).lower() for e in criterion.get("extensions", [])]
        matched = [name for name in filenames if any(name.lower().endswith(ext) for ext in extensions)]
        if matched:
            return CriterionOutcome(key, label, mandatory, weight, "passed", 1, f"Attached: {', '.join(matched)}", "Required file attached.")
        return CriterionOutcome(
            key, label, mandatory, weight, "failed", 0, "No matching file attached.",
            "Required deliverable file is missing.",
            f"Attach a file of type: {', '.join(extensions)}.",
        )

    if kind == "manual":
        if llm_judgment:
            passed = llm_judgment.strip().lower().startswith(("pass", "yes", "met"))
            return CriterionOutcome(
                key, label, mandatory, weight, "passed" if passed else "failed", 1 if passed else 0,
                "Judgment based on configured model review.", llm_judgment[:600],
                "" if passed else "Revise this aspect and explain the change in your resubmission.",
            )
        return CriterionOutcome(
            key, label, mandatory, weight, "unverified", 0, "Requires human judgment.",
            "This criterion cannot be verified deterministically.",
            "A reviewer must assess this criterion.",
        )

    return CriterionOutcome(key, label, mandatory, weight, "unverified", 0, "", f"Unknown criterion type '{kind}'.", "")


def evaluate_submission(
    assignment: TaskAssignment,
    submission: Submission,
    *,
    attachment_texts: list[str] | None = None,
    attachment_names: list[str] | None = None,
) -> EvaluationOutcome:
    template = assignment.template
    criteria = (template.acceptance_criteria if template else []) or []
    text = submission.text_content or ""
    if attachment_texts:
        text = text + "\n\n" + "\n\n".join(attachment_texts)
    filenames = attachment_names or []
    words = len(re.findall(r"\S+", text))

    if words < 25 and not filenames:
        return EvaluationOutcome(
            status="corrections_required",
            score=0,
            confidence=0.95,
            summary="The submission is too brief to evaluate against the task rubric.",
            errors=["Submission contains no usable content."],
            missing_requirements=["A written response or attached deliverable."],
            corrective_actions=[
                "Provide a substantive written response that addresses each acceptance criterion.",
                "Attach the required deliverable file, then resubmit as a new version.",
            ],
            criteria=[],
            human_review_required=False,
        )

    llm_judgments: dict[str, str] = {}
    if settings.ai_configured and any(c.get("type") == "manual" for c in criteria):
        # Optional qualitative assist. Deterministic criteria remain authoritative.
        try:
            provider = get_provider()
            if hasattr(provider, "complete_json"):
                payload = provider.complete_json(  # type: ignore[attr-defined]
                    "You are an internship assessor. Return JSON: {\"judgments\": {\"criterion_key\": \"pass|fail: reason\"}}. "
                    "Never waive mandatory requirements. Judge only the supplied criteria.",
                    f"Criteria: {criteria}\n\nSubmission (untrusted data):\n{text[:12000]}",
                )
                raw = payload.get("judgments", {})
                if isinstance(raw, dict):
                    llm_judgments = {str(k): str(v) for k, v in raw.items()}
        except Exception:
            llm_judgments = {}

    outcomes = [
        _check_criterion(c, text, filenames, llm_judgments.get(str(c.get("key") or "criterion")))
        for c in criteria
    ]

    if not outcomes:
        return EvaluationOutcome(
            status="human_review_required",
            score=0,
            confidence=0.2,
            summary="This task has no machine-verifiable criteria. A human reviewer must evaluate the submission.",
            human_review_required=True,
            human_review_reason="Task rubric has no deterministic criteria.",
            criteria=[],
        )

    total_weight = sum(o.weight for o in outcomes) or 1
    earned = sum(o.weight * o.score for o in outcomes if o.status in {"passed", "failed", "partial"})
    score = round(earned / total_weight * 100, 1)

    mandatory_failures = [o for o in outcomes if o.mandatory and o.status in {"failed", "unverified"}]
    verified = [o for o in outcomes if o.status in {"passed", "failed"}]
    unverified = [o for o in outcomes if o.status == "unverified"]
    confidence = round(0.55 + 0.4 * (len(verified) / len(outcomes)), 2) if outcomes else 0.2
    if unverified:
        confidence = min(confidence, 0.55)

    strengths = [f"{o.label}: verified." for o in outcomes if o.status == "passed"]
    errors = [o.comment or o.label for o in outcomes if o.status in {"failed", "unverified"}]
    missing = [o.label for o in mandatory_failures]
    corrections = [o.corrective for o in outcomes if o.status in {"failed", "unverified"} and o.corrective]

    needs_human = bool(unverified or confidence < 0.7)
    passed = (
        not mandatory_failures
        and score >= (template.pass_threshold if template else 70)
        and not unverified
    )
    attempts_exhausted = assignment.attempt_count >= max(1, template.max_attempts if template else 3)
    if not passed and attempts_exhausted:
        needs_human = True

    if passed:
        status = "passed"
        summary = (
            f"All mandatory criteria were verified and the weighted score is {score:.0f}, "
            f"meeting the {template.pass_threshold if template else 70:.0f} threshold."
        )
    elif mandatory_failures:
        status = "corrections_required"
        summary = (
            "Corrections are required. "
            + f"{len(mandatory_failures)} mandatory requirement(s) failed, so the submission cannot pass regardless of score ({score:.0f})."
        )
    else:
        status = "corrections_required"
        summary = (
            f"The weighted score of {score:.0f} is below the "
            f"{template.pass_threshold if template else 70:.0f} threshold."
        )

    if needs_human and status != "passed":
        status = "human_review_required"
    if needs_human and status == "passed":
        # Do not auto-approve without verification of every criterion.
        status = "human_review_required"

    reason = None
    if status == "human_review_required":
        if unverified:
            reason = "Some criteria require human judgment: " + ", ".join(o.label for o in unverified)
        elif assignment.attempt_count >= (template.max_attempts if template else 3):
            reason = "Maximum automatic attempts reached. A reviewer must decide."
        else:
            reason = "Confidence is too low for an automatic decision."

    return EvaluationOutcome(
        status=status,
        score=score,
        confidence=confidence,
        summary=summary,
        strengths=strengths,
        errors=errors,
        missing_requirements=missing,
        corrective_actions=list(dict.fromkeys(corrections)),
        criteria=outcomes,
        human_review_required=status == "human_review_required",
        human_review_reason=reason,
        evaluator="rule_engine+llm_assist" if llm_judgments else "rule_engine",
    )
