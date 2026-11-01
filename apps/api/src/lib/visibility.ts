// Pure visibility logic — no database, no network, unit-testable.
// The query predicates in the routes are the primary control; these
// serialisers are defence in depth and must never be the only layer.

export type LetterRow = {
  id: string; spaceId: string; authorId: string; title: string; body: string;
  visibility: 'shared' | 'private_draft' | 'scheduled'; revealAt: Date | null;
  memoryId: string | null; deletedAt: Date | null; createdAt: Date; updatedAt: Date;
};

export function isLetterDelivered(letter: LetterRow, now: Date): boolean {
  return letter.visibility !== 'scheduled' || (letter.revealAt !== null && now >= letter.revealAt);
}

/**
 * Default envelope policy for Phase 1A (R6 UNDECIDED): a scheduled
 * letter is fully hidden from the partner until delivery. Routes
 * already exclude such letters from partner lists/reads (404); this
 * serialiser additionally strips the body if one ever reaches it.
 */
export function maskLetter<T extends LetterRow>(letter: T, viewerId: string, now: Date): T {
  if (letter.authorId === viewerId) return letter;
  if (letter.visibility === 'scheduled' && !isLetterDelivered(letter, now)) {
    return { ...letter, body: '' } as T;
  }
  return letter;
}

export function isRestoreWindowOpen(deletedAt: Date | null, now: Date, windowDays: number): boolean {
  if (!deletedAt) return false;
  return now.getTime() - deletedAt.getTime() <= windowDays * 24 * 60 * 60 * 1000;
}
