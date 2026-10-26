import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { Drawer } from "@/components/ui/overlays";
import { LogoMark } from "@/components/layout/Brand";
import { cn } from "@/lib/cn";

export function AppShell() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("nexora-sidebar") === "collapsed");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem("nexora-sidebar", collapsed ? "collapsed" : "expanded");
  }, [collapsed]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="min-h-screen bg-mist-50 dark:bg-navy-950">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 hidden border-r border-white/[0.04] transition-[width] duration-200 lg:block",
          collapsed ? "w-[76px]" : "w-[264px]",
        )}
      >
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((value) => !value)} />
      </aside>

      <div
        className="flex min-h-screen flex-col transition-[padding] duration-200"
        style={{ paddingLeft: undefined }}
      >
        <div className={cn("flex min-h-screen flex-col", collapsed ? "lg:pl-[76px]" : "lg:pl-[264px]")}>
          <Topbar onOpenMobile={() => setMobileOpen(true)} onOpenSearch={() => setPaletteOpen(true)} />
          <main className="mx-auto w-full max-w-[1560px] flex-1 px-4 pb-12 pt-6 sm:px-6 lg:px-8">
            <Outlet />
          </main>
          <footer className="mx-auto flex w-full max-w-[1560px] flex-col gap-1 border-t border-mist-200/60 px-4 py-4 text-[10px] text-mist-400 dark:border-white/[0.05] sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
            <span className="flex items-center gap-1.5">
              <LogoMark className="h-4 w-4 rounded-md" /> NEXORA AI · multimodal workspace
            </span>
            <span>Demo mode is labeled. Unconfigured integrations never fabricate results.</span>
          </footer>
        </div>
      </div>

      <Drawer open={mobileOpen} onClose={() => setMobileOpen(false)} label="Navigation" className="w-[290px]">
        <Sidebar
          collapsed={false}
          mobile
          onClose={() => setMobileOpen(false)}
        />
      </Drawer>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
