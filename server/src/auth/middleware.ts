import type { Request, Response, NextFunction } from 'express';
import { verifyToken } from './jwt.js';
import { buildAuthContext, type AuthContext } from './authz.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  // supabase-js also sends the key in `apikey`; we ignore it.
  return null;
}

/** Require a valid JWT and attach the authorization context to req.auth. */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ message: 'Missing authorization token' });
  try {
    const payload = verifyToken(token);
    req.auth = await buildAuthContext(payload.sub, payload.email);
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

/** Attach auth context if a token is present, but never reject. */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (token) {
    try {
      const payload = verifyToken(token);
      req.auth = await buildAuthContext(payload.sub, payload.email);
    } catch {
      /* ignore */
    }
  }
  next();
}

/** Require one of the given roles (server-side guard for admin endpoints). */
export function requireRole(...allowed: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const role = req.auth?.role;
    if (req.auth?.isSuperAdmin || (role && allowed.includes(role))) return next();
    return res.status(403).json({ message: 'Forbidden: insufficient role' });
  };
}
