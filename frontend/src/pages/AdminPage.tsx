import { useMemo, useState } from "react";
import {
  Building2,
  CalendarClock,
  CheckCircle2,
  MessageSquare,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  UserCheck,
  UserX,
  Users,
} from "lucide-react";
import { useAuth } from "@/app/AuthContext";
import { useToast } from "@/app/ToastContext";
import { useApiQuery, useDebounce, useDocumentTitle } from "@/hooks/useApi";
import { adminApi } from "@/services/api";
import type { AdminOrganization, AdminOverview, AdminUser } from "@/types/api";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Input,
  Notice,
  PageHeader,
  SectionHeading,
  Skeleton,
  StatCard,
  StatusBadge,
} from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/overlays";
import { formatDate, formatDateTime, relativeTime } from "@/lib/format";

export function AdminPage() {
  useDocumentTitle("Super admin");
  const { me, refresh } = useAuth();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [target, setTarget] = useState<AdminUser | null>(null);
  const [busy, setBusy] = useState(false);

  const overview = useApiQuery<AdminOverview>(() => adminApi.overview(), [me?.active_organization_id]);
  const organizations = useApiQuery<AdminOrganization[]>(() => adminApi.organizations(), [
    me?.active_organization_id,
  ]);
  const users = useApiQuery<AdminUser[]>(() => adminApi.users(debouncedSearch || undefined), [
    debouncedSearch,
    me?.active_organization_id,
  ]);

  const orgRows = organizations.data ?? [];
  const userRows = users.data ?? [];
  const internsPerOrg = useMemo(() => {
    const map: Record<string, number> = {};
    for (const org of orgRows) map[org.id] = org.interns;
    return map;
  }, [orgRows]);

  async function toggleUser() {
    if (!target) return;
    setBusy(true);
    try {
      const response = await adminApi.toggleUser(target.id);
      toast.success(response.message, `${target.email} is now ${response.is_active ? "active" : "deactivated"}.`);
      setTarget(null);
      await users.reload(true);
      await overview.reload(true);
      if (target.id === me?.user.id) await refresh();
    } catch (caught) {
      toast.error(
        "Account state was not changed",
        caught instanceof Error ? caught.message : undefined,
      );
    } finally {
      setBusy(false);
    }
  }

  if (overview.error && !overview.data) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="NEXORA platform"
          title="Super administration"
          description="Cross-organization overview restricted to platform super administrators."
        />
        <ErrorState message={overview.error} onRetry={() => void overview.reload()} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="NEXORA platform"
        title="Super administration"
        description="Cross-organization counts and account controls. This area is visible only to platform super administrators; organization data stays isolated everywhere else."
        actions={
          <Button
            variant="secondary"
            icon={RefreshCw}
            onClick={() => {
              void overview.reload(true);
              void organizations.reload(true);
              void users.reload(true);
            }}
          >
            Refresh
          </Button>
        }
      />

      <Notice tone="warning" title="You are operating across tenants">
        These records span every organization. Actions here change platform-level account state. Organization-level
        content remains scoped to its tenant and is not exposed in this view.
      </Notice>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <StatCard
          label="Organizations"
          value={overview.data?.organizations ?? "—"}
          hint="All tenants"
          icon={Building2}
          loading={overview.loading && !overview.data}
        />
        <StatCard
          label="Users"
          value={overview.data?.users ?? "—"}
          hint={`${overview.data?.active_users ?? 0} active`}
          icon={Users}
          tone="violet"
          loading={overview.loading && !overview.data}
        />
        <StatCard
          label="Interns"
          value={overview.data?.interns ?? "—"}
          hint="Across all programmes"
          icon={UserCheck}
          tone="green"
          loading={overview.loading && !overview.data}
        />
        <StatCard
          label="Chats"
          value={overview.data?.chats ?? "—"}
          hint="Live conversations"
          icon={MessageSquare}
          loading={overview.loading && !overview.data}
        />
        <StatCard
          label="Scheduled tasks"
          value={overview.data?.scheduled_tasks ?? "—"}
          hint="Automations not deleted"
          icon={CalendarClock}
          tone="amber"
          loading={overview.loading && !overview.data}
        />
        <StatCard
          label="Your account"
          value={me?.user.is_super_admin ? "Super admin" : "—"}
          hint={overview.data?.you.email ?? me?.user.email}
          icon={ShieldCheck}
          tone="green"
          loading={overview.loading && !overview.data}
        />
      </div>

      <section className="app-surface overflow-hidden">
        <div className="border-b border-mist-100 p-5 dark:border-white/[0.07]">
          <SectionHeading
            title="Organizations"
            description="Tenant names, plan kinds and current membership counts. Organization creation is handled through onboarding or provisioning, not this read-only table."
          />
        </div>
        {organizations.error && !organizations.data ? (
          <div className="p-4">
            <ErrorState message={organizations.error} onRetry={() => void organizations.reload()} />
          </div>
        ) : organizations.loading && !organizations.data ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((key) => <Skeleton key={key} className="h-14 rounded-lg" />)}
          </div>
        ) : orgRows.length ? (
          <div className="overflow-x-auto">
            <table className="table-base min-w-[760px]">
              <thead>
                <tr>
                  <th>Organization</th>
                  <th>Kind</th>
                  <th>Members</th>
                  <th>Interns</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {orgRows.map((organization) => (
                  <tr key={organization.id}>
                    <td>
                      <p className="text-sm font-semibold text-graphite-900 dark:text-mist-100">{organization.name}</p>
                      <p className="text-[10px] text-mist-400">
                        {organization.slug} · {organization.id.slice(0, 8)}
                      </p>
                    </td>
                    <td>
                      <Badge tone={organization.kind === "demo" ? "violet" : "blue"}>
                        {organization.kind || "standard"}
                      </Badge>
                    </td>
                    <td className="text-xs tabular-nums">{organization.members}</td>
                    <td className="text-xs tabular-nums">
                      {internsPerOrg[organization.id] ?? organization.interns}
                    </td>
                    <td className="text-xs text-mist-500">{formatDate(organization.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-6">
            <EmptyState
              icon={Building2}
              title="No organizations"
              description="Organizations appear here after registration or provisioning."
            />
          </div>
        )}
      </section>

      <section className="app-surface overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-mist-100 p-5 dark:border-white/[0.07] sm:flex-row sm:items-end sm:justify-between">
          <SectionHeading
            title="Accounts"
            description="Search by name or email. Deactivating an account revokes its access without deleting records."
          />
          <div className="relative w-full sm:max-w-[300px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mist-400" />
            <Input
              aria-label="Search users"
              className="pl-9"
              placeholder="Search name or email…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>

        {users.error && !users.data ? (
          <div className="p-4">
            <ErrorState message={users.error} onRetry={() => void users.reload()} />
          </div>
        ) : users.loading && !users.data ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3, 4].map((key) => <Skeleton key={key} className="h-16 rounded-lg" />)}
          </div>
        ) : userRows.length ? (
          <div className="divide-y divide-mist-100 dark:divide-white/[0.06]">
            {userRows.map((user) => {
              const self = user.id === me?.user.id;
              return (
                <div key={user.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold text-graphite-900 dark:text-mist-100">
                        {user.full_name}
                      </p>
                      {user.is_super_admin ? <Badge tone="violet">super admin</Badge> : null}
                      {self ? <Badge tone="blue">you</Badge> : null}
                      <StatusBadge status={user.is_active ? "active" : "deactivated"} />
                      {!user.email_verified ? <Badge tone="amber">email unverified</Badge> : null}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-mist-500 dark:text-mist-400">{user.email}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {user.organizations.length ? (
                        user.organizations.map((organization) => (
                          <span
                            key={organization.id}
                            className="rounded-md bg-mist-100 px-1.5 py-0.5 text-[10px] text-mist-600 dark:bg-white/[0.06] dark:text-mist-300"
                          >
                            {organization.name} · {organization.role}
                            {organization.status !== "active" ? ` · ${organization.status}` : ""}
                          </span>
                        ))
                      ) : (
                        <span className="text-[10px] text-mist-400">No organization membership</span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-4">
                    <div className="text-right">
                      <p className="text-[11px] text-mist-500 dark:text-mist-400">
                        {user.last_login_at ? `Last login ${relativeTime(user.last_login_at)}` : "Never signed in"}
                      </p>
                      <p className="text-[10px] text-mist-400">
                        {user.last_login_at ? formatDateTime(user.last_login_at) : "No session history"}
                      </p>
                    </div>
                    <Button
                      variant={user.is_active ? "secondary" : "soft"}
                      size="sm"
                      icon={user.is_active ? UserX : UserCheck}
                      disabled={self}
                      onClick={() => setTarget(user)}
                    >
                      {user.is_active ? "Deactivate" : "Reactivate"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-6">
            <EmptyState
              icon={Users}
              title={debouncedSearch ? "No matching accounts" : "No accounts"}
              description={
                debouncedSearch
                  ? "Try a different name or email fragment. Results are limited to the most recent 50 matching accounts."
                  : "Registered accounts appear here."
              }
            />
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="app-surface p-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
            <p className="text-sm font-semibold text-graphite-900 dark:text-mist-100">Strict role separation</p>
          </div>
          <p className="mt-1 text-[11px] leading-5 text-mist-500 dark:text-mist-400">
            Super administration only controls platform-level account access. Organization admins manage their own
            interns, templates and evaluations.
          </p>
        </div>
        <div className="app-surface p-4">
          <div className="flex items-center gap-2">
            <UserX className="h-4 w-4 text-amber-500" />
            <p className="text-sm font-semibold text-graphite-900 dark:text-mist-100">Reversible deactivation</p>
          </div>
          <p className="mt-1 text-[11px] leading-5 text-mist-500 dark:text-mist-400">
            Deactivation blocks sign-in and revokes active access checks. It does not delete chats, files, intern
            records or evaluations.
          </p>
        </div>
        <div className="app-surface p-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-electric-500" />
            <p className="text-sm font-semibold text-graphite-900 dark:text-mist-100">Honest counts</p>
          </div>
          <p className="mt-1 text-[11px] leading-5 text-mist-500 dark:text-mist-400">
            Every number in this page is queried live from the database. Nothing is seeded into the interface.
          </p>
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(target)}
        onClose={() => setTarget(null)}
        onConfirm={() => void toggleUser()}
        title={target?.is_active ? "Deactivate account" : "Reactivate account"}
        description={
          target
            ? target.is_active
              ? `${target.email} will lose access immediately. Existing records remain intact and the account can be reactivated later.`
              : `${target.email} will be able to sign in again. Their previous organization roles and data are unchanged.`
            : ""
        }
        confirmLabel={target?.is_active ? "Deactivate account" : "Reactivate account"}
        tone={target?.is_active ? "danger" : "primary"}
        loading={busy}
      />

      <p className="flex items-center justify-center gap-2 text-[10px] text-mist-400">
        <CheckCircle2 className="h-3 w-3 text-emerald-500" />
        {overview.data
          ? `${overview.data.organizations} organizations · ${overview.data.users} accounts · live platform totals`
          : "Loading platform totals"}
      </p>
    </div>
  );
}
