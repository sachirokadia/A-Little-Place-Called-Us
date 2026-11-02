import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { unauthorized } from '../errors.js';
import { validateBody } from '../middleware/validate.js';

export const preferencesRouter = Router();

// Per-user preferences (Phase 5). The row is always scoped to the
// session caller: there is no userId parameter, and a body-supplied
// userId is rejected by the strict schema, never trusted.
// GET creates the default row on first read, so a second login
// (fresh agent, same account) reads the same persisted row.
// motion 'system' means the frontend defers to the OS
// prefers-reduced-motion setting; a user-set 'reduce' overrides it
// and never silently falls back to full motion. Sound is OFF by
// default.

const preferencesBodySchema = z
  .object({
    motion: z.enum(['system', 'reduce', 'full']).optional(),
    soundEnabled: z.boolean().optional(),
    onboardingSeen: z.boolean().optional(),
  })
  .strict();

function publicPreferences(row: { motion: string; soundEnabled: boolean; onboardingSeen: boolean }) {
  return { motion: row.motion, soundEnabled: row.soundEnabled, onboardingSeen: row.onboardingSeen };
}

preferencesRouter.get('/preferences', async (req, res, next) => {
  try {
    if (!req.user) throw unauthorized();
    const row = await prisma.userPreference.upsert({
      where: { userId: req.user.id },
      update: {},
      create: { userId: req.user.id },
    });
    return res.json({ data: publicPreferences(row) });
  } catch (e) {
    return next(e);
  }
});

preferencesRouter.put('/preferences', validateBody(preferencesBodySchema), async (req, res, next) => {
  try {
    if (!req.user) throw unauthorized();
    const body = req.body as { motion?: 'system' | 'reduce' | 'full'; soundEnabled?: boolean; onboardingSeen?: boolean };
    const row = await prisma.userPreference.upsert({
      where: { userId: req.user.id },
      update: { ...body },
      create: { userId: req.user.id, ...body },
    });
    return res.json({ data: publicPreferences(row) });
  } catch (e) {
    return next(e);
  }
});
