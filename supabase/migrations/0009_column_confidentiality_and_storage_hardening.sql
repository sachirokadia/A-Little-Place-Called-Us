-- A Little Place Called Us — migration 0009: column confidentiality + storage hardening
-- Apply in the Supabase SQL editor after 0008. Idempotent.
--
-- WHY THIS MIGRATION EXISTS (Phase 10, proven by direct RLS testing):
--
-- Row-level security cannot hide a single column. The letters table's
-- SELECT policy correctly allows a member to see a scheduled letter's
-- ROW (so the partner sees the envelope), but that same row carries
-- the body — so a partner querying the raw letters table directly
-- received sealed bodies before reveal_at, even though the app reads
-- only through letters_visible (which masks them). The same pattern
-- applied to game_rounds: a member querying the raw table received
-- the answer before guessing, even though game_rounds_visible masks it.
-- Neither leak depended on the UI; both were database-level.
--
-- THE FIX (no table split, no app read/write path change):
--
-- 1. Column-level SELECT grants. Postgres privileges are additive,
--    so revoking SELECT on one column does NOT override a table-level
--    SELECT grant — the table-level grant must be revoked first, then
--    SELECT granted only on the non-sensitive columns. After this
--    migration, an authenticated user:
--      * CANNOT select letters.body or game_rounds.answer directly,
--        by SELECT, SELECT *, join, or any other direct query
--        (permission denied, fail-closed);
--      * CAN still select every other column of those tables, subject
--        to the existing RLS policies (member-only, private-draft
--        filtered, etc.);
--      * CAN still INSERT, UPDATE, and DELETE those tables, subject
--        to the existing RLS policies — UPDATE/DELETE do not require
--        SELECT on the column being written, only on columns used in
--        the WHERE clause (id, which remains granted). Verified:
--        author letter title/body updates, soft-delete/restore,
--        creator round inserts, and the guess_answer RPC all still work.
--    INSERT/UPDATE/DELETE grants from 0008 are left untouched.
--
-- 2. Views become security-definer with explicit filtering. The 0008
--    views used security_invoker, which would now fail (the invoker
--    no longer has SELECT on body/answer). A security-definer view
--    runs as its owner (postgres), which retains full column access,
--    so the view can still read body/answer and mask them with CASE.
--    Because a security-definer view bypasses the base table's RLS,
--    the view's own WHERE clause must enforce what RLS used to:
--      * letters_visible: only rows in a space the caller belongs to
--        (via the security-definer is_space_member helper), AND
--        private_draft rows only for their author. Scheduled bodies
--        are still masked by CASE until reveal_at passes.
--      * game_rounds_visible: only rows in a space the caller belongs
--        to. Answers are still masked by CASE until revealed or the
--        caller is the creator.
--    Verified: partner sees sealed NULL / shared visible / no private
--    draft; author sees own sealed + draft; creator sees own answer;
--    outsider gets 0 rows from both views, including via joins;
--    post-reveal partner sees the body through the view (raw-table
--    body remains permission-denied even after reveal — the view is
--    the only read path for bodies, by design).
--
-- 3. Storage hardening (see also the client/API checks in Phase 10).
--    Storage policies previously checked only membership and the
--    first path segment. They now also require:
--      * the second path segment to be 'photo' or 'voice' (the only
--        kinds the app uploads);
--      * the filename to end with a whitelisted extension (the same
--        list the client and API server enforce: jpg/jpeg/png/gif/
--        webp/avif for photos, mp3/wav/ogg/m4a/webm for audio).
--    This blocks .html (and any other unlisted extension) at the
--    database layer, even via direct Storage API calls — not just
--    in the UI. It does NOT prove file content: a file named
--    photo.png containing HTML still passes the extension check
--    (see the Phase 10 report for the residual risk and why the
--    served content-type + <img>/<audio> rendering keep that risk low).
--    DELETE is now owner-only (owner = auth.uid() plus space
--    membership), so a member cannot delete — and then replace — a
--    partner's media file whose path they know from a shared memory
--    row. SELECT stays member-only (shared media is meant to be
--    viewable by both members); there is still no UPDATE policy, so
--    upsert-overwrite remains blocked.
--
-- ORDERING WARNING: do NOT re-run 0001 or 0008 after this migration
-- without re-applying 0009 afterwards. 0001 recreates the views
-- without these definitions, and 0008's all-tables grant re-grants
-- table-level SELECT (including body/answer), undoing section 1.
-- If any earlier migration is ever re-run, re-apply all later
-- migrations in order (0007, 0008, 0009) immediately afterwards.
-- If 0009 itself is re-run, it is safe: views are dropped and
-- recreated, policies are dropped and recreated, and grants/
-- revokes are idempotent.

-- ---------- 1. letters: body is not directly selectable ----------
revoke select on public.letters from authenticated;
grant select (id, space_id, author_id, author_name, title, visibility, reveal_at, created_at, updated_at, deleted_at, is_favorite)
  on public.letters to authenticated;

-- ---------- 2. game_rounds: answer is not directly selectable ----------
revoke select on public.game_rounds from authenticated;
grant select (id, space_id, creator_id, question, guess, guessed_by, correct, revealed, created_at, updated_at)
  on public.game_rounds to authenticated;

-- ---------- 3. letters_visible: security-definer, explicit membership + draft filter ----------
drop view if exists public.letters_visible;
create view public.letters_visible as
  select
    id, space_id, author_id, author_name, title,
    case
      when visibility = 'scheduled' and author_id <> auth.uid() and reveal_at > now() then null
      else body
    end as body,
    visibility, reveal_at, created_at, updated_at, deleted_at, is_favorite
  from public.letters
  where public.is_space_member(space_id)
    and (visibility <> 'private_draft' or author_id = auth.uid());
grant select on public.letters_visible to authenticated;

-- ---------- 4. game_rounds_visible: security-definer, explicit membership filter ----------
drop view if exists public.game_rounds_visible;
create view public.game_rounds_visible as
  select
    id, space_id, creator_id, question,
    case when revealed or creator_id = auth.uid() then answer else null end as answer,
    guess, guessed_by, correct, revealed, created_at
  from public.game_rounds
  where public.is_space_member(space_id);
grant select on public.game_rounds_visible to authenticated;

-- ---------- 5. storage: extension + kind + owner hardening ----------
alter table storage.objects enable row level security;

drop policy if exists "members read own space media" on storage.objects;
create policy "members read own space media" on storage.objects for select using (
  bucket_id = 'private-media' and public.is_space_member((string_to_array(name, '/'))[1]::uuid)
);
drop policy if exists "members upload own space media" on storage.objects;
create policy "members upload own space media" on storage.objects for insert with check (
  bucket_id = 'private-media'
  and public.is_space_member((string_to_array(name, '/'))[1]::uuid)
  and (string_to_array(name, '/'))[2] in ('photo', 'voice')
  and name ~* '\.(jpg|jpeg|png|gif|webp|avif|mp3|wav|ogg|m4a|webm)$'
);
drop policy if exists "members delete own space media" on storage.objects;
create policy "members delete own space media" on storage.objects for delete using (
  bucket_id = 'private-media'
  and owner = auth.uid()
  and public.is_space_member((string_to_array(name, '/'))[1]::uuid)
);
-- No UPDATE policy on storage.objects, by design: upsert-overwrite stays blocked.
