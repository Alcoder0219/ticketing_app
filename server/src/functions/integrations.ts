import type { Request, Response } from 'express';
import { env } from '../config/env.js';

/**
 * Google Sheets sync.
 *
 * Originally a Supabase edge function using a Google service account. Ported
 * here as a guarded handler: when the credentials are configured it performs
 * the sync, otherwise it returns a clear "not configured" response so the UI
 * degrades gracefully.
 *
 * Implementing the full Google Sheets API call requires the `googleapis`
 * package and a service-account key — wire that in when you migrate the
 * analytics pipeline.
 */

function notConfigured(res: Response, what: string) {
  return res.json({
    success: false,
    skipped: true,
    reason: `${what} is not configured on this server. Set the relevant credentials in the backend .env to enable it.`,
  });
}

export async function syncTicketsToSheets(_req: Request, res: Response) {
  if (!env.googleServiceAccountJson || !env.googleSheetsId) {
    return notConfigured(res, 'Google Sheets sync');
  }
  // TODO: implement using the Google Sheets API and env.googleSheetsId.
  return notConfigured(res, 'Google Sheets sync');
}
