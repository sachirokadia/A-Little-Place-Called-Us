import { Router } from 'express';
import { prisma } from '../db.js';
import { notFound, unauthorized } from '../errors.js';
import { requireSpaceMember } from '../lib/membership.js';
import { maskLetter } from '../lib/visibility.js';

export const exportRouter = Router();

// Shared-records-only export (Phase 5). The frontend downloads the
// JSON response as a file; no media bytes are ever included, and no
// storage key or URL appears anywhere in it — only a per-item
// active-media count. Private content is excluded at the QUERY
// level, never merely stripped afterwards, so an excluded row
// cannot leak through a count either: there is no count of
// excluded rows in this response, only the included arrays.
// Included, all non-deleted and in this space only:
//   memories (all), letters that are shared OR scheduled-and-delivered
//   (server time), appreciations, future plans, reminders (shared
//   notes; reminders have no private variant).
// Excluded entirely: private_draft letters of anyone (including the
// caller's own), undelivered scheduled letters, private journals,
// voice notes.
export const EXPORT_NOTE =
  'This export contains shared records only. Private drafts, undelivered scheduled letters, private journals and voice notes are never included.';

function dateOnly(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function serializeMemory(row: Record<string, unknown>): Record<string, unknown> {
  const { _count, ...rest } = row;
  const count = (_count as { media?: number } | undefined)?.media ?? 0;
  return { ...rest, happenedOn: dateOnly(rest.happenedOn as Date | null), mediaCount: count };
}

function serializePlan(row: Record<string, unknown>): Record<string, unknown> {
  const { _count, ...rest } = row;
  const count = (_count as { media?: number } | undefined)?.media ?? 0;
  return { ...rest, targetDate: dateOnly(rest.targetDate as Date | null), mediaCount: count };
}

exportRouter.get('/spaces/:spaceId/export', async (req, res, next) => {
  try {
    if (!req.user) throw unauthorized();
    const spaceId = req.params.spaceId ?? '';
    // Non-members (and non-existent spaces) get the generic 404.
    await requireSpaceMember(req.user.id, spaceId);
    const space = await prisma.space.findUnique({ where: { id: spaceId } });
    if (!space) throw notFound();
    const now = new Date();
    const [memories, letters, appreciations, plans, reminders] = await Promise.all([
      prisma.memory.findMany({
        where: { spaceId, deletedAt: null },
        include: { _count: { select: { media: { where: { status: 'active' } } } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.letter.findMany({
        where: {
          spaceId,
          deletedAt: null,
          OR: [
            { visibility: 'shared' },
            { visibility: 'scheduled', revealAt: { lte: now } },
          ],
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.appreciation.findMany({ where: { spaceId, deletedAt: null }, orderBy: { createdAt: 'desc' } }),
      prisma.futurePlan.findMany({
        where: { spaceId, deletedAt: null },
        include: { _count: { select: { media: { where: { status: 'active' } } } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.reminder.findMany({ where: { spaceId, deletedAt: null }, orderBy: { createdAt: 'desc' } }),
    ]);
    // Defence in depth, matching the list endpoints: a delivered
    // scheduled letter passes through unchanged, and an undelivered
    // one would have its body stripped if it ever reached here —
    // but the query above already excludes undelivered letters.
    const safeLetters = letters.map((letter) =>
      maskLetter(letter as never, req.user!.id, now),
    );
    return res.json({
      data: {
        spaceId: space.id,
        spaceName: space.name,
        exportedAt: now.toISOString(),
        exportNote: EXPORT_NOTE,
        memories: memories.map((m) => serializeMemory(m as unknown as Record<string, unknown>)),
        letters: safeLetters,
        appreciations,
        plans: plans.map((p) => serializePlan(p as unknown as Record<string, unknown>)),
        reminders,
      },
    });
  } catch (e) {
    return next(e);
  }
});
