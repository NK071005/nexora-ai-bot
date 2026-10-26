import { NavLink, useNavigate } from "react-router-dom";
import {
  ChevronLeft,
  ChevronRight,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useAuth } from "@/app/AuthContext";
import { useToast } from "@/app/ToastContext";
import { automationNav, internFlowAdminNav, manageNav, workspaceNav, type NavSection } from "@/lib/nav";
import { Brand } from "./Brand";
import { Avatar, Badge, IconButton } from "@/components/ui/primitives";

function Section({
  section,
  collapsed,
  onNavigate,
}: {
  section: NavSection;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const { isAdmin, isIntern } = useAuth();
  const items = section.items.filter((item) => {
    if (item.adminOnly && !isAdmin) return false;
    if (item.internOnly && !isIntern) return false;
    if (item.hideForIntern && isIntern) return false;
    return true;
  });
  if (!items.length) return null;

  return (
    <div>
      {!collapsed ? <p className="sidebar-label">{section.label}</p> : <div className="mx-3 my-3 h-px bg-white/[0.07]" />}
      <div className="space-y-0.5 px-2">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            title={collapsed ? item.label : undefined}
            className={({ isActive }) =>
              cn("nav-item group", isActive && "nav-item-active", collapsed && "justify-center px-2")
            }
          >
            <item.icon className="h-[18px] w-[18px] shrink-0" />
            {!collapsed ? <span className="truncate">{item.label}</span> : null}
            {!collapsed && item.label === "InternFlow overview" ? (
              <span className="ml-auto h-1.5 w-1.5 rounded-full bg-cyan-400" />
            ) : null}
          </NavLink>
        ))}
      </div>
    </div>
  );
}

export function Sidebar({
  collapsed,
  onToggle,
  onClose,
  mobile = false,
}: {
  collapsed: boolean;
  onToggle?: () => void;
  onClose?: () => void;
  mobile?: boolean;
}) {
  const { me, activeMembership, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const isCollapsed = mobile ? false : collapsed;
  const aiDemo = me?.capabilities.ai.demo ?? true;
  const searchReady = me?.capabilities.search.configured ?? false;

  async function handleLogout() {
    await logout();
    toast.success("Signed out", "Your session was closed.");
    navigate("/login");
  }

  return (
    <div className="flex h-full flex-col bg-navy-950 text-mist-200">
      <div className={cn("flex h-16 items-center border-b border-white/[0.06] px-4", isCollapsed ? "justify-center" : "justify-between")}>
        <Brand compact={isCollapsed} inverted />
        {mobile ? (
          <IconButton label="Close navigation" onClick={onClose} className="text-mist-300 hover:bg-white/10 hover:text-white">
            <X className="h-4 w-4" />
          </IconButton>
        ) : onToggle ? (
          <button
            type="button"
            onClick={onToggle}
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="rounded-lg p-1.5 text-mist-500 transition hover:bg-white/[0.06] hover:text-white"
          >
            {isCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        ) : null}
      </div>

      {!isCollapsed && activeMembership ? (
        <button
          type="button"
          onClick={() => {
            navigate("/settings?tab=workspace");
            onClose?.();
          }}
          className="mx-3 mt-3 flex items-center gap-2.5 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2.5 text-left transition hover:bg-white/[0.06]"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-electric-500/15 text-[11px] font-bold text-electric-200">
            {activeMembership.organization_name.slice(0, 2).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold text-white">{activeMembership.organization_name}</span>
            <span className="mt-0.5 block text-[10px] uppercase tracking-[0.14em] text-mist-500">
              {activeMembership.role}
            </span>
          </span>
          <Settings2 className="h-3.5 w-3.5 text-mist-500" />
        </button>
      ) : null}

      <nav className="no-scrollbar mt-1 flex-1 overflow-y-auto pb-4">
        <Section section={workspaceNav} collapsed={isCollapsed} onNavigate={onClose} />
        <Section section={automationNav} collapsed={isCollapsed} onNavigate={onClose} />
        <Section section={internFlowAdminNav} collapsed={isCollapsed} onNavigate={onClose} />
        <Section section={manageNav} collapsed={isCollapsed} onNavigate={onClose} />
      </nav>

      <div className="border-t border-white/[0.06] p-3">
        {isCollapsed ? (
          <div className="flex flex-col items-center gap-2">
            <span
              title={aiDemo ? "Demo Intelligence active" : "Live AI provider connected"}
              className={cn("h-2 w-2 rounded-full", aiDemo ? "bg-amber-400" : "bg-emerald-400")}
            />
            <span
              title={searchReady ? "Live web search connected" : "Web search not configured"}
              className={cn("h-2 w-2 rounded-full", searchReady ? "bg-emerald-400" : "bg-mist-600")}
            />
          </div>
        ) : (
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-electric-300" />
              <span className="text-[11px] font-semibold text-white">
                {aiDemo ? "Demo Intelligence" : "Live AI"}
              </span>
              <Badge tone={aiDemo ? "amber" : "green"} className="ml-auto !px-1.5 !py-0.5 !text-[9px]">
                {aiDemo ? "DEMO" : "LIVE"}
              </Badge>
            </div>
            <p className="mt-1.5 text-[10px] leading-4 text-mist-500">
              {aiDemo
                ? "Extractive answers, clearly labeled. Add OPENAI_API_KEY for model calls."
                : "Connected to the configured model provider."}
            </p>
            <div className="mt-2 flex items-center gap-1.5 text-[10px] text-mist-500">
              <span className={cn("h-1.5 w-1.5 rounded-full", searchReady ? "bg-emerald-400" : "bg-mist-600")} />
              {searchReady ? "Live web research" : "Web search unconfigured"}
            </div>
          </div>
        )}

        <div className={cn("mt-2 flex items-center gap-2 rounded-lg px-1 py-1.5", isCollapsed && "justify-center")}>
          <Avatar name={me?.user.full_name ?? "N"} size="sm" />
          {!isCollapsed ? (
            <>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-white">{me?.user.full_name}</p>
                <p className="truncate text-[10px] text-mist-500">{me?.user.email}</p>
              </div>
              <IconButton
                label="Sign out"
                onClick={handleLogout}
                className="text-mist-400 hover:bg-white/10 hover:text-white"
              >
                <LogOut className="h-3.5 w-3.5" />
              </IconButton>
            </>
          ) : (
            <button
              type="button"
              onClick={handleLogout}
              title="Sign out"
              aria-label="Sign out"
              className="rounded-lg p-1 text-mist-500 hover:bg-white/10 hover:text-white"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      {mobile ? (
        <button
          type="button"
          onClick={onClose}
          className="flex items-center justify-center gap-1.5 border-t border-white/[0.06] py-2 text-[10px] uppercase tracking-[0.2em] text-mist-500"
        >
          <ChevronLeft className="h-3 w-3" /> Close
        </button>
      ) : null}
    </div>
  );
}
