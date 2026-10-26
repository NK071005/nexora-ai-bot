import { useNavigate } from "react-router-dom";
import {
  ChevronDown,
  Command,
  LogOut,
  Menu as MenuIcon,
  Moon,
  Search,
  Settings,
  ShieldCheck,
  Sun,
  User,
} from "lucide-react";
import { useAuth } from "@/app/AuthContext";
import { useTheme } from "@/app/ThemeContext";
import { useToast } from "@/app/ToastContext";
import { Avatar, Badge, IconButton } from "@/components/ui/primitives";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/overlays";
import { navTitle } from "@/lib/nav";
import { useLocation } from "react-router-dom";
import { NotificationMenu } from "./NotificationMenu";
import { OrgSwitcher } from "./OrgSwitcher";

export function Topbar({
  onOpenMobile,
  onOpenSearch,
}: {
  onOpenMobile: () => void;
  onOpenSearch: () => void;
}) {
  const { me, isAdmin, isSuperAdmin, logout } = useAuth();
  const { resolved, toggle } = useTheme();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const demo = me?.capabilities.ai.demo;
  const title = navTitle(location.pathname);

  async function handleLogout() {
    await logout();
    toast.success("Signed out", "Your session was closed.");
    navigate("/login");
  }

  return (
    <header className="sticky top-0 z-30 border-b border-mist-200/80 bg-mist-50/85 backdrop-blur-xl dark:border-white/[0.06] dark:bg-navy-950/80">
      <div className="flex h-16 items-center gap-2 px-4 sm:gap-3 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={onOpenMobile}
          aria-label="Open navigation"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-mist-600 transition hover:bg-mist-100 hover:text-graphite-900 dark:text-mist-300 dark:hover:bg-white/[0.06] dark:hover:text-white lg:hidden"
        >
          <MenuIcon className="h-5 w-5" />
        </button>

        <div className="hidden min-w-0 items-center gap-2 md:flex">
          <span className="text-xs font-medium text-mist-400">NEXORA</span>
          <ChevronDown className="h-3 w-3 -rotate-90 text-mist-300" />
          <span className="truncate text-sm font-semibold text-graphite-800 dark:text-mist-100">{title}</span>
        </div>

        <button
          type="button"
          onClick={onOpenSearch}
          className="group ml-auto flex h-9 w-9 items-center gap-2 rounded-lg border border-mist-200 bg-white px-2.5 text-xs text-mist-500 transition hover:border-mist-300 hover:bg-mist-50 dark:border-white/10 dark:bg-white/[0.04] dark:hover:bg-white/[0.07] md:w-[260px] lg:w-[320px]"
          aria-label="Search and commands"
        >
          <Search className="h-4 w-4 shrink-0" />
          <span className="hidden flex-1 text-left md:block">Search or jump to…</span>
          <span className="hidden items-center gap-0.5 md:flex">
            <span className="kbd">⌘</span>
            <span className="kbd">K</span>
          </span>
        </button>

        <div className="flex items-center gap-1 sm:gap-1.5">
          {demo ? (
            <Badge tone="amber" className="hidden xl:inline-flex">
              Demo AI
            </Badge>
          ) : (
            <Badge tone="green" className="hidden xl:inline-flex">
              AI live
            </Badge>
          )}
          <OrgSwitcher compact={false} />
          <IconButton label={resolved === "dark" ? "Switch to light mode" : "Switch to dark mode"} onClick={toggle}>
            {resolved === "dark" ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
          </IconButton>
          <NotificationMenu />
          <div className="mx-0.5 hidden h-6 w-px bg-mist-200 dark:bg-white/10 sm:block" />
          <Menu
            align="right"
            className="w-[230px]"
            trigger={
              <button type="button" className="flex items-center gap-2 rounded-lg p-0.5 transition hover:bg-mist-100 dark:hover:bg-white/[0.06]" aria-label="Account menu">
                <Avatar name={me?.user.full_name ?? "N"} size="sm" />
              </button>
            }
          >
            <div className="px-2.5 py-2">
              <p className="truncate text-xs font-semibold text-graphite-950 dark:text-white">{me?.user.full_name}</p>
              <p className="truncate text-[11px] text-mist-500">{me?.user.email}</p>
              {me?.user.is_super_admin ? (
                <Badge tone="violet" className="mt-1.5">Super admin</Badge>
              ) : null}
            </div>
            <MenuSeparator />
            <MenuItem icon={User} onClick={() => navigate("/settings?tab=profile")}>My profile</MenuItem>
            <MenuItem icon={Settings} onClick={() => navigate("/settings")}>Settings</MenuItem>
            {isAdmin ? (
              <MenuItem icon={Command} onClick={() => navigate("/internflow")}>InternFlow</MenuItem>
            ) : null}
            {isSuperAdmin ? (
              <MenuItem icon={ShieldCheck} onClick={() => navigate("/admin")}>Super admin</MenuItem>
            ) : null}
            <MenuSeparator />
            <MenuItem icon={LogOut} danger onClick={() => void handleLogout()}>Sign out</MenuItem>
          </Menu>
        </div>
      </div>
    </header>
  );
}
