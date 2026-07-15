import { Schema, model } from 'mongoose';
import { baseOptions, idField } from './_base.js';

/**
 * Replaces Supabase's `auth.users` table. The `_id` of an AuthUser is the
 * `user_id` referenced throughout the app (profiles.user_id, tickets.raised_by,
 * user_roles.user_id, etc.).
 */
const authUserSchema = new Schema(
  {
    _id: idField,
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    encrypted_password: { type: String, default: null }, // null for pure-OAuth users
    auth_provider: { type: String, default: 'email' }, // 'email' | 'google'
    email_confirmed_at: { type: Date, default: null },
    disabled: { type: Boolean, default: false }, // soft-delete / ban flag
    // arbitrary signup metadata (name, employee_id, contact) — mirrors raw_user_meta_data
    raw_user_meta_data: { type: Schema.Types.Mixed, default: {} },
    last_sign_in_at: { type: Date, default: null },
    created_at: { type: Date, default: () => new Date() },
    updated_at: { type: Date, default: () => new Date() },
  },
  baseOptions,
);

// Never leak the password hash through JSON serialization.
authUserSchema.set('toJSON', {
  transform(_doc, ret: Record<string, unknown>) {
    ret.id = ret._id;
    delete ret._id;
    delete ret.encrypted_password;
    for (const k of Object.keys(ret)) {
      if (ret[k] instanceof Date) ret[k] = (ret[k] as Date).toISOString();
    }
    return ret;
  },
});

export const AuthUser = model<any>('AuthUser', authUserSchema, 'auth_users');
