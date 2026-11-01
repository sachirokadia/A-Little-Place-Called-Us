-- A Little Place Called Us — migration 0006: arcade configs + guess rounds
-- Apply in the Supabase SQL editor after 0005.
--
-- game_configs: one row per game per space, JSONB config. A new game needs
-- only a new game_key and a config shape — no schema change.
-- game_rounds: Guess My Answer rounds. The answer is private to the creator
-- until revealed. That is enforced two ways, not by the UI:
--  * game_rounds_visible (the view the app reads) returns NULL for answer
--    unless the round is revealed or the viewer is the creator.
--  * guess_answer (the RPC the app calls) refuses a second guess and a
--    guess by the creator, and reveals the answer in the same call.
-- game_progress gains moves/time_ms so Memory Match and Catch the Hearts
-- can record honest scores (Phase 3 created it with score only).

create table if not exists public.game_configs (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  game_key text not null check (char_length(game_key) between 1 and 100),
  config jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (space_id, game_key)
);
alter table public.game_configs enable row level security;
create index if not exists idx_game_configs_space on public.game_configs (space_id);
drop policy if exists "game configs members" on public.game_configs;
create policy "game configs members" on public.game_configs for all using (public.is_space_member(space_id))
  with check (public.is_space_member(space_id));

create table if not exists public.game_rounds (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  creator_id uuid not null references auth.users (id) on delete cascade,
  question text not null check (char_length(question) between 1 and 1000),
  answer text not null check (char_length(answer) between 1 and 1000),
  guess text,
  guessed_by uuid references auth.users (id) on delete set null,
  correct boolean,
  revealed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.game_rounds enable row level security;
create index if not exists idx_game_rounds_space on public.game_rounds (space_id, created_at desc);
drop policy if exists "game rounds creators insert" on public.game_rounds;
create policy "game rounds creators insert" on public.game_rounds for insert with check (
  public.is_space_member(space_id) and auth.uid() = creator_id
);
-- No direct select/update/delete policy on game_rounds: reads go through
-- the masked view, guesses go through the RPC. That is the enforcement.

create or replace view public.game_rounds_visible as
  select
    id, space_id, creator_id, question,
    case when revealed or creator_id = auth.uid() then answer else null end as answer,
    guess, guessed_by, correct, revealed, created_at
  from public.game_rounds;
grant select on public.game_rounds_visible to authenticated;

create or replace function public.guess_answer(p_round_id uuid, p_guess text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round public.game_rounds%rowtype;
  v_correct boolean;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  select * into v_round from public.game_rounds where id = p_round_id;
  if v_round.id is null then raise exception 'That round could not be found.'; end if;
  if not public.is_space_member(v_round.space_id) then raise exception 'You do not belong to that space.'; end if;
  if v_round.creator_id = auth.uid() then raise exception 'You cannot guess your own question.'; end if;
  if v_round.revealed then raise exception 'That round has already been guessed.'; end if;
  v_correct := lower(regexp_replace(trim(p_guess), '[^a-z0-9 ]', '', 'g')) = lower(regexp_replace(trim(v_round.answer), '[^a-z0-9 ]', '', 'g'));
  update public.game_rounds
  set guess = trim(p_guess), guessed_by = auth.uid(), correct = v_correct, revealed = true, updated_at = now()
  where id = p_round_id;
  return jsonb_build_object('correct', v_correct, 'answer', v_round.answer);
end;
$$;
grant execute on function public.guess_answer(uuid, text) to authenticated;

alter table public.game_progress add column if not exists moves integer check (moves is null or moves >= 0);
alter table public.game_progress add column if not exists time_ms integer check (time_ms is null or time_ms >= 0);
