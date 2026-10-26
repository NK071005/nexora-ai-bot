import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { MeResponse, Membership } from "@/types/api";
import { ApiError, authApi, setActiveOrganization } from "@/services/api";
import { useTheme } from "./ThemeContext";

interface AuthContextValue {
  me: MeResponse | null;
  loading: boolean;
  activeMembership: Membership | null;
  activeRole: string | null;
  isAdmin: boolean;
  isIntern: boolean;
  isSuperAdmin: boolean;
  login: (email: string, password: string) => Promise<MeResponse>;
  register: (payload: {
    email: string;
    password: string;
    full_name: string;
    organization_name?: string;
    timezone?: string;
  }) => Promise<MeResponse>;
  logout: () => Promise<void>;
  refresh: () => Promise<MeResponse | null>;
  switchOrganization: (organizationId: string) => Promise<void>;
  setMe: (me: MeResponse) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function applyOrganization(me: MeResponse): void {
  const active =
    me.active_organization_id ??
    me.organizations[0]?.organization_id ??
    null;
  setActiveOrganization(active);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const { setTheme } = useTheme();

  const refresh = useCallback(async (): Promise<MeResponse | null> => {
    try {
      const response = await authApi.me();
      applyOrganization(response);
      setMe(response);
      return response;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setMe(null);
        setActiveOrganization(null);
        return null;
      }
      throw error;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await authApi.me();
        if (cancelled) return;
        applyOrganization(response);
        setMe(response);
        if (response.user.theme === "light" || response.user.theme === "dark" || response.user.theme === "system") {
          setTheme(response.user.theme);
        }
      } catch {
        if (!cancelled) setMe(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    const onUnauthorized = () => setMe(null);
    window.addEventListener("nexora:unauthorized", onUnauthorized);
    return () => {
      cancelled = true;
      window.removeEventListener("nexora:unauthorized", onUnauthorized);
    };
  }, [setTheme]);

  const login = useCallback(
    async (email: string, password: string) => {
      const response = await authApi.login({ email, password });
      applyOrganization(response);
      setMe(response);
      if (response.user.theme === "light" || response.user.theme === "dark" || response.user.theme === "system") {
        setTheme(response.user.theme);
      }
      return response;
    },
    [setTheme],
  );

  const register = useCallback<AuthContextValue["register"]>(
    async (payload) => {
      const response = await authApi.register(payload);
      applyOrganization(response);
      setMe(response);
      return response;
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setMe(null);
      setActiveOrganization(null);
    }
  }, []);

  const switchOrganization = useCallback(async (organizationId: string) => {
    const response = await authApi.updateSettings({ default_organization_id: organizationId });
    setActiveOrganization(organizationId);
    setMe(response);
  }, []);

  const activeMembership = useMemo(() => {
    if (!me) return null;
    return (
      me.organizations.find((org) => org.organization_id === me.active_organization_id) ??
      me.organizations[0] ??
      null
    );
  }, [me]);

  const value = useMemo<AuthContextValue>(
    () => ({
      me,
      loading,
      activeMembership,
      activeRole: activeMembership?.role ?? null,
      isAdmin: Boolean(me?.is_internflow_admin || me?.user.is_super_admin),
      isIntern: Boolean(me?.is_intern),
      isSuperAdmin: Boolean(me?.user.is_super_admin),
      login,
      register,
      logout,
      refresh,
      switchOrganization,
      setMe,
    }),
    [me, loading, activeMembership, login, register, logout, refresh, switchOrganization],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
