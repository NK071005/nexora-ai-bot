import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Filter,
  Gauge,
  GraduationCap,
  ShieldAlert,
  Siren,
  XCircle,
} from "lucide-react";
import { useAuth } from "@/app/AuthContext";
import { useApiQuery, useDocumentTitle } from "@/hooks/useApi";
import { internflowApi } from "@/services/api";
import type { Evaluation, Intern, InternList } from "@/types/api";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  ProgressBar,
  Select,
  Skeleton,
  StatCard,
  StatusBadge,
} from "@/components/ui/primitives";
import { Pagination } from "@/components/ui/overlays";
import { EvaluationDetail } from "@/components/internflow/EvaluationDetail";
import { EVALUATION_STATUSES } from "@/lib/constants";
import { formatDateTime, formatScore } from "@/lib/format";

const PAGE_SIZE = 20;

export function EvaluationsPage() {
  useDocumentTitle("Evaluations");
  const { me, isAdmin } = useAuth();
  const [status, setStatus] = useState("");
  const [internId, setInternId] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Evaluation | null>(null);

  useEffect(() => {
    setPage(1);
  }, [status, internId]);

  const evaluations = useApiQuery(
    () =>
      internflowApi.evaluations({
        status: status || undefined,
        intern_id: internId || undefined,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      }),
    [status, internId, page, me?.active_organization_id],
  );

  const interns = useApiQuery<InternList>(
    () => internflowApi.interns({ limit: 200 }),
    [me?.active_organization_id],
  );

  const reviewQueue = useApiQuery(
    () => internflowApi.evaluations({ status: "human_review_required", limit: 1 }),
    [me?.active_organization_id],
  );

  const correctionsQueue = useApiQuery(
    () => internflowApi.evaluations({ status: "corrections_required", limit: 1 }),
    [me?.active_organization_id],
  );

  const names = useMemo(() => {
    const map: Record<string, string> = {};
    for (const intern of (interns.data?.items ?? []) as Intern[]) map[intern.id] = intern.full_name;
    return map;
  }, [interns.data]);

  const items = evaluations.data?.items ?? [];
  const pagePending = items.filter((evaluation) =>
    ["human_review_required", "corrections_required"].includes(evaluation.status),
  ).length;
  const pageAverage = items.length
    ? items.reduce((sum, evaluation) => sum + evaluation.score, 0) / items.length
    : 0;
  const filtersActive = Boolean(status || internId);

  function reloadAll() {
    void evaluations.reload(true);
    void reviewQueue.reload(true);
    void correctionsQueue.reload(true);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="InternFlow"
        title="Evaluation review"
        description="Deterministic rubric results with evidence, reviewer decisions and a full audit trail for this organization."
        actions={
          <>
            <Link
              to="/internflow/interns"
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-mist-200 px-4 text-sm font-semibold text-graphite-800 transition hover:bg-mist-50 dark:border-white/10 dark:text-mist-100 dark:hover:bg-white/[0.06]"
            >
              <GraduationCap className="h-4 w-4" /> Interns
            </Link>
            <Link
              to="/internflow/templates"
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-mist-200 px-4 text-sm font-semibold text-graphite-800 transition hover:bg-mist-50 dark:border-white/10 dark:text-mist-100 dark:hover:bg-white/[0.06]"
            >
              <ClipboardCheck className="h-4 w-4" /> Templates
            </Link>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Matching evaluations"
          value={evaluations.data?.total ?? 0}
          hint={filtersActive ? "With the active filters" : "All evaluations in this organization"}
          icon={ClipboardCheck}
        />
        <StatCard
          label="Human review"
          value={reviewQueue.data?.total ?? 0}
          hint="Waiting for an administrator decision"
          icon={Siren}
          tone="amber"
        />
        <StatCard
          label="Corrections"
          value={correctionsQueue.data?.total ?? 0}
          hint="Returned to the intern for revision"
          icon={XCircle}
          tone="rose"
        />
        <StatCard
          label="Average on page"
          value={items.length ? formatScore(pageAverage) : "—"}
          hint={`${items.length} of ${evaluations.data?.total ?? 0} shown`}
          icon={Gauge}
          tone="violet"
        />
      </div>

      <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/[0.05] p-4">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <p className="text-xs leading-5 text-amber-900 dark:text-amber-100">
          A failed mandatory criterion cannot be overridden by a high score. Unverified or manual criteria move the
          evaluation to human review. Decisions are only enabled for evaluations that actually require one.
        </p>
      </div>

      <section className="app-surface overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-mist-100 p-4 dark:border-white/[0.07] lg:flex-row lg:items-center lg:justify-between">
          <div className="grid gap-2 sm:flex sm:items-center">
            <Select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              aria-label="Filter evaluations by status"
              className="min-w-[180px]"
            >
              <option value="">All statuses</option>
              {EVALUATION_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {value.replace(/_/g, " ")}
                </option>
              ))}
            </Select>
            <Select
              value={internId}
              onChange={(event) => setInternId(event.target.value)}
              aria-label="Filter evaluations by intern"
              className="min-w-[210px]"
            >
              <option value="">All interns</option>
              {(interns.data?.items ?? []).map((intern: Intern) => (
                <option key={intern.id} value={intern.id}>
                  {intern.full_name}
                </option>
              ))}
            </Select>
            {filtersActive ? (
              <Button
                variant="ghost"
                size="sm"
                icon={Filter}
                onClick={() => {
                  setStatus("");
                  setInternId("");
                }}
              >
                Clear filters
              </Button>
            ) : null}
          </div>
          <p className="text-[11px] text-mist-400">
            {pagePending} on this page need an administrator decision.
          </p>
        </div>

        {evaluations.error && !evaluations.data ? (
          <div className="p-5">
            <ErrorState message={evaluations.error} onRetry={() => void evaluations.reload()} />
          </div>
        ) : evaluations.loading && !evaluations.data ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3].map((key) => <Skeleton key={key} className="h-24 rounded-xl" />)}
          </div>
        ) : items.length ? (
          <div className="divide-y divide-mist-100 dark:divide-white/[0.06]">
            {items.map((evaluation) => (
              <button
                key={evaluation.id}
                type="button"
                onClick={() => setSelected(evaluation)}
                className="block w-full p-5 text-left transition hover:bg-mist-50/70 dark:hover:bg-white/[0.02]"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={evaluation.status} />
                      <Badge tone="neutral">rubric {evaluation.rubric_version}</Badge>
                      <Badge tone={evaluation.evaluator.includes("llm") ? "violet" : "blue"}>
                        {evaluation.evaluator.replace(/_/g, " ")}
                      </Badge>
                      {evaluation.human_review_required ? <Badge tone="amber">human review gate</Badge> : null}
                    </div>
                    <p className="mt-2 text-sm leading-6 text-graphite-900 dark:text-mist-100">{evaluation.summary}</p>
                    <p className="mt-1 text-[10px] text-mist-400">
                      {internId ? `${names[internId] ?? "Intern"} · ` : ""}
                      Assignment {evaluation.assignment_id.slice(0, 8)} · submission {evaluation.submission_id.slice(0, 8)} ·{" "}
                      {formatDateTime(evaluation.created_at)}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <span className="text-[10px] uppercase tracking-[0.08em] text-mist-400">
                        {evaluation.criteria_results.length} criteria
                      </span>
                      <span className="text-[10px] uppercase tracking-[0.08em] text-mist-400">
                        confidence {Math.round(evaluation.confidence * 100)}%
                      </span>
                      <span className="text-[10px] uppercase tracking-[0.08em] text-mist-400">
                        {evaluation.decision ? `decision: ${evaluation.decision.replace(/_/g, " ")}` : "no decision recorded"}
                      </span>
                    </div>
                  </div>
                  <div className="w-full shrink-0 sm:w-[170px] sm:text-right">
                    <p className="heading-display text-2xl text-graphite-950 dark:text-white">{formatScore(evaluation.score)}</p>
                    <div className="mt-1.5">
                      <ProgressBar
                        value={evaluation.score}
                        tone={evaluation.status === "passed" ? "green" : evaluation.status === "failed" ? "rose" : "amber"}
                      />
                    </div>
                    <p className="mt-1 text-[10px] text-mist-400">
                      {["human_review_required", "corrections_required"].includes(evaluation.status)
                        ? "Decision required"
                        : "Review result"}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="p-6">
            <EmptyState
              icon={filtersActive ? AlertTriangle : ClipboardCheck}
              title={filtersActive ? "No evaluations match these filters" : "No evaluations yet"}
              description={
                filtersActive
                  ? "Try a different status or intern, or clear the filters to view the full history."
                  : "Evaluations are created automatically when an intern submits an assigned task. Assign a template to begin."
              }
              action={
                filtersActive ? (
                  <Button variant="secondary" onClick={() => { setStatus(""); setInternId(""); }}>
                    Clear filters
                  </Button>
                ) : (
                  <Link to="/internflow/templates" className="text-xs font-semibold text-electric-600 underline dark:text-electric-300">
                    Review task templates
                  </Link>
                )
              }
            />
          </div>
        )}

        {evaluations.data ? (
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={evaluations.data.total}
            onChange={setPage}
          />
        ) : null}
      </section>

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          {
            icon: CheckCircle2,
            title: "Deterministic",
            text: "Keyword, section, count, table and file checks run in code against the submitted version.",
          },
          {
            icon: ShieldAlert,
            title: "Mandatory gates",
            text: "A mandatory failure forces corrections or human review — never an automatic pass.",
          },
          {
            icon: Gauge,
            title: "Traceable",
            text: "Every criterion stores the evidence that produced its result and the reviewer's decision note.",
          },
        ].map((item) => (
          <div key={item.title} className="app-surface p-4">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-electric-500/10 text-electric-600 dark:text-electric-300">
              <item.icon className="h-4 w-4" />
            </span>
            <p className="mt-3 text-sm font-semibold text-graphite-900 dark:text-mist-100">{item.title}</p>
            <p className="mt-1 text-[11px] leading-5 text-mist-500 dark:text-mist-400">{item.text}</p>
          </div>
        ))}
      </div>

      <EvaluationDetail
        evaluation={selected}
        internName={internId ? names[internId] : undefined}
        assignmentTitle={selected ? `Assignment ${selected.assignment_id.slice(0, 8)}` : undefined}
        canDecide={isAdmin}
        onClose={() => setSelected(null)}
        onDecided={(updated) => {
          setSelected(updated);
          reloadAll();
        }}
      />

      <p className="text-center text-[10px] text-mist-400">
        {evaluations.data?.total ?? 0} evaluations · {reviewQueue.data?.total ?? 0} waiting for human review · scoped to your active organization
      </p>
    </div>
  );
}
