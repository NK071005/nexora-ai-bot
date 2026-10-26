import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { AlertTriangle, Loader2, RefreshCw, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { initials } from "@/lib/format";

/* ------------------------------------------------------------------ */
/* Button                                                              */
/* ------------------------------------------------------------------ */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "soft" | "dark";
type ButtonSize = "sm" | "md" | "lg" | "icon";

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    "bg-electric-600 text-white shadow-[0_1px_0_rgba(255,255,255,.16)_inset,0_8px_20px_-10px_rgba(28,95,224,.8)] hover:bg-electric-500 active:bg-electric-700",
  secondary:
    "border border-mist-200 bg-white text-graphite-800 hover:border-mist-300 hover:bg-mist-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-mist-100 dark:hover:bg-white/[0.08]",
  ghost:
    "text-mist-600 hover:bg-mist-100 hover:text-graphite-900 dark:text-mist-300 dark:hover:bg-white/[0.06] dark:hover:text-white",
  danger:
    "bg-rose-600 text-white hover:bg-rose-500 active:bg-rose-700 shadow-[0_8px_20px_-12px_rgba(225,29,72,.8)]",
  soft: "bg-electric-500/10 text-electric-700 hover:bg-electric-500/15 dark:text-electric-200",
  dark: "bg-navy-900 text-white hover:bg-navy-800 dark:bg-white dark:text-navy-950 dark:hover:bg-mist-100",
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 rounded-lg px-3 text-xs",
  md: "h-10 gap-2 rounded-xl px-4 text-sm",
  lg: "h-11 gap-2 rounded-xl px-5 text-sm",
  icon: "h-9 w-9 rounded-lg",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: LucideIcon;
  iconRight?: LucideIcon;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", size = "md", loading, icon: Icon, iconRight: IconRight, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex select-none items-center justify-center whitespace-nowrap font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-500/60 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 dark:focus-visible:ring-offset-navy-950",
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      {...props}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : Icon ? (
        <Icon className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} />
      ) : null}
      {children}
      {IconRight ? <IconRight className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} /> : null}
    </button>
  );
});

export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { label: string; variant?: ButtonVariant; size?: ButtonSize }
>(function IconButton({ className, label, variant = "ghost", size = "icon", children, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex items-center justify-center rounded-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-500/60 disabled:pointer-events-none disabled:opacity-40",
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});

/* ------------------------------------------------------------------ */
/* Form fields                                                         */
/* ------------------------------------------------------------------ */

interface FieldShellProps {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}

export function Field({ label, hint, error, required, htmlFor, children, className }: FieldShellProps) {
  return (
    <div className={className}>
      {label ? (
        <label htmlFor={htmlFor} className="field-label">
          {label}
          {required ? <span className="ml-1 text-rose-500">*</span> : null}
        </label>
      ) : null}
      {children}
      {error ? <p className="field-error">{error}</p> : hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  );
}

const controlBase =
  "w-full rounded-xl border border-mist-200 bg-white px-3.5 py-2.5 text-sm text-graphite-900 shadow-sm transition placeholder:text-mist-400 hover:border-mist-300 focus:border-electric-500 focus:outline-none focus:ring-2 focus:ring-electric-500/20 disabled:cursor-not-allowed disabled:bg-mist-50 disabled:text-mist-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-mist-100 dark:placeholder:text-mist-500 dark:hover:border-white/20 dark:disabled:bg-white/[0.02]";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(controlBase, "h-10 py-0", invalid && "border-rose-500 focus:border-rose-500", className)}
      {...props}
    />
  );
});

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(function Textarea({ className, invalid, rows = 4, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(controlBase, "resize-y leading-6", invalid && "border-rose-500", className)}
      {...props}
    />
  );
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <select ref={ref} className={cn(controlBase, "h-10 cursor-pointer py-0 pr-8", className)} {...props}>
        {children}
      </select>
    );
  },
);

export function Checkbox({
  label,
  description,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; description?: string }) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-3", className)}>
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 rounded border-mist-300 text-electric-600 accent-electric-600 focus:ring-electric-500 dark:border-white/20"
        {...props}
      />
      <span>
        <span className="block text-sm font-medium text-graphite-800 dark:text-mist-200">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-xs leading-5 text-mist-500 dark:text-mist-400">{description}</span>
        ) : null}
      </span>
    </label>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-graphite-800 dark:text-mist-200">{label}</p>
        {description ? <p className="mt-0.5 text-xs leading-5 text-mist-500 dark:text-mist-400">{description}</p> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-500/60 disabled:opacity-40",
          checked ? "bg-electric-500" : "bg-mist-300 dark:bg-white/15",
        )}
      >
        <span
          className={cn(
            "inline-block h-5 w-5 transform rounded-full bg-white shadow transition",
            checked ? "translate-x-[22px]" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Display                                                             */
/* ------------------------------------------------------------------ */

type BadgeTone = "neutral" | "blue" | "green" | "amber" | "rose" | "violet" | "cyan";

const badgeTones: Record<BadgeTone, string> = {
  neutral: "bg-mist-100 text-mist-600 dark:bg-white/[0.07] dark:text-mist-300",
  blue: "bg-electric-500/12 text-electric-700 dark:bg-electric-500/15 dark:text-electric-200",
  green: "bg-emerald-500/12 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  amber: "bg-amber-500/15 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  rose: "bg-rose-500/12 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  violet: "bg-violet-500/12 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  cyan: "bg-cyan-500/12 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300",
};

export function Badge({
  children,
  tone = "neutral",
  dot,
  className,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("pill", badgeTones[tone], className)}>
      {dot ? <span className="h-1.5 w-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}

const statusTone: Record<string, BadgeTone> = {
  active: "green",
  approved: "green",
  passed: "green",
  complete: "green",
  completed: "green",
  connected: "green",
  sent: "green",
  verified: "green",
  scheduled: "blue",
  submitted: "blue",
  assigned: "blue",
  streaming: "blue",
  proposed: "cyan",
  pending: "amber",
  paused: "amber",
  invited: "amber",
  human_review_required: "amber",
  corrections_required: "amber",
  unverified: "amber",
  failed: "rose",
  overdue: "rose",
  rejected: "rose",
  cancelled: "rose",
  withdrawn: "rose",
  not_connected: "neutral",
  unconfigured: "neutral",
  demo: "violet",
  stopped: "neutral",
  archived: "neutral",
  draft: "neutral",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const label = status.replace(/_/g, " ");
  return (
    <Badge tone={statusTone[status] ?? "neutral"} dot className={cn("capitalize", className)}>
      {label}
    </Badge>
  );
}

export function Avatar({
  name,
  size = "md",
  className,
}: {
  name: string;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}) {
  const sizes = {
    xs: "h-7 w-7 text-[10px]",
    sm: "h-8 w-8 text-[11px]",
    md: "h-10 w-10 text-xs",
    lg: "h-14 w-14 text-base",
  };
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) % 360;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white shadow-sm ring-2 ring-white/60 dark:ring-white/10",
        sizes[size],
        className,
      )}
      style={{
        background: `linear-gradient(135deg, hsl(${hash} 65% 46%), hsl(${(hash + 42) % 360} 72% 38%))`,
      }}
      aria-hidden
    >
      {initials(name) || "?"}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-5 w-5 animate-spin text-electric-500", className)} />;
}

export function ProgressBar({ value, tone = "blue" }: { value: number; tone?: "blue" | "green" | "amber" | "rose" }) {
  const tones = {
    blue: "bg-electric-500",
    green: "bg-emerald-500",
    amber: "bg-amber-500",
    rose: "bg-rose-500",
  };
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-mist-200 dark:bg-white/10">
      <div
        className={cn("h-full rounded-full transition-all duration-500", tones[tone])}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton h-4 w-full", className)} />;
}

export function SkeletonCard() {
  return (
    <div className="app-surface space-y-4 p-5">
      <Skeleton className="h-5 w-1/3" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-4/5" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-2xl border border-dashed border-mist-300 px-6 py-12 text-center dark:border-white/10",
        className,
      )}
    >
      <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-electric-500/10 text-electric-600 dark:text-electric-300">
        <Icon className="h-5 w-5" />
      </span>
      <h3 className="font-display text-base font-semibold text-graphite-900 dark:text-white">{title}</h3>
      <p className="mt-1 max-w-md text-sm leading-6 text-mist-500 dark:text-mist-400">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-5 rounded-2xl border border-rose-500/20 bg-rose-500/[0.04] p-5 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-300">
          <AlertTriangle className="h-4 w-4" />
        </span>
        <div>
          <p className="text-sm font-semibold text-graphite-900 dark:text-white">Could not load this view</p>
          <p className="mt-0.5 text-sm text-mist-600 dark:text-mist-400">{message}</p>
        </div>
      </div>
      {onRetry ? (
        <Button variant="secondary" size="sm" icon={RefreshCw} onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow mb-1.5">{eyebrow}</p> : null}
        <h1 className="heading-display text-2xl text-graphite-950 dark:text-white sm:text-[28px]">{title}</h1>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-mist-500 dark:text-mist-400">{description}</p>
        ) : null}
        {children}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "blue",
  loading,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon: LucideIcon;
  tone?: "blue" | "green" | "amber" | "rose" | "violet";
  loading?: boolean;
}) {
  const tones = {
    blue: "bg-electric-500/10 text-electric-600 dark:text-electric-300",
    green: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
    amber: "bg-amber-500/10 text-amber-600 dark:text-amber-300",
    rose: "bg-rose-500/10 text-rose-600 dark:text-rose-300",
    violet: "bg-violet-500/10 text-violet-600 dark:text-violet-300",
  };
  return (
    <div className="app-surface card-hover p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">{label}</p>
          {loading ? <Skeleton className="mt-3 h-8 w-16" /> : <p className="heading-display mt-2 text-[26px] leading-none text-graphite-950 dark:text-white">{value}</p>}
          {hint ? <p className="mt-2 text-xs leading-5 text-mist-500 dark:text-mist-400">{hint}</p> : null}
        </div>
        <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", tones[tone])}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
    </div>
  );
}

export function SectionHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        <h2 className="font-display text-base font-semibold text-graphite-950 dark:text-white">{title}</h2>
        {description ? <p className="mt-0.5 text-xs leading-5 text-mist-500 dark:text-mist-400">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <span className="text-xs font-medium uppercase tracking-[0.08em] text-mist-500 dark:text-mist-400">{label}</span>
      <span className="text-right text-sm text-graphite-800 dark:text-mist-200">{children}</span>
    </div>
  );
}

export function Notice({
  tone = "info",
  title,
  children,
  action,
  className,
}: {
  tone?: "info" | "warning" | "success" | "danger";
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const tones = {
    info: "border-electric-500/25 bg-electric-500/[0.05] text-electric-900 dark:text-electric-100",
    warning: "border-amber-500/30 bg-amber-500/[0.06] text-amber-900 dark:text-amber-100",
    success: "border-emerald-500/25 bg-emerald-500/[0.05] text-emerald-900 dark:text-emerald-100",
    danger: "border-rose-500/25 bg-rose-500/[0.05] text-rose-900 dark:text-rose-100",
  };
  return (
    <div className={cn("flex flex-col gap-2 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between", tones[tone], className)}>
      <div className="min-w-0">
        <p className="text-sm font-semibold">{title}</p>
        {children ? <div className="mt-0.5 text-xs leading-5 opacity-80">{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
