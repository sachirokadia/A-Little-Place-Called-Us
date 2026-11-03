# A Little Place Called Us — Supabase repair: order and validation
# Status: PREPARED LOCALLY ONLY. NOT applied to production. NOT deployed.
# Do not apply anything in this file until the backup gate below is met
# and Sachi gives explicit approval for the repair set, step by step.

## Decision: retain Supabase PostgreSQL. Do NOT migrate to standalone PostgreSQL.

Supabase already runs PostgreSQL. Migrating away would not fix a schema
problem, it would create a new platform problem. Verified from the code:

- Auth is Supabase Auth throughout: `supabase.auth.signUp`,
  `signInWithPassword`, `getSession`, `onAuthStateChange`, `getUser` in
  `src/App.tsx` and `src/lib/store.ts`. RLS policies use `auth.uid()`,
  and migration 0004 creates a trigger on `auth.users`. A standalone
  database has no `auth.users`, no `auth.uid()`, and no Supabase session.
  Rebuilding that means new password storage, sessions, JWT handling,
  and a user-ID remap for every table that references `auth.users`.
- Storage is Supabase Storage throughout: bucket `private-media`,
  `storage.from('private-media').upload` and `createSignedUrl(..., 3600)`
  in `src/lib/store.ts`. A standalone database has no signed-URL storage.
- Access control is Supabase RLS + PostgREST + the anon key in
  `src/lib/supabase.ts`. The service-role key is never used by the
  frontend. A standalone replacement would have to re-implement RLS
  enforcement in the Express server in `server/` (which is not deployed
  on Vercel today, uses its own `users` table, and would lose Supabase
  Auth users on cutover, requiring password resets for both partners).
- No cost, scale, or Supabase limit problem was shown. The Free plan
  pausing after inactivity wakes without data loss. That is not a
  reason to migrate.
- Shortest safe route: repair the Supabase schema in place, forward-only,
  preserving every existing row. No data move, no cutover, no new host.

## Live state used for this plan (from the read-only audit, not from history)

- Present, exactly migration 0001: spaces, space_members, memories,
  letters, journal_entries, appreciations, reminders, future_plans,
  voice_notes. RLS enabled on those 9 tables.
- Absent, as audited: profiles, invitations, shared_messages,
  game_sessions, game_progress, game_configs, game_rounds,
  board_games, board_game_moves, game_rounds_visible, plus
  memories.tags and future_plans.target_date.
- No `supabase_migrations.schema_migrations` table. That proves nothing
  about manual SQL Editor runs. Do not insert history rows, and do not
  treat history as authoritative. Judge by actual objects, using the
  pre-flight checks below.
- Unknown from the audit, and therefore checked first, not assumed:
  whether 0002 (join_space_by_code, first version) and 0003
  (enforce_two_members as SECURITY DEFINER + journals membership check)
  are live. Their object names are checked in pre-flight. The repair
  order below is safe either way, because 0004 replaces join_space_by_code
  and 0003 is re-applied idempotently (see below).
- Letters, as audited: update/delete policies are 0001 member-wide,
  UPDATE WITH CHECK is membership-only (not author-only).
  `letters_visible` is a plain owner-run view, no membership or
  private-draft filter, masking only scheduled bodies. Authenticated
  users have SELECT on `letters`, including `body`.
- Storage, as audited: bucket `private-media` is private, 0 objects
  found, memories 2 rows / 0 non-null `media_path`, voice_notes 0 rows.
  That is a point-in-time result, not proof files never existed.

## Required vs. included — verified against `src/`, not just the audit list

Required (a feature in the shipped app calls it, and fails without it):
- profiles — `store.ts` upsert + select for display names. Load degrades
  to email prefix / "Partner", but Settings display-name change throws.
- invitations + `create_invitation(uuid)` — `store.ts` createInvitation.
  The table itself is only reached through the RPC, but the RPC needs it.
- `join_space_by_code(text)` — `store.ts` joinSpace. 0004 replaces the
  0002 version with invitation-first logic; the permanent code still works.
- game_configs, game_progress, game_sessions — `games.ts` load/save.
  Load falls back to defaults, saves throw. game_sessions insert is
  best-effort in code, so it is the least blocking of the three.
- game_rounds + game_rounds_visible + `guess_answer` — `games.ts`
  Guess My Answer. Load falls back to empty, round creation throws.
- board_games + board_game_moves — `boardStore.ts` load/save/move.
- memories.tags, future_plans.target_date — `store.ts` toRow always
  sends both on save, and types.ts already declares both. Saving a new
  memory or plan is therefore likely to fail on the live schema, while
  loading old rows still works (tags default to [], target_date to null).
- `is_space_member(uuid)` with a safe search_path — used by almost
  every policy. The 0001 version has no search_path; see 0010 below.

Included by a required migration, but not blocking a UI feature today:
- shared_messages — created by 0004, but no `src/` code reads or writes
  it today. It is included because 0004 creates it with RLS, and 0008
  hardens its policies. Do not claim it blocks a feature. Creating it
  is harmless and keeps the repository migration set intact.
- Already present, not to be recreated: spaces, space_members, and all
  9 tables from 0001, plus their rows, IDs, timestamps, and foreign keys.

No application code change is needed for this repair. `src/lib/types.ts`
and `src/lib/store.ts` already send and read tags, target_date, profiles,
and game/board fields. Fixing the schema fixes the code path; changing
the code to work around missing columns would hide the schema gap.

## Repair order — forward-only, in this order, once, after the backup gate

Never apply 0001 again. Never apply 0002 as a separate step (0004
supersedes it). Never stop between 0008 and 0009. Never apply 0010
before 0008, because 0008 recreates `is_space_creator` without a
search_path and would undo 0010.

1. 0003_trigger_and_journal_hardening.sql
   Effect: enforce_two_members becomes SECURITY DEFINER with
   search_path = public, so the two-member cap counts correctly for
   direct inserts. Journals policy becomes author + member, so a
   non-member cannot pollute a space with journals.
   Does not change: any existing row, any existing membership, or any
   journal read (author-only read already held).
   Idempotent: CREATE OR REPLACE + DROP/CREATE policy. Safe even if
   0003 is already live.
2. 0004_profiles_invitations_games.sql
   Effect: creates profiles, invitations, shared_messages, game_sessions,
   game_progress, board_games, board_game_moves, plus handle_new_user,
   create_invitation, the invitation-aware join_space_by_code, and the
   one-space-per-user triggers. Existing users get a profile on next
   app load (upsert), not by backfill; the trigger only fires for new
   sign-ups. One-space triggers only fire on future inserts.
   Does not change: any existing row in the 9 old tables.
3. 0005_tags_and_target_dates.sql
   Effect: adds memories.tags (text[], NOT NULL, default '{}') and
   future_plans.target_date (date, nullable). Existing rows get
   '{}' / null automatically. No RLS change.
4. 0006_game_configs_and_rounds.sql
   Effect: creates game_configs and game_rounds, game_rounds_visible
   (plain view at this stage — do not stop here), and guess_answer.
   Adds moves / time_ms to game_progress.
   Does not change: any existing game data (there is none live, because
   the tables did not exist).
5. 0007_author_only_letters_appreciations.sql
   Effect: letters and appreciations update/delete become author-only
   (member + author in both USING and WITH CHECK). Reads unchanged.
   This closes the confirmed partner edit/delete gap.
6. 0008_security_invoker_views_and_policy_fixes.sql
   AND 0009_column_confidentiality_and_storage_hardening.sql, together,
   in the same maintenance window, with no gap and no other work between
   them. If 0008 succeeds and 0009 is not applied, stop and apply 0009
   immediately — do not leave the database in the 0008-only state.
   Effect of the pair: both views first become security_invoker (0008),
   then become security-definer with explicit membership + private-draft
   filters + CASE masking (0009); game_rounds gets a member-only SELECT
   policy; space_members insert becomes creator-only; shared_messages
   policies become author-required; authenticated grants are added
   (0008) and then table-level SELECT on letters/game_rounds is revoked
   and re-granted only on non-sensitive columns (0009: letters without
   body, game_rounds without answer); Storage policies gain photo/voice
   kind, whitelisted extensions, and owner-only DELETE, with no UPDATE
   policy. Direct raw reads of letters.body / game_rounds.answer then
   fail with permission denied, by design; app reads through the views
   still work.
   Does not change: any existing row, or any author's own write path
   (UPDATE/DELETE do not require SELECT on the written column).
7. 0010_search_path_hardening.sql (new file, created in this turn)
   Effect: is_space_member and is_space_creator are recreated with
   identical logic plus `SET search_path = public`. No policy, grant,
   table, column, or row is changed by this file. Grants are
   deliberately not added here (see the file's comment).
8. 0011_board_game_state_guard.sql (Phase 10 second pass, local only)
   Effect: a BEFORE INSERT/UPDATE trigger on board_games. Inserts must
   start at version 0 with object config/state. Updates must advance
   version by exactly 1, keep space_id/config/created_at unchanged,
   keep state an object, and must not touch a finished game. This
   closes version jumps, config swaps, space moves, and resurrection
   in Supabase mode, where there is no trusted server. It does NOT
   prove a single step with the correct next version was produced by
   a legal move — full engine validation exists only in API mode —
   so Supabase board scores remain not tamper-proof, and that
   residual is documented, not hidden. No policy, grant, table,
   column, or row is changed by this file, and the normal Supabase
   and API board update paths both pass it.
   Regression tests: supabase/regression-tests.sql (disposable DB
   only, never production) covers the checks in this file plus
   letters, journals, appreciations, storage, game progress, guessing,
   and outsider access, with PASS/FAIL notices per check.
9. 0012_security_remediation.sql (2026-11-03 security remediation, local only, UNAPPLIED)
   Effect: game_sessions become append-only (no update/delete policy);
   a trigger freezes author_id/space_id/created_at on all content
   tables; game_configs INSERT/UPDATE require updated_by = caller;
   game_progress scores are capped at the live config denominator
   (quiz/memory/chest/hero, client defaults as fallback) and progress
   must be an object; the board trigger gains engine-shape and
   coherence checks; the two-member/one-space triggers take advisory
   locks against concurrent joins. If any earlier migration is ever
   re-run, re-apply ALL later migrations in order — and after a
   0001 rerun specifically, re-apply 0003 + 0007 + 0008 + 0009 + 0010
   (the shorter 0007+0008+0009 list in older docs omits the 0003
   trigger fix and the 0010 search_path fix, both of which a 0001
   rerun also undoes). Never re-run 0004 after 0008 without
   re-applying 0008: 0004 recreates the old shared-messages policy
   alongside 0008's split policies, and permissive policies OR, so
   the hijack fix is silently undone by coexistence. Never re-run
   0006 after 0009 without re-applying 0008+0009: 0006 recreates the
   unfiltered game_rounds_visible view.

## Pre-flight checks — read-only, run before any repair step

Run these against production only after the backup gate, and record
the answers. They return catalog text and counts only, never letter
bodies, journal bodies, game answers, invitation codes, or file paths.

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' ORDER BY table_name;
```

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'memories' AND column_name = 'tags';
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'future_plans' AND column_name = 'target_date';
```

```sql
SELECT proname, prosecdef, proconfig FROM pg_proc
WHERE proname IN ('is_space_member', 'is_space_creator', 'enforce_two_members',
  'join_space_by_code', 'create_invitation', 'guess_answer')
ORDER BY proname;
```

```sql
SELECT policyname, cmd FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('letters', 'appreciations', 'journal_entries')
ORDER BY tablename, policyname;
```

Stop and investigate, do not apply, if: the 9 tables from 0001 are not
all present; a table that the repair set would create already exists
with different columns; or a policy name in the repair set already
exists with different logic that is not a DROP/CREATE in that file.
A mismatch among views, policies, table grants, and column grants is
also a stop condition — record the exact layer that disagrees.

## Post-apply validation — read-only, run after each repair step, not just at the end

- Row counts before and after must match for every pre-existing table
  (spaces, space_members, reminders, memories, letters, journal_entries,
  appreciations, future_plans, voice_notes), including soft-deleted
  rows. New tables start at 0 rows. New columns are '{}' / null on
  old rows, never a rewritten title, body, or timestamp.
- After step 5: letters/appreciations update/delete policies require
  author_id = auth.uid() in both USING and WITH CHECK.
- After steps 6–7: letters_visible and game_rounds_visible definitions
  contain an explicit membership filter (and, for letters, a
  private-draft author filter) and CASE masking; their reloptions do
  NOT contain security_invoker (0009 replaced the 0008 views, by design).
  Column grants for authenticated show letters SELECT without body and
  game_rounds SELECT without answer. Storage policies on storage.objects
  require photo/voice kind, whitelisted extensions, and owner-only DELETE.
- After step 7: pg_proc proconfig for is_space_member and
  is_space_creator contains search_path = public.
- Two-account test, test data only, never real private data: Test A
  and Test B share a test space; Test C is an outsider. Shared letter
  visible to B; private draft invisible to B (including in the loaded
  view rows, not just on screen); scheduled letter envelope-only to B
  until reveal_at; journal invisible to B; B editing A's shared letter
  fails after step 5; C sees no test space, letters, or files; a test
  photo uploaded by A is visible to B, not to C, and B deleting A's
  test photo fails after step 6–7. Delete all TEST rows/files after,
  and re-check real counts.

## Backup gate — the single remaining action before any repair step

Backup status today: NOT established. The Windows backup script
(`Backup-LittlePlace.ps1`, version 4 final revision, in the user's
backup folder) has been prepared and safety-reviewed, but it has NOT
been successfully executed or verified, and no restore has been tested.
No production change in this plan may start until that changes.

Single precise action required from Sachi, in this order:
1. Run `Backup-LittlePlace.ps1` from the backup folder on Windows,
   sign in in the browser if asked, type any database password only
   in that PowerShell window (never in chat), and report only the
   final DATABASE, STORAGE, and AUTH/STORAGE SCHEMA result lines and
   file sizes.
2. Then, with Muse's help, restore that backup into a disposable
   project and compare every row count to the pre-backup counts.
   Only a restore that matches counts as a verified backup.

Until step 2 passes, this repair set stays prepared locally only.
Production stays live and untouched, on the 0001 schema, with the
known gaps documented above. That is the safe fallback: keeping the
old live copy running is better than applying a repair without a
tested restore.

## Rollback

There is no undo button for policy or grant changes. Reverting a
policy is a forward fix, not a rollback, and data read while a loose
policy was live cannot be unread. The only reliable rollback is to
restore the verified backup into a replacement project and re-point
Vercel to it (env var names only: VITE_SUPABASE_URL,
VITE_SUPABASE_ANON_KEY, with VITE_API_URL absent). Do not delete the
live Supabase project as a first step, and do not change Vercel until
database verification and two-account tests pass on the repaired copy.
