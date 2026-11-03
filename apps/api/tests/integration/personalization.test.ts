import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db.js';
import { ORIGIN, authed, cleanDb, createSpaceWithMembers, createUserDirect, loginAgent, type AuthedAgent } from './helpers.js';

// Personalisation gaps: DB-backed final messages, guess-round
// edit/delete, space rename, chest-reward readability without
// solves, and owner-only media delete. All test data is synthetic.
function put(agent: AuthedAgent, url: string, body: unknown) {
  return agent.agent.put(url).set('Origin', ORIGIN).set('X-CSRF-Token', agent.csrf).send(body);
}

beforeAll(async () => {
  // FinalMessage predates helpers.cleanDb and would otherwise hit
  // FK constraints on leftover rows.
  await prisma.finalMessage.deleteMany();
  await prisma.guessRound.deleteMany();
  await cleanDb();
});

type Pair = [AuthedAgent, AuthedAgent];
function pair(agents: AuthedAgent[]): Pair {
  return agents as unknown as Pair;
}

describe('final messages', () => {
  it('GET is null before any save; PUT by A, read by B, overwrite by B', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['FM A', 'FM B']);
    const [a, b] = pair(agents);
    const empty = await authed(a).get(`/api/v1/spaces/${spaceId}/final-messages/star-letter`);
    expect(empty.status).toBe(200);
    expect(empty.body.data).toBeNull();

    const saved = await put(a, `/api/v1/spaces/${spaceId}/final-messages/star-letter`, {
      text: 'Our own words, first version.',
    });
    expect(saved.status).toBe(200);
    expect(saved.body.data.text).toBe('Our own words, first version.');
    expect(saved.body.data.updatedById).toBe(a.user.id);

    // Either member may read — no author-only restriction.
    const readByB = await authed(b).get(`/api/v1/spaces/${spaceId}/final-messages/star-letter`);
    expect(readByB.status).toBe(200);
    expect(readByB.body.data.text).toBe('Our own words, first version.');

    // Either member may overwrite (shared config, like chest reward).
    const overwritten = await put(b, `/api/v1/spaces/${spaceId}/final-messages/star-letter`, {
      text: 'Our own words, second version.',
    });
    expect(overwritten.status).toBe(200);
    expect(overwritten.body.data.text).toBe('Our own words, second version.');
    expect(overwritten.body.data.updatedById).toBe(b.user.id);

    // The two kinds are independent rows.
    const hero = await authed(a).get(`/api/v1/spaces/${spaceId}/final-messages/hero-final`);
    expect(hero.status).toBe(200);
    expect(hero.body.data).toBeNull();
  });

  it('non-member gets 404 on read and write; validation rejects blank, over-long, and unknown kind', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['FM C', 'FM D']);
    const [a] = pair(agents);
    const outsiderEmail = `fm-outsider-${Date.now()}@example.test`;
    await createUserDirect(outsiderEmail, 'FM Outsider');
    const outsider = await loginAgent(outsiderEmail);

    expect((await authed(outsider).get(`/api/v1/spaces/${spaceId}/final-messages/hero-final`)).status).toBe(404);
    expect((await put(outsider, `/api/v1/spaces/${spaceId}/final-messages/hero-final`, { text: 'Nope.' })).status).toBe(404);

    expect((await put(a, `/api/v1/spaces/${spaceId}/final-messages/hero-final`, { text: '   ' })).status).toBe(400);
    expect((await put(a, `/api/v1/spaces/${spaceId}/final-messages/hero-final`, { text: '' })).status).toBe(400);
    expect((await put(a, `/api/v1/spaces/${spaceId}/final-messages/hero-final`, { text: 'x'.repeat(20001) })).status).toBe(400);
    expect((await authed(a).get(`/api/v1/spaces/${spaceId}/final-messages/not-a-kind`)).status).toBe(404);
    expect((await put(a, `/api/v1/spaces/${spaceId}/final-messages/not-a-kind`, { text: 'Nope.' })).status).toBe(404);
  });
});

describe('guess round edit/delete', () => {
  it('partner PATCH/DELETE get a generic 404; author PATCH works; revealed rounds reject PATCH; author DELETE works', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['GR A', 'GR B']);
    const [a, b] = pair(agents);
    const created = await authed(a).post(`/api/v1/spaces/${spaceId}/guess-rounds`, {
      question: 'Favourite season?', answer: 'Autumn',
    });
    expect(created.status).toBe(201);
    const roundId = created.body.data.id as string;

    expect((await authed(b).patch(`/api/v1/spaces/${spaceId}/guess-rounds/${roundId}`, { question: 'Hijacked?' })).status).toBe(404);
    expect((await authed(b).delete(`/api/v1/spaces/${spaceId}/guess-rounds/${roundId}`)).status).toBe(404);

    const patched = await authed(a).patch(`/api/v1/spaces/${spaceId}/guess-rounds/${roundId}`, {
      question: 'Favourite season, really?',
    });
    expect(patched.status).toBe(200);
    expect(patched.body.data.question).toBe('Favourite season, really?');

    // Reveal the round (B guesses), then an author PATCH must fail
    // rather than leave the stored verdict inconsistent.
    const guessed = await authed(b).post(`/api/v1/spaces/${spaceId}/guess-rounds/${roundId}/guess`, { guess: 'Autumn' });
    expect(guessed.status).toBe(200);
    expect((await authed(a).patch(`/api/v1/spaces/${spaceId}/guess-rounds/${roundId}`, { question: 'Too late?' })).status).toBe(400);

    // DELETE still works for the author after reveal.
    expect((await authed(a).delete(`/api/v1/spaces/${spaceId}/guess-rounds/${roundId}`)).status).toBe(200);
    const listed = await authed(a).get(`/api/v1/spaces/${spaceId}/guess-rounds`);
    expect(listed.body.data).toHaveLength(0);
  });
});

describe('date editing on existing PATCH routes', () => {
  it('memory happenedOn and plan targetDate patch; impossible dates stay 400; clearing a date sends null', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['DE A', 'DE B']);
    const [a] = pair(agents);
    const memory = await authed(a).post(`/api/v1/spaces/${spaceId}/memories`, {
      title: 'Dated memory', caption: '', story: '', happenedOn: '2026-01-05', tags: [],
    });
    expect(memory.status).toBe(201);
    const memoryId = memory.body.data.id as string;
    const repatched = await authed(a).patch(`/api/v1/memory/${memoryId}`, { happenedOn: '2026-02-14' });
    expect(repatched.status).toBe(200);
    expect(repatched.body.data.happenedOn).toBe('2026-02-14');
    // The strict isoDate rule survives: 2026-02-30 is normalised
    // by Date.parse, so it must be rejected, not silently moved.
    expect((await authed(a).patch(`/api/v1/memory/${memoryId}`, { happenedOn: '2026-02-30' })).status).toBe(400);
    const cleared = await authed(a).patch(`/api/v1/memory/${memoryId}`, { happenedOn: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.happenedOn).toBeNull();

    const plan = await authed(a).post(`/api/v1/spaces/${spaceId}/plans`, {
      title: 'Dated plan', detail: '', category: 'trip', targetDate: '2026-03-01', location: '',
    });
    expect(plan.status).toBe(201);
    const planId = plan.body.data.id as string;
    const planPatched = await authed(a).patch(`/api/v1/plan/${planId}`, { targetDate: '2026-04-02' });
    expect(planPatched.status).toBe(200);
    expect(planPatched.body.data.targetDate).toBe('2026-04-02');
    expect((await authed(a).patch(`/api/v1/plan/${planId}`, { targetDate: '2026-13-01' })).status).toBe(400);
  });
});

describe('space rename', () => {
  it('either member may rename; non-member gets 404; blank and over-long names get 400', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['SR A', 'SR B']);
    const [, b] = pair(agents);
    const outsiderEmail = `sr-outsider-${Date.now()}@example.test`;
    await createUserDirect(outsiderEmail, 'SR Outsider');
    const outsider = await loginAgent(outsiderEmail);

    const renamed = await authed(b).patch(`/api/v1/spaces/${spaceId}`, { name: 'Our Renamed Place' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data.name).toBe('Our Renamed Place');
    expect(renamed.body.data.members).toHaveLength(2);

    expect((await authed(outsider).patch(`/api/v1/spaces/${spaceId}`, { name: 'Hijacked' })).status).toBe(404);
    expect((await authed(b).patch(`/api/v1/spaces/${spaceId}`, { name: '   ' })).status).toBe(400);
    expect((await authed(b).patch(`/api/v1/spaces/${spaceId}`, { name: 'x'.repeat(101) })).status).toBe(400);
  });
});

describe('chest reward read-now', () => {
  it('the reward is readable without any solve, while the chest stays locked', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['CR A', 'CR B']);
    const [a, b] = pair(agents);
    const saved = await put(a, `/api/v1/spaces/${spaceId}/chest-reward`, { message: 'Read me without solving.' });
    expect(saved.status).toBe(200);

    const state = await authed(b).get(`/api/v1/spaces/${spaceId}/chest-state`);
    expect(state.body.data.unlocked).toBe(false);

    const reward = await authed(b).get(`/api/v1/spaces/${spaceId}/chest-reward`);
    expect(reward.status).toBe(200);
    expect(reward.body.data.message).toBe('Read me without solving.');
  });
});

describe('media delete', () => {
  it('owner deletes; partner gets a generic 404 and the asset survives', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['MD A', 'MD B']);
    const [a, b] = pair(agents);
    const memory = await prisma.memory.create({
      data: { spaceId, authorId: a.user.id, title: 'Test memory', caption: '', story: '' },
    });
    const asset = await prisma.mediaAsset.create({
      data: {
        ownerId: a.user.id, memoryId: memory.id, status: 'active',
        storageKey: `test-${Date.now()}.jpg`, mimeType: 'image/jpeg', byteSize: 10,
      },
    });

    expect((await authed(b).delete(`/api/v1/media/${asset.id}`)).status).toBe(404);
    const survived = await prisma.mediaAsset.findUnique({ where: { id: asset.id } });
    expect(survived?.status).toBe('active');

    expect((await authed(a).delete(`/api/v1/media/${asset.id}`)).status).toBe(200);
    const deleted = await prisma.mediaAsset.findUnique({ where: { id: asset.id } });
    expect(deleted?.status).toBe('soft_deleted');
  });
});
