/**
 * Create (or re-enable) a super-admin account so you can log in after migration.
 *
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=secret npm run seed:admin
 */
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { connectDB } from '../config/db.js';
import { AuthUser, models } from '../models/index.js';
import { createUser } from '../auth/service.js';

async function main() {
  const email = (process.env.ADMIN_EMAIL ?? 'admin@aumdacro.local').toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? 'ChangeMe123!';
  const name = process.env.ADMIN_NAME ?? 'Super Admin';

  await connectDB();

  let user = await AuthUser.findOne({ email });
  if (user) {
    user.encrypted_password = await bcrypt.hash(password, 10);
    user.disabled = false;
    await user.save();
    await models.user_roles.updateOne(
      { user_id: user._id },
      { $set: { role: 'super_admin' } },
      { upsert: true },
    );
    console.log(`Re-enabled existing user ${email} as super_admin.`);
  } else {
    user = await createUser({
      email,
      password,
      meta: { name, role: 'super_admin' },
      emailConfirmed: true,
    });
    await models.user_roles.updateOne(
      { user_id: user._id },
      { $set: { role: 'super_admin' } },
      { upsert: true },
    );
    console.log(`Created super-admin ${email}.`);
  }

  console.log(`Login with: ${email} / ${password}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
