import { Router } from 'express';
import { AuthUser, models } from '../models/index.js';
import { requireAuth } from '../auth/middleware.js';
import { createUser } from '../auth/service.js';
import bcrypt from 'bcryptjs';
import { getUserRole } from '../auth/authz.js';
import { handleChatWithAI } from './chatWithAI.js';
import { handleClassifyExtract } from './classifyExtract.js';
import { syncTicketsToSheets } from './integrations.js';

export const functionsRouter = Router();

const { user_roles, profiles, tickets, ticket_history } = models;

/** Guard: caller must be admin or super_admin (matches the edge functions). */
function adminGuard() {
  return [
    requireAuth,
    (req: any, res: any, next: any) => {
      if (req.auth?.isSuperAdmin || req.auth?.isAdmin) return next();
      return res.status(400).json({ error: 'Insufficient permissions' });
    },
  ];
}

// ── admin-create-user ─────────────────────────────────────────────────────────
functionsRouter.post('/admin-create-user', ...adminGuard(), async (req, res) => {
  try {
    const caller = req.auth!;
    const { email, password, name, username, employeeId, contact, role, departmentId, unitId } =
      req.body ?? {};
    if (!unitId || unitId === 'none') throw new Error('Please select a unit');
    if (role && ['super_admin', 'admin'].includes(role) && !caller.isSuperAdmin) {
      throw new Error('Only a super admin can assign admin or super admin roles');
    }

    const user = await createUser({
      email,
      password,
      meta: { name, username, employee_id: employeeId, contact },
      emailConfirmed: true,
    });

    if (role && role !== 'user') {
      await user_roles.updateOne({ user_id: user._id }, { $set: { role } });
    }
    const profileUpdates: Record<string, unknown> = { unit_id: unitId };
    if (departmentId && departmentId !== 'none') profileUpdates.department_id = departmentId;
    await profiles.updateOne({ user_id: user._id }, { $set: profileUpdates });

    return res.json({ success: true, userId: user._id });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

// ── admin-update-user-credentials ─────────────────────────────────────────────
functionsRouter.post('/admin-update-user-credentials', ...adminGuard(), async (req, res) => {
  try {
    const caller = req.auth!;
    const { userId, email, password } = req.body ?? {};
    if (!userId) throw new Error('userId required');

    if (!caller.isSuperAdmin && userId !== caller.userId) {
      const targetRole = await getUserRole(userId);
      if (targetRole === 'super_admin') {
        throw new Error("Only a super admin can modify another super admin's credentials");
      }
    }

    const updates: Record<string, unknown> = {};
    if (email && email.trim()) updates.email = email.trim().toLowerCase();
    if (password && password.length > 0) {
      if (password.length < 6) throw new Error('Password must be at least 6 characters');
      updates.encrypted_password = await bcrypt.hash(password, 10);
    }
    if (Object.keys(updates).length === 0) return res.json({ success: true, skipped: true });

    await AuthUser.updateOne({ _id: userId }, { $set: updates });
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

// ── admin-delete-user ─────────────────────────────────────────────────────────
functionsRouter.post('/admin-delete-user', ...adminGuard(), async (req, res) => {
  try {
    const caller = req.auth!;
    const { userId } = req.body ?? {};
    if (!userId) throw new Error('userId is required');
    if (userId === caller.userId) throw new Error('You cannot delete your own account');

    if (!caller.isSuperAdmin) {
      const targetRole = await getUserRole(userId);
      if (targetRole === 'super_admin') {
        throw new Error('Only a super admin can delete another super admin');
      }
    }

    const [ticketsRaised, historyCount] = await Promise.all([
      tickets.countDocuments({ raised_by: userId }),
      ticket_history.countDocuments({ performed_by: userId }),
    ]);
    const hasActivity = ticketsRaised > 0 || historyCount > 0;

    if (hasActivity) {
      // Soft-delete: revoke role + disable login, preserve profile for audit.
      await user_roles.deleteMany({ user_id: userId });
      await AuthUser.updateOne({ _id: userId }, { $set: { disabled: true } });
      return res.json({
        success: true,
        mode: 'deactivated',
        message:
          'User had activity history. Account access revoked and login disabled; audit records preserved.',
      });
    }

    // Hard-delete: no activity, remove everything.
    await user_roles.deleteMany({ user_id: userId });
    await profiles.deleteMany({ user_id: userId });
    await AuthUser.deleteOne({ _id: userId });
    return res.json({ success: true, mode: 'deleted' });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

// ── Integration functions (AI / Google Sheets) ───────────────────────────────
functionsRouter.post('/chat-with-ai', requireAuth, handleChatWithAI);
functionsRouter.post('/ai-classify-extract', requireAuth, handleClassifyExtract);
functionsRouter.post('/sync-tickets-to-sheets', requireAuth, syncTicketsToSheets);
