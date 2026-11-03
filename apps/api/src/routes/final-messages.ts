// Shared final messages (personalisation).
//
// The arcade's final star letter and the hero adventure's final
// message are SHARED config, like the chest reward: either space
// member may read and overwrite them — no author-only restriction,
// since the message belongs to the space, not to one author. When
// no row exists, the frontend falls back to the code drafts, still
// labelled as drafts; a saved row is never presented as the draft.
// Reading and editing are never gated on any game/score/completion.

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { notFound, unauthorized } from '../errors.js';
import { requireSpaceMember } from '../lib/membership.js';
import { validateBody } from '../middleware/validate.js';

export const finalMessagesRouter = Router();

const FINAL_MESSAGE_KINDS = ['star-letter', 'hero-final'] as const;
export type FinalMessageKind = (typeof FINAL_MESSAGE_KINDS)[number];

function requireKind(raw: string | undefined): FinalMessageKind {
  if (!raw || !(FINAL_MESSAGE_KINDS as readonly string[]).includes(raw)) throw notFound();
  return raw as FinalMessageKind;
}

const finalMessageSchema = z
  .object({
    text: z
      .string()
      .min(1)
      .max(20000)
      .refine((v) => v.trim().length >= 1, { message: 'Must not be blank' }),
  })
  .strict();

type FinalMessageRow = {
  kind: string;
  text: string;
  updatedById: string;
  updatedAt: Date;
};

function finalMessagePublic(row: FinalMessageRow) {
  return { kind: row.kind, text: row.text, updatedById: row.updatedById, updatedAt: row.updatedAt };
}

finalMessagesRouter.get('/spaces/:spaceId/final-messages/:kind', async (req, res, next) => {
  try {
    if (!req.user) throw unauthorized();
    const spaceId = req.params.spaceId ?? '';
    const kind = requireKind(req.params.kind);
    await requireSpaceMember(req.user.id, spaceId);
    const row = await prisma.finalMessage.findUnique({ where: { spaceId_kind: { spaceId, kind } } });
    if (!row) return res.json({ data: null });
    return res.json({ data: finalMessagePublic(row) });
  } catch (e) {
    return next(e);
  }
});

finalMessagesRouter.put(
  '/spaces/:spaceId/final-messages/:kind',
  validateBody(finalMessageSchema),
  async (req, res, next) => {
    try {
      if (!req.user) throw unauthorized();
      const spaceId = req.params.spaceId ?? '';
      const kind = requireKind(req.params.kind);
      await requireSpaceMember(req.user.id, spaceId);
      const body = req.body as z.infer<typeof finalMessageSchema>;
      const row = await prisma.finalMessage.upsert({
        where: { spaceId_kind: { spaceId, kind } },
        create: { spaceId, kind, text: body.text, updatedById: req.user.id },
        update: { text: body.text, updatedById: req.user.id },
      });
      return res.json({ data: finalMessagePublic(row) });
    } catch (e) {
      return next(e);
    }
  },
);
