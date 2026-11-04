-- A Little Place Called Us — migration 0008: view RLS enforcement + policy fixes
-- Apply in the Supabase SQL editor after 0007. Idempotent.
--
-- Why this migration exists (found by direct RLS testing in Phase 9):
--
-- 1. VIEWS BYPASS RLS BY DEFAULT. A view runs with the permissions of its
--    owner (postgres), not the caller, unless security_invoker is set.
--    letters_visible and game_rounds_visible were plain views, so any
--    authenticated user could query them with ANY space_id and read:
--      * another space's shared letters (full body) and private drafts
--        (full body — the view's CASE only masks scheduled letters, and
--        the letters table's private_draft RLS never applied through
--        the view);
--      * another space's game-round questions (answer stayed masked by
--        the view's CASE, but the row itself leaked).
--    The app's own letters read path goes through letters_visible, so
--    this was not a theoretical direct-query bypass — the list query
--    itself returned private drafts to the partner (the UI then filtered
--    them out a second time, but the body was already in the browser).
--    Fix: recreate both views WITH (security_invoker = true) so the
--    underlying table's RLS is evaluated as the caller. Requires
--    PostgreSQL 15+ (Supabase uses 15+).
--
-- 2. game_rounds had NO select policy at all (reads were meant to go
--    through the view, which previously bypassed RLS). With
--    security_invoker on, the view would now return nothing to anyone,
--    because the underlying table denies all selects. Fix: add a
--    member-only select policy on game_rounds. The view's CASE still
--    masks the answer for non-creators until revealed.
--
-- 3. DIRECT JOIN WITHOUT A CODE. space_members had an insert policy
--    "self joins by invite" that only checked auth.uid() = user_id.
--    Any authenticated user who knew (or guessed) a space UUID could
--    insert themselves as a member, no invite code needed, as long as
--    the space was not full and they did not already belong to a space.
--    (UUIDs are 128-bit random and are never shown to non-members, so
--    this needed a leak to exploit — but a policy must not rely on that.)
--    Fix: direct inserts are now allowed only for the space's creator
--    (the createSpace flow, which inserts the creator as owner).
--    Joining by code still works unchanged, because join_space_by_code
--    is security definer and bypasses RLS for its insert.
--
-- 4. SHARED-MESSAGES UPDATE HIJACK (latent: no UI writes to this table
--    yet, but the policy was wrong). The "for all" policy used
--    is_space_member for the old row and only required author in the
--    WITH CHECK for the new row, so a member could overwrite another
--    member's message and set author_id to themselves in the same
--    update. Fix: split into separate policies, with author required
--    in BOTH the using and the with-check clauses for update/delete.
--
-- 5. MISSING GRANTS. Migrations 0001–0007 never granted table/view/
--    function permissions to the authenticated role. In a fresh
--    Supabase project, PostgREST queries would fail with "permission
--    denied" even though RLS policies exist, because a grant AND an
--    RLS policy are both required. These grants enable the
--    RLS-enforced access only — they do not broaden it, because every
--    table below still has its RLS policies. Apply this migration on
--    a project that already granted permissions and these statements
--    are harmless no-ops.
--
-- Ordering warning: do NOT re-run 0001 after this migration. 0001
-- recreates letters_visible without security_invoker and recreates
-- the member-wide letters/appreciations policies, undoing 0007 and
-- this migration. If 0001 is ever re-run, re-apply 0007 and 0008
-- immediately afterwards, in order.

-- ---------- 1. letters_visible with security_invoker ----------
create or replace view public.letters_visible
with (security_invoker = true) as
  select
    id, space_id, author_id, author_name, title,
    case
      when visibility = 'scheduled' and author_id <> auth.uid() and reveal_at > now() then null
      else body
    end as body,
    visibility, reveal_at, created_at, updated_at, deleted_at, is_favorite
  from public.letters;
grant select on public.letters_visible to authenticated;

-- ---------- 2. game_rounds: member select policy + security_invoker view ----------
drop policy if exists "game rounds readable by members" on public.game_rounds;
create policy "game rounds readable by members" on public.game_rounds for select using (
  public.is_space_member(space_id)
);
create or replace view public.game_rounds_visible
with (security_invoker = true) as
  select
    id, space_id, creator_id, question,
    case when revealed or creator_id = auth.uid() then answer else null end as answer,
    guess, guessed_by, correct, revealed, created_at
  from public.game_rounds;
grant select on public.game_rounds_visible to authenticated;

-- ---------- 3. space_members: direct inserts only for the space creator ----------
-- The creator check must be a security-definer function: a plain EXISTS
-- subquery on spaces would itself be blocked by spaces RLS, because the
-- creator is not yet a member at the moment they insert their own
-- membership row (the createSpace flow inserts the space first, then
-- the membership). is_space_member is already security definer for the
-- same reason; this helper follows that pattern and only answers
-- "did the caller create this space", which the caller already knows.
create or replace function public.is_space_creator(p_space_id uuid)
returns boolean language sql stable security definer as $$
  select exists (select 1 from public.spaces where id = p_space_id and created_by = auth.uid());
$$;
drop policy if exists "self joins by invite" on public.space_members;
drop policy if exists "creator inserts own membership" on public.space_members;
create policy "creator inserts own membership" on public.space_members
  for insert with check (
    auth.uid() = user_id and public.is_space_creator(space_id)
  );

-- ---------- 4. shared_messages: author required on both sides of update/delete ----------
drop policy if exists "shared messages members" on public.shared_messages;
drop policy if exists "shared messages readable by members" on public.shared_messages;
drop policy if exists "shared messages insert by author" on public.shared_messages;
drop policy if exists "shared messages update by author" on public.shared_messages;
drop policy if exists "shared messages delete by author" on public.shared_messages;
create policy "shared messages readable by members" on public.shared_messages
  for select using (public.is_space_member(space_id));
create policy "shared messages insert by author" on public.shared_messages
  for insert with check (public.is_space_member(space_id) and auth.uid() = author_id);
create policy "shared messages update by author" on public.shared_messages
  for update using (public.is_space_member(space_id) and auth.uid() = author_id)
  with check (public.is_space_member(space_id) and auth.uid() = author_id);
create policy "shared messages delete by author" on public.shared_messages
  for delete using (public.is_space_member(space_id) and auth.uid() = author_id);

-- ---------- 5. Grants so a fresh project works from migrations alone ----------
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on public.letters_visible, public.game_rounds_visible to authenticated;
grant execute on function public.join_space_by_code(text) to authenticated;
grant execute on function public.create_invitation(uuid) to authenticated;
grant execute on function public.guess_answer(uuid, text) to authenticated;
