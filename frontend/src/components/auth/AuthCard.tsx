import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertCircle } from "lucide-react";
import { LogoMark } from "@/components/layout/Brand";

export function AuthCard({
  title,
  subtitle,
  children,
  footer,
  badge,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  badge?: string;
}) {
  return (
    <div className="rounded-2xl border border-mist-200/80 bg-white p-6 shadow-panel dark:border-white/10 dark:bg-navy-900 sm:p-8">
      <div className="mb-6">
        {badge ? (
          <span className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-electric-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-electric-700 dark:text-electric-200">
            <LogoMark className="h-3 w-3 rounded-[4px]" /> {badge}
          </span>
        ) : null}
        <h1 className="heading-display text-2xl text-graphite-950 dark:text-white">{title}</h1>
        {subtitle ? <p className="mt-1.5 text-sm leading-6 text-mist-500 dark:text-mist-400">{subtitle}</p> : null}
      </div>
      {children}
      {footer ? (
        <div className="mt-6 border-t border-mist-100 pt-5 text-center text-xs text-mist-500 dark:border-white/[0.07] dark:text-mist-400">
          {footer}
        </div>
      ) : null}
    </div>
  );
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-rose-500/20 bg-rose-500/[0.06] p-3 text-rose-700 dark:text-rose-300">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="text-xs leading-5">{message}</p>
    </div>
  );
}

export function AuthLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="font-semibold text-electric-600 hover:text-electric-500 dark:text-electric-300">
      {children}
    </Link>
  );
}
