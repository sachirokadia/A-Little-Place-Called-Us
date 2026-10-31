# A Little Place Called Us

A private, long-term shared home for two people: memories, letters, encouragement,
quiet support, appreciation, and future plans — in one calm place.

No streaks. No guilt reminders. No notifications, tracking, or analytics.
No automatic audio playback. Content is created by both partners and kept for revisiting.

## PostgreSQL backend (plain PostgreSQL, not Supabase-only)

The app now has a real PostgreSQL API in `server/` (Express + `pg`):
- `postgres/schema.sql` — users, spaces, space_members, and all seven content tables,
  with the two-member cap enforced by a trigger and the same length checks as before.
- `server/index.js` — JWT auth (bcrypt passwords), space create/join by invite code,
  whole-space read, generic item CRUD, uploads, and authenticated media serving.
  Privacy is enforced server-side: private journals are queried author-only, private
  drafts are author-only, scheduled-letter bodies are nulled for non-authors until
  `reveal_at`, and permanent delete is refused unless the row is already soft-deleted.
  Media tokens are short-lived (1h) and re-checked against space membership.
- Run it: `cd server && npm install && cp .env.example .env` (set `DATABASE_URL` and
  `JWT_SECRET`), then `npm start` (port 4000, schema applied on boot).
  Frontend: `VITE_API_URL=http://localhost:4000 npm run dev`.
  Verified against a real local PostgreSQL 16: register → create space → second
  member joins → third member rejected by the trigger → private journal hidden
  from the other member → scheduled letter body masked for the recipient →
  shared memory visible → unauthenticated read rejected (401).
- `docker-compose.yml` runs Postgres + API together (`docker compose up`).
  The Supabase migration in `supabase/` is kept as an alternative backend; when
  `VITE_API_URL` is set, the PostgreSQL API takes precedence over Supabase.

## Cozy pastel redesign (2026-10-31)

Pinterest / cottagecore / scrapbook art direction, without changing any data model
or room logic: vanilla cream `#F8F1E7`, sage `#E3EBDD`, dusty rose `#F4DFE3`,
buttercream `#F8EDC9`, powder blue `#DFEAF3`, soft lilac `#EAE1F1`, warm dark-brown
text `#51443D`. Fraunces serif headings, Nunito interface text, Caveat handwritten
notes. Home is a journal cover with an original cottage illustration, partner
avatars, pastel room tiles with handwritten annotations, polaroid memory cards
with washi tape and varied rotations, lined-paper letter reader, and a lilac
stitched private-journal style that is visually distinct from shared content.
Reduced-motion support is preserved; decoration never hides controls.

## What is built (and what is not yet live-tested)

**Built and verified in this repo (build passes, browser-tested in demo mode):**
- React 19 + Vite 6 + TypeScript, Tailwind CSS v4, Motion for React
- Original home screen: quiet starry sky + small glowing house, six rooms, persistent bottom nav + Home
- All six rooms with real create / edit / favourite / soft-delete / restore:
  1. Reminder Room — notes, "Surprise me" random note, favourites filter
  2. Memory Wall — photos, captions, dates, stories, author, search, favourites, sort by happened date / added date
  3. Letters — shared, private drafts, scheduled/sealed; search (sealed bodies are never searched)
  4. Quiet Room — supportive notes, breathing animation (inhale 4 / hold 4 / exhale 6, no audio), private journals, voice notes (record/upload, play only on press)
  5. Things I See in You — appreciation / achievement / encouragement, filtered by kind, favourites
  6. Our Future — bucket list / date ideas / plans, planned ↔ done, optional completion photo only after doing it
- Deleted room: deletion is **soft first** (restorable); permanent deletion needs a second, explicit confirmation
- Empty states, loading states, toasts for success/error, form validation, two-step delete confirmations
- Accessibility: labelled forms, keyboard-operable controls, visible focus rings, `prefers-reduced-motion` support (animations collapse to near-zero)
- PWA: `manifest.webmanifest`, app-shell service worker (`public/sw.js`), installable on mobile (see below)
- Supabase schema, RLS, and storage policies as a reviewed migration (see below)

**Not live-tested — requires your Supabase project (honest boundary):**
Live Supabase auth + cross-device sync has **not** been run end-to-end, because no Supabase
project/credentials were supplied for this build. The Supabase code paths (auth, space
create/join, table CRUD, signed storage URLs, the sealed-letter view) are written and
type-checked, but you must run the setup below and verify sign-in on two devices before
treating sync as proven. Until env vars are set, the app runs in **demo mode** (see below)
and says so in a banner on every screen.

## Demo mode (default, no credentials needed)

If `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are absent, the app runs on
localStorage with clearly-labelled **sample content** and two switchable profiles
("You" / "Partner"). Use the banner's Switch button to prove the privacy rules to
yourself: private drafts and private journals follow the viewer; a scheduled letter
shows only its envelope to the other viewer until its reveal time.

Demo limits, stated in the UI: content stays on that device only, photos/voice notes
are local data URLs, and clearing demo content (Settings) wipes it. Replace the samples
by deleting them and adding your own — nothing personal is baked in (profiles are
literally "You" and "Partner").

## Supabase setup (Phase 3)

1. Create a project at supabase.com. In **Authentication**, enable Email sign-in.
   (Email confirmation behaviour is your project setting; the sign-up form tells the user to check email if it is on.)
2. In the **SQL editor**, run `supabase/migrations/0001_init.sql` in full, then `supabase/migrations/0002_join_by_code.sql` (required: joining by invite code goes through the `join_space_by_code` RPC, because a non-member cannot SELECT a space row under RLS). It creates:
   - `spaces`, `space_members` (two-member cap enforced by a trigger, not just UI)
   - `reminders`, `memories`, `letters`, `journal_entries`, `appreciations`, `future_plans`, `voice_notes`
   - RLS on every table (see Privacy model below)
   - the `letters_visible` view (sealed-body masking)
   - the private `private-media` storage bucket + storage policies
3. Copy `.env.example` to `.env` and fill in the **anon public key only**:
   ```
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-public-key
   ```
   **Never** put the service-role key in frontend code, `.env` shipped to Vercel as a
   `VITE_` variable, or this repo. The app never asks for it.
4. Run `npm install && npm run dev`, sign up as person 1, **Create a space**, and share
   the 6-character invite code privately (message, in person — never publicly) with
   person 2, who signs up and **Joins** with it. If a third person tries, the database
   trigger rejects the join even if the UI were bypassed.
5. Verify on two devices: sign in as each person, add a memory as one, confirm it
   appears for the other; write a private journal as one, confirm it never appears
   for the other; write a scheduled letter, confirm the other sees only the envelope.

## Privacy model (enforced server-side, mirrored in the client)

| Content | Who can read it | Enforcement |
|---|---|---|
| Shared memories, reminders, appreciations, plans, voice notes | Both space members | RLS: `is_space_member(space_id)` |
| Shared letters | Both members | RLS + app filter |
| Private drafts (`letters.visibility = 'private_draft'`) | Author only | RLS: author-only read/update/delete; app never lists them for the other viewer |
| Private journals | Author only, always | RLS: `author_id = auth.uid()` on **all** operations; never part of a shared query |
| Scheduled letters before `reveal_at` | Author: full. Other member: title + envelope only | SQL view `letters_visible` masks `body` to NULL for non-authors until `reveal_at`; app also hides sealed bodies and never searches them |
| Photos / voice notes | Space members only | Private bucket, path namespaced `<space_id>/…`, storage RLS checks membership; app uses short-lived signed URLs, never public links |

Client-side filtering alone is never the privacy story here — it is the UX mirror of RLS/view rules.
If RLS were ever disabled, the app would still hide private items, but that would **not** be
considered secure; keep RLS on.

## Deletion model

- Delete from any room = **soft delete** (`deleted_at` set). The item disappears from its room and appears in **Settings → Deleted**, where it can be restored.
- **Delete permanently** in the Deleted room requires a second confirmation and cannot be undone (row + storage object are removed under the same RLS rules).
- There is no automatic purge timer in v1. If you want one later, add it as a scheduled Postgres function — do not silently hard-delete from the client.

## Install as an app (PWA)

- Android (Chrome): menu → **Add to Home screen**.
- iPhone (Safari): Share → **Add to Home Screen**.
- The service worker caches only the same-origin app shell; Supabase traffic is never cached by it, so signed URLs and fresh content are not served stale.

## Develop / deploy

```bash
npm install
npm run dev      # local dev
npm run build    # typecheck (tsc) + production build
npm run preview  # serve the production build locally
```

**Vercel:** import this repo, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as
environment variables (Production + Preview), deploy. Framework preset: Vite. No server
code, no secrets beyond the anon key, is required. Without the env vars, Vercel serves
demo mode — useful for a preview, not for a shared home.

## Project structure

```
index.html / public/            PWA manifest, icon, service worker
src/main.tsx, src/App.tsx       Routing (hash), nav, auth gate, space create/join, toasts
src/lib/types.ts                Shared types for every room
src/lib/utils.ts                Dates, invite codes, sealed-letter rule, deterministic stars
src/lib/supabase.ts             Anon client only; supabaseConfigured flag
src/lib/store.ts                PlaceStore: demo (localStorage) + Supabase adapters, privacy views
src/components/ui.tsx           Cards, forms, modals, confirm-delete, favourites, toasts
src/components/Home.tsx         Starry sky, glowing house, room cards, gentle home stats
src/rooms/RemindersMemories.tsx Reminder Room + Memory Wall
src/rooms/LettersQuiet.tsx      Letters (incl. sealing) + Quiet Room (breathing, journals, voice)
src/rooms/FutureAppreciations.tsx Things I See in You + Our Future + Deleted room
supabase/migrations/0001_init.sql  Schema, RLS, sealed view, storage policies, indexes
```

## Test notes (this build)

- `npm run build` passes (tsc + Vite).
- Headless-browser QA (mobile 390px): home renders (starry sky, house, six rooms, stats);
  creating a reminder appears immediately; switching viewer hides a private draft;
  a scheduled letter (reveal 2030) shows as "Scheduled · opens…" for its author and as
  a sealed envelope (body hidden) for the other viewer. Two bugs found and fixed in QA:
  memoised room lists not recomputing after in-place store mutations, and the viewer
  banner label going stale — both fixed via a store `version` counter.
- Not yet tested: live Supabase auth/sync (needs your project, see above), real-device
  PWA install, voice recording on iOS Safari (microphone permission behaviour varies),
  and screen-reader pass beyond labelled controls/focus rings. Run those before calling
  the synced version production-ready for the two of you.

## Live

- Site: https://a-little-place-called-us-sachirokadia23-3354s-projects.vercel.app
- Vercel project: `a-little-place-called-us` (prj_5KOVZf2rilHxazfLcT5Bx1cMfr3W), deployed from `main` via GitHub, SSO protection disabled for public access.
- Note: the live build has no `VITE_API_URL` set, so it runs in labelled demo mode (per-device localStorage) until a hosted PostgreSQL `DATABASE_URL` + API host are configured and the frontend is redeployed with `VITE_API_URL`. See "PostgreSQL backend" above for the shared-sync setup.
