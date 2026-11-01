# A Little Place Called Us — Phase 1A (secure core only)

Private, two-person shared app. This workspace is the clean new-stack
baseline. The old application is untouched and is NOT a dependency of
this code.

## What Phase 1A is

- Auth + server sessions (HTTP-only cookie + session-bound CSRF token)
- Spaces for exactly two members, long single-use invitation tokens
- Core CRUD: memories, letters, private journals, appreciations,
  future plans, reminders, voice notes
- API-gated private media (local-filesystem backend is DEV ONLY)
- Soft delete, then permanent delete as a second explicit act
- Audit events (no content bodies), DB-backed rate limits,
  idempotency keys for creates

## What Phase 1A is NOT

- No games, no board game (Phase 1B).
- No email password reset (provider unresolved, R3). The reset
  endpoints return a clear `PASSWORD_RESET_DEFERRED` message and
  send nothing. Do not present this as a working reset flow.
- No production hosting, no deployment, no data migration from the
  old app (R16: none specified).
- No public media URLs, no signed URLs in 1A.

## Proposed defaults are NOT decided rules

Every number below is a PROPOSED default from the Phase 0.3 spec,
exposed as an environment variable so it can be changed without a
code change. It is flagged UNDECIDED in the code and in
`apps/api/.env.example`. Do not quote these as product decisions.

- Session lifetime: 30 days absolute / 7 days idle (R12, UNDECIDED)
- Invitation expiry: 7 days (R4, UNDECIDED — long tokens only in 1A;
  short-code UX is not implemented)
- Restore window: 30 days (R7, UNDECIDED)
- Photo 10 MB / voice 25 MB (R13, UNDECIDED)
- Rate limits: see `apps/api/src/lib/rateLimit.ts` (R11, UNDECIDED)
- Cookie model: local dev uses same-origin Vite proxy (Option B
  shape). Production cookie model is R1, UNDECIDED.

## Run locally (dev only)

Prerequisites: Node 24, npm 10, a local PostgreSQL you control.

1. Copy `apps/api/.env.example` to `apps/api/.env` and fill in a
   local `DATABASE_URL` (never commit `.env`; it is gitignored).
   The API fails fast if `DATABASE_URL` is missing.
2. Install: `npm install` (from this repo root).
3. Create the schema in a disposable local database:
   `npm --workspace @little-place/api run db:push`
   (dev only; production must use versioned migrations in
   `apps/api/prisma/migrations/` — see `apps/api/README.md`).
4. Start the API: `npm run dev:api` (port 4000 by default).
5. Start the web app: `npm run dev:web` (port 5173; `/api` is
   proxied to the API, so the session cookie is same-origin in dev).
6. Open http://localhost:5173, register two accounts, create a
   space with the first, and join it with the second using the
   invitation token shown once at creation.

See `apps/api/README.md` and `apps/frontend/README.md` for the
endpoint list, the visibility rules, and how to run the tests.

## Tests

- Unit tests (no database): `npm --workspace @little-place/api run test:unit`
- Integration tests (real local PostgreSQL, disposable test DB):
  `npm --workspace @little-place/api run test:integration`
  Set `TEST_DATABASE_URL` to a disposable database you own.
  A failing security test blocks any release claim.
