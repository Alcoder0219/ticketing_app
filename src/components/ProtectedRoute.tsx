import { useAuth } from "@/contexts/AuthContext";
import { usePermissions, Permissions } from "@/contexts/PermissionsContext";
import { Navigate } from "react-router-dom";

type AppRole = "super_admin" | "admin" | "hod" | "user" | "assigned_person";

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: AppRole[];
  permissionKey?: keyof Permissions["sidebar"];
}

export function ProtectedRoute({ children, allowedRoles, permissionKey }: ProtectedRouteProps) {
  const { session, role, loading } = useAuth();
  const { permissions, isSuperAdmin, loading: permsLoading } = usePermissions();

  if (loading || permsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!session) return <Navigate to="/login" replace />;

  // Role-based access (legacy hard guard — kept as-is)
  if (allowedRoles && role && !allowedRoles.includes(role)) {
    return <Navigate to="/" replace />;
  }
  if (allowedRoles && !role) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  // Permission-key check (new, dynamic from roles table)
  if (permissionKey && !isSuperAdmin && !permissions?.sidebar?.[permissionKey]) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
