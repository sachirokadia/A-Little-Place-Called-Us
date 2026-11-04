-- A Little Place Called Us — regression tests (DISPOSABLE DATABASE ONLY).
--
-- NEVER run this file against the real Supabase project. It creates test
-- users, a test space, and test letters/journals/games with fixed UUIDs,
-- and it deletes and re-creates those test rows on every run. In a real
-- project that would be data loss. Run it only after applying migrations
-- 0001, then 0003–0011 in order, to a fresh local or disposable database.
--
-- How to run (local Postgres, as the database owner):
--   1. Create a disposable database.
--   2. Create the mock auth/storage schemas below IF they do not already
--      exist (in real Supabase, auth.users, auth.uid(), storage.buckets
--      and storage.objects already exist — do NOT create mocks there).
--   3. Apply migrations 0001, 0003, 0004, 0005, 0006, 0007, 0008, 0009,
--      0010, 0011, 0012, in that order, with ON_ERROR_STOP (0002 is
--      superseded by 0004 and is never applied separately).
--   4. psql -f supabase/regression-tests.sql
--   5. Read the output: every check prints PASS or FAIL. Any FAIL is a
--      regression — do not ship, do not apply migrations to production,
--      until it is understood. A PASS here does NOT prove the live
--      Supabase project is fixed; it proves the migration set, applied
--      in order, behaves as intended on a disposable copy.
--
-- What is covered, and what is deliberately NOT claimed:
--   Covered: partner vs author letters (shared / private draft / sealed),
--   journals, appreciations, direct raw body/answer reads, outsider
--   access, other-user game progress, game-round guessing, board-game
--   version/config/space/finished guards, board shape/coherence
--   guards (0012), game-session append-only policy (0012),
--   shared-table identity freeze (0012), game-progress score caps
--   (0012), game-config attribution (0012), storage kind/extension/
--   membership/owner rules, and scheduled-letter delivery manipulation
--   by a non-author (reveal_at / visibility change attempts).
--   NOT covered by this file, and still a documented residual: a
--   single forged board step with version = old + 1, config unchanged,
--   and a COHERENT engine-shaped state still passes the 0011+0012
--   trigger (full engine validation exists only in API mode);
--   a direct Storage API upload of a correctly-named file with
--   spoofed content passes the extension policy (content cannot be
--   proved by a policy); a member's own 'catch' score is uncapped
--   (no derivable cap); and the two-member advisory lock is not
--   concurrency-tested here (single-session script). Those are
--   reported as residuals, not as passes, and no test here claims
--   otherwise. The 0012 purge-file-delete and upload contentType
--   changes are app-layer and are verified by typecheck/build, not
--   by this SQL file.

-- ---------- mock auth/storage (disposable DB only) ----------
create schema if not exists auth;
create schema if not exists storage;
create table if not exists auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $$
  select current_setting('app.current_user', true)::uuid
$$;
create table if not exists storage.buckets (id text primary key, name text, public boolean not null default false);
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
end $$;
grant usage on schema public, auth, storage to authenticated, anon;
-- Deliberately NO blanket "grant on all tables in schema public" here.
-- Migration 0008 already granted table access, and migration 0009 then
-- revoked table-level SELECT on letters/game_rounds and re-granted only
-- non-sensitive columns. Re-granting all tables after 0009 would undo
-- that column protection (the same way re-running 0008 after 0009
-- does), and would make the direct body/answer tests pass incorrectly.
-- Only storage.objects needs an explicit grant in this mock, because
-- no migration grants it (in real Supabase, Storage grants it by default).
grant select, insert, delete on storage.objects to authenticated;

-- ---------- test seed (owner; test rows only, fixed UUIDs) ----------
delete from public.board_game_moves where board_game_id in ('bbbbbbbb-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000003');
delete from public.board_games where id in ('bbbbbbbb-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000003');
delete from public.game_rounds where space_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
delete from public.game_progress where space_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
delete from public.letters where space_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
delete from public.journal_entries where space_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
delete from public.appreciations where space_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
delete from public.memories where space_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
delete from public.space_members where space_id in ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','cccccccc-cccc-cccc-cccc-cccccccccccc');
delete from public.spaces where id in ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','cccccccc-cccc-cccc-cccc-cccccccccccc');
delete from storage.objects where name like 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/%' or name like 'cccccccc-cccc-cccc-cccc-cccccccccccc/%';
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','a@test.local'),
  ('22222222-2222-2222-2222-222222222222','b@test.local'),
  ('33333333-3333-3333-3333-333333333333','c@test.local')
on conflict (id) do nothing;
insert into public.spaces (id, name, invite_code, created_by) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Test Space','ABCDEF','11111111-1111-1111-1111-111111111111'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc','Other Space','GHIJKL','33333333-3333-3333-3333-333333333333')
on conflict (id) do nothing;
insert into public.space_members (space_id, user_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','owner'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','22222222-2222-2222-2222-222222222222','member')
on conflict do nothing;
insert into public.letters (space_id, author_id, author_name, title, body, visibility, reveal_at) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','A','Shared letter','SHARED-BODY','shared',null),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','A','Private draft','DRAFT-BODY','private_draft',null),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','A','Sealed letter','SEALED-BODY','scheduled', now() + interval '30 days');
insert into public.journal_entries (space_id, author_id, author_name, title, body) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','A','A journal','JOURNAL-BODY');
insert into public.appreciations (space_id, author_id, author_name, text, kind, for_name) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','A','A note for B','appreciation','Partner');
insert into public.memories (space_id, author_id, author_name, title, caption, story, happened_on, tags) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','A','Test memory','cap','story','2026-01-01', array['trip']);
insert into public.game_progress (space_id, user_id, game_key, score) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','memory',6);
insert into public.game_sessions (space_id, game_key, status, started_by) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','memory','finished','11111111-1111-1111-1111-111111111111');
insert into public.game_rounds (space_id, creator_id, question, answer, revealed) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','What is A favourite colour?','blue',false);
-- Board seeds must be full engine-shaped states after 0012 (INSERT
-- shape). Config: 8 spaces incl. a start space, startCoins 1000.
insert into public.board_games (id, space_id, config, state, version, status) values
  ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '{"startCoins":1000,"passStartBonus":200,"plotTwists":[],"surprises":[],"spaces":[{"id":"s0","kind":"start"},{"id":"s1","kind":"place"},{"id":"s2","kind":"place"},{"id":"s3","kind":"plot"},{"id":"s4","kind":"tax"},{"id":"s5","kind":"place"},{"id":"s6","kind":"surprise"},{"id":"s7","kind":"rest"}]}',
   '{"players":[{"name":"A","token":"red","coins":1000,"position":0,"skipTurns":0,"bankrupt":false},{"name":"B","token":"blue","coins":1000,"position":0,"skipTurns":0,"bankrupt":false}],"current":0,"phase":"roll","dice":null,"pendingSpaceId":null,"pendingTrade":null,"owners":{},"log":["start"],"plotIndex":0,"surpriseIndex":0,"lastCard":null,"winner":null,"draw":false,"turn":0}',0,'active'),
  ('bbbbbbbb-0000-0000-0000-000000000002','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '{"startCoins":1000,"passStartBonus":200,"plotTwists":[],"surprises":[],"spaces":[{"id":"s0","kind":"start"},{"id":"s1","kind":"place"},{"id":"s2","kind":"place"},{"id":"s3","kind":"plot"},{"id":"s4","kind":"tax"},{"id":"s5","kind":"place"},{"id":"s6","kind":"surprise"},{"id":"s7","kind":"rest"}]}',
   '{"players":[{"name":"A","token":"red","coins":1000,"position":0,"skipTurns":0,"bankrupt":false},{"name":"B","token":"blue","coins":1000,"position":0,"skipTurns":0,"bankrupt":false}],"current":0,"phase":"roll","dice":null,"pendingSpaceId":null,"pendingTrade":null,"owners":{},"log":["start"],"plotIndex":0,"surpriseIndex":0,"lastCard":null,"winner":null,"draw":false,"turn":0}',0,'active'),
  ('bbbbbbbb-0000-0000-0000-000000000003','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '{"startCoins":1000,"passStartBonus":200,"plotTwists":[],"surprises":[],"spaces":[{"id":"s0","kind":"start"},{"id":"s1","kind":"place"},{"id":"s2","kind":"place"},{"id":"s3","kind":"plot"},{"id":"s4","kind":"tax"},{"id":"s5","kind":"place"},{"id":"s6","kind":"surprise"},{"id":"s7","kind":"rest"}]}',
   '{"players":[{"name":"A","token":"red","coins":1000,"position":0,"skipTurns":0,"bankrupt":false},{"name":"B","token":"blue","coins":1000,"position":0,"skipTurns":0,"bankrupt":false}],"current":0,"phase":"roll","dice":null,"pendingSpaceId":null,"pendingTrade":null,"owners":{},"log":["start"],"plotIndex":0,"surpriseIndex":0,"lastCard":null,"winner":null,"draw":false,"turn":0}',0,'active');
insert into storage.objects (bucket_id, name, owner) values
  ('private-media','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/photo/a-photo.png','11111111-1111-1111-1111-111111111111');

-- ---------- checks as partner B ----------
set role authenticated;
select set_config('app.current_user', '22222222-2222-2222-2222-222222222222', false);
do $$ declare v_count int; v_body text; begin
  select count(*) into v_count from public.letters_visible where space_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  if v_count = 2 then raise notice 'PASS: B view letters = 2 (shared + sealed, no private draft)'; else raise notice 'FAIL: B view letters = % (expected 2)', v_count; end if;
  select body into v_body from public.letters_visible where space_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and visibility = 'scheduled';
  if v_body is null then raise notice 'PASS: B sealed body is NULL in view'; else raise notice 'FAIL: B sealed body visible in view'; end if;
  select body into v_body from public.letters_visible where space_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and visibility = 'shared';
  if v_body = 'SHARED-BODY' then raise notice 'PASS: B shared body visible'; else raise notice 'FAIL: B shared body missing'; end if;
  select count(*) into v_count from public.journal_entries where space_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  if v_count = 0 then raise notice 'PASS: B journals = 0'; else raise notice 'FAIL: B journals = % (expected 0)', v_count; end if;
end $$;
do $$ declare v_rows int; begin
  update public.letters set title = 'HACKED' where author_id = '11111111-1111-1111-1111-111111111111' and visibility = 'shared';
  get diagnostics v_rows = row_count;
  if v_rows = 0 then raise notice 'PASS: B update of A letter = 0 rows'; else raise notice 'FAIL: B update of A letter = % rows', v_rows; end if;
  update public.letters set reveal_at = now() - interval '1 day', visibility = 'shared' where visibility = 'scheduled';
  get diagnostics v_rows = row_count;
  if v_rows = 0 then raise notice 'PASS: B scheduled-letter delivery manipulation = 0 rows'; else raise notice 'FAIL: B scheduled-letter manipulation = % rows', v_rows; end if;
  delete from public.appreciations where author_id = '11111111-1111-1111-1111-111111111111';
  get diagnostics v_rows = row_count;
  if v_rows = 0 then raise notice 'PASS: B delete of A appreciation = 0 rows'; else raise notice 'FAIL: B delete of A appreciation = % rows', v_rows; end if;
  update public.game_progress set score = 999 where user_id = '11111111-1111-1111-1111-111111111111';
  get diagnostics v_rows = row_count;
  if v_rows = 0 then raise notice 'PASS: B update of A game progress = 0 rows'; else raise notice 'FAIL: B update of A game progress = % rows', v_rows; end if;
end $$;
do $$ declare v_body text; begin
  begin
    select body into v_body from public.letters where space_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' limit 1;
    raise notice 'FAIL: B direct raw letters.body readable';
  exception when insufficient_privilege then
    raise notice 'PASS: B direct raw letters.body denied';
  end;
  begin
    select answer into v_body from public.game_rounds where space_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' limit 1;
    raise notice 'FAIL: B direct raw game_rounds.answer readable';
  exception when insufficient_privilege then
    raise notice 'PASS: B direct raw game_rounds.answer denied';
  end;
end $$;
do $$ declare v_answer text; v_rows int; begin
  select answer into v_answer from public.game_rounds_visible where space_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  if v_answer is null then raise notice 'PASS: B game round answer masked in view'; else raise notice 'FAIL: B game round answer visible in view'; end if;
  -- Board guards: legitimate step, then version jump, config change, space change, finished-game change.
  -- Legitimate step: A rolls and ends turn (position 0->3, turn 0->1, current 0->1, dice cleared).
  update public.board_games set state = '{"players":[{"name":"A","token":"red","coins":1000,"position":3,"skipTurns":0,"bankrupt":false},{"name":"B","token":"blue","coins":1000,"position":0,"skipTurns":0,"bankrupt":false}],"current":1,"phase":"roll","dice":null,"pendingSpaceId":null,"pendingTrade":null,"owners":{},"log":["start"],"plotIndex":0,"surpriseIndex":0,"lastCard":null,"winner":null,"draw":false,"turn":1}', version = 1 where id = 'bbbbbbbb-0000-0000-0000-000000000001' and version = 0;
  get diagnostics v_rows = row_count;
  if v_rows = 1 then raise notice 'PASS: B legitimate board step version 0->1'; else raise notice 'FAIL: B legitimate board step = % rows', v_rows; end if;
  begin
    update public.board_games set state = '{"players":[{"name":"A","token":"red","coins":1000,"position":3,"skipTurns":0,"bankrupt":false},{"name":"B","token":"blue","coins":1000,"position":0,"skipTurns":0,"bankrupt":false}],"current":1,"phase":"roll","dice":null,"pendingSpaceId":null,"pendingTrade":null,"owners":{},"log":["start"],"plotIndex":0,"surpriseIndex":0,"lastCard":null,"winner":null,"draw":false,"turn":9}', version = 3 where id = 'bbbbbbbb-0000-0000-0000-000000000001';
    raise notice 'FAIL: B board version jump allowed';
  exception when others then
    raise notice 'PASS: B board version jump blocked';
  end;
  begin
    update public.board_games set config = '{"board":"hacked"}', version = 1 where id = 'bbbbbbbb-0000-0000-0000-000000000002';
    raise notice 'FAIL: B board config change allowed';
  exception when others then
    raise notice 'PASS: B board config change blocked';
  end;
  begin
    update public.board_games set space_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc', version = 1 where id = 'bbbbbbbb-0000-0000-0000-000000000002';
    raise notice 'FAIL: B board space change allowed';
  exception when others then
    raise notice 'PASS: B board space change blocked';
  end;
  -- Active -> finished via end-early: B holds more coins, winner 1, phase gameover.
  update public.board_games set status = 'finished', state = '{"players":[{"name":"A","token":"red","coins":1000,"position":0,"skipTurns":0,"bankrupt":false},{"name":"B","token":"blue","coins":1200,"position":0,"skipTurns":0,"bankrupt":false}],"current":0,"phase":"gameover","dice":null,"pendingSpaceId":null,"pendingTrade":null,"owners":{},"log":["start"],"plotIndex":0,"surpriseIndex":0,"lastCard":null,"winner":1,"draw":false,"turn":1}', version = 1 where id = 'bbbbbbbb-0000-0000-0000-000000000003' and version = 0;
  get diagnostics v_rows = row_count;
  if v_rows = 1 then raise notice 'PASS: B board active->finished allowed'; else raise notice 'FAIL: B board active->finished = % rows', v_rows; end if;
  begin
    update public.board_games set state = '{"players":[{"name":"A","token":"red","coins":1000,"position":0,"skipTurns":0,"bankrupt":false},{"name":"B","token":"blue","coins":1200,"position":0,"skipTurns":0,"bankrupt":false}],"current":0,"phase":"gameover","dice":null,"pendingSpaceId":null,"pendingTrade":null,"owners":{},"log":["start"],"plotIndex":0,"surpriseIndex":0,"lastCard":null,"winner":1,"draw":false,"turn":2}', version = 2 where id = 'bbbbbbbb-0000-0000-0000-000000000003';
    raise notice 'FAIL: B finished board update allowed';
  exception when others then
    raise notice 'PASS: B finished board update blocked';
  end;
  begin
    insert into public.board_games (space_id, config, state, version, status) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','{}','{}',5,'active');
    raise notice 'FAIL: B board insert at version 5 allowed';
  exception when others then
    raise notice 'PASS: B board insert at version 5 blocked';
  end;
end $$;
do $$ begin
  begin
    insert into storage.objects (bucket_id, name, owner) values ('private-media','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/other/test.png','22222222-2222-2222-2222-222222222222');
    raise notice 'FAIL: B storage wrong-kind insert allowed';
  exception when others then
    raise notice 'PASS: B storage wrong-kind insert blocked';
  end;
  begin
    insert into storage.objects (bucket_id, name, owner) values ('private-media','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/photo/evil.html','22222222-2222-2222-2222-222222222222');
    raise notice 'FAIL: B storage .html insert allowed';
  exception when others then
    raise notice 'PASS: B storage .html insert blocked';
  end;
  begin
    insert into storage.objects (bucket_id, name, owner) values ('private-media','cccccccc-cccc-cccc-cccc-cccccccccccc/photo/test.png','22222222-2222-2222-2222-222222222222');
    raise notice 'FAIL: B storage non-member insert allowed';
  exception when others then
    raise notice 'PASS: B storage non-member insert blocked';
  end;
  insert into storage.objects (bucket_id, name, owner) values ('private-media','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/photo/b-photo.png','22222222-2222-2222-2222-222222222222');
  raise notice 'PASS: B storage own photo insert allowed (row will be deleted next)';
  delete from storage.objects where name = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/photo/b-photo.png';
  raise notice 'PASS: B storage own photo delete allowed';
end $$;
do $$ declare v_rows int; begin
  delete from storage.objects where name = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/photo/a-photo.png';
  get diagnostics v_rows = row_count;
  if v_rows = 0 then raise notice 'PASS: B delete of A photo = 0 rows'; else raise notice 'FAIL: B delete of A photo = % rows', v_rows; end if;
end $$;
-- Guess RPC as B: correct guess reveals, second guess fails.
do $$ declare v_result jsonb; begin
  v_result := public.guess_answer((select id from public.game_rounds where space_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' limit 1), 'blue');
  if (v_result ->> 'correct') = 'true' then raise notice 'PASS: B guess RPC correct'; else raise notice 'FAIL: B guess RPC result = %', v_result; end if;
  begin
    perform public.guess_answer((select id from public.game_rounds where space_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' limit 1), 'blue');
    raise notice 'FAIL: B second guess allowed';
  exception when others then
    raise notice 'PASS: B second guess blocked';
  end;
end $$;
-- ---------- 0012 checks as partner B ----------
do $$ declare v_rows int; v_mem_id uuid; v_board_cfg jsonb; v_board_state jsonb; begin
  -- Game sessions are append-only: partner cannot update or delete A's session.
  update public.game_sessions set started_by = '22222222-2222-2222-2222-222222222222' where started_by = '11111111-1111-1111-1111-111111111111';
  get diagnostics v_rows = row_count;
  if v_rows = 0 then raise notice 'PASS: B update of A game session = 0 rows'; else raise notice 'FAIL: B update of A game session = % rows', v_rows; end if;
  delete from public.game_sessions where started_by = '11111111-1111-1111-1111-111111111111';
  get diagnostics v_rows = row_count;
  if v_rows = 0 then raise notice 'PASS: B delete of A game session = 0 rows'; else raise notice 'FAIL: B delete of A game session = % rows', v_rows; end if;
  -- Shared-table identity freeze: partner cannot reassign authorship...
  select id into v_mem_id from public.memories where space_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' limit 1;
  begin
    update public.memories set author_id = '22222222-2222-2222-2222-222222222222' where id = v_mem_id;
    raise notice 'FAIL: B memory author reassignment allowed';
  exception when others then
    raise notice 'PASS: B memory author reassignment blocked';
  end;
  -- ...but shared content editing by the partner still works.
  update public.memories set title = 'Edited by partner' where id = v_mem_id;
  get diagnostics v_rows = row_count;
  if v_rows = 1 then raise notice 'PASS: B shared memory edit still allowed'; else raise notice 'FAIL: B shared memory edit = % rows', v_rows; end if;
  update public.memories set title = 'Test memory' where id = v_mem_id;
  -- Game-config attribution: partner cannot spoof updated_by as A.
  begin
    insert into public.game_configs (space_id, game_key, config, updated_by) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','quiz','{"questions":[]}','11111111-1111-1111-1111-111111111111');
    raise notice 'FAIL: B game config attribution spoof allowed';
  exception when others then
    raise notice 'PASS: B game config attribution spoof blocked';
  end;
  -- Board shape forgeries on game 002 (still version 0): negative coins,
  -- three players, whole-board ownership theft in one step, rigged insert.
  select config, state into v_board_cfg, v_board_state from public.board_games where id = 'bbbbbbbb-0000-0000-0000-000000000002';
  begin
    update public.board_games set state = jsonb_set(v_board_state, '{players,0,coins}', '-50'::jsonb), version = 1 where id = 'bbbbbbbb-0000-0000-0000-000000000002';
    raise notice 'FAIL: B board negative coins allowed';
  exception when others then
    raise notice 'PASS: B board negative coins blocked';
  end;
  begin
    update public.board_games set state = jsonb_set(v_board_state, '{players}', (v_board_state -> 'players') || '{"name":"C","token":"green","coins":1000,"position":0,"skipTurns":0,"bankrupt":false}'::jsonb), version = 1 where id = 'bbbbbbbb-0000-0000-0000-000000000002';
    raise notice 'FAIL: B board third player allowed';
  exception when others then
    raise notice 'PASS: B board third player blocked';
  end;
  begin
    update public.board_games set state = jsonb_set(v_board_state, '{owners}', '{"s1":0,"s2":0,"s5":0}'::jsonb), version = 1 where id = 'bbbbbbbb-0000-0000-0000-000000000002';
    raise notice 'FAIL: B board multi-property theft in one step allowed';
  exception when others then
    raise notice 'PASS: B board multi-property theft in one step blocked';
  end;
  begin
    insert into public.board_games (space_id, config, state, version, status) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','{"startCoins":1000,"passStartBonus":200,"plotTwists":[],"surprises":[],"spaces":[{"id":"s0","kind":"start"}]}', v_board_state, 0, 'active');
    raise notice 'FAIL: B rigged board insert (1-space board) allowed';
  exception when others then
    raise notice 'PASS: B rigged board insert (1-space board) blocked';
  end;
end $$;
-- ---------- 0012 progress-cap checks as author A ----------
set role authenticated;
select set_config('app.current_user', '11111111-1111-1111-1111-111111111111', false);
do $$ declare v_rows int; begin
  -- Memory cap with no config row: default pairs = 6 (seed row already 6).
  begin
    update public.game_progress set score = 7 where user_id = '11111111-1111-1111-1111-111111111111' and game_key = 'memory';
    raise notice 'FAIL: A memory score above default pairs allowed';
  exception when others then
    raise notice 'PASS: A memory score above default pairs blocked';
  end;
  -- Quiz cap from a live config row: 3 questions -> 3 passes, 4 fails.
  insert into public.game_configs (space_id, game_key, config, updated_by) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','quiz','{"questions":[{"id":"q1"},{"id":"q2"},{"id":"q3"}]}','11111111-1111-1111-1111-111111111111')
  on conflict (space_id, game_key) do update set config = excluded.config, updated_by = excluded.updated_by;
  insert into public.game_progress (space_id, user_id, game_key, score) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','quiz',3)
  on conflict (space_id, user_id, game_key) do update set score = excluded.score;
  raise notice 'PASS: A quiz score at cap allowed';
  begin
    update public.game_progress set score = 4 where user_id = '11111111-1111-1111-1111-111111111111' and game_key = 'quiz';
    raise notice 'FAIL: A quiz score above config cap allowed';
  exception when others then
    raise notice 'PASS: A quiz score above config cap blocked';
  end;
  -- Progress must be an object, not an array.
  begin
    update public.game_progress set progress = '[]'::jsonb where user_id = '11111111-1111-1111-1111-111111111111' and game_key = 'memory';
    raise notice 'FAIL: A non-object game progress allowed';
  exception when others then
    raise notice 'PASS: A non-object game progress blocked';
  end;
end $$;
reset role;

-- ---------- checks as outsider C ----------
set role authenticated;
select set_config('app.current_user', '33333333-3333-3333-3333-333333333333', false);
do $$ declare v_count int; begin
  select count(*) into v_count from public.letters_visible where space_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  if v_count = 0 then raise notice 'PASS: C view letters = 0'; else raise notice 'FAIL: C view letters = %', v_count; end if;
  select count(*) into v_count from public.spaces where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  if v_count = 0 then raise notice 'PASS: C spaces = 0'; else raise notice 'FAIL: C spaces = %', v_count; end if;
  select count(*) into v_count from public.memories where space_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  if v_count = 0 then raise notice 'PASS: C memories = 0'; else raise notice 'FAIL: C memories = %', v_count; end if;
end $$;
reset role;

-- ---------- author A still works, and real data unchanged ----------
set role authenticated;
select set_config('app.current_user', '11111111-1111-1111-1111-111111111111', false);
do $$ declare v_count int; v_body text; begin
  select count(*) into v_count from public.letters_visible where space_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  if v_count = 3 then raise notice 'PASS: A view letters = 3 (own draft included)'; else raise notice 'FAIL: A view letters = % (expected 3)', v_count; end if;
  select body into v_body from public.letters_visible where space_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and visibility = 'private_draft';
  if v_body = 'DRAFT-BODY' then raise notice 'PASS: A own draft body visible to author'; else raise notice 'FAIL: A own draft body missing'; end if;
end $$;
reset role;
select 'owner_final_counts' as check, (select count(*) from public.letters where space_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') as letters,
  (select count(*) from public.letters where title = 'HACKED') as hacked_titles,
  (select count(*) from public.appreciations where space_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') as appreciations,
  (select count(*) from public.game_progress where space_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and score = 999) as inflated_scores,
  (select count(*) from storage.objects where name = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/photo/a-photo.png') as a_photo_still_present,
  (select count(*) from public.letters where visibility = 'scheduled' and reveal_at > now()) as sealed_still_scheduled;
