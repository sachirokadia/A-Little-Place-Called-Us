import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** In a production build, the Supabase URL must be HTTPS: an http:// URL would send the
 *  session token in cleartext. Local development (import.meta.env.DEV) still allows http://
 *  for a self-hosted Supabase. A non-HTTPS production URL is treated as not configured,
 *  so the app fails safe to the misconfiguration screen instead of signing in insecurely. */
const supabaseUrlOk = Boolean(SUPABASE_URL) && (import.meta.env.DEV || SUPABASE_URL!.startsWith('https://'));

/** True only when both public (anon) variables are present and the URL is safe. The service-role key is NEVER used here. */
export const supabaseConfigured = Boolean(supabaseUrlOk && SUPABASE_ANON_KEY);

export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(SUPABASE_URL as string, SUPABASE_ANON_KEY as string, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;
