// Vercel Serverless entrypoint for the API (production only).
//
// The long-running Express server (apps/api/src/index.ts, `node dist/index.js`)
// is UNCHANGED and remains the local-development path. This file exists so
// the same Express app can also run as a Vercel Serverless Function in the
// SAME project as the frontend, which keeps /api same-origin by construction
// (the session cookie is SameSite=lax, so a cross-origin API host would
// break sign-in). It imports the compiled API (apps/api/dist, built by the
// Vercel buildCommand) rather than the TypeScript source, so no second
// copy of the routes exists.
//
// Environment mapping (done BEFORE importing the app, because config and
// the Prisma client are evaluated at import time):
// - Vercel Postgres stores expose POSTGRES_PRISMA_URL (pooled, PgBouncer
//   mode) and POSTGRES_URL (pooled) instead of DATABASE_URL, so map the
//   pooled variant onto DATABASE_URL when DATABASE_URL itself is unset.
//   Migrations, by contrast, use POSTGRES_URL_NON_POOLING in the
//   buildCommand (see vercel.json), because prisma migrate deploy must
//   not run through a pooler.
// - Serverless filesystems are read-only except /tmp, so the dev-only
//   local storage backend writes under /tmp when STORAGE_DIR is unset.
//   Uploads on this deployment are therefore NON-DURABLE (they vanish
//   with the function instance) until a production storage provider is
//   decided — see DEPLOYMENT.md. Nothing here presents them as durable.
//
// URL reconstruction: Vercel dynamic routes populate req.query.all from
// the path segments, while req.url may already be the original path or
// the function path depending on routing. If req.url does not already
// start with /api/v1, rebuild it from the segments so the Express app
// (mounted at /api/v1) sees the path it expects.

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    process.env.POSTGRES_PRISMA_URL ?? process.env.POSTGRES_URL ?? '';
}
if (!process.env.STORAGE_DIR) {
  process.env.STORAGE_DIR = '/tmp/little-place-storage';
}

// eslint-disable-next-line import/first
import { createApp } from '../../apps/api/dist/app.js';
// eslint-disable-next-line import/first
import { requireConfig } from '../../apps/api/dist/config.js';

requireConfig();

const app = createApp();

export default function handler(req: any, res: any): void {
  const url: string = typeof req.url === 'string' ? req.url : '';
  if (!url.startsWith('/api/v1')) {
    const all = req.query?.all;
    if (all !== undefined) {
      const segments = Array.isArray(all) ? all : [all];
      const queryString = url.includes('?') ? url.slice(url.indexOf('?')) : '';
      req.url = `/api/v1/${segments.map(String).join('/')}${queryString}`;
    }
  }
  app(req, res);
}
