import { prisma } from '../db.js';

// Audit rows contain NO content bodies, tokens, codes, or media bytes.
export async function audit(
  action: string, resourceType: string, resourceId: string,
  opts: { actorId?: string | null; spaceId?: string | null; outcome?: string } = {},
): Promise<void> {
  try {
    await prisma.auditEvent.create({
      data: {
        action, resourceType, resourceId,
        actorId: opts.actorId ?? null, spaceId: opts.spaceId ?? null,
        outcome: opts.outcome ?? 'success',
      },
    });
  } catch {
    // Audit failure must not leak internals; the caller already
    // succeeded/failed on its own path. Logged to stderr only.
    console.error('audit write failed', action, resourceType);
  }
}
