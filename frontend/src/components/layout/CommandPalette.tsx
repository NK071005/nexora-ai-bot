import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, CornerDownLeft, Search, Sparkles } from "lucide-react";
import { allNavItems, quickLinks, type NavItem } from "@/lib/nav";
import { useAuth } from "@/app/AuthContext";
import { Modal } from "@/components/ui/overlays";
import { cn } from "@/lib/cn";

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const navigate = useNavigate();
  const { isAdmin, isIntern } = useAuth();

  const available = useMemo(() => {
    const filter = (item: NavItem) => {
      if (item.adminOnly && !isAdmin) return false;
      if (item.internOnly && !isIntern) return false;
      if (item.hideForIntern && isIntern) return false;
      return true;
    };
    const seen = new Set<string>();
    return [...quickLinks, ...allNavItems]
      .filter(filter)
      .filter((item) => {
        if (seen.has(item.to)) return false;
        seen.add(item.to);
        return true;
      });
  }, [isAdmin, isIntern]);

  const results = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return available.slice(0, 9);
    return available
      .filter((item) => item.label.toLowerCase().includes(text) || item.to.includes(text))
      .slice(0, 9);
  }, [available, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
    }
  }, [open]);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  function go(to: string) {
    onClose();
    navigate(to);
  }

  return (
    <Modal open={open} onClose={onClose} title="Jump to anything" description="Search pages, folders and actions." size="md">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mist-400" />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setCursor((value) => Math.min(value + 1, results.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setCursor((value) => Math.max(value - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              if (query.trim()) go(`/search?q=${encodeURIComponent(query.trim())}`);
              else if (results[cursor]) go(results[cursor].to);
            }
          }}
          placeholder="Search or type a command…"
          className="h-11 w-full rounded-xl border border-mist-200 bg-mist-50 pl-9 pr-3 text-sm outline-none transition focus:border-electric-500 focus:bg-white focus:ring-2 focus:ring-electric-500/20 dark:border-white/10 dark:bg-white/[0.04] dark:focus:bg-white/[0.06]"
        />
      </div>

      <div className="mt-3 space-y-1">
        {results.map((item, index) => (
          <button
            key={`${item.to}-${item.label}`}
            type="button"
            onMouseEnter={() => setCursor(index)}
            onClick={() => go(item.to)}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition",
              index === cursor ? "bg-electric-500/10 text-electric-800 dark:text-electric-100" : "text-graphite-700 hover:bg-mist-100 dark:text-mist-200 dark:hover:bg-white/[0.06]",
            )}
          >
            <item.icon className="h-4 w-4 shrink-0 text-mist-500" />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            <ArrowRight className="h-3.5 w-3.5 text-mist-400" />
          </button>
        ))}
        {results.length === 0 ? (
          <div className="rounded-lg border border-dashed border-mist-200 px-4 py-8 text-center dark:border-white/10">
            <Sparkles className="mx-auto h-5 w-5 text-mist-400" />
            <p className="mt-2 text-sm font-medium">No matching page</p>
            <p className="mt-0.5 text-xs text-mist-500">Press Enter to search the workspace instead.</p>
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-mist-100 pt-3 text-[10px] text-mist-500 dark:border-white/[0.07]">
        <span className="flex items-center gap-1.5">
          <CornerDownLeft className="h-3 w-3" /> open
        </span>
        <span className="flex items-center gap-3">
          <span><span className="kbd">↑</span> <span className="kbd">↓</span> navigate</span>
          <span><span className="kbd">esc</span> close</span>
        </span>
      </div>
    </Modal>
  );
}
