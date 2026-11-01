import { prisma } from '../db.js';
import { forbidden, notFound } from '../errors.js';

// Membership lookup — the predicate, not a post-fetch check.
// Returns the spaceId if the caller is a member, otherwise throws a
// generic 404 (indistinguishable from non-existent).
export async function requireSpaceMember(userId: string, spaceId: string): Promise<string> {
  const member = await prisma.spaceMember.findUnique({ where: { userId } });
  if (!member || member.spaceId !== spaceId) throw notFound();
  return spaceId;
}

export async function callerSpaceId(userId: string): Promise<string | null> {
  const member = await prisma.spaceMember.findUnique({ where: { userId } });
  return member?.spaceId ?? null;
}

// Authorized lookup helper for a content row: the query itself must
// include space + (optionally) author predicates.
export async function spaceOfItem(spaceId: string, userId: string): Promise<void> {
  await requireSpaceMember(userId, spaceId);
}

export function assertAuthor(authorId: string, userId: string): void {
  if (authorId !== userId) throw forbidden();
}
