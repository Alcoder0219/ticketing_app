import { models } from '../models/index.js';
import type { AppRole } from '../models/enums.js';

const { user_roles, roles, profiles, role_plant_access, units } = models;

const ROLE_PRIORITY: Record<string, number> = {
  super_admin: 1,
  admin: 2,
  hod: 3,
  assigned_person: 4,
  user: 5,
};

// Display label per role key. The `roles` and `role_plant_access` tables may
// store rows under display names ("HOD") rather than the enum key ("hod"), so
// lookups match against both variants.
const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  hod: 'HOD',
  assigned_person: 'Team Member',
  user: 'User',
};

/** All name variants a role may be stored under (enum key + display label). */
export function roleNameVariants(role: string): string[] {
  return [role, ROLE_LABELS[role]].filter(Boolean) as string[];
}

/** Port of public.has_role(_user_id, _role). */
export async function hasRole(userId: string, role: AppRole): Promise<boolean> {
  return !!(await user_roles.exists({ user_id: userId, role }));
}

/** Port of public.get_user_role(_user_id): highest-priority role assigned. */
export async function getUserRole(userId: string): Promise<string | null> {
  const rows = await user_roles.find({ user_id: userId }).lean();
  if (!rows.length) return null;
  const list = rows.map((r) => r.role as string);
  const sorted = [...list].sort(
    (a, b) => (ROLE_PRIORITY[a] ?? 999) - (ROLE_PRIORITY[b] ?? 999),
  );
  return sorted[0] ?? null;
}

/** Port of public.get_user_department_id(_user_id). */
export async function getUserDepartmentId(userId: string): Promise<string | null> {
  const p = await profiles.findOne({ user_id: userId }).lean();
  return (p?.department_id as string) ?? null;
}

/** Port of public.user_can_view_all_tickets(_user_id): roles.permissions.tickets.viewAll. */
export async function userCanViewAllTickets(userId: string): Promise<boolean> {
  const ur = await user_roles.findOne({ user_id: userId }).lean();
  if (!ur) return false;
  const role = await roles.findOne({ name: { $in: roleNameVariants(ur.role) } }).lean();
  const perms = (role?.permissions ?? {}) as any;
  return perms?.tickets?.viewAll === true;
}

/**
 * Port of public.user_allowed_unit_names(_user_id).
 * Returns null = unrestricted (super_admin / no role / no access rows).
 */
export async function userAllowedUnitNames(userId: string): Promise<string[] | null> {
  if (await hasRole(userId, 'super_admin')) return null;
  const ur = await user_roles.findOne({ user_id: userId }).lean();
  if (!ur) return null;
  const rows = await role_plant_access
    .find({ role_name: { $in: roleNameVariants(ur.role) }, is_enabled: true })
    .lean();
  if (!rows.length) return null; // legacy roles: unrestricted
  return rows.map((r) => r.unit_name as string);
}

/** Port of public.user_allowed_unit_ids(_user_id). null = unrestricted. */
export async function userAllowedUnitIds(userId: string): Promise<string[] | null> {
  const names = await userAllowedUnitNames(userId);
  if (names === null) return null;
  if (names.length === 0) return [];
  const unitRows = await units.find({ name: { $in: names } }).lean();
  return unitRows.map((u) => u._id as string);
}

export interface AuthContext {
  userId: string;
  email: string;
  role: string | null;
  departmentId: string | null;
  allowedUnitIds: string[] | null; // null = unrestricted
  canViewAllTickets: boolean;
  isSuperAdmin: boolean;
  isAdmin: boolean;
  isHod: boolean;
}

/** Build the per-request authorization context (used by the query router). */
export async function buildAuthContext(userId: string, email: string): Promise<AuthContext> {
  const [role, departmentId, allowedUnitIds, canViewAllTickets, isSuperAdmin, isAdmin, isHod] =
    await Promise.all([
      getUserRole(userId),
      getUserDepartmentId(userId),
      userAllowedUnitIds(userId),
      userCanViewAllTickets(userId),
      hasRole(userId, 'super_admin'),
      hasRole(userId, 'admin'),
      hasRole(userId, 'hod'),
    ]);
  return {
    userId,
    email,
    role,
    departmentId,
    allowedUnitIds,
    canViewAllTickets,
    isSuperAdmin,
    isAdmin,
    isHod,
  };
}

/**
 * Port of the `view_tickets` RLS policy into a MongoDB filter.
 * Returns a Mongo query fragment that must be AND-ed with the caller's filters,
 * or `{}` when the user may see everything.
 */
export function ticketsVisibilityFilter(ctx: AuthContext): Record<string, unknown> {
  // Block 1: which tickets is the user related to / privileged for.
  const relatedClauses: Record<string, unknown>[] = [
    { raised_by: ctx.userId },
    { assigned_to: ctx.userId },
  ];
  if (ctx.departmentId) relatedClauses.push({ issue_department_id: ctx.departmentId });

  const canViewAll = ctx.isSuperAdmin || ctx.isAdmin || ctx.canViewAllTickets;
  const block1 = canViewAll ? {} : { $or: relatedClauses };

  // Block 2: plant/unit access restriction.
  let block2: Record<string, unknown> = {};
  if (!ctx.isSuperAdmin && ctx.allowedUnitIds !== null) {
    block2 = { unit_id: { $in: ctx.allowedUnitIds } };
  }

  const parts = [block1, block2].filter((p) => Object.keys(p).length > 0);
  if (parts.length === 0) return {};
  if (parts.length === 1) return parts[0];
  return { $and: parts };
}
