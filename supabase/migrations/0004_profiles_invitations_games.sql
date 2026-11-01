-- A Little Place Called Us — migration 0004: profiles, invitations, games schema
-- Apply in the Supabase SQL editor after 0001, 0002 and 0003.
--
-- What this adds, and why:
--  * profiles — the Phase 3 profiles table. Previously a partner's name was
--    derived from their email prefix on every load, and there was nowhere to
--    store a chosen display name or avatar path. A profile row is created
--    automatically when an auth user signs up (handle_new_user trigger);
--    existing users get a row the first time the app loads them (upsert).
--  * invitations — expiring, single-use pairing codes, separate from a
--    space's permanent invite_code. The permanent code still works; an
--    invitation is the safer share (7 days, one redemption).
--  * shared_messages, game_sessions, game_progress, board_games,
--    board_game_moves — schema for the later phases. No UI writes to these
--    in Phase 3; their RLS is written now so the games/messaging phases
--    cannot ship them unprotected.
--  * One space per user, enforced by triggers (spaces + space_members), so
--    a user cannot silently create or join a second space that the app
--    would then never show them (the app loads one space per user).
--
-- Entity mapping (Phase 3 brief -> table):
--  profiles -> profiles (new); shared spaces -> spaces; membership -> space_members;
--  invitations -> invitations (new); memories + photo metadata -> memories
--    (media_path/media_type, private-media bucket); shared messages ->
--    shared_messages (new, schema only); appreciation notes -> appreciations;
--  letters + scheduled reveal -> letters + letters_visible view; private
--  journals -> journal_entries; future plans + bucket list -> future_plans
--    (category bucket/date/plan); game sessions + saved progress ->
--    game_sessions + game_progress (new, schema only); board-game config +
--    state -> board_games + board_game_moves (new, schema only).

-- ---------- profiles ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 100),
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- A partner may read their own profile, and the profiles of the members of
-- any space they belong to (so "Partner" can become a real name on Home).
drop policy if exists "profiles readable by space members" on public.profiles;
create policy "profiles readable by space members" on public.profiles for select using (
  auth.uid() = id
  or exists (
    select 1 from public.space_members a
    join public.space_members b on b.space_id = a.space_id
    where a.user_id = auth.uid() and b.user_id = profiles.id
  )
);
drop policy if exists "profiles writable by owner" on public.profiles;
create policy "profiles writable by owner" on public.profiles for insert with check (auth.uid() = id);
drop policy if exists "profiles updatable by owner" on public.profiles;
create policy "profiles updatable by owner" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, split_part(coalesce(new.email, ''), '@', 1))
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- invitations ----------
create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  code text not null unique check (code ~ '^[A-Z2-9]{6}$'),
  created_by uuid not null references auth.users (id) on delete cascade,
  invited_email text,
  expires_at timestamptz not null default (now() + interval '7 days'),
  redeemed_by uuid references auth.users (id) on delete set null,
  redeemed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.invitations enable row level security;
create index if not exists idx_invitations_code on public.invitations (code);
create index if not exists idx_invitations_space on public.invitations (space_id);

drop policy if exists "invitations readable by members or creator" on public.invitations;
create policy "invitations readable by members or creator" on public.invitations for select using (
  public.is_space_member(space_id) or auth.uid() = created_by
);
drop policy if exists "invitations creatable by members" on public.invitations;
create policy "invitations creatable by members" on public.invitations for insert with check (
  public.is_space_member(space_id) and auth.uid() = created_by
);
-- Redemption happens only through join_space_by_code (security definer);
-- there is deliberately no direct update policy on invitations.

-- Create a single-use, 7-day invitation for a space the caller belongs to.
-- Fails when the space already has two members (an invite would be useless).
create or replace function public.create_invitation(p_space_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := '';
  v_i int;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not public.is_space_member(p_space_id) then raise exception 'You do not belong to that space.'; end if;
  if (select count(*) from public.space_members where space_id = p_space_id) >= 2 then
    raise exception 'This space already has two members.';
  end if;
  loop
    v_code := '';
    for v_i in 1..6 loop
      v_code := v_code || substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', floor(random() * 31 + 1)::int, 1);
    end loop;
    exit when not exists (select 1 from public.invitations where code = v_code)
      and not exists (select 1 from public.spaces where invite_code = v_code);
  end loop;
  insert into public.invitations (space_id, code, created_by)
  values (p_space_id, v_code, auth.uid());
  return v_code;
end;
$$;
grant execute on function public.create_invitation(uuid) to authenticated;

-- Join by code, extended: an unexpired, unredeemed invitation is tried first
-- (and redeemed in the same call), then the space's permanent invite_code.
-- Existing members return their space without consuming an invitation.
create or replace function public.join_space_by_code(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_space_id uuid;
  v_inv_space_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  select space_id into v_inv_space_id
  from public.invitations
  where code = upper(trim(p_code)) and redeemed_by is null and expires_at > now()
  order by created_at desc limit 1;
  if v_inv_space_id is not null then
    if exists (select 1 from public.space_members where space_id = v_inv_space_id and user_id = auth.uid()) then
      return v_inv_space_id;
    end if;
    if (select count(*) from public.space_members where space_id = v_inv_space_id) >= 2 then
      raise exception 'This space already has two members.';
    end if;
    update public.invitations set redeemed_by = auth.uid(), redeemed_at = now()
    where code = upper(trim(p_code)) and redeemed_by is null;
    insert into public.space_members (space_id, user_id, role)
    values (v_inv_space_id, auth.uid(), 'member');
    return v_inv_space_id;
  end if;
  select id into v_space_id
  from public.spaces
  where invite_code = upper(trim(p_code));
  if v_space_id is null then
    raise exception 'No space was found with that invite code.';
  end if;
  if exists (select 1 from public.space_members where space_id = v_space_id and user_id = auth.uid()) then
    return v_space_id;
  end if;
  if (select count(*) from public.space_members where space_id = v_space_id) >= 2 then
    raise exception 'This space already has two members.';
  end if;
  insert into public.space_members (space_id, user_id, role)
  values (v_space_id, auth.uid(), 'member');
  return v_space_id;
end;
$$;
grant execute on function public.join_space_by_code(text) to authenticated;

-- ---------- shared messages (schema only in Phase 3) ----------
create table if not exists public.shared_messages (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  author_name text not null default '',
  body text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  is_favorite boolean not null default false
);
alter table public.shared_messages enable row level security;
create index if not exists idx_shared_messages_space on public.shared_messages (space_id, created_at desc);
drop policy if exists "shared messages members" on public.shared_messages;
create policy "shared messages members" on public.shared_messages for all using (public.is_space_member(space_id))
  with check (public.is_space_member(space_id) and auth.uid() = author_id);

-- ---------- game sessions + progress (schema only in Phase 3) ----------
create table if not exists public.game_sessions (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  game_key text not null check (char_length(game_key) between 1 and 100),
  status text not null default 'active' check (status in ('active', 'finished', 'abandoned')),
  started_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz
);
alter table public.game_sessions enable row level security;
drop policy if exists "game sessions members" on public.game_sessions;
create policy "game sessions members" on public.game_sessions for all using (public.is_space_member(space_id))
  with check (public.is_space_member(space_id) and auth.uid() = started_by);

create table if not exists public.game_progress (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  game_key text not null check (char_length(game_key) between 1 and 100),
  score integer not null default 0 check (score >= 0),
  progress jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (space_id, user_id, game_key)
);
alter table public.game_progress enable row level security;
create index if not exists idx_game_progress_space on public.game_progress (space_id, game_key);
drop policy if exists "game progress readable by members" on public.game_progress;
create policy "game progress readable by members" on public.game_progress for select using (public.is_space_member(space_id));
drop policy if exists "game progress writable by owner" on public.game_progress;
create policy "game progress writable by owner" on public.game_progress for all using (public.is_space_member(space_id) and auth.uid() = user_id)
  with check (public.is_space_member(space_id) and auth.uid() = user_id);

-- ---------- board games (schema only in Phase 3) ----------
create table if not exists public.board_games (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  config jsonb not null default '{}'::jsonb,
  state jsonb not null default '{}'::jsonb,
  current_turn_user_id uuid references auth.users (id) on delete set null,
  version integer not null default 0 check (version >= 0),
  status text not null default 'active' check (status in ('active', 'finished')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.board_games enable row level security;
create index if not exists idx_board_games_space on public.board_games (space_id, created_at desc);
drop policy if exists "board games members" on public.board_games;
create policy "board games members" on public.board_games for all using (public.is_space_member(space_id))
  with check (public.is_space_member(space_id));

create table if not exists public.board_game_moves (
  id uuid primary key default gen_random_uuid(),
  board_game_id uuid not null references public.board_games (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  move jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.board_game_moves enable row level security;
create index if not exists idx_board_moves_game on public.board_game_moves (board_game_id, created_at asc);
drop policy if exists "board moves readable by members" on public.board_game_moves;
create policy "board moves readable by members" on public.board_game_moves for select using (
  exists (select 1 from public.board_games g where g.id = board_game_moves.board_game_id and public.is_space_member(g.space_id))
);
drop policy if exists "board moves writable by author" on public.board_game_moves;
create policy "board moves writable by author" on public.board_game_moves for insert with check (
  auth.uid() = user_id and exists (select 1 from public.board_games g where g.id = board_game_moves.board_game_id and public.is_space_member(g.space_id))
);

-- ---------- one space per user (triggers, security definer like enforce_two_members) ----------
create or replace function public.prevent_second_space()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.space_members where user_id = new.created_by) then
    raise exception 'You already belong to a space.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_one_space_per_user on public.spaces;
create trigger trg_one_space_per_user before insert on public.spaces
  for each row execute function public.prevent_second_space();

create or replace function public.prevent_second_membership()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.space_members where user_id = new.user_id and space_id <> new.space_id) then
    raise exception 'You already belong to a space.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_one_membership_per_user on public.space_members;
create trigger trg_one_membership_per_user before insert on public.space_members
  for each row execute function public.prevent_second_membership();
