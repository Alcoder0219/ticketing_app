// The built-in canonical roles — these carry special-cased business logic
// elsewhere in the app (dashboard scoping, ticket visibility, etc.) and
// always remain assignable even if the `roles` collection has no matching
// row yet (e.g. a fresh database). Beyond these, any role name that exists
// in the dynamic Roles & Permissions collection is also a valid AppRole —
// see `isAssignableRole` in auth/service.ts, which is the actual runtime
// boundary. This union is intentionally open (`string & {}`) rather than a
// closed enum so a custom role created at runtime type-checks without a
// code change, while known literals still get autocomplete.
export const APP_ROLES = [
  'super_admin',
  'admin',
  'hod',
  'user',
  'assigned_person',
  'PC',
  'Admin South',
] as const;
export type AppRole = (typeof APP_ROLES)[number] | (string & {});

export const TICKET_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const TICKET_STATUSES = ['open', 'in_progress', 'resolved', 'closed', 'reopened'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
