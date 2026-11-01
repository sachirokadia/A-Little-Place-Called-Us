import { beforeAll, describe, expect, it } from 'vitest';
import { app, authed, cleanDb, createSpaceWithMembers } from './helpers.js';

// Phase 3: create + edit every destination record type, scheduled-letter
// visibility, the private-draft boundary, shared-plan completion with its
// Memory Wall keepsake, and soft-delete/restore — all through the API,
// because the frontend renders exactly what the API returns.

beforeAll(async () => {
  await cleanDb();
});

function id(res: { body: { data: { id: string } } }): string {
  return res.body.data.id;
}

describe('Phase 3 destination flows', () => {
  it('creates and edits a memory, letter, journal, appreciation, and plan', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['P3 A', 'P3 B']);
    const [a] = agents as [NonNullable<(typeof agents)[0]>];
    const memory = await authed(a).post(`/api/v1/spaces/${spaceId}/memories`, { title: 'First', caption: 'cap', story: 'story', happenedOn: '2026-01-02' });
    expect(memory.status).toBe(201);
    expect((await authed(a).patch(`/api/v1/memory/${id(memory)}`, { title: 'First, edited', caption: 'cap2' })).body.data.title).toBe('First, edited');

    const letter = await authed(a).post(`/api/v1/spaces/${spaceId}/letters`, { title: 'Hello', body: 'dear you', visibility: 'shared' });
    expect(letter.status).toBe(201);
    expect((await authed(a).patch(`/api/v1/letter/${id(letter)}`, { body: 'dear you, edited' })).body.data.body).toBe('dear you, edited');

    const journal = await authed(a).post(`/api/v1/spaces/${spaceId}/journals`, { title: 'Quiet', body: 'calm', mood: 'calm' });
    expect(journal.status).toBe(201);
    expect((await authed(a).patch(`/api/v1/journal/${id(journal)}`, { mood: 'hopeful' })).body.data.mood).toBe('hopeful');

    const card = await authed(a).post(`/api/v1/spaces/${spaceId}/appreciations`, { text: 'You are kind', kind: 'appreciation', forName: 'Partner' });
    expect(card.status).toBe(201);
    expect((await authed(a).patch(`/api/v1/appreciation/${id(card)}`, { text: 'You are very kind' })).body.data.text).toBe('You are very kind');

    const plan = await authed(a).post(`/api/v1/spaces/${spaceId}/plans`, { title: 'Picnic', detail: 'by the river', category: 'date', targetDate: '2026-06-01', location: 'Riverside' });
    expect(plan.status).toBe(201);
    expect((await authed(a).patch(`/api/v1/plan/${id(plan)}`, { location: 'Lakeside', category: 'trip' })).body.data.location).toBe('Lakeside');
  });

  it('partner cannot delete or edit the other author private draft, and sees no title leak', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['Draft3 A', 'Draft3 B']);
    const [a, b] = agents as [NonNullable<(typeof agents)[0]>, NonNullable<(typeof agents)[1]>];
    const draft = await authed(a).post(`/api/v1/spaces/${spaceId}/letters`, { title: 'Secret draft title', body: 'secret', visibility: 'private_draft' });
    const draftId = id(draft);
    expect((await authed(b).patch(`/api/v1/letter/${draftId}`, { title: 'Hacked' })).status).toBe(404);
    expect((await authed(b).post(`/api/v1/letter/${draftId}/soft-delete`, {})).status).toBe(404);
    const list = await authed(b).get(`/api/v1/spaces/${spaceId}/letters`);
    expect(((list.body as { data: { title: string }[] }).data).map((l) => l.title)).not.toContain('Secret draft title');
    expect((await authed(a).get(`/api/v1/letter/${draftId}`)).status).toBe(200);
  });

  it('scheduled letter is invisible pre-release and visible post-release, by server time', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['Sched3 A', 'Sched3 B']);
    const [a, b] = agents as [NonNullable<(typeof agents)[0]>, NonNullable<(typeof agents)[1]>];
    const future = await authed(a).post(`/api/v1/spaces/${spaceId}/letters`, { title: 'Not yet', body: 'later', visibility: 'scheduled', revealAt: new Date(Date.now() + 86400_000).toISOString() });
    const futureId = id(future);
    expect((await authed(b).get(`/api/v1/letter/${futureId}`)).status).toBe(404);
    const past = await authed(a).post(`/api/v1/spaces/${spaceId}/letters`, { title: 'Now open', body: 'hello at last', visibility: 'scheduled', revealAt: new Date(Date.now() - 1000).toISOString() });
    const pastRead = await authed(b).get(`/api/v1/letter/${id(past)}`);
    expect(pastRead.status).toBe(200);
    expect((pastRead.body as { data: { body: string } }).data.body).toBe('hello at last');
  });

  it('completing a plan creates exactly one linked Memory Wall keepsake visible to both partners', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['Plan3 A', 'Plan3 B']);
    const [a, b] = agents as [NonNullable<(typeof agents)[0]>, NonNullable<(typeof agents)[1]>];
    const plan = await authed(a).post(`/api/v1/spaces/${spaceId}/plans`, { title: 'Market trip', detail: 'food stalls', category: 'trip', location: 'Old town' });
    const planId = id(plan);
    // Partner sees the shared plan and the author's edit to it.
    await authed(a).patch(`/api/v1/plan/${planId}`, { detail: 'food stalls and music' });
    const partnerPlans = await authed(b).get(`/api/v1/spaces/${spaceId}/plans`);
    expect(((partnerPlans.body as { data: { detail: string }[] }).data).map((p) => p.detail)).toContain('food stalls and music');
    const done = await authed(a).post(`/api/v1/plan/${planId}/complete`, { createMemory: true, memoryTitle: 'Market trip', memoryCaption: 'We did it' });
    expect(done.status).toBe(200);
    const partnerMemories = await authed(b).get(`/api/v1/spaces/${spaceId}/memories`);
    const keepsakes = ((partnerMemories.body as { data: { sourcePlanId?: string; title: string; caption: string }[] }).data).filter((m) => m.sourcePlanId === planId);
    expect(keepsakes).toHaveLength(1);
    expect(keepsakes[0]!.caption).toBe('We did it');
    // A second completion is a conflict, never a second keepsake.
    expect((await authed(a).post(`/api/v1/plan/${planId}/complete`, { createMemory: true })).status).toBe(409);
  });

  it('soft-deleted memory disappears from the list and restores', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['Del3 A', 'Del3 B']);
    const [a] = agents as [NonNullable<(typeof agents)[0]>];
    const memory = await authed(a).post(`/api/v1/spaces/${spaceId}/memories`, { title: 'To restore' });
    const memoryId = id(memory);
    expect((await authed(a).post(`/api/v1/memory/${memoryId}/soft-delete`, {})).status).toBe(200);
    const list = await authed(a).get(`/api/v1/spaces/${spaceId}/memories`);
    expect(((list.body as { data: { title: string }[] }).data).map((m) => m.title)).not.toContain('To restore');
    expect((await authed(a).post(`/api/v1/memory/${memoryId}/restore`, {})).status).toBe(200);
    const list2 = await authed(a).get(`/api/v1/spaces/${spaceId}/memories`);
    expect(((list2.body as { data: { title: string }[] }).data).map((m) => m.title)).toContain('To restore');
  });
});

void app;
