/* Plain-PostgreSQL API client. Used only when VITE_API_URL is set.
 * The token lives in localStorage (this device only). It is sent as a Bearer
 * header; it is never put in a URL except for short-lived media tokens, which
 * the server issues itself. No DATABASE_URL or JWT_SECRET ever reaches here. */
export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || '';
export const apiConfigured = Boolean(API_URL);

const TOKEN_KEY = 'our-place-api-token';
export function getApiToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setApiToken(token: string) {
  try { localStorage.setItem(TOKEN_KEY, token); } catch { /* ignore */ }
}
export function clearApiToken() {
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> || {}) };
  const token = getApiToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (init.body && typeof init.body === 'string') headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  let data: unknown = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error || `Request failed (${res.status}). Please try again.`;
    throw new Error(msg);
  }
  return data;
}

export async function apiRegister(email: string, password: string, displayName: string): Promise<void> {
  const data = await apiFetch('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password, displayName }) }) as { token: string };
  setApiToken(data.token);
}
export async function apiLogin(email: string, password: string): Promise<void> {
  const data = await apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }) as { token: string };
  setApiToken(data.token);
}
export async function apiMe(): Promise<{ id: string; email: string; displayName: string }> {
  return apiFetch('/api/auth/me') as Promise<{ id: string; email: string; displayName: string }>;
}
