import type { Server as HttpServer } from 'node:http';
import { Server as IOServer } from 'socket.io';
import { env } from '../config/env.js';
import { verifyToken } from '../auth/jwt.js';

let io: IOServer | null = null;

export type ChangeEvent = 'INSERT' | 'UPDATE' | 'DELETE';

/**
 * Initialise socket.io. Replaces Supabase Realtime: the client subscribes to
 * a room named after the table (`postgres_changes` on a table) and receives
 * `{ eventType, new, old, table }` payloads.
 */
export function initRealtime(server: HttpServer): IOServer {
  io = new IOServer(server, {
    cors: { origin: env.corsOrigins, credentials: true },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(); // allow anonymous read of public broadcasts
    try {
      const payload = verifyToken(token);
      (socket.data as any).userId = payload.sub;
    } catch {
      /* ignore bad tokens — connection stays anonymous */
    }
    next();
  });

  io.on('connection', (socket) => {
    // Client asks to watch a table: socket.emit('subscribe', 'tickets')
    socket.on('subscribe', (table: string) => socket.join(`table:${table}`));
    socket.on('unsubscribe', (table: string) => socket.leave(`table:${table}`));
  });

  console.log('[realtime] socket.io ready');
  return io;
}

/** Broadcast a row change to subscribers of the table. */
export function emitChange(table: string, eventType: ChangeEvent, row: any): void {
  if (!io) return;
  io.to(`table:${table}`).emit('postgres_changes', {
    table,
    eventType,
    new: eventType === 'DELETE' ? null : row,
    old: eventType === 'DELETE' ? row : null,
  });
}
