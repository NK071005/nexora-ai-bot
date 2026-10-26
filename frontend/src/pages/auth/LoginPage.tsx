import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, KeyRound, ShieldCheck, Sparkles } from "lucide-react";
import { useAuth } from "@/app/AuthContext";
import { useToast } from "@/app/ToastContext";
import { AuthCard, AuthLink, FormError } from "@/components/auth/AuthCard";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { Button, Field, Input, Badge } from "@/components/ui/primitives";
import { ApiError, api, authApi } from "@/services/api";
import type { MetaResponse } from "@/types/api";
import { useApiQuery } from "@/hooks/useApi";

const demoAccounts = [
  { label: "Super admin", email: "super@nexora.demo", password: "NexoraSuper!2026", note: "Cross-tenant view" },
  { label: "Org admin", email: "admin@nexora.demo", password: "NexoraDemo!2026", note: "InternFlow admin" },
  { label: "Intern", email: "intern@nexora.demo", password: "NexoraDemo!2026", note: "My work + submit" },
  { label: "Standard user", email: "priya@nexora.demo", password: "NexoraDemo!2026", note: "Chat + library" },
];

const googleMessages: Record<string, string> = {
  cancelled: "Google sign-in was cancelled.",
  invalid_state: "The Google sign-in request expired. Please try again.",
  not_configured: "Google sign-in is not configured on this server.",
  exchange_failed: "Google rejected the sign-in exchange. Check the OAuth credentials.",
  email_unverified: "That Google account does not have a verified email address.",
};

export function LoginPage() {
  const { login, me } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/";
  const params = new URLSearchParams(location.search);
  const googleError = params.get("google");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendNote, setResendNote] = useState<string | null>(null);
  const [needsVerification, setNeedsVerification] = useState(false);
  const { data: meta } = useApiQuery(() => api.get<MetaResponse>("/meta"), []);
  const googleConfigured = Boolean(
    (meta?.capabilities?.google_oauth as { configured?: boolean } | undefined)?.configured,
  );

  useEffect(() => {
    if (me) navigate(from, { replace: true });
  }, [me, from, navigate]);

  async function submit(event?: FormEvent, override?: { email: string; password: string }) {
    event?.preventDefault();
    setLoading(true);
    setError(null);
    setFieldErrors({});
    setNeedsVerification(false);
    setResendNote(null);
    try {
      const result = await login(override?.email ?? email, override?.password ?? password);
      toast.success("Welcome back", `${result.user.full_name.split(" ")[0]}, your workspace is ready.`);
      navigate(from, { replace: true });
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        setFieldErrors(caught.fieldErrors);
        if (caught.code === "email_not_verified") setNeedsVerification(true);
      } else {
        setError("Sign-in failed. Please retry.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function resend() {
    if (!email) {
      setError("Enter your email first so we know where to send the link.");
      return;
    }
    setResending(true);
    try {
      const result = await authApi.resendVerification(email);
      setResendNote(
        result.demo_token
          ? `Demo mode: no email left this machine. Use this link: /verify-email?token=${result.demo_token}`
          : result.message,
      );
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not resend verification.");
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="space-y-5">
      <AuthCard
        badge="Secure sign in"
        title="Welcome back"
        subtitle="Sign in to continue your conversations, research and InternFlow work."
        footer={
          <span>
            New to NEXORA? <AuthLink to="/register">Create a workspace</AuthLink>
          </span>
        }
      >
        <form className="space-y-4" onSubmit={(event) => void submit(event)}>
          {googleError ? <FormError message={googleMessages[googleError] ?? "Google sign-in failed."} /> : null}
          <FormError message={error} />

          <Field label="Email address" htmlFor="email" error={fieldErrors.email} required>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              invalid={Boolean(fieldErrors.email)}
              required
            />
          </Field>

          <Field label="Password" htmlFor="password" error={fieldErrors.password} required>
            <PasswordInput
              id="password"
              autoComplete="current-password"
              placeholder="Your password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              invalid={Boolean(fieldErrors.password)}
              required
            />
          </Field>

          <div className="flex items-center justify-between">
            <Link to="/forgot-password" className="text-xs font-semibold text-electric-600 hover:text-electric-500 dark:text-electric-300">
              Forgot password?
            </Link>
            <Link to="/verify-email" className="text-xs text-mist-500 hover:text-graphite-800 dark:text-mist-400 dark:hover:text-mist-200">
              Verify email
            </Link>
          </div>

          {needsVerification ? (
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-3 text-xs text-amber-800 dark:text-amber-200">
              <p>This account needs email verification before signing in.</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" variant="secondary" onClick={() => void resend()} loading={resending} icon={KeyRound}>
                  Resend verification
                </Button>
                {resendNote ? <span className="break-all text-[10px] leading-4">{resendNote}</span> : null}
              </div>
            </div>
          ) : null}

          <Button type="submit" className="w-full" size="lg" loading={loading} iconRight={ArrowRight}>
            Sign in
          </Button>
        </form>

        <div className="my-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-mist-200 dark:bg-white/10" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-mist-400">or</span>
          <div className="h-px flex-1 bg-mist-200 dark:bg-white/10" />
        </div>

        {googleConfigured ? (
          <a
            href="/api/auth/google/start"
            className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-mist-200 bg-white text-sm font-semibold text-graphite-800 transition hover:bg-mist-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-mist-100 dark:hover:bg-white/[0.07]"
          >
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white text-[10px] font-bold text-[#4285F4]">G</span>
            Continue with Google
          </a>
        ) : (
          <div className="rounded-xl border border-dashed border-mist-200 p-3 dark:border-white/10">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-mist-600 dark:text-mist-300">Continue with Google</span>
              <Badge tone="neutral">Not configured</Badge>
            </div>
            <p className="mt-1 text-[10px] leading-4 text-mist-500">
              Set <code className="rounded bg-mist-100 px-1 dark:bg-white/10">GOOGLE_CLIENT_ID</code> and{" "}
              <code className="rounded bg-mist-100 px-1 dark:bg-white/10">GOOGLE_CLIENT_SECRET</code> to enable it.
            </p>
          </div>
        )}
      </AuthCard>

      {meta?.demo_login ? (
        <div className="rounded-2xl border border-mist-200/80 bg-white/70 p-4 backdrop-blur dark:border-white/10 dark:bg-white/[0.03]">
          <div className="mb-2.5 flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-electric-500" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-mist-500">Demo workspace accounts</p>
            <Badge tone="amber" className="ml-auto">Seeded locally</Badge>
          </div>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {demoAccounts.map((account) => (
              <button
                key={account.email}
                type="button"
                onClick={() => {
                  setEmail(account.email);
                  setPassword(account.password);
                  void submit(undefined, account);
                }}
                className="group flex items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left transition hover:border-mist-200 hover:bg-white dark:hover:border-white/10 dark:hover:bg-white/[0.04]"
              >
                <ShieldCheck className="h-3.5 w-3.5 text-mist-400 group-hover:text-electric-500" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] font-semibold text-graphite-800 dark:text-mist-100">{account.label}</span>
                  <span className="block truncate text-[10px] text-mist-500">{account.email}</span>
                </span>
                <span className="text-[9px] text-mist-400">{account.note}</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-[10px] leading-4 text-mist-400">
            Demo credentials are only advertised when the backend allows demo login outside production.
          </p>
        </div>
      ) : null}
    </div>
  );
}
