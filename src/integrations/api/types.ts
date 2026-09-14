// Shared domain types for the app (replaces the old generated Supabase
// `Database` types). Mirrors the enums defined in the backend.

// The built-in canonical roles, plus (via `string & {}`) any custom role name
// defined in the dynamic Roles & Permissions collection — see ManageUsers.tsx
// and PermissionsContext.tsx, which resolve a role by matching this string
// against the live `roles` table. Kept open rather than a closed union so a
// role created at runtime type-checks without a frontend code change.
export type AppRole =
  | 'super_admin'
  | 'admin'
  | 'hod'
  | 'user'
  | 'assigned_person'
  | 'PC'
  | 'Admin South'
  | (string & {});

export type TicketPriority = 'low' | 'medium' | 'high' | 'critical';

export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed' | 'reopened';

export type { AuthUser, Session } from './auth';
