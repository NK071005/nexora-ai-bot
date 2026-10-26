import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button, IconButton } from "./primitives";

/* ------------------------------------------------------------------ */
/* Modal                                                               */
/* ------------------------------------------------------------------ */

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  dismissable = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  dismissable?: boolean;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dismissable) onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => panelRef.current?.focus(), 20);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose, dismissable]);

  if (!open) return null;

  const widths = {
    sm: "max-w-md",
    md: "max-w-xl",
    lg: "max-w-3xl",
    xl: "max-w-5xl",
  };

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center overflow-y-auto p-0 sm:items-center sm:p-6">
      <div
        className="fixed inset-0 bg-navy-950/60 backdrop-blur-sm"
        onClick={() => dismissable && onClose()}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          "relative z-10 max-h-[92vh] w-full animate-slide-up overflow-hidden rounded-t-2xl border border-mist-200 bg-white shadow-float outline-none dark:border-white/10 dark:bg-navy-900 sm:rounded-2xl",
          widths[size],
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-mist-100 px-5 py-4 dark:border-white/[0.07] sm:px-6">
          <div>
            <h2 id={titleId} className="font-display text-base font-semibold text-graphite-950 dark:text-white">
              {title}
            </h2>
            {description ? (
              <p className="mt-1 text-xs leading-5 text-mist-500 dark:text-mist-400">{description}</p>
            ) : null}
          </div>
          {dismissable ? (
            <IconButton label="Close dialog" onClick={onClose}>
              <X className="h-4 w-4" />
            </IconButton>
          ) : null}
        </div>
        <div className="max-h-[calc(92vh-9rem)] overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
        {footer ? (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-mist-100 bg-mist-50/60 px-5 py-3.5 dark:border-white/[0.07] dark:bg-white/[0.02] sm:px-6">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  tone = "primary",
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  tone?: "primary" | "danger";
  loading?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-6 text-mist-600 dark:text-mist-300">{description}</p>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Drawer                                                              */
/* ------------------------------------------------------------------ */

export function Drawer({
  open,
  onClose,
  side = "left",
  children,
  label,
  className,
}: {
  open: boolean;
  onClose: () => void;
  side?: "left" | "right";
  children: ReactNode;
  label: string;
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[75]">
      <div className="absolute inset-0 bg-navy-950/65 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={cn(
          "absolute top-0 h-full w-[290px] max-w-[85vw] animate-fade-in overflow-y-auto border-mist-200 bg-white shadow-float dark:border-white/10 dark:bg-navy-900",
          side === "left" ? "left-0 border-r" : "right-0 border-l",
          className,
        )}
      >
        {children}
      </aside>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ */
/* Dropdown menu                                                       */
/* ------------------------------------------------------------------ */

const MenuContext = createContext<{ close: () => void } | null>(null);

export function Menu({
  trigger,
  children,
  align = "right",
  className,
}: {
  trigger: ReactNode;
  children: ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <div onClick={() => setOpen((value) => !value)}>{trigger}</div>
      {open ? (
        <MenuContext.Provider value={{ close: () => setOpen(false) }}>
          <div
            role="menu"
            className={cn(
              "absolute z-50 mt-2 min-w-[200px] animate-slide-up rounded-xl border border-mist-200 bg-white p-1.5 shadow-float dark:border-white/10 dark:bg-navy-900",
              align === "right" ? "right-0" : "left-0",
              className,
            )}
          >
            {children}
          </div>
        </MenuContext.Provider>
      ) : null}
    </div>
  );
}

export function MenuItem({
  children,
  icon: Icon,
  onClick,
  danger,
  disabled,
  active,
}: {
  children: ReactNode;
  icon?: LucideIcon;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  active?: boolean;
}) {
  const context = useContext(MenuContext);
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        onClick?.();
        context?.close();
      }}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-40",
        danger
          ? "text-rose-600 hover:bg-rose-500/10 dark:text-rose-300"
          : "text-graphite-700 hover:bg-mist-100 dark:text-mist-200 dark:hover:bg-white/[0.06]",
        active && "bg-electric-500/10 text-electric-700 dark:text-electric-200",
      )}
    >
      {Icon ? <Icon className="h-4 w-4 shrink-0" /> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}

export function MenuSeparator() {
  return <div className="my-1 h-px bg-mist-100 dark:bg-white/10" />;
}

/* ------------------------------------------------------------------ */
/* Tabs                                                                */
/* ------------------------------------------------------------------ */

export interface TabItem {
  id: string;
  label: string;
  count?: number;
  icon?: LucideIcon;
}

export function Tabs({
  items,
  value,
  onChange,
  variant = "underline",
  className,
}: {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  variant?: "underline" | "pills";
  className?: string;
}) {
  if (variant === "pills") {
    return (
      <div className={cn("flex flex-wrap gap-1.5", className)}>
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChange(item.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                value === item.id
                  ? "bg-electric-600 text-white shadow-sm"
                  : "text-mist-600 hover:bg-mist-100 dark:text-mist-300 dark:hover:bg-white/[0.06]",
              )}
            >
              {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
              {item.label}
              {item.count !== undefined ? (
                <span className={cn("rounded px-1 text-[10px]", value === item.id ? "bg-white/20" : "bg-mist-200 dark:bg-white/10")}>
                  {item.count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <div className={cn("no-scrollbar -mb-px flex gap-1 overflow-x-auto border-b border-mist-200 dark:border-white/10", className)}>
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            className={cn(
              "relative inline-flex shrink-0 items-center gap-2 border-b-2 px-3.5 pb-3 pt-1 text-sm font-medium transition",
              value === item.id
                ? "border-electric-500 text-electric-700 dark:text-electric-200"
                : "border-transparent text-mist-500 hover:border-mist-300 hover:text-graphite-800 dark:text-mist-400 dark:hover:text-mist-200",
            )}
          >
            {Icon ? <Icon className="h-4 w-4" /> : null}
            {item.label}
            {item.count !== undefined ? (
              <span className="rounded-md bg-mist-100 px-1.5 py-0.5 text-[10px] font-semibold text-mist-600 dark:bg-white/10 dark:text-mist-300">
                {item.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pagination                                                          */
/* ------------------------------------------------------------------ */

export function Pagination({
  page,
  pageSize,
  total,
  onChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <div className="flex items-center justify-between gap-4 border-t border-mist-100 px-4 py-3 text-xs text-mist-500 dark:border-white/[0.06] dark:text-mist-400">
      <span>
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
      </span>
      <div className="flex items-center gap-1">
        <IconButton label="Previous page" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          <ChevronLeft className="h-4 w-4" />
        </IconButton>
        <span className="px-2 font-semibold text-graphite-700 dark:text-mist-200">
          {page} / {pages}
        </span>
        <IconButton label="Next page" disabled={page >= pages} onClick={() => onChange(page + 1)}>
          <ChevronRight className="h-4 w-4" />
        </IconButton>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Dropdown panel (for filters/select-like UI)                         */
/* ------------------------------------------------------------------ */

export function Popover({
  trigger,
  children,
  align = "left",
  className,
}: {
  trigger: ReactNode;
  children: ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <div onClick={() => setOpen((value) => !value)}>{trigger}</div>
      {open ? (
        <div
          className={cn(
            "absolute z-40 mt-2 min-w-[240px] animate-slide-up rounded-xl border border-mist-200 bg-white p-3 shadow-float dark:border-white/10 dark:bg-navy-900",
            align === "right" ? "right-0" : "left-0",
            className,
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
