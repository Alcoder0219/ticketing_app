/**
 * Repair `role_plant_access` rows damaged by the old composite-upsert bug.
 *
 * The query router used to fall back to a literal `_id: '__never__'` document
 * whenever it could not resolve the conflict target, so saving a role's Plant /
 * Unit Access Control folded every plant row onto that single shared document.
 * The surviving row holds only the last plant of the last role saved.
 *
 * This script:
 *   1. deletes the `__never__` sentinel document (an artefact, not configuration)
 *   2. de-duplicates any (role_name, unit_name) pairs, keeping the newest row
 *
 * It does NOT reset or invent role configuration. A role left with no rows falls
 * back to the historical "unrestricted" behaviour until an admin re-saves it in
 * Settings → Roles & Permissions, which now persists correctly.
 *
 * Run before first boot on the fixed build (the unique index needs clean data):
 *
 *   npm run repair:plant-access
 */
import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import { models } from '../models/index.js';

const { role_plant_access } = models;

async function main() {
  await connectDB();

  const sentinel = await role_plant_access.deleteMany({ _id: '__never__' });
  if (sentinel.deletedCount) {
    console.log(`Removed ${sentinel.deletedCount} corrupt "__never__" sentinel row(s).`);
  } else {
    console.log('No "__never__" sentinel row found.');
  }

  // Collapse duplicates so the unique (role_name, unit_name) index can build.
  const rows = await role_plant_access.find({}).sort({ created_at: 1 }).lean();
  const seen = new Map<string, string>(); // "role|unit" -> _id of the row we keep
  const stale: string[] = [];
  for (const r of rows as any[]) {
    const key = `${r.role_name}|${r.unit_name}`;
    const prev = seen.get(key);
    if (prev) stale.push(prev); // an older row for the same pair — drop it
    seen.set(key, r._id);
  }
  if (stale.length) {
    await role_plant_access.deleteMany({ _id: { $in: stale } });
    console.log(`Removed ${stale.length} duplicate row(s), keeping the newest per (role, plant).`);
  } else {
    console.log('No duplicate (role, plant) rows found.');
  }

  const remaining = await role_plant_access.countDocuments({});
  console.log(`role_plant_access now holds ${remaining} row(s).`);

  const byRole = new Map<string, number>();
  for (const r of (await role_plant_access.find({ is_enabled: true }).lean()) as any[]) {
    byRole.set(r.role_name, (byRole.get(r.role_name) ?? 0) + 1);
  }
  if (byRole.size) {
    console.log('Enabled plants per role:');
    for (const [role, count] of byRole) console.log(`  ${role}: ${count}`);
  } else {
    console.log('No role currently has enabled plants — re-save each role in Settings.');
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
