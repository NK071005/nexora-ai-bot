import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, MailCheck } from "lucide-react";
import { AuthCard, AuthLink, FormError } from "@/components/auth/AuthCard";
import { Button, Field, Input, Notice } from "@/components/ui/primitives";
import { ApiError, authApi } from "@/services/api";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [demoToken, setDemoToken] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSent(null);
    setDemoToken(null);
    try {
      const result = await authApi.forgot(email.trim());
      setSent(result.message);
      if (result.demo_token) setDemoToken(result.demo_token);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not request a reset link.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard
      badge="Account recovery"
      title="Reset your password"
      subtitle="Enter the email address on your account and we will generate a single-use reset link."
      footer={
        <span>
          Remembered it? <AuthLink to="/login">Back to sign in</AuthLink>
        </span>
      }
    >
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        <FormError message={error} />

        {sent ? (
          <Notice tone="success" title="Reset link generated">
            <p>{sent}</p>
          </Notice>
        ) : null}

        {demoToken ? (
          <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-3 text-xs text-amber-800 dark:text-amber-200">
            <p className="font-semibold">Demo mode · no email left this machine</p>
            <p className="mt-1 leading-5">
              SMTP is not configured, so the server returned the reset token directly. It is shown only outside
              production.
            </p>
            <Link
              to={`/reset-password?token=${encodeURIComponent(demoToken)}`}
              className="mt-2 inline-flex items-center gap-1.5 font-semibold underline decoration-amber-500/40 underline-offset-2"
            >
              <MailCheck className="h-3.5 w-3.5" /> Open reset page with this token
            </Link>
            <p className="mt-1.5 break-all font-mono text-[10px] opacity-70">{demoToken}</p>
          </div>
        ) : null}

        <Field label="Email address" htmlFor="email" required>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </Field>

        <Button type="submit" className="w-full" size="lg" loading={loading} iconRight={ArrowRight}>
          Generate reset link
        </Button>

        <p className="text-center text-[10px] leading-5 text-mist-400">
          Links expire after the configured window. Requesting a new link does not reveal whether the account exists.
        </p>
      </form>
    </AuthCard>
  );
}
