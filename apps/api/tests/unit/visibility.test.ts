import { describe, expect, it } from 'vitest';
import { isLetterDelivered, isRestoreWindowOpen, maskLetter } from '../../src/lib/visibility.js';
import { letterCreateSchema } from '@little-place/shared';

const baseLetter = {
  id: '1', spaceId: 's', authorId: 'author', title: 'Hi', body: 'secret body',
  visibility: 'scheduled' as const, revealAt: new Date('2030-01-01T00:00:00Z'),
  memoryId: null, deletedAt: null, createdAt: new Date(), updatedAt: new Date(),
};

describe('scheduled letters (spec §3.5, T5)', () => {
  it('is not delivered before revealAt, regardless of client clock claims', () => {
    expect(isLetterDelivered(baseLetter, new Date('2026-01-01T00:00:00Z'))).toBe(false);
    expect(isLetterDelivered(baseLetter, new Date('2030-01-01T00:00:00Z'))).toBe(true);
    expect(isLetterDelivered(baseLetter, new Date('2031-01-01T00:00:00Z'))).toBe(true);
  });
  it('masks the body for a non-author before delivery, but not for the author', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    expect(maskLetter(baseLetter, 'partner', now).body).toBe('');
    expect(maskLetter(baseLetter, 'author', now).body).toBe('secret body');
    expect(maskLetter({ ...baseLetter, visibility: 'shared' }, 'partner', now).body).toBe('secret body');
  });
});

describe('restore window (spec §3.5, R7 proposed)', () => {
  it('is open within the window and closed after it', () => {
    const deletedAt = new Date('2026-01-01T00:00:00Z');
    expect(isRestoreWindowOpen(deletedAt, new Date('2026-01-15T00:00:00Z'), 30)).toBe(true);
    expect(isRestoreWindowOpen(deletedAt, new Date('2026-02-15T00:00:00Z'), 30)).toBe(false);
    expect(isRestoreWindowOpen(null, new Date(), 30)).toBe(false);
  });
});

describe('letter schema', () => {
  it('rejects a scheduled letter without revealAt', () => {
    const parsed = letterCreateSchema.safeParse({ title: 'T', body: 'B', visibility: 'scheduled' });
    expect(parsed.success).toBe(false);
  });
  it('accepts a shared letter without revealAt', () => {
    const parsed = letterCreateSchema.safeParse({ title: 'T', body: 'B', visibility: 'shared' });
    expect(parsed.success).toBe(true);
  });
});
