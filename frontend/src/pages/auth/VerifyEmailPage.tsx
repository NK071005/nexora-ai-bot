import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, MailCheck, XCircle } from "lucide-react";
import { AuthCard, AuthLink, FormError } from "@/components/auth/AuthCard";
import { Button, Field, Input, Spinner } from "@/components/ui/primitives";
import { ApiError, authApi } from "@/services/api";

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [state, setState] = useState<"idle" | "verifying" | "verified" | "failed">(token ? "verifying" : "idle");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [resending, setResending] = useState(false);
  const [resendNote, setResendNote] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (!token || ran.current) return;
    ran.current = true;
    (async () => {
      try {
        const result = await authApi.verifyEmail(token);
        setMessage(result.message);
        setState("verified");
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : "This verification link could not be checked.");
        setState("failed");
      }
    })();
  }, [token]);

  async function resend(event: FormEvent) {
    event.preventDefault();
    if (!email.trim()) return;
    setResending(true);
    setResendNote(null);
    try {
      const result = await authApi.resendVerification(email.trim());
      setResendNote(
        result.demo_token
          ? `Demo mode: open /verify-email?token=${result.demo_token}`
          : result.message,
      );
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not resend the verification email.");
    } finally {
      setResending(false);
    }
  }

  if (state === "verifying") {
    return (
      <AuthCard badge="Email verification" title="Checking your link" subtitle="This usually takes a moment.">
        <div className="flex flex-col items-center py-6">
          <Spinner className="h-7 w-7" />
          <p className="mt-3 text-xs text-mist-500">Validating the single-use token…</p>
        </div>
      </AuthCard>
    );
  }

  if (state === "verified") {
    return (
      <AuthCard badge="Email verification" title="Email verified" subtitle="Your NEXORA account is ready.">
        <div className="flex flex-col items-center py-4 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
            <CheckCircle2 className="h-6 w-6" />
          </span>
          <p className="mt-3 text-sm font-semibold text-graphite-900 dark:text-white">{message ?? "Your email is confirmed."}</p>
          <Button className="mt-5" onClick={() => window.location.assign("/login")} icon={MailCheck}>
            Continue to sign in
          </Button>
          <p className="mt-2 text-[10px] text-mist-400">
            Verification is recorded on the server. Sign-in enforcement depends on server configuration.
          </p>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      badge="Email verification"
      title={state === "failed" ? "This link did not work" : "Verify your email"}
      subtitle={
        state === "failed"
          ? "The token may be expired, already used, or malformed. Request a fresh verification link."
          : "Open the verification link from your inbox, or request a new one below."
      }
      footer={
        <span>
          <AuthLink to="/login">Back to sign in</AuthLink>
        </span>
      }
    >
      {state === "failed" ? (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-rose-500/20 bg-rose-500/[0.06] p-3 text-rose-700 dark:text-rose-300">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="text-xs leading-5">{error}</p>
        </div>
      ) : null}

      <form className="space-y-4" onSubmit={(event) => void resend(event)}>
        <FormError message={error && state !== "failed" ? error : null} />
        <Field label="Email address" htmlFor="verify-email" hint="We only send a link if the account still needs verification.">
          <Input
            id="verify-email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </Field>
        <Button type="submit" className="w-full" variant="secondary" loading={resending} icon={MailCheck}>
          Resend verification link
        </Button>
        {resendNote ? (
          <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-3 text-[11px] leading-5 text-amber-800 dark:text-amber-200">
            {resendNote.startsWith("Demo mode:") ? (
              <>
                <p className="font-semibold">Demo mode · no email left this machine</p>
                <Link
                  to={resendNote.replace("Demo mode: open ", "")}
                  className="mt-1 block break-all font-mono underline decoration-amber-500/40 underline-offset-2"
                >
                  {resendNote.replace("Demo mode: open ", "")}
                </Link>
              </>
            ) : (
              <p>{resendNote}</p>
            )}
          </div>
        ) : null}
      </form>
    </AuthCard>
  );
}
