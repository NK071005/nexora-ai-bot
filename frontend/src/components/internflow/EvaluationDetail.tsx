import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  HelpCircle,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { useToast } from "@/app/ToastContext";
import { ApiError, internflowApi } from "@/services/api";
import type { Evaluation } from "@/types/api";
import {
  Badge,
  Button,
  Notice,
  ProgressBar,
  SectionHeading,
  StatusBadge,
  Textarea,
} from "@/components/ui/primitives";
import { Modal } from "@/components/ui/overlays";
import { formatDateTime, formatScore } from "@/lib/format";
import { cn } from "@/lib/cn";

type Decision = "approve" | "request_corrections" | "escalate";

const decisionCopy: Record<Decision, { label: string; description: string; tone: string }> = {
  approve: {
    label: "Approve submission",
    description: "Marks the task passed and assigns the next template in sequence.",
    tone: "border-emerald-500/30 bg-emerald-500/[0.04]",
  },
  request_corrections: {
    label: "Request corrections",
    description: "Returns the task for revision, extends the deadline and logs the decision.",
    tone: "border-amber-500/30 bg-amber-500/[0.04]",
  },
  escalate: {
    label: "Escalate for further review",
    description: "Keeps the task in human review with your note attached.",
    tone: "border-rose-500/30 bg-rose-500/[0.04]",
  },
};

function criterionIcon(status: string) {
  if (status === "passed") return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (status === "failed") return <XCircle className="h-4 w-4 text-rose-500" />;
  return <HelpCircle className="h-4 w-4 text-amber-500" />;
}

export function EvaluationDetail({
  evaluation,
  internName,
  assignmentTitle,
  canDecide = true,
  onClose,
  onDecided,
}: {
  evaluation: Evaluation | null;
  internName?: string;
  assignmentTitle?: string;
  canDecide?: boolean;
  onClose: () => void;
  onDecided?: (evaluation: Evaluation) => void;
}) {
  const toast = useToast();
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<Decision | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNote("");
    setPending(null);
    setError(null);
  }, [evaluation?.id]);

  if (!evaluation) return null;

  const decidable =
    canDecide && ["human_review_required", "corrections_required"].includes(evaluation.status);
  const score = Math.max(0, Math.min(100, evaluation.score));

  async function submitDecision() {
    if (!pending || !evaluation) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await internflowApi.decide(evaluation.id, pending, note.trim());
      toast.success(
        pending === "approve"
          ? "Evaluation approved"
          : pending === "request_corrections"
            ? "Corrections requested"
            : "Escalated for review",
        "The decision is recorded in the audit trail.",
      );
      onDecided?.(updated);
      setPending(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The decision could not be recorded.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={Boolean(evaluation)}
      onClose={onClose}
      size="lg"
      title="Evaluation review"
      description="Deterministic rubric results, evidence and the reviewer decision."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Close
          </Button>
          {pending ? (
            <Button
              onClick={() => void submitDecision()}
              loading={busy}
              variant={pending === "approve" ? "primary" : pending === "escalate" ? "danger" : "secondary"}
            >
              Confirm {pending === "request_corrections" ? "corrections" : pending === "approve" ? "approval" : "escalation"}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={evaluation.status} />
              <Badge tone="neutral">rubric {evaluation.rubric_version}</Badge>
              <Badge tone={evaluation.evaluator.includes("llm") ? "violet" : "blue"}>{evaluation.evaluator.replace(/_/g, " ")}</Badge>
            </div>
            <p className="mt-2 text-sm font-semibold text-graphite-950 dark:text-white">
              {assignmentTitle ?? "Assigned task"}
              {internName ? <span className="font-normal text-mist-500"> · {internName}</span> : null}
            </p>
            <p className="mt-1 text-xs text-mist-500 dark:text-mist-400">
              Submitted and evaluated {formatDateTime(evaluation.created_at)} · confidence {Math.round(evaluation.confidence * 100)}%
            </p>
          </div>
          <div className="w-full max-w-[190px] rounded-xl border border-mist-200 p-3 text-right dark:border-white/10">
            <p className="eyebrow">Weighted score</p>
            <p className="heading-display mt-1 text-3xl text-graphite-950 dark:text-white">{formatScore(evaluation.score)}</p>
            <ProgressBar
              value={score}
              tone={evaluation.status === "passed" ? "green" : evaluation.status === "failed" ? "rose" : "amber"}
            />
          </div>
        </div>

        <p className="rounded-xl border border-mist-200 bg-mist-50/60 p-4 text-sm leading-6 text-graphite-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-mist-200">
          {evaluation.summary}
        </p>

        {evaluation.human_review_required && evaluation.human_review_reason ? (
          <Notice tone="warning" title="Human decision required">
            {evaluation.human_review_reason}
          </Notice>
        ) : null}

        {evaluation.human_review_required || evaluation.status === "corrections_required" ? (
          <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.05] p-4">
            <div className="flex items-start gap-2.5">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <p className="text-xs leading-5 text-amber-900 dark:text-amber-100">
                A failed mandatory criterion cannot be overridden by the score. Only an administrator can approve,
                request corrections or escalate this submission.
              </p>
            </div>
          </div>
        ) : null}

        {evaluation.criteria_results.length ? (
          <section>
            <SectionHeading title="Criterion results" description="Each check is recorded with the evidence that supported it." />
            <div className="space-y-2.5">
              {evaluation.criteria_results.map((criterion) => (
                <div
                  key={criterion.id}
                  className={cn(
                    "rounded-xl border p-3.5",
                    criterion.status === "passed"
                      ? "border-emerald-500/20 bg-emerald-500/[0.03]"
                      : criterion.status === "failed"
                        ? "border-rose-500/20 bg-rose-500/[0.03]"
                        : "border-amber-500/25 bg-amber-500/[0.03]",
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex min-w-0 items-start gap-2">
                      <span className="mt-0.5">{criterionIcon(criterion.status)}</span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-graphite-900 dark:text-mist-100">{criterion.label}</p>
                        <p className="mt-0.5 text-[10px] uppercase tracking-[0.1em] text-mist-400">
                          {criterion.criterion_key} · weight {criterion.weight}
                          {criterion.mandatory ? " · mandatory" : ""}
                        </p>
                      </div>
                    </div>
                    <StatusBadge status={criterion.status} />
                  </div>
                  {criterion.comment ? (
                    <p className="mt-2 text-xs leading-5 text-mist-600 dark:text-mist-300">{criterion.comment}</p>
                  ) : null}
                  {criterion.evidence ? (
                    <p className="mt-2 rounded-lg bg-white/70 px-3 py-2 font-mono text-[11px] leading-5 text-mist-600 dark:bg-white/[0.04] dark:text-mist-400">
                      {criterion.evidence}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        ) : (
          <Notice tone="info" title="No criterion results">
            This template has no machine-verifiable criteria, so a reviewer must evaluate the submission manually.
          </Notice>
        )}

        {evaluation.strengths.length || evaluation.errors.length || evaluation.missing_requirements.length || evaluation.corrective_actions.length ? (
          <section>
            <SectionHeading title="Findings" />
            <div className="grid gap-3 sm:grid-cols-2">
              {evaluation.strengths.length ? (
                <div className="app-panel p-3.5">
                  <p className="eyebrow text-emerald-600 dark:text-emerald-300">Strengths</p>
                  <ul className="mt-2 space-y-1 text-xs leading-5 text-graphite-700 dark:text-mist-300">
                    {evaluation.strengths.map((item, index) => (
                      <li key={index}>· {item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {evaluation.errors.length ? (
                <div className="app-panel p-3.5">
                  <p className="eyebrow text-rose-600 dark:text-rose-300">Issues</p>
                  <ul className="mt-2 space-y-1 text-xs leading-5 text-graphite-700 dark:text-mist-300">
                    {evaluation.errors.map((item, index) => (
                      <li key={index}>· {item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {evaluation.missing_requirements.length ? (
                <div className="app-panel p-3.5">
                  <p className="eyebrow text-amber-600 dark:text-amber-300">Missing requirements</p>
                  <ul className="mt-2 space-y-1 text-xs leading-5 text-graphite-700 dark:text-mist-300">
                    {evaluation.missing_requirements.map((item, index) => (
                      <li key={index}>· {item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {evaluation.corrective_actions.length ? (
                <div className="app-panel p-3.5">
                  <p className="eyebrow">Corrective actions</p>
                  <ul className="mt-2 space-y-1 text-xs leading-5 text-graphite-700 dark:text-mist-300">
                    {evaluation.corrective_actions.map((item, index) => (
                      <li key={index}>· {item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        <section className="rounded-xl border border-mist-200 p-4 dark:border-white/10">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ClipboardCheck className="h-4 w-4 text-electric-500" />
              <p className="text-sm font-semibold text-graphite-950 dark:text-white">Reviewer decision</p>
            </div>
            {evaluation.decision ? <Badge tone="blue">{evaluation.decision.replace(/_/g, " ")}</Badge> : <Badge tone="amber">Pending</Badge>}
          </div>
          {evaluation.decision ? (
            <div className="mt-3 space-y-1 text-xs leading-5 text-mist-600 dark:text-mist-300">
              <p>
                Recorded {formatDateTime(evaluation.decided_at)}
                {evaluation.decision_note ? ` · “${evaluation.decision_note}”` : ""}
              </p>
              {["passed", "corrections_required", "human_review_required"].includes(evaluation.status) && canDecide ? (
                <p className="text-mist-400">This evaluation is now {evaluation.status.replace(/_/g, " ")}.</p>
              ) : null}
            </div>
          ) : decidable ? (
            <div className="mt-3 space-y-3">
              {error ? <Notice tone="danger" title="Decision not recorded">{error}</Notice> : null}
              <Textarea
                rows={3}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={4000}
                placeholder="Add reviewer context. This note is stored on the evaluation and in the audit trail."
              />
              <div className="grid gap-2 sm:grid-cols-3">
                {(Object.keys(decisionCopy) as Decision[]).map((decision) => {
                  const copy = decisionCopy[decision];
                  return (
                    <button
                      key={decision}
                      type="button"
                      onClick={() => setPending(decision)}
                      className={cn(
                        "rounded-xl border p-3 text-left transition hover:border-electric-400/60",
                        copy.tone,
                        pending === decision && "ring-2 ring-electric-500/40",
                      )}
                    >
                      <p className="text-xs font-semibold text-graphite-900 dark:text-mist-100">{copy.label}</p>
                      <p className="mt-1 text-[10px] leading-4 text-mist-500 dark:text-mist-400">{copy.description}</p>
                    </button>
                  );
                })}
              </div>
              {pending ? (
                <p className="flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Review your choice, then use the confirmation button below to record it.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="mt-2 text-xs leading-5 text-mist-500 dark:text-mist-400">
              {evaluation.status === "passed"
                ? "This submission passed automatically. No further decision is needed."
                : evaluation.status === "failed"
                  ? "This submission was marked failed. Re-assign the task if the intern should try again."
                  : canDecide
                    ? "No decision is currently required."
                    : "Only an administrator can record a decision for this evaluation."}
            </p>
          )}
        </section>
      </div>
    </Modal>
  );
}
