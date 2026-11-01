import { createHash } from 'node:crypto';
import { prisma } from '../db.js';
import { conflict } from '../errors.js';

export function requestHash(method: string, path: string, body: unknown): string {
  const canonical = JSON.stringify({ method, path, body: sortKeys(body) });
  return createHash('sha256').update(canonical).digest('hex');
}
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortKeys(v)]),
    );
  }
  return value;
}

export type IdempotencyCheck =
  | { kind: 'none' }
  | { kind: 'replay'; resourceType: string; resourceId: string; responseStatus: number }
  | { kind: 'conflict' };

export async function checkIdempotency(
  userId: string, key: string | undefined, method: string, path: string, body: unknown,
): Promise<IdempotencyCheck> {
  if (!key) return { kind: 'none' };
  const hash = requestHash(method, path, body);
  const row = await prisma.idempotencyKey.findUnique({ where: { userId_key: { userId, key } } });
  if (!row) return { kind: 'none' };
  if (row.requestHash !== hash) return { kind: 'conflict' };
  if (!row.resourceId) return { kind: 'none' };
  return { kind: 'replay', resourceType: row.resourceType, resourceId: row.resourceId, responseStatus: row.responseStatus };
}

export async function storeIdempotency(
  userId: string, key: string | undefined, method: string, path: string, body: unknown,
  resourceType: string, resourceId: string, responseStatus: number,
): Promise<void> {
  if (!key) return;
  const hash = requestHash(method, path, body);
  await prisma.idempotencyKey.upsert({
    where: { userId_key: { userId, key } },
    update: { requestHash: hash, resourceType, resourceId, responseStatus, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
    create: { userId, key, requestHash: hash, resourceType, resourceId, responseStatus, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
  });
}

export function assertNotIdempotencyConflict(check: IdempotencyCheck): void {
  if (check.kind === 'conflict') throw conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key was reused with a different request');
}
