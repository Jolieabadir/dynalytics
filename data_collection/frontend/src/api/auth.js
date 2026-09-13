/**
 * Supabase session access.
 *
 * The backend requires `Authorization: Bearer <supabase access token>` on every
 * /api route except /api/health. This module is the one place that produces
 * that token.
 *
 * Scope note: this branch adds only the token *reader*, not a sign-in UI. The
 * app had no Supabase client at all, while `.env` already carried
 * VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. A later pass owns the login
 * screen; until it lands, an unauthenticated user gets a clear message from
 * requireAccessToken() instead of an opaque 401.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export class NotSignedInError extends Error {
  constructor(
    message = 'You are not signed in. Sign in before uploading, or your work cannot be saved.'
  ) {
    super(message);
    this.name = 'NotSignedIn';
  }
}

let client = null;

/** The shared Supabase client, or null when env vars are absent. */
export function getSupabase() {
  if (client) return client;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return client;
}

export function isAuthConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

/** Current access token, or null if there is no session. */
export async function getAccessToken() {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) return null;
  return data?.session?.access_token ?? null;
}

/** Access token, or throw with a message worth showing a user. */
export async function requireAccessToken() {
  if (!isAuthConfigured()) {
    throw new NotSignedInError(
      'Sign-in is not configured in this build (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are missing).'
    );
  }
  const token = await getAccessToken();
  if (!token) throw new NotSignedInError();
  return token;
}

/** Authorization header for fetch/axios, or {} when signed out. */
export async function authHeader() {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
