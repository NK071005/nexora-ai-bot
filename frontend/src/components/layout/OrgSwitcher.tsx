import { Building2, Check, ChevronsUpDown } from "lucide-react";
import { useAuth } from "@/app/AuthContext";
import { useToast } from "@/app/ToastContext";
import { Avatar } from "@/components/ui/primitives";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/overlays";
import { cn } from "@/lib/cn";

export function OrgSwitcher({ compact = false }: { compact?: boolean }) {
  const { me, activeMembership, switchOrganization } = useAuth();
  const toast = useToast();

  if (!me || !activeMembership) return null;

  async function choose(id: string) {
    if (id === activeMembership?.organization_id) return;
    try {
      await switchOrganization(id);
      toast.success("Workspace switched", "Scoped data now reflects the selected organization.");
    } catch (error) {
      toast.error("Could not switch workspace", error instanceof Error ? error.message : undefined);
    }
  }

  return (
    <Menu
      align="right"
      className="w-[280px]"
      trigger={
        <button
          type="button"
          className={cn(
            "flex h-9 items-center gap-2 rounded-lg border border-mist-200 bg-white px-2.5 text-left transition hover:border-mist-300 hover:bg-mist-50 dark:border-white/10 dark:bg-white/[0.04] dark:hover:bg-white/[0.07]",
            compact && "w-9 justify-center px-0",
          )}
          aria-label="Switch workspace"
        >
          <Building2 className="h-3.5 w-3.5 shrink-0 text-electric-600 dark:text-electric-300" />
          {!compact ? (
            <>
              <span className="max-w-[140px] truncate text-xs font-semibold text-graphite-800 dark:text-mist-100">
                {activeMembership.organization_name}
              </span>
              <ChevronsUpDown className="h-3 w-3 shrink-0 text-mist-400" />
            </>
          ) : null}
        </button>
      }
    >
      <p className="px-2.5 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-mist-500">
        Workspaces
      </p>
      {me.organizations.map((org) => {
        const active = org.organization_id === activeMembership.organization_id;
        return (
          <button
            key={org.organization_id}
            type="button"
            onClick={() => void choose(org.organization_id)}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition",
              active ? "bg-electric-500/10" : "hover:bg-mist-100 dark:hover:bg-white/[0.06]",
            )}
          >
            <Avatar name={org.organization_name} size="xs" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-semibold text-graphite-900 dark:text-white">
                {org.organization_name}
              </span>
              <span className="mt-0.5 block text-[10px] uppercase tracking-[0.1em] text-mist-500">
                {org.role} · @{org.organization_slug}
              </span>
            </span>
            {active ? <Check className="h-3.5 w-3.5 text-electric-500" /> : null}
          </button>
        );
      })}
      {me.organizations.length === 0 ? (
        <>
          <MenuSeparator />
          <MenuItem icon={Building2} disabled>
            No workspace memberships
          </MenuItem>
        </>
      ) : null}
    </Menu>
  );
}
