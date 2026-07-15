import { Router } from 'express';
import { models } from '../models/index.js';
import { requireAuth } from '../auth/middleware.js';
import {
  hasRole,
  getUserRole,
  getUserDepartmentId,
  userAllowedUnitIds,
  userAllowedUnitNames,
  userCanViewAllTickets,
} from '../auth/authz.js';

export const rpcRouter = Router();

/** SLA hours per priority — ported from compute_sla_hours(). */
function computeSlaHours(priority: string): { response_hours: number; resolution_hours: number } {
  switch (priority) {
    case 'critical':
      return { response_hours: 1, resolution_hours: 4 };
    case 'high':
      return { response_hours: 2, resolution_hours: 8 };
    case 'medium':
      return { response_hours: 4, resolution_hours: 24 };
    case 'low':
    default:
      return { response_hours: 8, resolution_hours: 48 };
  }
}

/**
 * POST /rest/rpc/:fn  { ...args }
 * Ports the Postgres functions invoked via supabase.rpc(...).
 */
rpcRouter.post('/:fn', requireAuth, async (req, res) => {
  const fn = req.params.fn;
  const args = req.body ?? {};
  const uid = req.auth!.userId;

  try {
    switch (fn) {
      case 'increment_tutorial_view': {
        await models.tutorial_videos.updateOne(
          { _id: args._id },
          { $inc: { view_count: 1 } },
        );
        return res.json({ data: null, error: null });
      }
      case 'compute_sla_hours':
        return res.json({ data: computeSlaHours(args._priority ?? 'low'), error: null });
      case 'has_role':
        return res.json({ data: await hasRole(args._user_id ?? uid, args._role), error: null });
      case 'get_user_role':
        return res.json({ data: await getUserRole(args._user_id ?? uid), error: null });
      case 'get_user_department_id':
        return res.json({ data: await getUserDepartmentId(args._user_id ?? uid), error: null });
      case 'user_allowed_unit_ids':
        return res.json({ data: await userAllowedUnitIds(args._user_id ?? uid), error: null });
      case 'user_allowed_unit_names':
        return res.json({ data: await userAllowedUnitNames(args._user_id ?? uid), error: null });
      case 'user_can_view_all_tickets':
        return res.json({ data: await userCanViewAllTickets(args._user_id ?? uid), error: null });
      case 'notify_user': {
        await models.notifications.create({
          user_id: args._user_id,
          ticket_id: args._ticket_id ?? null,
          title: args._title,
          message: args._message,
          type: args._type ?? 'general',
        });
        return res.json({ data: null, error: null });
      }
      default:
        return res.json({
          data: null,
          error: { message: `RPC not implemented: ${fn}` },
        });
    }
  } catch (err: any) {
    return res.json({ data: null, error: { message: err.message ?? 'RPC failed' } });
  }
});
