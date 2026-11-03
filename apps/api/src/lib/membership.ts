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

export function assertAuthor(authorId: string, userId: string): void {
  if (authorId !== userId) throw forbidden();
}
