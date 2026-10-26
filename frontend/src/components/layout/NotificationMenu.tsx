import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, CheckCheck, Inbox, Trash2 } from "lucide-react";
import type { NotificationItem, NotificationList } from "@/types/api";
import { notificationsApi } from "@/services/api";
import { formatDateTime, relativeTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useToast } from "@/app/ToastContext";
import { Badge, IconButton, Spinner } from "@/components/ui/primitives";
import { Menu, MenuSeparator } from "@/components/ui/overlays";

export function NotificationMenu() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const toast = useToast();
  const navigate = useNavigate();

  const load = useCallback(async (showLoader = false) => {
    if (showLoader) setLoading(true);
    try {
      const data: NotificationList = await notificationsApi.list({ limit: 12 });
      setItems(data.items);
      setUnread(data.unread);
      setLoaded(true);
    } catch {
      /* a failed notification poll must not interrupt the page */
    } finally {
      if (showLoader) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function open(item: NotificationItem) {
    if (!item.read_at) {
      try {
        await notificationsApi.markRead(item.id);
        setItems((list) => list.map((entry) => (entry.id === item.id ? { ...entry, read_at: new Date().toISOString() } : entry)));
        setUnread((count) => Math.max(0, count - 1));
      } catch {
        /* ignore */
      }
    }
    if (item.link) navigate(item.link);
  }

  async function markAll() {
    try {
      const result = await notificationsApi.markAll();
      setItems((list) => list.map((entry) => ({ ...entry, read_at: entry.read_at ?? new Date().toISOString() })));
      setUnread(0);
      toast.success("Inbox cleared", result.updated ? `${result.updated} notification(s) marked read.` : "Nothing unread.");
    } catch {
      toast.error("Could not update notifications");
    }
  }

  async function remove(item: NotificationItem) {
    try {
      await notificationsApi.remove(item.id);
      setItems((list) => list.filter((entry) => entry.id !== item.id));
      if (!item.read_at) setUnread((count) => Math.max(0, count - 1));
    } catch {
      toast.error("Could not remove notification");
    }
  }

  return (
    <Menu
      align="right"
      className="w-[360px] max-w-[calc(100vw-1.5rem)] p-0"
      trigger={
        <button
          type="button"
          aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
          className="relative flex h-9 w-9 items-center justify-center rounded-lg text-mist-500 transition hover:bg-mist-100 hover:text-graphite-900 dark:text-mist-300 dark:hover:bg-white/[0.06] dark:hover:text-white"
        >
          <Bell className="h-[18px] w-[18px]" />
          {unread > 0 ? (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-electric-500 px-1 text-[9px] font-bold text-white ring-2 ring-mist-50 dark:ring-navy-950">
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </button>
      }
    >
      <div className="flex items-center justify-between border-b border-mist-100 px-3 py-2.5 dark:border-white/[0.07]">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-graphite-950 dark:text-white">Notifications</p>
          {unread > 0 ? <Badge tone="blue">{unread} new</Badge> : null}
        </div>
        <button
          type="button"
          onClick={() => void load(true)}
          className="text-[11px] font-medium text-mist-500 hover:text-electric-600 dark:hover:text-electric-300"
        >
          Refresh
        </button>
      </div>

      <div className="max-h-[380px] overflow-y-auto">
        {loading && !loaded ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center px-4 py-10 text-center">
            <Inbox className="h-6 w-6 text-mist-400" />
            <p className="mt-2 text-sm font-medium text-graphite-800 dark:text-mist-200">Nothing here yet</p>
            <p className="mt-0.5 text-xs text-mist-500 dark:text-mist-400">Task updates and reminders will land here.</p>
          </div>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className={cn(
                "group relative border-b border-mist-100 px-3 py-3 transition last:border-0 dark:border-white/[0.05]",
                !item.read_at && "bg-electric-500/[0.04]",
              )}
            >
              <button type="button" onClick={() => void open(item)} className="block w-full pr-7 text-left">
                <div className="flex items-start gap-2">
                  {!item.read_at ? <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-electric-500" /> : null}
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-graphite-900 dark:text-white">{item.title}</p>
                    <p className="mt-0.5 line-clamp-2 text-[11px] leading-5 text-mist-500 dark:text-mist-400">{item.body}</p>
                    <p className="mt-1 text-[10px] text-mist-400" title={formatDateTime(item.created_at)}>
                      {relativeTime(item.created_at)}
                    </p>
                  </div>
                </div>
              </button>
              <button
                type="button"
                aria-label="Delete notification"
                onClick={() => void remove(item)}
                className="absolute right-2 top-2 rounded-md p-1 text-mist-400 opacity-0 transition hover:bg-rose-500/10 hover:text-rose-500 group-hover:opacity-100"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))
        )}
      </div>
      <MenuSeparator />
      <div className="flex items-center justify-between px-2 py-1">
        <button
          type="button"
          onClick={() => void markAll()}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-mist-600 hover:bg-mist-100 dark:text-mist-300 dark:hover:bg-white/[0.06]"
        >
          <CheckCheck className="h-3.5 w-3.5" /> Mark all read
        </button>
        <span className="pr-1 text-[10px] text-mist-400">In-app delivery</span>
      </div>
    </Menu>
  );
}
