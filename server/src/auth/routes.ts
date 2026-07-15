import { Router } from 'express';
import { AuthUser } from '../models/index.js';
import { signToken } from './jwt.js';
import { requireAuth } from './middleware.js';
import {
  createUser,
  verifyPassword,
  toAuthUserJson,
  isGoogleDomainAllowed,
} from './service.js';
import { env } from '../config/env.js';

export const authRouter = Router();

function sessionFor(user: any) {
  const access_token = signToken({ sub: user._id, email: user.email });
  return {
    access_token,
    token_type: 'bearer',
    // Informational only; the JWT itself carries the real expiry.
    expires_in: 60 * 60 * 24 * 7,
    refresh_token: access_token,
    user: toAuthUserJson(user),
  };
}

// POST /auth/signup  { email, password, data }
authRouter.post('/signup', async (req, res) => {
  try {
    const { email, password, data } = req.body ?? {};
    if (!email || !password) {
      return res.status(400).json({ message: 'email and password are required' });
    }
    const user = await createUser({ email, password, meta: data ?? {} });
    return res.json({ user: toAuthUserJson(user), session: sessionFor(user) });
  } catch (err: any) {
    return res.status(err.status ?? 400).json({ message: err.message ?? 'Signup failed' });
  }
});

// POST /auth/login  { email, password }
authRouter.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  const user = await verifyPassword(email ?? '', password ?? '');
  if (!user) return res.status(400).json({ message: 'Invalid login credentials' });
  return res.json({ user: toAuthUserJson(user), session: sessionFor(user) });
});

// POST /auth/logout — stateless JWT, nothing to revoke server-side.
authRouter.post('/logout', (_req, res) => res.json({ success: true }));

// GET /auth/user — current user from the bearer token.
authRouter.get('/user', requireAuth, async (req, res) => {
  const user = await AuthUser.findById(req.auth!.userId);
  if (!user) return res.status(404).json({ message: 'User not found' });
  return res.json({ user: toAuthUserJson(user) });
});

// GET /auth/session — used by the client shim to restore a session.
authRouter.get('/session', requireAuth, async (req, res) => {
  const user = await AuthUser.findById(req.auth!.userId);
  if (!user) return res.status(404).json({ message: 'User not found' });
  return res.json({ session: sessionFor(user) });
});

// POST /auth/update-user  { password?, email? } — self-service credential update.
authRouter.post('/update-user', requireAuth, async (req, res) => {
  try {
    const { password, email } = req.body ?? {};
    const updates: Record<string, unknown> = {};
    if (email && String(email).trim()) updates.email = String(email).trim().toLowerCase();
    if (password && String(password).length > 0) {
      if (String(password).length < 6) throw new Error('Password must be at least 6 characters');
      const bcrypt = await import('bcryptjs');
      updates.encrypted_password = await bcrypt.default.hash(String(password), 10);
    }
    if (Object.keys(updates).length === 0) return res.json({ user: null, error: null });
    await AuthUser.updateOne({ _id: req.auth!.userId }, { $set: updates });
    const user = await AuthUser.findById(req.auth!.userId);
    return res.json({ user: toAuthUserJson(user), error: null });
  } catch (err: any) {
    return res.status(400).json({ message: err.message ?? 'Update failed' });
  }
});

// POST /auth/check-google-domain  { email }
authRouter.post('/check-google-domain', async (req, res) => {
  const allowed = await isGoogleDomainAllowed(req.body?.email ?? '');
  return res.json({ allowed });
});

export { env };
