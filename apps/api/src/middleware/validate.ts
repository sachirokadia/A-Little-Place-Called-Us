import type { NextFunction, Request, Response } from 'express';
import type { ZodSchema } from 'zod';
import { badRequest } from '../errors.js';
export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      // Safe envelope: field names + generic messages only, no raw
      // Zod internals, stack traces, or SQL.
      const issues = parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: 'Invalid value' }));
      return next(badRequest(`Invalid request: ${issues.map((i) => i.field || 'body').join(', ')}`));
    }
    req.body = parsed.data;
    return next();
  };
}

export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(req.query ?? {});
    if (!parsed.success) return next(badRequest('Invalid query'));
    (req as unknown as { validatedQuery: T }).validatedQuery = parsed.data;
    return next();
  };
}

