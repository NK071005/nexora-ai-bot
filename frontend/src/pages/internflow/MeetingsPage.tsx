import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  Pencil,
  ShieldAlert,
  Video,
} from "lucide-react";
import { useAuth } from "@/app/AuthContext";
import { useToast } from "@/app/ToastContext";
import { useApiQuery, useDocumentTitle } from "@/hooks/useApi";
import { ApiError, downloadFile, internflowApi, settingsApi } from "@/services/api";
import type { ConfigStatus, Meeting, ProgressSummary } from "@/types/api";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Notice,
  PageHeader,
  SectionHeading,
  Select,
  Skeleton,
  StatCard,
  StatusBadge,
} from "@/components/ui/primitives";
import { Tabs } from "@/components/ui/overlays";
import { MeetingEditor } from "@/components/internflow/MeetingEditor";
import { formatDateTime, relativeTime } from "@/lib/format";

const MEETING_STATUSES = ["all", "proposed", "scheduled", "completed", "cancelled"] as const;

const statusCopy: Record<string, string> = {
  proposed: "A time is proposed but not confirmed with the intern.",
  scheduled: "Confirmed. Share the joining method before the meeting.",
  completed: "The review took place and the record is closed.",
  cancelled: "The meeting will not take place.",
};

export function MeetingsPage() {
  useDocumentTitle("InternFlow meetings");
  const { me } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState<(typeof MEETING_STATUSES)[number]>("all");
  const [internFilter, setInternFilter] = useState("");
  const [editing, setEditing] = useState<Meeting | null>(null);

  const meetings = useApiQuery<Meeting[]>(
    () =>
      internflowApi.meetings({
        status: status === "all" ? undefined : status,
        intern_id: internFilter || undefined,
      }),
    [status, internFilter, me?.active_organization_id],
  );
  const progress = useApiQuery<ProgressSummary>(() => internflowApi.progress(), [me?.active_organization_id]);
  const config = useApiQuery<ConfigStatus>(() => settingsApi.status(), [me?.active_organization_id]);

  const names = useMemo(() => {
    const map: Record<string, string> = {};
    for (const row of progress.data?.interns ?? []) map[row.intern_id] = row.name;
    return map;
  }, [progress.data]);

  const rows = useMemo(() => meetings.data ?? [], [meetings.data]);
  const counts = useMemo(() => {
    const base: Record<string, number> = { all: rows.length, proposed: 0, scheduled: 0, completed: 0, cancelled: 0 };
    for (const meeting of rows) base[meeting.status] = (base[meeting.status] ?? 0) + 1;
    return base;
  }, [rows]);

  const calendarConfigured = Boolean(
    (config.data?.calendar as { configured?: boolean } | undefined)?.configured,
  );
  const calendarMode = (config.data?.calendar as { mode?: string } | undefined)?.mode ?? "unconfigured";
  const missingJoin = rows.filter((meeting) => !meeting.meet_url && meeting.status !== "cancelled").length;

  function replaceMeeting(updated: Meeting) {
    meetings.setData(rows.map((meeting) => (meeting.id === updated.id ? updated : meeting)));
  }

  async function download(meeting: Meeting) {
    try {
      await downloadFile(
        `/internflow/meetings/${meeting.id}/ics`,
        `nexora-meeting-${meeting.id.slice(0, 8)}.ics`,
      );
    } catch (caught) {
      toast.error("Calendar file unavailable", caught instanceof ApiError ? caught.message : undefined);
    }
  }

  if (meetings.error && !meetings.data) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="InternFlow"
          title="Meetings"
          description="Review conversations created by the internship workflow."
        />
        <ErrorState message={meetings.error} onRetry={() => void meetings.reload()} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="InternFlow"
        title="Meetings & reviews"
        description="Every onboarding, correction and review meeting stays attached to its intern and assignment. Calendar files always work; live Meet links only appear when Google Calendar is configured."
        actions={
          <Button variant="secondary" icon={CalendarDays} onClick={() => void meetings.reload(true)}>
            Refresh
          </Button>
        }
      />

      {!calendarConfigured ? (
        <Notice
          tone="warning"
          title="Google Calendar is not configured"
          action={
            <Link to="/settings?tab=integrations" className="text-xs font-semibold underline">
              View integrations
            </Link>
          }
        >
          Meetings have no Google Meet URL. Download the generated <code>.ics</code> file and send the joining
          instructions manually. Status is recorded as <code>{calendarMode}</code>.
        </Notice>
      ) : (
        <Notice tone="success" title="Google Calendar is configured">
          Meetings created by the workflow can carry a real Google Meet URL. Existing meetings without one are
          shown as missing a join link.
        </Notice>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Proposed"
          value={counts.proposed ?? 0}
          hint="Awaiting confirmation"
          icon={CalendarPlus}
          tone="violet"
          loading={meetings.loading && !meetings.data}
        />
        <StatCard
          label="Scheduled"
          value={counts.scheduled ?? 0}
          hint="Confirmed review slots"
          icon={CheckCircle2}
          tone="green"
          loading={meetings.loading && !meetings.data}
        />
        <StatCard
          label="Completed"
          value={counts.completed ?? 0}
          hint="Closed review conversations"
          icon={Clock}
          tone="blue"
          loading={meetings.loading && !meetings.data}
        />
        <StatCard
          label="Missing join link"
          value={missingJoin}
          hint="No real Meet URL recorded"
          icon={ShieldAlert}
          tone={missingJoin ? "amber" : "green"}
          loading={meetings.loading && !meetings.data}
        />
      </div>

      <Tabs
        items={MEETING_STATUSES.map((value) => ({
          id: value,
          label: value === "all" ? "All meetings" : value.charAt(0).toUpperCase() + value.slice(1),
          count: counts[value] ?? 0,
        }))}
        value={status}
        onChange={(value) => setStatus(value as (typeof MEETING_STATUSES)[number])}
      />

      <section className="app-surface overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-mist-100 p-4 dark:border-white/[0.07] sm:flex-row sm:items-center sm:justify-between">
          <SectionHeading
            title="Meeting register"
            description={`${rows.length} meeting${rows.length === 1 ? "" : "s"} in this view. Meetings are created by workflow events; edit the slot, status or notes here.`}
          />
          <Select
            aria-label="Filter by intern"
            className="sm:max-w-[240px]"
            value={internFilter}
            onChange={(event) => setInternFilter(event.target.value)}
          >
            <option value="">All interns</option>
            {(progress.data?.interns ?? []).map((row) => (
              <option key={row.intern_id} value={row.intern_id}>
                {row.name}
              </option>
            ))}
          </Select>
        </div>

        {meetings.loading && !meetings.data ? (
          <div className="space-y-3 p-4">
            {[0, 1, 2, 3].map((key) => (
              <Skeleton key={key} className="h-20 rounded-xl" />
            ))}
          </div>
        ) : rows.length ? (
          <div className="divide-y divide-mist-100 dark:divide-white/[0.06]">
            {rows.map((meeting) => {
              const person = names[meeting.intern_id] ?? "Intern";
              return (
                <div
                  key={meeting.id}
                  className="flex flex-col gap-4 p-5 transition hover:bg-mist-50/60 dark:hover:bg-white/[0.02] sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-300">
                      <CalendarDays className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-graphite-900 dark:text-mist-100">{meeting.title}</p>
                        <StatusBadge status={meeting.status} />
                        {meeting.meet_url ? <Badge tone="green">Meet link</Badge> : null}
                      </div>
                      <p className="mt-1 text-xs text-mist-500 dark:text-mist-400">
                        <Link
                          to={`/internflow/interns/${meeting.intern_id}`}
                          className="font-semibold text-graphite-700 hover:text-electric-600 dark:text-mist-300 dark:hover:text-electric-300"
                        >
                          {person}
                        </Link>
                        {" · "}
                        {meeting.start_at ? (
                          <>
                            {formatDateTime(meeting.start_at)} ({relativeTime(meeting.start_at)})
                          </>
                        ) : (
                          "No date proposed"
                        )}
                        {" · "}
                        {meeting.timezone}
                      </p>
                      <p className="mt-1 text-[11px] leading-5 text-mist-500 dark:text-mist-400">
                        {statusCopy[meeting.status] ?? "Workflow meeting record."}
                      </p>
                      {meeting.notes ? (
                        <p className="mt-2 max-w-2xl whitespace-pre-wrap rounded-lg bg-mist-50 px-3 py-2 text-[11px] leading-5 text-mist-600 dark:bg-white/[0.03] dark:text-mist-400">
                          {meeting.notes}
                        </p>
                      ) : null}
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {meeting.meet_url ? (
                          <a
                            href={meeting.meet_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-lg bg-electric-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-electric-700 dark:text-electric-200"
                          >
                            <Video className="h-3.5 w-3.5" /> Join real Meet link
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (
                          <span className="rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                            No meeting URL recorded
                          </span>
                        )}
                        <span className="text-[10px] uppercase tracking-[0.1em] text-mist-400">
                          provider: {meeting.provider || "none"}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5 pl-[52px] sm:pl-0">
                    <Button variant="secondary" size="sm" icon={Download} onClick={() => void download(meeting)}>
                      .ics
                    </Button>
                    <Button variant="ghost" size="sm" icon={Pencil} onClick={() => setEditing(meeting)}>
                      Review
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-6">
            <EmptyState
              icon={CalendarDays}
              title={status === "all" ? "No meetings yet" : `No ${status} meetings`}
              description="Assigning a task, requesting corrections and onboarding create meeting records automatically. Change the filter or open an intern profile to inspect their workflow."
              action={
                <Link to="/internflow/interns">
                  <Button variant="secondary" size="sm">Open interns</Button>
                </Link>
              }
            />
          </div>
        )}
      </section>

      <p className="flex items-center justify-center gap-2 text-[10px] text-mist-400">
        <CalendarDays className="h-3 w-3" />
        Calendar exports are generated locally. No invitation is sent unless an email provider is configured.
      </p>

      <MeetingEditor
        meeting={editing}
        internName={editing ? names[editing.intern_id] : undefined}
        onClose={() => setEditing(null)}
        onUpdated={replaceMeeting}
      />
    </div>
  );
}
