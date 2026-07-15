// Base HTTP layer for the MongoDB/Express backend that replaces Supabase.
// Holds the API base URL and the access token, and exposes a small fetch helper.

const API_BASE: string =
  (import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:4000';

export function apiBase(): string {
  return API_BASE.replace(/\/+$/, '');
}

const TOKEN_KEY = 'adt_access_token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export interface ApiResult<T> {
  data: T | null;
  error: { message: string; code?: string } | null;
  count?: number | null;
  status?: number;
}

/** Low-level JSON request that returns the parsed body and HTTP status. */
export async function apiFetch<T = any>(
  path: string,
  init: RequestInit = {},
): Promise<{ body: T; status: number }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const resp = await fetch(`${apiBase()}${path}`, { ...init, headers });
  const text = await resp.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { body: body as T, status: resp.status };
}
