import { beforeAll, describe, expect, it } from 'vitest';
import { authed, cleanDb, createSpaceWithMembers } from './helpers.js';

// Release QA fix: the singular detail routes (GET /:singular/:id)
// previously re-checked visibility but never membership, so any
// authenticated user who knew an id could read another space's
// shared rows. Membership against the row's own space is now
// required first, for all seven kinds, in both directions, while
// same-space reads still succeed.
beforeAll(async () => {
  await cleanDb();
});

describe('cross-space singular detail reads', () => {
  it('404 for all seven kinds in both directions, 200 same-space', async () => {
    const one = await createSpaceWithMembers(['Cross A', 'Cross B']);
    const two = await createSpaceWithMembers(['Cross C', 'Cross D']);
    const [a, b] = one.agents as [NonNullable<(typeof one.agents)[0]>, NonNullable<(typeof one.agents)[0]>];
    const [c, d] = two.agents as [NonNullable<(typeof two.agents)[0]>, NonNullable<(typeof two.agents)[0]>];

    const created: { singular: string; id: string }[] = [];
    const mk = async (plural: string, singular: string, body: Record<string, unknown>) => {
      const res = await authed(a).post(`/api/v1/spaces/${one.spaceId}/${plural}`, body);
      expect(res.status).toBe(201);
      created.push({ singular, id: (res.body as { data: { id: string } }).data.id });
    };
    await mk('memories', 'memory', { title: 'Cross memory' });
    await mk('letters', 'letter', { title: 'Cross letter', body: 'shared body', visibility: 'shared' });
    await mk('journals', 'journal', { title: 'Cross journal', body: 'private body' });
    await mk('appreciations', 'appreciation', { text: 'Cross appreciation', kind: 'appreciation', forName: 'Partner' });
    await mk('plans', 'plan', { title: 'Cross plan', category: 'trip' });
    await mk('reminders', 'reminder', { text: 'Cross reminder', kind: 'note' });
    await mk('voice-notes', 'voice-note', { title: 'Cross voice note' });

    // Delivered scheduled letter in space one: same-space partner
    // reads it, but a cross-space user must not, even though it is
    // fully visible inside its own space.
    const delivered = await authed(a).post(`/api/v1/spaces/${one.spaceId}/letters`, {
      title: 'Cross delivered', body: 'delivered body', visibility: 'scheduled',
      revealAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect(delivered.status).toBe(201);
    created.push({ singular: 'letter', id: (delivered.body as { data: { id: string } }).data.id });

    for (const { singular, id } of created) {
      // Cross-space in both directions: neither space's members read
      // the other space's rows, even the shared/delivered ones.
      expect((await authed(c).get(`/api/v1/${singular}/${id}`)).status).toBe(404);
      expect((await authed(d).get(`/api/v1/${singular}/${id}`)).status).toBe(404);
      // Same-space reads still work for rows the viewer may see:
      // shared rows for the partner, author-only rows for the author.
      const partner = await authed(b).get(`/api/v1/${singular}/${id}`);
      const author = await authed(a).get(`/api/v1/${singular}/${id}`);
      expect(author.status).toBe(200);
      if (singular === 'journal' || singular === 'voice-note') {
        expect(partner.status).toBe(404);
      } else {
        expect(partner.status).toBe(200);
      }
    }

    // Mirror direction: a row created in space two is 404 for space
    // one's members, 200 for its own author.
    const other = await authed(c).post(`/api/v1/spaces/${two.spaceId}/memories`, { title: 'Other space memory' });
    expect(other.status).toBe(201);
    const otherId = (other.body as { data: { id: string } }).data.id;
    expect((await authed(a).get(`/api/v1/memory/${otherId}`)).status).toBe(404);
    expect((await authed(b).get(`/api/v1/memory/${otherId}`)).status).toBe(404);
    expect((await authed(c).get(`/api/v1/memory/${otherId}`)).status).toBe(200);
  });

  it('blank reminders and impossible dates are 400', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['Val A', 'Val B']);
    const [a] = agents as [NonNullable<(typeof agents)[0]>];
    expect((await authed(a).post(`/api/v1/spaces/${spaceId}/reminders`, { text: '   ', kind: 'note' })).status).toBe(400);
    expect((await authed(a).post(`/api/v1/spaces/${spaceId}/reminders`, { text: '', kind: 'note' })).status).toBe(400);
    expect((await authed(a).post(`/api/v1/spaces/${spaceId}/memories`, { title: 'Bad date', happenedOn: '2026-02-30' })).status).toBe(400);
    expect((await authed(a).post(`/api/v1/spaces/${spaceId}/plans`, { title: 'Bad target', category: 'trip', targetDate: '2026-02-30' })).status).toBe(400);
    // Real dates still pass.
    expect((await authed(a).post(`/api/v1/spaces/${spaceId}/memories`, { title: 'Leap day', happenedOn: '2024-02-29' })).status).toBe(201);
    expect((await authed(a).post(`/api/v1/spaces/${spaceId}/plans`, { title: 'Good target', category: 'trip', targetDate: '2026-03-02' })).status).toBe(201);
  });
});
