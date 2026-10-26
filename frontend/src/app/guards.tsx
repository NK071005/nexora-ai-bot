import type { ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { LogoMark } from "@/components/layout/Brand";

export function Splash({ label = "Preparing your workspace" }: { label?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-navy-950">
      <div className="flex flex-col items-center">
        <div className="animate-pulse-ring rounded-2xl">
          <LogoMark className="h-12 w-12 rounded-2xl" />
        </div>
        <p className="mt-4 font-display text-sm font-semibold tracking-[0.24em] text-white">NEXORA AI</p>
        <p className="mt-2 text-xs text-mist-500">{label}…</p>
      </div>
    </div>
  );
}

export function ProtectedRoute() {
  const { me, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Splash />;
  if (!me) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <Outlet />;
}

export function AdminOnly({ children }: { children: ReactNode }) {
  const { isAdmin, isSuperAdmin } = useAuth();
  if (!isAdmin && !isSuperAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function InternOnly({ children }: { children: ReactNode }) {
  const { isIntern } = useAuth();
  if (!isIntern) return <Navigate to="/" replace />;
  return <>{children}</>;
}


export function SuperAdminOnly({ children }: { children: ReactNode }) {
  const { isSuperAdmin } = useAuth();
  if (!isSuperAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}
