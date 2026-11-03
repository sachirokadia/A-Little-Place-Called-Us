#!/usr/bin/env bash
# Vercel build for "A Little Place Called Us" (new stack).
# Runs in Vercel's build environment, where the project's own environment
# variables are available. No secret values appear here or in logs.
# Order matters:
#  1. Build the shared package (the API imports it).
#  2. Generate the Prisma client. Generation does not connect to the
#     database, but Prisma requires the datasource env var to be set,
#     so a dummy localhost value is used when the real one is absent.
#  3. Build the API (the serverless function imports apps/api/dist).
#  4. Apply migrations with prisma migrate deploy (NEVER db:push).
#     This MUST use the non-pooling database URL: migrations must not
#     run through a pooler. If POSTGRES_URL_NON_POOLING is unset (the
#     Postgres store is not connected yet), this step fails and the
#     deployment fails closed rather than shipping without a schema.
#  5. Build the frontend.
set -euo pipefail
npm --workspace @little-place/shared run build
DATABASE_URL="${POSTGRES_URL_NON_POOLING:-postgresql://dummy:dummy@localhost:5432/dummy}" npm --workspace @little-place/api run db:generate
npm --workspace @little-place/api run build
DATABASE_URL="${POSTGRES_URL_NON_POOLING:-}" npm --workspace @little-place/api run db:migrate:deploy
npm --workspace @little-place/frontend run build
