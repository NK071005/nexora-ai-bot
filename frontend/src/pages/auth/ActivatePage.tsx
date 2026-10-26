import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { AuthCard, AuthLink } from "@/components/auth/AuthCard";
import { PasswordInput, PasswordStrength } from "@/components/auth/PasswordInput";
import { Button, Field, Input, Notice } from "@/components/ui/primitives";
import { ApiError, authApi } from "@/services/api";

export function ActivatePage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activated, setActivated] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!token) {
      setError("This activation page needs a token. Open the link from your invitation email.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await authApi.activate(token, password, fullName.trim() || undefined);
      setActivated(true);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not activate this account.");
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <AuthCard
        badge="InternFlow invite"
        title="Invitation link required"
        subtitle="Activation links are single-use and expire. Ask your InternFlow administrator to resend one."
        footer={
          <span>
            <AuthLink to="/login">Back to sign in</AuthLink>
          </span>
        }
      >
        <Notice tone="warning" title="No activation token found">
          <p>Open the complete invitation link. Administrators can resend an invite from the intern profile.</p>
        </Notice>
      </AuthCard>
    );
  }

  if (activated) {
    return (
      <AuthCard badge="InternFlow invite" title="Account activated" subtitle="Set a password succeeded. You can sign in now.">
        <div className="flex flex-col items-center py-4 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
            <CheckCircle2 className="h-6 w-6" />
          </span>
          <p className="mt-3 text-sm font-semibold text-graphite-900 dark:text-white">Your intern workspace is ready.</p>
          <p className="mt-1 max-w-sm text-xs leading-5 text-mist-500">
            Sign in to see your assignments, submit work, read evaluation feedback and join meetings.
          </p>
          <Button className="mt-5" onClick={() => navigate("/login")} icon={ShieldCheck}>
            Sign in
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      badge="InternFlow invite"
      title="Activate your intern account"
      subtitle="Choose the password you will use for NEXORA. This link can only be used once."
      footer={
        <span>
          Already activated? <AuthLink to="/login">Sign in</AuthLink>
        </span>
      }
    >
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        {error ? (
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/[0.06] p-3 text-xs text-rose-700 dark:text-rose-300">
            {error}
          </div>
        ) : null}

        <Field label="Full name" htmlFor="full_name" hint="Optional — keep the name your manager imported if it is correct.">
          <Input
            id="full_name"
            autoComplete="name"
            placeholder="Your full name"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
          />
        </Field>

        <Field label="Password" htmlFor="password" required>
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

        <Field label="Confirm password" htmlFor="confirm" required>
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

        <Button type="submit" className="w-full" size="lg" loading={loading} icon={ShieldCheck}>
          Activate account
        </Button>
      </form>
    </AuthCard>
  );
}
