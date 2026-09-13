-- Minimal stand-in for Supabase's `auth` schema, for a throwaway local Postgres.
--
-- The v3 migration's RLS policies call auth.uid() and auth.role(). Those are
-- provided by Supabase's GoTrue, not by Postgres, so on a plain instance the
-- migration fails at CREATE POLICY — the function has to resolve at policy
-- creation time, before any row is ever read.
--
-- These read the same session GUCs Supabase uses, so a test can impersonate a
-- user with:
--
--     SET request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';
--
-- and get exactly the behaviour production RLS would give it.
--
-- ⚠️ TEST FIXTURE ONLY. Never apply this to the Supabase project — it would
-- shadow the real auth schema. It exists so `pytest` can build a schema that
-- matches production without needing Supabase running.

CREATE SCHEMA IF NOT EXISTS auth;

-- The signed-in user's id, or NULL when there are no claims on the session.
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(
    current_setting('request.jwt.claims', true)::json ->> 'sub',
    ''
  )::uuid;
$$;

-- The signed-in user's role. Defaults to 'anon', matching Supabase, so a
-- session that has set no claims is treated as signed out rather than
-- accidentally authenticated.
CREATE OR REPLACE FUNCTION auth.role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claims', true)::json ->> 'role', ''),
    'anon'
  );
$$;
