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

-- ---------- Phase 3 additions (2026-11-01) ----------
-- Profiles (plain PostgreSQL): the users table IS the profile — id, email,
-- display_name, avatar_path, created_at. No separate profiles table, so a
-- display name can never drift between two tables.
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_path TEXT;

-- Invitations: expiring, single-use codes, separate from the space's permanent
-- invite_code. The permanent code still works for pairing; an invitation code
-- is the safer share (7 days, one redemption, then useless).
CREATE TABLE IF NOT EXISTS invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE CHECK (code ~ '^[A-Z2-9]{6}$'),
  created_by UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  invited_email TEXT,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  redeemed_by UUID REFERENCES users (id) ON DELETE SET NULL,
  redeemed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invitations_code ON invitations (code);
CREATE INDEX IF NOT EXISTS idx_invitations_space ON invitations (space_id);

-- Shared messages: a dedicated table for future shared messaging. Phase 3
-- designs it; no UI writes to it yet, and the API exposes no collection for
-- it, so there is no unauthorized-access path through it today. Reminders
-- and appreciations remain the notes the app actually uses.
CREATE TABLE IF NOT EXISTS shared_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  author_name TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  is_favorite BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_messages_space ON shared_messages (space_id, created_at DESC);

-- Game sessions and saved progress (schema for the later games phase; no
-- game UI or API collection in Phase 3). Progress is per user, per game, so
-- one partner's progress can never overwrite the other's.
CREATE TABLE IF NOT EXISTS game_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
  game_key TEXT NOT NULL CHECK (char_length(game_key) BETWEEN 1 AND 100),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'finished', 'abandoned')),
  started_by UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS game_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  game_key TEXT NOT NULL CHECK (char_length(game_key) BETWEEN 1 AND 100),
  score INTEGER NOT NULL DEFAULT 0 CHECK (score >= 0),
  progress JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (space_id, user_id, game_key)
);
CREATE INDEX IF NOT EXISTS idx_game_progress_space ON game_progress (space_id, game_key);

-- Custom board game: config and state live in one row per game, versioned
-- for optimistic concurrency (a later update must carry version+1; the games
-- phase will enforce that and the current-turn rule server-side). Moves are
-- kept as an audit trail, never as the only state.
CREATE TABLE IF NOT EXISTS board_games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  current_turn_user_id UUID REFERENCES users (id) ON DELETE SET NULL,
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'finished')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS board_game_moves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_game_id UUID NOT NULL REFERENCES board_games (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  move JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_board_games_space ON board_games (space_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_board_moves_game ON board_game_moves (board_game_id, created_at ASC);

-- One space per user, enforced in the database, not just the API:
-- a user who already belongs to a space cannot create or join another.
CREATE OR REPLACE FUNCTION prevent_second_space() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM space_members WHERE user_id = NEW.created_by) THEN
    RAISE EXCEPTION 'You already belong to a space.';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_one_space_per_user ON spaces;
CREATE TRIGGER trg_one_space_per_user BEFORE INSERT ON spaces
  FOR EACH ROW EXECUTE FUNCTION prevent_second_space();

CREATE OR REPLACE FUNCTION prevent_second_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM space_members WHERE user_id = NEW.user_id AND space_id <> NEW.space_id) THEN
    RAISE EXCEPTION 'You already belong to a space.';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_one_membership_per_user ON space_members;
CREATE TRIGGER trg_one_membership_per_user BEFORE INSERT ON space_members
  FOR EACH ROW EXECUTE FUNCTION prevent_second_membership();

-- ---------- Phase 4 additions (2026-11-01) ----------
-- Optional memory tags (TEXT[]), and optional target dates for future plans.
ALTER TABLE memories ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE future_plans ADD COLUMN IF NOT EXISTS target_date DATE;

-- ---------- Phase 5 additions (2026-11-01) ----------
-- Game configs: one row per game per space, JSONB so a new game only needs a
-- new game_key and a config shape — no schema change for a new game.
CREATE TABLE IF NOT EXISTS game_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
  game_key TEXT NOT NULL CHECK (char_length(game_key) BETWEEN 1 AND 100),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by UUID REFERENCES users (id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (space_id, game_key)
);
-- Guess rounds: the answer lives here, but the API never returns it to the
-- guesser until the round is revealed (see server/index.js masking). The
-- revealed flag + guessed_by + correct are set exactly once, by the guess
-- endpoint, which refuses a second guess and a guess by the creator.
CREATE TABLE IF NOT EXISTS game_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
  creator_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  question TEXT NOT NULL CHECK (char_length(question) BETWEEN 1 AND 1000),
  answer TEXT NOT NULL CHECK (char_length(answer) BETWEEN 1 AND 1000),
  guess TEXT,
  guessed_by UUID REFERENCES users (id) ON DELETE SET NULL,
  correct BOOLEAN,
  revealed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_game_configs_space ON game_configs (space_id);
CREATE INDEX IF NOT EXISTS idx_game_rounds_space ON game_rounds (space_id, created_at DESC);
-- game_progress in Phase 3 has score only; Phase 5 records moves/time too so
-- Memory Match and Catch the Hearts can be scored honestly.
ALTER TABLE game_progress ADD COLUMN IF NOT EXISTS moves INTEGER CHECK (moves IS NULL OR moves >= 0);
ALTER TABLE game_progress ADD COLUMN IF NOT EXISTS time_ms INTEGER CHECK (time_ms IS NULL OR time_ms >= 0);
