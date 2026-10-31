-- A Little Place Called Us — plain PostgreSQL schema (no Supabase, no auth.users).
-- Run against an empty database:  psql "$DATABASE_URL" -f postgres/schema.sql
-- Or let the API server apply it on boot (it reads this file and runs it idempotently).
-- Design, same as the Supabase migration, adapted for a server-enforced API:
--  * A space has AT MOST TWO members (trigger). The API also checks membership on every request.
--  * Private journals: the API only ever queries them with author_id = viewer. They are never
--    returned by a shared query, in any code path.
--  * Private drafts: same author-only rule in the API.
--  * Scheduled letters: the API masks `body` to NULL for non-authors until reveal_at.
--    The raw table is never exposed to a client.
--  * Deletion is soft (deleted_at). Permanent delete is a separate API call, and the API
--    refuses it unless the row is already soft-deleted.
--  * Media files are NOT in the database: they live on the API server's disk under
--    server/uploads/<space_id>/... and are served only through the authenticated
--    /api/media route (membership checked from the first path segment, short-lived token).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS spaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  invite_code TEXT NOT NULL UNIQUE CHECK (invite_code ~ '^[A-Z2-9]{6}$'),
  created_by UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS space_members (
  space_id UUID NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (space_id, user_id)
);

CREATE OR REPLACE FUNCTION enforce_two_members() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT count(*) FROM space_members WHERE space_id = NEW.space_id) >= 2 THEN
    RAISE EXCEPTION 'This space already has two members.';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_two_members ON space_members;
CREATE TRIGGER trg_two_members BEFORE INSERT ON space_members
  FOR EACH ROW EXECUTE FUNCTION enforce_two_members();

CREATE TABLE IF NOT EXISTS reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  author_name TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL CHECK (char_length(text) BETWEEN 1 AND 2000),
  kind TEXT NOT NULL DEFAULT 'note' CHECK (kind IN ('note', 'prompt')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  is_favorite BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  author_name TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  caption TEXT NOT NULL DEFAULT '' CHECK (char_length(caption) <= 2000),
  story TEXT NOT NULL DEFAULT '' CHECK (char_length(story) <= 5000),
  happened_on DATE NOT NULL,
  media_path TEXT,
  media_type TEXT NOT NULL DEFAULT 'none' CHECK (media_type IN ('photo', 'none')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  is_favorite BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS letters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  author_name TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 20000),
  visibility TEXT NOT NULL DEFAULT 'shared' CHECK (visibility IN ('shared', 'private_draft', 'scheduled')),
  reveal_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  is_favorite BOOLEAN NOT NULL DEFAULT false,
  CHECK (visibility <> 'scheduled' OR reveal_at IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  author_name TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 20000),
  mood TEXT NOT NULL DEFAULT 'calm',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  is_favorite BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS appreciations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  author_name TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL CHECK (char_length(text) BETWEEN 1 AND 2000),
  kind TEXT NOT NULL DEFAULT 'appreciation' CHECK (kind IN ('appreciation', 'achievement', 'encouragement')),
  for_name TEXT NOT NULL DEFAULT 'Partner',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  is_favorite BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS future_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  author_name TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  detail TEXT NOT NULL DEFAULT '' CHECK (char_length(detail) <= 2000),
  category TEXT NOT NULL DEFAULT 'plan' CHECK (category IN ('bucket', 'date', 'plan')),
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'done')),
  completed_at TIMESTAMPTZ,
  completion_photo_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  is_favorite BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS voice_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  author_name TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  duration_sec INTEGER,
  media_path TEXT,
  room TEXT NOT NULL DEFAULT 'quiet' CHECK (room IN ('quiet', 'letters', 'memories')),
  linked_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  is_favorite BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_reminders_space ON reminders (space_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_space_happened ON memories (space_id, happened_on DESC);
CREATE INDEX IF NOT EXISTS idx_letters_space ON letters (space_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_journals_author ON journal_entries (author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_appreciations_space ON appreciations (space_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_plans_space_status ON future_plans (space_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_voice_space ON voice_notes (space_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_members_user ON space_members (user_id);
