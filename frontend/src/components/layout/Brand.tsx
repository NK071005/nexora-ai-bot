import { Link } from "react-router-dom";
import { cn } from "@/lib/cn";

export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-electric-400 via-electric-500 to-electric-700 text-white shadow-glow",
        className,
      )}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
        <path d="M6 18V6h2.4l7.2 8.6V6H18v12h-2.4L8.4 9.4V18H6Z" fill="currentColor" />
      </svg>
      <span className="absolute right-1 top-1 h-1 w-1 rounded-full bg-cyan-300" />
    </span>
  );
}

export function Brand({
  compact = false,
  inverted = false,
  to = "/",
}: {
  compact?: boolean;
  inverted?: boolean;
  to?: string;
}) {
  return (
    <Link to={to} className="group flex items-center gap-2.5" aria-label="NEXORA AI home">
      <LogoMark />
      {!compact ? (
        <span className="flex flex-col leading-none">
          <span
            className={cn(
              "font-display text-[15px] font-bold tracking-[0.16em]",
              inverted ? "text-white" : "text-graphite-950 dark:text-white",
            )}
          >
            NEXORA
          </span>
          <span
            className={cn(
              "mt-1 text-[9px] font-semibold uppercase tracking-[0.34em]",
              inverted ? "text-electric-300" : "text-electric-600 dark:text-electric-300",
            )}
          >
            AI workspace
          </span>
        </span>
      ) : null}
    </Link>
  );
}
