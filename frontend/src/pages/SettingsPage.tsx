import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  Clock,
  Eye,
  KeyRound,
  Laptop,
  Link2,
  Lock,
  LogOut,
  Mail,
  Monitor,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Trash2,
  UserRound,
  XCircle,
} from "lucide-react";
import { useAuth } from "@/app/AuthContext";
import { useTheme } from "@/app/ThemeContext";
import { useToast } from "@/app/ToastContext";
import { useApiQuery, useDocumentTitle } from "@/hooks/useApi";
import { ApiError, authApi, settingsApi } from "@/services/api";
import type { AuditLog, ConfigStatus, Integration, SessionInfo } from "@/types/api";
import {
  Badge,
  Button,
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
  Textarea,
} from "@/components/ui/primitives";
import { ConfirmDialog, Modal, Tabs } from "@/components/ui/overlays";
import { PasswordInput, PasswordStrength } from "@/components/auth/PasswordInput";
import { TIMEZONES } from "@/lib/constants";
import { formatDateTime, relativeTime } from "@/lib/format";
import { cn } from "@/lib/cn";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function valueText(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function statusTone(integration: Integration): "green" | "amber" | "violet" | "neutral" {
  if (integration.configured) return "green";
  if (integration.status === "demo") return "violet";
  return "amber";
}

const tabIds = ["profile", "security", "integrations", "organization", "audit"];

/* ------------------------------------------------------------------ */
/* Profile tab                                                         */
/* ------------------------------------------------------------------ */

function ProfileTab() {
  const { me, refresh, setMe } = useAuth();
  const { setTheme } = useTheme();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    full_name: "",
    headline: "",
    bio: "",
    timezone: "Asia/Kolkata",
    theme: "system",
  });

  useEffect(() => {
    if (!me) return;
    setForm({
      full_name: me.user.full_name,
      headline: me.profile.headline ?? "",
      bio: me.profile.bio ?? "",
      timezone: me.user.timezone,
      theme: me.user.theme,
    });
  }, [me]);

  async function save() {
    if (!form.full_name.trim()) {
      setError("Your name cannot be empty.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await authApi.updateProfile({
        full_name: form.full_name.trim(),
        headline: form.headline,
        bio: form.bio,
        timezone: form.timezone,
        theme: form.theme,
      });
      setMe(response);
      setTheme(form.theme as "light" | "dark" | "system");
      toast.success("Profile updated", "Timezone and theme are applied to your account.");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not update your profile.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <section className="app-surface p-5">
        <h2 className="font-display text-base font-semibold text-graphite-950 dark:text-white">Your profile</h2>
        <p className="mt-1 text-xs leading-5 text-mist-500 dark:text-mist-400">
          This information appears in the workspace and on activity records.
        </p>
        <div className="mt-4 space-y-4">
          {error ? <Notice tone="danger" title="Could not save">{error}</Notice> : null}
          <Field label="Full name" required htmlFor="profile-name">
            <Input
              id="profile-name"
              value={form.full_name}
              onChange={(event) => setForm((state) => ({ ...state, full_name: event.target.value }))}
              maxLength={200}
            />
          </Field>
          <Field label="Email" hint="Email is the sign-in identity and cannot be changed here." htmlFor="profile-email">
            <Input id="profile-email" value={me?.user.email ?? ""} disabled />
          </Field>
          <Field label="Headline" htmlFor="profile-headline">
            <Input
              id="profile-headline"
              value={form.headline}
              onChange={(event) => setForm((state) => ({ ...state, headline: event.target.value }))}
              placeholder="e.g. Research lead, Nexora Labs"
              maxLength={200}
            />
          </Field>
          <Field label="Bio" htmlFor="profile-bio">
            <Textarea
              id="profile-bio"
              rows={3}
              value={form.bio}
              onChange={(event) => setForm((state) => ({ ...state, bio: event.target.value }))}
              placeholder="What are you working on?"
              maxLength={2000}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Timezone" htmlFor="profile-tz">
              <Select
                id="profile-tz"
                value={form.timezone}
                onChange={(event) => setForm((state) => ({ ...state, timezone: event.target.value }))}
              >
                {TIMEZONES.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Theme" htmlFor="profile-theme">
              <Select
                id="profile-theme"
                value={form.theme}
                onChange={(event) => setForm((state) => ({ ...state, theme: event.target.value }))}
              >
                <option value="system">Follow system</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </Select>
            </Field>
          </div>
          <div className="flex justify-end">
            <Button onClick={() => void save()} loading={saving}>
              Save profile
            </Button>
          </div>
        </div>
      </section>

      <div className="space-y-5">
        <section className="app-surface p-5">
          <h2 className="font-display text-base font-semibold text-graphite-950 dark:text-white">Account</h2>
          <div className="mt-3 space-y-2.5 text-xs">
            <div className="flex items-center justify-between gap-3">
              <span className="text-mist-500">Verification</span>
              {me?.user.email_verified_at ? (
                <Badge tone="green" dot>Verified</Badge>
              ) : (
                <Badge tone="amber" dot>Not verified</Badge>
              )}
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-mist-500">Roles</span>
              <div className="flex flex-wrap justify-end gap-1">
                {me?.user.is_super_admin ? <Badge tone="rose">Super admin</Badge> : null}
                {me?.is_internflow_admin ? <Badge tone="blue">InternFlow admin</Badge> : null}
                {me?.is_intern ? <Badge tone="violet">Intern</Badge> : null}
                {!me?.user.is_super_admin && !me?.is_internflow_admin && !me?.is_intern ? (
                  <Badge tone="neutral">Member</Badge>
                ) : null}
              </div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-mist-500">Member since</span>
              <span className="text-graphite-800 dark:text-mist-200">{formatDateTime(me?.user.created_at)}</span>
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            icon={RefreshCw}
            className="mt-4"
            onClick={() => void refresh().then(() => toast.success("Account refreshed"))}
          >
            Refresh account state
          </Button>
        </section>

        <section className="app-surface p-5">
          <h2 className="font-display text-base font-semibold text-graphite-950 dark:text-white">Organizations</h2>
          <div className="mt-3 space-y-2">
            {me?.organizations.map((org) => (
              <div
                key={org.organization_id}
                className={cn(
                  "flex items-center gap-2.5 rounded-xl border p-2.5",
                  org.organization_id === me.active_organization_id
                    ? "border-electric-500/40 bg-electric-500/[0.04]"
                    : "border-mist-200 dark:border-white/10",
                )}
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-mist-100 text-mist-600 dark:bg-white/[0.06] dark:text-mist-300">
                  <Building2 className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-graphite-900 dark:text-mist-100">{org.organization_name}</p>
                  <p className="text-[10px] capitalize text-mist-400">{org.role} · {org.status}</p>
                </div>
                {org.organization_id === me.active_organization_id ? <Badge tone="blue">Active</Badge> : null}
              </div>
            ))}
            {!me?.organizations.length ? (
              <p className="text-xs text-mist-500">You are not a member of an organization yet.</p>
            ) : null}
          </div>
        </section>

        <section className="rounded-2xl border border-navy-800 bg-navy-950 p-5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-300" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white">Security posture</p>
          </div>
          <p className="mt-2 text-[11px] leading-5 text-mist-400">
            Passwords use Argon2. Sessions are opaque, hashed server-side and protected by HttpOnly cookies with CSRF
            double-submit tokens.
          </p>
        </section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Security tab                                                        */
/* ------------------------------------------------------------------ */

function SecurityTab() {
  const { me, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [passwords, setPasswords] = useState({ current: "", next: "", confirm: "" });
  const [changing, setChanging] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokeOthersOpen, setRevokeOthersOpen] = useState(false);
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [deactivatePassword, setDeactivatePassword] = useState("");
  const [deactivating, setDeactivating] = useState(false);

  async function loadSessions() {
    setLoadingSessions(true);
    setSessionsError(null);
    try {
      setSessions(await authApi.sessions());
    } catch (caught) {
      setSessionsError(caught instanceof ApiError ? caught.message : "Sessions could not be loaded.");
    } finally {
      setLoadingSessions(false);
    }
  }

  useEffect(() => {
    void loadSessions();
  }, []);

  async function changePassword() {
    if (!passwords.current || !passwords.next) {
      setPasswordError("Enter your current and new password.");
      return;
    }
    if (passwords.next !== passwords.confirm) {
      setPasswordError("The new passwords do not match.");
      return;
    }
    setChanging(true);
    setPasswordError(null);
    try {
      const response = await authApi.changePassword({
        current_password: passwords.current,
        new_password: passwords.next,
      });
      toast.success("Password changed", response.message);
      setPasswords({ current: "", next: "", confirm: "" });
      await loadSessions();
    } catch (caught) {
      setPasswordError(caught instanceof ApiError ? caught.message : "Could not change your password.");
    } finally {
      setChanging(false);
    }
  }

  async function revoke(id: string) {
    setRevoking(id);
    try {
      await authApi.revokeSession(id);
      toast.success("Session revoked");
      await loadSessions();
    } catch (caught) {
      toast.error("Could not revoke session", caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setRevoking(null);
    }
  }

  async function revokeOthers() {
    try {
      const response = await authApi.revokeOthers();
      toast.success("Other sessions signed out", response.message);
      setRevokeOthersOpen(false);
      await loadSessions();
    } catch (caught) {
      toast.error("Could not revoke sessions", caught instanceof ApiError ? caught.message : undefined);
    }
  }

  async function deactivate() {
    if (!deactivatePassword) return;
    setDeactivating(true);
    try {
      const response = await authApi.deactivate(deactivatePassword);
      toast.success("Account deactivated", response.message);
      await logout().catch(() => undefined);
      navigate("/login", { replace: true });
    } catch (caught) {
      toast.error("Could not deactivate account", caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setDeactivating(false);
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <div className="space-y-5">
        <section className="app-surface p-5">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-electric-500" />
            <h2 className="font-display text-base font-semibold text-graphite-950 dark:text-white">Change password</h2>
          </div>
          <p className="mt-1 text-xs leading-5 text-mist-500 dark:text-mist-400">
            Changing your password revokes every other session immediately.
          </p>
          <div className="mt-4 space-y-3.5">
            {passwordError ? <Notice tone="danger" title="Could not change password">{passwordError}</Notice> : null}
            <Field label="Current password" required htmlFor="current-password">
              <PasswordInput
                id="current-password"
                value={passwords.current}
                onChange={(event) => setPasswords((state) => ({ ...state, current: event.target.value }))}
                autoComplete="current-password"
              />
            </Field>
            <Field label="New password" required htmlFor="new-password">
              <PasswordInput
                id="new-password"
                value={passwords.next}
                onChange={(event) => setPasswords((state) => ({ ...state, next: event.target.value }))}
                autoComplete="new-password"
              />
              {passwords.next ? <PasswordStrength value={passwords.next} /> : null}
            </Field>
            <Field label="Confirm new password" required htmlFor="confirm-password">
              <PasswordInput
                id="confirm-password"
                value={passwords.confirm}
                onChange={(event) => setPasswords((state) => ({ ...state, confirm: event.target.value }))}
                autoComplete="new-password"
              />
            </Field>
            <div className="flex justify-end">
              <Button icon={Lock} onClick={() => void changePassword()} loading={changing}>
                Update password
              </Button>
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-rose-500/25 bg-rose-500/[0.03]">
          <div className="border-b border-rose-500/20 p-5">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-rose-500" />
              <h2 className="font-display text-base font-semibold text-rose-900 dark:text-rose-100">Deactivate account</h2>
            </div>
            <p className="mt-1 text-xs leading-5 text-rose-800/80 dark:text-rose-200/80">
              Your sessions are revoked and sign-in is disabled. Ask a super administrator to reactivate the account.
            </p>
          </div>
          <div className="p-5">
            <Button variant="danger" icon={XCircle} onClick={() => setDeactivateOpen(true)}>
              Deactivate my account
            </Button>
          </div>
        </section>
      </div>

      <section className="app-surface overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-mist-100 p-5 dark:border-white/[0.07]">
          <div>
            <h2 className="font-display text-base font-semibold text-graphite-950 dark:text-white">Active sessions</h2>
            <p className="mt-0.5 text-[11px] text-mist-500 dark:text-mist-400">Signed-in devices and their last activity.</p>
          </div>
          <Button variant="secondary" size="sm" icon={LogOut} onClick={() => setRevokeOthersOpen(true)}>
            Revoke others
          </Button>
        </div>
        {sessionsError ? (
          <div className="p-4">
            <ErrorState message={sessionsError} onRetry={() => void loadSessions()} />
          </div>
        ) : loadingSessions && !sessions ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : sessions?.length ? (
          <div className="divide-y divide-mist-100 dark:divide-white/[0.06]">
            {sessions.map((session) => {
              const agent = session.user_agent.toLowerCase();
              const DeviceIcon = /iphone|android|mobile/.test(agent)
                ? Smartphone
                : /ipad|tablet/.test(agent)
                  ? Monitor
                  : Laptop;
              return (
                <div key={session.id} className="flex items-start gap-3 p-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-mist-100 text-mist-500 dark:bg-white/[0.06] dark:text-mist-300">
                    <DeviceIcon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-xs font-semibold text-graphite-900 dark:text-mist-100">
                        {session.user_agent ? session.user_agent.slice(0, 58) : "Unknown browser"}
                      </p>
                      {session.current ? <Badge tone="green">This device</Badge> : null}
                    </div>
                    <p className="mt-1 text-[10px] text-mist-400">
                      {session.ip_address || "IP unavailable"} · seen {relativeTime(session.last_seen_at)}
                    </p>
                    <p className="text-[10px] text-mist-400">Expires {formatDateTime(session.expires_at)}</p>
                  </div>
                  {!session.current ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={LogOut}
                      loading={revoking === session.id}
                      onClick={() => void revoke(session.id)}
                    >
                      Revoke
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-5">
            <EmptyState icon={Laptop} title="No active sessions" description="Sign in again to create a session." />
          </div>
        )}
      </section>

      <ConfirmDialog
        open={revokeOthersOpen}
        onClose={() => setRevokeOthersOpen(false)}
        onConfirm={() => void revokeOthers()}
        title="Sign out other devices?"
        description="Every other session is revoked. This device stays signed in."
        confirmLabel="Revoke other sessions"
      />

      <Modal
        open={deactivateOpen}
        onClose={() => setDeactivateOpen(false)}
        title="Deactivate your account"
        description="This immediately revokes all sessions and blocks sign-in."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeactivateOpen(false)} disabled={deactivating}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => void deactivate()}
              loading={deactivating}
              disabled={!deactivatePassword}
            >
              Deactivate account
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Notice tone="danger" title="This is not reversible from your side">
            <p>Only a super administrator can reactivate the account.</p>
          </Notice>
          <Field label="Confirm your password" required htmlFor="deactivate-password">
            <PasswordInput
              id="deactivate-password"
              value={deactivatePassword}
              onChange={(event) => setDeactivatePassword(event.target.value)}
              autoComplete="current-password"
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Integrations tab                                                    */
/* ------------------------------------------------------------------ */

function IntegrationsTab() {
  const { me } = useAuth();
  const status = useApiQuery<ConfigStatus>(() => settingsApi.status(), [me?.active_organization_id]);
  const integrations = useApiQuery<Integration[]>(() => settingsApi.integrations(), [me?.active_organization_id]);

  const sections = useMemo(() => {
    if (!status.data) return [];
    return [
      { key: "AI provider", source: status.data.ai, icon: ShieldCheck },
      { key: "Web search", source: status.data.search, icon: Link2 },
      { key: "Email delivery", source: status.data.email, icon: Mail },
      { key: "Calendar / Meet", source: status.data.calendar, icon: Clock },
      { key: "Google sign-in", source: status.data.google_oauth, icon: UserRound },
      { key: "Storage", source: status.data.storage, icon: ShieldCheck },
      { key: "Scheduler", source: status.data.scheduler, icon: Clock },
      { key: "Video processing", source: status.data.video, icon: Monitor },
    ];
  }, [status.data]);

  if (status.loading && !status.data) {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Notice tone="info" title="Configuration is read from the running server">
        <p>
          Nothing on this page is simulated. A feature marked unconfigured will return an explicit error until the
          corresponding environment variables are set and the API is restarted.
        </p>
      </Notice>

      {status.error ? <ErrorState message={status.error} onRetry={() => void status.reload()} /> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {sections.map((section) => (
          <section key={section.key} className="app-surface p-4">
            <div className="flex items-center gap-2">
              <section.icon className="h-4 w-4 text-electric-500" />
              <h2 className="text-xs font-semibold uppercase tracking-[0.1em] text-mist-500">{section.key}</h2>
            </div>
            <div className="mt-3 space-y-1.5">
              {Object.entries(section.source).map(([key, value]) => (
                <div key={key} className="flex items-start justify-between gap-3 text-[11px]">
                  <span className="capitalize text-mist-400">{key.replace(/_/g, " ")}</span>
                  <span className="max-w-[68%] break-words text-right text-mist-600 dark:text-mist-300">
                    {valueText(value)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <section className="app-surface overflow-hidden">
        <div className="border-b border-mist-100 p-5 dark:border-white/[0.07]">
          <h2 className="font-display text-base font-semibold text-graphite-950 dark:text-white">Integration matrix</h2>
          <p className="mt-0.5 text-xs text-mist-500 dark:text-mist-400">
            Exactly what is live, what is demo, and which environment variables each adapter needs.
          </p>
        </div>
        {integrations.loading && !integrations.data ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        ) : integrations.data?.length ? (
          <div className="divide-y divide-mist-100 dark:divide-white/[0.06]">
            {integrations.data.map((integration) => (
              <div key={integration.provider} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-sm font-semibold text-graphite-900 dark:text-mist-100">{integration.label}</p>
                      <Badge tone="neutral">{integration.category}</Badge>
                      <Badge tone={statusTone(integration)} dot>
                        {integration.configured ? "configured" : integration.status === "demo" ? "demo" : "not connected"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-mist-500 dark:text-mist-400">{integration.note}</p>
                    {integration.required_env.length ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {integration.required_env.map((variable) => (
                          <code
                            key={variable}
                            className="rounded bg-mist-100 px-1.5 py-0.5 text-[9px] text-mist-600 dark:bg-white/[0.06] dark:text-mist-300"
                          >
                            {variable}
                          </code>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="text-right text-[10px] text-mist-400">
                    <p>mode: {integration.mode}</p>
                    {integration.connected_at ? <p>connected {formatDateTime(integration.connected_at)}</p> : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-5">
            <EmptyState icon={Link2} title="No integration records" description="The API returned an empty integration matrix." />
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-navy-800 bg-navy-950 p-5">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-300" />
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white">Honest fallbacks</p>
        </div>
        <div className="mt-3 grid gap-3 text-[11px] leading-5 text-mist-400 sm:grid-cols-2">
          <p>· Email without SMTP is recorded in the delivery log with a visible demo status; it is never sent.</p>
          <p>· Meetings without Google Calendar have no invented Meet URL. A real .ics file can still be downloaded.</p>
          <p>· Web search without a provider returns “not configured” rather than fabricated sources.</p>
          <p>· Video without FFmpeg returns a 409 error and explains how to enable processing.</p>
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Organization tab                                                    */
/* ------------------------------------------------------------------ */

function OrganizationTab() {
  const { me, isAdmin, activeMembership, refresh } = useAuth();
  const toast = useToast();
  const organization = useApiQuery(() => settingsApi.organization(), [me?.active_organization_id]);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (organization.data) setName(organization.data.name);
  }, [organization.data]);

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await settingsApi.updateOrganization({ name: name.trim() });
      toast.success("Organization updated");
      await organization.reload(true);
      await refresh();
    } catch (caught) {
      toast.error("Could not update organization", caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  if (organization.loading && !organization.data) {
    return <Skeleton className="h-64" />;
  }
  if (organization.error && !organization.data) {
    return <ErrorState message={organization.error} onRetry={() => void organization.reload()} />;
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <section className="app-surface p-5">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-electric-500" />
          <h2 className="font-display text-base font-semibold text-graphite-950 dark:text-white">Organization</h2>
        </div>
        <p className="mt-1 text-xs leading-5 text-mist-500 dark:text-mist-400">
          Your active membership determines which records and InternFlow data this workspace can see.
        </p>
        <div className="mt-4 space-y-4">
          <Field label="Organization name" required htmlFor="org-name">
            <Input
              id="org-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={!isAdmin}
              maxLength={200}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="app-panel p-3">
              <p className="text-[9px] uppercase tracking-[0.1em] text-mist-400">Slug</p>
              <p className="mt-1 text-xs text-graphite-800 dark:text-mist-200">{organization.data?.slug}</p>
            </div>
            <div className="app-panel p-3">
              <p className="text-[9px] uppercase tracking-[0.1em] text-mist-400">Kind</p>
              <p className="mt-1 text-xs capitalize text-graphite-800 dark:text-mist-200">{organization.data?.kind}</p>
            </div>
            <div className="app-panel p-3">
              <p className="text-[9px] uppercase tracking-[0.1em] text-mist-400">Your role</p>
              <p className="mt-1 text-xs capitalize text-graphite-800 dark:text-mist-200">{activeMembership?.role ?? "—"}</p>
            </div>
            <div className="app-panel p-3">
              <p className="text-[9px] uppercase tracking-[0.1em] text-mist-400">Created</p>
              <p className="mt-1 text-xs text-graphite-800 dark:text-mist-200">{formatDateTime(organization.data?.created_at)}</p>
            </div>
          </div>
          {isAdmin ? (
            <div className="flex justify-end">
              <Button onClick={() => void save()} loading={saving} disabled={!name.trim()}>
                Save organization
              </Button>
            </div>
          ) : (
            <Notice tone="info" title="Read-only for your role">
              <p>Only an organization owner or administrator can change these settings.</p>
            </Notice>
          )}
        </div>
      </section>

      <section className="app-surface p-5">
        <h2 className="font-display text-base font-semibold text-graphite-950 dark:text-white">Stored settings</h2>
        <p className="mt-1 text-xs leading-5 text-mist-500 dark:text-mist-400">
          Organization-level configuration written by the API.
        </p>
        <div className="mt-3 space-y-1.5">
          {Object.entries(organization.data?.settings ?? {}).length ? (
            Object.entries(organization.data?.settings ?? {}).map(([key, value]) => (
              <div key={key} className="flex items-start justify-between gap-3 rounded-lg bg-mist-50 px-2.5 py-2 text-[11px] dark:bg-white/[0.03]">
                <span className="text-mist-500">{key.replace(/_/g, " ")}</span>
                <span className="break-words text-right text-graphite-800 dark:text-mist-200">{valueText(value)}</span>
              </div>
            ))
          ) : (
            <p className="text-xs text-mist-400">No custom settings recorded.</p>
          )}
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Audit tab                                                           */
/* ------------------------------------------------------------------ */

function AuditTab() {
  const { me, isAdmin } = useAuth();
  const [limit, setLimit] = useState(50);
  const logs = useApiQuery<AuditLog[]>(
    () => (isAdmin ? settingsApi.audit(limit, 0) : Promise.resolve([])),
    [isAdmin, limit, me?.active_organization_id],
  );

  if (!isAdmin) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="Audit log is restricted"
        description="Organization owners and administrators can review audit entries. Ask an admin if you need access."
      />
    );
  }

  if (logs.loading && !logs.data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
    );
  }
  if (logs.error && !logs.data) {
    return <ErrorState message={logs.error} onRetry={() => void logs.reload()} />;
  }

  return (
    <section className="app-surface overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-mist-100 p-5 dark:border-white/[0.07]">
        <div>
          <h2 className="font-display text-base font-semibold text-graphite-950 dark:text-white">Audit log</h2>
          <p className="mt-0.5 text-xs text-mist-500 dark:text-mist-400">Actions recorded for this organization, newest first.</p>
        </div>
        <Select value={String(limit)} onChange={(event) => setLimit(Number(event.target.value))} className="h-9 w-[130px] text-xs">
          <option value="25">Last 25</option>
          <option value="50">Last 50</option>
          <option value="100">Last 100</option>
        </Select>
      </div>
      {logs.data?.length ? (
        <div className="divide-y divide-mist-100 dark:divide-white/[0.06]">
          {logs.data.map((log) => (
            <div key={log.id} className="flex items-start gap-3 p-4">
              <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-electric-500/10 text-electric-600 dark:text-electric-300">
                <Clock className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="text-xs font-semibold text-graphite-900 dark:text-mist-100">
                    {log.action.replace(/_/g, " ")}
                  </p>
                  <Badge tone="neutral">{log.entity_type}</Badge>
                </div>
                <p className="mt-0.5 text-[10px] text-mist-400">
                  {formatDateTime(log.created_at)} · {relativeTime(log.created_at)} · actor {log.actor_id?.slice(0, 8) ?? "system"}
                </p>
                {Object.keys(log.metadata_json ?? {}).length ? (
                  <p className="mt-1 break-words font-mono text-[10px] leading-4 text-mist-400">
                    {JSON.stringify(log.metadata_json)}
                  </p>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="p-5">
          <EmptyState icon={Clock} title="No audit entries" description="Actions in this organization will appear here." />
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function SettingsPage() {
  useDocumentTitle("Settings");
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab") ?? "profile";
  const tab = tabIds.includes(tabParam) ? tabParam : "profile";
  const { isAdmin, isSuperAdmin } = useAuth();

  const tabs = [
    { id: "profile", label: "Profile", icon: UserRound },
    { id: "security", label: "Security", icon: Lock },
    { id: "integrations", label: "Integrations", icon: Link2 },
    { id: "organization", label: "Organization", icon: Building2 },
    ...(isAdmin || isSuperAdmin ? [{ id: "audit", label: "Audit log", icon: Eye }] : []),
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Workspace"
        title="Settings"
        description="Profile, security, integrations and organization configuration. Every state shown here comes from the running API."
      />

      <Tabs
        items={tabs}
        value={tab}
        onChange={(id) => {
          const next = new URLSearchParams(searchParams);
          next.set("tab", id);
          setSearchParams(next, { replace: true });
        }}
      />

      <div className="pt-1">
        {tab === "profile" ? <ProfileTab /> : null}
        {tab === "security" ? <SecurityTab /> : null}
        {tab === "integrations" ? <IntegrationsTab /> : null}
        {tab === "organization" ? <OrganizationTab /> : null}
        {tab === "audit" ? <AuditTab /> : null}
      </div>
    </div>
  );
}
