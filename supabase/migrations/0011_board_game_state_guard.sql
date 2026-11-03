-- A Little Place Called Us — migration 0011: board-game state guard (Supabase mode).
--
-- Why this file exists:
--   In Supabase mode there is no trusted server. The board-game policy in
--   0004 is member-wide for ALL operations, and the app's version check
--   (boardStore.ts: update ... where version = old version) is client-side
--   only. A space member with the public Supabase URL and anon key could
--   therefore, by direct query, rewrite a board game in ways the normal
--   app never does: jump the version forward, roll it back to an old
--   state, swap the config (e.g. starting coins, board spaces), move the
--   game to another space, resurrect a finished game, or store a
--   non-object state. The API mode does not have this gap: its
--   /api/board/games/:id/action route re-runs the engine server-side and
--   increments the version itself, so a forged client state is rejected
--   there. This trigger is the database-side guard for Supabase mode.
--
-- What it does NOT do, honestly:
--   It does NOT re-implement the board engine in SQL, and it does NOT
--   prove that a state with the correct next version was produced by a
--   legal move. A member can still submit one forged step with
--   version = old + 1, config unchanged, and an object state, and this
--   trigger will allow it — exactly as before, but now only one step at
--   a time, with no version jump, no config swap, and no resurrection.
--   Full engine validation in Supabase mode would require a trusted
--   server or a PL/pgSQL re-implementation of boardGame.ts, which is a
--   larger change and is NOT attempted here. Board scores in Supabase
--   mode therefore remain not tamper-proof, and must not be presented
--   as such. That residual is documented, not hidden.
--
-- What it does enforce, and why each rule is safe for the normal paths:
--   INSERT: version must be 0, state and config must be JSONB objects.
--     Both the Supabase client (boardStore.ts) and the API server create
--     games at version 0 with object config/state, so this changes no
--     legitimate creation.
--   UPDATE: version must advance by exactly 1 (no stay, no decrease,
--     no jump); space_id, config, and created_at must be unchanged;
--     state must remain a JSONB object; a finished game must not be
--     updated at all (finished is terminal; the active -> finished
--     transition itself is allowed).
--     The Supabase client update sends state, version = old + 1, status,
--     and updated_at only, so it passes. The API server update sets
--     version = version + 1 server-side, with config/space/created
--     unchanged, so it would also pass if this trigger were ever added
--     to the API schema — it is not added there in this file, because
--     the API already validates the engine.
--   current_turn_user_id is deliberately NOT constrained here: the
--   Supabase client does not update it on a move, while the API server
--   does, so constraining it would break one of the two normal paths.
--   DELETE is deliberately NOT blocked: board games are shared artefacts
--   (like memories), and no UI deletes them today, but blocking delete
--   would be a product change, not a security fix, and is left for a
--   future brief if abandoning a game needs a rule.
--
-- Apply AFTER 0010, in the same repair order. Idempotent: the function
--   is CREATE OR REPLACE and the trigger is DROP IF EXISTS + CREATE.
--   No tables, columns, policies, grants, or rows are changed by this
--   file. No data is deleted, truncated, or rewritten. No UI change.

create or replace function public.enforce_board_game_state()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (TG_OP = 'INSERT') then
    if NEW.version <> 0 then
      raise exception 'Board games must start at version 0.';
    end if;
    if jsonb_typeof(NEW.state) <> 'object' then
      raise exception 'Board game state must be a JSON object.';
    end if;
    if jsonb_typeof(NEW.config) <> 'object' then
      raise exception 'Board game config must be a JSON object.';
    end if;
    return NEW;
  end if;
  -- UPDATE
  if OLD.status = 'finished' then
    raise exception 'A finished board game cannot be changed.';
  end if;
  if NEW.version <> OLD.version + 1 then
    raise exception 'Board game version must advance by exactly 1.';
  end if;
  if NEW.space_id is distinct from OLD.space_id then
    raise exception 'Board game space cannot be changed.';
  end if;
  if NEW.config is distinct from OLD.config then
    raise exception 'Board game config cannot be changed after creation.';
  end if;
  if NEW.created_at is distinct from OLD.created_at then
    raise exception 'Board game creation time cannot be changed.';
  end if;
  if jsonb_typeof(NEW.state) <> 'object' then
    raise exception 'Board game state must be a JSON object.';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_board_game_state_guard on public.board_games;
create trigger trg_board_game_state_guard
  before insert or update on public.board_games
  for each row execute function public.enforce_board_game_state();
