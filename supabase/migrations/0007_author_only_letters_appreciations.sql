-- A Little Place Called Us — migration 0007: author-only changes for
-- personal-voice items (Phase 8 audit fix).
--
-- The UI only ever shows Edit to the author of a letter or an
-- appreciation, but the 0001 policies let any space member update or
-- delete a shared letter or appreciation through the API — the same gap
-- the plain-PostgreSQL API had in loadOwned. Journals were already
-- author-only throughout; reminders, memories, plans and voice notes
-- stay editable by either member, because they are shared artefacts.
-- Reads are unchanged: shared letters and appreciations remain visible
-- to both members; only changes are restricted to the author.
-- Apply in the Supabase SQL editor after 0006. Idempotent.

-- Letters: replace the member-wide update/delete policies with author-only ones.
drop policy if exists "letters update" on public.letters;
create policy "letters update" on public.letters for update using (
  public.is_space_member(space_id) and auth.uid() = author_id
) with check (
  public.is_space_member(space_id) and auth.uid() = author_id
);
drop policy if exists "letters delete" on public.letters;
create policy "letters delete" on public.letters for delete using (
  public.is_space_member(space_id) and auth.uid() = author_id
);

-- Appreciations: the generic 0001 loop gave every member update/delete.
-- Drop those and replace them with author-only policies.
drop policy if exists "space members update" on public.appreciations;
drop policy if exists "appreciations author update" on public.appreciations;
create policy "appreciations author update" on public.appreciations for update using (
  public.is_space_member(space_id) and auth.uid() = author_id
) with check (
  public.is_space_member(space_id) and auth.uid() = author_id
);
drop policy if exists "space members delete" on public.appreciations;
drop policy if exists "appreciations author delete" on public.appreciations;
create policy "appreciations author delete" on public.appreciations for delete using (
  public.is_space_member(space_id) and auth.uid() = author_id
);
