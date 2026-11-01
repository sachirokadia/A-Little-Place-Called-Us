import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { ApiError, unauthorized } from '../errors.js';
import { hashEquals, randomToken, sha256Hex } from '../lib/crypto.js';

export const SESSION_COOKIE = 'lp_session';
export const ANON_CSRF_COOKIE = 'lp_anon_csrf';

export interface AuthedUser { id: string; email: string; displayName: string; avatarKey: string }
export interface AuthedSession { id: string; userId: string; csrfTokenHash: string; createdAt: Date }

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser;
      session?: AuthedSession;
      csrfToken?: string;
    }
  }
}

export function cookieOptions(maxAgeMs: number) {
  return {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeMs,
  };
}
export function clearCookieOptions() {
  return { httpOnly: true, secure: config.nodeEnv === 'production', sameSite: 'lax' as const, path: '/' };
}

export function setSessionCookie(res: Response, token: string, maxAgeMs: number): void {
  res.cookie(SESSION_COOKIE, token, cookieOptions(maxAgeMs));
}
export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, clearCookieOptions());
}

// Session resolution (spec §4.8 step 2). Establishes identity only;
// it does not authorize access to any resource.
export async function resolveSession(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token || typeof token !== 'string') return next();
    const hash = sha256Hex(token);
    const session = await prisma.session.findUnique({ where: { tokenHash: hash }, include: { user: true } });
    if (!session || session.revokedAt) return next();
    const now = new Date();
    const absoluteExpiry = new Date(session.createdAt.getTime() + config.sessionAbsoluteDays * 86400_000);
    const idleExpiry = new Date(session.lastSeenAt.getTime() + config.sessionIdleDays * 86400_000);
    if (now > session.expiresAt || now > absoluteExpiry || now > idleExpiry) return next();
    req.user = { id: session.user.id, email: session.user.email, displayName: session.user.displayName, avatarKey: session.user.avatarKey };
    req.session = { id: session.id, userId: session.userId, csrfTokenHash: session.csrfTokenHash, createdAt: session.createdAt };
    // Update lastSeenAt (idle clock) — best effort, not fatal if it fails.
    prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: now } }).catch(() => undefined);
    return next();
  } catch {
    return next();
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user || !req.session) return next(unauthorized());
  return next();
}

// CSRF (spec §4.8 step 3, §4.8a).
// Authenticated: header must match the session-bound token hash.
// Anonymous (public state-changing routes): header must equal the
// readable anonymous cookie value (double-submit).
export function csrfGuard(req: Request, _res: Response, next: NextFunction): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const header = req.headers['x-csrf-token'];
  const token = Array.isArray(header) ? header[0] : header;
  if (!token || typeof token !== 'string') {
    return next(new ApiError(403, 'CSRF_INVALID', 'Invalid CSRF token'));
  }
  if (req.session) {
    if (!hashEquals(sha256Hex(token), req.session.csrfTokenHash)) {
      return next(new ApiError(403, 'CSRF_INVALID', 'Invalid CSRF token'));
    }
    return next();
  }
  const cookie = req.cookies?.[ANON_CSRF_COOKIE];
  if (!cookie || cookie !== token) {
    return next(new ApiError(403, 'CSRF_INVALID', 'Invalid CSRF token'));
  }
  return next();
}

// Origin allowlist for state-changing requests (spec §4.4).
export function originGuard(req: Request, _res: Response, next: NextFunction): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (!origin || !config.frontendOrigins.includes(origin)) {
    return next(new ApiError(403, 'ORIGIN_NOT_ALLOWED', 'Origin not allowed'));
  }
  return next();
}

export async function createSession(userId: string): Promise<{ token: string; csrfToken: string }> {
  const token = randomToken(32);
  const csrfToken = randomToken(32);
  const expiresAt = new Date(Date.now() + config.sessionAbsoluteDays * 86400_000);
  await prisma.session.create({
    data: { userId, tokenHash: sha256Hex(token), csrfTokenHash: sha256Hex(csrfToken), expiresAt },
  });
  return { token, csrfToken };
}

export async function rotateCsrf(sessionId: string): Promise<string> {
  const csrfToken = randomToken(32);
  await prisma.session.update({ where: { id: sessionId }, data: { csrfTokenHash: sha256Hex(csrfToken) } });
  return csrfToken;
}
