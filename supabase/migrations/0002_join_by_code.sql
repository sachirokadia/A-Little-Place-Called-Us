-- A Little Place Called Us — migration 0002: join by invite code via RPC
-- Why: a non-member cannot SELECT a space row under RLS (spaces are only
-- visible to members), so a client-side lookup by invite code can never find
-- the space it is trying to join. This security-definer function does the
-- lookup server-side: it only ever returns the space id for an exact code
-- match, enforces the two-member cap, and is idempotent for existing members.
-- Apply in the Supabase SQL editor after 0001_init.sql.

create or replace function public.join_space_by_code(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_space_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.';
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
