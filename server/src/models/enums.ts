// Mirrors the Postgres enums from the old Supabase schema.
export const APP_ROLES = [
  'super_admin',
  'admin',
  'hod',
  'user',
  'assigned_person',
  'PC',
  'Admin South',
] as const;
export type AppRole = (typeof APP_ROLES)[number];

export const TICKET_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const TICKET_STATUSES = ['open', 'in_progress', 'resolved', 'closed', 'reopened'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
