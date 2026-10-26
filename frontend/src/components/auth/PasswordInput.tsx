import { forwardRef, useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/cn";

export const PasswordInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }
>(function PasswordInput({ className, invalid, ...props }, ref) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        ref={ref}
        type={visible ? "text" : "password"}
        className={cn(
          "h-10 w-full rounded-xl border border-mist-200 bg-white px-3.5 pr-11 text-sm text-graphite-900 shadow-sm transition placeholder:text-mist-400 hover:border-mist-300 focus:border-electric-500 focus:outline-none focus:ring-2 focus:ring-electric-500/20 dark:border-white/10 dark:bg-white/[0.04] dark:text-mist-100",
          invalid && "border-rose-500",
          className,
        )}
        {...props}
      />
      <button
        type="button"
        onClick={() => setVisible((value) => !value)}
        aria-label={visible ? "Hide password" : "Show password"}
        className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-mist-400 transition hover:bg-mist-100 hover:text-graphite-700 dark:hover:bg-white/10 dark:hover:text-white"
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
});

export function PasswordStrength({ value }: { value: string }) {
  const checks = [
    { label: "10+ characters", pass: value.length >= 10 },
    { label: "lowercase", pass: /[a-z]/.test(value) },
    { label: "uppercase", pass: /[A-Z]/.test(value) },
    { label: "number", pass: /\d/.test(value) },
  ];
  const score = checks.filter((check) => check.pass).length;
  return (
    <div className="mt-2">
      <div className="flex gap-1">
        {[0, 1, 2, 3].map((index) => (
          <span
            key={index}
            className={cn(
              "h-1 flex-1 rounded-full transition",
              index < score
                ? score <= 2
                  ? "bg-amber-500"
                  : "bg-emerald-500"
                : "bg-mist-200 dark:bg-white/10",
            )}
          />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
        {checks.map((check) => (
          <span key={check.label} className={cn("text-[10px]", check.pass ? "text-emerald-600 dark:text-emerald-400" : "text-mist-400")}>
            {check.pass ? "✓" : "·"} {check.label}
          </span>
        ))}
      </div>
    </div>
  );
}
