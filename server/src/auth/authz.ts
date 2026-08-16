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

/**
 * The `roles` row for a user's highest-priority role.
 * Resolving through getUserRole() (rather than an arbitrary user_roles.findOne())
 * matters for users holding more than one role — otherwise the permissions of a
 * lower-privilege role could win at random.
 */
async function getRolePermissions(userId: string): Promise<Record<string, any>> {
  const role = await getUserRole(userId);
  if (!role) return {};
  const row = await roles.findOne({ name: { $in: roleNameVariants(role) } }).lean();
  return ((row?.permissions ?? {}) as Record<string, any>) ?? {};
}

/** Port of public.user_can_view_all_tickets(_user_id): roles.permissions.tickets.viewAll. */
export async function userCanViewAllTickets(userId: string): Promise<boolean> {
  const perms = await getRolePermissions(userId);
  return perms?.tickets?.viewAll === true;
}

/** Department data restriction configured on the role ("all" | "own"). */
export async function getUserDepartmentScope(userId: string): Promise<'all' | 'own'> {
  const perms = await getRolePermissions(userId);
  return perms?.department === 'own' ? 'own' : 'all';
}

// ─────────────────────────────────────────────────────────────────────────────
// Effective plant / unit access
// ─────────────────────────────────────────────────────────────────────────────

export type PlantScopeType =
  /** Super admin, or a role with no plant-access rows at all (legacy config). */
  | 'UNRESTRICTED'
  /** Role's Plant / Unit Access Control list (Own Plant Only = OFF). */
  | 'MULTI_PLANT'
  /** Own Plant Only = ON — the user's individually assigned plant. */
  | 'OWN_PLANT'
  /** Configured, but nothing is reachable — deny everything. */
  | 'NONE';

export interface EffectivePlantAccess {
  scopeType: PlantScopeType;
  /** null ⇔ UNRESTRICTED. `[]` means "deny all", never "allow all". */
  unitIds: string[] | null;
  unitNames: string[] | null;
}

const UNRESTRICTED: EffectivePlantAccess = {
  scopeType: 'UNRESTRICTED',
  unitIds: null,
  unitNames: null,
};

const DENY_ALL: EffectivePlantAccess = {
  scopeType: 'NONE',
  unitIds: [],
  unitNames: [],
};

/**
 * Single source of truth for "which plants may this user actually see".
 *
 * Precedence, highest first:
 *   1. super_admin                      → UNRESTRICTED
 *   2. role has no plant-access rows    → UNRESTRICTED (legacy roles, pre-dating
 *                                         the Plant / Unit Access Control UI)
 *   3. own_plant_only = ON              → OWN_PLANT: the user's assigned unit only,
 *                                         regardless of which plants the role enables
 *   4. otherwise                        → MULTI_PLANT: every unit the role enables
 *
 * Note the user's assigned unit (`profiles.unit_id`) is deliberately NOT a filter
 * in case 4 — a role granting several plants must not be narrowed back down to the
 * one plant the user happens to be posted at.
 */
export async function getEffectivePlantAccess(userId: string): Promise<EffectivePlantAccess> {
  if (await hasRole(userId, 'super_admin')) return UNRESTRICTED;

  const role = await getUserRole(userId);
  if (!role) return UNRESTRICTED;

  const rows = await role_plant_access
    .find({ role_name: { $in: roleNameVariants(role) } })
    .lean();

  // No configuration at all — legacy role, keep the historical open behaviour.
  if (!rows.length) return UNRESTRICTED;

  // Own Plant Only wins over the per-plant toggles. Read from any row: the UI
  // writes the same value to every row of a role, and taking `.some()` is the
  // restrictive reading if legacy data is inconsistent.
  if (rows.some((r: any) => r.own_plant_only === true)) {
    const profile = await profiles.findOne({ user_id: userId }).lean();
    const ownUnitId = (profile?.unit_id as string | null) ?? null;
    if (!ownUnitId) return DENY_ALL; // no assigned plant ⇒ nothing to scope to
    const unit = await units.findOne({ _id: ownUnitId }).lean();
    return {
      scopeType: 'OWN_PLANT',
      unitIds: [ownUnitId],
      unitNames: unit ? [unit.name as string] : [],
    };
  }

  const enabledNames = rows
    .filter((r: any) => r.is_enabled)
    .map((r: any) => r.unit_name as string);

  // Rows exist but every plant is toggled off — deny, never fall through to
  // "unrestricted". This is the fail-closed case the old code got wrong.
  if (!enabledNames.length) return DENY_ALL;

  const unitRows = await units.find({ name: { $in: enabledNames } }).lean();
  return {
    scopeType: 'MULTI_PLANT',
    unitIds: unitRows.map((u: any) => u._id as string),
    unitNames: enabledNames,
  };
}

/**
 * Port of public.user_allowed_unit_names(_user_id).
 * Returns null = unrestricted (super_admin / no role / no access rows).
 */
export async function userAllowedUnitNames(userId: string): Promise<string[] | null> {
  return (await getEffectivePlantAccess(userId)).unitNames;
}

/** Port of public.user_allowed_unit_ids(_user_id). null = unrestricted. */
export async function userAllowedUnitIds(userId: string): Promise<string[] | null> {
  return (await getEffectivePlantAccess(userId)).unitIds;
}

export interface AuthContext {
  userId: string;
  email: string;
  role: string | null;
  departmentId: string | null;
  departmentScope: 'all' | 'own';
  plantAccess: EffectivePlantAccess;
  allowedUnitIds: string[] | null; // null = unrestricted (alias of plantAccess.unitIds)
  canViewAllTickets: boolean;
  isSuperAdmin: boolean;
  isAdmin: boolean;
  isHod: boolean;
}

/** Build the per-request authorization context (used by the query router). */
export async function buildAuthContext(userId: string, email: string): Promise<AuthContext> {
  const [
    role,
    departmentId,
    departmentScope,
    plantAccess,
    canViewAllTickets,
    isSuperAdmin,
    isAdmin,
    isHod,
  ] = await Promise.all([
    getUserRole(userId),
    getUserDepartmentId(userId),
    getUserDepartmentScope(userId),
    getEffectivePlantAccess(userId),
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
    departmentScope,
    plantAccess,
    allowedUnitIds: plantAccess.unitIds,
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
 *
 * The three blocks are independent restrictions and are AND-ed together, so a
 * wide plant scope can never widen the department scope (or vice versa).
 */
export function ticketsVisibilityFilter(ctx: AuthContext): Record<string, unknown> {
  if (ctx.isSuperAdmin) return {};

  const parts: Record<string, unknown>[] = [];

  // Block 1: which tickets is the user related to / privileged for.
  const canViewAll = ctx.isAdmin || ctx.canViewAllTickets;
  if (!canViewAll) {
    const relatedClauses: Record<string, unknown>[] = [
      { raised_by: ctx.userId },
      { assigned_to: ctx.userId },
    ];
    if (ctx.departmentId) relatedClauses.push({ issue_department_id: ctx.departmentId });
    parts.push({ $or: relatedClauses });
  }

  // Block 2: plant/unit access restriction.
  if (ctx.plantAccess.unitIds !== null) {
    parts.push({ unit_id: { $in: ctx.plantAccess.unitIds } });
  }

  // Block 3: department data restriction ("Access own department data only").
  // For roles without viewAll this is already implied by block 1; it matters for
  // roles that combine View All Tickets with an own-department restriction.
  if (ctx.departmentScope === 'own') {
    const deptClauses: Record<string, unknown>[] = [
      { raised_by: ctx.userId },
      { assigned_to: ctx.userId },
    ];
    if (ctx.departmentId) {
      deptClauses.push({ issue_department_id: ctx.departmentId });
      deptClauses.push({ department_id: ctx.departmentId });
    }
    parts.push({ $or: deptClauses });
  }

  if (parts.length === 0) return {};
  if (parts.length === 1) return parts[0];
  return { $and: parts };
}
