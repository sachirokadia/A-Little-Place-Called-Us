# RELEASE AUDIT — "A Little Place Called Us" (new stack)

**Audit date:** 2026-11-03. **Base commit audited:** `a282744` (Phase 7 "Our Little World").
**Fix commit (local only, NOT pushed, NOT deployed):** see git log — one commit on top of
`a282744` carrying this report and the fixes in §2. Remote `main` was verified still at
`a282744` at audit close; the parent pushes under the standing rule (push only once work
is complete and verified).
**Old app** (`~/workspace/little-place-called-us/`, `d4e7a80`) was NOT touched, NOT audited
as the release candidate, and NOT copied from. No production service (Supabase, Vercel) was
touched. No deployment was performed.

## Release verdict

**Conditionally releasable: the one critical access-control defect found is fixed and
regression-tested, and no other critical or data-loss defect remains open. The app is NOT
production-ready yet in the deployment sense** — production readiness additionally requires
the manual configuration in §5 and the live verification checklist in §6, neither of which
can be completed from this sandbox. Do not announce a live URL until §6 has been executed
against a real deployment.

## 1. Issues discovered

Severity: critical = blocks release; major = must fix before release; minor = fix or
document. "Fixed" means fixed in the fix commit and re-tested (§3).

### Critical (1) — FIXED

- **SEC-1 — Cross-space read via singular detail routes (release blocker).**
  `GET /:singular/:id` in `apps/api/src/routes/content.ts` re-checked `visibilityWhere`
  but never called `requireSpaceMember`. For shared kinds the predicate is only
  `{spaceId, deletedAt: null}`, so any authenticated user who knew a target id read
  another space's shared memory, appreciation, plan, reminder, or letter — including a
  delivered scheduled letter — with a full 200 body. Verified both directions (account C
  reading space AB content, account A reading C's content). Lists, writes, favourite,
  export, media, and all space-scoped routes already checked membership; the detail
  route was the outlier. NOT affected (verified 404): journals, voice notes, private
  drafts, undelivered scheduled letters, all cross-space writes, media, export.
  Exploitability note: ids are UUIDv4 and are not enumerable through any list, export,
  or media endpoint tested, so bulk harvesting would need an id from elsewhere. That
  mitigates abuse but never fixed the missing check. **Fixed (§2.1) + regression test.**

### High (2) — FIXED

- **ENG-1 — `vercel.json` missing SPA fallback for `/reminders`.** All other 13 routes
  had rewrites; `/reminders` (Reminder Room, in the nav, shipped) did not. On Vercel a
  direct link to or refresh on `/reminders` would return a host-level 404 instead of the
  room. In-app navigation works, which is why local QA never caught it. **Fixed (§2.2).**
- **ENG-2 — `DEPLOYMENT.md` migration list stale.** It listed only the first three
  migrations, omitting `20251104000000_boyfriend_arcade`,
  `20251105000000_hero_adventure`, `20251106000000_board_game`. Followed literally,
  production would lack `QuizQuestion`, `GuessRound`, `ChestRiddle`, `ChestSolve`,
  `HeroMission`, `ChestReward`, `BoardConfig`, `BoardGame` and the DB-backed games and
  board would fail. **Fixed (§2.3).**

### Major — visual / accessibility (5) — FIXED

- **VIS-1 — Duplicate footer on entered Home (all widths).** "This little world grows
  when we both add to it." rendered twice (under the garden card and at page bottom).
  First-visit Home correctly showed it once. **Fixed: Home's own copy removed; footer
  text count measured 1 at 1200px and 390px.**
- **VIS-2 — Board cells split words mid-word at 390px** ("Booksho p", "Neighbour hood",
  "Hilltop Viewpoi nt"). Cause: `.cell` in `board.module.css` had
  `overflow-wrap: anywhere; word-break: break-word;`. At 1200px the board read cleanly.
  **Fixed: `word-break` removed, `overflow-wrap: break-word` only; verified at 390px.**
- **VIS-3 — Form labels not programmatically associated.** `FormField` in
  `components/ui.tsx` rendered `<label>` as a sibling with no `htmlFor`/`id` and no
  wrapping (0 of room-form controls associated; Settings radios/checkboxes were the
  exception). Sighted users saw labels; screen-reader users tabbing into a field got no
  associated label. Arcade forms additionally had placeholder-only inputs.
  **Fixed: `FormField` assigns id + `htmlFor`; missing `type="text"` added (8 inputs in
  `pages.tsx`, 3 in `QuizGame.tsx`); measured all 3 Appreciations-form labels
  associated. Quiz option-editor group label stays unassociated (multi-control group);
  each option input already has its own `aria-label`.**
- **VIS-4 — Primary-button contrast below WCAG AA for normal text.** White on
  terracotta `#c07856` = 3.46, white on sage `#7d8b6a` = 3.64 (bar 4.5). Body ink on
  cream = 11.17 (pass). **Fixed with palette shades only (§2.5), re-measured ≥ 4.5.**
- **VIS-5 — Touch targets under the 44px bar.** Nav links 33px, brand link 19px,
  "Back to Home" 26px, filter pills 39px, inline links 18–22px, native radios/checkboxes
  13px (wrapping label extends the clickable area). Home buttons (48px), hero touch
  buttons (51px+), board cells and game cards already passed. **Fixed by padding only
  for nav/brand/back/pills (§2.5); inline links and native controls left as proposals.**

### Minor — FIXED

- **FUNC-1 — 429 bounces a signed-in user to `/login`.** `App.tsx` `refresh()` treated
  ANY `getMe()` failure, including 429, as signed-out. Reproduced under rate-limit
  saturation; the session itself was never revoked. **Fixed: 429/5xx on session refresh
  now sets a "session unknown" retry state; genuine 401 behaviour unchanged.**
  (Browser exercise of the 429 branch was not possible — see §4.)
- **FUNC-2 — Blank reminder accepted via API (201, `text:""`).** UI blocked blanks
  client-side; the API schema had no `min(1)`. **Fixed: `text: trim().min(1).max(2000)`.**
- **FUNC-3 — Inputs missing a `type` attribute** (broke `getByLabel` /
  `input[type="text"]` selectors; no functional impact). **Fixed with VIS-3.**
- **VIS-6 — Appreciations form styling diverged** (centre-aligned labels, thick double
  border vs left-aligned thin-border room forms). **Fixed: gallery frame/alignment
  scoped to `.list-grid .paper`; form border measured 1px, left-aligned.**
- **VIS-7 — Quiet Room chair clipped** by the scene panel's bottom edge.
  **Fixed: chair `bottom` 8% → 12%; measured inside the panel.**
- **VIS-8 — Letters POST stamp clipped** at the card's right edge.
  **Fixed: small right margin; letters page re-shot.**
- **VIS-9 — Reminders title/body duplication.** `ItemCard` rendered a reminder's text
  twice (heading via title-fallback + body paragraph). **Fixed: duplicate paragraph
  removed; seeded reminder text occurs exactly once on `/reminders`.**
- **SEC-2 — Impossible dates normalised.** `happenedOn: "2026-02-30"` → 201, stored as
  2026-03-02 (`Date.parse` normalisation; plan `targetDate` same shape).
  **Fixed: strict `isoDate` round-trip validation; `2026-02-30` → 400,
  `2024-02-29` and `2026-03-02` still 201.**
- **ENG-3 — Dead exports.** `callerSpaceId` + `spaceOfItem` (`membership.ts`),
  `requireAuth` (`middleware/auth.ts`), `requireUuidParam` (`middleware/validate.ts`) —
  each exactly one repo-wide occurrence (its definition). **Removed; suites green.**
- **ENG-4 — Stale comments.** `schema.prisma` header said games/board are "deliberately
  NOT in this schema" (false since Phases 4–7); game_progress migration header said no
  API route reads/writes it. **Schema header fixed. The migration-file header was
  deliberately left UNCHANGED by the coordinator: editing an already-written migration
  changes its checksum, and no production database exists yet to benefit — the stale
  comment in that one file is harmless and preserved intentionally.**
- **ENG-5 — DEPLOYMENT.md prose/checklist omissions.** SPA-fallback paragraph and
  verification checklist omitted `/reminders` and `/appreciations/favourites` (vercel.json
  already covered favourites). **Fixed with ENG-2.**

### Minor / proposals — NOT fixed, with reason

- **SEC-3 — Hero-mission reward linking the author's own undelivered scheduled letter
  returns 201.** Partner linking the same letter correctly 400s and partner GET on the
  letter correctly 404s, so no body leaks; exposure is only the letter UUID in the
  partner-visible mission list, and the reward is unopenable for the partner.
  Restricting reward letters to partner-visible ones would break existing
  `hero.test.ts` (own private draft asserted 201), so per the fix rule it is left as a
  proposal: decide whether rewards must be visible to the *player*, then change the
  rule and its test together.
- **VIS-10 — Seal badges contrast.** White on rose `#c48b8b` = 2.83, white on sage =
  3.64 still fail AA, but seals are badges, not buttons, and rose has no in-palette
  darker equivalent without a restyle. Proposal: darken the badge palette at the next
  design pass, not as a silent restyle now.
- **VIS-11 — Garden fence `| | |` row on entered Home.** Judged on inspection to be
  the picket-fence element, not stray text; replacing it would change the approved
  cottage scene. Left as-is.
- **VIS-12 — Arcade page 3px overflow at 390px in the fix QA state** (two ChestGame
  `.paper` cards, right edge 393 vs viewport 390; board grid itself clean). The visual
  audit measured 0px on 14 routes including arcade under its seed state, so this is
  state-dependent; fixing it would be a layout change beyond the fix scope. Proposal:
  scope a card-padding fix and re-measure.
- **VIS-13 — Final-message button/link overlap** (prior shot showed "Read it again"
  overlapping "Back to Home →"). Fix QA measured NO overlap (button bottom 758.0,
  link top 761.0) — treated as resolved by the surrounding layout fixes, not separately
  changed.
- **VIS-14 — Nav has no collapse at small widths** (2 rows at 768px, 4 rows at 390px,
  no horizontal overflow). Accepted design behaviour, not redesigned.
- **ENG-6 — Unused `cors` dependency** (`apps/api/package.json`; `app.ts` hand-rolls
  CORS). Not removed: package-change risk. Proposal: remove + lockfile refresh in a
  dedicated dependency pass.
- **ENG-7 — `vercel.json` `buildCommand` builds only the frontend.** Safe today
  (frontend imports zero `@little-place/shared` code, verified by grep), but if the
  frontend ever imports shared, Vercel builds break. Proposal: add a comment or a
  shared-build step when shared is first imported by the frontend.
- **ENG-8 — Lint absent.** No eslint/prettier script or config anywhere in the repo
  (excluding node_modules); the only lint-like artifact is an `eslint-disable-next-line`
  comment in `apps/api/src/app.ts` referencing a linter that is not configured.
  Reported as a gap; no toolchain was added (out of scope for this audit).

### Verified good (no action needed)

Security (340 probes): unauthenticated access 401 across 27 GET route classes with
generic bodies and no content; partner-private isolation (journal/voice-note lists empty,
letter list shows only shared + delivered, private detail/media/export all 404, no
`storageKey` leaks); 23 partner-write attempts on author-only content all 404; forged
board actions (out-of-turn, wrong-phase, forged coins/position/ownership/dice, stale
version 409 `STALE_VERSION`, replayed action 409), forged GameProgress (hero tokens
16/−1, catch-hearts 61/−1, unknown keys/fields, body playerId), and forged identity
fields (body `authorId`/`spaceId` ignored or 400) all rejected; membership enforcement
on invitations (non-owner 404, second space 409), cross-space routes (404), and
malformed ids (404); storage as it actually is — dev-only `local` backend,
`STORAGE_BACKEND=r2` fails fast at boot, no static middleware, **no signed URLs exist
anywhere**, media served only through the API with auth + membership + visibility,
`Cache-Control: private, no-store`; input validation 400s with field names only (no
stack traces, SQL, or internal paths); whole-tree secrets grep found no real secret
(only `.env.example` placeholders and test-fixture values); zero
`dangerouslySetInnerHTML`/`__html`/`.innerHTML` in frontend + shared + API source
(13 occurrences in the built bundle are React DOM internals); sessions (logout-all
revokes all, HttpOnly + SameSite=Lax cookies, no Domain, Secure only in production),
CSRF + Origin enforcement (missing/wrong Origin → 403, no ACAO reflection).
Functional: auth/session, exactly-two-member pairing (full-space 409, token reuse 400,
expired invite 400, rotate invalidates old token), navigation + refresh on all 13
destinations, CRUD on all 7 content types incl. plan-complete, favourite toggle/filter,
soft-delete → Deleted visibility → restore → permanent delete, photo upload
(author-only, EXIF-free bytes, display variant 1200×900 vs full 2000×1500), letter
visibility + reveal-date editing, journal/voice isolation, game completion + persistence
after fresh re-login with per-player isolation, board rules + snapshot isolation +
restart-from-old-snapshot + refresh-restore, empty/loading/success/error states.
Engineering: typecheck + build pass, 6 migrations apply clean via psql (29 tables,
zero schema drift, 49 FKs, 48 non-PK indexes, all 7 enums), 12 API env vars agree
exactly across `.env.example`, `config.ts`, and DEPLOYMENT.md, frontend needs no env
vars, DEPLOYMENT.md step order correct with zero guessed URLs.

## 2. Fixes implemented (fix commit on top of a282744)

1. **Cross-space detail membership (SEC-1).** Detail handler in
   `apps/api/src/routes/content.ts` now calls `requireSpaceMember` against the row's
   own space BEFORE the visibility re-check, for all seven kinds; non-members get the
   same generic 404 as a non-existent row. New test
   `apps/api/tests/integration/cross-space-detail.test.ts`: cross-space detail reads
   404 for all seven kinds in both directions (including a delivered scheduled letter);
   same-space reads 200; partner still 404 for journal/voice-note.
2. **`vercel.json`.** Exactly one rewrite added: `/reminders` → `/index.html`
   (now 14 rewrites, JSON validated). Deep link to `/reminders` on the QA server
   returned 200 HTML and rendered the Reminder Room client-side.
3. **`DEPLOYMENT.md`.** Migration list now all six; SPA-fallback paragraph and
   verification checklist now include `/reminders` and `/appreciations/favourites`.
   No URLs added.
4. **Entered-Home footer.** Home's own footer copy removed; App footer is the only
   instance (measured count 1 at 1200px and 390px; first-visit unchanged).
5. **Contrast + touch (palette shades only, re-measured).** Primary button white on
   terracotta-deep `#a35f40` = **4.92** (was 3.46); hover wood `#8a6a4f` = **4.94**.
   Secondary button white on `#6a7a58` = **4.63** (was 3.64); hover darker sage
   `#5d6b4c` = **5.72**. Filter pills active white on `#6a7a58` = **4.63**. Board
   button white on `#a83e3e` = **6.13** (was 4.45). No new palette, no restyle.
   Touch targets by padding only, measured: nav links **44.3px** (was 33), brand
   **44.8px** (was 19), "Back to Home" **44.8px** (was 26), filter pills **46.8px**
   (was 39). Multi-row nav wrap at 390px accepted, unchanged.
6. **Board cells.** `word-break` removed from `.cell`; computed style at 390px is
   `overflow-wrap: break-word, word-break: normal`; place names wrap at spaces.
7. **Labels + input types.** `FormField` assigns id + `htmlFor` to single
   input/select/textarea children (no visual change otherwise); `type="text"` added
   where missing. Quiz option-editor group label unassociated (multi-control group);
   each option input has its own `aria-label`.
8. **Favourites nav.** `/appreciations` NavLink now `end`-matched: on
   `/appreciations/favourites` no nav link is active (screenshot-confirmed); on
   `/appreciations` "Things I See in You" is active.
9. **Appreciations form, Quiet chair, Letters stamp, Reminders duplication.**
   Form frame/alignment scoped (border 1px, left-aligned, gallery cards unchanged);
   chair raised into its panel; stamp given right margin; reminder duplicate paragraph
   removed.
10. **Session-refresh 429 handling.** New `ApiRequestError` carries HTTP status;
    429/5xx on `getMe()` sets a "session unknown" retry state (full retry page when
    signed out, non-blocking banner when signed in) instead of bouncing to `/login`;
    genuine 401 behaviour unchanged; sign-out clears the flag.
11. **Blank reminders + strict dates.** Reminder `text: trim().min(1).max(2000)`;
    `isoDate` round-trips UTC components so impossible calendar dates 400.
12. **Dead code + schema comment.** Four dead exports removed (§1 ENG-3);
    `schema.prisma` header corrected. Migration-file header intentionally NOT edited
    (§1 ENG-4).

## 3. Tests actually executed and their results

All test databases were disposable and local; all test servers were stopped and all
disposable databases/roles dropped at the end of each worker's run
(`audit_lpcu`, `audit_lpcu2`, `audit2_qa` + role `audit2`, `sectest_20261103`,
`qa_func_20261103` + role `qa_func`, `lp_fixqa`, `lp_fixqa2` + role `lpfix`).
Sibling workers' servers were never stopped or modified. No production system was used.

### Prior-run evidence — verified, NOT re-claimed as new tests

- `~/workspace/release-audit-qa/qa-results.json`: 54 SHOT + 1 login DONE — visual shots
  only, no functional/security results. Reused only as screenshots to inspect.
- `~/workspace/release-audit-qa/page-errors.json` (231 lines: 3×401, 188×404, 40×429):
  characterisation independently reproduced — logged-out game-progress GETs → 401
  (expected), logged-in GETs for keys with no row → 404 for all 7 keys including
  `hero-adventure` (expected by design; 200 once a row is PUT), unknown key → 400, and
  the 429s are the documented 300/min/user limiter (reproduced with a 320-request
  burst, first 429 at request #298). The prior summary omitted the 429s; they are a
  QA-process note (repeated-load sweeps trip the limiter), not an app defect.
  Two files named `INVALID-superseded-by-*` are 429 artifacts and were ignored.
- Evidence-integrity defect in the prior set (not a product defect): SHA-256 showed
  `a11y-arcade-390.png` = `a11y-board-play-390.png` = `a11y-board-setup-390.png` =
  `a11y-hero-map-390.png` (same arcade shot), `visual-memory-wall-390-recheck.png` =
  `visual-memory-wall-390.png`, and `visual-arcade-hero-intro-1200.png` =
  `visual-arcade-hero-inplay-1200.png` (mission lists, no gameplay canvas). The fix QA
  re-shot the hero canvas for real; board setup/play at 390px as distinct views remain
  unshot (see §4).

### This audit — visual + accessibility (visual worker, own disposable stack)

- Personally opened and judged: login, register, welcome, Home first-visit/entered
  (1200/768/390), Space, Memory Wall (1200/390), Letters, Quiet, Appreciations, Future,
  Reminders, Deleted, Settings, Favourites, NotFound, Arcade, memory/photo match, board
  (1200/390, midgame, roll), hero map/level (1200/390), catch-hearts/chest play,
  final-message, focus shots, and the reference photograph. Remaining files were
  listed/hashed, not visually judged (several oversize fullPage files exceed the image
  reader's limits; thumbnails illegible) — no verdict was invented for them.
- Measured: horizontal overflow at 390px = **390 = scrollWidth on all 14 routes**
  (home, memories, letters, quiet, appreciations, favourites, future, reminders,
  deleted, settings, space, arcade, welcome, notfound) — no page-level horizontal
  scroll. One in-page exception: Future has an SVG `<text>` element with scrollWidth
  549 at 390px (possible clipped SVG internals, not page overflow; Future map at 390px
  not screenshot — §4).
- Contrast pairs measured (real backgrounds): body 11.17 pass; ink-soft on cream 6.52
  pass; white/terracotta 3.46 fail → fixed to 4.92; white/sage 3.64 fail → fixed to 4.63;
  white/terracotta-deep 4.92; plate title white on wood 4.85 pass. (An early sampler
  reading of 3.04/1.78 for footer/nav was a transparent-background artifact and is NOT
  cited.)
- Focus: 14 consecutive Tab stops on Home at 1200px, every stop a 3px solid
  `rgb(192,120,86)` outline, logical order (brand → 7 room links → Deleted → Settings
  → front-door → Mailbox → "Come on in." → Garden). Hero canvas is `role="img"` with a
  descriptive aria-label; Tab reaches its labelled touch buttons.
- Reduced motion: OS emulation AND account preference both give zero running CSS
  animations on Quiet Room (only 0.16s transitions) — pass on both axes.
- Lazy-image caveat (not a defect): the prior Memory Wall 390px shot showed the Night
  Garden photo as an empty box because `loading="lazy"` had not fired before the
  fullPage capture; re-shoot after scroll-into-view shows the photo rendering
  (naturalWidth 1200, `?size=display`). Future fullPage runs should scroll into view
  first.
- New shots from this audit (in `~/workspace/release-audit-qa/`, NOT committed):
  `audit2-*` (entered Home 390, Memories photo 390, board 390, hero canvas 1200 +
  after-keys, Quiet reduced-motion ×2, focused Memories input) and `fix-*` (Home
  1200/390, Appreciations form, Favourites nav, board 390, final message 1200/390,
  letters, quiet, reminders, plus `fix-qa-report.json`).

### This audit — functional (functional worker, disposable DB + built frontend)

- **Grand total: 237/254 pass.** Non-passes = 15× HTTP 429 artifacts (300/min window
  tripping during the board play loop — re-passed when paced) + 2 completions not
  observed (below, not defects).
- Auth/session 22/22; pairing 16/16; navigation/refresh 31/31 (deep link + refresh on
  all 13 destinations, back/forward, board game restores after reload with same turn
  and 1500/1500 coins); CRUD 46/46 (all 7 content types incl. plan-complete, favourite
  toggle/filter, soft-delete → Deleted → restore → permanent delete); photo 14/14;
  letters 15/15 (future scheduled letter hidden from partner in list, detail 404,
  counts 4-vs-2, export; revealAt edit flips visibility); journal/voice isolation 9/9;
  games API 39/39 + UI completions 5/5 + persistence 11/11 (Photo Match 4/4 in 7 moves,
  Catch the Hearts 60/60 in 30s, Symbol Match 8/8 in 24 turns, mini-mystery solved,
  Sample Quiz 4 answered; every completion persisted and re-read after fresh re-login,
  per-player 404 isolation); board 37/37 excluding 11× 429 artifacts + 1 not-observed
  (rules before play, stale 409, forged-coins 400, out-of-turn 400, end-early draw at
  1500 each, GAME_FINISHED 400, snapshot isolation + restart-from-old-snapshot,
  refresh-restore identical GETs, negative startCoins 400, config delete, games
  survive config deletion; bankruptcy verified deterministically on an all-tax board);
  states API 11/11 + browser states pass (blank-submit message, save confirmations,
  empty lists, explanatory empty states, mystery retry message).

### This audit — security (security worker, disposable DB, API-level, 3 accounts)

- **340 logged probes + whole-tree greps.** Unauthenticated 66 (0 real failures; 7
  early 403 rows were a harness bug — anon CSRF token not captured — re-probed with a
  valid token → all 401); unauthorized reads 61 (8 rows = SEC-1, now fixed); unauthorized
  writes 64 (0); forged game state / identity 61 (1 row = SEC-3 proposal); membership
  18 (0); storage 12 (0; 1 early row was a harness bug — raw fetch without Cookie
  header — re-probed → pass); validation 45 (1 row = SEC-2, now fixed); page-errors
  re-verification 13 (0). Secrets + rendering greps: 0 real findings.
- Probe method: accounts A+B paired in one space, C in a separate space; built API on
  127.0.0.1 only. Live-browser UI flows were NOT probed by this worker (no live browser
  for subagents); partner-privacy UI paths were checked separately by the fix QA
  (Partner B does not see Partner A's per-user favourite — pass).

### This audit — engineering (engineering worker)

- Root `npm run typecheck`: exit 0, no warnings. Root `npm run build`: exit 0, no
  warnings (CSS 41.03 kB, JS 453.83 kB at audit time; 41.08 kB / 454.79 kB after fixes).
- All 6 migration files applied in order with `ON_ERROR_STOP=1` to a fresh disposable
  DB, each exit 0, zero error lines; the 6 `release-audit-qa/mig/*.sql` copies diffed
  byte-identical to the repo originals. Result: 29 tables = 29 models in
  `schema.prisma` (zero missing, zero extra), zero column drift, all 7 enums present,
  49 FK constraints, 48 non-PK indexes reconciled exactly.
- `vercel.json` route coverage checked route-by-route against `App.tsx` (see ENG-1);
  DEPLOYMENT.md step order verified correct; zero guessed URLs in either file.
- Env vars: all 12 API vars agree across `.env.example`, `config.ts`, and
  DEPLOYMENT.md (see §5); frontend needs no env vars (no `VITE_*` / `import.meta.env`
  in frontend source).
- Own isolated stack: one startup line, one-line error logs, no startup/deprecation
  warnings, no stack traces; `/health` 200, `/health/ready` 200, unauthenticated
  `/auth/me` 401, missing game-progress 404, unknown route 404, bad-origin POST 403.

### Fix verification (fix worker, after all fixes)

- Root `npm run typecheck` ✅, root `npm run build` ✅ (CSS 41.08 kB, JS 454.79 kB).
- API tests on disposable DBs (migrations via `psql`; Prisma engine download fails in
  sandbox, as before): new cross-space test **2/2**; security **17/17**; shared-rooms
  **5/5**; phase3 **5/5**; phase4 **7/7**; phase5 **8/8**; hero **10/10**; boyfriend
  **11/11**; board **25/25**; media **4/4**; unit **79/79**.
- Browser QA (Playwright sandbox recipe, built frontend + disposable API): overflow at
  390px **0px** on Home, Appreciations, Favourites; footer count 1; board cell wrap at
  spaces; labels associated; contrast + touch re-measured (§2.5); partner-privacy UI
  check pass; `/reminders` deep link 200 + renders. New `fix-*` screenshots listed
  above. Note: the 429 refresh branch is code-verified only (no frontend test harness
  exists; exercising it needs rate-limit saturation in a live browser).

## 4. Known limitations (what was NOT verified, and why)

- **Production `prisma migrate deploy` NOT run** — Node engine download fails through
  the sandbox egress proxy (ECONNRESET, reproduced first-hand). Raw-psql migration
  validity is proven; the Prisma-managed migrate path on a fresh production database
  remains the untested step and must be watched on first deploy (DEPLOYMENT.md step 2).
- **`npm audit` NOT obtainable in sandbox** — registry audit endpoint blocked by egress
  policy (403 `policy_denied`). No severity counts exist to report; nothing was
  upgraded. Re-run outside the sandbox before release.
- **Live Vercel behaviour NOT tested** (especially the `/reminders` 404) — inferred
  from `vercel.json` content; no Vercel project was touched. The fix is one rewrite
  line, but it is only proven once a real deployment serves `/reminders` on refresh.
- **Production hosting, database, storage, email** — untouched by design; see §5.
- **Prior-evidence gaps carried forward:** no genuine prior shot of board setup/play at
  390px, hero map at 390px as its own view (duplicates, §3); Future map at 390px not
  screenshot (549px SVG text element needs a visual check); board/memory-match
  keyboard-only playthroughs not exercised end-to-end (buttons are natively tabbable);
  screen-reader announcement order not tested (no screen reader in sandbox);
  768px shots exist only for Home, Home-entered, and Arcade; colour-blindness
  simulation and 200%/400% zoom reflow not run.
- **Functional gaps:** session absolute/idle expiry by time travel; password-change
  revocation; UI photo-upload clicks, voice-note playback, Deleted-page UI clicks,
  export download, SpaceForms UI clicks (API equivalents all verified); hero full UI
  playthrough (keyboard movement/gap-checkpoint verified, full 15-token UI run not
  driven); trading-board UI win (119 turns, no win) and natural DB board finish by
  roll/buy alone (607 actions, still playing — finish verified via end-early +
  bankruptcy instead); loading-spinner capture (local responses too fast); oversize
  uploads (caps enforced in code before processing, no real 11 MB image uploaded);
  concurrency races beyond the board version compare-and-swap (sequential probes
  only); login-lockout depth (single wrong-password 401s only); email flows beyond
  password-reset 501 deferred.
- **429 refresh path in a live browser:** not exercised (needs rate-limit saturation);
  logic code-reviewed, success path QA-verified via login.
- **Local sandbox side effects (not app defects):** during the audit, workers changed
  the local Postgres `postgres` role password while setting up disposable databases
  (values not recorded, prior value unknown, not restored) and one VM replay
  reinstalled system Postgres and wiped `/tmp`. All audit workers used their own
  roles and reported no DB-auth failure; pooled connections stayed alive. If a local
  test server fails DB authentication on restart, investigate local Postgres auth
  first, not the app. No production credential was ever involved.
- **Transient, unreproduced:** one fresh-session `GET /auth/me` → 500 `INTERNAL_ERROR`
  with the safe generic envelope (no stack/SQL) during the security run, not reproduced
  in 8 immediate follow-up authed reads; fresh logins kept working. Flagged here so a
  recurrence after a server restart is investigated as DB-auth first (see above).
- **One unexplained 403 `/auth/preferences`** in one earlier board QA run, never
  reproduced, not board-related — carried forward unchanged.

## 5. Manual configuration still required

Nothing below is done; each item needs Sachi's decision or action (asked 2026-11-02,
no reply recorded). These are the Phase 7 deployment blockers, unchanged by this audit:

1. Vercel team access re-authorized for `sachirokadia23-3354s-projects`, OR a
   brand-new separate Vercel project for the new stack.
2. A hosted Postgres `DATABASE_URL` via secure entry, OR an account to create one
   under (Render/Neon/other).
3. An API host (Render account access, or another host she prefers).
4. Confirmation whether replacing the currently live old app is intended, or the new
   stack deploys separately.
5. A production storage provider decision for durable uploads (or accept uploads won't
   persist across host restarts; Postgres records would still persist).
6. Before release outside the sandbox: re-run `npm audit` and confirm
   `prisma migrate deploy` on the fresh hosted database.
7. Personal content still outstanding from Sachi (unchanged): photo dates, the 8th
   photo file ("Ussss"), letters, future plans, voice notes, and her answers for the
   25 open quiz questions if she wants them as a guessing quiz. None of it is seeded;
   the app ships with labelled generic samples/drafts only.
8. Open product decisions (proposals, not blockers): hero-mission reward visibility
   (SEC-3), seal-badge contrast palette, unused `cors` dependency removal, lint
   toolchain adoption, nav collapse at small widths.

## 6. Deployment instructions

Follow `DEPLOYMENT.md` in the repo (step order verified correct; the fix commit
corrected its migration list and route checklist). Summary — no deployment was
performed, no URL is claimed, no host is guessed:

1. **Hosted database first.** Create the hosted Postgres database and record its
   `DATABASE_URL` via secure entry (never in chat, never in a committed file).
2. **Migrate, never push.** Run `prisma migrate deploy` against the hosted database
   (never `db:push`). All six migrations in order: `20251101000000_init`,
   `20251102000000_game_progress`, `20251103000000_user_preferences`,
   `20251104000000_boyfriend_arcade`, `20251105000000_hero_adventure`,
   `20251106000000_board_game`. Watch this step: it is the one step unverified in
   this sandbox (§4).
3. **API host.** Deploy the API (`apps/api`) to the chosen host with the env vars in
   §5 of this report (names + purposes only; values via the host's secret store).
   Required: `DATABASE_URL`. Production: `FRONTEND_ORIGIN` (the real frontend origin),
   `NODE_ENV=production`. Storage stays `local` ONLY for dev — any other
   `STORAGE_BACKEND` value fails fast at startup until a production provider is
   decided (§5 item 5); do not set a provider value speculatively.
4. **Frontend + same-origin `/api` proxy.** Deploy the frontend (Vercel project, build
   `npm --workspace @little-place/frontend run build`, output `apps/frontend/dist`).
   The session cookie is `SameSite=lax`, so auth only works same-origin: add the
   `/api` rewrite to the real API host **BEFORE** the SPA-fallback rewrites in
   `vercel.json` (rewrites are evaluated in order, or API calls are swallowed by
   `/index.html`). The current `vercel.json` deliberately has NO `/api` proxy because
   no API host exists yet — do not invent one.
5. **SPA fallbacks.** `vercel.json` now covers all 14 routes (`/login`, `/register`,
   `/welcome`, `/space`, `/memories`, `/letters`, `/quiet`, `/appreciations`,
   `/appreciations/favourites`, `/future`, `/reminders`, `/arcade`, `/deleted`,
   `/settings`; `/` serves `index.html` by default; no rewrite for the client-side
   NotFound catch-all).
6. **Live verification (mandatory before any announcement).** Open the live URL and
   test: auth (register/login/logout/refresh), deep links + refresh on every route
   (especially `/reminders`), mobile width, persistence (create → refresh → still
   there), private-content protection (partner cannot see private journals/drafts/
   undelivered letters), and one full game flow. Success may only be announced after
   the live URL itself passes these checks.

### Required environment variables (names + purposes only, no secrets)

API (`apps/api/.env.example`, `config.ts`, DEPLOYMENT.md all agree; no gaps found):

| Variable | Required? | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes (startup throws without it) | Hosted PostgreSQL connection string |
| `FRONTEND_ORIGIN` | Yes in production (code default `http://localhost:5173`) | Comma-separated allowed origins with credentials |
| `PORT` | No (default `4000`) | API listen port |
| `NODE_ENV` | No (default `development`; `production` enables HSTS) | Environment flag |
| `STORAGE_BACKEND` | No (default `local`) | Must stay `local`; any other value fails fast at startup (production provider undecided) |
| `STORAGE_DIR` | No (default `./storage-dev`) | Dev-only local storage directory |
| `SESSION_ABSOLUTE_DAYS` | No (default `30`) | Absolute session lifetime, days (proposed) |
| `SESSION_IDLE_DAYS` | No (default `7`) | Idle session lifetime, days (proposed) |
| `RESTORE_WINDOW_DAYS` | No (default `30`) | Soft-delete restore window, days (proposed) |
| `INVITE_EXPIRY_DAYS` | No (default `7`) | Invitation-token expiry, days (proposed) |
| `PHOTO_MAX_MB` | No (default `10`) | Photo upload limit, MB (proposed) |
| `VOICE_MAX_MB` | No (default `25`) | Voice-note upload limit, MB (proposed) |

Frontend: no environment variables (no `VITE_*`, no `import.meta.env` in frontend
source; dev proxy `/api` → `localhost:4000` is vite config only).

## 7. Remaining visual differences from the reference

Honest constraint, restated: the original Home reference is a night-cottage garden
**photograph** (`~/workspace/user/media_library/image/image.png`), not a UI screenshot.
No pixel-perfect UI match exists or is claimed. Home is judged against the approved
presentation built from it, and the differences from that presentation are:

- **Photograph vs illustration (by design, not a defect).** The app renders an
  original CSS/SVG storybook cottage (terracotta roof, sage door, sun, cloud) on a
  cream paper card — it does not reproduce the night photograph, its garden, lighting,
  or photographic detail. This is the approved presentation from Phase 2, not a
  regression.
- **Partner avatars not visible in Home evidence.** The approved presentation lists
  partner avatars; no Home screenshot (first-visit, entered, 1200/768/390) shows avatar
  imagery — the header shows only the space name text. Either avatars render elsewhere
  or they are absent; judged as a gap, not a defect, on this evidence alone.
- **Entered-Home garden path.** The picket-fence element under the cottage door reads
  as a row of pipes/bars at some widths; judged to be the fence element, not stray
  text, and left unchanged (VIS-11).
- **Sun clipping at 390px (entered Home).** The sun in the entered-Home plate is
  clipped by the plate's top-right edge (half-sun); at 1200px it sits inside the green
  band. Minor, unfixed.
- **Nav chrome at small widths.** At 768px the nav wraps to 2 rows, at 390px to 4 rows;
  no horizontal overflow results, but it dominates the viewport (VIS-14, accepted).
- **Room-by-room consistency.** After the fixes, all rooms share one visual language
  (cream paper, warm brown typography, sage/terracotta accents, serif headings).
  Remaining minor divergences, all documented in §1 and none blocking: Quiet Room
  lamp/chair now inside its panel (fixed); Letters stamp now clears the card edge
  (fixed); Future quest-card stitch border and map-pill overlap (minor, unfixed);
  Appreciations form now matches other room forms (fixed); Favourites nav state now
  correct (fixed). 768px coverage exists only for Home, Home-entered, and Arcade, so
  mid-breakpoint consistency for other rooms is unphotographed, not failed.
- **Games.** Hero canvas (first real gameplay shot this audit) renders cleanly with no
  clipping; board reads cleanly at 1200px and wraps at spaces at 390px after the fix;
  arcade index, memory/photo match, chest, catch-hearts, quiz, and mystery views are
  visually consistent with the rooms. Arcade page shows a state-dependent 3px overflow
  at 390px in the fix QA state (VIS-12, proposal).
