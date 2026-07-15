/**
 * Parses a PostgREST-style `select` string into base columns and embedded
 * resources. Example:
 *   "*, raiser:profiles!tickets_raised_by_fkey(name, employee_id), unit:units(name)"
 * =>
 *   base:   ["*"]
 *   embeds: [
 *     { alias: "raiser", table: "profiles", constraint: "tickets_raised_by_fkey", columns: ["name","employee_id"] },
 *     { alias: "unit",   table: "units",     constraint: undefined,                columns: ["name"] },
 *   ]
 */
export interface EmbedSpec {
  alias: string;
  table: string;
  constraint?: string;
  columns: string[]; // [] or ["*"] means all
}

export interface ParsedSelect {
  base: string[]; // [] or ["*"] means all top-level columns
  embeds: EmbedSpec[];
}

/** Split a comma list respecting parenthesis depth. */
function splitTopLevel(input: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of input) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function parseSelect(select: string | undefined): ParsedSelect {
  const result: ParsedSelect = { base: [], embeds: [] };
  if (!select || !select.trim()) {
    result.base = ['*'];
    return result;
  }
  for (const token of splitTopLevel(select)) {
    const parenIdx = token.indexOf('(');
    if (parenIdx === -1) {
      result.base.push(token.trim());
      continue;
    }
    // embed: [alias:]table[!constraint](cols)
    const head = token.slice(0, parenIdx).trim();
    const cols = token.slice(parenIdx + 1, token.lastIndexOf(')')).trim();
    let alias = '';
    let rest = head;
    const colonIdx = head.indexOf(':');
    if (colonIdx !== -1) {
      alias = head.slice(0, colonIdx).trim();
      rest = head.slice(colonIdx + 1).trim();
    }
    let table = rest;
    let constraint: string | undefined;
    const bangIdx = rest.indexOf('!');
    if (bangIdx !== -1) {
      table = rest.slice(0, bangIdx).trim();
      constraint = rest.slice(bangIdx + 1).trim();
    }
    result.embeds.push({
      alias: alias || table,
      table,
      constraint,
      columns: cols
        ? splitTopLevel(cols).map((c) => c.trim()).filter(Boolean)
        : [],
    });
  }
  if (result.base.length === 0) result.base = ['*'];
  return result;
}

/** Project a plain object down to the requested columns (id always kept). */
export function projectColumns(row: Record<string, any>, columns: string[]): Record<string, any> {
  if (!columns.length || columns.includes('*')) return row;
  const out: Record<string, any> = {};
  if (row.id !== undefined) out.id = row.id;
  for (const c of columns) {
    if (c === '*') return row;
    if (row[c] !== undefined) out[c] = row[c];
  }
  return out;
}
