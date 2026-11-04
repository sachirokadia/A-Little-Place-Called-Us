-- A Little Place Called Us — migration 0003: trigger + journal hardening
-- Two gaps found by direct API testing (2026-11-01), both fixed here:
--
-- 1. enforce_two_members ran WITHOUT security definer, so its COUNT query
--    ran under the invoker's RLS. A non-member sees zero space_members rows
--    (the members-read policy only shows members their own rows), so the
--    count was always 0 for them and the two-member cap never fired on
--    direct inserts. Making it security definer lets it count all rows.
--    (The app joins via join_space_by_code, which was already security
--    definer, so the app flow was safe — but direct inserts were not.)
--
-- 2. The journals policy checked authorship only, not membership, so a
--    non-member could insert a journal into any space id they guessed
--    (they still could not READ anyone else's journals — author-only read
--    held — but they could pollute a space). Journals now require both
--    authorship and membership, like every other content table.
-- Apply in the Supabase SQL editor after 0001 and 0002.

create or replace function public.enforce_two_members()
returns trigger language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.space_members where space_id = new.space_id) >= 2 then
    raise exception 'This space already has two members.';
  end if;
  return new;
end;
$$;

drop policy if exists "journals author only" on public.journal_entries;
create policy "journals author only" on public.journal_entries for all
  using (auth.uid() = author_id and public.is_space_member(space_id))
  with check (auth.uid() = author_id and public.is_space_member(space_id));
