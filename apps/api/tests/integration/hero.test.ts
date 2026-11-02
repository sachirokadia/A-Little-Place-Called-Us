import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db.js';
import { ORIGIN, authed, cleanDb, createSpaceWithMembers, type AuthedAgent } from './helpers.js';

// Personalized adventure backend: hero missions (CRUD, author-only
// edit/delete, reward-link validation) and the 'hero-adventure'
// GameProgress schema. All test data is synthetic; no official
// property names, assets, or dialogue appear anywhere here.
function put(agent: AuthedAgent, url: string, body: unknown) {
  return agent.agent.put(url).set('Origin', ORIGIN).set('X-CSRF-Token', agent.csrf).send(body);
}

beforeAll(async () => {
  // New table first (helpers.cleanDb predates it and would
  // otherwise hit FK constraints on leftover rows).
  await prisma.heroMission.deleteMany();
  await cleanDb();
});

type Pair = [AuthedAgent, AuthedAgent];
function pair(agents: AuthedAgent[]): Pair {
  return agents as unknown as Pair;
}

const BASE = (spaceId: string) => `/api/v1/spaces/${spaceId}/hero-missions`;

describe('hero missions: CRUD and ordering', () => {
  it('create by either member, read by both, ordered by levelId then order then createdAt', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['H A', 'H B']);
    const [a, b] = pair(agents);
    const m1 = await authed(b).post(BASE(spaceId), {
      levelId: 'rooftop-row',
      title: 'Rooftop second',
      clue: 'Look up',
      order: 2,
    });
    expect(m1.status).toBe(201);
    expect(m1.body.data.authorId).toBe(b.user.id);
    expect(m1.body.data.rewardMessage).toBe('');
    expect(m1.body.data.rewardMemoryId).toBeNull();
    const m2 = await authed(a).post(BASE(spaceId), {
      levelId: 'rooftop-row',
      title: 'Rooftop first',
      clue: 'Start here',
      order: 1,
      rewardMessage: 'Well done',
    });
    expect(m2.status).toBe(201);
    const m3 = await authed(a).post(BASE(spaceId), {
      levelId: 'harbour-lights',
      title: 'Harbour stop',
      clue: 'By the water',
    });
    expect(m3.status).toBe(201);
    // levelId sorts alphabetically: harbour-lights before rooftop-row;
    // within a level, order ascending.
    const listed = await authed(b).get(BASE(spaceId));
    expect(listed.status).toBe(200);
    expect(listed.body.data.map((m: { title: string }) => m.title)).toEqual([
      'Harbour stop',
      'Rooftop first',
      'Rooftop second',
    ]);
    // Response items carry exactly the contract fields (no extras).
    expect(Object.keys(listed.body.data[0]).sort()).toEqual(
      [
        'authorId',
        'clue',
        'createdAt',
        'id',
        'levelId',
        'order',
        'rewardAppreciationId',
        'rewardLetterId',
        'rewardMemoryId',
        'rewardMessage',
        'spaceId',
        'title',
      ].sort(),
    );
  });

  it('author-only edit/delete: partner gets a generic 404; author edit and delete work', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['H C', 'H D']);
    const [a, b] = pair(agents);
    const created = await authed(a).post(BASE(spaceId), {
      levelId: 'market-lane',
      title: 'Market hunt',
      clue: 'Find the stall',
    });
    const mid = created.body.data.id as string;
    expect((await authed(b).patch(`${BASE(spaceId)}/${mid}`, { title: 'Hijacked?' })).status).toBe(404);
    expect((await authed(b).delete(`${BASE(spaceId)}/${mid}`)).status).toBe(404);
    const patched = await authed(a).patch(`${BASE(spaceId)}/${mid}`, {
      title: 'Market hunt, really',
      order: 3,
    });
    expect(patched.status).toBe(200);
    expect(patched.body.data.title).toBe('Market hunt, really');
    expect(patched.body.data.order).toBe(3);
    // Empty patch is a 400, not a no-op.
    expect((await authed(a).patch(`${BASE(spaceId)}/${mid}`, {})).status).toBe(400);
    expect((await authed(a).delete(`${BASE(spaceId)}/${mid}`)).status).toBe(200);
    expect((await authed(a).get(BASE(spaceId))).body.data).toHaveLength(0);
  });

  it('non-member gets a generic 404 on hero routes', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['H E', 'H F']);
    const [a] = pair(agents);
    const { agents: outsiders } = await createSpaceWithMembers(['H Out']);
    const [outsider] = outsiders as [AuthedAgent];
    await authed(a).post(BASE(spaceId), { levelId: 'market-lane', title: 'T', clue: 'C' });
    expect((await authed(outsider).get(BASE(spaceId))).status).toBe(404);
    expect(
      (await authed(outsider).post(BASE(spaceId), { levelId: 'market-lane', title: 'T', clue: 'C' })).status,
    ).toBe(404);
  });

  it('invalid levelId, blank title, body authorId, and over-long fields are 400', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['H G', 'H H']);
    const [a] = pair(agents);
    const base = { levelId: 'market-lane', title: 'T', clue: 'C' };
    expect((await authed(a).post(BASE(spaceId), { ...base, levelId: 'unknown-level' })).status).toBe(400);
    expect((await authed(a).post(BASE(spaceId), { ...base, title: '   ' })).status).toBe(400);
    expect((await authed(a).post(BASE(spaceId), { ...base, title: 'x'.repeat(201) })).status).toBe(400);
    expect((await authed(a).post(BASE(spaceId), { ...base, clue: 'x'.repeat(1001) })).status).toBe(400);
    expect((await authed(a).post(BASE(spaceId), { ...base, rewardMessage: 'x'.repeat(1001) })).status).toBe(400);
    // A body-supplied authorId is rejected outright (strict schema),
    // never trusted: the author is always the session caller.
    expect((await authed(a).post(BASE(spaceId), { ...base, authorId: 'someone-else' })).status).toBe(400);
  });
});

describe('hero missions: reward links', () => {
  it('multiple reward links are 400 on create and on patch', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['H I', 'H J']);
    const [a] = pair(agents);
    const memory = await prisma.memory.create({ data: { spaceId, authorId: a.user.id, title: 'Shared memory' } });
    const appreciation = await prisma.appreciation.create({
      data: { spaceId, authorId: a.user.id, text: 'Kind words', kind: 'appreciation', forName: 'Partner' },
    });
    const base = { levelId: 'market-lane', title: 'T', clue: 'C' };
    expect(
      (
        await authed(a).post(BASE(spaceId), {
          ...base,
          rewardMemoryId: memory.id,
          rewardAppreciationId: appreciation.id,
        })
      ).status,
    ).toBe(400);
    const created = await authed(a).post(BASE(spaceId), { ...base, rewardMemoryId: memory.id });
    expect(created.status).toBe(201);
    const mid = created.body.data.id as string;
    expect(
      (
        await authed(a).patch(`${BASE(spaceId)}/${mid}`, {
          rewardMemoryId: memory.id,
          rewardLetterId: '00000000-0000-0000-0000-000000000000',
        })
      ).status,
    ).toBe(400);
    // The failed patch left the stored link untouched.
    expect((await authed(a).get(BASE(spaceId))).body.data[0].rewardMemoryId).toBe(memory.id);
  });

  it('bogus, other-space, and deleted reward links are 400', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['H K', 'H L']);
    const [a] = pair(agents);
    const base = { levelId: 'rooftop-row', title: 'T', clue: 'C' };
    const bogus = '00000000-0000-0000-0000-000000000000';
    expect((await authed(a).post(BASE(spaceId), { ...base, rewardMemoryId: bogus })).status).toBe(400);
    expect((await authed(a).post(BASE(spaceId), { ...base, rewardLetterId: bogus })).status).toBe(400);
    expect((await authed(a).post(BASE(spaceId), { ...base, rewardAppreciationId: bogus })).status).toBe(400);
    // Other-space rows are 400 (and never leaked).
    const { spaceId: otherSpace, agents: otherAgents } = await createSpaceWithMembers(['H M']);
    const [other] = otherAgents as [AuthedAgent];
    const otherMemory = await prisma.memory.create({
      data: { spaceId: otherSpace, authorId: other.user.id, title: 'Not Yours Memory' },
    });
    const cross = await authed(a).post(BASE(spaceId), { ...base, rewardMemoryId: otherMemory.id });
    expect(cross.status).toBe(400);
    expect(JSON.stringify(cross.body)).not.toContain('Not Yours Memory');
    // Deleted rows are 400.
    const deleted = await prisma.memory.create({ data: { spaceId, authorId: a.user.id, title: 'Gone' } });
    await prisma.memory.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });
    expect((await authed(a).post(BASE(spaceId), { ...base, rewardMemoryId: deleted.id })).status).toBe(400);
  });

  it('letter visibility: partner private draft and undelivered scheduled are 400; shared, own draft, and delivered scheduled are accepted', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['H N', 'H O']);
    const [a, b] = pair(agents);
    const base = { levelId: 'harbour-lights', title: 'T', clue: 'C' };
    const partnerDraft = await prisma.letter.create({
      data: { spaceId, authorId: b.user.id, title: 'Secret Draft', body: 'secret', visibility: 'private_draft' },
    });
    const partnerFuture = await prisma.letter.create({
      data: {
        spaceId, authorId: b.user.id, title: 'Future Letter', body: 'later',
        visibility: 'scheduled', revealAt: new Date(Date.now() + 86400_000),
      },
    });
    const partnerShared = await prisma.letter.create({
      data: { spaceId, authorId: b.user.id, title: 'Shared Letter', body: 'hi', visibility: 'shared' },
    });
    const partnerDelivered = await prisma.letter.create({
      data: {
        spaceId, authorId: b.user.id, title: 'Delivered Letter', body: 'hello at last',
        visibility: 'scheduled', revealAt: new Date(Date.now() - 1000),
      },
    });
    const ownDraft = await prisma.letter.create({
      data: { spaceId, authorId: a.user.id, title: 'My Draft', body: 'mine', visibility: 'private_draft' },
    });
    // Invisible to the creator: 400, with no title leak.
    const draftRes = await authed(a).post(BASE(spaceId), { ...base, rewardLetterId: partnerDraft.id });
    expect(draftRes.status).toBe(400);
    expect(JSON.stringify(draftRes.body)).not.toContain('Secret Draft');
    const futureRes = await authed(a).post(BASE(spaceId), { ...base, rewardLetterId: partnerFuture.id });
    expect(futureRes.status).toBe(400);
    expect(JSON.stringify(futureRes.body)).not.toContain('Future Letter');
    // Visible to the creator: accepted.
    expect((await authed(a).post(BASE(spaceId), { ...base, rewardLetterId: partnerShared.id })).status).toBe(201);
    expect((await authed(a).post(BASE(spaceId), { ...base, rewardLetterId: partnerDelivered.id })).status).toBe(201);
    expect((await authed(a).post(BASE(spaceId), { ...base, rewardLetterId: ownDraft.id })).status).toBe(201);
  });

  it('valid memory and appreciation links are accepted; patching to a new link replaces the old one', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['H P', 'H Q']);
    const [a] = pair(agents);
    const memory = await prisma.memory.create({ data: { spaceId, authorId: a.user.id, title: 'First reward' } });
    const appreciation = await prisma.appreciation.create({
      data: { spaceId, authorId: a.user.id, text: 'Second reward', kind: 'appreciation', forName: 'Partner' },
    });
    const created = await authed(a).post(BASE(spaceId), {
      levelId: 'market-lane', title: 'T', clue: 'C', rewardMemoryId: memory.id, rewardMessage: 'Found it',
    });
    expect(created.status).toBe(201);
    expect(created.body.data.rewardMemoryId).toBe(memory.id);
    expect(created.body.data.rewardAppreciationId).toBeNull();
    const mid = created.body.data.id as string;
    // Switching links replaces (never accumulates a second link);
    // a bogus replacement is rejected and leaves the old link intact.
    const switched = await authed(a).patch(`${BASE(spaceId)}/${mid}`, { rewardAppreciationId: appreciation.id });
    expect(switched.status).toBe(200);
    expect(switched.body.data.rewardAppreciationId).toBe(appreciation.id);
    expect(switched.body.data.rewardMemoryId).toBeNull();
    expect(
      (
        await authed(a).patch(`${BASE(spaceId)}/${mid}`, {
          rewardMemoryId: '00000000-0000-0000-0000-000000000000',
        })
      ).status,
    ).toBe(400);
    const after = await authed(a).get(BASE(spaceId));
    expect(after.body.data[0].rewardAppreciationId).toBe(appreciation.id);
    expect(after.body.data[0].rewardMemoryId).toBeNull();
    // Clearing with an explicit null works.
    const cleared = await authed(a).patch(`${BASE(spaceId)}/${mid}`, { rewardAppreciationId: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.rewardAppreciationId).toBeNull();
  });
});

describe('hero adventure: game progress', () => {
  it('tokens > 15, unknown level, duplicate levels, and adventureCompleted without all 3 levels are 400', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['H R', 'H S']);
    const [a] = pair(agents);
    const url = `/api/v1/spaces/${spaceId}/game-progress/hero-adventure`;
    expect((await put(a, url, { progress: { tokensCollected: 16 } })).status).toBe(400);
    expect((await put(a, url, { progress: { tokensCollected: -1 } })).status).toBe(400);
    expect((await put(a, url, { progress: { levelsCompleted: ['unknown-level'] } })).status).toBe(400);
    expect((await put(a, url, { progress: { levelsCompleted: ['market-lane', 'market-lane'] } })).status).toBe(400);
    expect((await put(a, url, { progress: { levelsCompleted: ['rooftop-row', 'market-lane', 'harbour-lights', 'rooftop-row'] } })).status).toBe(400);
    expect((await put(a, url, { progress: { adventureCompleted: true } })).status).toBe(400);
    expect(
      (await put(a, url, { progress: { levelsCompleted: ['rooftop-row', 'market-lane'], adventureCompleted: true } })).status,
    ).toBe(400);
    expect((await put(a, url, { progress: {} })).status).toBe(400);
    expect((await put(a, url, { progress: { levelsCompleted: ['rooftop-row'], unknownField: 1 } })).status).toBe(400);
    // A body-supplied playerId is rejected, never used to scope the row.
    expect((await put(a, url, { playerId: 'someone-else', progress: { tokensCollected: 5 } })).status).toBe(400);
    // An unknown gameKey is still a 400.
    expect((await put(a, `/api/v1/spaces/${spaceId}/game-progress/hero-quest`, { progress: {} })).status).toBe(400);
  });

  it('valid partial and full progress are accepted and stored per-player', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['H T', 'H U']);
    const [a, b] = pair(agents);
    const url = `/api/v1/spaces/${spaceId}/game-progress/hero-adventure`;
    const partial = await put(a, url, { progress: { levelsCompleted: ['rooftop-row'], tokensCollected: 5 } });
    expect(partial.status).toBe(200);
    expect(partial.body.data.progress).toEqual({ levelsCompleted: ['rooftop-row'], tokensCollected: 5 });
    const full = await put(a, url, {
      progress: {
        levelsCompleted: ['rooftop-row', 'market-lane', 'harbour-lights'],
        tokensCollected: 15,
        adventureCompleted: true,
      },
    });
    expect(full.status).toBe(200);
    expect(full.body.data.progress.adventureCompleted).toBe(true);
    expect(full.body.data.progress.tokensCollected).toBe(15);
    // Per-player scoping: the partner has no row and cannot read A's.
    expect((await authed(b).get(url)).status).toBe(404);
    expect((await authed(a).get(url)).body.data.progress.tokensCollected).toBe(15);
  });
});
