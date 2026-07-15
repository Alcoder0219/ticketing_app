// Realtime client mirroring supabase.channel(...).on('postgres_changes', ...).subscribe()
// and supabase.removeChannel(...), backed by socket.io.
import { io, type Socket } from 'socket.io-client';
import { apiBase, getToken } from './http';

let socket: Socket | null = null;

function getSocket(): Socket {
  if (!socket) {
    socket = io(apiBase(), {
      transports: ['websocket'],
      auth: { token: getToken() },
      autoConnect: true,
    });
  }
  return socket;
}

interface Binding {
  event: string; // '*' | 'INSERT' | 'UPDATE' | 'DELETE'
  table: string;
  filter?: string;
  callback: (payload: any) => void;
}

export class RealtimeChannel {
  private bindings: Binding[] = [];
  private subscribedTables = new Set<string>();
  private handler = (payload: any) => {
    for (const b of this.bindings) {
      if (b.table !== payload.table) continue;
      if (b.event !== '*' && b.event !== payload.eventType) continue;
      b.callback({ ...payload, schema: 'public' });
    }
  };

  constructor(public name: string) {}

  on(
    type: 'postgres_changes',
    opts: { event: string; schema?: string; table: string; filter?: string },
    callback: (payload: any) => void,
  ) {
    this.bindings.push({ event: opts.event, table: opts.table, filter: opts.filter, callback });
    return this;
  }

  subscribe(cb?: (status: string) => void) {
    const s = getSocket();
    s.on('postgres_changes', this.handler);
    for (const b of this.bindings) {
      if (!this.subscribedTables.has(b.table)) {
        this.subscribedTables.add(b.table);
        s.emit('subscribe', b.table);
      }
    }
    cb?.('SUBSCRIBED');
    return this;
  }

  unsubscribe() {
    const s = getSocket();
    s.off('postgres_changes', this.handler);
    for (const t of this.subscribedTables) s.emit('unsubscribe', t);
    this.subscribedTables.clear();
    return this;
  }
}

export const realtime = {
  channel(name: string) {
    return new RealtimeChannel(name);
  },
  removeChannel(channel: RealtimeChannel) {
    channel.unsubscribe();
  },
};
