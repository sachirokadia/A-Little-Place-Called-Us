import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { badRequest, notFound, unauthorized } from '../errors.js';
import { audit } from '../lib/audit.js';
import { ALLOWED_AUDIO_TYPES, ALLOWED_IMAGE_TYPES, processUpload } from '../lib/media.js';
import { requireSpaceMember } from '../lib/membership.js';
import { storage } from '../lib/storage.js';
import { checkRateLimit, RATE_LIMITS, uploadUserKey } from '../lib/rateLimit.js';

export const mediaRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

function extFor(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
    'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a',
  };
  return map[mime] ?? 'bin';
}

async function loadLinkedItem(linkedType: string, linkedId: string) {
  if (linkedType === 'memory') return { kind: 'memory', row: await prisma.memory.findUnique({ where: { id: linkedId } }) };
  if (linkedType === 'plan') return { kind: 'plan', row: await prisma.futurePlan.findUnique({ where: { id: linkedId } }) };
  if (linkedType === 'voiceNote') return { kind: 'voiceNote', row: await prisma.voiceNote.findUnique({ where: { id: linkedId } }) };
  return { kind: linkedType, row: null };
}

// Upload: API-gated, ownership checked at upload time AND at every
// stream (request time, spec §5.5). No public URL is ever returned.
mediaRouter.post('/spaces/:spaceId/media', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.user) throw unauthorized();
    const spaceId = req.params.spaceId ?? '';
    await requireSpaceMember(req.user.id, spaceId);
    await checkRateLimit(uploadUserKey(req.user.id), RATE_LIMITS.uploadPerUser.limit, RATE_LIMITS.uploadPerUser.windowMs);
    const linkedType = req.body?.linkedType as string;
    const linkedId = req.body?.linkedId as string;
    if (!['memory', 'plan', 'voiceNote'].includes(linkedType) || !linkedId) throw badRequest('Invalid linked item');
    const { row } = await loadLinkedItem(linkedType, linkedId);
    if (!row || (row as { spaceId: string }).spaceId !== spaceId || (row as { deletedAt: Date | null }).deletedAt) throw notFound();
    // Upload is author-only (spec §3.4: partner may view a visible item,
    // but only its author uploads to it). Edit/delete were already
    // author-only; upload was the one route that only checked membership.
    if ((row as { authorId: string }).authorId !== req.user.id) throw notFound();
    const file = req.file;
    if (!file) throw badRequest('No file uploaded');
    const isImage = ALLOWED_IMAGE_TYPES.includes(file.mimetype);
    const isAudio = ALLOWED_AUDIO_TYPES.includes(file.mimetype);
    if (!isImage && !isAudio) throw badRequest('File type not allowed');
    const maxBytes = isImage ? config.photoMaxMb * 1024 * 1024 : config.voiceMaxMb * 1024 * 1024;
    if (file.size > maxBytes) throw badRequest('File too large');
    const processed = await processUpload(file.buffer, file.mimetype);
    // Storage key: random UUID + extension only. No email, name, or
    // original filename is ever in a key or in an API response.
    const storageKey = `${randomUUID()}.${extFor(file.mimetype)}`;
    await storage().put(storageKey, processed.data);
    const asset = await prisma.mediaAsset.create({
      data: {
        ownerId: req.user.id,
        ...(linkedType === 'memory' ? { memoryId: linkedId } : linkedType === 'plan' ? { planId: linkedId } : { voiceNoteId: linkedId }),
        status: 'active', storageKey, mimeType: file.mimetype, byteSize: processed.data.length,
        width: processed.width, height: processed.height, originalFilename: '',
      },
    });
    await audit('media.upload', 'media', asset.id, { actorId: req.user.id, spaceId, outcome: 'success' });
    const { storageKey: _sk, ...publicAsset } = asset as unknown as Record<string, unknown>;
    return res.status(201).json({ data: publicAsset });
  } catch (e) {
    return next(e);
  }
});

// List assets for a linked item (member only, item not deleted).
// Voice notes are author-only (like journals): a partner listing a
// voice note's assets gets the same generic 404 as for a journal.
mediaRouter.get('/media/for/:linkedType/:linkedId', async (req, res, next) => {
  try {
    if (!req.user) throw unauthorized();
    const { linkedType, linkedId } = req.params;
    const { row } = await loadLinkedItem(linkedType ?? '', linkedId ?? '');
    if (!row || (row as { deletedAt: Date | null }).deletedAt) throw notFound();
    if (linkedType === 'voiceNote' && (row as { authorId: string }).authorId !== req.user.id) throw notFound();
    await requireSpaceMember(req.user.id, (row as { spaceId: string }).spaceId);
    const where = linkedType === 'memory' ? { memoryId: linkedId } : linkedType === 'plan' ? { planId: linkedId } : { voiceNoteId: linkedId };
    const assets = await prisma.mediaAsset.findMany({ where: { ...where, status: 'active' }, orderBy: { createdAt: 'asc' } });
    const publicAssets = assets.map((a) => {
      const { storageKey: _sk, ...rest } = a as unknown as Record<string, unknown>;
      return rest;
    });
    return res.json({ data: publicAssets });
  } catch (e) {
    return next(e);
  }
});

// Stream: ownership + visibility checked at REQUEST time, not upload
// time. Soft-deleted linked items refuse media to everyone.
mediaRouter.get('/media/:id', async (req, res, next) => {
  try {
    if (!req.user) throw unauthorized();
    const id = req.params.id ?? '';
    const asset = await prisma.mediaAsset.findUnique({ where: { id } });
    if (!asset || asset.status !== 'active') throw notFound();
    let spaceId: string | null = null;
    if (asset.memoryId) {
      const item = await prisma.memory.findUnique({ where: { id: asset.memoryId } });
      if (!item || item.deletedAt) throw notFound();
      spaceId = item.spaceId;
    } else if (asset.planId) {
      const item = await prisma.futurePlan.findUnique({ where: { id: asset.planId } });
      if (!item || item.deletedAt) throw notFound();
      spaceId = item.spaceId;
    } else if (asset.voiceNoteId) {
      const item = await prisma.voiceNote.findUnique({ where: { id: asset.voiceNoteId } });
      if (!item || item.deletedAt) throw notFound();
      if (item.authorId !== req.user.id) throw notFound();
      spaceId = item.spaceId;
    }
    if (!spaceId) throw notFound();
    await requireSpaceMember(req.user.id, spaceId);
    const stream = await storage().stream(asset.storageKey);
    res.setHeader('Content-Type', asset.mimeType);
    res.setHeader('Content-Length', String(asset.byteSize));
    res.setHeader('Cache-Control', 'private, no-store');
    stream.pipe(res);
    await audit('media.stream', 'media', asset.id, { actorId: req.user.id, spaceId, outcome: 'success' });
  } catch (e) {
    return next(e);
  }
});

// Soft-delete an asset (via its linked item's author). Permanent
// removal happens with the linked item's permanent delete, which
// creates a MediaDeletionJob; this endpoint never deletes bytes alone.
mediaRouter.delete('/media/:id', async (req, res, next) => {
  try {
    if (!req.user) throw unauthorized();
    const id = req.params.id ?? '';
    const asset = await prisma.mediaAsset.findUnique({ where: { id } });
    if (!asset || asset.ownerId !== req.user.id) throw notFound();
    await prisma.mediaAsset.update({ where: { id }, data: { status: 'soft_deleted' } });
    return res.json({ data: { ok: true } });
  } catch (e) {
    return next(e);
  }
});
