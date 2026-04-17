import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { clearHubCache, clearMessagesCache } from "@/lib/hubCache";

export interface AuthUser {
  userId: string;
  userName: string;
  userRole: string;
  userRoles: string[];
  userInitials: string;
  instituteCode: string;
  instituteName: string;
  status: string;
}

interface AuthContextType {
  authUser: AuthUser | null;
  authLoading: boolean;
  refreshAuthUser: () => Promise<void>;
}

const CACHE_KEY = "bh_auth_cache";
const LEGACY_CACHE_KEY = "bh_auth_user";
const INST_NAME_CACHE_PREFIX = "bh_inst_name_";

function readCachedAuthUser(): AuthUser | null {
  try {
    const cached = localStorage.getItem(CACHE_KEY) ?? localStorage.getItem(LEGACY_CACHE_KEY);
    return cached ? JSON.parse(cached) : null;
  } catch {
    return null;
  }
}

function writeCachedAuthUser(user: AuthUser) {
  const serialized = JSON.stringify(user);
  localStorage.setItem(CACHE_KEY, serialized);
  localStorage.setItem(LEGACY_CACHE_KEY, serialized);
}

function clearCachedAuthUser() {
  localStorage.removeItem(CACHE_KEY);
  localStorage.removeItem(LEGACY_CACHE_KEY);
}

const AuthContext = createContext<AuthContextType>({
  authUser: null,
  authLoading: true,
  refreshAuthUser: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authUser, setAuthUser] = useState<AuthUser | null>(() => {
    return readCachedAuthUser();
  });

  const [authLoading, setAuthLoading] = useState(!readCachedAuthUser());

  const loadUser = async () => {
    const cachedUser = readCachedAuthUser();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      // Local-first bootstrap: on cold starts Supabase session restoration can lag
      // behind the first render, especially in PWAs/offline launches. If we already
      // have a cached identity, keep it and let the online verification effect clear
      // it later only when we positively know the session is gone.
      if (cachedUser) {
        setAuthUser(cachedUser);
        setAuthLoading(false);
        return;
      }
      setAuthUser(null);
      setAuthLoading(false);
      clearCachedAuthUser();
      return;
    }

    try {
      // Parallel fetch: profile, roles, and institute
      const [profileRes, rolesRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("full_name, role, institute_code, status")
          .eq("user_id", session.user.id)
          .maybeSingle(),
        supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", session.user.id),
      ]);

      if (profileRes.error) throw profileRes.error;
      if (rolesRes.error) throw rolesRes.error;

      const profile = profileRes.data;
      const userRoles = rolesRes.data?.map((r) => r.role) || [];

      let instituteName = profile?.institute_code ?? "";
      if (profile?.institute_code) {
        // MED-03: Cache institute name to avoid repeat network round-trips
        const cachedName = sessionStorage.getItem(`${INST_NAME_CACHE_PREFIX}${profile.institute_code}`);
        if (cachedName) {
          instituteName = cachedName;
        } else {
          const { data: inst, error: instError } = await supabase
            .from("institutes")
            .select("institute_name, city")
            .eq("institute_code", profile.institute_code)
            .single();
          if (instError) throw instError;
          if (inst) {
            instituteName = `${inst.institute_name}${inst.city ? ", " + inst.city : ""}`;
            sessionStorage.setItem(`${INST_NAME_CACHE_PREFIX}${profile.institute_code}`, instituteName);
          }
        }
      }

      const name = profile?.full_name || session.user.email || "User";
      const parts = name.split(" ");
      const initials = parts.map((p: string) => p[0]).join("").toUpperCase().slice(0, 2);

      const newUser: AuthUser = {
        userId: session.user.id,
        userName: name,
        userRole: profile?.role ?? "student",
        userRoles,
        userInitials: initials,
        instituteCode: profile?.institute_code ?? "",
        instituteName,
        // LOW-04: Default to "pending" instead of "active" for missing profiles
        status: profile?.status ?? "pending",
      };

      setAuthUser(newUser);
      setAuthLoading(false);
      writeCachedAuthUser(newUser);
    } catch {
      if (cachedUser) {
        setAuthUser(cachedUser);
        setAuthLoading(false);
        return;
      }
      setAuthUser(null);
      setAuthLoading(false);
      clearCachedAuthUser();
    }
  };

  // Ghost-session guard: if the token can't refresh (e.g. network down for
  // extended time), Supabase won't fire a specific failure event. We detect
  // this by periodically checking the session when the app regains focus.
  useEffect(() => {
    const verifySession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session && authUser) {
        if (typeof navigator !== "undefined" && !navigator.onLine) return;
        // Token expired and couldn't refresh → clear ghost session
        setAuthUser(null);
        setAuthLoading(false);
        clearCachedAuthUser();
        clearHubCache();
        clearMessagesCache();
      }
    };

    const onFocus = () => verifySession();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [authUser]);

  useEffect(() => {
    loadUser();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        setAuthUser(null);
        setAuthLoading(false);
        clearCachedAuthUser();
        clearHubCache();
        clearMessagesCache();
      } else if (event === "INITIAL_SESSION" && session?.user) {
        loadUser();
      } else if (event === "SIGNED_IN") {
        setAuthLoading(true);
        loadUser();
      } else if (event === "TOKEN_REFRESHED") {
        loadUser();
      }
    });
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AuthContext.Provider value={{ authUser, authLoading, refreshAuthUser: loadUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
