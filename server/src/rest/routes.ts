import { Router } from 'express';
import { getModel, models } from '../models/index.js';
import { requireAuth } from '../auth/middleware.js';
import { ticketsVisibilityFilter, type AuthContext } from '../auth/authz.js';
import { resolveRelationship } from '../models/relationships.js';
import { parseSelect, projectColumns, type EmbedSpec } from './selectParser.js';
import { clauseToMongo, parseOrString, toMongoField, type FilterClause } from './filters.js';
import { emitChange } from '../realtime/io.js';
import {
  notifyTicketRaised,
  notifyTicketUpdated,
  notifyRatingSubmitted,
  verifyRatingToken,
} from '../notifications/service.js';

export const restRouter = Router();

interface QueryBody {
  table: string;
  action: 'select' | 'insert' | 'update' | 'delete' | 'upsert';
  select?: string;
  filters?: FilterClause[];
  or?: string;
  order?: { column: string; ascending?: boolean; nullsFirst?: boolean }[];
  limit?: number;
  offset?: number;
  range?: { from: number; to: number };
  single?: boolean;
  maybeSingle?: boolean;
  count?: 'exact' | 'planned' | 'estimated' | null;
  head?: boolean;
  values?: Record<string, any> | Record<string, any>[];
  onConflict?: string;
  returning?: boolean;
  /** Signed token from a "Rate This Ticket" email link. */
  ratingToken?: string;
}

/** Build the combined Mongo filter from explicit clauses + an optional or-string. */
function buildFilter(body: QueryBody): Record<string, any> {
  const and: Record<string, any>[] = [];
  for (const c of body.filters ?? []) and.push(clauseToMongo(c));
  if (body.or) and.push({ $or: parseOrString(body.or) });
  if (and.length === 0) return {};
  if (and.length === 1) return and[0];
  return { $and: and };
}

/** Apply the ported RLS visibility rules for SELECT on a given table. */
function authFilterFor(table: string, ctx: AuthContext): Record<string, any> {
  if (table === 'tickets') return ticketsVisibilityFilter(ctx);
  // Other tables: authenticated access (granular per-table policies can be
  // layered here as additional cases — see authz.ts).
  return {};
}

/**
 * Ticket notifications are dispatched from here rather than from each caller.
 *
 * Every ticket write in this app goes through the generic query router — there
 * are no ticket controllers — so this is the one place that sees all of them.
 * Hooking here means no ticket business logic changes, and a client cannot skip
 * a notification by calling the API directly.
 *
 * Fire-and-forget by design: the response is never delayed by an email, and a
 * notification failure can never turn a successful write into an error.
 */
function fireAndForget(label: string, run: () => Promise<void>) {
  void run().catch((err) => console.error(`[notify] ${label} dispatch failed:`, err?.message ?? err));
}

/**
 * A rating may only be submitted by the ticket's requester, for their own
 * ticket. Accepts either an authenticated requester or a valid signed link
 * token; both resolve to the same user id.
 */
function ratingInsertDenied(
  values: Record<string, any>,
  ticket: Record<string, any> | null,
  ctx: AuthContext,
  ratingToken?: string,
): string | null {
  if (!ticket) return 'Ticket not found';

  let authorisedUser = ctx.userId;
  if (ratingToken) {
    const decoded = verifyRatingToken(ratingToken, String(ticket._id));
    if (!decoded) return 'Invalid or expired rating link';
    authorisedUser = decoded.sub;
  }

  // The rating must be attributed to the caller, not to someone else.
  if (values.rated_by && values.rated_by !== authorisedUser) {
    return 'A rating cannot be submitted on behalf of another user';
  }
  // Only the person who raised the ticket may rate it.
  if (ticket.raised_by !== authorisedUser) {
    return 'Only the requester can rate this ticket';
  }
  return null;
}

function mergeFilters(a: Record<string, any>, b: Record<string, any>): Record<string, any> {
  const aEmpty = Object.keys(a).length === 0;
  const bEmpty = Object.keys(b).length === 0;
  if (aEmpty) return b;
  if (bEmpty) return a;
  return { $and: [a, b] };
}

/** Resolve PostgREST embedded resources (to-one joins) onto result rows. */
async function resolveEmbeds(
  parentTable: string,
  rows: Record<string, any>[],
  embeds: EmbedSpec[],
): Promise<void> {
  for (const embed of embeds) {
    const rel = resolveRelationship(parentTable, embed.table, embed.constraint);
    if (!rel) {
      // Unknown relationship: expose null so the client doesn't crash.
      for (const row of rows) row[embed.alias] = null;
      continue;
    }
    const refModel = models[rel.refTable];
    if (!refModel) {
      for (const row of rows) row[embed.alias] = null;
      continue;
    }
    const localValues = [...new Set(rows.map((r) => r[rel.column]).filter((v) => v != null))];
    const refField = toMongoField(rel.refColumn);
    const refDocs = localValues.length
      ? await refModel.find({ [refField]: { $in: localValues } })
      : [];
    const byKey = new Map<string, any>();
    for (const doc of refDocs) {
      const json = doc.toJSON();
      const key = String(json[rel.refColumn]);
      byKey.set(key, projectColumns(json, embed.columns));
    }
    for (const row of rows) {
      const v = row[rel.column];
      row[embed.alias] = v != null && byKey.has(String(v)) ? byKey.get(String(v)) : null;
    }
  }
}

restRouter.post('/query', requireAuth, async (req, res) => {
  const body = req.body as QueryBody;
  const model = getModel(body.table);
  if (!model) return res.json({ data: null, error: { message: `Unknown table: ${body.table}` } });
  const ctx = req.auth!;

  try {
    const userFilter = buildFilter(body);

    // ── SELECT ────────────────────────────────────────────────────────────
    if (body.action === 'select') {
      const filter = mergeFilters(userFilter, authFilterFor(body.table, ctx));

      // head:true — count-only, no rows fetched (supabase `{ count, head: true }`).
      if (body.head) {
        const count = await model.countDocuments(filter);
        return res.json({ data: null, error: null, count });
      }

      let q = model.find(filter);

      if (body.order?.length) {
        const sort: Record<string, 1 | -1> = {};
        for (const o of body.order) sort[toMongoField(o.column)] = o.ascending === false ? -1 : 1;
        q = q.sort(sort);
      }
      if (body.range) {
        q = q.skip(body.range.from).limit(body.range.to - body.range.from + 1);
      } else {
        if (typeof body.offset === 'number') q = q.skip(body.offset);
        if (typeof body.limit === 'number') q = q.limit(body.limit);
      }

      const docs = await q.exec();
      const parsed = parseSelect(body.select);
      let rows = docs.map((d) => d.toJSON() as Record<string, any>);
      if (parsed.embeds.length) await resolveEmbeds(body.table, rows, parsed.embeds);
      rows = rows.map((r) => {
        const projected = projectColumns(r, parsed.base);
        for (const e of parsed.embeds) projected[e.alias] = r[e.alias];
        return projected;
      });

      const count =
        body.count === 'exact' ? await model.countDocuments(filter) : undefined;

      if (body.single || body.maybeSingle) {
        if (rows.length === 0) {
          if (body.maybeSingle) return res.json({ data: null, error: null, count });
          return res.json({
            data: null,
            error: { message: 'No rows found', code: 'PGRST116' },
          });
        }
        return res.json({ data: rows[0], error: null, count });
      }
      return res.json({ data: rows, error: null, count });
    }

    // ── INSERT ────────────────────────────────────────────────────────────
    if (body.action === 'insert') {
      const input = Array.isArray(body.values) ? body.values : [body.values ?? {}];

      // Ratings are authorisation-sensitive: validate BEFORE writing anything.
      if (body.table === 'ticket_ratings') {
        for (const value of input) {
          const ticket = await models.tickets.findOne({ _id: value.ticket_id }).lean();
          const denied = ratingInsertDenied(value, ticket as any, ctx, body.ratingToken);
          if (denied) return res.json({ data: null, error: { message: denied } });
        }
      }

      const created = await model.insertMany(input.map(stripId), { rawResult: false });
      created.forEach((d) => emitChange(body.table, 'INSERT', d.toJSON()));

      // ── Notifications: only after the write has succeeded ────────────────
      if (body.table === 'tickets') {
        for (const doc of created) {
          const row = doc.toJSON();
          fireAndForget('TICKET_RAISED', () => notifyTicketRaised({ ...row, _id: row.id }));
        }
      } else if (body.table === 'ticket_ratings') {
        for (const doc of created) {
          const row = doc.toJSON();
          fireAndForget('RATING_SUBMITTED', () => notifyRatingSubmitted({ ...row, _id: row.id }));
        }
      }
      if (!body.returning) return res.json({ data: null, error: null });
      const rows = created.map((d) => d.toJSON());
      return res.json({
        data: body.single || rows.length === 1 ? rows[0] : rows,
        error: null,
      });
    }

    // ── UPDATE ────────────────────────────────────────────────────────────
    if (body.action === 'update') {
      const values = stripId(body.values as Record<string, any>);
      // The visibility rules are a write guard too: a caller may only modify
      // rows they are allowed to read, so a crafted filter cannot reach a
      // ticket in an unauthorised plant/department.
      const updateFilter = mergeFilters(userFilter, authFilterFor(body.table, ctx));
      const toUpdate = await model.find(updateFilter);
      const isTicket = body.table === 'tickets';
      for (const doc of toUpdate) {
        // Snapshot before mutating so the notifier can tell what actually
        // changed — an assignment mail must not fire when only a remark moved.
        const before = isTicket ? doc.toObject() : null;
        doc.set(values);
        await doc.save();
        const after = doc.toJSON();
        emitChange(body.table, 'UPDATE', after);
        if (isTicket && before) {
          fireAndForget('ticket update', () =>
            notifyTicketUpdated(before, { ...after, _id: after.id }, ctx.userId),
          );
        }
      }
      if (!body.returning) return res.json({ data: null, error: null });
      const rows = toUpdate.map((d) => d.toJSON());
      return res.json({
        data: body.single ? (rows[0] ?? null) : rows,
        error: null,
      });
    }

    // ── DELETE ────────────────────────────────────────────────────────────
    if (body.action === 'delete') {
      const deleteFilter = mergeFilters(userFilter, authFilterFor(body.table, ctx));
      const toDelete = await model.find(deleteFilter);
      const rows = toDelete.map((d) => d.toJSON());
      await model.deleteMany(deleteFilter);
      rows.forEach((r) => emitChange(body.table, 'DELETE', r));
      if (!body.returning) return res.json({ data: null, error: null });
      return res.json({ data: body.single ? (rows[0] ?? null) : rows, error: null });
    }

    // ── UPSERT ────────────────────────────────────────────────────────────
    if (body.action === 'upsert') {
      const input = Array.isArray(body.values) ? body.values : [body.values ?? {}];
      // PostgREST allows a composite conflict target ("role_name,unit_name").
      // Every column has to take part in the match — matching on only the first
      // one (or on none at all) would make separate rows collide.
      const conflictCols = (body.onConflict ?? 'id')
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
      const out: any[] = [];
      for (const raw of input) {
        const value = { ...raw };
        const query: Record<string, any> = {};
        let matchable = conflictCols.length > 0;
        for (const col of conflictCols) {
          const colVal = col === 'id' ? value.id : value[col];
          if (colVal == null) {
            matchable = false;
            break;
          }
          query[toMongoField(col)] = colVal;
        }
        delete value.id;

        // No usable conflict target on this row: treat it as a plain insert
        // rather than folding every such row onto one shared document.
        if (!matchable) {
          const [created] = await model.insertMany([stripId(raw)]);
          out.push(created.toJSON());
          emitChange(body.table, 'INSERT', created.toJSON());
          continue;
        }

        // No $setOnInsert: the conflict columns are already in `value`, and on an
        // upsert Mongo seeds the new document from the query's equality terms —
        // writing them twice is rejected as a conflicting update path.
        const doc = await model.findOneAndUpdate(
          mergeFilters(query, authFilterFor(body.table, ctx)),
          { $set: value },
          { new: true, upsert: true, setDefaultsOnInsert: true },
        );
        if (doc) {
          out.push(doc.toJSON());
          emitChange(body.table, 'UPDATE', doc.toJSON());
        }
      }
      if (!body.returning) return res.json({ data: null, error: null });
      return res.json({ data: body.single ? (out[0] ?? null) : out, error: null });
    }

    return res.json({ data: null, error: { message: `Unknown action: ${body.action}` } });
  } catch (err: any) {
    return res.json({ data: null, error: { message: err.message ?? 'Query failed' } });
  }
});

/** Never let the client set the Mongo _id implicitly via an `id` field on insert. */
function stripId(v: Record<string, any>): Record<string, any> {
  if (!v) return {};
  const { id, ...rest } = v;
  // If the caller explicitly supplied an id, honour it as _id.
  return id != null ? { _id: id, ...rest } : rest;
}
