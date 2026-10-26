import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileText,
  Mail,
  Pencil,
  Plus,
  RotateCcw,
  Send,
  ShieldAlert,
  Sparkles,
  Video,
} from "lucide-react";
import { useAuth } from "@/app/AuthContext";
import { useToast } from "@/app/ToastContext";
import { useApiQuery, useDocumentTitle } from "@/hooks/useApi";
import { ApiError, downloadFile, internflowApi } from "@/services/api";
import type {
  Assignment,
  Evaluation,
  InternDetail,
  Meeting,
  Submission,
} from "@/types/api";
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  Input,
  KeyValue,
  Notice,
  PageHeader,
  ProgressBar,
  Select,
  Skeleton,
  StatCard,
  StatusBadge,
  Textarea,
} from "@/components/ui/primitives";
import { ConfirmDialog, Modal, Tabs } from "@/components/ui/overlays";
import { EvaluationDetail } from "@/components/internflow/EvaluationDetail";
import { AssignTaskModal } from "@/components/internflow/AssignTaskModal";
import { MeetingEditor } from "@/components/internflow/MeetingEditor";
import { Markdown } from "@/components/common/Markdown";
import { INTERN_STATUSES, TIMEZONES } from "@/lib/constants";
import {
  formatBytes,
  formatDate,
  formatDateTime,
  formatScore,
  relativeTime,
  toLocalInput,
  fromLocalInput,
} from "@/lib/format";

const tabIds = ["overview", "assignments", "submissions", "evaluations", "meetings", "delivery"];

export function InternDetailPage() {
  const { internId = "" } = useParams();
  const { me, isAdmin } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const detail = useApiQuery<InternDetail>(() => internflowApi.intern(internId), [internId, me?.active_organization_id]);
  const [tab, setTab] = useState("overview");
  const [editOpen, setEditOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [resendOpen, setResendOpen] = useState(false);
  const [resending, setResending] = useState(false);
  const [selectedEvaluation, setSelectedEvaluation] = useState<Evaluation | null>(null);
  const [meetingTarget, setMeetingTarget] = useState<Meeting | null>(null);
  const [assignmentTarget, setAssignmentTarget] = useState<Assignment | null>(null);
  const [assignmentDue, setAssignmentDue] = useState("");
  const [assignmentStatus, setAssignmentStatus] = useState("");
  const [assignmentSaving, setAssignmentSaving] = useState(false);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);
  const [form, setForm] = useState({
    full_name: "",
    department: "",
    role_title: "",
    company_name: "",
    timezone: "Asia/Kolkata",
    status: "active",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const data = detail.data;
  useDocumentTitle(data?.intern.full_name ?? "Intern profile");

  useEffect(() => {
    if (!data) return;
    setForm({
      full_name: data.intern.full_name,
      department: data.intern.department,
      role_title: data.intern.role_title,
      company_name: data.intern.company_name,
      timezone: data.intern.timezone,
      status: data.intern.status,
      notes: data.intern.notes,
    });
  }, [data?.intern.id]);

  useEffect(() => {
    if (!assignmentTarget) return;
    setAssignmentDue(toLocalInput(assignmentTarget.due_at));
    setAssignmentStatus(assignmentTarget.status);
    setAssignmentError(null);
  }, [assignmentTarget]);

  const evaluationBySubmission = useMemo(() => {
    const map: Record<string, Evaluation> = {};
    for (const evaluation of data?.evaluations ?? []) map[evaluation.submission_id] = evaluation;
    return map;
  }, [data]);

  async function saveIntern() {
    if (!form.full_name.trim()) {
      setFormError("The intern's name cannot be empty.");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await internflowApi.updateIntern(internId, form);
      toast.success("Intern profile updated", "The linked user name was kept in sync.");
      setEditOpen(false);
      await detail.reload(true);
    } catch (caught) {
      setFormError(caught instanceof ApiError ? caught.message : "The profile could not be updated.");
    } finally {
      setSaving(false);
    }
  }

  async function resendInvite() {
    setResending(true);
    try {
      const response = await internflowApi.resendInvite(internId);
      toast.success("Invitation processed", response.message);
      setResendOpen(false);
      await detail.reload(true);
    } catch (caught) {
      toast.error("Could not resend invitation", caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setResending(false);
    }
  }

  async function saveAssignment() {
    if (!assignmentTarget) return;
    setAssignmentSaving(true);
    setAssignmentError(null);
    try {
      await internflowApi.updateAssignment(assignmentTarget.id, {
        due_at: assignmentDue ? fromLocalInput(assignmentDue) : undefined,
        status: assignmentStatus,
      });
      toast.success("Assignment updated");
      setAssignmentTarget(null);
      await detail.reload(true);
    } catch (caught) {
      setAssignmentError(caught instanceof ApiError ? caught.message : "The assignment could not be updated.");
    } finally {
      setAssignmentSaving(false);
    }
  }

  async function downloadSubmissionFile(submission: Submission, fileId: string, filename: string) {
    try {
      await downloadFile(`/internflow/submissions/${submission.id}/files/${fileId}`, filename);
    } catch (caught) {
      toast.error("Download failed", caught instanceof ApiError ? caught.message : undefined);
    }
  }

  async function downloadMeeting(meeting: Meeting) {
    try {
      await downloadFile(`/internflow/meetings/${meeting.id}/ics`, `nexora-meeting-${meeting.id.slice(0, 8)}.ics`);
    } catch {
      toast.error("Calendar file unavailable");
    }
  }

  if (detail.error && !data) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="InternFlow" title="Intern profile" description="This intern record could not be loaded." />
        <ErrorState message={detail.error} onRetry={() => void detail.reload()} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-28 rounded-2xl" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((key) => <Skeleton key={key} className="h-28 rounded-2xl" />)}
        </div>
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    );
  }

  const intern = data.intern;
  const current = data.assignments.find((assignment) => assignment.id === intern.current_assignment_id) ?? null;
  const nextMeeting = data.meetings.find((meeting) => ["proposed", "scheduled"].includes(meeting.status)) ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/internflow/interns" className="inline-flex items-center gap-1.5 text-xs font-semibold text-mist-500 transition hover:text-electric-600 dark:text-mist-400 dark:hover:text-electric-300">
          <ArrowLeft className="h-3.5 w-3.5" /> All interns
        </Link>
        <span className="text-mist-300">/</span>
        <span className="text-xs text-graphite-700 dark:text-mist-300">{intern.full_name}</span>
      </div>

      <section className="app-surface overflow-hidden">
        <div className="relative border-b border-mist-100 bg-gradient-to-br from-navy-950 via-navy-900 to-navy-950 p-6 dark:border-white/[0.07]">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              <Avatar name={intern.full_name} size="lg" className="ring-4 ring-white/10" />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="heading-display truncate text-2xl text-white">{intern.full_name}</h1>
                  <StatusBadge status={intern.status} />
                  {intern.overdue ? <Badge tone="rose">Overdue</Badge> : null}
                </div>
                <p className="mt-1 text-sm text-mist-400">
                  {intern.role_title || "Intern"} · {intern.department || "No department"} · {intern.company_name}
                </p>
                <p className="mt-0.5 text-xs text-mist-500">{intern.email}</p>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-mist-400">
                  <span>{intern.start_date ? `${formatDate(intern.start_date)} → ${formatDate(intern.end_date)}` : "Dates not set"}</span>
                  <span>{intern.duration_weeks ? `${intern.duration_weeks} weeks` : "Duration not set"}</span>
                  <span>{intern.timezone}</span>
                  <span>Onboarding email: {intern.onboarding_email_status ?? "not recorded"}</span>
                </div>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button variant="secondary" size="sm" icon={Pencil} onClick={() => setEditOpen(true)}>
                Edit
              </Button>
              <Button variant="secondary" size="sm" icon={Mail} onClick={() => setResendOpen(true)} disabled={!intern.user_id}>
                Resend invite
              </Button>
              <Button size="sm" icon={Plus} onClick={() => setAssignOpen(true)}>
                Assign task
              </Button>
            </div>
          </div>
        </div>

        <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Current task" value={current?.title ?? "None"} hint={current?.status ? current.status.replace(/_/g, " ") : "No active assignment"} icon={ClipboardCheck} />
          <StatCard
            label="Due"
            value={current?.due_at ? formatDate(current.due_at) : "—"}
            hint={current?.due_at ? relativeTime(current.due_at) : "No deadline set"}
            icon={ShieldAlert}
            tone={intern.overdue ? "rose" : "blue"}
          />
          <StatCard label="Approved tasks" value={`${intern.tasks_approved}/${intern.tasks_total}`} hint="Sequence progress" icon={CheckCircle2} tone="green" />
          <StatCard
            label="Next meeting"
            value={nextMeeting?.start_at ? formatDate(nextMeeting.start_at) : "None"}
            hint={nextMeeting?.title ?? "No proposed review"}
            icon={CalendarDays}
            tone="violet"
          />
        </div>
      </section>

      <Tabs
        items={[
          { id: "overview", label: "Overview" },
          { id: "assignments", label: "Assignments", count: data.assignments.length },
          { id: "submissions", label: "Submissions", count: data.submissions.length },
          { id: "evaluations", label: "Evaluations", count: data.evaluations.length },
          { id: "meetings", label: "Meetings", count: data.meetings.length },
          { id: "delivery", label: "Delivery log", count: data.emails.length },
        ]}
        value={tab}
        onChange={(value) => {
          if (tabIds.includes(value)) setTab(value);
        }}
      />

      {tab === "overview" ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <div className="space-y-6">
            <section className="app-surface p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-base font-semibold text-graphite-950 dark:text-white">Current assignment</h2>
                {current ? <StatusBadge status={current.status} /> : null}
              </div>
              {current ? (
                <div className="mt-3 space-y-4">
                  <div>
                    <p className="text-sm font-semibold text-graphite-900 dark:text-mist-100">{current.title}</p>
                    <p className="mt-1 text-xs leading-5 text-mist-500 dark:text-mist-400">
                      Sequence {current.sequence_order} · template v{current.template_version} · attempt {current.attempt_count}
                      {current.template ? ` of ${current.template.max_attempts}` : ""}
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="app-panel p-3">
                      <p className="eyebrow">Assigned</p>
                      <p className="mt-1 text-xs text-graphite-700 dark:text-mist-300">{formatDateTime(current.assigned_at)}</p>
                    </div>
                    <div className="app-panel p-3">
                      <p className="eyebrow">Due</p>
                      <p className="mt-1 text-xs text-graphite-700 dark:text-mist-300">{formatDateTime(current.due_at)}</p>
                    </div>
                    <div className="app-panel p-3">
                      <p className="eyebrow">Progress</p>
                      <div className="mt-1.5 flex items-center gap-2">
                        <span className="text-xs tabular-nums text-graphite-700 dark:text-mist-300">{intern.tasks_approved}/{intern.tasks_total}</span>
                        <ProgressBar value={intern.tasks_total ? (intern.tasks_approved / intern.tasks_total) * 100 : 0} tone="green" />
                      </div>
                    </div>
                  </div>
                  {current.template ? (
                    <div className="rounded-xl border border-mist-200 p-4 dark:border-white/10">
                      <p className="text-xs font-semibold uppercase tracking-[0.1em] text-mist-500 dark:text-mist-400">Rubric</p>
                      <div className="mt-2 space-y-1.5">
                        {current.template.acceptance_criteria.map((criterion) => (
                          <div key={criterion.key} className="flex items-start justify-between gap-2 text-xs">
                            <span className="text-graphite-700 dark:text-mist-300">
                              {criterion.label ?? criterion.key.replace(/_/g, " ")}
                              <span className="ml-1.5 text-[10px] uppercase tracking-[0.08em] text-mist-400">{criterion.type}</span>
                            </span>
                            <span className="shrink-0 text-[10px] font-semibold text-mist-500">
                              {criterion.mandatory ? "required" : "weighted"} · {criterion.weight ?? 1}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" size="sm" onClick={() => setAssignmentTarget(current)}>
                      Update due date or status
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setTab("submissions")}>
                      View submissions
                    </Button>
                  </div>
                </div>
              ) : (
                <EmptyState
                  icon={ClipboardCheck}
                  title="No active assignment"
                  description="Assign a template to start the next step in this intern's sequence."
                  action={<Button size="sm" icon={Plus} onClick={() => setAssignOpen(true)}>Assign task</Button>}
                  className="mt-4 py-8"
                />
              )}
            </section>

            <section className="app-surface p-5">
              <h2 className="font-display text-base font-semibold text-graphite-950 dark:text-white">Recent evaluations</h2>
              {data.evaluations.length ? (
                <div className="mt-3 space-y-2">
                  {data.evaluations.slice(0, 4).map((evaluation) => (
                    <button
                      key={evaluation.id}
                      type="button"
                      onClick={() => setSelectedEvaluation(evaluation)}
                      className="flex w-full items-start gap-3 rounded-xl border border-mist-200 p-3 text-left transition hover:border-electric-400/50 dark:border-white/10"
                    >
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-electric-500/10 text-electric-600 dark:text-electric-300">
                        <ClipboardCheck className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-semibold text-graphite-900 dark:text-mist-100">{evaluation.summary}</span>
                        <span className="mt-0.5 block text-[10px] text-mist-400">
                          {formatDateTime(evaluation.created_at)} · confidence {Math.round(evaluation.confidence * 100)}%
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <span className="text-sm font-semibold tabular-nums">{formatScore(evaluation.score)}</span>
                        <StatusBadge status={evaluation.status} />
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="mt-3 rounded-xl border border-dashed border-mist-200 px-4 py-6 text-center text-xs text-mist-400 dark:border-white/10">
                  No evaluations have been produced for this intern.
                </p>
              )}
            </section>
          </div>

          <div className="space-y-6">
            <section className="app-surface p-5">
              <h2 className="font-display text-base font-semibold text-graphite-950 dark:text-white">Profile</h2>
              <div className="mt-3 divide-y divide-mist-100 dark:divide-white/[0.06]">
                <KeyValue label="Role">{intern.role_title || "—"}</KeyValue>
                <KeyValue label="Department">{intern.department || "—"}</KeyValue>
                <KeyValue label="Company">{intern.company_name || "—"}</KeyValue>
                <KeyValue label="Timezone">{intern.timezone}</KeyValue>
                <KeyValue label="Start">{formatDate(intern.start_date)}</KeyValue>
                <KeyValue label="End">{formatDate(intern.end_date)}</KeyValue>
                <KeyValue label="Duration">{intern.duration_weeks ? `${intern.duration_weeks} weeks` : "—"}</KeyValue>
                <KeyValue label="Linked account">{intern.user_id ? "Yes" : "No account"}</KeyValue>
              </div>
              {intern.notes ? (
                <div className="mt-4 rounded-xl bg-mist-50 p-3 dark:bg-white/[0.03]">
                  <p className="eyebrow">Notes</p>
                  <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-graphite-700 dark:text-mist-300">{intern.notes}</p>
                </div>
              ) : null}
            </section>

            <section className="app-surface p-5">
              <h2 className="font-display text-base font-semibold text-graphite-950 dark:text-white">Upcoming review</h2>
              {nextMeeting ? (
                <div className="mt-3 space-y-3">
                  <p className="text-sm font-semibold text-graphite-900 dark:text-mist-100">{nextMeeting.title}</p>
                  <p className="text-xs text-mist-500 dark:text-mist-400">
                    {formatDateTime(nextMeeting.start_at)} · {nextMeeting.timezone}
                  </p>
                  <StatusBadge status={nextMeeting.status} />
                  <div className="flex flex-wrap gap-2">
                    {nextMeeting.meet_url ? (
                      <a
                        href={nextMeeting.meet_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-lg bg-electric-500/10 px-2.5 py-1.5 text-xs font-semibold text-electric-700 dark:text-electric-200"
                      >
                        <Video className="h-3.5 w-3.5" /> Join meeting
                      </a>
                    ) : null}
                    <Button size="sm" variant="secondary" icon={Download} onClick={() => void downloadMeeting(nextMeeting)}>
                      .ics
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setMeetingTarget(nextMeeting)}>
                      Edit
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-xs leading-5 text-mist-500 dark:text-mist-400">
                  No proposed or scheduled meeting. Corrections create a proposed review automatically.
                </p>
              )}
            </section>

            <section className="rounded-2xl border border-navy-800 bg-navy-950 p-5">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-electric-300" />
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white">Evidence, not guesses</p>
              </div>
              <p className="mt-2 text-[11px] leading-5 text-mist-400">
                Every evaluation is tied to a submission version and rubric version. Re-evaluation never rewrites history;
                a new submission creates a new evaluation record.
              </p>
            </section>
          </div>
        </div>
      ) : null}

      {tab === "assignments" ? (
        <section className="app-surface overflow-hidden">
          {data.assignments.length ? (
            <div className="divide-y divide-mist-100 dark:divide-white/[0.06]">
              {data.assignments.map((assignment) => (
                <div key={assignment.id} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-electric-500/10 text-[11px] font-bold text-electric-600 dark:text-electric-300">
                        {assignment.sequence_order}
                      </span>
                      <p className="text-sm font-semibold text-graphite-900 dark:text-mist-100">{assignment.title}</p>
                      <StatusBadge status={assignment.status} />
                    </div>
                    <p className="mt-1.5 text-xs text-mist-500 dark:text-mist-400">
                      Assigned {formatDateTime(assignment.assigned_at)} · due {formatDateTime(assignment.due_at)} · attempt{" "}
                      {assignment.attempt_count}
                      {assignment.template ? ` of ${assignment.template.max_attempts}` : ""}
                    </p>
                    {assignment.template ? (
                      <p className="mt-1 text-[11px] leading-5 text-mist-500 dark:text-mist-400">{assignment.template.description}</p>
                    ) : null}
                    {assignment.escalation_state ? (
                      <p className="mt-1 text-[11px] font-semibold text-amber-600 dark:text-amber-300">Escalation: {assignment.escalation_state}</p>
                    ) : null}
                  </div>
                  <Button variant="secondary" size="sm" icon={Pencil} onClick={() => setAssignmentTarget(assignment)}>
                    Update
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-6">
              <EmptyState icon={ClipboardCheck} title="No assignments" description="Assign a template to begin this intern's task sequence." action={<Button icon={Plus} onClick={() => setAssignOpen(true)}>Assign task</Button>} />
            </div>
          )}
        </section>
      ) : null}

      {tab === "submissions" ? (
        <div className="space-y-4">
          {data.submissions.length ? (
            data.submissions.map((submission) => {
              const evaluation = evaluationBySubmission[submission.id];
              return (
                <section key={submission.id} className="app-surface p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-electric-500" />
                        <p className="text-sm font-semibold text-graphite-900 dark:text-mist-100">Submission v{submission.version}</p>
                        <StatusBadge status={submission.status} />
                      </div>
                      <p className="mt-1 text-[11px] text-mist-400">Submitted {formatDateTime(submission.submitted_at)}</p>
                    </div>
                    {evaluation ? (
                      <Button size="sm" variant="secondary" icon={ClipboardCheck} onClick={() => setSelectedEvaluation(evaluation)}>
                        {formatScore(evaluation.score)} · {evaluation.status.replace(/_/g, " ")}
                      </Button>
                    ) : null}
                  </div>
                  {submission.text_content ? (
                    <div className="mt-3 max-h-[420px] overflow-y-auto rounded-xl border border-mist-200 bg-mist-50/40 p-4 dark:border-white/10 dark:bg-white/[0.02]">
                      <Markdown content={submission.text_content} />
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-mist-400">No written response; the submission contained files only.</p>
                  )}
                  {submission.files.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {submission.files.map((file) => (
                        <button
                          key={file.id}
                          type="button"
                          onClick={() => void downloadSubmissionFile(submission, file.id, file.filename)}
                          className="inline-flex items-center gap-2 rounded-lg border border-mist-200 px-2.5 py-1.5 text-xs text-graphite-700 transition hover:border-electric-400/60 dark:border-white/10 dark:text-mist-300"
                        >
                          <Download className="h-3.5 w-3.5" />
                          {file.filename}
                          <span className="text-[10px] text-mist-400">{formatBytes(file.size_bytes)}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </section>
              );
            })
          ) : (
            <EmptyState icon={FileText} title="No submissions" description="The intern has not submitted any work yet." />
          )}
        </div>
      ) : null}

      {tab === "evaluations" ? (
        <section className="app-surface overflow-hidden">
          {data.evaluations.length ? (
            <div className="divide-y divide-mist-100 dark:divide-white/[0.06]">
              {data.evaluations.map((evaluation) => (
                <button
                  key={evaluation.id}
                  type="button"
                  onClick={() => setSelectedEvaluation(evaluation)}
                  className="flex w-full flex-col gap-2 p-5 text-left transition hover:bg-mist-50/70 dark:hover:bg-white/[0.02] sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={evaluation.status} />
                      <Badge tone="neutral">rubric {evaluation.rubric_version}</Badge>
                      {evaluation.human_review_required ? <Badge tone="amber">human review</Badge> : null}
                    </div>
                    <p className="mt-1.5 text-sm text-graphite-800 dark:text-mist-200">{evaluation.summary}</p>
                    <p className="mt-0.5 text-[10px] text-mist-400">
                      {formatDateTime(evaluation.created_at)} · {evaluation.evaluator.replace(/_/g, " ")} · {evaluation.criteria_results.length} criteria
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="heading-display text-xl text-graphite-950 dark:text-white">{formatScore(evaluation.score)}</p>
                    <p className="text-[10px] text-mist-400">{evaluation.decision?.replace(/_/g, " ") ?? "no decision"}</p>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="p-6">
              <EmptyState icon={ClipboardCheck} title="No evaluations" description="Evaluations are generated automatically when the intern submits work." />
            </div>
          )}
        </section>
      ) : null}

      {tab === "meetings" ? (
        <section className="app-surface overflow-hidden">
          {data.meetings.length ? (
            <div className="divide-y divide-mist-100 dark:divide-white/[0.06]">
              {data.meetings.map((meeting) => (
                <div key={meeting.id} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-graphite-900 dark:text-mist-100">{meeting.title}</p>
                      <StatusBadge status={meeting.status} />
                    </div>
                    <p className="mt-1 text-xs text-mist-500 dark:text-mist-400">
                      {formatDateTime(meeting.start_at)} · {meeting.timezone} · {meeting.provider}
                    </p>
                    {meeting.meet_url ? (
                      <a href={meeting.meet_url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-electric-600 underline dark:text-electric-300">
                        <Video className="h-3 w-3" /> Real meeting link
                      </a>
                    ) : (
                      <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-300">No meeting URL (calendar provider not configured).</p>
                    )}
                    {meeting.notes ? <p className="mt-1 whitespace-pre-wrap text-[11px] leading-5 text-mist-500 dark:text-mist-400">{meeting.notes}</p> : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button size="sm" variant="secondary" icon={Download} onClick={() => void downloadMeeting(meeting)}>
                      .ics
                    </Button>
                    <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setMeetingTarget(meeting)}>
                      Edit
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-6">
              <EmptyState icon={CalendarDays} title="No meetings" description="Onboarding, corrections and reviews create meeting records with a calendar-file fallback." />
            </div>
          )}
        </section>
      ) : null}

      {tab === "delivery" ? (
        <section className="app-surface overflow-hidden">
          {data.emails.length ? (
            <div className="overflow-x-auto">
              <table className="table-base min-w-[720px]">
                <thead>
                  <tr>
                    <th>Recipient</th>
                    <th>Subject</th>
                    <th>Kind</th>
                    <th>Status</th>
                    <th>Provider</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {data.emails.map((email) => (
                    <tr key={email.id}>
                      <td className="text-xs">{email.to_email}</td>
                      <td className="max-w-[300px] truncate text-xs">{email.subject}</td>
                      <td className="text-xs capitalize">{email.kind.replace(/_/g, " ")}</td>
                      <td><StatusBadge status={email.status} /></td>
                      <td className="text-xs">{email.provider}</td>
                      <td className="text-xs text-mist-500">{formatDateTime(email.sent_at ?? email.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-6">
              <EmptyState icon={Mail} title="No emails recorded" description="Onboarding, reminders and decisions create delivery records. Without SMTP they are demo-logged, never sent." />
            </div>
          )}
        </section>
      ) : null}

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit intern profile"
        description="Updates the live InternFlow record and keeps the linked user name in sync."
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={() => void saveIntern()} loading={saving}>Save profile</Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError ? <Notice tone="danger" title="Could not save">{formError}</Notice> : null}
          <Field label="Full name" required htmlFor="intern-name">
            <Input id="intern-name" value={form.full_name} onChange={(event) => setForm((state) => ({ ...state, full_name: event.target.value }))} maxLength={200} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Role title" htmlFor="intern-role">
              <Input id="intern-role" value={form.role_title} onChange={(event) => setForm((state) => ({ ...state, role_title: event.target.value }))} maxLength={160} />
            </Field>
            <Field label="Department" htmlFor="intern-department">
              <Input id="intern-department" value={form.department} onChange={(event) => setForm((state) => ({ ...state, department: event.target.value }))} maxLength={120} />
            </Field>
            <Field label="Company" htmlFor="intern-company">
              <Input id="intern-company" value={form.company_name} onChange={(event) => setForm((state) => ({ ...state, company_name: event.target.value }))} maxLength={200} />
            </Field>
            <Field label="Timezone" htmlFor="intern-timezone">
              <Select id="intern-timezone" value={form.timezone} onChange={(event) => setForm((state) => ({ ...state, timezone: event.target.value }))}>
                {TIMEZONES.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
              </Select>
            </Field>
            <Field label="Status" htmlFor="intern-status">
              <Select id="intern-status" value={form.status} onChange={(event) => setForm((state) => ({ ...state, status: event.target.value }))}>
                {INTERN_STATUSES.map((value) => <option key={value} value={value}>{value.charAt(0).toUpperCase() + value.slice(1)}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Notes" hint="Internal context. Visible to administrators only." htmlFor="intern-notes">
            <Textarea id="intern-notes" rows={4} value={form.notes} onChange={(event) => setForm((state) => ({ ...state, notes: event.target.value }))} maxLength={4000} />
          </Field>
        </div>
      </Modal>

      <Modal
        open={Boolean(assignmentTarget)}
        onClose={() => setAssignmentTarget(null)}
        title="Update assignment"
        description={assignmentTarget ? assignmentTarget.title : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAssignmentTarget(null)} disabled={assignmentSaving}>Cancel</Button>
            <Button onClick={() => void saveAssignment()} loading={assignmentSaving}>Save assignment</Button>
          </>
        }
      >
        <div className="space-y-4">
          {assignmentError ? <Notice tone="danger" title="Could not update">{assignmentError}</Notice> : null}
          <Field label="Due date and time" hint="Stored in UTC. Updates do not automatically reschedule reminder jobs." htmlFor="assignment-due">
            <Input id="assignment-due" type="datetime-local" value={assignmentDue} onChange={(event) => setAssignmentDue(event.target.value)} />
          </Field>
          <Field label="Status" hint="Use approved only when the work has genuinely been accepted." htmlFor="assignment-status">
            <Select id="assignment-status" value={assignmentStatus} onChange={(event) => setAssignmentStatus(event.target.value)}>
              {["assigned", "corrections_required", "overdue", "submitted", "human_review_required", "approved", "completed", "cancelled"].map((value) => (
                <option key={value} value={value}>{value.replace(/_/g, " ")}</option>
              ))}
            </Select>
          </Field>
          <Notice tone="warning" title="Manual status changes bypass the workflow">
            Changing the status here does not send emails, advance the sequence or create an evaluation. Prefer the
            evaluation decision buttons when the submission has been reviewed.
          </Notice>
        </div>
      </Modal>

      <ConfirmDialog
        open={resendOpen}
        onClose={() => setResendOpen(false)}
        onConfirm={() => void resendInvite()}
        title="Resend invitation"
        description="A new single-use activation link will be generated. Without SMTP configured, the email is recorded as a demo delivery and no message leaves this machine."
        confirmLabel="Resend invitation"
        loading={resending}
      />

      <AssignTaskModal
        open={assignOpen}
        internId={intern.id}
        internName={intern.full_name}
        onClose={() => setAssignOpen(false)}
        onAssigned={() => void detail.reload(true)}
      />

      <EvaluationDetail
        evaluation={selectedEvaluation}
        internName={intern.full_name}
        assignmentTitle={
          selectedEvaluation
            ? data.assignments.find((assignment) => assignment.id === selectedEvaluation.assignment_id)?.title
            : undefined
        }
        canDecide={isAdmin}
        onClose={() => setSelectedEvaluation(null)}
        onDecided={(updated) => {
          setSelectedEvaluation(updated);
          void detail.reload(true);
        }}
      />

      <MeetingEditor
        meeting={meetingTarget}
        internName={intern.full_name}
        onClose={() => setMeetingTarget(null)}
        onUpdated={() => void detail.reload(true)}
      />

      <p className="flex items-center justify-center gap-2 text-[10px] text-mist-400">
        <RotateCcw className="h-3 w-3" />
        Records shown here are scoped to your active organization.
      </p>
    </div>
  );
}
