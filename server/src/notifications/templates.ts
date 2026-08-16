import { env } from '../config/env.js';

/**
 * Email templates — system wording in English and Swahili.
 *
 * Only system-generated labels are translated. User-generated content (ticket
 * title, description, remarks, rating comments, names, plant and department
 * names) is passed through verbatim in whatever language it was written.
 */

export type Lang = 'en' | 'sw';

export const DEFAULT_LANG: Lang = 'en';

export function normaliseLang(value?: string | null): Lang {
  return value === 'sw' ? 'sw' : DEFAULT_LANG;
}

/** Escapes user-generated content before it goes into the HTML body. */
function esc(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared vocabulary
// ─────────────────────────────────────────────────────────────────────────────

const L = {
  en: {
    brandTagline: 'Support Portal · Ticket Notifications',
    hello: (name: string) => `Hello ${name},`,
    viewTicket: 'View Ticket',
    rateTicket: 'Rate This Ticket',
    footer:
      'This is an automated notification from the Amsons Group Support Portal. Please do not reply to this email.',
    footerNote: 'You are receiving this because you are part of this ticket’s workflow.',
    ticketId: 'Ticket ID',
    title: 'Title',
    description: 'Description',
    raisedBy: 'Raised By',
    plant: 'Plant',
    department: 'Department',
    priority: 'Priority',
    status: 'Status',
    targetDate: 'Target Date',
    created: 'Created',
    assignedTo: 'Assigned To',
    previousStatus: 'Previous Status',
    newStatus: 'New Status',
    updatedBy: 'Updated By',
    latestRemark: 'Latest Remark',
    updatedAt: 'Updated',
    resolvedBy: 'Resolved By',
    resolution: 'Resolution',
    resolvedAt: 'Resolved',
    rating: 'Rating',
    feedback: 'Feedback',
    submittedAt: 'Submitted',
    reopenedBy: 'Reopened By',
    reopenReason: 'Reason',
    reopenedAt: 'Reopened',
    notSet: 'Not set',

    raisedSubject: 'Ticket Raised',
    raisedIntro: 'Your support ticket has been successfully raised.',
    raisedOutro: 'You can view the ticket using the button below.',

    assignedSubject: 'Ticket Assigned to You',
    assignedIntro: 'A support ticket has been assigned to you.',
    assignedOutro: 'Please review the ticket and take the appropriate action.',

    statusSubject: 'Status Updated',
    statusIntro: 'The status of this ticket has been updated.',

    resolvedSubject: 'Ticket Resolved',
    resolvedIntro: 'Your support ticket has been marked as resolved.',
    resolvedOutro: 'Please rate the support you received.',

    ratingRequestSubject: 'Please Rate Your Support Experience',
    ratingRequestIntro:
      'Your ticket has been closed. We would appreciate a moment of your time to rate the support you received.',

    ratingSubmittedSubject: 'Customer Rating Received',
    ratingSubmittedIntro: 'The requester has submitted a rating for the ticket you resolved.',

    reopenedSubject: 'Ticket Reopened',
    reopenedIntro: 'has been reopened.',
    reopenedOutro: 'Please review the ticket.',
  },
  sw: {
    brandTagline: 'Tovuti ya Msaada · Arifa za Tiketi',
    hello: (name: string) => `Habari ${name},`,
    viewTicket: 'Tazama Tiketi',
    rateTicket: 'Toa Tathmini',
    footer:
      'Hii ni arifa ya kiotomatiki kutoka Tovuti ya Msaada ya Amsons Group. Tafadhali usijibu barua pepe hii.',
    footerNote: 'Umepokea ujumbe huu kwa sababu unahusika na tiketi hii.',
    ticketId: 'Namba ya Tiketi',
    title: 'Kichwa',
    description: 'Maelezo',
    raisedBy: 'Aliyefungua',
    plant: 'Kiwanda',
    department: 'Idara',
    priority: 'Kipaumbele',
    status: 'Hali',
    targetDate: 'Tarehe Lengwa',
    created: 'Ilifunguliwa',
    assignedTo: 'Aliyepangiwa',
    previousStatus: 'Hali ya Awali',
    newStatus: 'Hali Mpya',
    updatedBy: 'Aliyesasisha',
    latestRemark: 'Maoni ya Hivi Karibuni',
    updatedAt: 'Ilisasishwa',
    resolvedBy: 'Aliyetatua',
    resolution: 'Utatuzi',
    resolvedAt: 'Ilitatuliwa',
    rating: 'Tathmini',
    feedback: 'Maoni',
    submittedAt: 'Iliwasilishwa',
    reopenedBy: 'Aliyefungua Upya',
    reopenReason: 'Sababu',
    reopenedAt: 'Ilifunguliwa Upya',
    notSet: 'Haijawekwa',

    raisedSubject: 'Tiketi Imefunguliwa',
    raisedIntro: 'Tiketi yako ya msaada imefunguliwa kwa mafanikio.',
    raisedOutro: 'Unaweza kuona tiketi kwa kutumia kitufe hapa chini.',

    assignedSubject: 'Umepangiwa Tiketi',
    assignedIntro: 'Umepangiwa tiketi ya msaada.',
    assignedOutro: 'Tafadhali kagua tiketi na uchukue hatua stahiki.',

    statusSubject: 'Hali Imesasishwa',
    statusIntro: 'Hali ya tiketi hii imesasishwa.',

    resolvedSubject: 'Tiketi Imetatuliwa',
    resolvedIntro: 'Tiketi yako ya msaada imewekwa alama kuwa imetatuliwa.',
    resolvedOutro: 'Tafadhali toa tathmini ya msaada uliopokea.',

    ratingRequestSubject: 'Tafadhali Toa Tathmini ya Huduma Uliyopokea',
    ratingRequestIntro:
      'Tiketi yako imefungwa. Tutashukuru ukitumia dakika moja kutoa tathmini ya msaada uliopokea.',

    ratingSubmittedSubject: 'Tathmini ya Mteja Imepokelewa',
    ratingSubmittedIntro: 'Mteja amewasilisha tathmini kwa tiketi uliyoitatua.',

    reopenedSubject: 'Tiketi Imefunguliwa Upya',
    reopenedIntro: 'imefunguliwa upya.',
    reopenedOutro: 'Tafadhali kagua tiketi.',
  },
} as const;

/** Status values are stored in English; these are display labels only. */
const STATUS_LABEL: Record<string, { en: string; sw: string }> = {
  open: { en: 'Open', sw: 'Wazi' },
  in_progress: { en: 'In Progress', sw: 'Inaendelea' },
  resolved: { en: 'Resolved', sw: 'Imetatuliwa' },
  closed: { en: 'Closed', sw: 'Imefungwa' },
  reopened: { en: 'Reopened', sw: 'Imefunguliwa Upya' },
};

const PRIORITY_LABEL: Record<string, { en: string; sw: string }> = {
  low: { en: 'Low', sw: 'Chini' },
  medium: { en: 'Medium', sw: 'Wastani' },
  high: { en: 'High', sw: 'Juu' },
  critical: { en: 'Critical', sw: 'Dharura' },
};

export function statusLabel(value: string | null | undefined, lang: Lang): string {
  if (!value) return '';
  return STATUS_LABEL[value]?.[lang] ?? String(value).replace(/_/g, ' ');
}

function priorityLabel(value: string | null | undefined, lang: Lang): string {
  if (!value) return '';
  return PRIORITY_LABEL[value]?.[lang] ?? String(value);
}

const STATUS_TONE: Record<string, [string, string]> = {
  open: ['#fef3c7', '#92400e'],
  in_progress: ['#dbeafe', '#1e40af'],
  resolved: ['#d1fae5', '#065f46'],
  closed: ['#e2e8f0', '#475569'],
  reopened: ['#fee2e2', '#991b1b'],
};

function statusBadge(value: string | null | undefined, lang: Lang): string {
  const [bg, fg] = STATUS_TONE[String(value)] ?? ['#e2e8f0', '#475569'];
  return `<span style="display:inline-block;padding:5px 12px;border-radius:999px;background:${bg};color:${fg};font-size:12px;font-weight:700;letter-spacing:0.03em;text-transform:uppercase;">${esc(statusLabel(value, lang))}</span>`;
}

/** DD-MM-YYYY, HH:MM — matches the portal's display format. */
function fmtDate(value: unknown, withTime = true): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(String(value));
  if (isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  const date = `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
  return withTime ? `${date}, ${p(d.getHours())}:${p(d.getMinutes())}` : date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Building blocks
// ─────────────────────────────────────────────────────────────────────────────

/** A detail row. Renders nothing when the value is empty — no blank sections. */
function row(label: string, value: string | undefined | null, raw = false): string {
  if (value === undefined || value === null || value === '') return '';
  return `<tr>
    <td style="padding:7px 0;color:#64748b;font-size:13px;white-space:nowrap;vertical-align:top;">${esc(label)}</td>
    <td style="padding:7px 0 7px 18px;color:#0f172a;font-size:14px;font-weight:600;">${raw ? value : esc(value)}</td>
  </tr>`;
}

function detailTable(rows: string): string {
  const body = rows.trim();
  if (!body) return '';
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:18px 0 4px;border-top:1px solid #e2e8f0;">${body}</table>`;
}

function button(href: string | undefined, label: string): string {
  if (!href) return '';
  return `<a href="${esc(href)}" style="display:inline-block;margin:24px 0 4px;padding:12px 26px;background:#6366f1;color:#ffffff;text-decoration:none;border-radius:10px;font-weight:600;font-size:14px;">${esc(label)}</a>`;
}

/** A free-text block for user-generated content (remarks, descriptions). */
function quote(label: string, value: string | undefined | null): string {
  if (!value) return '';
  return `<div style="margin:18px 0 0;">
    <div style="color:#64748b;font-size:13px;margin-bottom:6px;">${esc(label)}</div>
    <div style="padding:12px 14px;background:#f8fafc;border-left:3px solid #cbd5e1;border-radius:6px;color:#334155;font-size:14px;line-height:1.6;white-space:pre-wrap;">${esc(value)}</div>
  </div>`;
}

/**
 * The shared shell. The logo is taken from configuration rather than hardcoded,
 * falling back to the wordmark when no logo URL is set.
 */
export function emailLayout({ title, body, lang }: { title: string; body: string; lang: Lang }): string {
  const t = L[lang];
  const logoUrl = process.env.COMPANY_LOGO_URL || '';
  const brand = logoUrl
    ? `<img src="${esc(logoUrl)}" alt="Amsons Group" style="height:34px;width:auto;display:block;" />`
    : `<div style="color:#fff;font-size:21px;font-weight:700;letter-spacing:-0.02em;">Amsons&nbsp;Group</div>`;

  return `<!DOCTYPE html>
<html lang="${lang}">
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${esc(title)}</title></head>
  <body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 32px rgba(15,23,42,0.08);">
          <tr>
            <td style="background:linear-gradient(135deg,#6366f1,#06b6d4);padding:26px 32px;">
              ${brand}
              <div style="color:rgba(255,255,255,0.85);font-size:13px;margin-top:5px;">${esc(t.brandTagline)}</div>
            </td>
          </tr>
          <tr><td style="padding:30px 32px;font-size:15px;line-height:1.65;">${body}</td></tr>
          <tr>
            <td style="padding:18px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px;line-height:1.6;">
              ${esc(t.footer)}<br />${esc(t.footerNote)}
            </td>
          </tr>
        </table>
        <div style="max-width:600px;margin:14px auto 0;color:#94a3b8;font-size:11px;">
          &copy; ${new Date().getFullYear()} Amsons Group.
        </div>
      </td></tr>
    </table>
  </body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Template data
// ─────────────────────────────────────────────────────────────────────────────

export interface TicketView {
  id: string;
  ticket_number: string;
  title?: string | null;
  description?: string | null;
  status?: string | null;
  priority?: string | null;
  target_date?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  resolved_at?: unknown;
  reopened_at?: unknown;
  reopen_remarks?: string | null;
  remarks?: string | null;
  resolution_note?: string | null;
  closing_remarks?: string | null;
}

export interface TemplateContext {
  ticket: TicketView;
  lang: Lang;
  recipientName: string;
  plantName?: string | null;
  departmentName?: string | null;
  raisedByName?: string | null;
  assigneeName?: string | null;
  actorName?: string | null;
  resolverName?: string | null;
  previousStatus?: string | null;
  newStatus?: string | null;
  rating?: number | null;
  ratingComment?: string | null;
  ratingAt?: unknown;
  ticketUrl?: string;
  ratingUrl?: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
}

const SUBJECT_PREFIX = '[Amsons Support]';

function subject(ticketNumber: string, tail: string): string {
  return `${SUBJECT_PREFIX} [${ticketNumber}] ${tail}`;
}

/** Core ticket facts, shared by most templates. */
function coreRows(c: TemplateContext): string {
  const t = L[c.lang];
  return (
    row(t.ticketId, c.ticket.ticket_number) +
    row(t.title, c.ticket.title ?? '') +
    row(t.raisedBy, c.raisedByName ?? '') +
    row(t.plant, c.plantName ?? '') +
    row(t.department, c.departmentName ?? '') +
    row(t.priority, priorityLabel(c.ticket.priority, c.lang)) +
    row(t.status, statusBadge(c.ticket.status, c.lang), true) +
    row(t.targetDate, fmtDate(c.ticket.target_date, false) || t.notSet)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Templates
// ─────────────────────────────────────────────────────────────────────────────

export const templates = {
  TICKET_RAISED(c: TemplateContext): RenderedEmail {
    const t = L[c.lang];
    const body = `
      <p style="margin:0 0 14px;">${esc(t.hello(c.recipientName))}</p>
      <p style="margin:0;">${esc(t.raisedIntro)}</p>
      ${detailTable(coreRows(c) + row(t.created, fmtDate(c.ticket.created_at)))}
      ${quote(t.description, c.ticket.description)}
      <p style="margin:18px 0 0;">${esc(t.raisedOutro)}</p>
      ${button(c.ticketUrl, t.viewTicket)}`;
    const subj = subject(c.ticket.ticket_number, t.raisedSubject);
    return { subject: subj, html: emailLayout({ title: subj, body, lang: c.lang }) };
  },

  TICKET_ASSIGNED(c: TemplateContext): RenderedEmail {
    const t = L[c.lang];
    const body = `
      <p style="margin:0 0 14px;">${esc(t.hello(c.recipientName))}</p>
      <p style="margin:0;">${esc(t.assignedIntro)}</p>
      ${detailTable(coreRows(c) + row(t.assignedTo, c.assigneeName ?? ''))}
      ${quote(t.description, c.ticket.description)}
      <p style="margin:18px 0 0;">${esc(t.assignedOutro)}</p>
      ${button(c.ticketUrl, t.viewTicket)}`;
    const subj = subject(c.ticket.ticket_number, t.assignedSubject);
    return { subject: subj, html: emailLayout({ title: subj, body, lang: c.lang }) };
  },

  /** Reassignment reuses the assignment wording — the new assignee's view is identical. */
  TICKET_REASSIGNED(c: TemplateContext): RenderedEmail {
    return templates.TICKET_ASSIGNED(c);
  },

  TICKET_STATUS_CHANGED(c: TemplateContext): RenderedEmail {
    const t = L[c.lang];
    const body = `
      <p style="margin:0 0 14px;">${esc(t.hello(c.recipientName))}</p>
      <p style="margin:0;">${esc(t.statusIntro)}</p>
      ${detailTable(
        row(t.ticketId, c.ticket.ticket_number) +
          row(t.title, c.ticket.title ?? '') +
          row(t.previousStatus, statusBadge(c.previousStatus, c.lang), true) +
          row(t.newStatus, statusBadge(c.newStatus, c.lang), true) +
          row(t.updatedBy, c.actorName ?? '') +
          row(t.updatedAt, fmtDate(c.ticket.updated_at)),
      )}
      ${quote(t.latestRemark, c.ticket.remarks)}
      ${button(c.ticketUrl, t.viewTicket)}`;
    const subj = subject(c.ticket.ticket_number, t.statusSubject);
    return { subject: subj, html: emailLayout({ title: subj, body, lang: c.lang }) };
  },

  TICKET_RESOLVED(c: TemplateContext): RenderedEmail {
    const t = L[c.lang];
    const resolution = c.ticket.resolution_note || c.ticket.closing_remarks || c.ticket.remarks;
    const body = `
      <p style="margin:0 0 14px;">${esc(t.hello(c.recipientName))}</p>
      <p style="margin:0;">${esc(t.resolvedIntro)}</p>
      ${detailTable(
        row(t.ticketId, c.ticket.ticket_number) +
          row(t.title, c.ticket.title ?? '') +
          row(t.resolvedBy, c.resolverName ?? '') +
          row(t.status, statusBadge(c.ticket.status, c.lang), true) +
          row(t.resolvedAt, fmtDate(c.ticket.resolved_at ?? c.ticket.updated_at)),
      )}
      ${quote(t.resolution, resolution)}
      <p style="margin:18px 0 0;">${esc(t.resolvedOutro)}</p>
      ${button(c.ratingUrl || c.ticketUrl, t.rateTicket)}`;
    const subj = subject(c.ticket.ticket_number, t.resolvedSubject);
    return { subject: subj, html: emailLayout({ title: subj, body, lang: c.lang }) };
  },

  RATING_REQUEST(c: TemplateContext): RenderedEmail {
    const t = L[c.lang];
    const body = `
      <p style="margin:0 0 14px;">${esc(t.hello(c.recipientName))}</p>
      <p style="margin:0;">${esc(t.ratingRequestIntro)}</p>
      ${detailTable(
        row(t.ticketId, c.ticket.ticket_number) +
          row(t.title, c.ticket.title ?? '') +
          row(t.resolvedBy, c.resolverName ?? '') +
          row(t.status, statusBadge(c.ticket.status, c.lang), true),
      )}
      ${button(c.ratingUrl || c.ticketUrl, t.rateTicket)}`;
    const subj = subject(c.ticket.ticket_number, t.ratingRequestSubject);
    return { subject: subj, html: emailLayout({ title: subj, body, lang: c.lang }) };
  },

  RATING_SUBMITTED(c: TemplateContext): RenderedEmail {
    const t = L[c.lang];
    const body = `
      <p style="margin:0 0 14px;">${esc(t.hello(c.recipientName))}</p>
      <p style="margin:0;">${esc(t.ratingSubmittedIntro)}</p>
      ${detailTable(
        row(t.ticketId, c.ticket.ticket_number) +
          row(t.title, c.ticket.title ?? '') +
          row(t.resolvedBy, c.resolverName ?? '') +
          row(t.rating, c.rating != null ? `${c.rating} / 5` : '') +
          row(t.submittedAt, fmtDate(c.ratingAt)),
      )}
      ${quote(t.feedback, c.ratingComment)}
      ${button(c.ticketUrl, t.viewTicket)}`;
    const subj = subject(c.ticket.ticket_number, t.ratingSubmittedSubject);
    return { subject: subj, html: emailLayout({ title: subj, body, lang: c.lang }) };
  },

  TICKET_REOPENED(c: TemplateContext): RenderedEmail {
    const t = L[c.lang];
    const body = `
      <p style="margin:0 0 14px;">${esc(t.hello(c.recipientName))}</p>
      <p style="margin:0;">${esc(c.ticket.ticket_number)} ${esc(t.reopenedIntro)}</p>
      ${detailTable(
        row(t.ticketId, c.ticket.ticket_number) +
          row(t.title, c.ticket.title ?? '') +
          row(t.reopenedBy, c.actorName ?? '') +
          row(t.previousStatus, statusBadge(c.previousStatus, c.lang), true) +
          row(t.newStatus, statusBadge(c.newStatus ?? c.ticket.status, c.lang), true) +
          row(t.reopenedAt, fmtDate(c.ticket.reopened_at ?? c.ticket.updated_at)),
      )}
      ${quote(t.reopenReason, c.ticket.reopen_remarks)}
      <p style="margin:18px 0 0;">${esc(t.reopenedOutro)}</p>
      ${button(c.ticketUrl, t.viewTicket)}`;
    const subj = subject(c.ticket.ticket_number, t.reopenedSubject);
    return { subject: subj, html: emailLayout({ title: subj, body, lang: c.lang }) };
  },
};

export type TemplateName = keyof typeof templates;

/** Absolute link to a ticket in the portal. */
export function ticketUrl(ticketId: string): string {
  return `${env.appBaseUrl}/ticket/${ticketId}`;
}

/** Absolute rating link, carrying the signed token that authorises the rating. */
export function ratingUrl(ticketId: string, token: string): string {
  return `${env.appBaseUrl}/ticket/${ticketId}?rate=${encodeURIComponent(token)}`;
}
