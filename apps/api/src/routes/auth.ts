import { Router } from 'express';
import { z } from 'zod';
import { loginSchema, passwordChangeSchema, registerSchema } from '@little-place/shared';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { ApiError, conflict, unauthorized } from '../errors.js';
import { audit } from '../lib/audit.js';
import { hashPassword, verifyPassword } from '../lib/crypto.js';
import {
  ANON_CSRF_COOKIE, clearSessionCookie, createSession, rotateCsrf, setSessionCookie,
} from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { checkRateLimit, getRateLimitCount, incrementRateLimit, joinIpKey, loginAccountKey, loginIpKey, RATE_LIMITS, registerIpKey } from '../lib/rateLimit.js';
import { randomToken } from '../lib/crypto.js';

export const authRouter = Router();
const AVATAR_KEYS = ['bunny', 'fox', 'owl', 'bear', 'cat', 'dog'];

// GET /auth/csrf — authenticated: rotate + return session-bound token.
// Unauthenticated: set a readable double-submit cookie + return it.
// This endpoint is GET, so the CSRF guard does not apply to it.
authRouter.get('/csrf', async (req, res, next) => {
  try {
    if (req.session) {
      const csrfToken = await rotateCsrf(req.session.id);
      return res.json({ data: { csrfToken } });
    }
    const token = randomToken(32);
    res.cookie(ANON_CSRF_COOKIE, token, {
      httpOnly: false, secure: config.nodeEnv === 'production', sameSite: 'lax', path: '/',
    });
    return res.json({ data: { csrfToken: token } });
  } catch (e) {
    return next(e);
  }
});

authRouter.post('/register', validateBody(registerSchema), async (req, res, next) => {
  try {
    await checkRateLimit(registerIpKey(req.ip), RATE_LIMITS.registerPerIp.limit, RATE_LIMITS.registerPerIp.windowMs);
    const { email, password, displayName } = req.body as { email: string; password: string; displayName: string };
    const existing = await prisma.user.findUnique({ where: { emailLower: email } });
    if (existing) throw conflict('EMAIL_EXISTS', 'An account with this email already exists');
    const user = await prisma.user.create({
      data: { email, emailLower: email, passwordHash: await hashPassword(password), displayName },
    });
    const { token, csrfToken } = await createSession(user.id);
    setSessionCookie(res, token, config.sessionAbsoluteDays * 86400_000);
    await audit('user.register', 'user', user.id, { actorId: user.id, outcome: 'success' });
    return res.status(201).json({ data: { id: user.id, email: user.email, displayName: user.displayName, avatarKey: user.avatarKey, csrfToken } });
  } catch (e) {
    return next(e);
  }
});

authRouter.post('/login', validateBody(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body as { email: string; password: string };
    // Failed-attempt limits only: check, then increment only on failure.
    const ipCount = await getRateLimitCount(loginIpKey(req.ip), RATE_LIMITS.loginPerIp.windowMs);
    const accountCount = await getRateLimitCount(loginAccountKey(email), RATE_LIMITS.loginPerAccount.windowMs);
    if (ipCount >= RATE_LIMITS.loginPerIp.limit || accountCount >= RATE_LIMITS.loginPerAccount.limit) {
      throw new ApiError(429, 'RATE_LIMITED', 'Too many requests');
    }
    const user = await prisma.user.findUnique({ where: { emailLower: email } });
    const ok = user ? await verifyPassword(user.passwordHash, password) : false;
    if (!user || !ok) {
      await incrementRateLimit(loginIpKey(req.ip), RATE_LIMITS.loginPerIp.windowMs);
      await incrementRateLimit(loginAccountKey(email), RATE_LIMITS.loginPerAccount.windowMs);
      await audit('user.login', 'user', user?.id ?? 'unknown', { actorId: user?.id ?? null, outcome: 'denied' });
      throw unauthorized();
    }
    const { token, csrfToken } = await createSession(user.id);
    setSessionCookie(res, token, config.sessionAbsoluteDays * 86400_000);
    await audit('user.login', 'user', user.id, { actorId: user.id, outcome: 'success' });
    return res.json({ data: { id: user.id, email: user.email, displayName: user.displayName, avatarKey: user.avatarKey, csrfToken } });
  } catch (e) {
    return next(e);
  }
});

authRouter.post('/logout', async (req, res, next) => {
  try {
    if (!req.session) throw unauthorized();
    await prisma.session.update({ where: { id: req.session.id }, data: { revokedAt: new Date() } });
    clearSessionCookie(res);
    await audit('user.logout', 'session', req.session.id, { actorId: req.user?.id, outcome: 'success' });
    return res.json({ data: { ok: true } });
  } catch (e) {
    return next(e);
  }
});

authRouter.post('/logout-all', async (req, res, next) => {
  try {
    if (!req.user) throw unauthorized();
    await prisma.session.updateMany({ where: { userId: req.user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    clearSessionCookie(res);
    return res.json({ data: { ok: true } });
  } catch (e) {
    return next(e);
  }
});

authRouter.get('/me', async (req, res, next) => {
  try {
    if (!req.user) throw unauthorized();
    const member = await prisma.spaceMember.findUnique({ where: { userId: req.user.id } });
    return res.json({ data: { ...req.user, spaceId: member?.spaceId ?? null } });
  } catch (e) {
    return next(e);
  }
});

authRouter.patch('/me', validateBody(z.object({
  displayName: z.string().trim().min(1).max(100).optional(),
  avatarKey: z.enum(['bunny', 'fox', 'owl', 'bear', 'cat', 'dog']).optional(),
})), async (req, res, next) => {
  try {
    if (!req.user) throw unauthorized();
    // Only the caller's own profile is ever updated; there is no
    // endpoint that takes another user's id for a profile change (T15).
    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data: { ...(req.body.displayName ? { displayName: req.body.displayName } : {}), ...(req.body.avatarKey ? { avatarKey: req.body.avatarKey } : {}) },
    });
    return res.json({ data: { id: updated.id, email: updated.email, displayName: updated.displayName, avatarKey: updated.avatarKey } });
  } catch (e) {
    return next(e);
  }
});

authRouter.post('/password-change', validateBody(passwordChangeSchema), async (req, res, next) => {
  try {
    if (!req.user || !req.session) throw unauthorized();
    const { password } = req.body as { password: string };
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: req.user!.id }, data: { passwordHash: await hashPassword(password) } });
      // Revoke every other session; the current session survives, and
      // its CSRF token is rotated below.
      await tx.session.updateMany({ where: { userId: req.user!.id, id: { not: req.session!.id } }, data: { revokedAt: new Date() } });
    });
    const csrfToken = await rotateCsrf(req.session.id);
    await audit('user.password-change', 'user', req.user.id, { actorId: req.user.id, outcome: 'success' });
    return res.json({ data: { ok: true, csrfToken } });
  } catch (e) {
    return next(e);
  }
});

// Password reset is DEFERRED in Phase 1A (R3 UNDECIDED: no email
// provider). These endpoints send nothing and must not be presented
// as a working reset flow.
const deferred = (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => unknown } }) =>
  res.status(501).json({ error: { code: 'PASSWORD_RESET_DEFERRED', message: 'Password reset by email is not available yet: no email provider has been chosen (R3).', correlationId: 'deferred' } });
authRouter.post('/password-reset/request', (req, res) => deferred(req, res));
authRouter.post('/password-reset/confirm', (req, res) => deferred(req, res));

