/**
 * Builds a PostgREST-style `.or()` string for a multi-column ilike search,
 * e.g. orIlike([["title","foo"],["ticket_number","foo"]])
 *   -> "title.ilike.%foo%,ticket_number.ilike.%foo%"
 *
 * Commas/parens are stripped from the term because the backend's .or()
 * parser (server/src/rest/filters.ts parseOrString) splits on unparenthesized
 * commas and matches "col.op.value" — either character would corrupt it.
 */
export function orIlike(pairs: Array<[column: string, term: string]>): string {
  const esc = (s: string) => s.replace(/[,()]/g, "");
  return pairs.map(([col, term]) => `${col}.ilike.%${esc(term)}%`).join(",");
}
