import { Router } from 'express';
import { z } from 'zod';
import { invitationJoinSchema, spaceCreateSchema } from '@little-place/shared';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { ApiError, conflict, notFound, unauthorized } from '../errors.js';
import { audit } from '../lib/audit.js';
import { randomToken, sha256Hex } from '../lib/crypto.js';
import { checkRateLimit, joinIpKey, RATE_LIMITS } from '../lib/rateLimit.js';
import { validateBody } from '../middleware/validate.js';
import { requireSpaceMember } from '../lib/membership.js';

export const spacesRouter = Router();

function publicMember(m: { user: { id: string; displayName: string; avatarKey: string }; role: string }) {
  return { id: m.user.id, displayName: m.user.displayName, avatarKey: m.user.avatarKey, role: m.role };
}

spacesRouter.post('/', validateBody(spaceCreateSchema), async (req, res, next) => {
  try {
    if (!req.user) throw unauthorized();
    const existing = await prisma.spaceMember.findUnique({ where: { userId: req.user.id } });
    if (existing) throw conflict('ALREADY_IN_SPACE', 'You are already in a space');
    const { name } = req.body as { name: string };
    const space = await prisma.$transaction(async (tx) => {
      const created = await tx.space.create({ data: { name, createdById: req.user!.id } });
      await tx.spaceMember.create({ data: { spaceId: created.id, userId: req.user!.id, role: 'owner' } });
      return created;
    });
    await audit('space.create', 'space', space.id, { actorId: req.user.id, spaceId: space.id, outcome: 'success' });
    return res.status(201).json({ data: { id: space.id, name: space.name } });
  } catch (e) {
    return next(e);
  }
});

spacesRouter.get('/me', async (req, res, next) => {
  try {
    if (!req.user) throw unauthorized();
    const member = await prisma.spaceMember.findUnique({
      where: { userId: req.user.id }, include: { space: { include: { members: { include: { user: true } } } } },
    });
    if (!member || !member.space) return res.json({ data: null });
    return res.json({ data: { id: member.space.id, name: member.space.name, members: member.space.members.map(publicMember) } });
  } catch (e) {
    return next(e);
  }
});

spacesRouter.get('/:spaceId', async (req, res, next) => {
  try {
    if (!req.user) throw unauthorized();
    const spaceId = req.params.spaceId ?? '';
    await requireSpaceMember(req.user.id, spaceId);
    const space = await prisma.space.findUnique({
      where: { id: spaceId }, include: { members: { include: { user: true } } },
    });
    if (!space) throw notFound();
    return res.json({ data: { id: space.id, name: space.name, members: space.members.map(publicMember) } });
  } catch (e) {
    return next(e);
  }
});

// Rename: either space member may rename the shared space (shared
// config, like the chest reward — not owner-only). A non-member
// gets the same generic 404 as for a missing space.
const spaceRenameSchema = z.object({ name: z.string().trim().min(1).max(100) }).strict();

spacesRouter.patch('/:spaceId', validateBody(spaceRenameSchema), async (req, res, next) => {
  try {
    if (!req.user) throw unauthorized();
    const spaceId = req.params.spaceId ?? '';
    await requireSpaceMember(req.user.id, spaceId);
    const { name } = req.body as { name: string };
    const space = await prisma.space.update({
      where: { id: spaceId },
      data: { name },
      include: { members: { include: { user: true } } },
    });
    return res.json({ data: { id: space.id, name: space.name, members: space.members.map(publicMember) } });
  } catch (e) {
    return next(e);
  }
});

// Create a long single-use invitation token. The token is shown ONCE
// in this response; only its hash is stored. Short codes are NOT
// implemented in 1A (R4 UNDECIDED).
spacesRouter.post('/:spaceId/invitations', async (req, res, next) => {
  try {
    if (!req.user) throw unauthorized();
    const spaceId = req.params.spaceId ?? '';
    const member = await prisma.spaceMember.findUnique({ where: { userId: req.user.id } });
    if (!member || member.spaceId !== spaceId || member.role !== 'owner') throw notFound();
    const count = await prisma.spaceMember.count({ where: { spaceId } });
    if (count >= 2) throw conflict('SPACE_FULL', 'This space already has two members');
    const token = randomToken(32);
    const expiresAt = new Date(Date.now() + config.inviteExpiryDays * 86400_000);
    const invitation = await prisma.invitation.create({
      data: { spaceId, tokenHash: sha256Hex(token), expiresAt, createdById: req.user.id },
    });
    await audit('invitation.create', 'invitation', invitation.id, { actorId: req.user.id, spaceId, outcome: 'success' });
    return res.status(201).json({ data: { invitationId: invitation.id, token, expiresAt: expiresAt.toISOString() } });
  } catch (e) {
    return next(e);
  }
});

// Rotate: invalidate unused invitations, create one new one. Rejected
// if the space is now full (a new invitation could not be used).
spacesRouter.post('/:spaceId/invitations/rotate', async (req, res, next) => {
  try {
    if (!req.user) throw unauthorized();
    const spaceId = req.params.spaceId ?? '';
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Space" WHERE "id" = ${spaceId} FOR UPDATE`;
      const member = await tx.spaceMember.findUnique({ where: { userId: req.user!.id } });
      if (!member || member.spaceId !== spaceId || member.role !== 'owner') throw notFound();
      const count = await tx.spaceMember.count({ where: { spaceId } });
      if (count >= 2) throw conflict('SPACE_FULL', 'This space already has two members');
      await tx.invitation.updateMany({ where: { spaceId, usedAt: null }, data: { usedAt: new Date() } });
      const token = randomToken(32);
      const expiresAt = new Date(Date.now() + config.inviteExpiryDays * 86400_000);
      const invitation = await tx.invitation.create({
        data: { spaceId, tokenHash: sha256Hex(token), expiresAt, createdById: req.user!.id },
      });
      return { token, expiresAt, invitationId: invitation.id };
    });
    return res.status(201).json({ data: result });
  } catch (e) {
    return next(e);
  }
});

const genericInvitationError = () => new ApiError(400, 'INVITATION_INVALID', 'Invalid or expired invitation');

spacesRouter.post('/invitations/join', validateBody(invitationJoinSchema), async (req, res, next) => {
  try {
    if (!req.user) throw unauthorized();
    await checkRateLimit(joinIpKey(req.ip), RATE_LIMITS.joinPerIp.limit, RATE_LIMITS.joinPerIp.windowMs);
    const { token } = req.body as { token: string };
    const tokenHash = sha256Hex(token);
    const existingMember = await prisma.spaceMember.findUnique({ where: { userId: req.user.id } });
    if (existingMember) throw conflict('ALREADY_IN_SPACE', 'You are already in a space');

    let invitationId: string | null = null;
    try {
      const spaceId = await prisma.$transaction(async (tx) => {
        const invitation = await tx.invitation.findUnique({ where: { tokenHash } });
        if (!invitation) throw genericInvitationError();
        invitationId = invitation.id;
        await tx.$queryRaw`SELECT "id" FROM "Invitation" WHERE "id" = ${invitation.id} FOR UPDATE`;
        const fresh = await tx.invitation.findUnique({ where: { id: invitation.id } });
        if (!fresh || fresh.usedAt || fresh.expiresAt <= new Date() || (fresh.lockedUntil && fresh.lockedUntil > new Date())) {
          throw genericInvitationError();
        }
        await tx.$queryRaw`SELECT "id" FROM "Space" WHERE "id" = ${fresh.spaceId} FOR UPDATE`;
        const count = await tx.spaceMember.count({ where: { spaceId: fresh.spaceId } });
        if (count >= 2) throw genericInvitationError();
        const already = await tx.spaceMember.findUnique({ where: { userId: req.user!.id } });
        if (already) throw conflict('ALREADY_IN_SPACE', 'You are already in a space');
        await tx.spaceMember.create({ data: { spaceId: fresh.spaceId, userId: req.user!.id, role: 'member' } });
        await tx.invitation.update({ where: { id: fresh.id }, data: { usedAt: new Date() } });
        return fresh.spaceId;
      });
      await audit('invitation.join', 'space', spaceId, { actorId: req.user.id, spaceId, outcome: 'success' });
      return res.json({ data: { spaceId } });
    } catch (e) {
      // Failed attempts increment the per-invitation counter in a
      // separate write (the join transaction rolled back, so counting
      // inside it would have been lost). Lock after 5 failures.
      if (invitationId) {
        const inv = await prisma.invitation.findUnique({ where: { id: invitationId } });
        if (inv && !inv.usedAt) {
          const attemptCount = inv.attemptCount + 1;
          await prisma.invitation.update({
            where: { id: invitationId },
            data: { attemptCount, ...(attemptCount >= 5 ? { lockedUntil: inv.expiresAt } : {}) },
          });
        }
        await audit('invitation.join', 'invitation', invitationId, { actorId: req.user.id, outcome: 'denied' });
      }
      throw e;
    }
  } catch (e) {
    return next(e);
  }
});
