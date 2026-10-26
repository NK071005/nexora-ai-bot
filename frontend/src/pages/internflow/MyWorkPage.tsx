import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BookOpenCheck,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileText,
  Flag,
  MessageSquare,
  Paperclip,
  Send,
  ShieldAlert,
  Sparkles,
  Target,
  Trash2,
  Upload,
  Video,
} from "lucide-react";
import { useAuth } from "@/app/AuthContext";
import { useToast } from "@/app/ToastContext";
import { useApiQuery, useDocumentTitle } from "@/hooks/useApi";
import { ApiError, downloadFile, internflowApi } from "@/services/api";
import type { Evaluation, InternSelf, Meeting, Submission } from "@/types/api";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  Notice,
  PageHeader,
  ProgressBar,
  SectionHeading,
  Skeleton,
  StatCard,
  StatusBadge,
  Textarea,
} from "@/components/ui/primitives";
import { Tabs } from "@/components/ui/overlays";
import { EvaluationDetail } from "@/components/internflow/EvaluationDetail";
import { Markdown } from "@/components/common/Markdown";
import { FILE_ACCEPT } from "@/lib/constants";
import { formatBytes, formatDate, formatDateTime, formatScore, relativeTime } from "@/lib/format";
import { cn } from "@/lib/cn";

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  intent?: string;
}

const SUBMITTABLE = new Set(["assigned", "corrections_required", "overdue"]);

const ASSISTANT_PROMPTS = [
  "What is my current task and when is it due?",
  "What do I need to fix from my last evaluation?",
  "When is my next meeting?",
];

export function MyWorkPage() {
  useDocumentTitle("My work");
  const { me } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState("current");
  const [selectedEvaluation, setSelectedEvaluation] = useState<Evaluation | null>(null);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [assistantTurns, setAssistantTurns] = useState<ChatTurn[]>([]);
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantError, setAssistantError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const chatEnd = useRef<HTMLDivElement>(null);

  const query = useApiQuery<InternSelf>(() => internflowApi.me(), [me?.active_organization_id]);
  const data = query.data;

  const evaluationBySubmission = useMemo(() => {
    const map: Record<string, Evaluation> = {};
    for (const evaluation of data?.evaluations ?? []) map[evaluation.submission_id] = evaluation;
    return map;
  }, [data]);

  const assignmentTitles = useMemo(() => {
    const map: Record<string, string> = {};
    for (const assignment of data?.assignments ?? []) map[assignment.id] = assignment.title;
    return map;
  }, [data]);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [assistantTurns, assistantBusy]);

  const current = data?.current_assignment ?? null;
  const template = current?.template ?? null;
  const canSubmit = Boolean(current && SUBMITTABLE.has(current.status));
  const attemptsLeft = template ? Math.max(0, template.max_attempts - (current?.attempt_count ?? 0)) : null;

  function addFiles(list: FileList | null) {
    if (!list) return;
    const incoming = Array.from(list);
    setSubmitError(null);
    setFiles((existing) => {
      const merged = [...existing];
      for (const file of incoming) {
        if (merged.length >= 8) break;
        if (!merged.some((item) => item.name === file.name && item.size === file.size)) merged.push(file);
      }
      return merged;
    });
    if (fileInput.current) fileInput.current.value = "";
  }

  async function submit() {
    if (!current) return;
    if (!text.trim() && !files.length) {
      setSubmitError("Write a response or attach at least one file before submitting.");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const form = new FormData();
      form.append("text", text);
      for (const file of files) form.append("files", file);
      const result = await internflowApi.submit(current.id, form);
      toast.success(
        `Submission v${result.submission.version} evaluated`,
        `${result.message} A new evaluation record was created.`,
      );
      setText("");
      setFiles([]);
      await query.reload(true);
      setSelectedEvaluation(result.evaluation);
    } catch (caught) {
      setSubmitError(caught instanceof ApiError ? caught.message : "The submission could not be processed.");
    } finally {
      setSubmitting(false);
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
      await downloadFile(
        `/internflow/meetings/${meeting.id}/ics`,
        `nexora-meeting-${meeting.id.slice(0, 8)}.ics`,
      );
    } catch (caught) {
      toast.error("Calendar file unavailable", caught instanceof ApiError ? caught.message : undefined);
    }
  }

  async function ask(message?: string) {
    const prompt = (message ?? assistantInput).trim();
    if (!prompt || assistantBusy) return;
    setAssistantError(null);
    setAssistantInput("");
    setAssistantTurns((turns) => [...turns, { role: "user", content: prompt }]);
    setAssistantBusy(true);
    try {
      const reply = await internflowApi.chat(prompt);
      setAssistantTurns((turns) => [
        ...turns,
        { role: "assistant", content: reply.reply, intent: reply.intent },
      ]);
    } catch (caught) {
      const messageText = caught instanceof ApiError ? caught.message : "The assistant could not answer right now.";
      setAssistantError(messageText);
      setAssistantTurns((turns) => [
        ...turns,
        {
          role: "assistant",
          content: `I could not answer that: ${messageText}`,
        },
      ]);
    } finally {
      setAssistantBusy(false);
    }
  }

  if (query.error && !data) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="InternFlow"
          title="My work"
          description="Your assignments, feedback and meetings."
        />
        <ErrorState message={query.error} onRetry={() => void query.reload()} />
        <Notice tone="info" title="Only linked intern accounts can open this page">
          Ask your programme administrator to link your NEXORA account to your intern profile, or open the
          activation link from your invitation email.
        </Notice>
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
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    );
  }

  const intern = data.intern;
  const nextMeeting = data.next_meeting;
  const progress = intern.tasks_total ? (intern.tasks_approved / intern.tasks_total) * 100 : 0;

  return (
    <div className="space-y-6">
      <section className="app-surface overflow-hidden">
        <div className="relative border-b border-mist-100 bg-gradient-to-br from-navy-950 via-navy-900 to-navy-950 p-6 dark:border-white/[0.07]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-electric-300">
                InternFlow · my workspace
              </p>
              <h1 className="heading-display mt-1.5 text-2xl text-white">Welcome back, {intern.full_name.split(" ")[0]}</h1>
              <p className="mt-1 text-sm text-mist-400">
                {intern.role_title || "Intern"} · {intern.department || "No department"} · {intern.company_name}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-mist-400">
                <span>{intern.email}</span>
                {intern.start_date ? (
                  <span>
                    {formatDate(intern.start_date)} → {formatDate(intern.end_date)}
                  </span>
                ) : null}
                <span>{intern.timezone}</span>
                <StatusBadge status={intern.status} />
              </div>
            </div>
            <div className="shrink-0">
              <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-mist-400">Programme progress</p>
                <p className="heading-display mt-1 text-xl text-white">
                  {intern.tasks_approved}
                  <span className="text-sm font-normal text-mist-400"> / {intern.tasks_total} approved</span>
                </p>
                <div className="mt-2 w-48">
                  <ProgressBar value={progress} tone="green" />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Current task"
            value={intern.current_task ?? "None"}
            hint={intern.current_status ? intern.current_status.replace(/_/g, " ") : "No open assignment"}
            icon={ClipboardCheck}
          />
          <StatCard
            label="Due"
            value={intern.due_at ? formatDate(intern.due_at) : "—"}
            hint={intern.due_at ? relativeTime(intern.due_at) : "No deadline"}
            icon={ShieldAlert}
            tone={intern.overdue ? "rose" : "blue"}
          />
          <StatCard
            label="Approved"
            value={`${intern.tasks_approved}/${intern.tasks_total}`}
            hint="Tasks accepted by the reviewer"
            icon={CheckCircle2}
            tone="green"
          />
          <StatCard
            label="Next meeting"
            value={nextMeeting?.start_at ? formatDate(nextMeeting.start_at) : "None"}
            hint={nextMeeting?.title ?? "No proposed review"}
            icon={CalendarDays}
            tone="violet"
          />
        </div>
      </section>

      {intern.overdue ? (
        <Notice tone="warning" title="This task is past its due date">
          You can still submit while the assignment is open. Tell your programme administrator if you need a new
          deadline.
        </Notice>
      ) : null}

      <Tabs
        items={[
          { id: "current", label: "Current task" },
          { id: "history", label: "My submissions", count: data.submissions.length },
          { id: "feedback", label: "Feedback", count: data.evaluations.length },
          { id: "meetings", label: "Meetings", count: data.meetings.length },
          { id: "assistant", label: "Assistant", icon: Sparkles },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "current" ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
          <div className="space-y-6">
            <section className="app-surface p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <SectionHeading
                    title={current?.title ?? "No active assignment"}
                    description={
                      current
                        ? `Sequence ${current.sequence_order} · template v${current.template_version} · attempt ${current.attempt_count}${template ? ` of ${template.max_attempts}` : ""}`
                        : "A new task appears here when your programme administrator assigns it."
                    }
                  />
                </div>
                {current ? <StatusBadge status={current.status} /> : null}
              </div>

              {current ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="app-panel p-3">
                      <p className="eyebrow">Assigned</p>
                      <p className="mt-1 text-xs text-graphite-700 dark:text-mist-300">{formatDateTime(current.assigned_at)}</p>
                    </div>
                    <div className="app-panel p-3">
                      <p className="eyebrow">Due</p>
                      <p className={cn("mt-1 text-xs", intern.overdue ? "font-semibold text-rose-500" : "text-graphite-700 dark:text-mist-300")}>
                        {formatDateTime(current.due_at)}
                      </p>
                    </div>
                    <div className="app-panel p-3">
                      <p className="eyebrow">Attempts left</p>
                      <p className="mt-1 text-xs text-graphite-700 dark:text-mist-300">
                        {attemptsLeft === null ? "Not limited" : attemptsLeft}
                      </p>
                    </div>
                  </div>

                  {template ? (
                    <div className="mt-5 space-y-4">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-mist-500 dark:text-mist-400">Brief</p>
                        <p className="mt-1 text-sm leading-6 text-graphite-700 dark:text-mist-300">{template.description}</p>
                      </div>
                      {template.objectives.length ? (
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-mist-500 dark:text-mist-400">Objectives</p>
                          <ul className="mt-1 space-y-1 text-sm leading-6 text-graphite-700 dark:text-mist-300">
                            {template.objectives.map((objective, index) => (
                              <li key={index} className="flex gap-2">
                                <Target className="mt-1 h-3.5 w-3.5 shrink-0 text-electric-500" />
                                {objective}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {template.expected_methodology ? (
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-mist-500 dark:text-mist-400">Methodology</p>
                          <p className="mt-1 text-sm leading-6 text-graphite-700 dark:text-mist-300">{template.expected_methodology}</p>
                        </div>
                      ) : null}
                      {template.deliverables.length ? (
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-mist-500 dark:text-mist-400">Deliverables</p>
                          <ul className="mt-1 space-y-1 text-sm leading-6 text-graphite-700 dark:text-mist-300">
                            {template.deliverables.map((deliverable, index) => (
                              <li key={index} className="flex gap-2">
                                <CheckCircle2 className="mt-1 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                                {deliverable}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      <div className="flex flex-wrap gap-1.5">
                        {template.submission_formats.map((format) => (
                          <Badge key={format} tone="neutral">{format}</Badge>
                        ))}
                        {template.permitted_tools.map((tool) => (
                          <Badge key={tool} tone="blue">{tool}</Badge>
                        ))}
                      </div>
                      <div className="rounded-xl border border-mist-200 p-4 dark:border-white/10">
                        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-mist-500 dark:text-mist-400">
                          How your work is checked
                        </p>
                        <div className="mt-2 space-y-1.5">
                          {template.acceptance_criteria.map((criterion) => (
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
                        <p className="mt-2 text-[10px] leading-4 text-mist-400">
                          Automated checks are deterministic. Manual criteria always go to a human reviewer.
                        </p>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <EmptyState
                  icon={ClipboardCheck}
                  title="Nothing to submit right now"
                  description="You have completed every task currently assigned. Your next task appears automatically when the programme advances the sequence."
                  className="mt-4 py-8"
                />
              )}
            </section>

            {current ? (
              <section className="app-surface p-5">
                <SectionHeading
                  title="Submit your work"
                  description="Text and attachments are evaluated together. You can submit multiple times until the attempt limit is reached."
                />

                {!canSubmit ? (
                  <Notice tone="info" title={`Submissions are closed while this task is ${current.status.replace(/_/g, " ")}`}>
                    If you need to revise this task, your reviewer must request corrections or reassign it.
                  </Notice>
                ) : (
                  <div className="space-y-4">
                    {submitError ? <Notice tone="danger" title="Submission not accepted">{submitError}</Notice> : null}
                    {intern.overdue ? (
                      <p className="text-[11px] font-medium text-amber-600 dark:text-amber-300">
                        This task is overdue. Submitting now still records a late submission against the current attempt.
                      </p>
                    ) : null}
                    <Field
                      label="Your response"
                      hint="Markdown is rendered as formatted text. Include required sections, data tables and references where the brief asks for them."
                      htmlFor="submission-text"
                    >
                      <Textarea
                        id="submission-text"
                        rows={10}
                        value={text}
                        onChange={(event) => {
                          setText(event.target.value);
                          setSubmitError(null);
                        }}
                        maxLength={40000}
                        placeholder="Write your submission here…"
                      />
                    </Field>

                    <div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-graphite-800 dark:text-mist-200">
                          Attachments <span className="font-normal text-mist-400">({files.length}/8)</span>
                        </p>
                        <Button
                          variant="secondary"
                          size="sm"
                          icon={Paperclip}
                          onClick={() => fileInput.current?.click()}
                          disabled={files.length >= 8}
                        >
                          Attach files
                        </Button>
                      </div>
                      <input
                        ref={fileInput}
                        type="file"
                        multiple
                        accept={FILE_ACCEPT}
                        className="hidden"
                        onChange={(event) => addFiles(event.target.files)}
                      />
                      {files.length ? (
                        <ul className="mt-2 space-y-1.5">
                          {files.map((file, index) => (
                            <li
                              key={`${file.name}-${file.size}-${index}`}
                              className="flex items-center justify-between gap-3 rounded-lg border border-mist-200 px-3 py-2 dark:border-white/10"
                            >
                              <span className="flex min-w-0 items-center gap-2">
                                <FileText className="h-3.5 w-3.5 shrink-0 text-electric-500" />
                                <span className="truncate text-xs text-graphite-700 dark:text-mist-300">{file.name}</span>
                                <span className="shrink-0 text-[10px] text-mist-400">{formatBytes(file.size)}</span>
                              </span>
                              <button
                                type="button"
                                aria-label={`Remove ${file.name}`}
                                onClick={() => setFiles((existing) => existing.filter((_, itemIndex) => itemIndex !== index))}
                                className="rounded p-1 text-mist-400 transition hover:bg-rose-500/10 hover:text-rose-500"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-2 rounded-lg border border-dashed border-mist-200 px-3 py-4 text-center text-[11px] text-mist-400 dark:border-white/10">
                          No attachments selected. PDF, DOCX, text, spreadsheets and images are supported.
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-mist-100 pt-4 dark:border-white/[0.06]">
                      <p className="text-[11px] leading-5 text-mist-500 dark:text-mist-400">
                        Submitting creates a new immutable version. Previous submissions and evaluations are kept.
                      </p>
                      <Button icon={Send} onClick={() => void submit()} loading={submitting} disabled={!text.trim() && !files.length}>
                        Submit for evaluation
                      </Button>
                    </div>
                  </div>
                )}
              </section>
            ) : null}
          </div>

          <div className="space-y-6">
            <section className="app-surface p-5">
              <SectionHeading title="Latest feedback" description="The most recent deterministic evaluation of your work." />
              {data.evaluations.length ? (
                <button
                  type="button"
                  onClick={() => setSelectedEvaluation(data.evaluations[0])}
                  className="w-full rounded-xl border border-mist-200 p-4 text-left transition hover:border-electric-400/60 dark:border-white/10"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <StatusBadge status={data.evaluations[0].status} />
                      <p className="mt-2 text-sm font-semibold text-graphite-900 dark:text-mist-100">
                        {data.evaluations[0].summary}
                      </p>
                      <p className="mt-1 text-[10px] text-mist-400">
                        {formatDateTime(data.evaluations[0].created_at)} · confidence{" "}
                        {Math.round(data.evaluations[0].confidence * 100)}%
                      </p>
                    </div>
                    <p className="heading-display shrink-0 text-2xl text-graphite-950 dark:text-white">
                      {formatScore(data.evaluations[0].score)}
                    </p>
                  </div>
                  <span className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-electric-600 dark:text-electric-300">
                    Open full evaluation <ArrowRight className="h-3 w-3" />
                  </span>
                </button>
              ) : (
                <p className="rounded-xl border border-dashed border-mist-200 px-4 py-6 text-center text-xs text-mist-400 dark:border-white/10">
                  Your first evaluation appears here after you submit work.
                </p>
              )}
            </section>

            <section className="app-surface p-5">
              <SectionHeading
                title="Next meeting"
                description="Download the calendar file or ask your reviewer for joining details."
              />
              {nextMeeting ? (
                <div className="space-y-3">
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
                    ) : (
                      <span className="rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                        No online meeting link has been configured.
                      </span>
                    )}
                    <Button size="sm" variant="secondary" icon={Download} onClick={() => void downloadMeeting(nextMeeting)}>
                      .ics
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-xs leading-5 text-mist-500 dark:text-mist-400">
                  No proposed or scheduled meeting. A review slot is created when a submission needs discussion.
                </p>
              )}
            </section>

            <section className="rounded-2xl border border-navy-800 bg-navy-950 p-5">
              <div className="flex items-center gap-2">
                <BookOpenCheck className="h-4 w-4 text-electric-300" />
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white">How scoring works</p>
              </div>
              <p className="mt-2 text-[11px] leading-5 text-mist-400">
                A deterministic rubric checks your submission against the brief. Mandatory failures cannot be
                cancelled by a high score. Anything that cannot be verified is sent to a human reviewer.
              </p>
              <Link
                to="/internflow/me"
                className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-electric-300"
              >
                Ask the assistant about your records <ArrowRight className="h-3 w-3" />
              </Link>
            </section>
          </div>
        </div>
      ) : null}

      {tab === "history" ? (
        <div className="space-y-6">
          <section className="app-surface overflow-hidden">
            <div className="border-b border-mist-100 p-5 dark:border-white/[0.07]">
              <SectionHeading
                title="Assignments"
                description="Your complete task sequence. Only the current task accepts a submission."
              />
            </div>
            {data.assignments.length ? (
              <div className="divide-y divide-mist-100 dark:divide-white/[0.06]">
                {data.assignments.map((assignment) => (
                  <div key={assignment.id} className="flex flex-col gap-2 p-5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-electric-500/10 text-[11px] font-bold text-electric-600 dark:text-electric-300">
                          {assignment.sequence_order}
                        </span>
                        <p className="text-sm font-semibold text-graphite-900 dark:text-mist-100">{assignment.title}</p>
                        <StatusBadge status={assignment.status} />
                        {assignment.id === current?.id ? <Badge tone="blue">current</Badge> : null}
                      </div>
                      <p className="mt-1 text-[11px] text-mist-500 dark:text-mist-400">
                        Assigned {formatDateTime(assignment.assigned_at)} · due {formatDateTime(assignment.due_at)} ·{" "}
                        attempt {assignment.attempt_count}
                        {assignment.template ? ` of ${assignment.template.max_attempts}` : ""}
                      </p>
                    </div>
                    {assignment.approved_at ? (
                      <p className="shrink-0 text-[11px] font-semibold text-emerald-600 dark:text-emerald-300">
                        Approved {formatDateTime(assignment.approved_at)}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-6">
                <EmptyState icon={ClipboardCheck} title="No assignments" description="Your task sequence will appear here once work is assigned." />
              </div>
            )}
          </section>

          <section className="app-surface overflow-hidden">
            <div className="border-b border-mist-100 p-5 dark:border-white/[0.07]">
              <SectionHeading
                title="Submission history"
                description="Versions are immutable. Every submission has its own evaluation."
              />
            </div>
            {data.submissions.length ? (
              <div className="space-y-4 p-5">
                {data.submissions.map((submission) => {
                  const evaluation = evaluationBySubmission[submission.id];
                  const assignmentTitle = assignmentTitles[submission.assignment_id] ?? "Assignment";
                  return (
                    <div key={submission.id} className="rounded-xl border border-mist-200 p-4 dark:border-white/10">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-graphite-900 dark:text-mist-100">
                            {assignmentTitle} · v{submission.version}
                          </p>
                          <p className="mt-0.5 text-[10px] text-mist-400">
                            Submitted {formatDateTime(submission.submitted_at)} · status {submission.status}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {evaluation ? (
                            <>
                              <span className="text-sm font-semibold tabular-nums text-graphite-900 dark:text-white">
                                {formatScore(evaluation.score)}
                              </span>
                              <Button variant="secondary" size="sm" onClick={() => setSelectedEvaluation(evaluation)}>
                                Evaluation
                              </Button>
                            </>
                          ) : null}
                        </div>
                      </div>
                      {submission.text_content ? (
                        <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs leading-5 text-mist-600 dark:text-mist-300">
                          {submission.text_content}
                        </p>
                      ) : (
                        <p className="mt-2 text-xs text-mist-400">File-only submission.</p>
                      )}
                      {submission.files.length ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {submission.files.map((file) => (
                            <button
                              key={file.id}
                              type="button"
                              onClick={() => void downloadSubmissionFile(submission, file.id, file.filename)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-mist-200 px-2 py-1 text-[11px] text-graphite-700 transition hover:border-electric-400/60 dark:border-white/10 dark:text-mist-300"
                            >
                              <Download className="h-3 w-3" />
                              {file.filename}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-6">
                <EmptyState icon={FileText} title="No submissions yet" description="Submit your current task to create the first version." />
              </div>
            )}
          </section>
        </div>
      ) : null}

      {tab === "feedback" ? (
        <section className="app-surface overflow-hidden">
          {data.evaluations.length ? (
            <div className="divide-y divide-mist-100 dark:divide-white/[0.06]">
              {data.evaluations.map((evaluation) => {
                const assignmentTitle = assignmentTitles[evaluation.assignment_id] ?? "Assignment";
                return (
                  <button
                    key={evaluation.id}
                    type="button"
                    onClick={() => setSelectedEvaluation(evaluation)}
                    className="flex w-full flex-col gap-2 p-5 text-left transition hover:bg-mist-50/70 dark:hover:bg-white/[0.02] sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge status={evaluation.status} />
                        <Badge tone="neutral">{assignmentTitle}</Badge>
                        {evaluation.human_review_required ? <Badge tone="amber">human review</Badge> : null}
                      </div>
                      <p className="mt-1.5 text-sm text-graphite-800 dark:text-mist-200">{evaluation.summary}</p>
                      {evaluation.corrective_actions.length ? (
                        <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-300">
                          {evaluation.corrective_actions.length} corrective action{evaluation.corrective_actions.length === 1 ? "" : "s"} to review
                        </p>
                      ) : null}
                      <p className="mt-0.5 text-[10px] text-mist-400">
                        {formatDateTime(evaluation.created_at)} · rubric {evaluation.rubric_version} ·{" "}
                        {evaluation.criteria_results.length} criteria
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="heading-display text-xl text-graphite-950 dark:text-white">{formatScore(evaluation.score)}</p>
                      <p className="text-[10px] text-mist-400">
                        {evaluation.decision?.replace(/_/g, " ") ?? "awaiting decision"}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="p-6">
              <EmptyState
                icon={MessageSquare}
                title="No feedback yet"
                description="After your first submission, rubric results, strengths, issues and corrective actions appear here."
              />
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
                      <a
                        href={meeting.meet_url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-electric-600 underline dark:text-electric-300"
                      >
                        <Video className="h-3 w-3" /> Join real meeting link
                      </a>
                    ) : (
                      <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-300">
                        No online link. Your reviewer will share joining instructions.
                      </p>
                    )}
                    {meeting.notes ? (
                      <p className="mt-1 whitespace-pre-wrap rounded-lg bg-mist-50 px-3 py-2 text-[11px] leading-5 text-mist-600 dark:bg-white/[0.03] dark:text-mist-400">
                        {meeting.notes}
                      </p>
                    ) : null}
                  </div>
                  <Button size="sm" variant="secondary" icon={Download} onClick={() => void downloadMeeting(meeting)}>
                    .ics
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-6">
              <EmptyState
                icon={CalendarDays}
                title="No meetings scheduled"
                description="Onboarding and review conversations appear here when your programme administrator creates them."
              />
            </div>
          )}
        </section>
      ) : null}

      {tab === "assistant" ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <section className="app-surface flex min-h-[520px] flex-col overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-mist-100 p-4 dark:border-white/[0.07]">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-electric-500/10 text-electric-600 dark:text-electric-300">
                  <Sparkles className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-graphite-900 dark:text-mist-100">InternFlow assistant</p>
                  <p className="text-[10px] text-mist-400">Grounded in your assignments, evaluations and meetings</p>
                </div>
              </div>
              <Badge tone="violet">records only</Badge>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              {!assistantTurns.length ? (
                <div className="mx-auto max-w-lg py-8 text-center">
                  <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-electric-500/10 text-electric-600 dark:text-electric-300">
                    <BookOpenCheck className="h-5 w-5" />
                  </span>
                  <p className="mt-3 text-sm font-semibold text-graphite-900 dark:text-mist-100">
                    Ask about your own programme records
                  </p>
                  <p className="mt-1 text-xs leading-5 text-mist-500 dark:text-mist-400">
                    This assistant reads your current task, deadlines, evaluation feedback and meetings. It does not
                    invent answers or contact anyone.
                  </p>
                  <div className="mt-4 space-y-2">
                    {ASSISTANT_PROMPTS.map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        onClick={() => void ask(prompt)}
                        className="block w-full rounded-xl border border-mist-200 px-3 py-2 text-left text-xs text-graphite-700 transition hover:border-electric-400/60 dark:border-white/10 dark:text-mist-300"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                assistantTurns.map((turn, index) => (
                  <div key={index} className={cn("flex", turn.role === "user" ? "justify-end" : "justify-start")}>
                    <div
                      className={cn(
                        "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-6",
                        turn.role === "user"
                          ? "bg-electric-600 text-white"
                          : "border border-mist-200 bg-white text-graphite-800 dark:border-white/10 dark:bg-white/[0.04] dark:text-mist-200",
                      )}
                    >
                      {turn.role === "assistant" ? <Markdown content={turn.content} /> : turn.content}
                      {turn.intent ? (
                        <p className="mt-2 text-[9px] uppercase tracking-[0.1em] opacity-60">intent: {turn.intent}</p>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
              {assistantBusy ? (
                <div className="flex justify-start">
                  <div className="rounded-2xl border border-mist-200 bg-white px-3.5 py-2.5 text-xs text-mist-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-mist-400">
                    Reading your records…
                  </div>
                </div>
              ) : null}
              <div ref={chatEnd} />
            </div>

            {assistantError ? (
              <p className="border-t border-rose-500/20 bg-rose-500/[0.04] px-4 py-2 text-[11px] text-rose-600 dark:text-rose-300">
                {assistantError}
              </p>
            ) : null}

            <form
              className="flex items-end gap-2 border-t border-mist-100 p-3 dark:border-white/[0.07]"
              onSubmit={(event) => {
                event.preventDefault();
                void ask();
              }}
            >
              <Textarea
                rows={2}
                aria-label="Message the InternFlow assistant"
                placeholder="Ask about your current task, feedback or meetings…"
                value={assistantInput}
                maxLength={4000}
                onChange={(event) => setAssistantInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void ask();
                  }
                }}
                className="min-h-[44px] resize-none"
              />
              <Button type="submit" size="icon" aria-label="Send message" disabled={!assistantInput.trim() || assistantBusy}>
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </section>

          <div className="space-y-6">
            <section className="app-surface p-5">
              <SectionHeading title="What it can see" description="The assistant is scoped to your linked intern record." />
              <ul className="space-y-2 text-xs leading-5 text-mist-600 dark:text-mist-300">
                {[
                  "Your current assignment, status and due date",
                  "Previous submissions and their evaluation results",
                  "Corrective actions and reviewer decisions",
                  "Proposed and scheduled meetings",
                ].map((item) => (
                  <li key={item} className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                    {item}
                  </li>
                ))}
              </ul>
              <Notice tone="info" title="No outside knowledge">
                Questions unrelated to your programme records receive an honest refusal rather than a guessed answer.
              </Notice>
            </section>
            <section className="app-surface p-5">
              <div className="flex items-center gap-2">
                <Flag className="h-4 w-4 text-amber-500" />
                <p className="text-sm font-semibold text-graphite-900 dark:text-mist-100">Need a human?</p>
              </div>
              <p className="mt-1 text-[11px] leading-5 text-mist-500 dark:text-mist-400">
                The assistant cannot change deadlines, approve tasks or send email. Contact your programme
                administrator for decisions that affect your record.
              </p>
              <Link to="/chat" className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-electric-600 dark:text-electric-300">
                Open general NEXORA chat <ArrowRight className="h-3 w-3" />
              </Link>
            </section>
          </div>
        </div>
      ) : null}

      <EvaluationDetail
        evaluation={selectedEvaluation}
        internName={intern.full_name}
        assignmentTitle={
          selectedEvaluation ? assignmentTitles[selectedEvaluation.assignment_id] : undefined
        }
        canDecide={false}
        onClose={() => setSelectedEvaluation(null)}
      />

      <p className="flex items-center justify-center gap-2 text-[10px] text-mist-400">
        <Upload className="h-3 w-3" />
        All records are scoped to {intern.company_name || "your organization"} · times shown in your local timezone
      </p>
    </div>
  );
}
