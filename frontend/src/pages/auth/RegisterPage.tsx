import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Building2, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/app/AuthContext";
import { useToast } from "@/app/ToastContext";
import { AuthCard, AuthLink, FormError } from "@/components/auth/AuthCard";
import { PasswordInput, PasswordStrength } from "@/components/auth/PasswordInput";
import { Button, Field, Input, Notice } from "@/components/ui/primitives";
import { TIMEZONES } from "@/lib/constants";
import { ApiError } from "@/services/api";

export function RegisterPage() {
  const { register } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [organization, setOrganization] = useState("");
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setLoading(true);
    setError(null);
    setFieldErrors({});
    try {
      const result = await register({
        email: email.trim(),
        password,
        full_name: fullName.trim(),
        organization_name: organization.trim() || undefined,
        timezone,
      });
      toast.success("Workspace created", `Welcome, ${result.user.full_name.split(" ")[0]}.`);
      navigate("/", { replace: true });
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        setFieldErrors(caught.fieldErrors);
        if (caught.code === "weak_password" && Array.isArray(caught.details)) {
          setError(`${caught.message} ${(caught.details as string[]).join(" ")}`);
        }
      } else {
        setError("Registration failed. Please retry.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard
      badge="New workspace"
      title="Create your NEXORA workspace"
      subtitle="One account gives you grounded conversations, a private library, durable automations and InternFlow."
      footer={
        <span>
          Already have an account? <AuthLink to="/login">Sign in</AuthLink>
        </span>
      }
    >
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        <FormError message={error} />

        <Field label="Full name" htmlFor="full_name" error={fieldErrors.full_name} required>
          <Input
            id="full_name"
            autoComplete="name"
            placeholder="Ada Lovelace"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            invalid={Boolean(fieldErrors.full_name)}
            required
            minLength={2}
          />
        </Field>

        <Field label="Work email" htmlFor="email" error={fieldErrors.email} required>
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

        <Field label="Organization" htmlFor="organization" hint="Leave blank for a personal workspace. You can invite people later.">
          <div className="relative">
            <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mist-400" />
            <Input
              id="organization"
              className="pl-9"
              placeholder="Acme Research"
              value={organization}
              onChange={(event) => setOrganization(event.target.value)}
            />
          </div>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Password" htmlFor="password" error={fieldErrors.password} required>
            <PasswordInput
              id="password"
              autoComplete="new-password"
              placeholder="At least 10 characters"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              invalid={Boolean(fieldErrors.password)}
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
        </div>
        <PasswordStrength value={password} />

        <Field label="Timezone" htmlFor="timezone" hint="Used for scheduled automations and InternFlow deadlines.">
          <select
            id="timezone"
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            className="h-10 w-full cursor-pointer rounded-xl border border-mist-200 bg-white px-3 text-sm text-graphite-900 shadow-sm focus:border-electric-500 focus:outline-none focus:ring-2 focus:ring-electric-500/20 dark:border-white/10 dark:bg-white/[0.04] dark:text-mist-100"
          >
            {TIMEZONES.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        </Field>

        <Button type="submit" className="w-full" size="lg" loading={loading} iconRight={ArrowRight}>
          Create workspace
        </Button>

        <div className="flex items-start gap-2 rounded-xl border border-mist-200/80 bg-mist-50/60 p-3 text-[11px] leading-5 text-mist-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-mist-400">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
          <span>
            You will own this workspace as its administrator. Email verification is enforced by the server
            configuration, not by this form.
          </span>
        </div>

        {organization ? (
          <Notice tone="info" title="Team workspace">
            <p>
              Invite teammates from Settings once the workspace exists. InternFlow imports create intern accounts
              with single-use activation links.
            </p>
          </Notice>
        ) : null}
      </form>
    </AuthCard>
  );
}
