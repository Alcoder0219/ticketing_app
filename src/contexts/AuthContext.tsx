import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/integrations/api/client";
import type { Session, AuthUser as User } from "@/integrations/api/types";

type AppRole = "super_admin" | "admin" | "hod" | "user" | "assigned_person";

// Display label per role key — used to match rows (role_plant_access, roles)
// that may be stored under display names ("HOD") instead of the enum key.
const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  hod: "HOD",
  assigned_person: "Team Member",
  user: "User",
};

interface Profile {
  id: string;
  user_id: string;
  name: string;
  username: string | null;
  employee_id: string | null;
  department_id: string | null;
  contact: string | null;
  avatar_url: string | null;
  profile_picture?: string | null;
  unit_id?: string | null;
}

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  role: AppRole | null;
  loading: boolean;
  allowedUnitNames: string[] | null; // null = no restriction (super admin / no role)
  allowedUnitIds: string[] | null;   // null = no restriction
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, name: string, employeeId?: string, contact?: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

// Using a module-level variable helps survive HMR in development
const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [allowedUnitNames, setAllowedUnitNames] = useState<string[] | null>(null);
  const [allowedUnitIds, setAllowedUnitIds] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfileAndRole = async (userId: string) => {
    const [profileRes, rolesRes] = await Promise.all([
      supabase.from("profiles").select("*").eq("user_id", userId).single(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
    ]);
    if (profileRes.data) setProfile(profileRes.data as Profile);
    // A user may have multiple roles; pick the highest-privilege one.
    // Fall back to the first assigned role to support custom roles not in the priority list.
    const priority: AppRole[] = ["super_admin", "admin", "hod", "assigned_person", "user"];
    const roles = ((rolesRes.data ?? []) as { role: AppRole }[]).map((x) => x.role);
    const r = priority.find((p) => roles.includes(p)) ?? roles[0] ?? null;
    if (r) setRole(r);



    // Compute allowed units (super_admin = unrestricted)
    if (r === "super_admin" || !r) {
      setAllowedUnitNames(null);
      setAllowedUnitIds(null);
      return;
    }
    const roleNameVariants = [r, ROLE_LABELS[r]].filter(Boolean);
    const { data: accessRows } = await supabase
      .from("role_plant_access" as any)
      .select("unit_name,is_enabled,own_plant_only")
      .in("role_name", roleNameVariants);

    // own_plant_only: restrict to the user's own assigned plant only
    const ownPlantOnly = (accessRows || []).some((x: any) => x.own_plant_only);
    if (ownPlantOnly) {
      const userUnitId = (profileRes.data as any)?.unit_id ?? null;
      if (userUnitId) {
        const { data: unitRow } = await supabase
          .from("units").select("id,name").eq("id", userUnitId).maybeSingle();
        if (unitRow) {
          setAllowedUnitNames([unitRow.name]);
          setAllowedUnitIds([unitRow.id]);
          return;
        }
      }
      // User has no assigned unit — deny all
      setAllowedUnitNames([]);
      setAllowedUnitIds([]);
      return;
    }

    const enabledNames = (accessRows || [])
      .filter((x: any) => x.is_enabled)
      .map((x: any) => x.unit_name as string);
    // If no rows at all, treat as unrestricted (legacy roles)
    if (!accessRows || accessRows.length === 0) {
      setAllowedUnitNames(null);
      setAllowedUnitIds(null);
      return;
    }
    setAllowedUnitNames(enabledNames);
    const { data: unitRows } = await supabase
      .from("units").select("id,name").in("name", enabledNames.length ? enabledNames : ["__none__"]);
    setAllowedUnitIds((unitRows || []).map((u: any) => u.id));
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          setTimeout(() => fetchProfileAndRole(session.user.id), 0);
        } else {
          setProfile(null);
          setRole(null);
        }
        setLoading(false);
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfileAndRole(session.user.id);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error as Error | null };
  };

  const signUp = async (email: string, password: string, name: string, employeeId?: string, contact?: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name, employee_id: employeeId, contact } },
    });
    return { error: error as Error | null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setRole(null);
  };

  const refreshProfile = async () => {
    if (user?.id) await fetchProfileAndRole(user.id);
  };

  return (
    <AuthContext.Provider value={{ session, user, profile, role, loading, allowedUnitNames, allowedUnitIds, signIn, signUp, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
