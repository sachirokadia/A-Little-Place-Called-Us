-- A Little Place Called Us — initial schema
-- Apply in the Supabase SQL editor, or: supabase db push (see README).
-- Design decisions, stated plainly:
--  * A space has AT MOST TWO members (trigger below). Membership is the only gate to shared content.
--  * Shared content: both members may SELECT/INSERT/UPDATE/soft-delete. Hard delete is also
--    allowed by policy but the app only reaches it from the Deleted room after a second confirmation.
--  * Private journals: author-only on every operation. They are NEVER returned by a shared query.
--  * Private drafts (letters.visibility = 'private_draft'): author-only, same rule.
--  * Scheduled letters: the letters_visible view masks body for non-authors until reveal_at.
--    The app must read letters through that view, never through the raw table for the partner's letters.
--  * Deletion is soft (deleted_at). Rows with deleted_at set are excluded by the app and by the
--    letters_visible view; restoring = setting deleted_at back to NULL.
--  * No service-role key is ever used by the frontend. Everything below runs as the anon/authenticated
--    role under RLS.

create extension if not exists pgcrypto;

-- ---------- spaces & membership ----------
create table if not exists public.spaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  invite_code text not null unique check (invite_code ~ '^[A-Z2-9]{6}$'),
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.space_members (
  space_id uuid not null references public.spaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (space_id, user_id)
);

alter table public.spaces enable row level security;
alter table public.space_members enable row level security;

create or replace function public.is_space_member(p_space_id uuid)
returns boolean language sql stable security definer as $$
  select exists (select 1 from public.space_members where space_id = p_space_id and user_id = auth.uid());
$$;

-- A member can see their own spaces and their own membership rows.
create policy "members read own spaces" on public.spaces
  for select using (public.is_space_member(id));
create policy "creator inserts space" on public.spaces
  for insert with check (auth.uid() = created_by);
-- No update/delete policy on spaces: spaces are not renamed/deleted from the app in v1.

create policy "members read membership" on public.space_members
  for select using (public.is_space_member(space_id));
create policy "self joins by invite" on public.space_members
  for insert with check (auth.uid() = user_id);
-- No update/delete on membership in v1: leaving a space is a support operation, not an app button.

-- Enforce the two-member cap at the database, not just in the UI.
create or replace function public.enforce_two_members()
returns trigger language plpgsql as $$
begin
  if (select count(*) from public.space_members where space_id = new.space_id) >= 2 then
    raise exception 'This space already has two members.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_two_members on public.space_members;
create trigger trg_two_members before insert on public.space_members
  for each row execute function public.enforce_two_members();

-- ---------- shared base columns (repeated per table for clarity) ----------
-- Every content table: id, space_id, author_id, author_name, created_at, updated_at,
-- deleted_at (soft delete), is_favorite, plus its own fields.

create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  author_name text not null default '',
  text text not null check (char_length(text) between 1 and 2000),
  kind text not null default 'note' check (kind in ('note', 'prompt')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  is_favorite boolean not null default false
);

create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  author_name text not null default '',
  title text not null check (char_length(title) between 1 and 200),
  caption text not null default '' check (char_length(caption) <= 2000),
  story text not null default '' check (char_length(story) <= 5000),
  happened_on date not null,
  media_path text, -- private-media bucket path; null when no photo
  media_type text not null default 'none' check (media_type in ('photo', 'none')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  is_favorite boolean not null default false
);

create table if not exists public.letters (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  author_name text not null default '',
  title text not null check (char_length(title) between 1 and 200),
  body text not null check (char_length(body) between 1 and 20000),
  visibility text not null default 'shared' check (visibility in ('shared', 'private_draft', 'scheduled')),
  reveal_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  is_favorite boolean not null default false,
  check (visibility <> 'scheduled' or reveal_at is not null)
);

create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  author_name text not null default '',
  title text not null check (char_length(title) between 1 and 200),
  body text not null check (char_length(body) between 1 and 20000),
  mood text not null default 'calm',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  is_favorite boolean not null default false
);

create table if not exists public.appreciations (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  author_name text not null default '',
  text text not null check (char_length(text) between 1 and 2000),
  kind text not null default 'appreciation' check (kind in ('appreciation', 'achievement', 'encouragement')),
  for_name text not null default 'Partner',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  is_favorite boolean not null default false
);

create table if not exists public.future_plans (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  author_name text not null default '',
  title text not null check (char_length(title) between 1 and 200),
  detail text not null default '' check (char_length(detail) <= 2000),
  category text not null default 'plan' check (category in ('bucket', 'date', 'plan')),
  status text not null default 'planned' check (status in ('planned', 'done')),
  completed_at timestamptz,
  completion_photo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  is_favorite boolean not null default false
);

create table if not exists public.voice_notes (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  author_name text not null default '',
  title text not null check (char_length(title) between 1 and 200),
  duration_sec integer,
  media_path text,
  room text not null default 'quiet' check (room in ('quiet', 'letters', 'memories')),
  linked_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  is_favorite boolean not null default false
);

-- ---------- RLS: shared tables ----------
-- Helper pattern per table: member + (not a private item, or author) for reads;
-- member + author for writes. Journals are author-only throughout.

do $$
declare t text;
begin
  foreach t in array array['reminders', 'memories', 'appreciations', 'future_plans', 'voice_notes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "space members read" on public.%I', t);
    execute format('create policy "space members read" on public.%I for select using (public.is_space_member(space_id))', t);
    execute format('drop policy if exists "member authors write" on public.%I', t);
    execute format('create policy "member authors write" on public.%I for insert with check (public.is_space_member(space_id) and auth.uid() = author_id)', t);
    execute format('drop policy if exists "space members update" on public.%I', t);
    execute format('create policy "space members update" on public.%I for update using (public.is_space_member(space_id)) with check (public.is_space_member(space_id))', t);
    execute format('drop policy if exists "space members delete" on public.%I', t);
    execute format('create policy "space members delete" on public.%I for delete using (public.is_space_member(space_id))', t);
  end loop;
end $$;

-- Letters: shared/scheduled are space-visible; private_draft is author-only.
alter table public.letters enable row level security;
drop policy if exists "letters read" on public.letters;
create policy "letters read" on public.letters for select using (
  public.is_space_member(space_id) and (visibility <> 'private_draft' or auth.uid() = author_id)
);
drop policy if exists "letters write" on public.letters;
create policy "letters write" on public.letters for insert with check (
  public.is_space_member(space_id) and auth.uid() = author_id
);
drop policy if exists "letters update" on public.letters;
create policy "letters update" on public.letters for update using (
  public.is_space_member(space_id) and (visibility <> 'private_draft' or auth.uid() = author_id)
) with check (public.is_space_member(space_id));
drop policy if exists "letters delete" on public.letters;
create policy "letters delete" on public.letters for delete using (
  public.is_space_member(space_id) and (visibility <> 'private_draft' or auth.uid() = author_id)
);

-- Journals: author-only, always. This is the privacy boundary for the Quiet Room.
alter table public.journal_entries enable row level security;
drop policy if exists "journals author only" on public.journal_entries;
create policy "journals author only" on public.journal_entries for all using (auth.uid() = author_id) with check (auth.uid() = author_id);

-- ---------- sealed-letter view ----------
-- Non-authors see NULL body until reveal_at passes. Authors always see their own body.
-- The frontend reads letters through this view. Grant it to authenticated users only.
create or replace view public.letters_visible as
  select
    id, space_id, author_id, author_name, title,
    case
      when visibility = 'scheduled' and author_id <> auth.uid() and reveal_at > now() then null
      else body
    end as body,
    visibility, reveal_at, created_at, updated_at, deleted_at, is_favorite
  from public.letters;
grant select on public.letters_visible to authenticated;

-- ---------- storage: private-media bucket (create in Dashboard > Storage, or via SQL below) ----------
-- Bucket must be PRIVATE. Files are addressed <space_id>/<kind>/<uuid>.<ext> so the
-- first path segment is the space id, which the policies check against membership.
insert into storage.buckets (id, name, public)
values ('private-media', 'private-media', false)
on conflict (id) do nothing;

drop policy if exists "members read own space media" on storage.objects;
create policy "members read own space media" on storage.objects for select using (
  bucket_id = 'private-media' and public.is_space_member((string_to_array(name, '/'))[1]::uuid)
);
drop policy if exists "members upload own space media" on storage.objects;
create policy "members upload own space media" on storage.objects for insert with check (
  bucket_id = 'private-media' and public.is_space_member((string_to_array(name, '/'))[1]::uuid)
);
drop policy if exists "members delete own space media" on storage.objects;
create policy "members delete own space media" on storage.objects for delete using (
  bucket_id = 'private-media' and public.is_space_member((string_to_array(name, '/'))[1]::uuid)
);

-- ---------- indexes ----------
create index if not exists idx_reminders_space on public.reminders (space_id, created_at desc);
create index if not exists idx_memories_space_happened on public.memories (space_id, happened_on desc);
create index if not exists idx_letters_space on public.letters (space_id, created_at desc);
create index if not exists idx_journals_author on public.journal_entries (author_id, created_at desc);
create index if not exists idx_appreciations_space on public.appreciations (space_id, created_at desc);
create index if not exists idx_plans_space_status on public.future_plans (space_id, status, created_at desc);
create index if not exists idx_voice_space on public.voice_notes (space_id, created_at desc);
create index if not exists idx_members_user on public.space_members (user_id);
