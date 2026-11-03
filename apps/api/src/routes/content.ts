import { Router } from 'express';
import type { Request } from 'express';
import {
  appreciationCreateSchema, appreciationUpdateSchema, journalCreateSchema, journalUpdateSchema,
  letterCreateSchema, letterUpdateSchema, memoryCreateSchema, memoryUpdateSchema,
  paginationSchema, planCompleteSchema, planCreateSchema, planUpdateSchema,
  reminderCreateSchema, reminderUpdateSchema, voiceNoteCreateSchema, voiceNoteUpdateSchema,
} from '@little-place/shared';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { ApiError, badRequest, conflict, notFound, unauthorized } from '../errors.js';
import { audit } from '../lib/audit.js';
import { assertNotIdempotencyConflict, checkIdempotency, storeIdempotency } from '../lib/idempotency.js';
import { requireSpaceMember } from '../lib/membership.js';
import { isRestoreWindowOpen, maskLetter } from '../lib/visibility.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import type { ZodSchema } from 'zod';

export const contentRouter = Router();

type ContentKind = 'memory' | 'letter' | 'journal' | 'appreciation' | 'plan' | 'reminder' | 'voiceNote';
const PLURALS: Record<ContentKind, string> = {
  memory: 'memories', letter: 'letters', journal: 'journals', appreciation: 'appreciations',
  plan: 'plans', reminder: 'reminders', voiceNote: 'voice-notes',
};
const SINGULARS: Record<ContentKind, string> = {
  memory: 'memory', letter: 'letter', journal: 'journal', appreciation: 'appreciation',
  plan: 'plan', reminder: 'reminder', voiceNote: 'voice-note',
};

// Prisma delegates, typed loosely to keep one factory for seven types.
type Delegate = {
  findMany: (args: Record<string, unknown>) => Promise<Record<string, unknown>[]>;
  findFirst: (args: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
  create: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  update: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  delete: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
};
function delegate(kind: ContentKind): Delegate {
  const map: Record<ContentKind, unknown> = {
    memory: prisma.memory, letter: prisma.letter, journal: prisma.journalEntry,
    appreciation: prisma.appreciation, plan: prisma.futurePlan, reminder: prisma.reminder,
    voiceNote: prisma.voiceNote,
  };
  return map[kind] as Delegate;
}

function serialize(kind: ContentKind, row: Record<string, unknown>, viewerId: string): Record<string, unknown> {
  const out = { ...row };
  if (kind === 'letter') {
    const masked = maskLetter(row as never, viewerId, new Date());
    return masked as Record<string, unknown>;
  }
  if (kind === 'plan' && row.targetDate) {
    // Calendar dates are DATE columns; serialise as YYYY-MM-DD only.
    const d = row.targetDate as Date;
    out.targetDate = d.toISOString().slice(0, 10);
  }
  if (kind === 'memory' && row.happenedOn) {
    const d = row.happenedOn as Date;
    out.happenedOn = d.toISOString().slice(0, 10);
  }
  return out;
}

// Visibility predicate (spec §3.4), built into the query itself.
function visibilityWhere(kind: ContentKind, spaceId: string, viewerId: string, deleted: boolean): Record<string, unknown> {
  const base: Record<string, unknown> = { spaceId, deletedAt: deleted ? { not: null } : null };
  // Journals AND voice notes are author-only. Voice notes were
  // previously space-visible while the export deliberately excluded
  // them entirely — that inconsistency is resolved in favour of
  // privacy (fail closed): a voice note is a personal Quiet Room
  // recording, like a journal, not a shared record. If the product
  // ever wants shared voice notes, that is a deliberate product
  // decision, not a silent default.
  if (kind === 'journal' || kind === 'voiceNote') return { ...base, authorId: viewerId };
  if (kind === 'letter') {
    // Partner sees: own rows (any visibility), shared rows, and
    // scheduled rows whose reveal time has passed. Undelivered
    // scheduled letters from the partner are fully hidden (R6 default).
    return {
      ...base,
      OR: [
        { authorId: viewerId },
        { visibility: 'shared' },
        { visibility: 'scheduled', revealAt: { lte: new Date() } },
      ],
    };
  }
  return base;
}

function decodeCursor(cursor: string | undefined): { createdAt: Date; id: string } | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8')) as { createdAt: string; id: string };
    if (!parsed.createdAt || !parsed.id) return null;
    return { createdAt: new Date(parsed.createdAt), id: parsed.id };
  } catch {
    return null;
  }
}
function encodeCursor(row: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify({ createdAt: (row.createdAt as Date).toISOString(), id: row.id })).toString('base64');
}

async function favouriteIds(userId: string, kind: ContentKind): Promise<string[]> {
  const rows = await prisma.favorite.findMany({ where: { userId, resourceType: kind } });
  return rows.map((r) => r.resourceId);
}

function makeRoutes(kind: ContentKind, createSchema: ZodSchema<unknown>, updateSchema: ZodSchema<unknown>) {
  const plural = PLURALS[kind];
  const singular = SINGULARS[kind];
  const d = delegate(kind);
  const favouritable = kind === 'memory' || kind === 'appreciation' || kind === 'plan' || kind === 'reminder';

  contentRouter.get(`/spaces/:spaceId/${plural}`, validateQuery(paginationSchema), async (req, res, next) => {
    try {
      if (!req.user) throw unauthorized();
      const spaceId = req.params.spaceId ?? '';
      await requireSpaceMember(req.user.id, spaceId);
      const q = (req as unknown as { validatedQuery: { limit: number; cursor?: string; deleted: boolean; favourited: boolean } }).validatedQuery;
      const cursor = decodeCursor(q.cursor);
      let where = visibilityWhere(kind, spaceId, req.user.id, q.deleted);
      if (q.deleted) {
        // Deleted view: only the caller's own soft-deleted rows, for
        // every type (a partner never sees another author's deletions).
        where = { ...where, authorId: req.user.id };
      }
      if (q.favourited) {
        const ids = await favouriteIds(req.user.id, kind);
        where = { ...where, id: { in: ids } };
      }
      if (cursor) {
        where = {
          ...where,
          OR: [
            { createdAt: { lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { lt: cursor.id } },
          ],
        };
        // For letters, cursor pagination + visibility OR need an AND
        // wrapper; rebuild the where clause accordingly.
        if (kind === 'letter') {
          const vis = visibilityWhere(kind, spaceId, req.user.id, q.deleted);
          where = {
            spaceId, deletedAt: q.deleted ? { not: null } : null,
            AND: [
              { OR: (vis as { OR: unknown[] }).OR },
              { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] },
            ],
          };
          if (q.deleted) (where as Record<string, unknown>).authorId = req.user.id;
          if (q.favourited) (where as Record<string, unknown>).id = { in: await favouriteIds(req.user.id, kind) };
        }
      }
      const rows = await d.findMany({
        where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: q.limit + 1,
      });
      const page = rows.slice(0, q.limit);
      const nextCursor = rows.length > q.limit ? encodeCursor(page[page.length - 1]!) : null;
      return res.json({ data: page.map((r) => serialize(kind, r, req.user!.id)), meta: { nextCursor } });
    } catch (e) {
      return next(e);
    }
  });

  contentRouter.post(`/spaces/:spaceId/${plural}`, validateBody(createSchema), async (req, res, next) => {
    try {
      if (!req.user) throw unauthorized();
      const spaceId = req.params.spaceId ?? '';
      await requireSpaceMember(req.user.id, spaceId);
      const idemKey = req.headers['idempotency-key'] as string | undefined;
      const check = await checkIdempotency(req.user.id, idemKey, 'POST', req.path, req.body);
      assertNotIdempotencyConflict(check);
      if (check.kind === 'replay') {
        const existing = await d.findFirst({ where: { id: check.resourceId, ...visibilityWhere(kind, spaceId, req.user.id, false) } });
        if (!existing) throw notFound();
        return res.status(check.responseStatus).json({ data: serialize(kind, existing, req.user.id) });
      }
      const body = req.body as Record<string, unknown>;
      // Client-supplied identity/membership fields are ignored (T16):
      // author and space always come from the session and the path.
      const data: Record<string, unknown> = { ...body, authorId: req.user.id, spaceId };
      if (kind === 'letter' && body.memoryId) {
        const memory = await prisma.memory.findFirst({ where: { id: body.memoryId as string, spaceId, deletedAt: null } });
        if (!memory) throw notFound();
      }
      if (kind === 'letter' && body.revealAt) data.revealAt = new Date(body.revealAt as string);
      if (kind === 'memory' && body.happenedOn) data.happenedOn = new Date(body.happenedOn as string);
      if (kind === 'plan' && body.targetDate) data.targetDate = new Date(body.targetDate as string);
      const created = await d.create({ data });
      await storeIdempotency(req.user.id, idemKey, 'POST', req.path, req.body, kind, created.id as string, 201);
      await audit(`${kind}.create`, kind, created.id as string, { actorId: req.user.id, spaceId, outcome: 'success' });
      return res.status(201).json({ data: serialize(kind, created, req.user.id) });
    } catch (e) {
      return next(e);
    }
  });

  contentRouter.get(`/${singular}/:id`, async (req, res, next) => {
    try {
      if (!req.user) throw unauthorized();
      const id = req.params.id ?? '';
      const row = await d.findFirst({ where: { id, deletedAt: null } });
      if (!row) throw notFound();
      // Membership is checked against the row's own space BEFORE
      // visibility: without this, any authenticated user who knew an
      // id could read another space's shared rows through this
      // singular detail route (the list routes are space-scoped and
      // already check membership; this route is not). Non-members
      // get the same generic 404 as a non-existent row.
      await requireSpaceMember(req.user.id, row.spaceId as string);
      // Visibility is re-checked against the row's own space.
      const where = visibilityWhere(kind, row.spaceId as string, req.user.id, false);
      const visible = await d.findFirst({ where: { id, ...where } });
      if (!visible) {
        await audit(`${kind}.read-denied`, kind, id, { actorId: req.user.id, outcome: 'denied' });
        throw notFound();
      }
      return res.json({ data: serialize(kind, visible, req.user.id) });
    } catch (e) {
      return next(e);
    }
  });

  contentRouter.patch(`/${singular}/:id`, validateBody(updateSchema), async (req, res, next) => {
    try {
      if (!req.user) throw unauthorized();
      const id = req.params.id ?? '';
      // Edit is author-only by default (spec §3.4); a partner PATCH
      // returns the same generic 404 as a non-existent row.
      const row = await d.findFirst({ where: { id, authorId: req.user.id, deletedAt: null } });
      if (!row) throw notFound();
      if (kind === 'plan' && (req.body as Record<string, unknown>).status === 'done') {
        throw badRequest('Use the complete endpoint to mark a plan done');
      }
      const body = req.body as Record<string, unknown>;
      // A letter moved to 'scheduled' must end up with a revealAt.
      // The schema only blocks an explicit null, so a PATCH that sets
      // visibility without revealAt on a letter that had none used to
      // reach the DB CHECK as a generic 500. Resolve the final values
      // against the existing row and reject with a 400 instead.
      if (kind === 'letter') {
        const finalVisibility = (body.visibility as string | undefined) ?? (row as { visibility: string }).visibility;
        const finalRevealAt = 'revealAt' in body ? body.revealAt : (row as { revealAt: unknown }).revealAt;
        if (finalVisibility === 'scheduled' && !finalRevealAt) throw badRequest('A scheduled letter requires revealAt');
      }
      const data: Record<string, unknown> = { ...body };
      if (kind === 'letter' && body.revealAt) data.revealAt = new Date(body.revealAt as string);
      if (kind === 'memory' && body.happenedOn) data.happenedOn = new Date(body.happenedOn as string);
      if (kind === 'plan' && body.targetDate) data.targetDate = new Date(body.targetDate as string);
      delete data.authorId; delete data.spaceId; delete data.status;
      const updated = await d.update({ where: { id }, data });
      return res.json({ data: serialize(kind, updated, req.user.id) });
    } catch (e) {
      return next(e);
    }
  });

  contentRouter.post(`/${singular}/:id/soft-delete`, async (req, res, next) => {
    try {
      if (!req.user) throw unauthorized();
      const id = req.params.id ?? '';
      const row = await d.findFirst({ where: { id, authorId: req.user.id, deletedAt: null } });
      if (!row) throw notFound();
      const updated = await d.update({ where: { id }, data: { deletedAt: new Date() } });
      return res.json({ data: serialize(kind, updated, req.user.id) });
    } catch (e) {
      return next(e);
    }
  });

  contentRouter.post(`/${singular}/:id/restore`, async (req, res, next) => {
    try {
      if (!req.user) throw unauthorized();
      const id = req.params.id ?? '';
      const row = await d.findFirst({ where: { id, authorId: req.user.id, deletedAt: { not: null } } });
      if (!row) throw notFound();
      if (!isRestoreWindowOpen(row.deletedAt as Date, new Date(), config.restoreWindowDays)) {
        throw conflict('RESTORE_WINDOW_EXPIRED', 'Restore window has expired');
      }
      const updated = await d.update({ where: { id }, data: { deletedAt: null } });
      return res.json({ data: serialize(kind, updated, req.user.id) });
    } catch (e) {
      return next(e);
    }
  });

  contentRouter.delete(`/${singular}/:id`, async (req, res, next) => {
    try {
      if (!req.user) throw unauthorized();
      const id = req.params.id ?? '';
      const row = await d.findFirst({ where: { id, authorId: req.user.id, deletedAt: { not: null } } });
      if (!row) {
        // Permanent delete without prior soft delete is refused;
        // indistinguishable 404/409 handling: if the row exists but
        // is not soft-deleted, return a conflict, otherwise 404.
        const exists = await d.findFirst({ where: { id, authorId: req.user.id, deletedAt: null } });
        if (exists) throw conflict('NOT_SOFT_DELETED', 'Permanently delete only after soft delete');
        throw notFound();
      }
      // Permanent delete: remove the row and its media asset rows in
      // one transaction, creating durable deletion jobs that survive
      // the asset rows (spec §5.6).
      await prisma.$transaction(async (tx) => {
        const linkField = kind === 'memory' ? 'memoryId' : kind === 'plan' ? 'planId' : kind === 'voiceNote' ? 'voiceNoteId' : null;
        if (linkField) {
          const assets = await tx.mediaAsset.findMany({ where: { [linkField]: id } });
          for (const asset of assets) {
            await tx.mediaDeletionJob.create({ data: { assetId: asset.id, storageKey: asset.storageKey } });
          }
          await tx.mediaAsset.deleteMany({ where: { [linkField]: id } });
        }
        await tx.favorite.deleteMany({ where: { resourceType: kind, resourceId: id } });
        if (kind === 'memory') await tx.memory.delete({ where: { id } });
        else if (kind === 'letter') await tx.letter.delete({ where: { id } });
        else if (kind === 'journal') await tx.journalEntry.delete({ where: { id } });
        else if (kind === 'appreciation') await tx.appreciation.delete({ where: { id } });
        else if (kind === 'plan') await tx.futurePlan.delete({ where: { id } });
        else if (kind === 'reminder') await tx.reminder.delete({ where: { id } });
        else await tx.voiceNote.delete({ where: { id } });
      });
      await audit(`${kind}.permanent-delete`, kind, id, { actorId: req.user.id, spaceId: row.spaceId as string, outcome: 'success' });
      return res.json({ data: { ok: true } });
    } catch (e) {
      return next(e);
    }
  });

  if (favouritable) {
    contentRouter.post(`/${singular}/:id/favourite`, async (req, res, next) => {
      try {
        if (!req.user) throw unauthorized();
        const id = req.params.id ?? '';
        const row = await d.findFirst({ where: { id, deletedAt: null } });
        if (!row) throw notFound();
        // Favourite hardening (Phase 5): the row must be one the
        // caller can actually see under the existing visibility
        // rules, not merely one that exists in some space. For the
        // favouritable kinds (memory, appreciation, plan, reminder)
        // visibilityWhere is space + non-deleted, but routing the
        // check through it means any future private variant is
        // automatically protected too. Invisible rows get the
        // generic 404 with no content leak.
        await requireSpaceMember(req.user.id, row.spaceId as string);
        const visible = await d.findFirst({
          where: { id, ...visibilityWhere(kind, row.spaceId as string, req.user.id, false) },
        });
        if (!visible) throw notFound();
        const existing = await prisma.favorite.findUnique({ where: { userId_resourceType_resourceId: { userId: req.user.id, resourceType: kind, resourceId: id } } });
        if (existing) {
          await prisma.favorite.delete({ where: { id: existing.id } });
          return res.json({ data: { favourited: false } });
        }
        await prisma.favorite.create({ data: { userId: req.user.id, resourceType: kind, resourceId: id } });
        return res.json({ data: { favourited: true } });
      } catch (e) {
        return next(e);
      }
    });
  }
}

makeRoutes('memory', memoryCreateSchema, memoryUpdateSchema);
makeRoutes('letter', letterCreateSchema, letterUpdateSchema);
makeRoutes('journal', journalCreateSchema, journalUpdateSchema);
makeRoutes('appreciation', appreciationCreateSchema, appreciationUpdateSchema);
makeRoutes('plan', planCreateSchema, planUpdateSchema);
makeRoutes('reminder', reminderCreateSchema, reminderUpdateSchema);
makeRoutes('voiceNote', voiceNoteCreateSchema, voiceNoteUpdateSchema);

// Plan completion — the ONLY path to done, in one transaction with
// optional linked-memory creation (spec §3.5). Unique sourcePlanId
// prevents a duplicate memory even on retry/concurrency.
contentRouter.post('/plan/:id/complete', validateBody(planCompleteSchema), async (req, res, next) => {
  try {
    if (!req.user) throw unauthorized();
    const id = req.params.id ?? '';
    const body = req.body as { createMemory?: boolean; memoryTitle?: string; memoryCaption?: string };
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "FuturePlan" WHERE "id" = ${id} FOR UPDATE`;
      const plan = await tx.futurePlan.findFirst({ where: { id, authorId: req.user!.id, deletedAt: null } });
      if (!plan) throw notFound();
      if (plan.status === 'done') throw conflict('ALREADY_DONE', 'Plan is already done');
      const updated = await tx.futurePlan.update({ where: { id }, data: { status: 'done', completedAt: new Date() } });
      let memory = null;
      if (body.createMemory) {
        memory = await tx.memory.create({
          data: {
            spaceId: plan.spaceId, authorId: req.user!.id,
            title: body.memoryTitle ?? plan.title,
            caption: body.memoryCaption ?? '', story: '', sourcePlanId: plan.id,
          },
        });
      }
      return { plan: updated, memory };
    });
    await audit('plan.complete', 'plan', id, { actorId: req.user.id, outcome: 'success' });
    return res.json({ data: result });
  } catch (e) {
    // A unique-constraint violation on sourcePlanId means a retry
    // already created the memory; report it as a conflict, never
    // as a second memory.
    if (e instanceof ApiError) return next(e);
    const msg = e instanceof Error ? e.message : '';
    if (msg.includes('sourcePlanId') || msg.includes('Unique constraint')) {
      return next(conflict('ALREADY_DONE', 'Plan is already done'));
    }
    return next(e);
  }
});

// Random pick for appreciations/reminders: only visible, non-deleted
// rows for the caller, no counts that could leak private rows.
for (const [kind, plural] of [['appreciation', 'appreciations'], ['reminder', 'reminders']] as const) {
  contentRouter.get(`/spaces/:spaceId/${plural}/random`, async (req, res, next) => {
    try {
      if (!req.user) throw unauthorized();
      const spaceId = req.params.spaceId ?? '';
      await requireSpaceMember(req.user.id, spaceId);
      const d = delegate(kind as ContentKind);
      const rows = await d.findMany({ where: { spaceId, deletedAt: null } });
      if (rows.length === 0) return res.json({ data: null });
      const pick = rows[Math.floor(Math.random() * rows.length)]!;
      return res.json({ data: serialize(kind as ContentKind, pick, req.user.id) });
    } catch (e) {
      return next(e);
    }
  });
}
