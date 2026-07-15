import { Schema, model } from 'mongoose';
import { baseOptions, idField } from './_base.js';
import { APP_ROLES, TICKET_PRIORITIES, TICKET_STATUSES } from './enums.js';
import { AuthUser } from './AuthUser.js';

const Mixed = Schema.Types.Mixed;
const now = () => new Date();

/** Helper: a Date field that defaults to now (used for snake_case created_at/updated_at). */
const ts = () => ({ type: Date, default: now });

// ─────────────────────────────────────────────────────────────────────────────
// ai_config
const aiConfig = new Schema(
  {
    _id: idField,
    is_enabled: { type: Boolean, default: false },
    retention_days: { type: Number, default: 90 },
    updated_by: { type: String, default: null },
    updated_at: ts(),
  },
  baseOptions,
);

// ai_conversations
const aiConversations = new Schema(
  {
    _id: idField,
    title: { type: String, default: 'New conversation' },
    user_id: { type: String, required: true, index: true },
    created_at: ts(),
    updated_at: ts(),
  },
  baseOptions,
);

// ai_messages
const aiMessages = new Schema(
  {
    _id: idField,
    conversation_id: { type: String, required: true, index: true },
    role: { type: String, required: true },
    content: { type: String, required: true },
    created_at: ts(),
  },
  baseOptions,
);

// allowed_google_domains
const allowedGoogleDomains = new Schema(
  {
    _id: idField,
    domain_name: { type: String, required: true },
    is_active: { type: Boolean, default: true },
    created_by: { type: String, default: null },
    created_at: ts(),
  },
  baseOptions,
);

// app_settings (natural key: `key`)
const appSettings = new Schema(
  {
    _id: idField,
    key: { type: String, required: true, unique: true, index: true },
    value: { type: Mixed, default: null },
    updated_by: { type: String, default: null },
    updated_at: ts(),
  },
  baseOptions,
);

// departments
const departments = new Schema(
  {
    _id: idField,
    name: { type: String, required: true },
    unit_id: { type: String, default: null, index: true },
    is_active: { type: Boolean, default: true },
    created_at: ts(),
  },
  baseOptions,
);

// notifications
const notifications = new Schema(
  {
    _id: idField,
    user_id: { type: String, required: true, index: true },
    ticket_id: { type: String, default: null, index: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    type: { type: String, default: 'general' },
    is_read: { type: Boolean, default: false },
    email_sent_at: { type: Date, default: null },
    created_at: ts(),
  },
  baseOptions,
);

// profiles
const profiles = new Schema(
  {
    _id: idField,
    user_id: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    username: { type: String, default: null },
    employee_id: { type: String, default: null },
    department_id: { type: String, default: null, index: true },
    unit_id: { type: String, default: null, index: true },
    contact: { type: String, default: null },
    avatar_url: { type: String, default: null },
    profile_picture: { type: String, default: null },
    auth_provider: { type: String, default: 'email' },
    google_id: { type: String, default: null },
    created_at: ts(),
    updated_at: ts(),
  },
  baseOptions,
);

// role_plant_access
const rolePlantAccess = new Schema(
  {
    _id: idField,
    role_name: { type: String, required: true, index: true },
    unit_name: { type: String, required: true },
    is_enabled: { type: Boolean, default: true },
    own_plant_only: { type: Boolean, default: false },
    created_at: ts(),
  },
  baseOptions,
);

// roles
const roles = new Schema(
  {
    _id: idField,
    name: { type: String, required: true, unique: true },
    description: { type: String, default: null },
    permissions: { type: Mixed, default: {} },
    created_at: ts(),
    updated_at: ts(),
  },
  baseOptions,
);

// ticket_attachments
const ticketAttachments = new Schema(
  {
    _id: idField,
    ticket_id: { type: String, required: true, index: true },
    uploaded_by: { type: String, required: true },
    image_url: { type: String, required: true },
    attachment_type: { type: String, default: null },
    created_at: ts(),
  },
  baseOptions,
);

// ticket_history
const ticketHistory = new Schema(
  {
    _id: idField,
    ticket_id: { type: String, required: true, index: true },
    performed_by: { type: String, required: true },
    action: { type: String, required: true },
    old_status: { type: String, enum: [...TICKET_STATUSES, null], default: null },
    new_status: { type: String, enum: [...TICKET_STATUSES, null], default: null },
    remarks: { type: String, default: null },
    created_at: ts(),
  },
  baseOptions,
);

// ticket_messages
const ticketMessages = new Schema(
  {
    _id: idField,
    ticket_id: { type: String, required: true, index: true },
    sender_id: { type: String, required: true },
    sender_name: { type: String, required: true },
    sender_role: { type: String, required: true },
    message: { type: String, default: null },
    attachments: { type: Mixed, default: [] },
    is_system_message: { type: Boolean, default: false },
    created_at: ts(),
  },
  baseOptions,
);

// ticket_ratings (ticket_id is one-to-one)
const ticketRatings = new Schema(
  {
    _id: idField,
    ticket_id: { type: String, required: true, unique: true, index: true },
    rated_by: { type: String, required: true },
    rating: { type: Number, required: true },
    feedback: { type: String, default: null },
    created_at: ts(),
  },
  baseOptions,
);

// ticket_work_logs
const ticketWorkLogs = new Schema(
  {
    _id: idField,
    ticket_id: { type: String, required: true, index: true },
    logged_by: { type: String, required: true },
    description: { type: String, required: true },
    progress_percent: { type: Number, default: null },
    created_at: ts(),
  },
  baseOptions,
);

// tickets
const tickets = new Schema(
  {
    _id: idField,
    ticket_number: { type: String, required: true, unique: true, index: true },
    title: { type: String, required: true },
    description: { type: String, default: null },
    status: { type: String, enum: TICKET_STATUSES, default: 'open', index: true },
    priority: { type: String, enum: TICKET_PRIORITIES, default: 'medium' },
    raised_by: { type: String, required: true, index: true },
    assigned_to: { type: String, default: null, index: true },
    assigned_at: { type: Date, default: null },
    department_id: { type: String, default: null, index: true },
    issue_department_id: { type: String, default: null, index: true },
    unit_id: { type: String, default: null, index: true },
    attachments: { type: Mixed, default: [] },
    resolution_photos: { type: Mixed, default: [] },
    photo_url: { type: String, default: null },
    voice_recording_url: { type: String, default: null },
    voice_recording_duration: { type: Number, default: null },
    remarks: { type: String, default: null },
    progress_percent: { type: Number, default: null },
    target_date: { type: Date, default: null },
    next_target_date: { type: Date, default: null },
    first_response_at: { type: Date, default: null },
    resolution_note: { type: String, default: null },
    resolved_at: { type: Date, default: null },
    resolved_by: { type: String, default: null },
    reopened_at: { type: Date, default: null },
    reopen_remarks: { type: String, default: null },
    reopen_photo_url: { type: String, default: null },
    closing_remarks: { type: String, default: null },
    closed_at: { type: Date, default: null },
    closed_by: { type: String, default: null },
    feedback_reminder_sent_at: { type: Date, default: null },
    last_overdue_reminder_sent_at: { type: Date, default: null },
    overdue_reminder_count: { type: Number, default: 0 },
    sla_due_at: { type: Date, default: null },
    sla_breached: { type: Boolean, default: false },
    sla_at_risk_notified: { type: Boolean, default: false },
    sla_response_due_at: { type: Date, default: null },
    sla_response_breached: { type: Boolean, default: false },
    created_at: ts(),
    updated_at: ts(),
  },
  baseOptions,
);

// Auto-generate a unique ticket_number when it's missing or the "TEMP"
// placeholder the client inserts. Ports the old Supabase before-insert trigger
// so the unique index no longer rejects the second "TEMP" ticket.
async function nextTicketNumbers(Model: any, count: number): Promise<string[]> {
  const last = await Model.findOne({ ticket_number: /^TKT-\d+$/ })
    .sort({ ticket_number: -1 })
    .lean();
  let n = 0;
  const m = last?.ticket_number?.match(/TKT-(\d+)/);
  if (m) n = parseInt(m[1], 10);
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(`TKT-${String(n + i + 1).padStart(6, '0')}`);
  return out;
}

// Fires for the query router's insertMany (single or batch inserts).
(tickets as any).pre('insertMany', async function (this: any, next: any, docs: any) {
  try {
    const list = Array.isArray(docs) ? docs : [docs];
    const needing = list.filter((d: any) => !d.ticket_number || d.ticket_number === 'TEMP');
    if (needing.length) {
      const numbers = await nextTicketNumbers(this, needing.length);
      needing.forEach((d: any, i: number) => {
        d.ticket_number = numbers[i];
      });
    }
    next();
  } catch (err) {
    next(err as Error);
  }
});

// Belt-and-suspenders for any path that uses Model.create()/doc.save().
(tickets as any).pre('save', async function (this: any, next: any) {
  if (!this.ticket_number || this.ticket_number === 'TEMP') {
    const [num] = await nextTicketNumbers(this.constructor, 1);
    this.ticket_number = num;
  }
  next();
});

// tutorial_videos
const tutorialVideos = new Schema(
  {
    _id: idField,
    title: { type: String, required: true },
    description: { type: String, default: null },
    category: { type: String, default: null },
    video_url: { type: String, required: true },
    thumbnail_url: { type: String, default: null },
    duration_seconds: { type: Number, default: null },
    file_size_mb: { type: Number, default: null },
    display_order: { type: Number, default: 0 },
    is_published: { type: Boolean, default: true },
    view_count: { type: Number, default: 0 },
    uploaded_by: { type: String, default: null },
    created_at: ts(),
    updated_at: ts(),
  },
  baseOptions,
);

// units
const units = new Schema(
  {
    _id: idField,
    name: { type: String, required: true, unique: true },
    created_at: ts(),
  },
  baseOptions,
);

// user_notification_preferences (natural key: user_id)
const userNotificationPreferences = new Schema(
  {
    _id: idField,
    user_id: { type: String, required: true, unique: true, index: true },
    new_message: { type: Boolean, default: true },
    sla_at_risk: { type: Boolean, default: true },
    sla_breach: { type: Boolean, default: true },
    ticket_assigned: { type: Boolean, default: true },
    ticket_resolved: { type: Boolean, default: true },
    updated_at: ts(),
  },
  baseOptions,
);

// user_roles
const userRoles = new Schema(
  {
    _id: idField,
    user_id: { type: String, required: true, index: true },
    role: { type: String, enum: APP_ROLES, required: true },
  },
  baseOptions,
);

// ─────────────────────────────────────────────────────────────────────────────
// Registry: maps the old Postgres table name -> Mongoose model.
// The generic query router uses this to resolve `supabase.from('<table>')`.
// Typed as `any` so loosely-typed dynamic queries (.lean(), .find(), …) stay
// ergonomic — these are schemaless-from-TS's-view domain models.
export const models: Record<string, any> = {
  ai_config: model('ai_config', aiConfig, 'ai_config'),
  ai_conversations: model('ai_conversations', aiConversations, 'ai_conversations'),
  ai_messages: model('ai_messages', aiMessages, 'ai_messages'),
  allowed_google_domains: model('allowed_google_domains', allowedGoogleDomains, 'allowed_google_domains'),
  app_settings: model('app_settings', appSettings, 'app_settings'),
  departments: model('departments', departments, 'departments'),
  notifications: model('notifications', notifications, 'notifications'),
  profiles: model('profiles', profiles, 'profiles'),
  role_plant_access: model('role_plant_access', rolePlantAccess, 'role_plant_access'),
  roles: model('roles', roles, 'roles'),
  ticket_attachments: model('ticket_attachments', ticketAttachments, 'ticket_attachments'),
  ticket_history: model('ticket_history', ticketHistory, 'ticket_history'),
  ticket_messages: model('ticket_messages', ticketMessages, 'ticket_messages'),
  ticket_ratings: model('ticket_ratings', ticketRatings, 'ticket_ratings'),
  ticket_work_logs: model('ticket_work_logs', ticketWorkLogs, 'ticket_work_logs'),
  tickets: model('tickets', tickets, 'tickets'),
  tutorial_videos: model('tutorial_videos', tutorialVideos, 'tutorial_videos'),
  units: model('units', units, 'units'),
  user_notification_preferences: model('user_notification_preferences', userNotificationPreferences, 'user_notification_preferences'),
  user_roles: model('user_roles', userRoles, 'user_roles'),
};

export { AuthUser };
export function getModel(table: string): any {
  return models[table] ?? null;
}
