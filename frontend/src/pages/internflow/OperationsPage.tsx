import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock,
  Database,
  HardDrive,
  Mail,
  RefreshCw,
  Search,
  ShieldCheck,
  Video,
  XCircle,
} from "lucide-react";
import { useAuth } from "@/app/AuthContext";
import { useApiQuery, useDebounce, useDocumentTitle } from "@/hooks/useApi";
import { internflowApi, settingsApi } from "@/services/api";
import type { ConfigStatus, EmailLog, InternFlowAuditEntry } from "@/types/api";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Input,
  Notice,
  PageHeader,
  SectionHeading,
  Select,
  Skeleton,
  StatCard,
  StatusBadge,
} from "@/components/ui/primitives";
import { Tabs } from "@/components/ui/overlays";
import { formatDateTime, relativeTime } from "@/lib/format";

const EMAIL_FILTERS = ["all", "demo", "sent", "failed", "queued"] as const;function channelState(value: unknown) {
  const row = (value ?? {}) as {
    configured?: boolean;
    mode?: string;
    note?: string;
    provider?: string;
    ffmpeg?: string | null;
  };
  return {
    configured: Boolean(row.configured),
    mode: row.mode ?? "unknown",
    note: row.note ?? "",
    provider: row.provider ?? row.ffmpeg ?? "",
  };
}

export function OperationsPage() {
  useDocumentTitle("InternFlow operations");
  const { me } = useAuth();
  const [tab, setTab] = useState("delivery");
  const [emailStatus, setEmailStatus] = useState<(typeof EMAIL_FILTERS)[number]>("all");
  const [auditQuery, setAuditQuery] = useState("");
  const debouncedAuditQuery = useDebounce(auditQuery, 250);

  const config = useApiQuery<ConfigStatus>(() => settingsApi.status(), [me?.active_organization_id]);
  const emails = useApiQuery<EmailLog[]>(
    () => internflowApi.emails(emailStatus === "all" ? undefined : emailStatus),
    [emailStatus, me?.active_organization_id],
  );
  const audit = useApiQuery<InternFlowAuditEntry[]>(() => internflowApi.audit(100), [
    me?.active_organization_id,
  ]);

  const emailRows = emails.data ?? [];
  const emailCounts = useMemo(() => {
    const counts: Record<string, number> = { all: emailRows.length, demo: 0, sent: 0, failed: 0, queued: 0 };
    for (const log of emailRows) counts[log.status] = (counts[log.status] ?? 0) + 1;
    return counts;
  }, [emailRows]);

  const auditRows = useMemo(() => {
    const rows = audit.data ?? [];
    const query = debouncedAuditQuery.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) => {
      const haystack = [
        row.action,
        row.entity_type,
        row.entity_id ?? "",
        row.actor_id ?? "",
        JSON.stringify(row.metadata ?? {}),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [audit.data, debouncedAuditQuery]);

  const email = channelState(config.data?.email);
  const calendar = channelState(config.data?.calendar);
  const video = channelState(config.data?.video);
  const storage = channelState(config.data?.storage);
  const emailConfigured = email.configured;

  const deliveryProblem = emailCounts.failed ?? 0;

  if (config.error && !config.data) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="InternFlow"
          title="Operations"
          description="Delivery records, workflow audit and integration readiness."
        />
        <ErrorState message={config.error} onRetry={() => void config.reload()} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="InternFlow"
        title="Operations console"
        description="Inspect what the workflow actually did: every email delivery attempt, every state-changing action, and the true status of connected channels."
        actions={
          <Button
            variant="secondary"
            icon={RefreshCw}
            onClick={() => {
              void config.reload(true);
              void emails.reload(true);
              void audit.reload(true);
            }}
          >
            Refresh
          </Button>
        }
      />

      {!emailConfigured ? (
        <Notice
          tone="warning"
          title="Email delivery is running in demo mode"
          action={
            <Link to="/settings?tab=integrations" className="text-xs font-semibold underline">
              Configure SMTP
            </Link>
          }
        >
          Messages are recorded with status <code>demo</code>. Nothing leaves this machine, and activation or reset
          links are returned only through the API for local testing.
        </Notice>
      ) : (
        <Notice tone="success" title="SMTP delivery is configured">
          Emails are attempted over {email.provider || "SMTP"}. Failed attempts stay in the log with their error so they
          can be retried or investigated.
        </Notice>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Recorded emails"
          value={emailCounts.all ?? 0}
          hint="All delivery attempts in this filter"
          icon={Mail}
          loading={emails.loading && !emails.data}
        />
        <StatCard
          label="Demo deliveries"
          value={emailCounts.demo ?? 0}
          hint="Stored locally, never sent"
          icon={Database}
          tone="violet"
          loading={emails.loading && !emails.data}
        />
        <StatCard
          label="Sent"
          value={emailCounts.sent ?? 0}
          hint="Accepted by SMTP"
          icon={CheckCircle2}
          tone="green"
          loading={emails.loading && !emails.data}
        />
        <StatCard
          label="Failed"
          value={deliveryProblem}
          hint="Delivery errors recorded"
          icon={AlertTriangle}
          tone={deliveryProblem ? "rose" : "blue"}
          loading={emails.loading && !emails.data}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: "Email",
            state: email,
            icon: Mail,
            to: "/settings?tab=integrations",
          },
          {
            label: "Calendar / Meet",
            state: calendar,
            icon: CalendarDays,
            to: "/settings?tab=integrations",
          },
          {
            label: "Storage",
            state: storage,
            icon: HardDrive,
            to: "/settings?tab=integrations",
          },
          {
            label: "Video processing",
            state: video,
            icon: Video,
            to: "/settings?tab=integrations",
          },
        ].map(({ label, state, icon: Icon, to }) => (
          <div key={label} className="app-surface p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-electric-500/10 text-electric-600 dark:text-electric-300">
                  <Icon className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-graphite-900 dark:text-mist-100">{label}</p>
                  <p className="text-[10px] uppercase tracking-[0.1em] text-mist-400">{state.mode}</p>
                </div>
              </div>
              <Badge tone={state.configured ? "green" : "amber"} dot>
                {state.configured ? "ready" : "unconfigured"}
              </Badge>
            </div>
            <p className="mt-2 line-clamp-2 text-[11px] leading-5 text-mist-500 dark:text-mist-400">
              {state.note || "No status note was reported."}
            </p>
            {!state.configured ? (
              <Link to={to} className="mt-1 inline-block text-[11px] font-semibold text-electric-600 dark:text-electric-300">
                Configuration details
              </Link>
            ) : null}
          </div>
        ))}
      </div>

      <Tabs
        items={[
          { id: "delivery", label: "Email delivery log", count: emailCounts.all ?? 0 },
          { id: "audit", label: "Workflow audit", count: audit.data?.length ?? 0 },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "delivery" ? (
        <section className="app-surface overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-mist-100 p-4 dark:border-white/[0.07] sm:flex-row sm:items-center sm:justify-between">
            <SectionHeading
              title="Delivery attempts"
              description="One row per message. Demo rows are deliberately not marked sent."
            />
            <Select
              aria-label="Filter email status"
              className="sm:max-w-[180px]"
              value={emailStatus}
              onChange={(event) => setEmailStatus(event.target.value as (typeof EMAIL_FILTERS)[number])}
            >
              {EMAIL_FILTERS.map((value) => (
                <option key={value} value={value}>
                  {value === "all" ? "All statuses" : value.charAt(0).toUpperCase() + value.slice(1)}
                </option>
              ))}
            </Select>
          </div>

          {emails.error && !emails.data ? (
            <div className="p-4">
              <ErrorState message={emails.error} onRetry={() => void emails.reload()} />
            </div>
          ) : emails.loading && !emails.data ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2, 3, 4].map((key) => (
                <Skeleton key={key} className="h-12 rounded-lg" />
              ))}
            </div>
          ) : emailRows.length ? (
            <div className="overflow-x-auto">
              <table className="table-base min-w-[860px]">
                <thead>
                  <tr>
                    <th>Recipient</th>
                    <th>Subject</th>
                    <th>Kind</th>
                    <th>Status</th>
                    <th>Provider</th>
                    <th>Created</th>
                    <th>Sent</th>
                  </tr>
                </thead>
                <tbody>
                  {emailRows.map((log) => (
                    <tr key={log.id}>
                      <td className="text-xs font-medium">{log.to_email}</td>
                      <td className="max-w-[300px]">
                        <p className="truncate text-xs">{log.subject}</p>
                        {log.error ? <p className="mt-0.5 truncate text-[10px] text-rose-500">{log.error}</p> : null}
                      </td>
                      <td className="text-xs capitalize">{log.kind.replace(/_/g, " ")}</td>
                      <td>
                        <StatusBadge status={log.status} />
                      </td>
                      <td className="text-xs">{log.provider}</td>
                      <td className="whitespace-nowrap text-xs text-mist-500">
                        {formatDateTime(log.created_at)}
                      </td>
                      <td className="whitespace-nowrap text-xs text-mist-500">
                        {log.sent_at ? (
                          <span title={formatDateTime(log.sent_at)}>{relativeTime(log.sent_at)}</span>
                        ) : (
                          <span className="text-mist-400">not sent</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-6">
              <EmptyState
                icon={Mail}
                title="No email records in this view"
                description="Onboarding invitations, assignment notices, correction requests and decisions create delivery rows. Demo mode records them without sending."
              />
            </div>
          )}
        </section>
      ) : null}

      {tab === "audit" ? (
        <section className="app-surface overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-mist-100 p-4 dark:border-white/[0.07] sm:flex-row sm:items-center sm:justify-between">
            <SectionHeading
              title="Workflow audit trail"
              description="State-changing InternFlow actions for the active organization, newest first."
            />
            <div className="relative sm:max-w-[280px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mist-400" />
              <Input
                aria-label="Search audit entries"
                className="pl-9"
                placeholder="Filter actions, entities, metadata…"
                value={auditQuery}
                onChange={(event) => setAuditQuery(event.target.value)}
              />
            </div>
          </div>

          {audit.error && !audit.data ? (
            <div className="p-4">
              <ErrorState message={audit.error} onRetry={() => void audit.reload()} />
            </div>
          ) : audit.loading && !audit.data ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2, 3, 4].map((key) => (
                <Skeleton key={key} className="h-14 rounded-lg" />
              ))}
            </div>
          ) : auditRows.length ? (
            <div className="divide-y divide-mist-100 dark:divide-white/[0.06]">
              {auditRows.map((row) => (
                <div key={row.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-mist-100 text-mist-500 dark:bg-white/[0.06] dark:text-mist-300">
                      <Activity className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-graphite-900 dark:text-mist-100">
                        {row.action.replace(/_/g, " ")}
                      </p>
                      <p className="mt-0.5 text-[11px] text-mist-500 dark:text-mist-400">
                        {row.entity_type}
                        {row.entity_id ? ` · ${row.entity_id.slice(0, 8)}` : ""}
                        {" · "}
                        actor {row.actor_id ? row.actor_id.slice(0, 8) : "system"}
                      </p>
                      {row.metadata && Object.keys(row.metadata).length ? (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-[0.1em] text-electric-600 dark:text-electric-300">
                            Metadata
                          </summary>
                          <pre className="mt-1 max-h-40 overflow-auto rounded-lg bg-mist-50 p-2 text-[10px] leading-5 text-mist-600 dark:bg-white/[0.03] dark:text-mist-400">
                            {JSON.stringify(row.metadata, null, 2)}
                          </pre>
                        </details>
                      ) : null}
                    </div>
                  </div>
                  <div className="shrink-0 pl-11 text-left sm:pl-0 sm:text-right">
                    <p className="text-[11px] text-mist-500 dark:text-mist-400">{formatDateTime(row.created_at)}</p>
                    <p className="text-[10px] text-mist-400">{relativeTime(row.created_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-6">
              <EmptyState
                icon={ShieldCheck}
                title={auditQuery ? "No matching audit entries" : "No audit entries yet"}
                description={
                  auditQuery
                    ? "Try a shorter search term. Filtering is applied to this browser's loaded page of 100 records."
                    : "Imports, assignment updates, submissions, evaluations, decisions and meeting changes are recorded here."
                }
              />
            </div>
          )}
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="app-surface p-4">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-electric-500" />
            <p className="text-sm font-semibold text-graphite-900 dark:text-mist-100">Retention</p>
          </div>
          <p className="mt-1 text-[11px] leading-5 text-mist-500 dark:text-mist-400">
            This view loads the latest 100 audit entries and the latest email records. Older rows remain in the
            database and are not deleted by the interface.
          </p>
        </div>
        <div className="app-surface p-4">
          <div className="flex items-center gap-2">
            <XCircle className="h-4 w-4 text-amber-500" />
            <p className="text-sm font-semibold text-graphite-900 dark:text-mist-100">No silent retries here</p>
          </div>
          <p className="mt-1 text-[11px] leading-5 text-mist-500 dark:text-mist-400">
            Failed SMTP attempts keep their error. There is no automatic resend UI; use the relevant intern action
            (such as resend invitation) to create a new attempt.
          </p>
        </div>
        <div className="app-surface p-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
            <p className="text-sm font-semibold text-graphite-900 dark:text-mist-100">Organization scoped</p>
          </div>
          <p className="mt-1 text-[11px] leading-5 text-mist-500 dark:text-mist-400">
            Delivery and audit rows are filtered to the active organization. Switching organizations reloads this
            console with that tenant's records only.
          </p>
        </div>
      </div>
    </div>
  );
}
