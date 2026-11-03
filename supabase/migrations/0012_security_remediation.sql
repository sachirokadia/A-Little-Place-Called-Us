-- A Little Place Called Us — migration 0012: security remediation (Supabase mode).
--
-- LOCAL ONLY. NOT applied to the live Supabase project. Apply after 0011,
-- in order, to a disposable database for testing — never to production
-- without the backup gate and explicit approval in
-- supabase/REPAIR-ORDER-AND-VALIDATION.md. Idempotent: every function is
-- CREATE OR REPLACE, every trigger/policy is DROP IF EXISTS + CREATE,
-- constraints are added only IF NOT EXISTS (via a DO block).
--
-- What this file fixes (each item was a genuine gap found by code review
-- in the 2026-11-03 security remediation phase, after Phase 9 + Phase 10):
--
--  1. game_sessions hijack (same bug class 0008 fixed for shared_messages).
--     0004's single FOR ALL policy used membership-only on the old row,
--     so a partner could UPDATE another member's session and reassign
--     started_by to themselves in the same statement, and DELETE any
--     member's session (DELETE evaluates only USING). Sessions are now
--     append-only history: SELECT member-wide, INSERT starter-only, and
--     NO update/delete policy at all. The app only inserts sessions
--     (games.ts saveGameProgress, best-effort), so no legitimate path
--     changes. A member can still fabricate finished sessions for
--     THEMSELVES — only a trusted server can prove a game was played;
--     that residual is unchanged and documented, not hidden.
--
--  2. Shared-table authorship reassignment. 0001's member-wide UPDATE
--     policy on reminders/memories/appreciations/future_plans/
--     voice_notes (and the author-only policies on letters/journals)
--     never constrained author_id/space_id/created_at, and the client
--     supabaseUpdate sends a full row including those fields. A member
--     calling PostgREST directly could therefore rewrite author_id on
--     a shared item (claiming authorship). RLS cannot restrict columns,
--     so a BEFORE UPDATE trigger now freezes author_id, space_id and
--     created_at on all seven content tables. Shared editing of
--     content fields is untouched: legitimate updates always resend
--     the same three values (store.ts toRow), so they pass.
--
--  3. game_configs attribution spoofing. The 0006 member-wide policy
--     let any member write any updated_by value. INSERT/UPDATE now
--     require updated_by = auth.uid() (the client always writes the
--     viewer's own id, games.ts saveGameConfig). SELECT and DELETE
--     stay member-wide by design: configs are shared, and deleting a
--     config is functionally identical to resetting it to defaults
--     (loadGameData falls back to DEFAULT_CONFIGS), so removing
--     DELETE would gain nothing.
--
--  4. game_progress score caps (Supabase mode). 0004 enforced only
--     score >= 0, so a member could upsert an unbounded own score.
--     A trigger now caps quiz/memory/chest/hero scores at the live
--     config's denominator, falling back to the client's defaults
--     when no config row exists (quiz 3 questions, memory 6 pairs,
--     chest 2 riddles, hero 3 missions — games.ts DEFAULT_CONFIGS),
--     exactly mirroring the API server's quiz/memory bounds. 'catch'
--     and unknown game_keys stay uncapped: no derivable cap exists
--     for a 30-second tap count, and inventing one would break play.
--     progress must also be a JSON object (it was any JSONB). A
--     best-score-only rule was NOT added: replays that score lower
--     currently overwrite, and changing that is a product decision.
--
--  5. Board-state shape + coherence (extends 0011, same trigger).
--     0011 blocked version jumps, config/space swaps and resurrection
--     but checked nothing inside state. The trigger now also requires
--     the exact shape the engine in src/lib/boardGame.ts produces:
--     2 players with integer coins >= 0, positions inside the frozen
--     config's board, skipTurns 0..2, bankrupt players holding 0 coins
--     and no properties; phase in (roll, decide, trade, gameover);
--     dice null or two dice 1..6; pendingSpaceId only in decide phase
--     naming a real place; pendingTrade only in trade phase naming a
--     property owned by its sender; owners keys only real places with
--     values 0/1; status 'finished' exactly when phase is 'gameover';
--     gameover states either a draw with no winner or a non-bankrupt
--     winner; turn advancing by 0 or 1 per step; card indices
--     advancing by 0 or 1; player names/tokens unchanged mid-game;
--     the non-acting player's position/skipTurns unchanged; and at
--     most one ownership change per step unless a player newly goes
--     bankrupt (which releases all of their properties at once).
--     INSERT must additionally match createBoardGame() output exactly
--     (starting coins, position 0, phase 'roll', empty owners, and a
--     config with >= 8 spaces including a start space, positive
--     startCoins and non-negative passStartBonus), closing rigged
--     new games and latest-game shadowing at birth. Config-dependent
--     checks are skipped, not failed, when a pre-0012 game's config
--     lacks a spaces array, so legacy games are not bricked.
--     DELIBERATELY NOT ADDED: per-step coin delta caps. A roll step
--     can legally gain 2x passStartBonus plus a card/rent effect, a
--     trade step can legally transfer any agreed price, and no finite
--     total-coins bound is sound for a long game — so any delta cap
--     would either false-positive on legal play or be defeated by N
--     sequential versioned writes anyway. See the residual note below.
--
--  6. Two-member / one-space race. The cap checks in
--     enforce_two_members, prevent_second_space and
--     prevent_second_membership were COUNT/EXISTS queries with no
--     lock, so two concurrent inserts could both observe count < 2.
--     Each function now takes a transaction-scoped advisory lock
--     (pg_advisory_xact_lock) on the space id (cap) or the user id
--     (one-space rule) before checking, serialising concurrent joins
--     for the same space/user. Logic is otherwise unchanged.
--
-- What this file does NOT close (documented residuals, not fixes):
--  * A single forged board step with the correct next version, a
--    coherent shape and bounded changes still passes: no shape,
--    bound or delta check can distinguish "coins gained by a legal
--    card" from "coins typed in by the attacker" — that distinction
--    IS the engine. Full closure needs a trusted side that re-runs
--    the engine (the API route already does this) and direct
--    board_games writes revoked in Supabase-only deployments.
--  * Storage content spoofing (HTML inside photo.png via direct
--    Storage API calls): policies cannot decode content. Mitigated
--    in this phase at the client layer (explicit extension-derived
--    contentType on upload, see store.ts) plus <img>/<audio>-only
--    rendering; a trusted upload check (Edge Function) is still
--    the only complete closure.
--  * Signed URLs remain 1-hour bearer tokens, unrevocable per URL.
--  * An author can still break their own seal (edit body / move
--    reveal_at earlier) — a product decision, not a cross-user leak,
--    so no trigger was added for it here.
--  * Direct Storage uploads have no size cap in policy (client and
--    API server enforce 25 MB; the policy layer cannot see size).
--
-- No tables, columns (other than the one CHECK constraint on
-- game_progress.progress), policies on other tables, grants, or rows
-- are changed by this file. No data is deleted, truncated, or
-- rewritten. No UI change except the voice-note sharing label and
-- the purge/upload changes in store.ts (see the phase report).

-- ---------- 1. game_sessions: append-only ----------
drop policy if exists "game sessions members" on public.game_sessions;
create policy "game sessions readable by members" on public.game_sessions
  for select using (public.is_space_member(space_id));
create policy "game sessions insert by starter" on public.game_sessions
  for insert with check (public.is_space_member(space_id) and auth.uid() = started_by);
-- No UPDATE or DELETE policy: sessions are append-only history.

-- ---------- 2. identity freeze on content tables ----------
create or replace function public.forbid_identity_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if NEW.author_id is distinct from OLD.author_id
     or NEW.space_id is distinct from OLD.space_id
     or NEW.created_at is distinct from OLD.created_at then
    raise exception 'author, space and creation time cannot be changed.';
  end if;
  return NEW;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['reminders', 'memories', 'appreciations', 'future_plans', 'voice_notes', 'journal_entries', 'letters'] loop
    execute format('drop trigger if exists trg_no_identity_change on public.%I', t);
    execute format('create trigger trg_no_identity_change before update on public.%I for each row execute function public.forbid_identity_change()', t);
  end loop;
end $$;

-- ---------- 3. game_configs: attribution ----------
drop policy if exists "game configs members" on public.game_configs;
create policy "game configs readable by members" on public.game_configs
  for select using (public.is_space_member(space_id));
create policy "game configs insert by author" on public.game_configs
  for insert with check (public.is_space_member(space_id) and auth.uid() = updated_by);
create policy "game configs update by author" on public.game_configs
  for update using (public.is_space_member(space_id))
  with check (public.is_space_member(space_id) and auth.uid() = updated_by);
create policy "game configs delete by members" on public.game_configs
  for delete using (public.is_space_member(space_id));

-- ---------- 4. game_progress: object + score caps ----------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_game_progress_object') then
    alter table public.game_progress
      add constraint chk_game_progress_object check (jsonb_typeof(progress) = 'object');
  end if;
end $$;

create or replace function public.enforce_game_progress_caps()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_cap int;
  v_pairs int;
  v_cfg jsonb;
begin
  if NEW.score < 0 then
    raise exception 'Game score cannot be negative.';
  end if;
  select config into v_cfg from public.game_configs
    where space_id = NEW.space_id and game_key = NEW.game_key;
  if NEW.game_key = 'quiz' then
    v_cap := coalesce(jsonb_array_length(v_cfg -> 'questions'), 3);
    if NEW.score > v_cap then
      raise exception 'Quiz score cannot exceed the number of questions.';
    end if;
  elsif NEW.game_key = 'memory' then
    if v_cfg is not null and jsonb_typeof(v_cfg -> 'pairs') = 'number' then
      v_pairs := (v_cfg ->> 'pairs')::int;
    else
      v_pairs := 6;
    end if;
    if NEW.score > v_pairs then
      raise exception 'Memory score cannot exceed the number of pairs.';
    end if;
    if NEW.moves is not null and NEW.moves < v_pairs then
      raise exception 'Memory moves cannot be fewer than the number of pairs.';
    end if;
  elsif NEW.game_key = 'chest' then
    v_cap := coalesce(jsonb_array_length(v_cfg -> 'riddles'), 2);
    if NEW.score > v_cap then
      raise exception 'Chest score cannot exceed the number of riddles.';
    end if;
  elsif NEW.game_key = 'hero' then
    v_cap := coalesce(jsonb_array_length(v_cfg -> 'missions'), 3);
    if NEW.score > v_cap then
      raise exception 'Hero score cannot exceed the number of missions.';
    end if;
  end if;
  -- 'catch' and unknown game_keys: no derivable cap; left uncapped.
  return NEW;
end;
$$;

drop trigger if exists trg_game_progress_caps on public.game_progress;
create trigger trg_game_progress_caps
  before insert or update on public.game_progress
  for each row execute function public.enforce_game_progress_caps();

-- ---------- 5. board state: shape + coherence (extends 0011) ----------
create or replace function public.enforce_board_game_state()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_state jsonb;
  v_config jsonb;
  v_spaces jsonb;
  v_nspaces int;
  v_players jsonb;
  v_owners jsonb;
  v_old_owners jsonb;
  v_phase text;
  v_i int;
  v_p jsonb;
  v_key text;
  v_diff int;
  v_newly_bankrupt boolean := false;
  v_place_ids text[];
  v_is_place boolean;
begin
  v_state := NEW.state;
  v_config := NEW.config;

  -- --- shared checks (INSERT and UPDATE) ---
  if jsonb_typeof(v_state) <> 'object' then
    raise exception 'Board game state must be a JSON object.';
  end if;
  if jsonb_typeof(v_config) <> 'object' then
    raise exception 'Board game config must be a JSON object.';
  end if;
  v_spaces := v_config -> 'spaces';
  if jsonb_typeof(v_spaces) = 'array' then
    v_nspaces := jsonb_array_length(v_spaces);
    select array_agg(s ->> 'id') into v_place_ids
      from jsonb_array_elements(v_spaces) s where s ->> 'kind' = 'place';
  else
    v_nspaces := null;
    v_place_ids := array[]::text[];
  end if;

  -- players: exactly 2, with engine-shaped fields
  v_players := v_state -> 'players';
  if jsonb_typeof(v_players) <> 'array' or jsonb_array_length(v_players) <> 2 then
    raise exception 'Board game must have exactly two players.';
  end if;
  for v_i in 0..1 loop
    v_p := v_players -> v_i;
    if jsonb_typeof(v_p) <> 'object'
       or jsonb_typeof(v_p -> 'name') <> 'string'
       or jsonb_typeof(v_p -> 'token') <> 'string'
       or jsonb_typeof(v_p -> 'coins') <> 'number'
       or (v_p ->> 'coins') !~ '^-?[0-9]+$'
       or (v_p ->> 'coins')::int < 0
       or jsonb_typeof(v_p -> 'position') <> 'number'
       or (v_p ->> 'position') !~ '^-?[0-9]+$'
       or (v_nspaces is not null and ((v_p ->> 'position')::int < 0 or (v_p ->> 'position')::int >= v_nspaces))
       or jsonb_typeof(v_p -> 'skipTurns') <> 'number'
       or (v_p ->> 'skipTurns') !~ '^-?[0-9]+$'
       or (v_p ->> 'skipTurns')::int < 0 or (v_p ->> 'skipTurns')::int > 2
       or jsonb_typeof(v_p -> 'bankrupt') <> 'boolean' then
      raise exception 'Board player % is not engine-shaped.', v_i;
    end if;
    if (v_p ->> 'bankrupt')::boolean and (v_p ->> 'coins')::int <> 0 then
      raise exception 'A bankrupt player must hold 0 coins.';
    end if;
  end loop;

  -- scalar state fields
  v_phase := v_state ->> 'phase';
  if v_phase not in ('roll', 'decide', 'trade', 'gameover') then
    raise exception 'Board phase is not valid.';
  end if;
  if jsonb_typeof(v_state -> 'current') <> 'number'
     or (v_state ->> 'current') !~ '^[01]$'
     or jsonb_typeof(v_state -> 'turn') <> 'number'
     or (v_state ->> 'turn') !~ '^[0-9]+$'
     or jsonb_typeof(v_state -> 'plotIndex') <> 'number'
     or (v_state ->> 'plotIndex') !~ '^[0-9]+$'
     or jsonb_typeof(v_state -> 'surpriseIndex') <> 'number'
     or (v_state ->> 'surpriseIndex') !~ '^[0-9]+$'
     or jsonb_typeof(v_state -> 'log') <> 'array'
     or jsonb_typeof(v_state -> 'draw') <> 'boolean'
     or not (jsonb_typeof(v_state -> 'winner') = 'null'
             or (jsonb_typeof(v_state -> 'winner') = 'number' and (v_state ->> 'winner') ~ '^[01]$'))
     or not (jsonb_typeof(v_state -> 'dice') = 'null'
             or (jsonb_typeof(v_state -> 'dice') = 'array'
                 and jsonb_array_length(v_state -> 'dice') = 2
                 and (v_state -> 'dice' ->> 0) ~ '^[1-6]$'
                 and (v_state -> 'dice' ->> 1) ~ '^[1-6]$'))
     or not (jsonb_typeof(v_state -> 'lastCard') = 'null'
             or jsonb_typeof(v_state -> 'lastCard') = 'object') then
    raise exception 'Board state scalar fields are not engine-shaped.';
  end if;

  -- owners: only real places, values 0/1, bankrupt players own nothing
  v_owners := v_state -> 'owners';
  if jsonb_typeof(v_owners) <> 'object' then
    raise exception 'Board owners must be a JSON object.';
  end if;
  for v_key in select jsonb_object_keys(v_owners) loop
    if jsonb_typeof(v_owners -> v_key) <> 'number'
       or (v_owners ->> v_key) !~ '^[01]$'
       or (v_nspaces is not null and not (v_key = any (v_place_ids))) then
      raise exception 'Board owner for % is not valid.', v_key;
    end if;
    if (v_owners ->> v_key)::int = 0 and (v_players -> 0 ->> 'bankrupt')::boolean then
      raise exception 'A bankrupt player cannot own properties.';
    end if;
    if (v_owners ->> v_key)::int = 1 and (v_players -> 1 ->> 'bankrupt')::boolean then
      raise exception 'A bankrupt player cannot own properties.';
    end if;
  end loop;

  -- pending space / trade coherence
  if jsonb_typeof(v_state -> 'pendingSpaceId') = 'null' then
    null; -- fine in any phase
  elsif jsonb_typeof(v_state -> 'pendingSpaceId') = 'string' and v_phase = 'decide' then
    if v_nspaces is not null then
      select exists (
        select 1 from jsonb_array_elements(v_spaces) s
        where s ->> 'id' = (v_state ->> 'pendingSpaceId') and s ->> 'kind' = 'place'
      ) into v_is_place;
      if not v_is_place then
        raise exception 'Pending space is not a buyable place.';
      end if;
    end if;
  else
    raise exception 'Pending space is only valid in the decide phase.';
  end if;
  if jsonb_typeof(v_state -> 'pendingTrade') = 'null' then
    null;
  elsif jsonb_typeof(v_state -> 'pendingTrade') = 'object' and v_phase = 'trade' then
    if jsonb_typeof(v_state -> 'pendingTrade' -> 'propertyId') <> 'string'
       or jsonb_typeof(v_state -> 'pendingTrade' -> 'price') <> 'number'
       or (v_state -> 'pendingTrade' ->> 'price') !~ '^[0-9]+$'
       or jsonb_typeof(v_state -> 'pendingTrade' -> 'from') <> 'number'
       or (v_state -> 'pendingTrade' ->> 'from') !~ '^[01]$'
       or jsonb_typeof(v_state -> 'pendingTrade' -> 'to') <> 'number'
       or (v_state -> 'pendingTrade' ->> 'to') !~ '^[01]$'
       or (v_state -> 'pendingTrade' ->> 'from') = (v_state -> 'pendingTrade' ->> 'to')
       or (v_owners ->> (v_state -> 'pendingTrade' ->> 'propertyId')) is distinct from (v_state -> 'pendingTrade' ->> 'from') then
      raise exception 'Pending trade is not valid.';
    end if;
  else
    raise exception 'Pending trade is only valid in the trade phase.';
  end if;

  -- status / phase / winner coherence
  if (NEW.status = 'finished') <> (v_phase = 'gameover') then
    raise exception 'Board status must be finished exactly when the phase is gameover.';
  end if;
  if v_phase = 'gameover' then
    if (v_state ->> 'draw')::boolean then
      if jsonb_typeof(v_state -> 'winner') <> 'null' then
        raise exception 'A drawn game cannot have a winner.';
      end if;
    else
      if jsonb_typeof(v_state -> 'winner') <> 'number'
         or (v_players -> ((v_state ->> 'winner')::int) ->> 'bankrupt')::boolean then
        raise exception 'A finished game needs a non-bankrupt winner.';
      end if;
    end if;
  end if;

  if (TG_OP = 'INSERT') then
    -- INSERT must match createBoardGame() output exactly.
    if NEW.version <> 0 then
      raise exception 'Board games must start at version 0.';
    end if;
    if NEW.status <> 'active' then
      raise exception 'New board games start active.';
    end if;
    if jsonb_typeof(v_spaces) <> 'array' or v_nspaces < 8 then
      raise exception 'A board needs at least 8 spaces.';
    end if;
    if not exists (select 1 from jsonb_array_elements(v_spaces) s where s ->> 'kind' = 'start') then
      raise exception 'A board needs a start space.';
    end if;
    if jsonb_typeof(v_config -> 'startCoins') <> 'number'
       or (v_config ->> 'startCoins') !~ '^[0-9]+$'
       or (v_config ->> 'startCoins')::int <= 0
       or jsonb_typeof(v_config -> 'passStartBonus') <> 'number'
       or (v_config ->> 'passStartBonus') !~ '^[0-9]+$'
       or (v_config ->> 'passStartBonus')::int < 0
       or jsonb_typeof(v_config -> 'plotTwists') <> 'array'
       or jsonb_typeof(v_config -> 'surprises') <> 'array' then
      raise exception 'Board config economy fields are not valid.';
    end if;
    for v_i in 0..1 loop
      v_p := v_players -> v_i;
      if (v_p ->> 'coins')::int <> (v_config ->> 'startCoins')::int
         or (v_p ->> 'position')::int <> 0
         or (v_p ->> 'skipTurns')::int <> 0
         or (v_p ->> 'bankrupt')::boolean then
        raise exception 'New board players must start at Home Base with starting coins.';
      end if;
    end loop;
    if (v_state ->> 'current')::int <> 0
       or v_phase <> 'roll'
       or jsonb_typeof(v_state -> 'dice') <> 'null'
       or jsonb_typeof(v_state -> 'pendingSpaceId') <> 'null'
       or jsonb_typeof(v_state -> 'pendingTrade') <> 'null'
       or v_owners <> '{}'::jsonb
       or (v_state ->> 'plotIndex')::int <> 0
       or (v_state ->> 'surpriseIndex')::int <> 0
       or jsonb_typeof(v_state -> 'lastCard') <> 'null'
       or jsonb_typeof(v_state -> 'winner') <> 'null'
       or (v_state ->> 'draw')::boolean
       or (v_state ->> 'turn')::int <> 0 then
      raise exception 'New board state must match a fresh game.';
    end if;
    return NEW;
  end if;

  -- --- UPDATE-only checks (0011 rules, unchanged) ---
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
  -- monotonic step fields
  if (v_state ->> 'turn')::int not in ((OLD.state ->> 'turn')::int, (OLD.state ->> 'turn')::int + 1)
     or (v_state ->> 'plotIndex')::int < (OLD.state ->> 'plotIndex')::int
     or (v_state ->> 'plotIndex')::int > (OLD.state ->> 'plotIndex')::int + 1
     or (v_state ->> 'surpriseIndex')::int < (OLD.state ->> 'surpriseIndex')::int
     or (v_state ->> 'surpriseIndex')::int > (OLD.state ->> 'surpriseIndex')::int + 1 then
    raise exception 'Board turn and card indices must advance by at most one step.';
  end if;
  -- names/tokens never change mid-game
  for v_i in 0..1 loop
    if (v_players -> v_i ->> 'name') is distinct from (OLD.state -> 'players' -> v_i ->> 'name')
       or (v_players -> v_i ->> 'token') is distinct from (OLD.state -> 'players' -> v_i ->> 'token') then
      raise exception 'Board player names and tokens cannot change mid-game.';
    end if;
  end loop;
  -- the non-acting player (1 - OLD.current) does not move or gain/lose a skip
  v_i := 1 - (OLD.state ->> 'current')::int;
  if (v_players -> v_i ->> 'position') is distinct from (OLD.state -> 'players' -> v_i ->> 'position')
     or (v_players -> v_i ->> 'skipTurns') is distinct from (OLD.state -> 'players' -> v_i ->> 'skipTurns') then
    raise exception 'Only the acting player can move or gain a skipped turn.';
  end if;
  -- ownership changes: at most one key per step, unless a player newly bankrupts
  if ((OLD.state -> 'players' -> 0 ->> 'bankrupt')::boolean = false and (v_players -> 0 ->> 'bankrupt')::boolean)
     or ((OLD.state -> 'players' -> 1 ->> 'bankrupt')::boolean = false and (v_players -> 1 ->> 'bankrupt')::boolean) then
    v_newly_bankrupt := true;
  end if;
  if not v_newly_bankrupt then
    v_old_owners := OLD.state -> 'owners';
    select count(*) into v_diff
      from (select jsonb_object_keys as k from jsonb_object_keys(v_old_owners)
            union select jsonb_object_keys as k from jsonb_object_keys(v_owners)) s
      where (v_old_owners ->> k) is distinct from (v_owners ->> k);
    if v_diff > 1 then
      raise exception 'At most one property can change hands per step.';
    end if;
  end if;
  return NEW;
end;
$$;

-- The 0011 trigger already exists on board_games and calls this function
-- by name, so replacing the function is enough; re-create it defensively
-- so 0012 is also correct if applied to a database that skipped 0011.
drop trigger if exists trg_board_game_state_guard on public.board_games;
create trigger trg_board_game_state_guard
  before insert or update on public.board_games
  for each row execute function public.enforce_board_game_state();

-- ---------- 6. two-member / one-space race: advisory locks ----------
create or replace function public.enforce_two_members()
returns trigger language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtext('space:' || NEW.space_id::text));
  if (select count(*) from public.space_members where space_id = NEW.space_id) >= 2 then
    raise exception 'This space already has two members.';
  end if;
  return NEW;
end;
$$;

create or replace function public.prevent_second_space()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext('user:' || NEW.created_by::text));
  if exists (select 1 from public.space_members where user_id = NEW.created_by) then
    raise exception 'You already belong to a space.';
  end if;
  return NEW;
end;
$$;

create or replace function public.prevent_second_membership()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext('user:' || NEW.user_id::text));
  if exists (select 1 from public.space_members where user_id = NEW.user_id and space_id <> NEW.space_id) then
    raise exception 'You already belong to a space.';
  end if;
  return NEW;
end;
$$;
