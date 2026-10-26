import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Bell,
  BookOpen,
  Bot,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Gauge,
  GraduationCap,
  Library,
  Plus,
  Search,
  ShieldAlert,
  Sparkles,
  Users,
  Wand2,
} from "lucide-react";
import { useAuth } from "@/app/AuthContext";
import { useApiQuery, useDocumentTitle } from "@/hooks/useApi";
import {
  chatsApi,
  internflowApi,
  libraryApi,
  notificationsApi,
  scheduledApi,
} from "@/services/api";
import type {
  Chat,
  InternFlowOverview,
  InternSelf,
  LibraryItem,
  ScheduledTask,
} from "@/types/api";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Notice,
  PageHeader,
  SectionHeading,
  SkeletonCard,
  StatCard,
  StatusBadge,
} from "@/components/ui/primitives";
import { Avatar } from "@/components/ui/primitives";
import { formatDate, relativeTime, truncate } from "@/lib/format";

interface DashboardData {
  chats: Chat[];
  chatTotal: number;
  library: LibraryItem[];
  libraryTotal: number;
  scheduled: ScheduledTask[];
  unread: number;
  overview: InternFlowOverview | null;
  internSelf: InternSelf | null;
}

export function DashboardPage() {
  useDocumentTitle("Home");
  const { me, isAdmin, isIntern } = useAuth();
  const navigate = useNavigate();
  const firstName = me?.user.full_name.split(" ")[0] ?? "there";

  const { data, loading, error, reload } = useApiQuery<DashboardData>(async () => {
    const [chatResult, libraryResult, scheduled, unread, overview, internSelf] = await Promise.all([
      chatsApi.list({ limit: 5 }),
      libraryApi.items({ limit: 5 }),
      scheduledApi.list(),
      notificationsApi.unread(),
      isAdmin ? internflowApi.overview() : Promise.resolve(null),
      isIntern ? internflowApi.me() : Promise.resolve(null),
    ]);
    return {
      chats: chatResult.items,
      chatTotal: chatResult.total,
      library: libraryResult.items,
      libraryTotal: libraryResult.total,
      scheduled,
      unread: unread.unread,
      overview,
      internSelf,
    };
  }, [me?.active_organization_id, isAdmin, isIntern]);

  const activeAutomations = useMemo(
    () => (data?.scheduled ?? []).filter((task) => task.status === "active").length,
    [data],
  );
  const dueSoon = useMemo(() => {
    const tasks = data?.scheduled ?? [];
    return tasks.filter(
      (task) => task.status === "active" && task.next_run_at && new Date(task.next_run_at).getTime() < Date.now() + 86_400_000,
    ).length;
  }, [data]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const aiDemo = me?.capabilities.ai.demo ?? true;
  const searchReady = me?.capabilities.search.configured ?? false;
  const emailMode = me?.capabilities.email.mode ?? "demo";

  if (error && !data) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Home" title={`${greeting}, ${firstName}`} description="Your workspace could not be loaded." />
        <ErrorState message={error} onRetry={() => void reload()} />
      </div>
    );
  }

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow={new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
        title={`${greeting}, ${firstName}`}
        description="Everything here is live data from your workspace. Demo or unconfigured integrations are labeled."
        actions={
          <>
            <Button variant="secondary" icon={Library} onClick={() => navigate("/library?new=1")}>
              Add to library
            </Button>
            <Button icon={Plus} onClick={() => navigate("/chat?new=1")}>
              New conversation
            </Button>
          </>
        }
      />

      {!aiDemo && !searchReady ? (
        <Notice tone="info" title="Live AI provider connected" action={<Link to="/settings?tab=integrations" className="text-xs font-semibold underline">Review integrations</Link>}>
          <p>Model calls are live. Web search is still unconfigured, so research and cited answers stay off until you add a search key.</p>
        </Notice>
      ) : null}

      {aiDemo ? (
        <Notice
          tone="warning"
          title="Demo Intelligence is active"
          action={
            <Link to="/settings?tab=integrations" className="text-xs font-semibold underline">
              Configure a provider
            </Link>
          }
        >
          <p>
            Answers are extractive and synthesized locally from the material you supply — never invented model output. The
            interface labels this mode everywhere.
          </p>
        </Notice>
      ) : null}

      {me?.user.email_verified_at === null ? (
        <Notice
          tone="warning"
          title="Email address not verified"
          action={<Link to="/verify-email" className="text-xs font-semibold underline">Verify now</Link>}
        >
          <p>Verification is not enforced for your role on this server, but some teams require it before inviting you.</p>
        </Notice>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Conversations"
          value={data?.chatTotal ?? "—"}
          hint={data?.chats[0] ? `Last activity ${relativeTime(data.chats[0].last_message_at)}` : "Start your first thread"}
          icon={Bot}
          loading={loading}
        />
        <StatCard
          label="Library items"
          value={data?.libraryTotal ?? "—"}
          hint={`${data?.library.filter((item) => item.chunk_count > 0).length ?? 0} indexed for retrieval`}
          icon={BookOpen}
          tone="violet"
          loading={loading}
        />
        <StatCard
          label="Automations"
          value={activeAutomations}
          hint={dueSoon ? `${dueSoon} run within 24 hours` : "No runs in the next day"}
          icon={CalendarClock}
          tone="green"
          loading={loading}
        />
        <StatCard
          label="Unread alerts"
          value={data?.unread ?? "—"}
          hint="Run outcomes and workspace notices"
          icon={Bell}
          tone="amber"
          loading={loading}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <section className="app-surface p-5">
            <SectionHeading
              title="Recent conversations"
              description="Persistent threads with streamed answers and real citations."
              action={
                <Link to="/chat" className="flex items-center gap-1 text-xs font-semibold text-electric-600 dark:text-electric-300">
                  All conversations <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              }
            />
            {loading ? (
              <div className="space-y-2">
                <div className="skeleton h-14 w-full" />
                <div className="skeleton h-14 w-full" />
                <div className="skeleton h-14 w-full" />
              </div>
            ) : data && data.chats.length > 0 ? (
              <div className="space-y-1">
                {data.chats.map((chat) => (
                  <Link
                    key={chat.id}
                    to={`/chat/${chat.id}`}
                    className="group flex items-start gap-3 rounded-xl px-2.5 py-2.5 transition hover:bg-mist-50 dark:hover:bg-white/[0.04]"
                  >
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-electric-500/10 text-electric-600 dark:text-electric-300">
                      <Bot className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold text-graphite-900 dark:text-mist-100">{chat.title}</span>
                        {chat.is_pinned ? <Badge tone="blue">Pinned</Badge> : null}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-mist-500 dark:text-mist-400">
                        {chat.preview ?? "No messages yet"}
                      </span>
                    </span>
                    <span className="shrink-0 text-[10px] text-mist-400">{relativeTime(chat.last_message_at)}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={Bot}
                title="No conversations yet"
                description="Start a thread and NEXORA will keep the full history, attachments and citations."
                action={
                  <Button icon={Plus} onClick={() => navigate("/chat?new=1")}>
                    Start a conversation
                  </Button>
                }
                className="py-8"
              />
            )}
          </section>

          {isAdmin && data?.overview ? (
            <section className="app-surface p-5">
              <SectionHeading
                title="InternFlow pulse"
                description="Live intern counts from the current organization."
                action={
                  <Link to="/internflow" className="flex items-center gap-1 text-xs font-semibold text-electric-600 dark:text-electric-300">
                    Open InternFlow <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                }
              />
              <div className="grid gap-3 sm:grid-cols-4">
                {[
                  { label: "Interns", value: data.overview.summary.interns_total, icon: Users },
                  { label: "Active", value: data.overview.summary.active, icon: GraduationCap },
                  { label: "Overdue", value: data.overview.summary.overdue, icon: ShieldAlert },
                  { label: "Pending review", value: data.overview.summary.tasks_pending, icon: ClipboardCheck },
                ].map((item) => (
                  <div key={item.label} className="app-panel p-3.5">
                    <item.icon className="h-4 w-4 text-electric-500" />
                    <p className="mt-2 font-display text-xl font-semibold text-graphite-950 dark:text-white">{item.value}</p>
                    <p className="text-[10px] uppercase tracking-[0.12em] text-mist-400">{item.label}</p>
                  </div>
                ))}
              </div>
              {data.overview.recent_evaluations.length ? (
                <div className="mt-4 divide-y divide-mist-100 dark:divide-white/[0.06]">
                  {data.overview.recent_evaluations.slice(0, 4).map((evaluation) => (
                    <div key={evaluation.id} className="flex items-center gap-3 py-2.5">
                      <ClipboardCheck className="h-4 w-4 shrink-0 text-mist-400" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-graphite-800 dark:text-mist-100">
                          {evaluation.summary || "Evaluation completed"}
                        </p>
                        <p className="text-[10px] text-mist-400">
                          {formatDate(evaluation.created_at)} · confidence {Math.round(evaluation.confidence * 100)}%
                        </p>
                      </div>
                      <span className="text-sm font-semibold text-graphite-800 dark:text-mist-100">{evaluation.score.toFixed(1)}</span>
                      <StatusBadge status={evaluation.status} />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-4 rounded-lg border border-dashed border-mist-200 px-3 py-4 text-center text-xs text-mist-400 dark:border-white/10">
                  No evaluations yet. Import interns and assign the first task.
                </p>
              )}
            </section>
          ) : null}

          {isIntern && data?.internSelf ? (
            <section className="app-surface p-5">
              <SectionHeading
                title="Your intern work"
                description="Assignments, deadlines and feedback attached to your account."
                action={
                  <Link to="/internflow/me" className="flex items-center gap-1 text-xs font-semibold text-electric-600 dark:text-electric-300">
                    Open my work <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                }
              />
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="app-panel p-3.5">
                  <p className="text-[10px] uppercase tracking-[0.12em] text-mist-400">Current task</p>
                  <p className="mt-1 text-sm font-semibold text-graphite-900 dark:text-white">
                    {data.internSelf.intern.current_task ?? "Nothing assigned"}
                  </p>
                  <p className="mt-1 text-[10px] text-mist-400">
                    {data.internSelf.intern.due_at ? `Due ${formatDate(data.internSelf.intern.due_at)}` : "No due date"}
                  </p>
                </div>
                <div className="app-panel p-3.5">
                  <p className="text-[10px] uppercase tracking-[0.12em] text-mist-400">Approved</p>
                  <p className="mt-1 text-xl font-semibold text-graphite-900 dark:text-white">
                    {data.internSelf.intern.tasks_approved}
                    <span className="text-sm font-normal text-mist-400"> / {data.internSelf.intern.tasks_total}</span>
                  </p>
                </div>
                <div className="app-panel p-3.5">
                  <p className="text-[10px] uppercase tracking-[0.12em] text-mist-400">Next meeting</p>
                  <p className="mt-1 truncate text-sm font-semibold text-graphite-900 dark:text-white">
                    {data.internSelf.next_meeting?.title ?? "None scheduled"}
                  </p>
                  <p className="mt-1 text-[10px] text-mist-400">
                    {data.internSelf.next_meeting?.start_at ? formatDate(data.internSelf.next_meeting.start_at) : "No date"}
                  </p>
                </div>
              </div>
            </section>
          ) : null}
        </div>

        <div className="space-y-6">
          <section className="app-surface p-5">
            <SectionHeading
              title="Quick actions"
              description="Everything here is reachable from the sidebar too."
            />
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                { label: "Ask a question", icon: Wand2, to: "/chat?new=1", tone: "bg-electric-500/10 text-electric-600 dark:text-electric-300" },
                { label: "Research the web", icon: Search, to: "/search", tone: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-300" },
                { label: "Capture a note", icon: Library, to: "/library?new=1", tone: "bg-violet-500/10 text-violet-600 dark:text-violet-300" },
                { label: "Schedule a run", icon: CalendarClock, to: "/scheduled?new=1", tone: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300" },
                ...(isAdmin
                  ? [{ label: "InternFlow", icon: Gauge, to: "/internflow", tone: "bg-amber-500/10 text-amber-600 dark:text-amber-300" }]
                  : []),
              ].map((action) => (
                <button
                  key={action.label}
                  type="button"
                  onClick={() => navigate(action.to)}
                  className="group flex items-center gap-2.5 rounded-xl border border-mist-200/80 bg-white px-3 py-2.5 text-left transition hover:border-electric-400/50 hover:shadow-panel dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-electric-500/30"
                >
                  <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${action.tone}`}>
                    <action.icon className="h-4 w-4" />
                  </span>
                  <span className="text-xs font-semibold text-graphite-800 dark:text-mist-200">{action.label}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="app-surface p-5">
            <SectionHeading
              title="Workspace capabilities"
              description="Real configuration state reported by the API."
              action={<Link to="/settings?tab=integrations" className="text-xs font-semibold text-electric-600 dark:text-electric-300">Details</Link>}
            />
            <div className="space-y-2.5">
              {[
                {
                  label: "Intelligence",
                  value: aiDemo ? "Demo (labeled)" : "Live provider",
                  ready: !aiDemo,
                  hint: aiDemo ? "Add OPENAI_API_KEY for model calls" : me?.capabilities.ai.model,
                },
                {
                  label: "Web search",
                  value: searchReady ? me?.capabilities.search.provider ?? "Configured" : "Not configured",
                  ready: searchReady,
                  hint: searchReady ? "Live URLs with citations" : "Add SEARCH_PROVIDER_API_KEY",
                },
                {
                  label: "Email delivery",
                  value: emailMode === "smtp" ? "SMTP" : "Demo log",
                  ready: emailMode === "smtp",
                  hint: emailMode === "smtp" ? "Messages leave this server" : "Recorded, never sent",
                },
                {
                  label: "Google Meet",
                  value: me?.capabilities.calendar.configured ? "Live calendar" : "Proposed + .ics",
                  ready: Boolean(me?.capabilities.calendar.configured),
                  hint: me?.capabilities.calendar.configured ? "Real Meet links" : "No invented meeting URLs",
                },
              ].map((row) => (
                <div key={row.label} className="flex items-start gap-2.5">
                  <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${row.ready ? "bg-emerald-500" : "bg-amber-500"}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-graphite-800 dark:text-mist-200">{row.label}</p>
                      <span className="text-[10px] text-mist-500">{row.value}</span>
                    </div>
                    <p className="text-[10px] leading-4 text-mist-400">{row.hint}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="app-surface p-5">
            <SectionHeading
              title="Latest library items"
              description="Lexical retrieval, not vector search."
              action={<Link to="/library" className="text-xs font-semibold text-electric-600 dark:text-electric-300">All items</Link>}
            />
            {loading ? (
              <SkeletonCard />
            ) : data && data.library.length ? (
              <div className="space-y-1">
                {data.library.map((item) => (
                  <Link
                    key={item.id}
                    to={`/library?item=${item.id}`}
                    className="flex items-center gap-2.5 rounded-lg px-2 py-2 transition hover:bg-mist-50 dark:hover:bg-white/[0.04]"
                  >
                    <BookOpen className="h-4 w-4 shrink-0 text-mist-400" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-graphite-800 dark:text-mist-200">{item.title}</span>
                      <span className="block text-[10px] text-mist-400">
                        {item.kind} · {item.chunk_count} chunks · {relativeTime(item.updated_at)}
                      </span>
                    </span>
                    {item.is_favorite ? <span className="text-amber-400">★</span> : null}
                  </Link>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-mist-200 px-4 py-6 text-center dark:border-white/10">
                <BookOpen className="mx-auto h-5 w-5 text-mist-400" />
                <p className="mt-2 text-xs font-medium text-mist-500">Your library is empty</p>
                <Button size="sm" variant="secondary" className="mt-3" onClick={() => navigate("/library?new=1")}>
                  Add the first item
                </Button>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-navy-800 bg-navy-950 p-5 text-mist-300">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-electric-300" />
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white">Honesty by design</p>
            </div>
            <p className="mt-2 text-[11px] leading-5 text-mist-400">
              No dashboard metric is hardcoded. No citation, Meet link or email is fabricated. When a provider is missing,
              the API returns a configuration error and this interface explains what to set.
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Badge tone="green" dot>{me?.capabilities.storage.mode ?? "local"} storage</Badge>
              <Badge tone="blue" dot>Scheduler {me?.capabilities ? "on" : "off"}</Badge>
              <Badge tone="violet" dot>Argon2 + CSRF</Badge>
            </div>
          </section>
        </div>
      </div>

      {data?.unread ? (
        <div className="flex flex-col items-start justify-between gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/[0.05] p-4 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2.5">
            <Bell className="h-4 w-4 text-amber-500" />
            <p className="text-sm text-amber-900 dark:text-amber-100">
              You have {data.unread} unread notification{data.unread === 1 ? "" : "s"}.
            </p>
          </div>
          <Link to="/scheduled" className="text-xs font-semibold text-amber-700 underline dark:text-amber-300">
            View automation runs
          </Link>
        </div>
      ) : null}

      <p className="flex items-center justify-center gap-2 text-[10px] text-mist-400">
        <CheckCircle2 className="h-3 w-3 text-emerald-500" />
        Signed in as {me?.user.email} · {me?.active_organization_id ? "organization scoped" : "no organization selected"}
      </p>
    </div>
  );
}
