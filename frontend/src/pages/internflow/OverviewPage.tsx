import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileSpreadsheet,
  Gauge,
  GraduationCap,
  ShieldAlert,
  Upload,
  Users,
} from "lucide-react";
import { useAuth } from "@/app/AuthContext";
import { useApiQuery, useDocumentTitle } from "@/hooks/useApi";
import { downloadFile, internflowApi } from "@/services/api";
import type { Evaluation, InternFlowOverview } from "@/types/api";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Notice,
  PageHeader,
  ProgressBar,
  SectionHeading,
  Skeleton,
  StatCard,
  StatusBadge,
} from "@/components/ui/primitives";
import { EvaluationDetail } from "@/components/internflow/EvaluationDetail";
import { formatDate, formatDateTime, formatScore, relativeTime } from "@/lib/format";
import { useToast } from "@/app/ToastContext";

export function InternFlowOverviewPage() {
  useDocumentTitle("InternFlow overview");
  const { me } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Evaluation | null>(null);

  const overview = useApiQuery<InternFlowOverview>(() => internflowApi.overview(), [me?.active_organization_id]);

  const summary = overview.data?.summary;
  const names = useMemo(() => {
    const map: Record<string, string> = {};
    for (const row of summary?.interns ?? []) map[row.intern_id] = row.name;
    return map;
  }, [summary]);

  async function downloadMeeting(id: string, title: string) {
    try {
      await downloadFile(`/internflow/meetings/${id}/ics`, `${title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.ics`);
    } catch {
      toast.error("Calendar file unavailable", "The meeting could not be exported right now.");
    }
  }

  if (overview.error && !overview.data) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="InternFlow" title="Overview" description="The InternFlow workspace could not be loaded." />
        <ErrorState message={overview.error} onRetry={() => void overview.reload()} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="InternFlow"
        title="Programme control room"
        description="Live intern progress, task delivery, evaluation decisions and meeting follow-through for this organization."
        actions={
          <>
            <Button variant="secondary" icon={FileSpreadsheet} onClick={() => navigate("/internflow/templates")}>
              Templates
            </Button>
            <Button icon={Upload} onClick={() => navigate("/internflow/imports")}>
              Import interns
            </Button>
          </>
        }
      />

      {overview.loading && !overview.data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((key) => (
            <Skeleton key={key} className="h-32 rounded-2xl" />
          ))}
        </div>
      ) : summary ? (
        <>
          {summary.interns_total === 0 ? (
            <Notice
              tone="info"
              title="No interns in this organization yet"
              action={<Link to="/internflow/imports" className="text-xs font-semibold underline">Open import</Link>}
            >
              Import an Excel or CSV file to create intern accounts, the first assignment and a proposed kick-off meeting.
            </Notice>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard label="Interns" value={summary.interns_total} hint={`${summary.completed} completed`} icon={Users} />
            <StatCard label="Active" value={summary.active} hint="Currently in the programme" icon={GraduationCap} tone="green" />
            <StatCard label="Overdue" value={summary.overdue} hint="Past deadline and still open" icon={ShieldAlert} tone="rose" />
            <StatCard label="Pending review" value={summary.tasks_pending} hint="Open or awaiting a decision" icon={ClipboardCheck} tone="amber" />
            <StatCard label="Templates" value={overview.data?.templates ?? 0} hint="Active assignment templates" icon={FileSpreadsheet} tone="violet" />
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
            <section className="app-surface overflow-hidden">
              <div className="flex flex-wrap items-end justify-between gap-3 border-b border-mist-100 p-5 dark:border-white/[0.07]">
                <div>
                  <SectionHeading
                    title="Intern progress"
                    description={`${summary.tasks_approved} tasks approved · ${summary.tasks_pending} pending across the organization.`}
                  />
                </div>
                <Link to="/internflow/interns" className="flex items-center gap-1 text-xs font-semibold text-electric-600 dark:text-electric-300">
                  All interns <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
              {summary.interns.length ? (
                <div className="overflow-x-auto">
                  <table className="table-base min-w-[720px]">
                    <thead>
                      <tr>
                        <th>Intern</th>
                        <th>Current task</th>
                        <th>Status</th>
                        <th>Due</th>
                        <th>Approved</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.interns.slice(0, 12).map((row) => (
                        <tr key={row.intern_id}>
                          <td>
                            <Link to={`/internflow/interns/${row.intern_id}`} className="group block">
                              <span className="block text-sm font-semibold text-graphite-900 group-hover:text-electric-600 dark:text-mist-100 dark:group-hover:text-electric-300">
                                {row.name}
                              </span>
                              <span className="block text-[10px] text-mist-400">{row.email}</span>
                            </Link>
                          </td>
                          <td className="max-w-[220px]">
                            <span className="block truncate text-xs text-graphite-700 dark:text-mist-300">{row.current_task ?? "No active task"}</span>
                            {row.current_status ? <StatusBadge status={row.current_status} className="mt-1" /> : null}
                          </td>
                          <td><StatusBadge status={row.status} /></td>
                          <td>
                            <span className={row.overdue ? "text-xs font-semibold text-rose-500" : "text-xs text-mist-500 dark:text-mist-400"}>
                              {row.due_at ? formatDate(row.due_at) : "—"}
                            </span>
                            {row.overdue ? <span className="ml-1 text-[10px] font-semibold uppercase text-rose-500">late</span> : null}
                          </td>
                          <td>
                            <div className="flex items-center gap-2">
                              <span className="w-9 text-xs tabular-nums text-graphite-700 dark:text-mist-300">
                                {row.tasks_approved}/{row.tasks_total}
                              </span>
                              <ProgressBar
                                value={row.tasks_total ? (row.tasks_approved / row.tasks_total) * 100 : 0}
                                tone={row.overdue ? "rose" : "green"}
                              />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-5">
                  <EmptyState
                    icon={Users}
                    title="No interns to show"
                    description="Import a spreadsheet to create intern profiles, assignments and onboarding records."
                    action={<Button icon={Upload} onClick={() => navigate("/internflow/imports")}>Import interns</Button>}
                  />
                </div>
              )}
            </section>

            <div className="space-y-6">
              <section className="app-surface p-5">
                <SectionHeading
                  title="Recent evaluations"
                  description="Scores are produced by the deterministic rubric."
                  action={
                    <Link to="/internflow/evaluations" className="text-xs font-semibold text-electric-600 dark:text-electric-300">
                      All
                    </Link>
                  }
                />
                {overview.data?.recent_evaluations.length ? (
                  <div className="space-y-2">
                    {overview.data.recent_evaluations.map((evaluation) => (
                      <button
                        key={evaluation.id}
                        type="button"
                        onClick={() => setSelected(evaluation)}
                        className="flex w-full items-start gap-3 rounded-xl px-2.5 py-2.5 text-left transition hover:bg-mist-50 dark:hover:bg-white/[0.04]"
                      >
                        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-electric-500/10 text-electric-600 dark:text-electric-300">
                          <ClipboardCheck className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-xs font-semibold text-graphite-900 dark:text-mist-100">
                              {evaluation.summary}
                            </span>
                          </span>
                          <span className="mt-0.5 block text-[10px] text-mist-400">
                            {formatDateTime(evaluation.created_at)} · confidence {Math.round(evaluation.confidence * 100)}%
                          </span>
                        </span>
                        <span className="flex shrink-0 flex-col items-end gap-1">
                          <span className="text-sm font-semibold tabular-nums text-graphite-900 dark:text-white">{formatScore(evaluation.score)}</span>
                          <StatusBadge status={evaluation.status} />
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-xl border border-dashed border-mist-200 px-4 py-6 text-center text-xs text-mist-400 dark:border-white/10">
                    No evaluations yet. Assign a template to an intern to generate the first result.
                  </p>
                )}
              </section>

              <section className="app-surface p-5">
                <SectionHeading
                  title="Upcoming meetings"
                  description="Proposed or scheduled review conversations."
                  action={
                    <Link to="/internflow/meetings" className="text-xs font-semibold text-electric-600 dark:text-electric-300">
                      Manage
                    </Link>
                  }
                />
                {overview.data?.upcoming_meetings.length ? (
                  <div className="space-y-2">
                    {overview.data.upcoming_meetings.map((meeting) => (
                      <div key={meeting.id} className="flex items-start gap-2.5 rounded-xl px-2 py-2">
                        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-600 dark:text-cyan-300">
                          <CalendarDays className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold text-graphite-900 dark:text-mist-100">{meeting.title}</p>
                          <p className="mt-0.5 text-[10px] text-mist-400">
                            {names[meeting.intern_id] ?? "Intern"} · {meeting.start_at ? relativeTime(meeting.start_at) : "No date proposed"}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <StatusBadge status={meeting.status} />
                            {meeting.meet_url ? (
                              <a href={meeting.meet_url} target="_blank" rel="noreferrer" className="text-[10px] font-semibold text-electric-600 underline dark:text-electric-300">
                                Join
                              </a>
                            ) : (
                              <span className="text-[10px] text-mist-400">No Meet link</span>
                            )}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={Download}
                          onClick={() => void downloadMeeting(meeting.id, meeting.title)}
                        >
                          .ics
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-xl border border-dashed border-mist-200 px-4 py-6 text-center text-xs text-mist-400 dark:border-white/10">
                    No proposed or scheduled meetings. Corrections and onboarding create review slots when a task is assigned.
                  </p>
                )}
              </section>

              <section className="rounded-2xl border border-navy-800 bg-navy-950 p-5">
                <div className="flex items-center gap-2">
                  <Gauge className="h-4 w-4 text-electric-300" />
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white">How decisions work</p>
                </div>
                <p className="mt-2 text-[11px] leading-5 text-mist-400">
                  Code checks only what can be verified. Mandatory failures cannot be overridden by a score. Manual or
                  unverified criteria force a human decision, and the reviewer note is kept in the audit trail.
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Badge tone="green" dot>Deterministic rubric</Badge>
                  <Badge tone="amber" dot>Human review gates</Badge>
                  <Badge tone="blue" dot>Audited</Badge>
                </div>
              </section>
            </div>
          </div>
        </>
      ) : null}

      <EvaluationDetail
        evaluation={selected}
        onClose={() => setSelected(null)}
        onDecided={(updated) => {
          setSelected(updated);
          void overview.reload(true);
        }}
      />

      <p className="flex items-center justify-center gap-2 text-[10px] text-mist-400">
        <CheckCircle2 className="h-3 w-3 text-emerald-500" />
        {summary ? `${summary.interns_total} interns · ${summary.tasks_approved} approved tasks · scoped to ${me?.active_organization_id ? "your active organization" : "no organization"}` : "Loading live records"}
      </p>
    </div>
  );
}
