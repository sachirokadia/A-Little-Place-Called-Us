# A Little Place Called Us — new-stack workspace — ISOLATION NOTE ONLY

This folder is intentionally empty apart from this note.

- Status: Phase 0.1 isolation complete. Phase 1 has NOT started.
- No application code, no visual design, no UI implementation here.
- No dependencies installed. No package.json, no src/, no Prisma schema.
- No migrations run, no servers started, no database connected.
- No connection made to any remote database, hosting provider, storage
  service, or production environment.
- No Git repository initialised here yet, and no Git worktree created.

## Why an isolated folder, not a worktree from main

A Git worktree would write metadata into the original repository's .git
directory. An isolated folder avoids touching the original project at all.

The original `main` branch is NOT assumed to be a suitable baseline.
Its HEAD (d4e7a80) carries a dual-backend design — Supabase Auth/RLS/Storage
plus a standalone Postgres API plus demo mode — which conflicts with the
approved new stack. Blindly copying it would carry that conflict forward.

## Proposed Git baseline — for approval, NOT yet selected

Proposed starting point: an empty clean baseline in this folder, not `main`.
A Prisma schema and application code would be derived later, only after
explicit Phase 1 approval, and would not be copied blindly from the old app.

Until that approval, this folder stays empty by design.

## Approved decisions recorded here (not implemented)

- Frontend hosting: Vercel
- API hosting: Render
- Database: standalone PostgreSQL (not Supabase as the new database)
- Media: private object storage
- Stack for later phases only: React, TypeScript, Vite, React Router,
  Tailwind CSS, Motion, Express with TypeScript, Prisma, standalone
  PostgreSQL, secure HTTP-only cookie sessions, private object storage

## Related paths — preserved separately, untouched

- Original application (unchanged):
  ~/workspace/little-place-called-us
  Branch main, HEAD d4e7a8061f8737e6e6c853fddd29b02e5242dc4f
- Preservation of modified + untracked work (Phase 0.1):
  ~/workspace/little-place-called-us-preservation-20261101-2131
  See MANIFEST.md there. Nothing from that preservation was copied here.

## Existing production — untouched

The existing production application, Supabase project, live deployment,
credentials and environment settings were not changed, read (for secrets),
or connected to in this phase.
