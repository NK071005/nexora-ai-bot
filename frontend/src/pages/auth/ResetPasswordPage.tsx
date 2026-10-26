import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle2, KeyRound } from "lucide-react";
import { AuthCard, AuthLink, FormError } from "@/components/auth/AuthCard";
import { PasswordInput, PasswordStrength } from "@/components/auth/PasswordInput";
import { Button, Field, Notice } from "@/components/ui/primitives";
import { ApiError, authApi } from "@/services/api";

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!token) {
      setError("This page needs a reset token. Open the link from your email or request a new one.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await authApi.reset(token, password);
      setDone(true);
      window.setTimeout(() => navigate("/login", { replace: true }), 1600);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not reset your password.");
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <AuthCard
        badge="Account recovery"
        title="This reset link is incomplete"
        subtitle="A valid reset token is required before choosing a new password."
        footer={
          <span>
            <AuthLink to="/forgot-password">Request a new reset link</AuthLink>
          </span>
        }
      >
        <Notice tone="warning" title="No token in the URL">
          <p>
            Open the exact link from the reset email. In demo mode the token is displayed on the previous page
            after you request a reset.
          </p>
        </Notice>
        <Link
          to="/forgot-password"
          className="mt-4 flex h-10 items-center justify-center rounded-xl bg-electric-600 text-sm font-semibold text-white hover:bg-electric-500"
        >
          Request a reset link
        </Link>
      </AuthCard>
    );
  }

  if (done) {
    return (
      <AuthCard badge="Account recovery" title="Password updated" subtitle="Your old sessions were revoked for safety.">
        <div className="flex flex-col items-center py-4 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
            <CheckCircle2 className="h-6 w-6" />
          </span>
          <p className="mt-3 text-sm font-semibold text-graphite-900 dark:text-white">You can sign in with the new password.</p>
          <p className="mt-1 text-xs text-mist-500">Taking you to the sign-in screen…</p>
          <Button className="mt-5" onClick={() => navigate("/login")} icon={KeyRound}>
            Go to sign in
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      badge="Account recovery"
      title="Choose a new password"
      subtitle="The reset token is single-use. All existing sessions are revoked when it succeeds."
      footer={
        <span>
          <AuthLink to="/login">Cancel and return to sign in</AuthLink>
        </span>
      }
    >
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        <FormError message={error} />
        <Field label="New password" htmlFor="password" required>
          <PasswordInput
            id="password"
            autoComplete="new-password"
            placeholder="At least 10 characters"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={10}
          />
        </Field>
        <Field label="Confirm new password" htmlFor="confirm" required>
          <PasswordInput
            id="confirm"
            autoComplete="new-password"
            placeholder="Repeat password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            required
            minLength={10}
          />
        </Field>
        <PasswordStrength value={password} />
        <Button type="submit" className="w-full" size="lg" loading={loading} icon={KeyRound}>
          Update password
        </Button>
      </form>
    </AuthCard>
  );
}
