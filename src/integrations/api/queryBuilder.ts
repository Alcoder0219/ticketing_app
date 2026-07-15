// A PostgREST-compatible query builder that mirrors the subset of the
// supabase-js API used across this app, backed by POST /rest/query.
import { apiFetch, type ApiResult } from './http';

interface FilterClause {
  column: string;
  op: string;
  value: unknown;
}

interface OrderSpec {
  column: string;
  ascending?: boolean;
  nullsFirst?: boolean;
}

type Action = 'select' | 'insert' | 'update' | 'delete' | 'upsert';

export class QueryBuilder<T = any> implements PromiseLike<ApiResult<T>> {
  private table: string;
  private action: Action | null = null;
  private selectStr?: string;
  private filters: FilterClause[] = [];
  private orFilter?: string;
  private orders: OrderSpec[] = [];
  private _limit?: number;
  private _offset?: number;
  private _range?: { from: number; to: number };
  private _single = false;
  private _maybeSingle = false;
  private _count?: 'exact' | 'planned' | 'estimated';
  private _head = false;
  private _returning = false;
  private values?: any;
  private onConflict?: string;

  constructor(table: string) {
    this.table = table;
  }

  // ── Action setters ──────────────────────────────────────────────────────
  select(columns = '*', opts?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }) {
    if (this.action === null) this.action = 'select';
    else this._returning = true;
    this.selectStr = columns;
    if (opts?.count) this._count = opts.count;
    if (opts?.head) this._head = true;
    return this;
  }

  insert(values: any) {
    this.action = 'insert';
    this.values = values;
    return this;
  }

  update(values: any) {
    this.action = 'update';
    this.values = values;
    return this;
  }

  delete() {
    this.action = 'delete';
    return this;
  }

  upsert(values: any, opts?: { onConflict?: string }) {
    this.action = 'upsert';
    this.values = values;
    this.onConflict = opts?.onConflict;
    return this;
  }

  // ── Filters ─────────────────────────────────────────────────────────────
  private addFilter(column: string, op: string, value: unknown) {
    this.filters.push({ column, op, value });
    return this;
  }
  eq(c: string, v: unknown) { return this.addFilter(c, 'eq', v); }
  neq(c: string, v: unknown) { return this.addFilter(c, 'neq', v); }
  gt(c: string, v: unknown) { return this.addFilter(c, 'gt', v); }
  gte(c: string, v: unknown) { return this.addFilter(c, 'gte', v); }
  lt(c: string, v: unknown) { return this.addFilter(c, 'lt', v); }
  lte(c: string, v: unknown) { return this.addFilter(c, 'lte', v); }
  like(c: string, v: string) { return this.addFilter(c, 'like', v); }
  ilike(c: string, v: string) { return this.addFilter(c, 'ilike', v); }
  in(c: string, v: unknown[]) { return this.addFilter(c, 'in', v); }
  is(c: string, v: unknown) { return this.addFilter(c, 'is', v); }
  contains(c: string, v: unknown) { return this.addFilter(c, 'contains', v); }
  not(c: string, op: string, v: unknown) {
    // PostgREST .not('status','in','(a,b)') — model as a negated filter.
    return this.addFilter(c, `not.${op}`, v);
  }
  or(filterStr: string) {
    this.orFilter = filterStr;
    return this;
  }
  filter(c: string, op: string, v: unknown) { return this.addFilter(c, op, v); }
  match(obj: Record<string, unknown>) {
    for (const [k, v] of Object.entries(obj)) this.addFilter(k, 'eq', v);
    return this;
  }

  // ── Modifiers ───────────────────────────────────────────────────────────
  order(column: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) {
    this.orders.push({ column, ascending: opts?.ascending ?? true, nullsFirst: opts?.nullsFirst });
    return this;
  }
  limit(n: number) { this._limit = n; return this; }
  range(from: number, to: number) { this._range = { from, to }; return this; }
  single() { this._single = true; return this.exec(); }
  maybeSingle() { this._maybeSingle = true; return this.exec(); }

  // ── Execution ───────────────────────────────────────────────────────────
  private buildBody() {
    return {
      table: this.table,
      action: this.action ?? 'select',
      select: this.selectStr,
      filters: this.filters,
      or: this.orFilter,
      order: this.orders,
      limit: this._limit,
      offset: this._offset,
      range: this._range,
      single: this._single,
      maybeSingle: this._maybeSingle,
      count: this._count,
      head: this._head,
      returning: this.action === 'select' ? true : this._returning,
      values: this.values,
      onConflict: this.onConflict,
    };
  }

  private async exec(): Promise<ApiResult<T>> {
    try {
      const { body, status } = await apiFetch<ApiResult<T>>('/rest/query', {
        method: 'POST',
        body: JSON.stringify(this.buildBody()),
      });
      return { data: body?.data ?? null, error: body?.error ?? null, count: body?.count ?? null, status };
    } catch (err: any) {
      return { data: null, error: { message: err?.message ?? 'Network error' }, status: 0 };
    }
  }

  then<R1 = ApiResult<T>, R2 = never>(
    onfulfilled?: ((value: ApiResult<T>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: any) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.exec().then(onfulfilled, onrejected);
  }
}
