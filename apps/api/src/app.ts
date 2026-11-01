import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import { config } from './config.js';
import { ApiError, correlationId, errorBody } from './errors.js';
import { checkRateLimit, RATE_LIMITS, userKey } from './lib/rateLimit.js';
import { csrfGuard, originGuard, resolveSession } from './middleware/auth.js';
import { authRouter } from './routes/auth.js';
import { contentRouter } from './routes/content.js';
import { healthRouter } from './routes/health.js';
import { mediaRouter } from './routes/media.js';
import { spacesRouter } from './routes/spaces.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  // Security headers (spec §4.9, PROPOSED set).
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), geolocation=()');
    if (config.nodeEnv === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    next();
  });

  // CORS allowlist (spec §4.5): exact origins only, never '*'
  // with credentials. Preflight is handled without session/CSRF.
  app.use('/api/v1', (req, res, next) => {
    const origin = req.headers.origin;
    if (req.method === 'OPTIONS') {
      if (origin && config.frontendOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token, Idempotency-Key');
        res.setHeader('Access-Control-Max-Age', '600');
        return res.sendStatus(204);
      }
      return res.sendStatus(403);
    }
    if (origin && config.frontendOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    return next();
  });

  // Middleware order (spec §4.8): session resolution, then CSRF,
  // then Origin, then route validation / authorized lookup.
  app.use('/api/v1', resolveSession, csrfGuard, originGuard);

  // General per-user rate limit for authenticated API use.
  app.use('/api/v1', async (req, _res, next) => {
    try {
      if (req.user) await checkRateLimit(userKey(req.user.id), RATE_LIMITS.generalPerUser.limit, RATE_LIMITS.generalPerUser.windowMs);
      return next();
    } catch (e) {
      return next(e);
    }
  });

  app.use('/api/v1', healthRouter);
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/spaces', spacesRouter);
  app.use('/api/v1', contentRouter);
  app.use('/api/v1', mediaRouter);

  app.use((_req, _res, next) => next(new ApiError(404, 'NOT_FOUND', 'Not found')));

  // Safe error envelope: never a stack trace, SQL string, or path.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const id = correlationId();
    if (err instanceof ApiError) {
      console.error(id, err.code, err.status);
      return res.status(err.status).json(errorBody(err, id));
    }
    console.error(id, 'internal');
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong', correlationId: id } });
  });

  return app;
}
