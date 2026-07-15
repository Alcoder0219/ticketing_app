// Drop-in replacement for the Supabase client, backed by the Express/MongoDB
// backend. Exposes the same surface the app already uses:
//   supabase.from(table)…  supabase.auth.*  supabase.storage.*
//   supabase.functions.invoke()  supabase.rpc()  supabase.channel()/removeChannel()
import { apiFetch } from './http';
import { QueryBuilder } from './queryBuilder';
import { authClient } from './auth';
import { storageClient } from './storage';
import { realtime, type RealtimeChannel } from './realtime';

export const api = {
  from(table: string) {
    return new QueryBuilder(table);
  },

  auth: authClient,
  storage: storageClient,

  async rpc(fn: string, args?: Record<string, any>) {
    try {
      const { body, status } = await apiFetch<{ data: any; error: any }>(`/rest/rpc/${fn}`, {
        method: 'POST',
        body: JSON.stringify(args ?? {}),
      });
      return { data: body?.data ?? null, error: body?.error ?? null, status };
    } catch (err: any) {
      return { data: null, error: { message: err?.message ?? 'RPC failed' }, status: 0 };
    }
  },

  functions: {
    async invoke(name: string, opts?: { body?: any }) {
      try {
        const { body, status } = await apiFetch<any>(`/functions/v1/${name}`, {
          method: 'POST',
          body: JSON.stringify(opts?.body ?? {}),
        });
        if (status >= 400) {
          return { data: body ?? null, error: { message: body?.error ?? `Function ${name} failed`, status } };
        }
        return { data: body, error: null };
      } catch (err: any) {
        return { data: null, error: { message: err?.message ?? 'Function call failed' } };
      }
    },
  },

  channel(name: string) {
    return realtime.channel(name);
  },
  removeChannel(channel: RealtimeChannel) {
    realtime.removeChannel(channel);
  },
};

// The app refers to the client as `supabase` in ~34 call sites. It's now just a
// local alias for the API client above — no Supabase code or dependency remains.
export const supabase = api;
export default api;
