import {
  BookOpen,
  Bot,
  CalendarClock,
  CalendarDays,
  ClipboardCheck,
  FileSpreadsheet,
  FolderKanban,
  Gauge,
  LayoutDashboard,
  Library,
  Mail,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
  Wand2,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  end?: boolean;
  adminOnly?: boolean;
  internOnly?: boolean;
  hideForIntern?: boolean;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

export const workspaceNav: NavSection = {
  label: "Workspace",
  items: [
    { label: "Home", to: "/", icon: LayoutDashboard, end: true },
    { label: "Conversations", to: "/chat", icon: Bot },
    { label: "Library", to: "/library", icon: Library },
    { label: "Research", to: "/search", icon: Search },
  ],
};

export const automationNav: NavSection = {
  label: "Automations",
  items: [{ label: "Scheduled tasks", to: "/scheduled", icon: CalendarClock }],
};

export const internFlowAdminNav: NavSection = {
  label: "InternFlow",
  items: [
    { label: "Overview", to: "/internflow", icon: Gauge, end: true, adminOnly: true, hideForIntern: true },
    { label: "Interns", to: "/internflow/interns", icon: Users, adminOnly: true, hideForIntern: true },
    { label: "Templates", to: "/internflow/templates", icon: FileSpreadsheet, adminOnly: true, hideForIntern: true },
    { label: "Imports", to: "/internflow/imports", icon: FolderKanban, adminOnly: true, hideForIntern: true },
    { label: "Evaluations", to: "/internflow/evaluations", icon: ClipboardCheck, adminOnly: true, hideForIntern: true },
    { label: "Meetings", to: "/internflow/meetings", icon: CalendarDays, adminOnly: true, hideForIntern: true },
    { label: "Delivery log", to: "/internflow/operations", icon: Mail, adminOnly: true, hideForIntern: true },
    { label: "My work", to: "/internflow/me", icon: Sparkles, internOnly: true },
  ],
};

export const manageNav: NavSection = {
  label: "Manage",
  items: [
    { label: "Settings", to: "/settings", icon: Settings },
    { label: "Super admin", to: "/admin", icon: ShieldCheck, adminOnly: true },
  ],
};

export const allNavItems: NavItem[] = [
  ...workspaceNav.items,
  ...automationNav.items,
  ...internFlowAdminNav.items,
  ...manageNav.items,
];

export const quickLinks: NavItem[] = [
  { label: "New conversation", to: "/chat?new=1", icon: Wand2 },
  { label: "Add to library", to: "/library?new=1", icon: BookOpen },
  { label: "New automation", to: "/scheduled?new=1", icon: CalendarClock },
  { label: "InternFlow overview", to: "/internflow", icon: Gauge, adminOnly: true },
  { label: "InternFlow my work", to: "/internflow/me", icon: Sparkles, internOnly: true },
  { label: "Integrations", to: "/settings?tab=integrations", icon: ShieldCheck },
];

export function navTitle(pathname: string): string {
  if (pathname === "/") return "Home";
  if (pathname.startsWith("/chat")) return "Conversations";
  if (pathname.startsWith("/library")) return "Library";
  if (pathname.startsWith("/search")) return "Research";
  if (pathname.startsWith("/scheduled")) return "Scheduled tasks";
  if (pathname.startsWith("/internflow/interns/")) return "Intern profile";
  if (pathname.startsWith("/internflow/interns")) return "Interns";
  if (pathname.startsWith("/internflow/templates")) return "Task templates";
  if (pathname.startsWith("/internflow/imports")) return "Intern imports";
  if (pathname.startsWith("/internflow/evaluations")) return "Evaluations";
  if (pathname.startsWith("/internflow/meetings")) return "Meetings";
  if (pathname.startsWith("/internflow/operations")) return "Delivery log";
  if (pathname.startsWith("/internflow/me")) return "My work";
  if (pathname.startsWith("/internflow")) return "InternFlow";
  if (pathname.startsWith("/settings")) return "Settings";
  if (pathname.startsWith("/admin")) return "Super admin";
  return "NEXORA AI";
}
