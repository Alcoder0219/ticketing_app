/**
 * Foreign-key registry, ported from the old Supabase/Postgres relationships.
 * Powers PostgREST-style embedded selects such as:
 *   select("*, raiser:profiles!tickets_raised_by_fkey(name)")
 *
 * Convention in this schema: `profiles` is always referenced by its `user_id`
 * column; every other table is referenced by its `id`.
 */
export interface Relationship {
  table: string; // owning (child) table
  column: string; // local FK column on `table`
  refTable: string; // referenced (parent) table
  refColumn: string; // referenced column on refTable
}

export const RELATIONSHIPS: Relationship[] = [
  { table: 'ai_messages', column: 'conversation_id', refTable: 'ai_conversations', refColumn: 'id' },
  { table: 'departments', column: 'unit_id', refTable: 'units', refColumn: 'id' },
  { table: 'notifications', column: 'ticket_id', refTable: 'tickets', refColumn: 'id' },
  { table: 'profiles', column: 'department_id', refTable: 'departments', refColumn: 'id' },
  { table: 'profiles', column: 'unit_id', refTable: 'units', refColumn: 'id' },
  { table: 'ticket_attachments', column: 'ticket_id', refTable: 'tickets', refColumn: 'id' },
  { table: 'ticket_attachments', column: 'uploaded_by', refTable: 'profiles', refColumn: 'user_id' },
  { table: 'ticket_history', column: 'ticket_id', refTable: 'tickets', refColumn: 'id' },
  { table: 'ticket_history', column: 'performed_by', refTable: 'profiles', refColumn: 'user_id' },
  { table: 'ticket_messages', column: 'ticket_id', refTable: 'tickets', refColumn: 'id' },
  { table: 'ticket_ratings', column: 'ticket_id', refTable: 'tickets', refColumn: 'id' },
  { table: 'ticket_ratings', column: 'rated_by', refTable: 'profiles', refColumn: 'user_id' },
  { table: 'ticket_work_logs', column: 'ticket_id', refTable: 'tickets', refColumn: 'id' },
  { table: 'ticket_work_logs', column: 'logged_by', refTable: 'profiles', refColumn: 'user_id' },
  { table: 'tickets', column: 'raised_by', refTable: 'profiles', refColumn: 'user_id' },
  { table: 'tickets', column: 'assigned_to', refTable: 'profiles', refColumn: 'user_id' },
  { table: 'tickets', column: 'closed_by', refTable: 'profiles', refColumn: 'user_id' },
  { table: 'tickets', column: 'resolved_by', refTable: 'profiles', refColumn: 'user_id' },
  { table: 'tickets', column: 'department_id', refTable: 'departments', refColumn: 'id' },
  { table: 'tickets', column: 'issue_department_id', refTable: 'departments', refColumn: 'id' },
  { table: 'tickets', column: 'unit_id', refTable: 'units', refColumn: 'id' },
];

/**
 * Resolve an embedded-select target into the concrete join.
 * @param parent  the table being queried (e.g. "tickets")
 * @param target  the embed target table (e.g. "profiles")
 * @param constraint  optional FK constraint name from `target!constraint(...)`
 *                    (e.g. "tickets_raised_by_fkey")
 */
export function resolveRelationship(
  parent: string,
  target: string,
  constraint?: string,
): Relationship | null {
  if (constraint) {
    // Convention: "<parentTable>_<localColumn>_fkey"
    const m = constraint.match(/^(.*)_fkey$/);
    if (m) {
      const body = m[1];
      const prefix = `${parent}_`;
      const column = body.startsWith(prefix) ? body.slice(prefix.length) : body;
      const found = RELATIONSHIPS.find(
        (r) => r.table === parent && r.column === column && r.refTable === target,
      );
      if (found) return found;
    }
  }
  // No constraint: succeed only if the FK is unambiguous.
  const candidates = RELATIONSHIPS.filter((r) => r.table === parent && r.refTable === target);
  if (candidates.length === 1) return candidates[0];
  return null;
}
