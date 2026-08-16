import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

import { models, AuthUser } from '../models/index.js';
import { env } from '../config/env.js';
import { sendEmail } from './gmail.js';
import {
  templates,
  ticketUrl,
  ratingUrl,
  normaliseLang,
  type Lang,
  type TemplateContext,
  type TemplateName,
  type TicketView,
} from './templates.js';

/**
 * Centralised ticket notification service.
 *
 *     ticket event → determine recipients → pick language → render template
 *                  → claim idempotency row → send → record outcome
 *
 * Contract for every exported dispatcher:
 *   • NEVER throws. Email is a side effect; a failed notification must never
 *     fail the ticket operation that triggered it.
 *   • Only ever called AFTER the database write has succeeded.
 */

const { notification_logs, profiles, units, departments, ticket_ratings } = models;

export const EVENTS = {
  TICKET_RAISED: 'TICKET_RAISED',
  TICKET_ASSIGNED: 'TICKET_ASSIGNED',
  TICKET_REASSIGNED: 'TICKET_REASSIGNED',
  TICKET_STATUS_CHANGED: 'TICKET_STATUS_CHANGED',
  TICKET_RESOLVED: 'TICKET_RESOLVED',
  RATING_REQUEST: 'RATING_REQUEST',
  RATING_SUBMITTED: 'RATING_SUBMITTED',
  TICKET_REOPENED: 'TICKET_REOPENED',
} as const;

export type EventType = (typeof EVENTS)[keyof typeof EVENTS];

/** Statuses that mean "the work is finished". */
const TERMINAL_STATUSES = new Set(['resolved', 'closed']);

// ─────────────────────────────────────────────────────────────────────────────
// Rating links
// ─────────────────────────────────────────────────────────────────────────────

const RATING_TOKEN_TTL = '30d';

interface RatingTokenPayload {
  sub: string; // the user allowed to rate — the requester
  tid: string; // ticket id
  purpose: 'rating';
}

/**
 * Signs a rating link. The token carries only ids and is signed with the
 * server's JWT secret, so it cannot be forged, cannot be pointed at another
 * ticket, and cannot be used by a different user.
 */
export function signRatingToken(ticketId: string, userId: string): string {
  const payload: RatingTokenPayload = { sub: userId, tid: ticketId, purpose: 'rating' };
  return jwt.sign(payload, env.jwtSecret, { expiresIn: RATING_TOKEN_TTL });
}

/** Verifies a rating link. Returns null for forged, expired or mismatched tokens. */
export function verifyRatingToken(token: string, ticketId: string): RatingTokenPayload | null {
  try {
    const decoded = jwt.verify(token, env.jwtSecret) as RatingTokenPayload;
    if (decoded.purpose !== 'rating') return null;
    if (decoded.tid !== ticketId) return null;
    return decoded;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Recipient resolution
// ─────────────────────────────────────────────────────────────────────────────

interface Recipient {
  userId: string;
  email: string;
  name: string;
  lang: Lang;
}

/**
 * Loads the addressable details for a set of user ids.
 * Users with no auth record or no email are dropped — a missing address is a
 * skip, never an error.
 */
async function loadRecipients(userIds: (string | null | undefined)[]): Promise<Map<string, Recipient>> {
  const ids = [...new Set(userIds.filter((id): id is string => !!id))];
  if (!ids.length) return new Map();

  const [authUsers, profileRows] = await Promise.all([
    AuthUser.find({ _id: { $in: ids }, disabled: { $ne: true } }).lean(),
    profiles.find({ user_id: { $in: ids } }).lean(),
  ]);

  const profileByUser = new Map<string, any>(profileRows.map((p: any) => [p.user_id, p]));
  const out = new Map<string, Recipient>();

  for (const user of authUsers as any[]) {
    const email = String(user.email ?? '').trim().toLowerCase();
    if (!email) continue;
    const profile = profileByUser.get(user._id);
    out.set(user._id, {
      userId: user._id,
      email,
      name: profile?.name || user.raw_user_meta_data?.name || email.split('@')[0],
      // No stored preference means the user never chose — default English.
      lang: normaliseLang(profile?.preferred_language),
    });
  }
  return out;
}

/** Display name for an actor, without needing a full Recipient. */
async function displayName(userId?: string | null): Promise<string> {
  if (!userId) return '';
  const profile: any = await profiles.findOne({ user_id: userId }).lean();
  if (profile?.name) return profile.name;
  const user: any = await AuthUser.findOne({ _id: userId }).lean();
  return user?.raw_user_meta_data?.name || user?.email || '';
}

/** Plant and department names for the ticket — never translated. */
async function loadContextNames(ticket: any): Promise<{ plantName: string; departmentName: string }> {
  const [unit, dept] = await Promise.all([
    ticket.unit_id ? units.findOne({ _id: ticket.unit_id }).lean() : null,
    ticket.issue_department_id || ticket.department_id
      ? departments.findOne({ _id: ticket.issue_department_id || ticket.department_id }).lean()
      : null,
  ]);
  return {
    plantName: (unit as any)?.name ?? '',
    departmentName: (dept as any)?.name ?? '',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Idempotency + logging
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Deterministic identity for an event.
 *
 * Two deliveries of the "same" event must produce the same key, so a retried
 * request, a double submit or a duplicated React effect collapses to one email.
 * `parts` carries whatever makes the event distinct — for a status change that
 * is the old and new status, so a genuine second transition still notifies.
 */
function buildEventKey(eventType: EventType, ticketId: string, ...parts: (string | null | undefined)[]): string {
  const raw = [eventType, ticketId, ...parts.map((p) => p ?? '')].join('|');
  return crypto.createHash('sha1').update(raw).digest('hex');
}

/**
 * Renders and delivers one event to a de-duplicated recipient list.
 *
 * The `notification_logs` row is claimed BEFORE sending. The unique index on
 * (event_key, recipient) makes that claim the lock — a concurrent duplicate
 * loses the insert and returns without sending. Nothing here throws.
 */
async function dispatch(
  eventType: EventType,
  template: TemplateName,
  eventKey: string,
  recipients: Recipient[],
  buildContext: (r: Recipient) => TemplateContext,
  ticket: TicketView,
): Promise<void> {
  // Deduplicate by normalised address: one person wearing three hats
  // (requester + HOD + assignee) still gets exactly one email.
  const seen = new Set<string>();
  const unique = recipients.filter((r) => {
    const key = r.email.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  for (const recipient of unique) {
    let logId: string | null = null;
    try {
      const { subject, html } = templates[template](buildContext(recipient));

      // Claim the send. A duplicate key here means someone already has it.
      try {
        const [created] = await notification_logs.insertMany([
          {
            event_type: eventType,
            event_key: eventKey,
            ticket_id: ticket.id,
            ticket_number: ticket.ticket_number,
            recipient: recipient.email,
            recipient_user_id: recipient.userId,
            language: recipient.lang,
            subject,
            status: 'PENDING',
          },
        ]);
        logId = created._id;
      } catch (err: any) {
        if (err?.code === 11000 || err?.writeErrors?.[0]?.code === 11000) {
          continue; // already sent (or in flight) — this is the duplicate guard working
        }
        throw err;
      }

      const result = await sendEmail({ to: recipient.email, subject, html });

      await notification_logs.updateOne(
        { _id: logId },
        {
          $set: {
            status: result.ok ? 'SENT' : result.skipped ? 'SKIPPED' : 'FAILED',
            message_id: result.messageId ?? null,
            // safeErrorMessage() has already redacted anything credential-shaped.
            error: result.ok ? null : (result.error ?? result.reason ?? null),
            sent_at: result.ok ? new Date() : null,
          },
        },
      );
    } catch (error: any) {
      console.error(`[notify] ${eventType} → ${recipient.email} failed: ${error?.message ?? error}`);
      if (logId) {
        await notification_logs
          .updateOne({ _id: logId }, { $set: { status: 'FAILED', error: String(error?.message ?? error).slice(0, 500) } })
          .catch(() => undefined);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Event dispatchers — called from the query router AFTER a successful write
// ─────────────────────────────────────────────────────────────────────────────

function toView(ticket: any): TicketView {
  return {
    id: ticket._id ?? ticket.id,
    ticket_number: ticket.ticket_number,
    title: ticket.title,
    description: ticket.description,
    status: ticket.status,
    priority: ticket.priority,
    target_date: ticket.target_date,
    created_at: ticket.created_at,
    updated_at: ticket.updated_at,
    resolved_at: ticket.resolved_at,
    reopened_at: ticket.reopened_at,
    reopen_remarks: ticket.reopen_remarks,
    remarks: ticket.remarks,
    resolution_note: ticket.resolution_note,
    closing_remarks: ticket.closing_remarks,
  };
}

/** A. Ticket raised → the requester. */
export async function notifyTicketRaised(ticket: any): Promise<void> {
  try {
    const view = toView(ticket);
    const people = await loadRecipients([ticket.raised_by]);
    const requester = people.get(ticket.raised_by);
    if (!requester) return;

    const names = await loadContextNames(ticket);
    await dispatch(
      EVENTS.TICKET_RAISED,
      'TICKET_RAISED',
      buildEventKey(EVENTS.TICKET_RAISED, view.id),
      [requester],
      (r) => ({
        ticket: view,
        lang: r.lang,
        recipientName: r.name,
        ...names,
        raisedByName: requester.name,
        ticketUrl: ticketUrl(view.id),
      }),
      view,
    );
  } catch (error: any) {
    console.error(`[notify] TICKET_RAISED failed: ${error?.message ?? error}`);
  }
}

/**
 * Handles every ticket UPDATE. Compares before/after and fires whichever
 * events genuinely occurred — assignment only when the assignee actually
 * changed, status only when the status actually changed.
 */
export async function notifyTicketUpdated(before: any, after: any, actorUserId?: string): Promise<void> {
  try {
    const view = toView(after);
    const names = await loadContextNames(after);
    const actorName = await displayName(actorUserId);

    const assigneeChanged = (before.assigned_to ?? null) !== (after.assigned_to ?? null);
    const statusChanged = (before.status ?? null) !== (after.status ?? null);
    const reopened = !before.reopened_at && !!after.reopened_at;

    const people = await loadRecipients([
      after.raised_by,
      after.assigned_to,
      before.assigned_to,
      after.resolved_by,
      after.closed_by,
      actorUserId,
    ]);

    // ── B / H. Assigned or reassigned → the NEW assignee only ───────────────
    if (assigneeChanged && after.assigned_to) {
      const assignee = people.get(after.assigned_to);
      if (assignee) {
        const isReassign = !!before.assigned_to;
        const event = isReassign ? EVENTS.TICKET_REASSIGNED : EVENTS.TICKET_ASSIGNED;
        await dispatch(
          event,
          isReassign ? 'TICKET_REASSIGNED' : 'TICKET_ASSIGNED',
          // Keyed on the assignee so a later reassignment back to the same
          // person after someone else still notifies.
          buildEventKey(event, view.id, before.assigned_to ?? 'none', after.assigned_to),
          [assignee],
          (r) => ({
            ticket: view,
            lang: r.lang,
            recipientName: r.name,
            ...names,
            raisedByName: people.get(after.raised_by)?.name ?? '',
            assigneeName: assignee.name,
            actorName,
            ticketUrl: ticketUrl(view.id),
          }),
          view,
        );
      }
    }

    if (!statusChanged && !reopened) return;

    const nowResolved = TERMINAL_STATUSES.has(String(after.status));
    const wasResolved = TERMINAL_STATUSES.has(String(before.status));

    // ── G. Reopened → the previous resolver / assignee ──────────────────────
    if (reopened || (wasResolved && !nowResolved)) {
      const targets = [after.assigned_to, before.assigned_to, before.resolved_by, before.closed_by]
        .map((id) => people.get(id))
        .filter((r): r is Recipient => !!r)
        // The person who reopened it does not need telling.
        .filter((r) => r.userId !== actorUserId);

      if (targets.length) {
        await dispatch(
          EVENTS.TICKET_REOPENED,
          'TICKET_REOPENED',
          buildEventKey(EVENTS.TICKET_REOPENED, view.id, String(after.reopened_at ?? after.updated_at)),
          targets,
          (r) => ({
            ticket: view,
            lang: r.lang,
            recipientName: r.name,
            ...names,
            actorName: actorName || people.get(after.raised_by)?.name || '',
            previousStatus: before.status,
            newStatus: after.status,
            ticketUrl: ticketUrl(view.id),
          }),
          view,
        );
      }
      return; // a reopen is not also reported as a plain status change
    }

    // ── D + E. Resolved / closed → the requester, with a rating CTA ─────────
    //
    // The two conditions are independent on purpose. The usual path is
    // open → resolved → closed, and both of those steps are "terminal", so
    // gating the rating request on `!wasResolved` would skip it exactly when
    // the ticket actually finishes.
    if (nowResolved) {
      const requester = people.get(after.raised_by);
      const resolverName =
        (await displayName(after.resolved_by ?? after.closed_by ?? after.assigned_to)) || actorName;

      if (requester) {
        const token = signRatingToken(view.id, requester.userId);

        // D. Entering a terminal status from an open one.
        if (!wasResolved) {
          await dispatch(
            EVENTS.TICKET_RESOLVED,
            'TICKET_RESOLVED',
            buildEventKey(EVENTS.TICKET_RESOLVED, view.id, String(after.status)),
            [requester],
            (r) => ({
              ticket: view,
              lang: r.lang,
              recipientName: r.name,
              ...names,
              resolverName,
              ticketUrl: ticketUrl(view.id),
              ratingUrl: ratingUrl(view.id, token),
            }),
            view,
          );
        }

        // E. A dedicated rating request once the ticket is fully closed and
        // the requester has not already rated it.
        if (String(after.status) === 'closed' && String(before.status) !== 'closed') {
          const existing = await ticket_ratings.exists({ ticket_id: view.id });
          if (!existing) {
            await dispatch(
              EVENTS.RATING_REQUEST,
              'RATING_REQUEST',
              buildEventKey(EVENTS.RATING_REQUEST, view.id),
              [requester],
              (r) => ({
                ticket: view,
                lang: r.lang,
                recipientName: r.name,
                ...names,
                resolverName,
                ticketUrl: ticketUrl(view.id),
                ratingUrl: ratingUrl(view.id, token),
              }),
              view,
            );
          }
        }
      }
      return; // terminal-status mail already carries the transition
    }

    // ── C. Any other status change → the ticket's stakeholders ─────────────
    const stakeholders = [after.raised_by, after.assigned_to]
      .map((id) => people.get(id))
      .filter((r): r is Recipient => !!r)
      .filter((r) => r.userId !== actorUserId); // no self-notifications

    if (!stakeholders.length) return;

    await dispatch(
      EVENTS.TICKET_STATUS_CHANGED,
      'TICKET_STATUS_CHANGED',
      buildEventKey(EVENTS.TICKET_STATUS_CHANGED, view.id, before.status, after.status),
      stakeholders,
      (r) => ({
        ticket: view,
        lang: r.lang,
        recipientName: r.name,
        ...names,
        actorName,
        previousStatus: before.status,
        newStatus: after.status,
        ticketUrl: ticketUrl(view.id),
      }),
      view,
    );
  } catch (error: any) {
    console.error(`[notify] ticket update failed: ${error?.message ?? error}`);
  }
}

/** F. Rating submitted → the person who resolved the ticket. */
export async function notifyRatingSubmitted(rating: any): Promise<void> {
  try {
    const ticket: any = await models.tickets.findOne({ _id: rating.ticket_id }).lean();
    if (!ticket) return;

    const view = toView(ticket);
    const names = await loadContextNames(ticket);

    // Whoever actually did the work, in order of confidence.
    const resolverId = ticket.resolved_by ?? ticket.closed_by ?? ticket.assigned_to;
    const people = await loadRecipients([resolverId, rating.rated_by]);
    const resolver = resolverId ? people.get(resolverId) : undefined;
    if (!resolver) return; // no resolver on record, or they have no email

    await dispatch(
      EVENTS.RATING_SUBMITTED,
      'RATING_SUBMITTED',
      buildEventKey(EVENTS.RATING_SUBMITTED, view.id, String(rating._id ?? rating.id)),
      [resolver],
      (r) => ({
        ticket: view,
        lang: r.lang,
        recipientName: r.name,
        ...names,
        resolverName: resolver.name,
        rating: rating.rating,
        // Empty feedback renders nothing at all — no blank comment section.
        ratingComment: rating.feedback ?? null,
        ratingAt: rating.created_at ?? new Date(),
        ticketUrl: ticketUrl(view.id),
      }),
      view,
    );
  } catch (error: any) {
    console.error(`[notify] RATING_SUBMITTED failed: ${error?.message ?? error}`);
  }
}
