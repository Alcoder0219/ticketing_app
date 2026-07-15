/**
 * One-time data migration: copies all rows from the old Supabase/Postgres
 * project into MongoDB.
 *
 *   1. Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in server/.env
 *   2. npm run migrate:from-supabase
 *
 * NOTE on auth: Supabase does not expose password hashes via its Admin API, so
 * migrated users are created WITHOUT a password and are `disabled` until an
 * admin sets new credentials (admin-update-user-credentials) or you run a
 * password-reset flow. Their ids/emails/metadata are preserved so all foreign
 * keys (raised_by, assigned_to, …) keep pointing at the right people.
 */
import { connectDB } from '../config/db.js';
import { env } from '../config/env.js';
import { AuthUser, models } from '../models/index.js';
import mongoose from 'mongoose';

const TABLES = Object.keys(models);

async function fetchAll(table: string): Promise<any[]> {
  const out: any[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const resp = await fetch(`${env.supabaseUrl}/rest/v1/${table}?select=*`, {
      headers: {
        apikey: env.supabaseServiceRoleKey,
        Authorization: `Bearer ${env.supabaseServiceRoleKey}`,
        Range: `${from}-${to}`,
        Prefer: 'count=exact',
      },
    });
    if (!resp.ok) {
      console.warn(`  ! ${table}: HTTP ${resp.status} ${await resp.text()}`);
      break;
    }
    const rows = (await resp.json()) as any[];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

/** Map a Supabase row (string `id`) into a Mongo doc (`_id`). */
function toDoc(row: any): any {
  if (row.id !== undefined) {
    const { id, ...rest } = row;
    return { _id: id, ...rest };
  }
  return row;
}

async function migrateTable(table: string): Promise<void> {
  const rows = await fetchAll(table);
  if (!rows.length) {
    console.log(`  - ${table}: 0 rows`);
    return;
  }
  const model = models[table];
  await model.collection.deleteMany({});
  await model.collection.insertMany(rows.map(toDoc), { ordered: false }).catch((e) => {
    console.warn(`  ! ${table}: ${e.message}`);
  });
  console.log(`  ✓ ${table}: ${rows.length} rows`);
}

async function migrateAuthUsers(): Promise<void> {
  const out: any[] = [];
  let page = 1;
  for (;;) {
    const resp = await fetch(
      `${env.supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=200`,
      {
        headers: {
          apikey: env.supabaseServiceRoleKey,
          Authorization: `Bearer ${env.supabaseServiceRoleKey}`,
        },
      },
    );
    if (!resp.ok) {
      console.warn(`  ! auth users: HTTP ${resp.status}`);
      break;
    }
    const body = (await resp.json()) as any;
    const users = body.users ?? [];
    out.push(...users);
    if (users.length < 200) break;
    page += 1;
  }

  await AuthUser.collection.deleteMany({});
  if (out.length) {
    await AuthUser.collection.insertMany(
      out.map((u) => ({
        _id: u.id,
        email: (u.email ?? '').toLowerCase(),
        encrypted_password: null, // not exportable from Supabase
        auth_provider: u.app_metadata?.provider ?? 'email',
        email_confirmed_at: u.email_confirmed_at ? new Date(u.email_confirmed_at) : null,
        disabled: true, // until an admin sets a password
        raw_user_meta_data: u.user_metadata ?? {},
        created_at: u.created_at ? new Date(u.created_at) : new Date(),
        updated_at: new Date(),
      })),
      { ordered: false },
    ).catch((e) => console.warn(`  ! auth users: ${e.message}`));
  }
  console.log(`  ✓ auth_users: ${out.length} users (disabled until password reset)`);
}

async function main() {
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
    throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in server/.env');
  }
  await connectDB();
  console.log('Migrating auth users…');
  await migrateAuthUsers();
  console.log('Migrating tables…');
  for (const table of TABLES) await migrateTable(table);
  console.log('Done.');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
