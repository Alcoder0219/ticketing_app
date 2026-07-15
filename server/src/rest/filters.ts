/**
 * Translates PostgREST-style filter operators into MongoDB query fragments.
 * Used by the query router for `.eq()`, `.in()`, `.ilike()`, `.or()`, etc.
 */

export interface FilterClause {
  column: string;
  op: string;
  value: unknown;
}

function likeToRegex(pattern: string): RegExp {
  // PostgREST/SQL LIKE: % => .*, _ => .
  const escaped = String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = escaped.replace(/%/g, '.*').replace(/_/g, '.');
  return new RegExp(`^${re}$`);
}

function ilikeToRegex(pattern: string): RegExp {
  const escaped = String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = escaped.replace(/%/g, '.*').replace(/_/g, '.');
  return new RegExp(`^${re}$`, 'i');
}

/** Map a column name to the underlying Mongo field (id -> _id). */
export function toMongoField(column: string): string {
  return column === 'id' ? '_id' : column;
}

/** Normalise a PostgREST `in` value: array, "a,b,c", or "(a,b,c)". */
function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return String(value).replace(/^\(/, '').replace(/\)$/, '').split(',').map((s) => s.trim());
}

/** Build a Mongo condition for a single operator on a column. */
export function opToMongo(op: string, value: unknown): unknown {
  // Negated operators from `.not(col, op, value)` arrive as "not.<op>".
  if (op.startsWith('not.')) {
    const inner = op.slice(4);
    if (inner === 'in') return { $nin: toArray(value) };
    if (inner === 'is') return { $ne: opToMongo('is', value) };
    if (inner === 'eq') return { $ne: value };
    // gt/gte/lt/lte/like/ilike all return operator-objects/regex that $not accepts.
    return { $not: opToMongo(inner, value) as any };
  }
  switch (op) {
    case 'eq':
      return value;
    case 'neq':
      return { $ne: value };
    case 'gt':
      return { $gt: value };
    case 'gte':
      return { $gte: value };
    case 'lt':
      return { $lt: value };
    case 'lte':
      return { $lte: value };
    case 'in':
      return { $in: toArray(value) };
    case 'like':
      return likeToRegex(String(value));
    case 'ilike':
      return ilikeToRegex(String(value));
    case 'is':
      // .is('col', null) / .is('col', true/false)
      if (value === null || value === 'null') return null;
      if (value === true || value === 'true') return true;
      if (value === false || value === 'false') return false;
      return value;
    case 'not':
      return { $ne: value };
    case 'contains':
      // jsonb/array contains -> Mongo $all for arrays
      return { $all: Array.isArray(value) ? value : [value] };
    default:
      return value;
  }
}

export function clauseToMongo(clause: FilterClause): Record<string, unknown> {
  const field = toMongoField(clause.column);
  return { [field]: opToMongo(clause.op, clause.value) };
}

/**
 * Parse a PostgREST `.or()` string into a Mongo $or array.
 * e.g. "raised_by.eq.uid,assigned_to.eq.uid,status.in.(open,closed)"
 */
export function parseOrString(orStr: string): Record<string, unknown>[] {
  const clauses: Record<string, unknown>[] = [];
  // split on commas that are not inside parentheses (for in.(a,b,c))
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of orStr) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) parts.push(cur);

  for (const part of parts) {
    const m = part.match(/^([^.]+)\.([^.]+)\.(.*)$/);
    if (!m) continue;
    const [, column, op, rawValue] = m;
    let value: unknown = rawValue;
    if (op === 'in') {
      value = rawValue.replace(/^\(/, '').replace(/\)$/, '').split(',');
    } else if (rawValue === 'null') {
      value = null;
    }
    clauses.push(clauseToMongo({ column, op, value }));
  }
  return clauses;
}
