/**
 * Supabase session: sign-up, sign-in, sign-out, and the bearer token.
 *
 * The backend requires `Authorization: Bearer <supabase access token>` on every
 * /api route except /api/health. This module is the one place that produces
 * that token, and now also the one place that creates a session in the first
 * place.
 *
 * Session persistence is the Supabase client's own: `persistSession` writes to
 * localStorage under a project-scoped key, and `autoRefreshToken` renews the
 * access token in the background before it expires. A reload therefore lands
 * straight back in the app with no second sign-in.
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

// ==================== SESSION LIFECYCLE ====================

/** The current session, or null. Read once at boot to decide the first screen. */
export async function getSession() {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data?.session ?? null;
}

/**
 * Subscribe to sign-in / sign-out / token-refresh.
 * Returns an unsubscribe function.
 */
export function onAuthChange(callback) {
  const supabase = getSupabase();
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session ?? null);
  });
  return () => data?.subscription?.unsubscribe?.();
}

/**
 * Force a token refresh. Called by the API client after a 401, on the theory
 * that the access token expired while a long pose extraction was running.
 * Returns the new access token, or null when the refresh token is dead too.
 */
export async function refreshSession() {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.refreshSession();
  if (error) return null;
  return data?.session?.access_token ?? null;
}

/**
 * Errors from Supabase auth are terse and occasionally cryptic. Translate the
 * ones a labeler will actually hit into something actionable.
 */
function readableAuthError(error, fallback) {
  const message = error?.message || fallback;
  const lower = message.toLowerCase();

  if (lower.includes('invalid login credentials')) {
    return 'That email and password combination was not recognised. Check both, or sign up if you have not yet.';
  }
  if (lower.includes('email not confirmed')) {
    return 'This account still needs its email confirmed. Check your inbox for the confirmation link.';
  }
  if (lower.includes('user already registered') || lower.includes('already been registered')) {
    return 'An account with this email already exists — switch to Sign in.';
  }
  if (lower.includes('password should be at least')) {
    return 'Password is too short. Use at least 6 characters.';
  }
  if (lower.includes('unable to validate email') || lower.includes('invalid email')) {
    return 'That does not look like a valid email address.';
  }
  if (lower.includes('rate limit') || lower.includes('too many')) {
    return 'Too many attempts just now. Wait a minute and try again.';
  }
  return message;
}

/**
 * Create an account.
 *
 * Returns `{ session, needsConfirmation }`. When the project has email
 * confirmation switched on, Supabase returns a user with no session — the
 * caller must say so rather than silently appearing to do nothing.
 */
export async function signUp(email, password) {
  const supabase = getSupabase();
  if (!supabase) throw new NotSignedInError('Sign-in is not configured in this build.');

  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) throw new Error(readableAuthError(error, 'Could not create the account.'));
  return {
    session: data?.session ?? null,
    needsConfirmation: Boolean(data?.user && !data?.session),
  };
}

/** Sign in with an existing account. Returns the session. */
export async function signIn(email, password) {
  const supabase = getSupabase();
  if (!supabase) throw new NotSignedInError('Sign-in is not configured in this build.');

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(readableAuthError(error, 'Could not sign in.'));
  return data?.session ?? null;
}

/** Sign out and drop the persisted session. */
export async function signOut() {
  const supabase = getSupabase();
  if (!supabase) return;
  await supabase.auth.signOut();
}
