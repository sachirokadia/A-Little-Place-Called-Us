// Personalized adventure missions.
//
// AUTHOR RULE (chosen, enforced server-side on every route below,
// following the boyfriend router): a mission may be CREATED by
// either space member, but only the AUTHOR may PATCH or DELETE
// their own row — a partner's edit/delete attempt gets a generic
// 404, never a leak that the row exists or who owns it.
//
// REWARD-LINK RULE: a mission carries at most one reward link.
// A link is accepted only if the referenced row exists, belongs
// to the same space, is not deleted, and is visible to the creator
// under the normal visibility rules: memories and appreciations
// have no private variant in this codebase (space + non-deleted
// is the visibility rule, as in routes/content.ts), while a
// letter must be shared, the creator's own (any visibility), or
// a delivered scheduled letter (revealAt <= now). Bogus,
// other-space, deleted, or invisible links are a 400. Reward
// links are plain ids, not FKs, so deleting the linked row never
// cascades into the mission.
//
// No official property names, assets, dialogue, or trademarked
// material appear here: level ids are generic place names chosen
// for this feature, and missions carry only member-written text.

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { badRequest, notFound, unauthorized } from '../errors.js';
import { requireSpaceMember } from '../lib/membership.js';
import { validateBody } from '../middleware/validate.js';

export const heroRouter = Router();

export const HERO_LEVEL_IDS = ['rooftop-row', 'market-lane', 'harbour-lights'] as const;
type HeroLevelId = (typeof HERO_LEVEL_IDS)[number];

const nonBlank = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((v) => v.trim().length >= 1, { message: 'Must not be blank' });

const levelIdField = z.enum(HERO_LEVEL_IDS);
const rewardLinkField = z.string().min(1).nullable().optional();

const heroCreateSchema = z
  .object({
    levelId: levelIdField,
    title: nonBlank(200),
    clue: nonBlank(1000),
    rewardMessage: z.string().max(1000).optional(),
    rewardMemoryId: rewardLinkField,
    rewardLetterId: rewardLinkField,
    rewardAppreciationId: rewardLinkField,
    order: z.number().int().optional(),
  })
  .strict()
  .refine(
    (v) => [v.rewardMemoryId, v.rewardLetterId, v.rewardAppreciationId].filter((x) => x != null).length <= 1,
    { message: 'At most one reward link is allowed' },
  );

const heroPatchSchema = z
  .object({
    levelId: levelIdField.optional(),
    title: nonBlank(200).optional(),
    clue: nonBlank(1000).optional(),
    rewardMessage: z.string().max(1000).optional(),
    rewardMemoryId: rewardLinkField,
    rewardLetterId: rewardLinkField,
    rewardAppreciationId: rewardLinkField,
    order: z.number().int().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length >= 1, { message: 'At least one field is required' })
  .refine(
    (v) => [v.rewardMemoryId, v.rewardLetterId, v.rewardAppreciationId].filter((x) => x != null).length <= 1,
    { message: 'At most one reward link is allowed' },
  );

function requireUser(req: { user?: { id: string } }): string {
  if (!req.user) throw unauthorized();
  return req.user.id;
}

type MissionRow = {
  id: string;
  spaceId: string;
  authorId: string;
  levelId: string;
  title: string;
  clue: string;
  rewardMessage: string;
  rewardMemoryId: string | null;
  rewardLetterId: string | null;
  rewardAppreciationId: string | null;
  order: number;
  createdAt: Date;
};
function missionPublic(m: MissionRow) {
  return {
    id: m.id,
    spaceId: m.spaceId,
    authorId: m.authorId,
    levelId: m.levelId,
    title: m.title,
    clue: m.clue,
    rewardMessage: m.rewardMessage,
    rewardMemoryId: m.rewardMemoryId,
    rewardLetterId: m.rewardLetterId,
    rewardAppreciationId: m.rewardAppreciationId,
    order: m.order,
    createdAt: m.createdAt,
  };
}

async function scopedMission(spaceId: string, id: string) {
  const row = await prisma.heroMission.findFirst({ where: { id, spaceId } });
  if (!row) throw notFound();
  return row;
}

function assertAuthor(authorId: string, callerId: string): void {
  // Generic 404 (never a 403 leak) for a non-author, matching the
  // rest of the API's author-only behaviour.
  if (authorId !== callerId) throw notFound();
}

type RewardLinks = {
  rewardMemoryId?: string | null;
  rewardLetterId?: string | null;
  rewardAppreciationId?: string | null;
};

// Validate a single reward link (at most one is non-null by the
// time this runs). Throws a 400 for bogus, other-space, deleted,
// or invisible links; never leaks the linked row's content.
async function validateRewardLinks(spaceId: string, callerId: string, links: RewardLinks): Promise<void> {
  if (links.rewardMemoryId != null) {
    const row = await prisma.memory.findFirst({
      where: { id: links.rewardMemoryId, spaceId, deletedAt: null },
    });
    if (!row) throw badRequest('Invalid request: rewardMemoryId');
  }
  if (links.rewardAppreciationId != null) {
    const row = await prisma.appreciation.findFirst({
      where: { id: links.rewardAppreciationId, spaceId, deletedAt: null },
    });
    if (!row) throw badRequest('Invalid request: rewardAppreciationId');
  }
  if (links.rewardLetterId != null) {
    const row = await prisma.letter.findFirst({
      where: { id: links.rewardLetterId, spaceId, deletedAt: null },
    });
    if (!row) throw badRequest('Invalid request: rewardLetterId');
    // Normal letter visibility (routes/content.ts): own rows in
    // any visibility, shared rows, and delivered scheduled rows.
    // A partner's private draft or undelivered scheduled letter is
    // invisible here, exactly as in the letters list.
    const visible =
      row.authorId === callerId ||
      row.visibility === 'shared' ||
      (row.visibility === 'scheduled' && row.revealAt !== null && row.revealAt <= new Date());
    if (!visible) throw badRequest('Invalid request: rewardLetterId');
  }
}

heroRouter.get('/spaces/:spaceId/hero-missions', async (req, res, next) => {
  try {
    const callerId = requireUser(req);
    const spaceId = req.params.spaceId ?? '';
    await requireSpaceMember(callerId, spaceId);
    const rows = await prisma.heroMission.findMany({
      where: { spaceId },
      orderBy: [{ levelId: 'asc' }, { order: 'asc' }, { createdAt: 'asc' }],
    });
    return res.json({ data: rows.map(missionPublic) });
  } catch (e) {
    return next(e);
  }
});

heroRouter.post(
  '/spaces/:spaceId/hero-missions',
  validateBody(heroCreateSchema),
  async (req, res, next) => {
    try {
      const callerId = requireUser(req);
      const spaceId = req.params.spaceId ?? '';
      await requireSpaceMember(callerId, spaceId);
      const body = req.body as z.infer<typeof heroCreateSchema>;
      // Strict schema above rejects a body-supplied authorId; the
      // author is always the session caller.
      await validateRewardLinks(spaceId, callerId, body);
      const row = await prisma.heroMission.create({
        data: {
          spaceId,
          authorId: callerId,
          levelId: body.levelId,
          title: body.title,
          clue: body.clue,
          rewardMessage: body.rewardMessage ?? '',
          rewardMemoryId: body.rewardMemoryId ?? null,
          rewardLetterId: body.rewardLetterId ?? null,
          rewardAppreciationId: body.rewardAppreciationId ?? null,
          order: body.order ?? 0,
        },
      });
      return res.status(201).json({ data: missionPublic(row) });
    } catch (e) {
      return next(e);
    }
  },
);

heroRouter.patch(
  '/spaces/:spaceId/hero-missions/:id',
  validateBody(heroPatchSchema),
  async (req, res, next) => {
    try {
      const callerId = requireUser(req);
      const spaceId = req.params.spaceId ?? '';
      await requireSpaceMember(callerId, spaceId);
      const row = await scopedMission(spaceId, req.params.id ?? '');
      assertAuthor(row.authorId, callerId);
      const body = req.body as z.infer<typeof heroPatchSchema>;
      // Reward-link replacement semantics: supplying a non-null
      // link replaces any previously stored link (the at-most-one
      // invariant always holds after a patch); supplying only
      // null(s) clears. Supplying no reward field leaves the
      // stored link untouched.
      const rewardKeys = ['rewardMemoryId', 'rewardLetterId', 'rewardAppreciationId'] as const;
      const suppliedReward = rewardKeys.filter((k) => body[k] !== undefined);
      let mergedLinks: RewardLinks | null = null;
      if (suppliedReward.length > 0) {
        const nonNull = suppliedReward.filter((k) => body[k] !== null);
        mergedLinks = {
          rewardMemoryId: nonNull.includes('rewardMemoryId') ? (body.rewardMemoryId ?? null) : null,
          rewardLetterId: nonNull.includes('rewardLetterId') ? (body.rewardLetterId ?? null) : null,
          rewardAppreciationId: nonNull.includes('rewardAppreciationId') ? (body.rewardAppreciationId ?? null) : null,
        };
        await validateRewardLinks(spaceId, callerId, mergedLinks);
      }
      const updated = await prisma.heroMission.update({
        where: { id: row.id },
        data: {
          ...(body.levelId !== undefined ? { levelId: body.levelId } : {}),
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.clue !== undefined ? { clue: body.clue } : {}),
          ...(body.rewardMessage !== undefined ? { rewardMessage: body.rewardMessage } : {}),
          ...(mergedLinks !== null ? mergedLinks : {}),
          ...(body.order !== undefined ? { order: body.order } : {}),
        },
      });
      return res.json({ data: missionPublic(updated) });
    } catch (e) {
      return next(e);
    }
  },
);

heroRouter.delete('/spaces/:spaceId/hero-missions/:id', async (req, res, next) => {
  try {
    const callerId = requireUser(req);
    const spaceId = req.params.spaceId ?? '';
    await requireSpaceMember(callerId, spaceId);
    const row = await scopedMission(spaceId, req.params.id ?? '');
    assertAuthor(row.authorId, callerId);
    await prisma.heroMission.delete({ where: { id: row.id } });
    return res.json({ data: { deleted: true } });
  } catch (e) {
    return next(e);
  }
});

export type { HeroLevelId };
