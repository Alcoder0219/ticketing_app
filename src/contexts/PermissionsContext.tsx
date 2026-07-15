import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/integrations/api/client";
import { useAuth } from "@/contexts/AuthContext";

export type AppRole = "super_admin" | "admin" | "hod" | "user" | "assigned_person";

export interface Permissions {
  tickets: {
    create: boolean;
    viewAll: boolean;
    viewOwn: boolean;
    assign: boolean;
    updateStatus: boolean;
    close: boolean;
    delete: boolean;
  };
  dashboard: { view: boolean; scope: "all" | "department" | "own" };
  sidebar: {
    overview: boolean;
    analytics: boolean;
    summary: boolean;
    createTicket: boolean;
    myTickets: boolean;
    pendingTickets: boolean;
    assignedTickets: boolean;
    departmentTickets: boolean;
    pcReview: boolean;
    manageUsers: boolean;
    settings: boolean;
    aiAssistant: boolean;
    tutorialVideos: boolean;
  };
  department: "all" | "own";
}

export const FULL_PERMISSIONS: Permissions = {
  tickets: { create: true, viewAll: true, viewOwn: true, assign: true, updateStatus: true, close: true, delete: true },
  dashboard: { view: true, scope: "all" },
  sidebar: {
    overview: true, analytics: true, summary: true, createTicket: true, myTickets: true,
    pendingTickets: true, assignedTickets: true, departmentTickets: true, pcReview: true, manageUsers: true, settings: true, aiAssistant: true, tutorialVideos: true,
  },
  department: "all",
};

const EMPTY_PERMISSIONS: Permissions = {
  tickets: { create: false, viewAll: false, viewOwn: false, assign: false, updateStatus: false, close: false, delete: false },
  dashboard: { view: false, scope: "own" },
  sidebar: {
    overview: false, analytics: false, summary: false, createTicket: false, myTickets: false,
    pendingTickets: false, assignedTickets: false, departmentTickets: false, pcReview: false, manageUsers: false, settings: false, aiAssistant: false, tutorialVideos: true,
  },
  department: "own",
};

// Human-readable label per role key. Used to match the `roles` table whose
// rows may be stored under display names ("HOD") rather than the enum key
// ("hod"). Keep in sync with ROLE_OPTIONS in RolesPermissionsTab.
const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  hod: "HOD",
  assigned_person: "Team Member",
  user: "User",
};

// Built-in default permissions for each standard role. These are the fallback
// when the `roles` table has no matching customization row, so the standard
// roles always work even on a fresh database.
const BUILTIN_PERMISSIONS: Record<string, Permissions> = {
  super_admin: FULL_PERMISSIONS,
  admin: {
    ...FULL_PERMISSIONS,
    tickets: { ...FULL_PERMISSIONS.tickets, delete: false }, // delete is super-admin only
  },
  hod: {
    tickets: { create: true, viewAll: false, viewOwn: true, assign: true, updateStatus: true, close: true, delete: false },
    dashboard: { view: true, scope: "department" },
    sidebar: {
      overview: true, analytics: true, summary: true, createTicket: true, myTickets: true,
      pendingTickets: true, assignedTickets: true, departmentTickets: true, pcReview: false,
      manageUsers: false, settings: false, aiAssistant: true, tutorialVideos: true,
    },
    department: "own",
  },
  assigned_person: {
    tickets: { create: true, viewAll: false, viewOwn: true, assign: false, updateStatus: true, close: true, delete: false },
    dashboard: { view: true, scope: "own" },
    sidebar: {
      overview: true, analytics: false, summary: false, createTicket: true, myTickets: true,
      pendingTickets: false, assignedTickets: true, departmentTickets: false, pcReview: false,
      manageUsers: false, settings: false, aiAssistant: true, tutorialVideos: true,
    },
    department: "own",
  },
  user: {
    tickets: { create: true, viewAll: false, viewOwn: true, assign: false, updateStatus: false, close: false, delete: false },
    dashboard: { view: false, scope: "own" },
    sidebar: {
      overview: true, analytics: false, summary: false, createTicket: true, myTickets: true,
      pendingTickets: false, assignedTickets: false, departmentTickets: false, pcReview: false,
      manageUsers: false, settings: false, aiAssistant: true, tutorialVideos: true,
    },
    department: "own",
  },
};

/**
 * Resolve a role's permissions: prefer a matching row from the `roles` table
 * (matched flexibly by enum key OR display label, case-insensitive, so the
 * lookup is robust to display-name vs enum-key drift), then fall back to the
 * built-in defaults, then to empty.
 */
function resolvePermissions(role: string, rolesData: any[]): Permissions {
  const target = role.toLowerCase();
  const label = (ROLE_LABELS[role] ?? "").toLowerCase();
  const row = rolesData.find((r) => {
    const n = String(r?.name ?? "").toLowerCase();
    return n === target || (!!label && n === label);
  });
  if (row?.permissions) return row.permissions as Permissions;
  return BUILTIN_PERMISSIONS[role] ?? EMPTY_PERMISSIONS;
}


interface PermissionsContextType {
  permissions: Permissions;
  isSuperAdmin: boolean;
  loading: boolean;
}

const PermissionsContext = createContext<PermissionsContextType | undefined>(undefined);

export function PermissionsProvider({ children }: { children: ReactNode }) {
  const { role, loading: authLoading } = useAuth();
  const [permissions, setPermissions] = useState<Permissions>(EMPTY_PERMISSIONS);
  const [loading, setLoading] = useState(true);

  const isSuperAdmin = role === "super_admin";

  useEffect(() => {
    if (authLoading) return;
    if (!role) {
      setPermissions(EMPTY_PERMISSIONS);
      setLoading(false);
      return;
    }
    if (isSuperAdmin) {
      setPermissions(FULL_PERMISSIONS);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("roles" as any)
        .select("name,permissions");
      if (cancelled) return;
      setPermissions(resolvePermissions(role, (data as any[]) ?? []));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [role, authLoading, isSuperAdmin]);

  return (
    <PermissionsContext.Provider value={{ permissions, isSuperAdmin, loading }}>
      {children}
    </PermissionsContext.Provider>
  );
}

export function usePermissions() {
  const ctx = useContext(PermissionsContext);
  if (!ctx) {
    // Fail-safe: return empty permissions instead of throwing to avoid blank screens
    return { permissions: EMPTY_PERMISSIONS, isSuperAdmin: false, loading: true };
  }
  return ctx;
}
