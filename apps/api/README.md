# API — Phase 1A (secure core only)

Express + TypeScript + Prisma + Zod. PostgreSQL is the only durable
store; Prisma is the sole schema authority. There is no boot-time
schema creation and no second migration system.

## Endpoints (all under `/api/v1`)

- Health: `GET /health`, `GET /health/ready` (no user data).
- Auth: `GET /auth/csrf`, `POST /auth/register`, `POST /auth/login`,
  `POST /auth/logout`, `POST /auth/logout-all`, `GET /auth/me`,
  `PATCH /auth/me`, `POST /auth/password-change`,
  `POST /auth/password-reset/request|confirm` (DEFERRED, 501, R3).
- Spaces: `POST /spaces`, `GET /spaces/me`, `GET /spaces/:spaceId`,
  `POST /spaces/:spaceId/invitations`, `POST /spaces/:spaceId/invitations/rotate`,
  `POST /spaces/invitations/join`.
- Content (space-scoped lists, single-item reads/patches):
  `memories`, `letters`, `journals`, `appreciations`, `plans`,
  `reminders`, `voice-notes` — each with `POST /:id/soft-delete`,
  `POST /:id/restore`, `DELETE /:id` (permanent, only after soft
  delete), plus `POST /:id/favourite` where applicable, and
  `POST /plan/:id/complete` (the only path to `done`, with optional
  linked memory in the same transaction).
- Media: `POST /spaces/:spaceId/media` (multipart),
  `GET /media/for/:linkedType/:linkedId`,
  `GET /media/:id` (authenticated stream, no public URL),
  `DELETE /media/:id` (soft-delete; bytes are removed with the
  linked item's permanent delete via a MediaDeletionJob).

## Visibility (enforced in the query, never frontend-only)

- Shared items: both space members read; only the author edits,
  soft-deletes, restores, or permanently deletes (favouriting is
  per-user and does not edit the row).
- Private journals and private draft letters: author only, on every
  query. A partner gets a generic 404 / empty list, never a title,
  count, or existence signal.
- Scheduled letters: fully hidden from the partner until delivery
  (server time, `now() >= revealAt`); the body is additionally
  stripped by the serialiser as defence in depth. This is the
  Phase 1A default; envelope visibility is R6, UNDECIDED.
- Soft-deleted items disappear from partner lists immediately and
  appear only in the author's Deleted view.

## Sessions and CSRF

- Individual accounts; Argon2id when the native module loads,
  otherwise the documented bcrypt-12 fallback (logged at startup).
- Sessions are server rows holding only a SHA-256 token hash.
  The browser holds an HTTP-only cookie (no `Domain` attribute,
  `SameSite=Lax`, `Secure` in production) and a session-bound
  CSRF token in memory, sent as `X-CSRF-Token` on state-changing
  requests. Anonymous public routes use a double-submit cookie.
- Logout revokes the row; logout-all revokes all rows; password
  change revokes all other sessions and rotates the CSRF token.
- Production cookie model (custom domains vs Vercel proxy vs
  `SameSite=None`) is R1, UNDECIDED. Local dev uses the Vite
  same-origin proxy (Option B shape).

## Environment

Copy `.env.example` to `.env` (gitignored) for local dev. The API
fails fast if `DATABASE_URL` is missing or if `STORAGE_BACKEND`
is anything other than `local` — the production storage provider
is UNDECIDED (R2), and `local` is DEV ONLY.

Proposed, UNDECIDED values (see the root README): session
30d absolute / 7d idle (R12), invitation expiry 7d (R4),
restore window 30d (R7), photo 10 MB / voice 25 MB (R13),
rate limits in `src/lib/rateLimit.ts` (R11).

## Migrations

Production path: `prisma migrate deploy` using the versioned
migration in `prisma/migrations/20251101000000_init/` (generated
from the schema, plus reviewed row-local CHECKs for scheduled
letters, plan completion, and exactly-one-media-link).
`prisma db push` is for disposable local dev only.

Deliberate, flagged deviation from spec §3.3: the proposed
at-most-one-active-asset-per-item partial index is NOT applied,
because the brief requires memories to support multiple photos.

## Sandbox note: Prisma engine downloads

In this sandbox, Node's Prisma engine download fails through the
egress proxy while curl succeeds. The workaround used here was a
local mirror: download the engine `.gz` files with curl into a
local directory tree, serve it on localhost, and run Prisma with
`PRISMA_ENGINES_MIRROR=http://127.0.0.1:<port>` plus
`PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1` (with `.sha256` files
for the binaries). In a normal environment, plain `prisma
generate` / `prisma migrate deploy` work without this.

2026-11-02 note (shared-rooms work): Node engine downloads still
failed in this sandbox (`ECONNRESET`, even with the egress CA
supplied via `NODE_EXTRA_CA_CERTS`), so `prisma migrate deploy`
could not run. The disposable test database was instead built by
applying the three versioned `prisma/migrations/*/migration.sql`
files directly with `psql`, in order — the same schema, no
migration invented, and the already-generated Prisma client was
used unchanged for the test run. That fallback is for disposable
test databases only; production still uses `prisma migrate deploy`.

## Tests

- Unit: `npm run test:unit` (no database).
- Integration: point `DATABASE_URL` at a disposable test
  database, apply migrations, then run the integration files
  one at a time (they share rate-limit budgets):
  `npx vitest run tests/integration/media.test.ts` then
  `npx vitest run tests/integration/security.test.ts`.
  These cover spec §8 T1–T12 and T14–T20 as applicable to core;
  T13 (games/board) is Phase 1B and is not implemented.
  Browser end-to-end tests (spec §8.1) are NOT done in 1A —
  that is a Phase 1C item, and no browser claim is made here.

## Export and preferences (Phase 5)

- Export: `GET /spaces/:spaceId/export` (session-authenticated,
  space-membership enforced; a non-member gets a generic 404).
  Returns JSON (`application/json`; the frontend downloads it as a
  file) with `spaceId`, `spaceName`, `exportedAt` (server time),
  `exportNote`, and only shared, non-deleted records: `memories`
  (with an active-media count per memory, never a storage key or
  URL), `letters` (shared, or scheduled with `revealAt <= now` on
  server time), `appreciations`, `plans` (with an active-media
  count), and `reminders` (shared notes; they have no private
  variant). Private draft letters of anyone, undelivered scheduled
  letters, private journals, and voice notes are excluded at the
  query level — they do not appear in any count either.
- Preferences: `GET /auth/preferences` and `PUT /auth/preferences`
  (model `UserPreference`, one row per user, migration
  `20251103000000_user_preferences`). GET creates the default row
  on first read. PUT uses strict validation: `motion` must be
  exactly `system` | `reduce` | `full`, `soundEnabled` and
  `onboardingSeen` booleans; unknown fields — including a
  body-supplied `userId` — are rejected, and the row is always
  scoped to the session caller. Defaults: `motion: 'system'`
  (the frontend defers to the OS `prefers-reduced-motion`
  setting; a user-set `reduce` overrides it), `soundEnabled:
  false` (sound is OFF by default), `onboardingSeen: false`.
- Favourite hardening: `POST /:id/favourite` now only succeeds
  for a row the caller can see under the existing visibility
  rules; an invisible row (soft-deleted, or in a space the
  caller is not a member of) returns a generic 404. No other
  content route behaviour changed.

## GameProgress (Phase 4, Secret Arcade)

Per-player only — no scores, leaderboards, or rankings endpoint.
`GET /spaces/:spaceId/game-progress/:gameKey` returns
`{ data: { gameKey, progress } }` for the caller's own row, or a
generic 404 (a partner's row, a missing row, and a non-member all
look identical). `PUT` on the same path upserts the caller's row
only; a body-supplied `playerId` is rejected, never used to scope
the row. Allowed `gameKey` values: `memory-match`, `mystery`,
`quiz`, `arcade-unlocks` — anything else is a 400. Progress is
validated server-side (strict shapes, unknown keys rejected);
invalid shapes are 400 `VALIDATION_ERROR`. No letters, memories,
or journal text is stored in progress. Game-progress writes are
not audit-logged: no `gameProgress.*` audit event type exists in
the codebase, and none was invented for this route.
