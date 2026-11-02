import type { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { badRequest, notFound, unauthorized } from '../errors.js';
import { requireSpaceMember } from '../lib/membership.js';
import { validateBody } from '../middleware/validate.js';

export const gamesRouter = Router();

// Per-player game progress only. No scores, leaderboards, or
// rankings: each row belongs to exactly one player, a partner can
// never read or overwrite another player's row, and no content
// (letters, memories, journal text) is ever stored here.

const GAME_KEYS = ['memory-match', 'mystery', 'quiz', 'arcade-unlocks'] as const;
type GameKey = (typeof GAME_KEYS)[number];

const UNLOCKS = ['golden-star', 'lantern', 'banner', 'pixel-cat', 'pixel-fox'] as const;

const intRange = (min: number, max: number) => z.number().int().min(min).max(max);

// Strict: any unknown key inside progress is rejected, so a client
// cannot smuggle extra fields (or a score by another name) in.
const progressSchemas: Record<GameKey, z.ZodType<unknown>> = {
  'memory-match': z
    .object({
      completedGames: intRange(0, 10000).optional(),
      bestTurns: intRange(8, 500).nullable().optional(),
      lastTurns: intRange(8, 500).nullable().optional(),
      lastPairs: intRange(0, 12).optional(),
    })
    .strict()
    .refine((v) => Object.keys(v).length >= 1, { message: 'At least one field is required' }),
  mystery: z
    .object({
      completed: z.boolean().optional(),
      foundClues: z.array(z.string().max(80)).max(20).optional(),
    })
    .strict(),
  quiz: z
    .object({
      answered: intRange(0, 100).optional(),
      correct: intRange(0, 100).optional(),
    })
    .strict()
    .refine((v) => v.correct === undefined || v.answered === undefined || v.correct <= v.answered, {
      message: 'correct must not exceed answered',
    }),
  'arcade-unlocks': z
    .object({
      unlocks: z.array(z.enum(UNLOCKS)).max(20).optional(),
    })
    .strict(),
};

function parseGameKey(raw: string | undefined): GameKey {
  if (!raw || !(GAME_KEYS as readonly string[]).includes(raw)) throw badRequest('Invalid gameKey');
  return raw as GameKey;
}

function validateProgress(gameKey: GameKey, progress: unknown): Prisma.InputJsonObject {
  const parsed = progressSchemas[gameKey].safeParse(progress);
  if (!parsed.success) throw badRequest('Invalid progress');
  return parsed.data as Prisma.InputJsonObject;
}

// Outer body is strict too: a body-supplied playerId is rejected
// outright (never trusted, never used to scope the row — the row is
// always scoped to the session caller).
const gameProgressBodySchema = z
  .object({
    progress: z.unknown().refine((v) => typeof v === 'object' && v !== null && !Array.isArray(v), {
      message: 'progress must be an object',
    }),
  })
  .strict();

gamesRouter.get('/spaces/:spaceId/game-progress/:gameKey', async (req, res, next) => {
  try {
    if (!req.user) throw unauthorized();
    const spaceId = req.params.spaceId ?? '';
    const gameKey = parseGameKey(req.params.gameKey);
    await requireSpaceMember(req.user.id, spaceId);
    const row = await prisma.gameProgress.findUnique({
      where: { spaceId_playerId_gameKey: { spaceId, playerId: req.user.id, gameKey } },
    });
    if (!row) throw notFound();
    return res.json({ data: { gameKey: row.gameKey, progress: row.progress } });
  } catch (e) {
    return next(e);
  }
});

gamesRouter.put('/spaces/:spaceId/game-progress/:gameKey', validateBody(gameProgressBodySchema), async (req, res, next) => {
  try {
    if (!req.user) throw unauthorized();
    const spaceId = req.params.spaceId ?? '';
    const gameKey = parseGameKey(req.params.gameKey);
    await requireSpaceMember(req.user.id, spaceId);
    const progress = validateProgress(gameKey, (req.body as { progress: unknown }).progress);
    const row = await prisma.gameProgress.upsert({
      where: { spaceId_playerId_gameKey: { spaceId, playerId: req.user.id, gameKey } },
      create: { spaceId, playerId: req.user.id, gameKey, progress },
      update: { progress },
    });
    return res.json({ data: { gameKey: row.gameKey, progress: row.progress } });
  } catch (e) {
    return next(e);
  }
});
