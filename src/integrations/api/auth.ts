// Auth client mirroring the subset of supabase.auth used by the app.
import { apiFetch, setToken, getToken } from './http';

export interface AuthUser {
  id: string;
  email: string;
  user_metadata?: Record<string, any>;
  app_metadata?: Record<string, any>;
  created_at?: string;
}
export interface Session {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  user: AuthUser;
}

type AuthEvent = 'INITIAL_SESSION' | 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED';
type Listener = (event: AuthEvent, session: Session | null) => void;

let currentSession: Session | null = null;
let restorePromise: Promise<void> | null = null;
const listeners = new Set<Listener>();

function notify(event: AuthEvent) {
  for (const l of listeners) {
    try {
      l(event, currentSession);
    } catch {
      /* ignore */
    }
  }
}

function setSession(session: Session | null) {
  currentSession = session;
  setToken(session?.access_token ?? null);
}

async function restore(): Promise<void> {
  // Share a single in-flight promise so concurrent callers (onAuthStateChange
  // + getSession on page load) all await the SAME /auth/session fetch. Without
  // this, the second caller returned early with a null session and the route
  // guard bounced the user to /login on every refresh.
  if (restorePromise) return restorePromise;
  restorePromise = (async () => {
    const token = getToken();
    if (!token) return;
    try {
      const { body, status } = await apiFetch<{ session: Session }>('/auth/session', {
        method: 'GET',
      });
      // Only clear the stored session on a definitive auth rejection — a
      // transient network/server error must NOT log the user out.
      if (status === 200 && body?.session) currentSession = body.session;
      else if (status === 401) setSession(null);
    } catch {
      /* network error — keep the token, let the next call retry */
    }
  })();
  return restorePromise;
}

export const authClient = {
  async signInWithPassword({ email, password }: { email: string; password: string }) {
    const { body, status } = await apiFetch<{ user: AuthUser; session: Session; message?: string }>(
      '/auth/login',
      { method: 'POST', body: JSON.stringify({ email, password }) },
    );
    if (status !== 200 || !body?.session) {
      return { data: { user: null, session: null }, error: { message: body?.message ?? 'Invalid login credentials' } };
    }
    setSession(body.session);
    notify('SIGNED_IN');
    return { data: { user: body.user, session: body.session }, error: null };
  },

  async signUp({
    email,
    password,
    options,
  }: {
    email: string;
    password: string;
    options?: { data?: Record<string, any> };
  }) {
    const { body, status } = await apiFetch<{ user: AuthUser; session: Session; message?: string }>(
      '/auth/signup',
      { method: 'POST', body: JSON.stringify({ email, password, data: options?.data ?? {} }) },
    );
    if (status !== 200 || !body?.session) {
      return { data: { user: null, session: null }, error: { message: body?.message ?? 'Sign up failed' } };
    }
    setSession(body.session);
    notify('SIGNED_IN');
    return { data: { user: body.user, session: body.session }, error: null };
  },

  async updateUser(attrs: { password?: string; email?: string }) {
    const { body, status } = await apiFetch<{ user: AuthUser | null; message?: string }>(
      '/auth/update-user',
      { method: 'POST', body: JSON.stringify(attrs) },
    );
    if (status !== 200) {
      return { data: { user: null }, error: { message: body?.message ?? 'Update failed' } };
    }
    return { data: { user: body?.user ?? null }, error: null };
  },

  async signOut() {
    await apiFetch('/auth/logout', { method: 'POST' }).catch(() => undefined);
    setSession(null);
    notify('SIGNED_OUT');
    return { error: null };
  },

  async getSession() {
    await restore();
    return { data: { session: currentSession }, error: null };
  },

  async getUser() {
    await restore();
    if (!currentSession) return { data: { user: null }, error: { message: 'Not authenticated' } };
    const { body, status } = await apiFetch<{ user: AuthUser }>('/auth/user', { method: 'GET' });
    if (status !== 200) return { data: { user: null }, error: { message: 'Not authenticated' } };
    return { data: { user: body.user }, error: null };
  },

  onAuthStateChange(callback: Listener) {
    listeners.add(callback);
    // Emit the initial session asynchronously, like supabase-js does.
    void restore().then(() => callback('INITIAL_SESSION', currentSession));
    return {
      data: {
        subscription: {
          unsubscribe() {
            listeners.delete(callback);
          },
        },
      },
    };
  },
};
