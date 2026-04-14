import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

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

const CACHE_KEY = "bh_auth_user";
const INST_NAME_CACHE_PREFIX = "bh_inst_name_";

const AuthContext = createContext<AuthContextType>({
  authUser: null,
  authLoading: true,
  refreshAuthUser: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authUser, setAuthUser] = useState<AuthUser | null>(() => {
    try {
      const cached = sessionStorage.getItem(CACHE_KEY);
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  });

  const [authLoading, setAuthLoading] = useState(!sessionStorage.getItem(CACHE_KEY));

  const loadUser = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      setAuthUser(null);
      setAuthLoading(false);
      sessionStorage.removeItem(CACHE_KEY);
      return;
    }

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

    const profile = profileRes.data;
    const userRoles = rolesRes.data?.map((r) => r.role) || [];

    let instituteName = profile?.institute_code ?? "";
    if (profile?.institute_code) {
      // MED-03: Cache institute name to avoid repeat network round-trips
      const cachedName = sessionStorage.getItem(`${INST_NAME_CACHE_PREFIX}${profile.institute_code}`);
      if (cachedName) {
        instituteName = cachedName;
      } else {
        const { data: inst } = await supabase
          .from("institutes")
          .select("institute_name, city")
          .eq("institute_code", profile.institute_code)
          .single();
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
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(newUser));
  };

  useEffect(() => {
    loadUser();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        setAuthUser(null);
        setAuthLoading(false);
        sessionStorage.removeItem(CACHE_KEY);
      } else if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
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
