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

## Phase 3 — authentication, database and shared content (2026-11-01)

The backends above were already real; Phase 3 audited them against the brief and
closed the gaps, rather than rebuilding them.

**What changed in Phase 3:**
- **Profiles:** Supabase gains a `profiles` table (migration 0004, created
  automatically on sign-up via `handle_new_user`, editable in Settings);
  plain PostgreSQL uses the `users` table as the profile (now with
  `avatar_path`). Partner names on Home and in member lists come from
  profiles, not from email prefixes.
- **Invitations:** both backends gain an `invitations` table — 7-day,
  single-use codes, created in Settings (API: `POST /api/invitations`;
  Supabase: `create_invitation` RPC). Joining accepts an invitation first
  (redeemed in the same transaction as the membership insert), then the
  space's permanent invite code. Invalid, expired and already-redeemed codes
  are rejected; creating an invitation for a full space is refused.
- **One space per user:** enforced by database triggers in both backends
  (and by explicit API checks), so a user cannot create or join a second
  space the app would never show them.
- **Schema for later phases (no UI yet):** `shared_messages`,
  `game_sessions`, `game_progress` (per user, per game), `board_games`
  (config + state + `version` for optimistic concurrency + current turn)
  and `board_game_moves` (audit trail). Their RLS (Supabase) is written now;
  the plain-PostgreSQL API exposes no collection for them yet, so there is
  no unauthorized-access path through them today.
- **Session handling:** API JWT expiry is 7 days (was 30); an expired token
  returns 401 with "That session has expired. Please sign in again." and the
  app signs the user out. Supabase sessions use `persistSession` +
  `autoRefreshToken`.
- **Insecure-storage fix:** signed-in modes used to write synced content back
  into the demo localStorage key on every edit, and start with demo samples.
  They now start empty and never write to that key; only demo mode uses it.
- **Sign-out limitation, stated honestly:** signing out clears the local
  token, but a stateless JWT remains valid until its 7-day expiry — there is
  no server revocation list in this version. Do not treat sign-out as
  instantly invalidating a token on another device.

**Phase 3 tests (local PostgreSQL 16 + API, 2026-11-01): all passed (31 checks
plus an expired-invitation check and a browser smoke test of Settings).**
Register/login validation, space create, join by permanent code and by
invitation, invitation reuse rejected, expired invitation rejected, third
member rejected, second-space creation rejected, shared memory visible to
the partner, private journal and private draft invisible to the partner and
unpatchable by them (403), scheduled letter body masked, profile rename
visible to the partner, persistence after re-login, cross-space content
invisible, no-token/garbage-token/expired-token all 401, space-less user
gets empty data (no samples). Supabase migration 0004 was also applied
cleanly to a stubbed local database (stub `auth`/`storage` schemas) and its
RLS was checked there: member sees shared content, not the partner's
journal; outsider sees no shared content; outsider cannot insert a journal
into another space. **That stub check is not a live Supabase test** — see
the external setup below.

## Phase 4 — all six shared rooms (2026-11-01)

The six rooms already had real CRUD; Phase 4 audited each against its brief
and closed the named gaps, without redesigning Phases 1–2:

- **Reminder Room:** create/edit/delete, favourites, "Surprise me" random
  note, gentle empty state. No reply is ever required.
- **Memory Wall:** polaroid layout, captions, dates, search, favourites,
  sort. Added **optional tags** (new `tags` TEXT[] column, migration 0005
  + `postgres/schema.sql`, searchable, shown as chips), **editing** of a
  memory's title/caption/story/date/tags, and **proportion-preserving
  images** (`object-contain`, no fixed aspect — a portrait photo is no
  longer cropped into a landscape box). Uploads are validated in the UI
  (images only, ≤ 25 MB) and by the server (type filter + 25 MB cap).
- **Letters:** shared letters, private drafts, scheduled/sealed letters
  with server-enforced reveal. Added **editing by the author** and an
  explicit visibility line in the reader ("Shared — both of you" /
  "Private draft — only you" / "Scheduled — opens …").
- **Quiet Room:** supportive notes, 4-4-6 breathing (opt-in, no audio),
  private journals (author-only, server-enforced). Added **journal
  editing**, and the breathing circle now stays truly still under
  `prefers-reduced-motion` (`motion-reduce:scale-100`).
- **Things I See in You:** appreciation/achievement/encouragement, both
  partners contributing, favourites, kind filters. Added **editing by the
  author** and **chronological browsing** (newest/oldest sort).
- **Our Future:** bucket list / date ideas / plans, planned ↔ done,
  completion photo only after doing it. Added **editing** and **optional
  target dates** (new `target_date` column, migration 0005), shown as
  "Target: …" and described as a hope, not a deadline.

**Edit rule, stated plainly:** shared artefacts (reminders, memories,
plans) may be edited by either member; personal-voice items (letters,
appreciations) may be edited only by their author; private items
(journals, private drafts) are author-only and server-enforced. Deletion
is soft first everywhere, restorable from the Deleted room, permanent only
after a second confirmation. All forms validate, show a saving state, and
report success or error by toast.

**Phase 4 tests:** on a fresh local PostgreSQL 16, every create/read/
update/delete workflow was run for both accounts in all six rooms
(tags, target dates, sealed masking, journal privacy, restore and purge
included), plus validation rejections and sync after re-login — all
passed after one fix found by the test itself (see below). The browser
was then driven through every new edit flow in demo mode at 1200px and
390px, with no page errors and no mobile overflow.

**Bug found and fixed by the Phase 4 test:** a plan target date of
2027-06-01 came back as 2027-05-31. Cause: `toDate()` used
`toISOString()` (UTC) on a DATE value that pg returns as midnight in the
server's local timezone, shifting it back a day east of UTC. The same bug
affected memory dates. Fixed in `server/index.js` by formatting the
local calendar components for DATE columns.

## Phase 5 — the Boyfriend Arcade (2026-11-01)

The arcade hub (Game Arcade in the bottom nav) holds five games, all in
the Phase 1 pastel scrapbook language, with no sound at all. Adding a
game later means adding one entry to the `GAMES` registry in
`src/rooms/Arcade.tsx` and one component — the config, progress and
rounds tables already exist for it. The board game and the superhero
adventure were explicitly **not** begun in this phase.

- **Memory Match:** configurable deck (4/6/8 pairs, pattern cards or
  shared photographs from the Memory Wall — it falls back to patterns
  with a note if there are not enough photos yet). Tracks moves,
  elapsed time and completion; cards are buttons, so keyboard and touch
  both work; restart and replay controls are always present.
- **How Well Do You Know Us?:** configurable multiple-choice questions
  (either partner may add, edit or remove them). One question at a
  time, gentle feedback after each answer ("Not quite — the answer was
  … No worries at all"), final score, no shaming.
- **Catch the Hearts:** 30-second arcade game with a start screen,
  pause, resume and restart. Hearts are buttons that sit still while
  they are up (an earlier floating animation made them hard to tap, so
  it was removed) — tap, or Tab + Enter, to catch one. Reduced-motion
  users get the same game with no animation at all.
- **Guess My Answer:** one partner sets a question and a private
  answer; the other gets exactly one guess, then the answer is revealed
  whether the guess was right or not. The answer is masked server-side
  (API) or by a masked view + RPC (Supabase) — the guesser cannot see
  it before guessing, and cannot guess twice or guess their own
  question. In demo mode the same masking is applied on profile switch.
- **Unlock the Chest:** configurable riddles with hints, solved in
  order, with a final message and optionally a shared photograph or
  memory as the reward. Wrong guesses carry no penalty.

**Personalization and persistence:** quiz questions, chest riddles,
final message/reward, Memory Match settings and guess rounds are all
stored in the database (API: `game_configs` + `game_rounds` tables in
`postgres/schema.sql`; Supabase: migration 0006) or in demo localStorage.
Completed games are recorded in `game_progress` (plus a finished
`game_sessions` row). Scores are validated server-side: a quiz score
cannot exceed the stored question count, a Memory Match win needs at
least as many moves as there are pairs, and negative scores, moves or
times are rejected.

**Phase 5 tests:** every game was driven in the browser from start to
completion at 1200px and 390px — Memory Match to all pairs found, quiz
to a final score plus an add/remove question cycle, Catch the Hearts
through start, catch, pause, resume and the full 30-second finish,
Guess My Answer through create (creator sees the answer), profile
switch (partner does not), one wrong guess, reveal, and no second
guess, and the chest through both default riddles to the final message.
No page errors, no mobile overflow.

## Phase 6 — the personalized superhero adventure (2026-11-01)

"A Hero's City" is a sixth arcade entry (the Phase 5 registry, one entry
+ one component, in `src/rooms/HeroAdventure.tsx`). It is an original
adventure, not an official game: an original red-and-blue hero drawn
from simple shapes with no web pattern and no logo, three original
districts (Rooftop Dawn, Lantern Alley, Starlight Bridge) drawn as
comic panels with rooftops, city silhouettes and motion lines, and a
"zip" to a glowing anchor as its web-inspired traversal — an original
effect, not a copied swing mechanic. No official maps, models, assets,
logos, dialogue or music are used, and no large game engine was
introduced: one `<canvas>` with a small requestAnimationFrame loop and
plain AABB collision.

- **Structure:** intro screen with a start button, a district map
  (level select, with done markers), three short side-scrolling levels,
  4 collectible memory tokens per level, clue signs, checkpoint flags,
  a FINISH flag per level, a level-complete screen and an all-districts
  completion screen with replay and back-to-arcade options.
- **Gameplay:** run (← → / A D), jump (Space / ↑ / W), zip (E, or the
  Zip button, when near a glowing anchor), pause (P / Pause button),
  restart level, and touch buttons for all four actions on a phone.
  Falling returns you to the last checkpoint with tokens kept — there
  is no death penalty and no difficult gate.
- **Personalization:** either partner may edit mission titles, clues,
  token goals, reward messages and the final message, and may attach a
  shared photo/memory, letter or appreciation note as a level reward.
  Rewards unlock on reaching a level's flag, regardless of tokens.
  With no personal content added, the starter missions, starter reward
  messages and starter final message keep the game fully playable.
- **The final message is never gated:** "Read the final message now"
  is on the intro and on the map, readable any time without finishing
  a level.
- **Persistence:** no new schema — the Phase 5 `game_configs` table
  holds the hero config (key `hero`) and `game_progress` holds
  completed districts per user (score = districts completed, details
  carry `levelsCompleted` and tokens), via the same generic API
  endpoints and Supabase tables as the other games.

**Phase 6 tests:** browser start-to-completion for all three districts
at 1200px (walk + periodic jump, tokens, checkpoint, FINISH flag,
reward, map progress) and touch play at 390px (a real touch pointer
event on the Right button, tokens collected, no mobile overflow), plus
mission-title editing, plus 5 API checks on a fresh local PostgreSQL 16
(hero config save/read, hero progress save/read with
`levelsCompleted`). Two bugs found by the tests and fixed: tokens
initially sat only on high platforms, so a ground-level player could
finish with none (two tokens per level now sit on the ground path),
and the finish handler read a stale token count from its render
closure (it now reads the live game state). No page errors.

## Phase 7 — "Our Little World", the custom relationship board game (2026-11-01)

A complete, playable, original property-trading board game in the
arcade, inspired by the general mechanics of classic board games and
customized around the relationship. No Monopoly branding, logo, board
artwork, card text or branded assets are used anywhere: currency is
Memory Coins, event cards are Plot Twists and Little Surprises,
properties are Places and Moments, and every name, rule and card is
written for this game.

- **Board:** 20 ordered spaces around a square — Home Base (start,
  collect on passing), Places and Moments with prices, rents and
  categories (Everyday, Weekend, Dates, Dreams, Milestones), Plot Twist
  and Little Surprise spaces, two tax spaces, a Picnic Spot (rest),
  and a Time-Out Corner (miss a turn). Owning every place in a
  category doubles its rent.
- **Gameplay:** two local players on one device, taking turns — dice
  rolling, movement, purchase or pass, rent, event cards, trades
  (propose before rolling, partner accepts or declines, a trade does
  not use up the turn), bankruptcy, and an end-early house rule
  (winner by Memory Coins, equal coins is a draw). The full rules are
  written in `src/lib/boardGame.ts` as `BOARD_RULES` and shown in the
  game before play starts.
- **Engine, separate from the visuals:** `src/lib/boardGame.ts` is
  pure and deterministic — no clock, network or DOM, dice supplied by
  the caller, every function returning a new state or an error — so
  movement, payments, purchasing, event resolution, trades, turn
  transitions and bankruptcy are all unit-testable on their own.
- **Customization:** edit property names, descriptions, prices,
  categories and tax amounts, add personalized event cards (coins,
  move, skip, Time-Out, pay/collect from partner), associate a place
  with a shared photo/memory, customize player names and tokens, and
  edit starting coins and the Home Base bonus. The shared board
  configuration lives in `game_configs` (key `board`), so either
  partner may edit it and both read the same config; a game in
  progress keeps its own snapshot in `board_games.config`, so later
  edits never change a game already being played.
- **Persistence and validation:** a game is saved as one
  `board_games` row (config snapshot + state + version) with an audit
  trail in `board_game_moves`. In API mode the client sends only an
  ACTION plus the version it last saw; the server loads the stored
  game, re-runs the same engine file the frontend uses (imported with
  Node's type stripping, so there is no second copy to drift), and
  writes the new state only if the version still matches — a stale
  version is a 409, and a forged balance or ownership list is ignored
  because the server never accepts one. In Supabase mode the client
  runs the same engine and updates only where the version matches
  (a stale update writes nothing); RLS limits rows to space members,
  but that mode does not re-validate moves server-side, and the API
  mode is the validated path.
- **Online multiplayer is NOT part of this release.** This is a local
  two-player game on one device. Real-time synchronization and
  conflict handling are not implemented or tested here, and no claim
  is made for them. If a future version adds them, the version field
  on `board_games` is the intended optimistic-concurrency hook, and
  it will need its own tests before it is claimed.

**Phase 7 tests:** 31 engine unit tests with fixed dice (movement,
passing Home Base, purchase, double-purchase rejection, rent,
category bonus, every special space, skip turns, bankruptcy, trade
accept/decline/insufficient funds, invalid dice and out-of-phase
actions, end-early win and draw, card move effects) — all passed;
browser play at 1200px (rules before play, config edit saved, game
started, trade offered and accepted, game completed, save restored
after a reload at the same turn, partner profile seeing the shared
renamed place) and at 390px (no overflow, no page errors); plus API
checks on a fresh local PostgreSQL 16 (game creation, invalid buy,
invalid dice, stale-version 409, roll/buy/rent applied by the server,
forged client state ignored, GET returns the latest version,
end-early finishes the game, no actions after finish).

## Phase 8 — final QA and release audit (2026-11-01)

An independent-style audit of the local working tree (Phases 1–7 plus
the fixes below), not a redesign: defects were documented first, then
fixed without changing approved design or working features. The live
site was NOT re-verified in this audit and the working tree has NOT
been pushed or deployed — see "Manual configuration still required"
below, and verify the live mode after deploying.

**Issues found and fixed in this audit:**
1. **Critical (server enforcement): a partner could edit or delete the
   other partner's shared letter or appreciation through the API,**
   even though the UI only shows Edit to the author. Proven before the
   fix with a partner PATCH writing "HACKED LETTER" / "HACKED
   APPRECIATION". Fixed in `server/index.js` `loadOwned` (letters and
   appreciations are now author-only for PATCH, restore and DELETE,
   like journals and private drafts; reminders, memories, plans and
   voice notes stay editable by either member, as designed) and in a
   new Supabase migration `0007_author_only_letters_appreciations.sql`
   (same tightening for Supabase RLS, which had the same member-wide
   update/delete policies). Re-tested: both partner edits now return
   403, and the full security suite passes 28/28.
2. **Upload validation: a `.html` file sent with an image mimetype**
   used to pass the upload filter and could then be served with an
   HTML content type. Fixed: the file extension must now also be an
   allowed image/audio extension. Re-tested: spoofed `.html` rejected
   (400), legit `.png` accepted (200) and fetchable by its owner via
   a media token (200).
3. **Reduced motion: Motion's JS fade/slide ignored the CSS
   reduced-motion block.** Fixed with `useReducedMotion` in the shared
   `Page` template and on Home, skipping the entrance animation when
   reduced motion is preferred. No visual change otherwise.
4. **Dead code:** the old SVG `Cottage` illustration (replaced by the
   photograph in Phase 1, rendered nowhere) and the unused `HandNote`
   component were removed; the Settings "Clear demo content" button
   now uses the existing `clearDemoData` helper instead of duplicating
   it inline. Build still passes.
5. **Stale copy:** the Home Arcade card still said games were
   "arriving in a later phase" when seven games exist. Fixed to say
   seven games, from Memory Match to Our Little World.

**Tests actually executed in this audit (no results fabricated):**
- Build: `npm run build` (tsc + Vite) passes. There is no lint script
  in `package.json`, so linting is not an available check here;
  `npm audit` could not run — the sandbox registry policy blocks its
  endpoint (403 `policy_denied`), so dependency audit status is
  **unknown**, not clean, and is listed under limitations.
- Visual regression at 1200px and 390px: all 10 routes render with
  headings, no horizontal overflow, no page errors; all 7 arcade games
  open. Home vs the supplied reference: the reference is a
  1200×630 night-cottage **photograph**, not a UI screenshot, so no
  pixel-perfect UI claim is made (as in Phase 1). The home hero is
  that same photograph (converted to JPEG, same 1200×630), shown at
  16/10 with `object-cover` at 50% 42%, with the exact brand copy on
  the paper card below; hotspots are paper chips on the photo.
- Functional: hash navigation, refresh (hash preserved on all 10
  routes), browser back/forward, reminder create/favourite/soft-delete
  (card-scoped re-test after an unscoped selector miss) /restore from
  Deleted, keyboard Tab focus (visible 2px outline) + Enter activation,
  Settings inputs all labelled, Deleted empty state, reduced-motion
  page load.
- Security (fresh local PostgreSQL 16, API mode): 28 checks — register,
  login, `/api/auth/me`, wrong-password 401, short-password 400,
  unauthenticated and invalid-token 401s, two-account partner flow,
  outsider cross-space isolation, private journal isolation (read and
  update), sealed-letter masking (future) and reveal (past), private
  draft hidden, third-member and invalid-invite rejection, invitation
  creation/join/reuse rejection/full-space refusal, oversized input
  rejection, non-image upload rejection, media without/invalid token
  403, board-game server validation (from Phase 7).
- Accessibility: text contrast computed from the actual tokens —
  cocoa on cream 8.35, cocoa-soft on cream 5.52, cocoa-soft on paper
  6.09, plum focus on cream 6.03 (all WCAG AA, most AAA); focus-visible
  outline global; form fields use wrapping `<label>`s; touch targets
  are 44px buttons (home hotspots are 44px desktop, 38px mobile, but
  the combined hotspot button including its label is larger — noted,
  not changed, because enlarging it would worsen mobile hotspot
  crowding); no overflow at 390px on any route.
- Engineering: no secrets in source (grep clean), no
  `dangerouslySetInnerHTML`, no `eval`/`new Function`, media tokens
  1h, auth tokens 7d (stateless, no revocation list — a known limit),
  bcrypt password hashing, uploads namespaced by space with random
  UUID filenames, Supabase migrations 0001–0007 ordered and
  idempotent (`if not exists` / `drop policy if exists`).

**Known limitations (not called production-ready if any were critical
— none of the remaining items is a critical access-control or
data-loss issue):**
- `npm audit` could not run (registry policy block); dependency
  vulnerabilities are unverified, not proven absent.
- Auth tokens are stateless JWTs with no revocation list: sign-out
  clears the local token but the token stays valid until its 7-day
  expiry.
- Supabase mode RLS tightening (migration 0007) and migrations
  0004–0007 have not been run on the real Supabase project — that is
  Sachi's manual step, and the live Supabase project has not been
  re-tested in this audit.
- Live site mode and the live Supabase project were not re-verified
  here; the audit covered the local build. Voice recording on iOS
  Safari and a full screen-reader pass remain untested, as in earlier
  notes.
- CORS defaults to reflecting the caller when `CORS_ORIGIN` is unset,
  and `PG_SSL=true` uses `rejectUnauthorized: false` — both must be
  set properly for a production API host (see below).

**Manual configuration still required:**
1. Choose ONE canonical live backend (API or Supabase, not both).
2. If Supabase: run migrations 0001–0007 in order in the SQL editor
   (0004–0007 are the ones not yet run on the real project), then
   verify on two real devices with real accounts.
3. If API: host `server/` with `DATABASE_URL`, `JWT_SECRET` (long
   random, never committed), `CORS_ORIGIN` set to the exact frontend
   origin, and `PG_SSL` only with a proper CA — then set
   `VITE_API_URL` on the frontend host and redeploy.
4. Push the working tree (Phases 1–8, currently local and unpushed)
   and deploy; then verify the live site's mode banner, sign in as
   both partners, and confirm a shared memory syncs and a private
   journal stays hidden.

## Phase 9 — Supabase production readiness & security verification (2026-11-01)

A security and production-readiness phase, NOT a redesign or feature
phase. Nothing was pushed, committed, merged, deployed, or changed on
the real Supabase project; no production data was touched. The working
tree from Phases 1–8 was preserved first (filesystem backup at
`~/workspace/phase9-backup/working-tree-phase9.tar`, plus a git-status
record; no `reset`, `clean`, or history change). All Phase 9 changes
are local and unpushed, like Phases 1–8.

**Repository state (verified before any edit):** branch `main`, HEAD
`1bc0177`, no staged changes, 13 modified files + 30 untracked files
from Phases 1–8 (including migrations 0004–0007 and the Phase 8
fixes), all treated as intentional. No push or deployment occurred in
this phase, and none is claimed.

**Selected backend architecture (evidence, not assumption):**
The frontend uses Supabase directly when configured — there is no
server in the Supabase path. Backend selection in `src/lib/store.ts`
is: API mode if `VITE_API_URL` is set, else Supabase mode if both
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set, else demo
mode (localStorage). The custom API (`server/`) remains a fully
active alternative backend with its own users table, JWTs, and
PostgreSQL database — it is NOT removed by choosing Supabase, and if
`VITE_API_URL` is set to any value it silently wins over Supabase.
Every content, game, board, and upload path has both a Supabase and
an API implementation (store, games, boardStore, uploadMedia), so the
Supabase implementation supports all required functionality; the API
is a second authorization model only when it is actually deployed and
configured, which the Supabase production deployment must NOT do.
Local development = dev server with demo mode (or either backend if
env vars are set); demo mode = no env vars, labelled banner, device
only; production = production build with Supabase vars only;
Vercel preview = production build, so it follows the production
rules, not demo rules.

**Migration-by-migration review (0001–0008, tested in an isolated
local PostgreSQL 16 database with a mock `auth.uid()` — the real
Supabase project was never touched):**
- 0001: schema + RLS + sealed view + storage bucket/policies. Tables
  use `if not exists`, so data survives a rerun, but policies are
  recreated member-wide — see the ordering warning below.
- 0002: `join_space_by_code` RPC (security definer, two-member cap,
  idempotent for existing members). Verified: valid invitation joins,
  expired invitation rejected, reused invitation rejected, full-space
  join rejected, non-member invitation creation rejected,
  full-space invitation creation rejected.
- 0003: security-definer two-member trigger + journals require
  membership as well as authorship. Verified by direct-insert tests.
- 0004: profiles (sign-up trigger), invitations (7-day, single-use),
  shared_messages/game/board schema, one-space-per-user triggers.
  Verified: profile trigger creates a row from the email prefix.
- 0005: tags + target dates, optional columns, no RLS change needed.
- 0006: game_configs/rounds, masked view, `guess_answer` RPC (one
  guess, no self-guess, reveals after guessing). Verified: first
  guess reveals, second guess errors "already been guessed".
- 0007: author-only letters/appreciations (Phase 8 fix). Policy
  names match 0001 exactly, so the drops work. Verified: partner
  letter update and appreciation delete both denied (0 rows).
  **Idempotency fix in this phase:** 0007 originally errored on
  rerun ("appreciations author update/delete already exists") because
  it did not drop its own new policies first; two
  `drop policy if exists` lines were added (safe: 0007 has not been
  applied to the real project yet). 0007 now reruns cleanly.
- 0008 (new in this phase): see "Fixes" below. Reruns cleanly.
- **Ordering warning (proven by test): re-running 0001 after 0007
  regresses the Phase 8 fix** — a partner update succeeded
  ("HACKED AFTER 0001 RERUN") after a 0001 rerun, and protection was
  restored only by re-applying 0007. Never re-run 0001 on a live
  database after 0007/0008; if it is ever re-run, re-apply 0007 and
  0008 immediately afterwards, in order. Rerunning 0002–0007 (and
  0008) preserves all data (row counts unchanged in testing).
- **Missing grants (fixed in 0008):** migrations 0001–0007 never
  granted table/view/function permissions to `authenticated`, so a
  fresh project following only the migration files would fail with
  "permission denied" even with correct RLS. 0008 adds those grants;
  grants alone grant no access beyond RLS, because every table still
  has its RLS policies.

**Supabase RLS and resource-access matrix (tested, not just read):**
All checks below were run as the `authenticated` role with distinct
users A (owner), B (partner), C (outsider), D (fourth account) in
the isolated database. "Denied" means 0 rows or an RLS error, not a
hidden button. Before 0008, three checks FAILED; after 0008, all pass.
- profiles: SELECT by self or by a member of a shared space; INSERT/
  UPDATE by owner only. Outsider reads denied.
- spaces: SELECT by members only; INSERT by creator only; no
  update/delete policy (spaces are not renamed/deleted in v1).
- space_members: SELECT by members only. Direct INSERT was
  member-joinable without a code before 0008 (see below); after
  0008, direct INSERT only for the space creator (createSpace flow
  verified working); joining by code goes through the security-
  definer RPC only. No update/delete policy.
- invitations: SELECT by members or creator; INSERT by members as
  creator; no update/delete policy (redemption only via RPC).
- reminders, memories, future_plans, voice_notes: SELECT/INSERT/
  UPDATE/DELETE by either member (shared artefacts, as designed);
  INSERT requires author = caller. Partner update of a shared
  reminder verified allowed.
- letters: SELECT by members, except private_draft is author-only
  (raw table) and scheduled bodies are masked in the view until
  reveal_at. INSERT by author only. UPDATE/DELETE by author only
  (0007). Partner letter update denied; partner appreciation delete
  denied.
- private letter drafts: author-only on the raw table; after 0008
  they are also absent from the partner's view results (before 0008
  the view leaked them — see below).
- scheduled letters: view masks body for non-authors until reveal_at
  (verified NULL before, visible after); raw-table SELECT still
  returns the sealed body to a member — that is why the app must
  never fall back to the raw table (fallback removed in this phase).
- private journals: author-only on every operation, including
  membership. Partner SELECT returns 0 rows; forged journal INSERT
  (author = partner's counterpart) denied by RLS.
- appreciations: SELECT by members; UPDATE/DELETE by author only
  (0007). Shared-artefact rule does NOT apply here, by design.
- future plans, voice notes: as shared artefacts above.
- game sessions: member SELECT, INSERT by starter only.
  game_progress: member SELECT, writable by owner only.
  game_configs: member-wide (shared config, by design).
  game_rounds: INSERT by creator-member only; SELECT by members
  only (added in 0008); reads go through the masked view (answer
  NULL for non-creators until revealed, visible to creator and
  after reveal — both verified).
  board_games: member-wide read/write (local two-player game, both
  players share a device); Supabase mode does NOT re-validate moves
  server-side, unlike API mode — a member client could write
  arbitrary board state. Outsiders cannot. Documented limitation.
  board_game_moves: SELECT by members of that game; INSERT by
  author-member only; no update/delete (append-only audit).
- uploaded photos/audio: see Storage below.
- service role: never used by the browser; no service-role key in
  any frontend code or `VITE_` variable. The only trusted-backend
  operations are security-definer functions/RPCs, each of which
  checks `auth.uid()` and membership internally.

**Critical issues found and fixed in this phase:**
1. **Views bypassed RLS (CRITICAL).** `letters_visible` and
   `game_rounds_visible` were plain views, so they ran as the view
   owner (postgres) and ignored RLS. Proven in testing: an outsider
   querying `letters_visible` with another space's id got 3 rows,
   including a shared letter body and a private draft body; a
   partner's view results included the private draft; an outsider
   got another space's game-round question. The app reads letters
   through this view, so this was a list-query leak, not just a
   direct-query one (the UI filtered private drafts a second time,
   but the body was already in the browser). Fixed in 0008 by
   recreating both views `WITH (security_invoker = true)` (Postgres
   15+) plus a member-only select policy on `game_rounds` so the
   view still works for members. Re-tested: outsider view rows 0
   for both views; partner view has no private draft; sealed body
   still NULL before reveal; creator still sees their own round
   answer.
2. **Direct join without a code (MEDIUM).** Any authenticated user
   who knew a space UUID could insert themselves into `space_members`
   with no invite code, as long as the space was not full (proven:
   a fourth account joined a one-member space directly). UUIDs are
   128-bit random and never shown to non-members, so this needed a
   leak to exploit, but the policy must not rely on that. Fixed in
   0008: direct inserts now require the caller to be the space
   creator, via a security-definer `is_space_creator` helper (a plain
   EXISTS on `spaces` would have broken createSpace, because the
   creator is not yet a member when inserting their own membership
   — that exact break was caught in testing and fixed with the
   helper). Join-by-code via RPC is unchanged and verified.
3. **Shared-messages update hijack (LATENT, no UI writes yet).**
   The "for all" policy required author only in the WITH CHECK, so
   a member could overwrite another's message and set author_id to
   themselves. Fixed in 0008 with split policies requiring author
   in both using and with-check for update/delete. Verified: the
   hijack update now leaves the original body and author intact.
4. **Letters fallback to the raw table (MEDIUM).** If the view
   query errored, the app fell back to reading the raw `letters`
   table, whose SELECT policy returns sealed bodies to members.
   Fixed in `src/lib/store.ts`: no fallback; a view error now
   fails loading loudly instead of silently leaking sealed bodies.
5. **Upload type not enforced in Supabase mode (MEDIUM).**
   Storage policies check membership and path, not file type or
   extension. Proven: a member could upload an `.html` file to
   their own space's bucket path. Fixed in `src/lib/store.ts`
   `uploadMedia`: photo uploads now require an image MIME type, a
   whitelisted extension (jpg/jpeg/png/gif/webp/avif), and ≤25 MB;
   voice uploads require an audio MIME type, a whitelisted
   extension (mp3/wav/ogg/m4a/webm), and ≤25 MB, in front of every
   backend (the API server already validated server-side). Residual
   limit: a client calling Supabase Storage directly can still
   bypass this client check — Supabase storage policies alone
   cannot prove file content, so a trusted server (or Edge
   Function) would be needed for full enforcement. Signed URLs
   remain 1-hour bearer tokens (see Storage).

**Storage security findings:**
- Bucket `private-media` is created private (`public = false`) in
  0001. Policies: SELECT/INSERT/DELETE by members of the space in
  the first path segment (`<space_id>/<kind>/<uuid>.<ext>`); no
  UPDATE policy (uploads use `upsert: false`). Verified with RLS
  enabled: own-space upload allowed, other-space upload denied,
  outsider SELECT returns 0 rows. (An early test run without RLS
  enabled on the mock storage table wrongly allowed everything —
  that was a harness gap, corrected by enabling RLS, as in real
  Supabase where storage RLS is on by default.)
- Object paths cannot reach another space's files through the
  policies (first-segment membership check); a non-UUID first
  segment fails the UUID cast and is denied (error, not access).
  `../` in an object key is literal, not a traversal, in object
  storage.
- Signed URLs are generated per media path on load, 1 hour expiry,
  and cannot be revoked before expiry — anyone holding a signed
  URL can read that one file for up to an hour, even after leaving
  the app. That is the documented exposure; it does not grant
  access to other files or to the space. Do not share signed URLs
  outside the space.
- No file-type, size, or content check exists in storage policies;
  see the upload fix and residual limit above. The API server's
  upload filter (extension + MIME + 25 MB, Phase 8) does not apply
  to Supabase-mode uploads.

**Authentication and environment configuration findings:**
- Supabase Auth: email/password via `supabase-js` (`persistSession`,
  `autoRefreshToken`, `detectSessionInUrl`). Sign-in errors are
  Supabase's generic messages; sign-up shows Supabase's message
  (enumeration behaviour depends on the live project's Auth
  settings, which were not inspected or changed — see manual
  checks). Expired sessions return to the sign-in screen; revoked
  sessions fail `getUser()` and load empty, never showing another
  user's data. No password-reset UI exists in the app (Supabase
  `resetPasswordForEmail` is never called) — that is a functional
  gap for production support, not a security hole, and adding it
  is out of this phase's scope.
- Sign-out hygiene (fixed): Supabase sign-out previously did not
  reload, leaving the previous space's data in memory until the
  next load (the sign-in screen hid it, but memory was not
  cleared). It now reloads, matching the API sign-out.
- Environment variables (frontend, no secret values shown): only
  `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
  exist in browser code. No service-role key, `DATABASE_URL`, or
  `JWT_SECRET` is referenced by any frontend file (grep-verified).
  The anon key is public by design; all real enforcement is RLS.
- **Production misconfiguration gate (new):** a production build
  with neither backend configured previously fell through to demo
  mode, which looks like a working shared home while saving only
  to the device. It now shows a clear "This deployment is not set
  up yet" screen and saves nothing. Local development still allows
  demo mode; a correctly configured production build never sees
  this screen. Verified: production build with no env vars shows
  the gate (no demo home, no demo banner, no page errors);
  development server still shows the demo home and banner.
- **HTTPS gate (new):** production builds now treat a non-HTTPS
  backend URL as unconfigured (for both Supabase and API), so a
  session/Bearer token can never be sent over http:// in
  production. Development still allows http://localhost.
- Backend-selection risk (documented, not code-changed beyond the
  gates): if `VITE_API_URL` is set at all, API mode wins silently
  over Supabase. The production deployment must have
  `VITE_API_URL` ABSENT (see checklist). Build-time env values are
  baked into the bundle at build time; changing Vercel env vars
  requires a redeploy to take effect.

**Cross-origin, network, and deployment security:**
- Supabase production: the browser talks directly to Supabase
  (PostgREST, Auth, Storage) over HTTPS. CORS on the custom API
  does NOT protect Supabase access — RLS is the protection, which
  is why the view and policy fixes above matter. No cookies are
  used (tokens live in localStorage, as documented in the API
  code's note on why a static SPA cannot use httpOnly cookies
  without a server session layer); XSS risk is low (no
  `dangerouslySetInnerHTML`, no `innerHTML`, no `eval` in `src/`,
  React escapes user content by default), but a stored-XSS flaw
  would expose localStorage tokens — the same as for any SPA.
- Custom API (NOT part of Supabase production): CORS reflects the
  caller when `CORS_ORIGIN` is unset — if the API is ever deployed,
  set `CORS_ORIGIN` to the exact frontend origin. `PG_SSL=true`
  uses `rejectUnauthorized: false` — use a proper CA for a
  production database. The API has no rate limiting (login,
  invitations, uploads); Supabase's own Auth/Storage rate limits
  apply in Supabase mode and must be checked in the live project
  settings (not inspected here). API error responses are generic
  (no stack traces or SQL details in responses; details go to the
  server log only).
- Database TLS: Supabase connections are over HTTPS/TLS via the
  Supabase client; there is no direct Postgres connection from
  the browser to verify.

**Dependency audit result and registry limitation:**
- `npm audit` FAILED in both frontend and server with the same
  sandbox policy block as Phase 8: `403 Forbidden - POST
  https://registry.npmjs.org/-/npm/v1/security/audits/quick -
  policy_denied` (`zz_managed_internal_spaces_package_registries`).
  Dependencies are therefore **unverified, not safe**. No lockfile
  was deleted, regenerated, or upgraded, and no major versions
  were changed. Manual version review only: installed frontend
  versions are recent (React 19.3.1, Vite 6.4.5,
  @supabase/supabase-js 2.118.0, motion 12.43.0, Tailwind 4.3.3,
  TypeScript 5.9.3); server ranges are Express ^4.19.2,
  jsonwebtoken ^9.0.2, multer ^2.0.0, pg ^8.12.0, bcryptjs ^2.4.3,
  with a lockfile present. Run `npm audit` outside this sandbox
  before production.

**Tests executed, with exact pass/fail counts:**
- `npm run build` (tsc + Vite): PASS (only the pre-existing
  >500 kB chunk warning).
- Board engine regression: 31 PASS, 0 FAIL.
- Supabase RLS matrix (isolated Postgres 16, mock auth, as
  authenticated): before 0008 — 3 FAIL (view cross-space leak,
  view private-draft leak, direct join without code) out of 18
  checks; after 0008 — all 18 pass, including partner letter
  update denied, appreciation delete denied, shared reminder
  update allowed, journals isolated, forged journal denied,
  private draft hidden, sealed body NULL in view (visible after
  reveal), outsider view rows 0, direct join blocked, storage
  own-space allowed / other-space denied, guess RPC first-guess
  reveals + second-guess errors, shared-message hijack blocked,
  fresh round answer NULL for partner / visible for creator,
  createSpace flow works (space + self membership + RPC
  idempotent).
- Join/invitation RPCs: 8 checks, all denied-or-allowed as
  expected (expired/reused/full/non-member cases all error).
- Migration reruns: 0002–0007 rerun clean (data preserved);
  0007 rerun clean after its idempotency fix; 0008 rerun clean;
  0001 rerun errors on spaces/members policies (no drop-if-exists)
  AND regresses 0007 (proven) — see ordering warning.
- Storage (RLS enabled): own-space `.html` upload allowed by
  policy (type bypass, now mitigated in `uploadMedia`), other-
  space upload denied, outsider SELECT 0 rows.
- Visual regression (dev server, 1200px + 390px): all 10 routes
  render with headings, no horizontal overflow, no page errors.
- Functional (dev server): navigation, refresh (hash preserved),
  back/forward, keyboard focus (visible 2px outline) + Enter,
  Settings inputs labelled, Deleted empty state, reduced-motion
  page load — all pass. CRUD (dev server): reminder create,
  favourite, soft-delete, restore, back-in-room all YES; the
  Deleted-room visibility check missed on a 500 ms wait in dev
  mode but passed with a 2 s wait (test timing, not an app
  regression — the successful restore proves the item was there).
- Production gate (production build, no env vars): misconfig
  screen YES, demo home NO, demo banner NO, page errors none.
  Development server: demo home YES, demo banner YES, gate NO.
- Accessibility (verified, not redesigned): reduced-motion fix
  from Phase 8 still in place (Page + Home use `useReducedMotion`);
  focus outline, labels, contrast from Phase 8 unchanged (no UI
  restyle in this phase). A full manual screen-reader pass and
  iOS voice recording remain untested, as in Phase 8.

**Files changed and reasons (this phase only; Phase 1–8 files
unchanged except where noted):**
- `supabase/migrations/0008_security_invoker_views_and_policy_fixes.sql`
  (new): security-invoker views, game_rounds member select policy,
  creator-only space_members insert (+ `is_space_creator` helper),
  shared-messages split policies, authenticated grants. Reasons:
  the three RLS findings + missing grants above.
- `supabase/migrations/0007_author_only_letters_appreciations.sql`
  (edited, unapplied live): added drop-if-exists for its own
  appreciations policies so reruns do not error. Reason:
  idempotency, found by rerun testing.
- `src/lib/store.ts`: removed letters raw-table fallback (sealed-
  body leak on view error); added `uploadMedia` extension/MIME/
  size validation for photo and voice in front of every backend.
- `src/lib/supabase.ts`: production HTTPS requirement for the
  Supabase URL (non-HTTPS treated as unconfigured).
- `src/lib/api.ts`: same production HTTPS requirement for the API
  URL.
- `src/App.tsx`: Supabase sign-out now reloads (clears in-memory
  data); production misconfiguration gate screen when neither
  backend is configured in a production build.
- `.env.example`: documented that `VITE_API_URL` must be ABSENT
  for Supabase production (it otherwise silently wins).
- No UI redesign, no feature changes, no test removals, no
  security checks weakened, no Phase 8 fix reverted.

**Remaining risks and manual configuration requirements:**
1. The real Supabase project has NOT been verified in this phase:
   migrations 0001–0008 have not been run on it, its Auth settings
   (email confirmation, sign-up enumeration behaviour, password
   policy, rate limits), Storage bucket settings, and RLS state
   have not been inspected, and no live two-device test has been
   done. All local results must be re-verified live after the
   manual steps below.
2. Raw-table sealed-letter SELECT still returns sealed bodies to
   members (RLS cannot mask a column). The app never reads the raw
   table now, but a determined partner with the Supabase URL and
   anon key could query it directly. Fully closing this would
   require moving sealed bodies to a separate table or a
   security-definer read function — a larger change, left as a
   documented residual risk, not a silent one.
3. Supabase-mode board state is not server-validated (a member
   client can write arbitrary board state); API mode validates
   via the engine. Acceptable for a local two-player game, but
   do not present Supabase board scores as tamper-proof.
4. Supabase storage policies cannot prove file content; direct
   Storage API calls bypass the new `uploadMedia` check. Signed
   URLs are 1-hour bearer tokens and cannot be revoked early.
5. `npm audit` could not run (registry policy block) — dependency
   vulnerabilities are unverified.
6. No password-reset UI in the app; users who forget a password
   need Supabase's reset flow (or support) until one is added.
7. Auth tokens are stateless (Supabase session + JWT); revocation
   behaviour depends on Supabase Auth settings, not on app code.
8. If `VITE_API_URL` is ever set in production by mistake, the
   app silently switches to the API backend and its separate
   database — the checklist below is the guard, plus the HTTPS
   and misconfiguration gates.

**Production deployment checklist (Supabase path only):**
1. Do NOT push or deploy until you have read this section and
   confirmed each item. This phase pushed and deployed nothing.
2. In Vercel, set ONLY `VITE_SUPABASE_URL` (https://your-project.
   supabase.co) and `VITE_SUPABASE_ANON_KEY` for Production (and
   Preview, if previews should sync). Confirm `VITE_API_URL` is
   ABSENT from all Vercel environments — if it is present, remove
   it, or the app will use the API backend instead of Supabase.
3. In the Supabase SQL editor, run migrations 0001–0008 IN ORDER,
   exactly once, on the real project. Do NOT re-run 0001
   afterwards; if you ever must, re-apply 0007 and 0008 right
   after, in order. Confirm the private-media bucket exists and
   is private, and that storage RLS is enabled (it is by default).
4. In Supabase Auth settings, confirm: email confirmation as
   intended (the app's sign-up message says "check your email to
   confirm, if Supabase email confirmation is on"), password
   policy, and that no service-role key is in any frontend env
   var. Set up the password-reset flow (Supabase email templates
   / redirect URLs) since the app has no reset UI yet.
5. Push the working tree (Phases 1–9) to GitHub and deploy to
   Vercel (production build). Confirm the deployed site does NOT
   show the misconfiguration screen and does NOT show the demo
   banner — both would mean the Supabase vars are missing or
   wrong.
6. Verify live, on two real devices with two real accounts: sign
   up/sign in, create a space, join by code, create a shared
   memory (partner sees it), write a private journal (partner
   does NOT see it), write a sealed letter (partner sees only
   the envelope until reveal), upload a photo (partner sees it
   via a signed URL), and confirm a third account cannot join
   the full space. Then run `npm audit` outside this sandbox
   and review the results before calling the deployment final.
7. After live verification, re-check: no demo data on the live
   site, no service-role key anywhere in the repo or Vercel env,
   and the live site's mode (Supabase, not demo or API).

**Verified local behaviour vs unverified live behaviour:**
- Verified locally (isolated Postgres, dev server, production
  build with no env vars): everything under "Tests executed"
  above, including all RLS policies after 0008, the join RPCs,
  storage isolation, the production gate, the HTTPS gates, and
  the upload validation.
- NOT verified live and requiring the checklist above: the real
  Supabase project's migrations (0001–0008), Auth/Storage
  settings, live two-device sync, live sign-out/session-revocation
  behaviour, iOS voice recording, full screen-reader pass, and
  dependency audit results.

## Phase 10 — Final security remediation (2026-11-01)

A senior Supabase security review of the Phase 9 audit's remaining
risks. Same restrictions as Phase 9: nothing pushed, committed,
merged, deployed, or changed on the real Supabase project; no
production data touched; no Git history rewritten; every Phase 8
and Phase 9 fix preserved and re-verified. The working tree from
Phases 1–9 was preserved first (filesystem backup at
`~/workspace/phase10-backup/working-tree-phase10.tar`, plus a
git-status record). All Phase 10 changes are local and unpushed.

**Root cause of each issue, and what was done about it:**

1. **Sealed-letter confidentiality at the database boundary
   (FIXED).** Root cause: Postgres RLS is row-level, not
   column-level. The letters SELECT policy correctly lets a member
   see a scheduled letter's row (the partner must see the
   envelope), but that row carries the body — so a partner querying
   the raw `letters` table directly received sealed bodies before
   `reveal_at`, even though the app reads only through
   `letters_visible` (which masks them). The app's Phase 9 fallback
   removal fixed the app's read path, not the database's. The same
   pattern applied to `game_rounds`: a member querying the raw
   table received the answer before guessing (Phase 9 had tested
   outsider raw rounds, 0 rows, but not partner raw rounds — the
   partner leak was found and proven in this phase).
   Fix (migration 0009, no table split, no app read/write change):
   Postgres privileges are additive, so revoking SELECT on one
   column does NOT override a table-level SELECT grant — the
   table-level grant is revoked first, then SELECT is granted only
   on the non-sensitive columns (`letters` without `body`,
   `game_rounds` without `answer`). Direct SELECT, SELECT *, and
   joins for those columns now fail with permission denied,
   fail-closed, for every authenticated user including the author
   (the view is the read path for bodies/answers, by design).
   INSERT/UPDATE/DELETE grants are untouched, and UPDATE does not
   require SELECT on the written column, so author letter edits,
   soft-delete/restore, creator round inserts, and the
   security-definer `guess_answer` RPC all still work (all
   verified). The two views become security-definer (owner) with
   explicit WHERE clauses — membership via the security-definer
   `is_space_member` helper, plus private-draft filtering for
   letters — because a security-invoker view would now fail (the
   invoker no longer has SELECT on body/answer) and a
   security-definer view without a WHERE would leak (as 0001's
   view did). CASE masking is unchanged. Post-reveal reading is
   unchanged through the view; raw-table bodies remain denied even
   after reveal, which is intended (the view enforces the time
   rule, the table enforces the column rule).

2. **Upload security (HARDENED, with one documented residual).**
   Root cause: Supabase Storage policies checked membership and
   path only, so a member could upload `.html` into their own
   allowed path, and a browser MIME type proves nothing about
   content. Fixes, layered:
   - Migration 0009 storage policies now also require the second
     path segment to be `photo` or `voice` and the filename to end
     with a whitelisted extension (jpg/jpeg/png/gif/webp/avif,
     mp3/wav/ogg/m4a/webm — the same list the client and API
     server enforce). This blocks `.html` at the database layer,
     even via direct Storage API calls, not just in the UI.
   - Migration 0009 DELETE policy is now owner-only (owner =
     `auth.uid()` plus space membership), so a member cannot
     delete — and then replace — a partner's media file whose path
     they know from a shared memory row. SELECT stays member-only
     (shared media is meant to be viewable by both); there is
     still no UPDATE policy, so upsert-overwrite stays blocked.
   - Client `uploadMedia` now also verifies file signatures
     (magic bytes) against the claimed extension for all 11
     formats, including recorded WebM (EBML) and Safari MP4
     recordings named `.m4a` (ftyp) — verified in a real browser:
     a real PNG uploads, HTML renamed to `.png` is rejected with
     a signature error.
   - API server `/api/upload` now verifies the saved file's
     signature against its extension and deletes mismatched files
     (verified: real PNG/JPG/WebM/M4A accepted; HTML-as-PNG and
     JPG-as-PNG rejected with 400 and no file left on disk; `.html`
     still rejected at the multer filter). API media responses now
     also send `X-Content-Type-Options: nosniff`.
   Residual (cannot be closed without a trusted server): a direct
   Storage API call can still upload a correctly-named file with
   spoofed content (e.g. HTML inside `photo.png`), because
   Storage policies cannot decode content. That risk is kept low
   because the file is served with an image/audio content-type
   derived from the whitelisted extension, and the app renders
   media only via `<img>`/`<audio>` — never as a document — so a
   spoofed file shows as a broken image, not executed HTML.
   Full content verification in Supabase mode would require a
   trusted validation layer (Edge Function or the API backend);
   that is a new backend component and was not introduced in this
   phase, per the brief's "do not introduce an unnecessary custom
   backend" rule. API mode now has trusted signature verification.

3. **Game-state integrity (REVIEWED, with one documented
   limitation).** Fields classified:
   - Presentation/shared config (`game_configs`, including board
     properties): member-wide by design — both partners configure
     games together, and in-progress board games keep a config
     snapshot, so mid-game config edits cannot affect a running
     game. No change.
   - Per-user scores (`game_progress`): writable by owner only
     (policy + verified: partner overwrite denied, negative score
     denied by CHECK constraint). Self-inflation (a user writing a
     high score for themselves) is possible in Supabase mode — it
     affects no other player's state, no currency, and no shared
     outcome, so it is accepted as a cooperative-arcade limit, not
     a vulnerability. API mode validates scores (already, Phase 5).
   - Session history (`game_sessions`): INSERT by starter only
     (verified: forged `started_by` denied), no UPDATE/DELETE
     policy (append-only). No change.
   - Board state (`board_games`): member-wide read/write, version
     optimistic concurrency in the client, but NO server-side
     engine validation in Supabase mode (verified: a member can
     write arbitrary state with the correct version, e.g. coins
     999999). Outsiders are fully blocked (read/insert denied),
     and stale-version updates affect 0 rows (the app pattern
     detects conflicts), but deliberate forgery by a member is
     NOT prevented. This is the remaining game limitation: the
     board game is explicitly local two-player on one device, not
     online multiplayer, so the "victim" of forgery is the other
     local player sharing the device — low severity, but do not
     present Supabase board results as tamper-proof. Full engine
     validation exists only in API mode (Phase 7); adding it to
     Supabase mode would require a trusted engine (Edge Function
     or RPC re-implementing the TypeScript engine), which is out
     of this phase's scope and cannot be deployed here.

**Migration sequence verification (disposable local Postgres 16,
mock auth — never the real project):**
- 0001–0009 apply cleanly in order, no errors, on a fresh database.
- 0009 reruns cleanly (views/policies dropped and recreated,
  grants/revokes idempotent).
- 0008 fixes remain effective after 0009: outsider view rows 0 for
  both views, author-only letter update and appreciation delete
  denied, shared reminder update allowed, journals and private
  drafts isolated (0 rows for partner), direct join without a code
  blocked, shared-message authorship cannot be hijacked, join RPCs
  reject expired/reused/full/non-member cases, guess RPC reveals
  once and blocks a second guess, createSpace flow works.
- 0001 rerun (tested, not recommended): column protection
  SURVIVES (0001 never grants SELECT, so raw bodies stay denied),
  but the view filtering regresses (partner view rows 3, including
  the private draft, because 0001 recreates the view without a
  WHERE) and the author-only policies regress (0001 recreates
  member-wide policies, as Phase 9 proved). Recovery, verified:
  re-apply 0007, 0008, 0009 in order — partner view back to 2 rows
  (private draft absent), partner update denied, outsider 0 rows.
- 0008 rerun alone would undo column protection (its all-tables
  grant re-grants table-level SELECT), so if 0008 is ever re-run,
  re-apply 0009 immediately after it. General rule, unchanged from
  Phase 9 and now extended: apply 0001–0009 once, in order; if any
  earlier migration is re-run, re-apply all later migrations in
  order.

**Tests executed, with exact pass/fail counts:**
- `npm run build` (tsc + Vite): PASS (only the pre-existing
  >500 kB chunk warning). Server `node --check`: PASS.
- Board engine regression: 31 PASS, 0 FAIL.
- Sealed-letter / game-round confidentiality (fresh 0001–0009 DB):
  partner raw body SELECT → permission denied; partner raw
  answer SELECT → permission denied; author raw body SELECT →
  permission denied (view is the read path, by design); partner
  view sealed NULL / shared visible / private draft absent;
  author view own sealed + draft visible; creator view answer
  visible; partner view answer NULL before reveal, visible after
  reveal; outsider view rows 0 for both views, including via
  joins; post-reveal partner view body visible; raw body still
  denied after reveal. Author title/body UPDATE, soft-delete,
  restore, creator round INSERT, and guess RPC all still work.
- Storage (0009 policies): `.png` photo upload allowed, `.mp3`
  voice upload allowed, `.html` upload denied by policy,
  wrong-kind-segment upload denied, no-extension upload denied,
  partner DELETE of owner's photo denied (file still exists),
  partner SELECT of shared media allowed (2 rows), owner DELETE
  allowed.
- Upload signatures (API server): real PNG/JPG/WebM/M4A 200;
  HTML-as-PNG 400 (file deleted, nothing left on disk);
  JPG-as-PNG 400; `.html` 400 at filter. Media serve: 200,
  content-type image/png, nosniff header present, invalid token
  403. Client (real browser, demo mode): real PNG memory created,
  HTML-as-PNG memory rejected with signature error, no page
  errors.
- Game-state authorization: partner progress overwrite denied
  (score stays 10), own progress allowed (5), negative score
  denied by CHECK (stays 5), forged session `started_by` denied,
  own session allowed, outsider board read/insert denied, member
  board insert allowed, member arbitrary board state with
  correct version SUCCEEDS (documented limitation), stale-version
  update affects 0 rows (conflict detected, state unchanged).
- Phase 9 RLS matrix re-run against 0009: all checks pass, with
  the expected change that raw body/answer queries now error
  (permission denied) instead of returning rows.

**Files changed and reasons (this phase only):**
- `supabase/migrations/0009_column_confidentiality_and_storage_hardening.sql`
  (new): column SELECT grants for letters/game_rounds,
  security-definer views with explicit membership/draft filters,
  storage extension/kind/owner policies. Reasons: sections 1–2.
- `src/lib/utils.ts`: added `validateMediaSignature` (magic-byte
  check for all 11 formats). Reason: client upload hardening.
- `src/lib/store.ts`: `uploadMedia` now calls the signature check
  in front of every backend, and its comment updated (Storage
  policies now DO enforce extension, per 0009). Reason: section 2.
- `server/index.js`: API upload now verifies the saved file's
  signature and deletes mismatches; media responses send nosniff.
  Reason: trusted upload validation for API mode.
- No UI redesign, no feature changes, no test removals, no
  security checks weakened, no Phase 8/9 fix reverted, no view
  returned to an unfiltered state except as documented for the
  0001-rerun recovery path.

**Confirmed fixes versus unresolved limitations:**
- Fixed: sealed-letter and game-round confidentiality at the
  database boundary (direct table, join, and view paths);
  Storage extension/kind/owner enforcement; client and API
  signature verification; media nosniff.
- Unresolved (documented, not silent): Supabase board state has
  no server-side engine validation (member forgery possible;
  API mode validates); Supabase Storage cannot prove file content
  via direct API calls (extension policy + content-type +
  img/audio rendering keep the risk low); self-inflation of one's
  own arcade score in Supabase mode (no other player's state
  affected); `npm audit` still unavailable in this sandbox
  (unverified, not clean — run outside the sandbox before
  production); no password-reset UI in the app; live Supabase
  project, Auth/Storage settings, live two-device sync, iOS voice,
  and full screen-reader pass remain unverified.

**Instructions for safely applying the migration sequence to a
future Supabase environment:**
1. Do NOT push or deploy until you have read this section and the
   Phase 9 checklist, and confirmed each item. This phase pushed
   and deployed nothing.
2. In Vercel, set ONLY `VITE_SUPABASE_URL` (HTTPS) and
   `VITE_SUPABASE_ANON_KEY` for Production (and Preview, if
   previews should sync). Confirm `VITE_API_URL` is ABSENT from
   all Vercel environments — if present, the app silently uses
   the API backend instead of Supabase.
3. In the Supabase SQL editor, run migrations 0001–0009 IN ORDER,
   exactly once, on the real project. 0009 must follow 0008 (its
   column grants depend on 0008's table grants being revoked in
   the right order, and 0009's view definitions replace 0008's).
   Do NOT re-run 0001 afterwards; if you ever must, re-apply
   0007, 0008, and 0009 immediately afterwards, in order. If you
   ever re-run 0008, re-apply 0009 immediately after it. Confirm
   the private-media bucket exists and is private, and that
   storage RLS is enabled (default).
4. In Supabase Auth settings, confirm email confirmation, password
   policy, and that no service-role key is in any frontend env
   var. Set up the password-reset flow (Supabase email templates /
   redirect URLs) since the app has no reset UI yet.
5. Push the working tree (Phases 1–10) to GitHub and deploy to
   Vercel (production build). Confirm the deployed site does NOT
   show the misconfiguration screen and does NOT show the demo
   banner — both would mean the Supabase vars are missing or wrong.
6. Verify live, on two real devices with two real accounts: sign
   up/sign in, create a space, join by code, create a shared
   memory (partner sees it), write a private journal (partner
   does NOT see it), write a sealed letter (partner sees only
   the envelope until reveal, and cannot obtain the body via the
   Supabase client directly), upload a photo (partner sees it via
   a signed URL), try uploading an `.html` file (should be
   rejected by the Storage policy), and confirm a third account
   cannot join the full space. Then run `npm audit` outside this
   sandbox and review the results before calling the deployment
   final.
7. After live verification, re-check: no demo data on the live
   site, no service-role key anywhere in the repo or Vercel env,
   and the live site's mode (Supabase, not demo or API).

**Verified local behaviour vs unverified live behaviour:**
- Verified locally (isolated Postgres, API server, dev server,
  production build): everything under "Tests executed" above,
  including all 0009 protections, the join RPCs, storage
  isolation, the production gate, the HTTPS gates, and the upload
  signature checks.
- NOT verified live and requiring the checklist above: the real
  Supabase project's migrations (0001–0009), Auth/Storage
  settings, live two-device sync, live sign-out/session-revocation
  behaviour, iOS voice recording, full screen-reader pass, and
  dependency audit results.

## Phase 9 — Personalization and emotional finishing (2026-11-01)

Note on numbering: this is the personalization brief labelled "Phase 9"
by the user. It is a different brief from the Phase 9 Supabase
production-readiness audit section above (and from Phase 10 security
remediation) — same number, different work, applied after Phases 9–10.
Nothing in this section overwrites those audits, and nothing here was
pushed, deployed, or changed on the real Supabase project. The working
tree from Phases 1–10 was preserved first (filesystem backup at
`~/workspace/personalization-backup/working-tree-personalization.tar`,
plus a git-status record). All personalization changes are local and
unpushed, like Phases 1–10.

**What already existed (verified, not rebuilt):**
- Display names: set in Settings, shown on memories, letters, notes,
  and the Home avatar pair (real names in a real space; "You" and
  "Partner" only in demo mode, where the members literally are those
  placeholders).
- All personal content types are user-created and start empty in a
  real space (Supabase/API modes never show demo samples — Phase 3
  guarantees a real user's first paint has no sample memories or
  letters). Demo samples are explicitly labelled as samples ("Sample
  memory — replace this with one of yours", "Sample shared letter —
  write one in your own words"), never presented as real history.
- Game personalization editors already existed ("Make it yours" for
  Memory Match photo source, quiz questions, chest riddles + final
  message, hero missions + final message, board spaces + cards).
- Emotional content was already mostly accessible without winning:
  hero final message readable from intro/map, board end-early rule,
  quiz/chest scores carry no locked content — except the chest (see
  fix below).

**What was built in this phase (approved visual identity unchanged —
same Card/Washi/Button, same pastel tokens, same fonts, no new theme):**
- **First-visit welcome (Home, dismissible card, never a modal or a
  forced sequence).** It sits between the hero parchment card and the
  room cards, and contains: a gentle welcome ("Nothing here needs a
  reply, a score, or a finish"); a clear explore guide (buttons to
  Memory Wall, Letters, Things I See in You, Our Future); a subtle
  games introduction (one paragraph: seven small games, for fun, every
  final message readable without winning); and a meaningful personal
  message. That message is REAL content when it exists — the latest
  shared appreciation, else the latest shared, unsealed letter — and
  an honest invitation when it does not ("A note from each other will
  live here. When you are ready — no rush, no occasion needed —").
  No invented letter, quote, nickname, event, or memory was written
  anywhere in this phase. In demo mode the welcome always shows the
  invitation, never a sample appreciation/letter, because presenting
  a sample as if a partner wrote it would be invented personal
  content. Dismissal is per device (localStorage), so one partner
  hiding it does not hide it for the other; it persists across
  reloads, never reappears unasked, and can be brought back any time
  from a new "Welcome card" section in Settings ("Show the welcome
  again"). It does not block navigation, does not track progress,
  and does not ask for a task, a reply, or a score. Repeat visits
  after dismissal show the normal living Home (recent memories,
  plans, favourites, sealed count) with no onboarding residue.
- **Starter-content labelling (no defaults removed, games stay
  playable without personal content, as Phase 6 requires).** The
  quiz, chest, hero, and board editors now each carry an explicit
  note: "These are starter questions/riddles/missions/places —
  replace them with your own memories, inside jokes, and answers.
  Nothing here is your real history until you write it." The
  defaults themselves are generic starters (quiz questions about
  slow evenings, chest riddles about clocks and footsteps, hero
  districts that are game fiction, board places that are generic
  tropes with no names, dates, or real places) — they were not
  replaced with invented specifics, and they remain editable in the
  existing editors.
- **Chest final message is now readable without solving (fix).**
  The chest previously showed its final message only after all
  riddles were solved, which broke the "emotional content without
  winning" rule. It now has the same "Read the final message now"
  button as the hero adventure, showing the message (and linked
  memory, if any) with the note "yours to read any time, no riddles
  needed". Solving the riddles still works exactly as before and
  still unlocks the chest the same way; the button only adds an
  alternate access path, it does not remove gameplay.

**Tests executed:**
- Build: PASS. Board engine: 31 PASS, 0 FAIL.
- Welcome (dev server, fresh localStorage): appears on first visit
  with welcome, explore buttons, games line, no-pressure line, and
  the invitation (not a sample appreciation); dismiss + reload =
  gone; Settings "Show the welcome again" + Home = back; "Write a
  letter" button navigates to Letters; no horizontal overflow at
  1200px or 390px; no page errors.
- Chest (dev server): "Read the final message now" button present;
  final message readable without solving; note "no riddles needed"
  present; no page errors.
- Editor starter notes (dev server): quiz note YES, board note YES
  (chest and hero notes are the same added lines, verified by code
  inspection and the same Card/Field pattern).
- Both partners, API backend (two real accounts, one space):
  A memory/appreciation/shared letter/plan and B plan/memory all
  created (201); B sees A's memory, appreciation, and shared letter;
  A sees B's memory; B does NOT see A's private draft or private
  journal; A's custom quiz question (inside-joke wording) visible to
  B; A's renamed board place + description visible to B. Private
  drafts and journals remain private, as in Phases 8–10.

**Files changed and reasons (this phase only):**
- `src/components/Home.tsx`: WelcomeCard (dismissible, real-note
  or invitation, demo-safe) + `WELCOME_KEY` export, placed between
  hero and room cards. No brand copy, photo, hotspot, or room-card
  change.
- `src/App.tsx`: Settings "Welcome card" section with "Show the
  welcome again" (clears the dismissal flag). No other Settings change.
- `src/rooms/Arcade.tsx`: chest "Read the final message now"
  button + panel; starter notes in quiz and chest editors.
- `src/rooms/BoardGame.tsx`: starter note in board editor.
- `src/rooms/HeroAdventure.tsx`: starter note in mission editor.
- No schema change, no migration, no new backend, no UI redesign,
  no demo-sample change, no default-content removal.

**Personal content still needed (concise list — see the final report
for the full list):** chosen display names (Settings, both partners);
shared photographs + captions + dates for the Memory Wall; real
memories and stories; inside jokes (as quiz questions, chest riddles,
hero clues, or board spaces/cards); personal appreciation notes;
letters written by each partner (shared, scheduled/sealed, or private
drafts); custom game questions and missions; personalized board-game
spaces and cards; shared future plans (bucket list, date ideas,
plans); optional voice notes (record or upload in the Quiet Room).
Until those are supplied, the site runs on clearly labelled starter
content and empty rooms with "add your first" invitations — nothing
is invented to fill the gaps.

**External setup you must still complete (nothing in this phase does it):**
1. **Choose one canonical backend and run it live.** Either (a) host the
   `server/` API and set `VITE_API_URL` on the frontend host, with
   `DATABASE_URL` + `JWT_SECRET` on the server host — the API applies
   `postgres/schema.sql` (including Phase 3 tables and triggers) on boot;
   or (b) use Supabase and run migrations 0001–0006 in its SQL editor.
   The two backends are alternatives, not both live at once. Supabase
   users must run `0006_game_configs_and_rounds.sql` (game configs,
   guess rounds with the masked view + `guess_answer` RPC, progress
   moves/time columns) after 0005.
2. **If Supabase:** run `0004_profiles_invitations_games.sql` in the SQL
   editor (it needs the dashboard; no service-role key is involved, and none
   was used in this phase). Then verify on two real devices: sign in as each
   partner, add a memory as one, confirm it appears for the other, and
   confirm a private journal never appears for the other.
3. **Never commit** `server/.env` or any `.env` with real secrets — they are
   gitignored. Frontend code contains only `VITE_` public variables (URL +
   anon key); no service-role key, `DATABASE_URL` or `JWT_SECRET` is in
   source, and the grep for them in `src/` and `server/index.js` is clean.
4. **No production seed script is shipped on purpose:** spaces and content
   are user-created, and the only sample content is the clearly-labelled
   demo-mode data on the device. Test accounts created during Phase 3
   lived only in local test databases, which were dropped afterwards.

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
2. In the **SQL editor**, run `supabase/migrations/0001_init.sql` in full, then `0002_join_by_code.sql` (required: joining by invite code goes through the `join_space_by_code` RPC, because a non-member cannot SELECT a space row under RLS), then `0003_trigger_and_journal_hardening.sql`, then `0004_profiles_invitations_games.sql` (Phase 3: profiles, expiring invitations, games/board schema, one-space triggers), then `0005_tags_and_target_dates.sql` (Phase 4: memory tags, future target dates), then `0006_game_configs_and_rounds.sql` (Phase 5: game configs, guess rounds with masked view + guess RPC, progress moves/time). It creates:
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
