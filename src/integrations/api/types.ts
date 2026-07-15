// Shared domain types for the app (replaces the old generated Supabase
// `Database` types). Mirrors the enums defined in the backend.

export type AppRole =
  | 'super_admin'
  | 'admin'
  | 'hod'
  | 'user'
  | 'assigned_person'
  | 'PC'
  | 'Admin South';

export type TicketPriority = 'low' | 'medium' | 'high' | 'critical';

export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed' | 'reopened';

export type { AuthUser, Session } from './auth';
