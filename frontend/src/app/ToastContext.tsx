import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2, Info, TriangleAlert, X, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";

type ToastVariant = "success" | "error" | "info" | "warning";

interface Toast {
  id: number;
  title: string;
  description?: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  push: (title: string, options?: { description?: string; variant?: ToastVariant }) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
  warning: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const icons = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
  warning: TriangleAlert,
};

const tones = {
  success:
    "border-emerald-500/25 bg-emerald-50 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-100",
  error: "border-rose-500/25 bg-rose-50 text-rose-900 dark:bg-rose-500/10 dark:text-rose-100",
  info: "border-electric-500/25 bg-electric-50 text-electric-900 dark:bg-electric-500/10 dark:text-electric-100",
  warning: "border-amber-500/25 bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-100",
};

const iconTones = {
  success: "text-emerald-600 dark:text-emerald-300",
  error: "text-rose-600 dark:text-rose-300",
  info: "text-electric-600 dark:text-electric-300",
  warning: "text-amber-600 dark:text-amber-300",
};

let counter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: number) => {
    setToasts((items) => items.filter((item) => item.id !== id));
  }, []);

  const push = useCallback<ToastContextValue["push"]>(
    (title, options) => {
      const id = ++counter;
      const next: Toast = {
        id,
        title,
        description: options?.description,
        variant: options?.variant ?? "info",
      };
      setToasts((items) => [...items.slice(-3), next]);
      window.setTimeout(() => remove(id), options?.variant === "error" ? 7000 : 4500);
    },
    [remove],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      push,
      success: (title, description) => push(title, { description, variant: "success" }),
      error: (title, description) => push(title, { description, variant: "error" }),
      info: (title, description) => push(title, { description, variant: "info" }),
      warning: (title, description) => push(title, { description, variant: "warning" }),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2"
      >
        {toasts.map((toast) => {
          const Icon = icons[toast.variant];
          return (
            <div
              key={toast.id}
              className={cn(
                "pointer-events-auto flex animate-slide-up items-start gap-3 rounded-xl border p-3.5 shadow-float backdrop-blur-xl",
                tones[toast.variant],
              )}
            >
              <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", iconTones[toast.variant])} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold leading-5">{toast.title}</p>
                {toast.description ? (
                  <p className="mt-0.5 text-xs leading-5 opacity-80">{toast.description}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => remove(toast.id)}
                aria-label="Dismiss notification"
                className="rounded-md p-1 opacity-60 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside ToastProvider");
  return context;
}
