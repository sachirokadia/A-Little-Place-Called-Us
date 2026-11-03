// API client. The browser holds NO session token and NO auth
// decision: the session lives in an HTTP-only cookie, and every
// state-changing request carries a session-bound CSRF token in a
// header. User content is rendered as text, never as HTML.

let csrfToken: string | null = null;
let csrfPromise: Promise<string> | null = null;

async function fetchCsrf(): Promise<string> {
  if (csrfPromise) return csrfPromise;
  csrfPromise = (async () => {
    const res = await fetch('/api/v1/auth/csrf', { credentials: 'include' });
    if (!res.ok) throw new Error('Could not start a session');
    const body = (await res.json()) as { data: { csrfToken: string } };
    csrfToken = body.data.csrfToken;
    return csrfToken;
  })();
  try {
    return await csrfPromise;
  } finally {
    csrfPromise = null;
  }
}

export interface ApiOptions { method?: string; body?: unknown; form?: FormData; idempotencyKey?: string; raw?: boolean }

/** Error carrying the HTTP status, so callers can tell a genuine
 * 401 (signed out) from a transient 429/5xx (session unknown). */
export class ApiRequestError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const doFetch = async (token: string | null): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (options.form) {
      // Let the browser set the multipart boundary.
    } else if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (method !== 'GET' && token) headers['X-CSRF-Token'] = token;
    if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
    return fetch(`/api/v1${path}`, {
      method,
      credentials: 'include',
      headers,
      body: options.form ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
    });
  };
  let token: string | null = null;
  if (method !== 'GET') token = csrfToken ?? (await fetchCsrf());
  let res = await doFetch(token);
  if (res.status === 403 && method !== 'GET') {
    // CSRF token may have rotated (e.g. after a password change):
    // fetch a fresh one and retry once.
    token = await fetchCsrf();
    res = await doFetch(token);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (body as { error?: { message?: string } }).error?.message ?? `Request failed (${res.status})`;
    throw new ApiRequestError(res.status, message);
  }
  // raw: return the whole response body (used by the export download,
  // which tolerates both an envelope and a bare JSON object).
  if (options.raw) return body as T;
  return (body as { data: T }).data;
}

export function setCsrf(token: string | null): void {
  csrfToken = token;
}

export interface Me {
  id: string; email: string; displayName: string; avatarKey: string; spaceId: string | null;
}
export interface Space {
  id: string; name: string; members: { id: string; displayName: string; avatarKey: string; role: string }[];
}
export type AnyItem = Record<string, unknown> & { id: string; authorId: string; title?: string; text?: string; body?: string };

export type MotionPreference = 'system' | 'reduce' | 'full';
export interface Preferences { motion: MotionPreference; soundEnabled: boolean; onboardingSeen: boolean }
export const DEFAULT_PREFERENCES: Preferences = { motion: 'system', soundEnabled: false, onboardingSeen: false };
export const getPreferences = () => api<Preferences>('/auth/preferences');
export const savePreferences = (prefs: Preferences) => api<Preferences>('/auth/preferences', { method: 'PUT', body: prefs });
/** Apply the motion preference to the page: only 'reduce' adds the class.
 * 'system' leaves it to the OS media query; 'full' never adds it. */
export function applyMotionPreference(motion: MotionPreference): void {
  if (typeof document === 'undefined') return;
  document.body.classList.toggle('reduce-motion', motion === 'reduce');
}

export const getMe = () => api<Me>('/auth/me');
export const getSpace = () => api<Space | null>('/spaces/me');
export const listItems = (spaceId: string, plural: string, query = '') =>
  api<AnyItem[]>(`/spaces/${spaceId}/${plural}${query}`);
export const getItem = (singular: string, id: string) => api<AnyItem>(`/${singular}/${id}`);
