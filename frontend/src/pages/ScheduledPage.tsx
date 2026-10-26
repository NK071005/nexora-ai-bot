import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  AlarmClock,
  CalendarClock,
  CheckCircle2,
  Clock,
  History,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Timer,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { useAuth } from "@/app/AuthContext";
import { useToast } from "@/app/ToastContext";
import { useApiQuery, useDocumentTitle } from "@/hooks/useApi";
import { internflowApi, libraryApi, scheduledApi } from "@/services/api";
import { ApiError } from "@/services/api";
import type { LibraryItem, ScheduledRun, ScheduledTask, ScheduleMeta, TaskType } from "@/types/api";
import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  Notice,
  PageHeader,
  Select,
  Skeleton,
  StatusBadge,
  Switch,
  Textarea,
} from "@/components/ui/primitives";
import {
  ConfirmDialog,
  Drawer,
  Menu,
  MenuItem,
  Modal,
} from "@/components/ui/overlays";
import { DAYS_OF_WEEK } from "@/lib/constants";
import { formatDateTime, nextRunLabel, relativeTime, toLocalInput, fromLocalInput, truncate } from "@/lib/format";
import { cn } from "@/lib/cn";

const fieldLabels: Record<string, string> = {
  prompt: "Prompt",
  query: "Search query",
  library_item_id: "Ground in library item",
  assignment_id: "Assignment for reminder",
};

type ScheduleKind = "once" | "daily" | "weekly" | "monthly";

interface TaskForm {
  title: string;
  description: string;
  task_type: string;
  schedule_kind: ScheduleKind;
  timezone: string;
  run_at: string;
  time_of_day: string;
  day_of_week: string;
  day_of_month: string;
  notify: boolean;
  config: Record<string, string>;
}

const baseForm: TaskForm = {
  title: "",
  description: "",
  task_type: "custom_prompt",
  schedule_kind: "daily",
  timezone: "Asia/Kolkata",
  run_at: "",
  time_of_day: "09:00",
  day_of_week: "0",
  day_of_month: "1",
  notify: true,
  config: { prompt: "" },
};

export function ScheduledPage() {
  useDocumentTitle("Scheduled tasks");
  const { me, isAdmin } = useAuth();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [filter, setFilter] = useState("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ScheduledTask | null>(null);
  const [form, setForm] = useState<TaskForm>(baseForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ScheduledTask | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);

  const meta = useApiQuery(() => scheduledApi.meta(), [me?.active_organization_id]);
  const tasks = useApiQuery(() => scheduledApi.list(), [me?.active_organization_id]);
  const library = useApiQuery(() => libraryApi.items({ limit: 100 }), [me?.active_organization_id]);
  const interns = useApiQuery(
    () => (isAdmin ? internflowApi.interns({ limit: 200 }) : Promise.resolve(null)),
    [isAdmin, me?.active_organization_id],
  );
  const [assignmentIntern, setAssignmentIntern] = useState("");
  const internDetail = useApiQuery(
    () => (assignmentIntern ? internflowApi.intern(assignmentIntern) : Promise.resolve(null)),
    [assignmentIntern],
  );

  const detail = useApiQuery(
    () => (detailId ? scheduledApi.get(detailId) : Promise.resolve(null)),
    [detailId],
  );

  useEffect(() => {
    if (searchParams.get("new") === "1") {
      openCreate();
      const next = new URLSearchParams(searchParams);
      next.delete("new");
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const activeType = useMemo(
    () => meta.data?.task_types.find((entry) => entry.key === form.task_type) ?? null,
    [meta.data, form.task_type],
  );

  const visibleTasks = useMemo(() => {
    const rows = tasks.data ?? [];
    if (filter === "all") return rows;
    return rows.filter((task) => task.status === filter);
  }, [tasks.data, filter]);

  const summary = useMemo(() => {
    const rows = tasks.data ?? [];
    return {
      active: rows.filter((task) => task.status === "active").length,
      paused: rows.filter((task) => task.status === "paused").length,
      next: rows
        .filter((task) => task.status === "active" && task.next_run_at)
        .sort((a, b) => (a.next_run_at ?? "").localeCompare(b.next_run_at ?? ""))[0] ?? null,
      failures: rows.reduce((total, task) => total + task.failure_count, 0),
    };
  }, [tasks.data]);

  function openCreate() {
    setEditing(null);
    setForm({ ...baseForm, timezone: me?.user.timezone ?? "Asia/Kolkata", config: { prompt: "" } });
    setAssignmentIntern("");
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(task: ScheduledTask) {
    setEditing(task);
    setAssignmentIntern("");
    setForm({
      title: task.title,
      description: task.description,
      task_type: task.task_type,
      schedule_kind: task.schedule_kind,
      timezone: task.timezone,
      run_at: task.run_at ? toLocalInput(task.run_at) : "",
      time_of_day: task.time_of_day ?? "09:00",
      day_of_week: String(task.day_of_week ?? 0),
      day_of_month: String(task.day_of_month ?? 1),
      notify: task.notify,
      config: Object.fromEntries(
        Object.entries(task.config ?? {}).map(([key, value]) => [key, value == null ? "" : String(value)]),
      ),
    });
    if (typeof task.config?.assignment_id === "string") {
      const found = internDetail.data;
      if (found?.intern) setAssignmentIntern(found.intern.id);
    }
    setFormError(null);
    setFormOpen(true);
  }

  function changeType(type: TaskType) {
    setForm((state) => ({
      ...state,
      task_type: type.key,
      config: Object.fromEntries(type.config_fields.map((field) => [field, ""])),
    }));
  }

  async function saveTask() {
    if (!form.title.trim()) {
      setFormError("Give this automation a title.");
      return;
    }
    if (form.schedule_kind === "once" && !form.run_at) {
      setFormError("A one-time task needs a run date and time.");
      return;
    }
    if (form.schedule_kind !== "once" && !form.time_of_day) {
      setFormError("Recurring tasks need a time of day.");
      return;
    }
    if (form.task_type === "web_check" && !meta.data?.scheduler_enabled) {
      // still allowed to save; the run will be blocked by configuration. No special handling.
    }
    const config: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(form.config)) {
      if (value?.trim()) config[key] = value.trim();
    }
    const payload: Record<string, unknown> = {
      title: form.title.trim(),
      description: form.description,
      schedule_kind: form.schedule_kind,
      timezone: form.timezone,
      time_of_day: form.schedule_kind === "once" ? null : form.time_of_day,
      day_of_week: form.schedule_kind === "weekly" ? Number(form.day_of_week) : null,
      day_of_month: form.schedule_kind === "monthly" ? Number(form.day_of_month) : null,
      notify: form.notify,
      config,
    };
    if (form.schedule_kind === "once") payload.run_at = fromLocalInput(form.run_at);
    if (!editing) payload.task_type = form.task_type;

    setSaving(true);
    setFormError(null);
    try {
      if (editing) {
        await scheduledApi.update(editing.id, payload);
        toast.success("Automation updated", "The next run was recalculated.");
      } else {
        await scheduledApi.create(payload);
        toast.success("Automation created", "It will run on the scheduler thread.");
      }
      setFormOpen(false);
      await tasks.reload(true);
      if (detailId) await detail.reload(true);
    } catch (caught) {
      setFormError(caught instanceof ApiError ? caught.message : "Could not save this automation.");
    } finally {
      setSaving(false);
    }
  }

  async function runNow(task: ScheduledTask) {
    setRunningId(task.id);
    try {
      const run = await scheduledApi.runNow(task.id);
      toast.success("Run completed", run.status === "success" ? "Output recorded in run history." : `Status: ${run.status}`);
      await tasks.reload(true);
      if (detailId === task.id) await detail.reload(true);
    } catch (caught) {
      toast.error("Run did not complete", caught instanceof ApiError ? caught.message : undefined);
      if (detailId === task.id) await detail.reload(true);
    } finally {
      setRunningId(null);
    }
  }

  async function togglePause(task: ScheduledTask) {
    setBusyId(task.id);
    try {
      if (task.status === "active") {
        await scheduledApi.pause(task.id);
        toast.success("Automation paused", "No further runs are scheduled.");
      } else {
        await scheduledApi.resume(task.id);
        toast.success("Automation resumed", "The next run was recalculated.");
      }
      await tasks.reload(true);
      if (detailId === task.id) await detail.reload(true);
    } catch (caught) {
      toast.error("Could not change status", caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setBusyId(null);
    }
  }

  async function removeTask() {
    if (!pendingDelete) return;
    try {
      await scheduledApi.remove(pendingDelete.id);
      toast.success("Automation deleted", "Its run history is retained in the database.");
      if (detailId === pendingDelete.id) setDetailId(null);
      setPendingDelete(null);
      await tasks.reload(true);
    } catch (caught) {
      toast.error("Could not delete automation", caught instanceof ApiError ? caught.message : undefined);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Automations"
        title="Scheduled tasks"
        description="Durable automations executed by a database-backed scheduler. Each slot is unique, failures retry with backoff, and every outcome is recorded."
        actions={
          <Button icon={Plus} onClick={openCreate} disabled={!meta.data}>
            New automation
          </Button>
        }
      />

      {meta.data && !meta.data.scheduler_enabled ? (
        <Notice tone="warning" title="The scheduler is disabled on this server">
          <p>
            Tasks can be created and inspected, but the worker is off (<code>SCHEDULER_ENABLED=false</code>). “Run now”
            will report that the scheduler is disabled rather than pretending to run.
          </p>
        </Notice>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Active", value: summary.active, icon: CalendarClock, tone: "text-emerald-500" },
          { label: "Paused", value: summary.paused, icon: Pause, tone: "text-amber-500" },
          { label: "Recorded failures", value: summary.failures, icon: XCircle, tone: "text-rose-500" },
          {
            label: "Next run",
            value: summary.next?.next_run_at ? relativeTime(summary.next.next_run_at) : "—",
            hint: summary.next?.title,
            icon: Timer,
            tone: "text-electric-500",
          },
        ].map((card) => (
          <div key={card.label} className="app-surface p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="eyebrow">{card.label}</p>
                <p className="mt-2 font-display text-xl font-semibold text-graphite-950 dark:text-white">{card.value}</p>
                {card.hint ? <p className="mt-1 truncate text-[10px] text-mist-400">{card.hint}</p> : null}
              </div>
              <card.icon className={cn("h-4 w-4", card.tone)} />
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {[
          { id: "all", label: "All" },
          { id: "active", label: "Active" },
          { id: "paused", label: "Paused" },
          { id: "completed", label: "Completed" },
          { id: "cancelled", label: "Cancelled" },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setFilter(tab.id)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
              filter === tab.id
                ? "bg-electric-600 text-white shadow-sm"
                : "text-mist-600 hover:bg-mist-100 dark:text-mist-300 dark:hover:bg-white/[0.06]",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {tasks.error && !tasks.data ? (
        <ErrorState message={tasks.error} onRetry={() => void tasks.reload()} />
      ) : tasks.loading && !tasks.data ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-44" />
          <Skeleton className="h-44" />
        </div>
      ) : visibleTasks.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {visibleTasks.map((task) => {
            const type = meta.data?.task_types.find((entry) => entry.key === task.task_type);
            return (
              <article key={task.id} className="app-surface flex flex-col p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={task.status} />
                      <Badge tone="blue">{type?.label ?? task.task_type.replace(/_/g, " ")}</Badge>
                      {task.failure_count ? <Badge tone="rose">{task.failure_count} failed</Badge> : null}
                    </div>
                    <h3 className="mt-2 truncate text-sm font-semibold text-graphite-950 dark:text-white">{task.title}</h3>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-mist-500 dark:text-mist-400">
                      {task.description || type?.description || "No description"}
                    </p>
                  </div>
                  <Menu
                    trigger={
                      <IconButton label={`Actions for ${task.title}`}>
                        <MoreHorizontal className="h-4 w-4" />
                      </IconButton>
                    }
                  >
                    <MenuItem icon={History} onClick={() => setDetailId(task.id)}>
                      Run history
                    </MenuItem>
                    <MenuItem icon={Pencil} onClick={() => openEdit(task)}>
                      Edit
                    </MenuItem>
                    <MenuItem icon={Play} disabled={!meta.data?.scheduler_enabled} onClick={() => void runNow(task)}>
                      Run now
                    </MenuItem>
                    <MenuItem
                      icon={task.status === "active" ? Pause : RotateCcw}
                      disabled={busyId === task.id}
                      onClick={() => void togglePause(task)}
                    >
                      {task.status === "active" ? "Pause" : "Resume"}
                    </MenuItem>
                    <MenuItem icon={Trash2} danger onClick={() => setPendingDelete(task)}>
                      Delete
                    </MenuItem>
                  </Menu>
                </div>

                <div className="mt-3 grid gap-2 text-[11px] sm:grid-cols-2">
                  <div className="rounded-lg bg-mist-50 px-2.5 py-2 dark:bg-white/[0.03]">
                    <p className="text-[9px] uppercase tracking-[0.1em] text-mist-400">Schedule</p>
                    <p className="mt-0.5 text-mist-600 dark:text-mist-300">
                      {task.schedule_kind === "once"
                        ? formatDateTime(task.run_at)
                        : `${task.schedule_kind} at ${task.time_of_day ?? "—"} · ${task.timezone}`}
                    </p>
                  </div>
                  <div className="rounded-lg bg-mist-50 px-2.5 py-2 dark:bg-white/[0.03]">
                    <p className="text-[9px] uppercase tracking-[0.1em] text-mist-400">Next run</p>
                    <p className="mt-0.5 text-mist-600 dark:text-mist-300">{nextRunLabel(task.next_run_at)}</p>
                  </div>
                </div>

                {task.last_error ? (
                  <p className="mt-2 line-clamp-2 rounded-lg border border-rose-500/20 bg-rose-500/[0.04] px-2.5 py-2 text-[10px] leading-4 text-rose-700 dark:text-rose-300">
                    Last error: {task.last_error}
                  </p>
                ) : null}

                <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-mist-100 pt-3 dark:border-white/[0.06]">
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={Play}
                    loading={runningId === task.id}
                    disabled={!meta.data?.scheduler_enabled}
                    onClick={() => void runNow(task)}
                  >
                    Run now
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={task.status === "active" ? Pause : RotateCcw}
                    loading={busyId === task.id}
                    onClick={() => void togglePause(task)}
                  >
                    {task.status === "active" ? "Pause" : "Resume"}
                  </Button>
                  <span className="ml-auto text-[10px] text-mist-400">
                    {task.run_count} run{task.run_count === 1 ? "" : "s"}
                    {task.last_run_at ? ` · last ${relativeTime(task.last_run_at)}` : ""}
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={CalendarClock}
          title={filter === "all" ? "No automations yet" : `No ${filter} automations`}
          description="Schedule a prompt, a document summary, an InternFlow report or a web check. Runs are real and recorded."
          action={
            <Button icon={Plus} onClick={openCreate}>
              Create an automation
            </Button>
          }
        />
      )}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? "Edit automation" : "New automation"}
        description={
          editing
            ? "Changing the schedule recalculates the next run. The task type is fixed after creation."
            : "Choose a real handler, then set when it should run."
        }
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void saveTask()} loading={saving}>
              {editing ? "Save changes" : "Create automation"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError ? <Notice tone="danger" title="Could not save">{formError}</Notice> : null}
          <Field label="Title" required htmlFor="task-title">
            <Input
              id="task-title"
              value={form.title}
              onChange={(event) => setForm((state) => ({ ...state, title: event.target.value }))}
              placeholder="e.g. Monday research digest"
              maxLength={200}
            />
          </Field>
          <Field label="Description" htmlFor="task-desc">
            <Textarea
              id="task-desc"
              rows={2}
              value={form.description}
              onChange={(event) => setForm((state) => ({ ...state, description: event.target.value }))}
              placeholder="What should this automation produce?"
            />
          </Field>

          {!editing ? (
            <div>
              <p className="field-label">Task type</p>
              <div className="mt-1 grid gap-2 sm:grid-cols-2">
                {meta.data?.task_types.map((type) => (
                  <button
                    key={type.key}
                    type="button"
                    onClick={() => changeType(type)}
                    className={cn(
                      "rounded-xl border p-3 text-left transition",
                      form.task_type === type.key
                        ? "border-electric-500 bg-electric-500/[0.06] ring-1 ring-electric-500/30"
                        : "border-mist-200 hover:border-mist-300 dark:border-white/10 dark:hover:border-white/20",
                    )}
                  >
                    <p className="text-xs font-semibold text-graphite-900 dark:text-mist-100">{type.label}</p>
                    <p className="mt-1 text-[10px] leading-4 text-mist-500 dark:text-mist-400">{type.description}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {type.requires_organization ? <Badge tone="violet">admin</Badge> : null}
                      {type.requires_search ? (
                        <Badge tone={me?.capabilities.search.configured ? "green" : "amber"}>
                          {me?.capabilities.search.configured ? "search ready" : "search required"}
                        </Badge>
                      ) : null}
                    </div>
                  </button>
                ))}
              </div>
              {activeType?.requires_search && !me?.capabilities.search.configured ? (
                <p className="mt-2 text-[10px] leading-4 text-amber-600 dark:text-amber-300">
                  Web check cannot be saved until a search provider is configured. The API enforces this.
                </p>
              ) : null}
            </div>
          ) : null}

          {activeType && activeType.config_fields.length ? (
            <div className="rounded-xl border border-mist-200 p-3 dark:border-white/10">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-mist-400">Task input</p>
              <div className="space-y-3">
                {activeType.config_fields.map((field) => {
                  if (field === "library_item_id") {
                    return (
                      <Field key={field} label="Library item" hint="Optional grounding material. Personal to your account.">
                        <Select
                          value={form.config[field] ?? ""}
                          onChange={(event) =>
                            setForm((state) => ({ ...state, config: { ...state.config, [field]: event.target.value } }))
                          }
                        >
                          <option value="">No library item</option>
                          {library.data?.items.map((item: LibraryItem) => (
                            <option key={item.id} value={item.id}>
                              {item.title}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    );
                  }
                  if (field === "assignment_id") {
                    return (
                      <div key={field} className="space-y-3">
                        <Field label="Intern" hint="Choose an intern to list their assignments.">
                          <Select
                            value={assignmentIntern}
                            onChange={(event) => {
                              setAssignmentIntern(event.target.value);
                              setForm((state) => ({ ...state, config: { ...state.config, assignment_id: "" } }));
                            }}
                          >
                            <option value="">Select an intern…</option>
                            {interns.data?.items.map((intern) => (
                              <option key={intern.id} value={intern.id}>
                                {intern.full_name} · {intern.email}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <Field label="Assignment" required={activeType.requires_organization}>
                          <Select
                            value={form.config[field] ?? ""}
                            onChange={(event) =>
                              setForm((state) => ({
                                ...state,
                                config: { ...state.config, [field]: event.target.value },
                              }))
                            }
                            disabled={!assignmentIntern}
                          >
                            <option value="">{assignmentIntern ? "Select an assignment…" : "Select an intern first"}</option>
                            {internDetail.data?.assignments.map((assignment) => (
                              <option key={assignment.id} value={assignment.id}>
                                {assignment.title} · {assignment.status}
                              </option>
                            ))}
                          </Select>
                        </Field>
                      </div>
                    );
                  }
                  if (field === "prompt" || field === "query") {
                    return (
                      <Field
                        key={field}
                        label={fieldLabels[field] ?? field}
                        required
                        hint={
                          field === "prompt"
                            ? "The instruction the configured provider receives. Demo mode is labeled in the output."
                            : "Live search query. Real sources are recorded with the run."
                        }
                      >
                        <Textarea
                          rows={field === "prompt" ? 4 : 2}
                          value={form.config[field] ?? ""}
                          onChange={(event) =>
                            setForm((state) => ({ ...state, config: { ...state.config, [field]: event.target.value } }))
                          }
                          placeholder={field === "prompt" ? "Summarise the key decisions and open questions…" : "e.g. India AI policy update"}
                        />
                      </Field>
                    );
                  }
                  return (
                    <Field key={field} label={fieldLabels[field] ?? field}>
                      <Input
                        value={form.config[field] ?? ""}
                        onChange={(event) =>
                          setForm((state) => ({ ...state, config: { ...state.config, [field]: event.target.value } }))
                        }
                      />
                    </Field>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Schedule" htmlFor="task-kind">
              <Select
                id="task-kind"
                value={form.schedule_kind}
                onChange={(event) =>
                  setForm((state) => ({ ...state, schedule_kind: event.target.value as ScheduleKind }))
                }
              >
                <option value="once">One time</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </Select>
            </Field>
            <Field label="Timezone" htmlFor="task-tz">
              <Select
                id="task-tz"
                value={form.timezone}
                onChange={(event) => setForm((state) => ({ ...state, timezone: event.target.value }))}
              >
                {(meta.data?.timezones ?? [form.timezone]).map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </Select>
            </Field>
            {form.schedule_kind === "once" ? (
              <Field label="Run at" required htmlFor="task-run-at" className="sm:col-span-2">
                <Input
                  id="task-run-at"
                  type="datetime-local"
                  value={form.run_at}
                  onChange={(event) => setForm((state) => ({ ...state, run_at: event.target.value }))}
                />
              </Field>
            ) : (
              <>
                <Field label="Time of day" required htmlFor="task-time">
                  <Input
                    id="task-time"
                    type="time"
                    value={form.time_of_day}
                    onChange={(event) => setForm((state) => ({ ...state, time_of_day: event.target.value }))}
                  />
                </Field>
                {form.schedule_kind === "weekly" ? (
                  <Field label="Day of week" htmlFor="task-dow">
                    <Select
                      id="task-dow"
                      value={form.day_of_week}
                      onChange={(event) => setForm((state) => ({ ...state, day_of_week: event.target.value }))}
                    >
                      {DAYS_OF_WEEK.map((day) => (
                        <option key={day.value} value={day.value}>
                          {day.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : form.schedule_kind === "monthly" ? (
                  <Field label="Day of month" htmlFor="task-dom">
                    <Select
                      id="task-dom"
                      value={form.day_of_month}
                      onChange={(event) => setForm((state) => ({ ...state, day_of_month: event.target.value }))}
                    >
                      {Array.from({ length: 28 }).map((_, index) => (
                        <option key={index + 1} value={index + 1}>
                          {index + 1}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : (
                  <div className="hidden sm:block" />
                )}
              </>
            )}
          </div>

          <Switch
            checked={form.notify}
            onChange={(value) => setForm((state) => ({ ...state, notify: value }))}
            label="Create an in-app notification after each run"
            description="Notifications are recorded even when the run fails, with the recorded error."
          />
          {!editing && form.task_type === "web_check" && !meta.data?.scheduler_enabled ? (
            <Notice tone="warning" title="Scheduler disabled">
              <p>This task will be saved, but no automatic runs will happen until the worker is enabled.</p>
            </Notice>
          ) : null}
        </div>
      </Modal>

      <Drawer open={Boolean(detailId)} onClose={() => setDetailId(null)} side="right" label="Automation detail" className="w-[560px] max-w-[95vw]">
        {detail.loading && !detail.data ? (
          <div className="space-y-4 p-5">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-24" />
            <Skeleton className="h-40" />
          </div>
        ) : detail.data ? (
          <div className="flex min-h-full flex-col">
            <div className="sticky top-0 z-10 border-b border-mist-100 bg-white/95 px-5 py-4 backdrop-blur dark:border-white/[0.07] dark:bg-navy-900/95">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={detail.data.task.status} />
                    <Badge tone="blue">{detail.data.task.schedule_kind}</Badge>
                    <Badge tone="neutral">{detail.data.task.timezone}</Badge>
                  </div>
                  <h2 className="mt-2 font-display text-lg font-semibold text-graphite-950 dark:text-white">
                    {detail.data.task.title}
                  </h2>
                  <p className="mt-1 text-[10px] text-mist-400">
                    Created {formatDateTime(detail.data.task.created_at)} · {detail.data.task.run_count} runs
                  </p>
                </div>
                <IconButton label="Close detail" onClick={() => setDetailId(null)}>
                  <X className="h-4 w-4" />
                </IconButton>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Button
                  size="sm"
                  icon={Play}
                  loading={runningId === detail.data.task.id}
                  disabled={!meta.data?.scheduler_enabled}
                  onClick={() => detail.data && void runNow(detail.data.task)}
                >
                  Run now
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={detail.data.task.status === "active" ? Pause : RotateCcw}
                  loading={busyId === detail.data.task.id}
                  onClick={() => detail.data && void togglePause(detail.data.task)}
                >
                  {detail.data.task.status === "active" ? "Pause" : "Resume"}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={Pencil}
                  onClick={() => detail.data && openEdit(detail.data.task)}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={Trash2}
                  onClick={() => detail.data && setPendingDelete(detail.data.task)}
                >
                  Delete
                </Button>
              </div>
            </div>

            <div className="flex-1 space-y-5 px-5 py-5">
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="app-panel p-3">
                  <p className="text-[9px] uppercase tracking-[0.1em] text-mist-400">Next run</p>
                  <p className="mt-1 text-xs font-medium text-graphite-800 dark:text-mist-200">
                    {nextRunLabel(detail.data.task.next_run_at)}
                  </p>
                </div>
                <div className="app-panel p-3">
                  <p className="text-[9px] uppercase tracking-[0.1em] text-mist-400">Last run</p>
                  <p className="mt-1 text-xs font-medium text-graphite-800 dark:text-mist-200">
                    {detail.data.task.last_run_at
                      ? `${formatDateTime(detail.data.task.last_run_at)} · ${relativeTime(detail.data.task.last_run_at)}`
                      : "Never"}
                  </p>
                </div>
              </div>

              {detail.data.task.description ? (
                <p className="text-sm leading-6 text-mist-600 dark:text-mist-300">{detail.data.task.description}</p>
              ) : null}

              {Object.keys(detail.data.task.config ?? {}).length ? (
                <div>
                  <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-mist-400">Configuration</h3>
                  <div className="space-y-1.5 rounded-xl border border-mist-200 p-3 dark:border-white/10">
                    {Object.entries(detail.data.task.config).map(([key, value]) => (
                      <div key={key} className="flex items-start justify-between gap-3 text-[11px]">
                        <span className="text-mist-400">{fieldLabels[key] ?? key}</span>
                        <span className="max-w-[65%] break-words text-right text-mist-600 dark:text-mist-300">
                          {String(value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {detail.data.task.last_error ? (
                <Notice tone="danger" title="Last recorded error">
                  <p>{detail.data.task.last_error}</p>
                </Notice>
              ) : null}

              <div>
                <h3 className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-mist-400">
                  <History className="h-3.5 w-3.5" /> Run history
                </h3>
                {detail.data.runs.length ? (
                  <div className="space-y-2">
                    {detail.data.runs.map((run) => (
                      <RunCard key={run.id} run={run} />
                    ))}
                  </div>
                ) : (
                  <p className="rounded-lg border border-dashed border-mist-200 px-3 py-4 text-center text-xs text-mist-400 dark:border-white/10">
                    No runs yet. The first run is scheduled for {nextRunLabel(detail.data.task.next_run_at)}.
                  </p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="p-5">
            <ErrorState message={detail.error ?? "This automation could not be loaded."} onRetry={() => void detail.reload()} />
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => void removeTask()}
        title="Delete this automation?"
        description={
          pendingDelete
            ? `“${pendingDelete.title}” will stop running. Run history remains stored for audit.`
            : ""
        }
        confirmLabel="Delete automation"
        tone="danger"
      />
    </div>
  );
}

function RunCard({ run }: { run: ScheduledRun }) {
  const tone =
    run.status === "success" ? "green" : run.status === "failed" ? "rose" : run.status === "running" ? "blue" : "neutral";
  return (
    <div className="rounded-xl border border-mist-200 p-3 dark:border-white/10">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={tone as "green" | "rose" | "blue" | "neutral"} dot>
          {run.status}
        </Badge>
        <span className="text-[10px] text-mist-400">attempt {run.attempt}</span>
        <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-mist-400">
          <Clock className="h-3 w-3" />
          {formatDateTime(run.started_at)}
        </span>
      </div>
      {run.output ? (
        <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap rounded-lg bg-mist-50 p-2.5 font-mono text-[10px] leading-5 text-graphite-700 dark:bg-white/[0.03] dark:text-mist-300">
          {truncate(run.output, 3000)}
        </pre>
      ) : null}
      {run.error ? (
        <p className="mt-2 rounded-lg border border-rose-500/20 bg-rose-500/[0.04] px-2.5 py-2 text-[10px] leading-4 text-rose-700 dark:text-rose-300">
          {run.error}
        </p>
      ) : null}
      {run.finished_at ? (
        <p className="mt-1 flex items-center gap-1 text-[9px] text-mist-400">
          <CheckCircle2 className="h-2.5 w-2.5" /> finished {relativeTime(run.finished_at)}
        </p>
      ) : null}
    </div>
  );
}
