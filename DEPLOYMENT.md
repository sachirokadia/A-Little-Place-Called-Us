# Deployment guide — A Little Place Called Us (new stack)

> **Status: DEPLOYMENT IN PROGRESS — a new, separate Vercel project has been
> created (see below) and the API serverless adaptation is committed, but
> the live URL is NOT yet verified.** No deployment has been announced.
> The old Vercel project `a-little-place-called-us` is untouched and still
> serves the old application. Do not announce a live URL from this
> document until the verification checklist below has been run against
> the real live URL and every item passes.

## What is being deployed

A monorepo in this repository:

- **Frontend:** `apps/frontend` — React + TypeScript + Vite, React Router
  (`BrowserRouter`). Build: `npm --workspace @little-place/frontend run build`,
  output: `apps/frontend/dist`.
- **API:** `apps/api` — Node + Express + TypeScript, Prisma + PostgreSQL.
  Build: `npm --workspace @little-place/api run build`; start: `node dist/index.js`
  (via `npm --workspace @little-place/api run start`).
- **Shared:** `packages/shared` — validation schemas shared by API and frontend.

The frontend and the API are **separate processes**. The frontend contains
no `VITE_*` variables and talks to the API over relative `/api` paths, so
in production the frontend host must proxy `/api/*` to the API host on the
**same origin** (see "Same-origin API proxy" below). Do not point the
frontend at a cross-origin API host without first changing the session
cookie model — see the blocker note.

## Environment variables (API)

Set these through the hosting provider's secure environment-variable
mechanism (dashboard / secret store). **No real values are recorded in
this repository, in this document, or in any screenshot.** The only
`.env` file in the repo is the placeholder `apps/api/.env.example`; copy
its shape, never its placeholder text, into the host.

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | Hosted PostgreSQL connection string for a database the project owns. The API fails at startup without it (`requireConfig`). |
| `FRONTEND_ORIGIN` | Yes in production | Comma-separated list of allowed frontend origins (the production site origin). Requests from other origins are rejected. |
| `PORT` | No (default `4000`) | Port the API listens on; set to whatever the API host requires. |
| `NODE_ENV` | No (default `development`) | Set to `production` on the API host. |
| `STORAGE_BACKEND` | No (default `local`) | **Must stay `local` until a production storage provider is decided.** Any other value fails fast at startup by design (see "Storage limitation"). |
| `STORAGE_DIR` | No (default `./storage-dev`) | Directory used only by the dev-only local storage backend. |
| `SESSION_ABSOLUTE_DAYS` | No (default `30`) | Absolute session lifetime in days. |
| `SESSION_IDLE_DAYS` | No (default `7`) | Idle session lifetime in days. |
| `RESTORE_WINDOW_DAYS` | No (default `30`) | Soft-delete restore window in days. |
| `INVITE_EXPIRY_DAYS` | No (default `7`) | Invitation-token expiry in days (long hashed tokens only). |
| `PHOTO_MAX_MB` | No (default `10`) | Photo upload limit in megabytes. |
| `VOICE_MAX_MB` | No (default `25`) | Voice-note upload limit in megabytes. |

The session lifetimes, restore window, invite expiry, and upload limits
above are the spec's **proposed, undecided** defaults (R4, R7, R12, R13);
they are configurable, not decided product rules, and changing them is a
configuration change, not a code change.

The frontend needs **no** environment variables.

## Same-origin API proxy (required, and the reason this is not yet deployable)

The session cookie is `SameSite=lax`. A cross-origin API host would
break authentication in the browser, so the viable production model is a
**same-origin proxy**: the frontend host rewrites `/api/*` to the API
host, and the browser sees one origin.

- The API runs as a Vercel Serverless Function in the SAME project as
  the frontend: `api/v1/[...all].ts` wraps the existing Express app
  (`apps/api/dist/app.js`, built by `scripts/vercel-build.sh`) without
  replacing the long-running server used in local development
  (`node dist/index.js`). Filesystem routing serves `/api/v1/*` from
  that function before the SPA fallbacks, so `/api` is same-origin by
  construction and NO `/api` proxy rewrite is needed or added.
- The function maps the Vercel Postgres pooled URL onto `DATABASE_URL`
  (`POSTGRES_PRISMA_URL`, else `POSTGRES_URL`) before importing the app,
  and writes dev-only local storage under `/tmp` (non-durable — see
  "Storage limitation"). Migrations run at build time from
  `POSTGRES_URL_NON_POOLING` (never through a pooler, never `db:push`).
- Do not deploy the frontend alone and point it at a cross-origin API:
  sign-in would appear to succeed and then fail on the first
  authenticated call.

## Database and migrations (required before any production use)

- Provision a hosted PostgreSQL database the project owns. **Do not reuse
  the old Supabase project as the new database** (that project's data was
  deleted at the owner's explicit order, and its credentials were never
  recorded); the new stack needs its own database.
- Apply the versioned Prisma migrations in order, with
  `prisma migrate deploy` (script: `npm --workspace @little-place/api run
  db:migrate:deploy`):
  `20251101000000_init`, `20251102000000_game_progress`,
  `20251103000000_user_preferences`, `20251104000000_boyfriend_arcade`,
  `20251105000000_hero_adventure`, `20251106000000_board_game`, `20251107000000_final_messages`.
- **Never run `prisma db push` against production.** Migrations are the
  sole schema authority.
- There is **no data migration** from the old application: no old records,
  passwords, or media are imported. Both partners start with fresh
  accounts on the new deployment (see "First-run setup" below).

## Storage limitation (read before enabling uploads in production)

The only storage backend in the code is the **dev-only local filesystem**
(`STORAGE_BACKEND=local`). On a hosted service that filesystem is
ephemeral: uploads would not durably persist across restarts or
redeploys, and media served through the API gate would disappear with
them. Until a production storage provider is decided (open decision R2),
treat uploads on any hosted deployment as **non-durable**, and do not
present uploaded media as permanently stored. Choosing and wiring a
production provider is a separate, explicitly approved step — it is not
done by this document, and no provider, bucket, or key is named here.

## SPA fallback (deep links and refreshes)

The frontend uses `BrowserRouter`, so opening or refreshing a deep link
such as `/memories`, `/letters`, `/quiet`, `/appreciations`,
`/appreciations/favourites`, `/future`, `/reminders`,
`/arcade`, `/deleted`, `/settings`, `/space`, or `/welcome` must serve
`index.html` and let the router render the room — otherwise the host
returns a 404 for a valid room. The repo-root `vercel.json` provides
those fallbacks for Vercel. On any other frontend host, configure the
equivalent SPA fallback for exactly those routes (plus `/login` and
`/register`); do not add a catch-all that also swallows `/api/*`.

## First-run setup (once the blockers below are resolved)

1. Create the hosted PostgreSQL database; set `DATABASE_URL` on the API
   host through its secure mechanism.
2. Run `prisma migrate deploy` against that database (never `db:push`).
3. Deploy the API host; note its internal address (never publish it as
   a public URL unless the host design requires it).
4. Add the same-origin `/api` rewrite to the frontend host **before**
   the SPA fallbacks; set `FRONTEND_ORIGIN` to the production site
   origin; set `NODE_ENV=production`.
5. Deploy the frontend from the repo root (build command and output
   directory in `vercel.json`).
6. Run the verification checklist below against the live URL. Only
   after every item passes may a deployment be announced.

No `render.yaml` is included in this repository: adding one would risk
it being mistaken for an applied deployment. If a Render (or other)
blueprint is added later, it must be labelled in this document as an
**unapplied blueprint** until its host, database, and storage actually
exist, and it must contain no real values.

## Verification checklist (run against the live URL, not locally)

- [ ] The live URL loads; sign-in and registration work; sessions
      survive a refresh.
- [ ] Every destination opens by direct link and after refresh:
      Home, Memory Wall, Letters, Quiet Room, Things I See in You,
      Things I See in You favourites (`/appreciations/favourites`),
      Our Future, Reminder Room (`/reminders`), Secret Arcade, plus Deleted, Settings, Space, /welcome.
- [ ] A created shared record persists after refresh, sign-out/sign-in,
      and is visible to the second partner's account.
- [ ] Private drafts and journals are invisible to the other partner,
      including by direct request; the other partner's mailbox shows no
      private draft.
- [ ] A scheduled letter is hidden before its release time and visible
      after it (server time).
- [ ] The app works on mobile (narrow viewport, tappable hotspots and
      game controls, no horizontal overflow).
- [ ] Private content is not publicly accessible: no record, letter
      body, journal, voice note, or media file is reachable without a
      signed-in, space-member session.
- [ ] No credential, token, or secret appears in source, logs,
      screenshots, or any public page.

## Live deployment (new project, separate from the old app)

- **Vercel project:** `a-little-place-called-us-new`
  (`prj_BjkJ21Gs2t026kuOVqOcb4hbKprP`), created in the same team account
  as the old project. The old project `a-little-place-called-us`
  (`prj_5KOVZf2rilHxazfLcT5Bx1cMfr3W`) was NOT touched, reconfigured, or
  redeployed. SSO protection is disabled on the new project so it is
  publicly reachable; `NODE_ENV=production` and `FRONTEND_ORIGIN` (the new
  project's production origin) are set as project environment variables.
- **Database store:** `little-place-called-us-db` — a free Neon-backed
  Vercel Postgres store, Status Available. It must be CONNECTED to the
  new project through Vercel's own mechanism (dashboard: project →
  Storage → connect the store) so its connection variables land as
  project environment variables. No connection string, password, or token
  is recorded anywhere in this repository, and none may be pasted into
  chat, reports, files, or git history. Until the store is connected,
  the build's migration step fails closed and no working deployment
  exists — that failure is by design, not a bug to work around by
  inventing a database URL.
- **Build:** `scripts/vercel-build.sh` (shared build → Prisma generate →
  API build → `prisma migrate deploy` from `POSTGRES_URL_NON_POOLING` →
  frontend build), driven by the repo-root `vercel.json`.

## Current blockers (exact, not worked around)

- **Vercel project:** the existing project `a-little-place-called-us`
  currently serves the **old** application and is deliberately untouched;
  the new stack deploys to the separate project
  `a-little-place-called-us-new` (see "Live deployment" above). Team-scoped
  writes through the connector return 403; project creation and reads
  without an explicit team scope succeeded.
- **Database not yet connected:** the `little-place-called-us-db` Postgres
  store exists (see "Live deployment" above) but is NOT yet connected to
  the new project, so no `DATABASE_URL`/`POSTGRES_*` variables exist on
  the project yet. Connect it through Vercel's own mechanism; do not
  paste any connection string anywhere.
- **Cookie model:** same-origin `/api` proxy required (above); it cannot
  be configured until the API host exists.
- **Storage:** production provider undecided (R2); local filesystem is
  dev-only and ephemeral on a host.
- **Email:** password reset remains deferred (endpoints return
  `PASSWORD_RESET_DEFERRED`); the email provider (R3) is undecided, so
  no reset email can be sent from a deployment yet.
- **Accounts:** no real second user has been configured on any
  production system; both partners will need fresh accounts on the new
  deployment (see "First-run setup").

## What this preparation does NOT do

- It does not deploy anything, reconfigure any hosting project, create
  any database, choose any storage provider, or change any credential.
- It does not overwrite or delete any unrelated deployment or project
  data (the old Vercel deployment and the old local application are
  untouched).
- It does not claim any URL is live. Until the blockers above are
  resolved and the verification checklist has been run against a real
  live URL, there is no verified production URL to hand off.
