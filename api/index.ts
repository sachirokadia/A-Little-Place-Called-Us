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
// WHY THIS FILE REPLACES api/v1/[...all].ts (routing fix, 2026-11-03):
// The catch-all file's filesystem route only matched SINGLE-segment paths
// live: /api/v1/health and /api/v1/spaces reached the app, but every
// two-segment path (/api/v1/health/ready, /api/v1/auth/me, and therefore
// every real auth/content route) returned Vercel's platform 404 without
// ever reaching the app, so sign-in could never work. Instead of relying
// on filesystem catch-all routing, vercel.json now carries ONE explicit
// rewrite, evaluated before the SPA fallbacks:
//   { "source": "/api/v1/:path*", "destination": "/api/index?__path=:path*" }
// Vercel's :path* captures zero or more segments, so every /api/v1/*
// path — one segment, two segments, or deeper — is routed to this one
// function, and the handler below rebuilds the original /api/v1 path
// from __path before handing the request to Express.
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

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    process.env.POSTGRES_PRISMA_URL ?? process.env.POSTGRES_URL ?? '';
}
if (!process.env.STORAGE_DIR) {
  process.env.STORAGE_DIR = '/tmp/little-place-storage';
}

// eslint-disable-next-line import/first
import { createApp } from '../apps/api/dist/app.js';
// eslint-disable-next-line import/first
import { requireConfig } from '../apps/api/dist/config.js';

requireConfig();

const app = createApp();

function decodePath(raw: string): string | null {
  if (!raw || raw.startsWith(':')) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export default function handler(req: any, res: any): void {
  const url: string = typeof req.url === 'string' ? req.url : '';
  if (!url.startsWith('/api/v1')) {
    const query = req.query ?? {};
    // Case 1: the explicit rewrite /api/v1/:path* -> /api/index?__path=:path*.
    // Vercel may deliver __path already decoded in req.query, or still
    // encoded in req.url's query string; handle both, and keep every
    // other original query parameter intact.
    const rawPath = Array.isArray(query.__path)
      ? query.__path.join('/')
      : query.__path;
    const decoded =
      typeof rawPath === 'string' ? decodePath(rawPath) : null;
    if (decoded !== null && decoded !== '') {
      const qs = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
      const params = new URLSearchParams(qs);
      params.delete('__path');
      const rest = params.toString();
      req.url = `/api/v1/${decoded}${rest ? `?${rest}` : ''}`;
    } else if (query.all !== undefined) {
      // Case 2: legacy catch-all query shape, kept as a fallback.
      const segments = Array.isArray(query.all) ? query.all : [query.all];
      const queryString = url.includes('?') ? url.slice(url.indexOf('?')) : '';
      req.url = `/api/v1/${segments.map(String).join('/')}${queryString}`;
    }
  }
  app(req, res);
}
