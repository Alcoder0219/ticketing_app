import bcrypt from 'bcryptjs';
import { AuthUser, models } from '../models/index.js';
import type { AppRole } from '../models/enums.js';

const { profiles, user_roles, allowed_google_domains } = models;

export interface SignupMeta {
  name?: string;
  username?: string;
  employee_id?: string;
  contact?: string;
  role?: AppRole;
}

/** Shape returned to the client, mirroring a Supabase auth user. */
export function toAuthUserJson(u: any) {
  return {
    id: u._id,
    email: u.email,
    app_metadata: { provider: u.auth_provider ?? 'email' },
    user_metadata: u.raw_user_meta_data ?? {},
    created_at: (u.created_at instanceof Date ? u.created_at : new Date(u.created_at)).toISOString(),
  };
}

/** Port of public.check_google_domain_on_signup(_email). */
export async function isGoogleDomainAllowed(email: string): Promise<boolean> {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return false;
  const active = await allowed_google_domains.find({ is_active: true }).lean();
  // No allow-list configured => allow all (matches original permissive default).
  if (!active.length) return true;
  return active.some((d) => (d.domain_name as string).toLowerCase() === domain);
}

/**
 * Create an auth user + profile + default role — the equivalent of inserting
 * into auth.users and firing the handle_new_user() trigger.
 */
export async function createUser(opts: {
  email: string;
  password?: string;
  meta?: SignupMeta;
  provider?: string;
  emailConfirmed?: boolean;
}) {
  const email = opts.email.toLowerCase().trim();
  const existing = await AuthUser.findOne({ email });
  if (existing) throw Object.assign(new Error('User already registered'), { status: 422 });

  const meta = opts.meta ?? {};
  const user = await AuthUser.create({
    email,
    encrypted_password: opts.password ? await bcrypt.hash(opts.password, 10) : null,
    auth_provider: opts.provider ?? 'email',
    email_confirmed_at: opts.emailConfirmed ? new Date() : null,
    raw_user_meta_data: meta,
  });

  // handle_new_user(): create the profile
  const name = (meta.name ?? '').trim() || email;
  const username = (meta.username ?? email.split('@')[0]).trim() || null;
  await profiles.create({
    user_id: user._id,
    name,
    username,
    employee_id: (meta.employee_id ?? '').trim() || null,
    contact: (meta.contact ?? '').trim() || null,
    auth_provider: opts.provider ?? 'email',
  });

  // handle_new_user(): default role from metadata or 'user'
  const role: AppRole = meta.role ?? 'user';
  await user_roles.create({ user_id: user._id, role });

  return user;
}

export async function verifyPassword(email: string, password: string) {
  const user = await AuthUser.findOne({ email: email.toLowerCase().trim() });
  if (!user || !user.encrypted_password || user.disabled) return null;
  const ok = await bcrypt.compare(password, user.encrypted_password);
  if (!ok) return null;
  user.last_sign_in_at = new Date();
  await user.save();
  return user;
}
