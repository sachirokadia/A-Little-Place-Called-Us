import { beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { ORIGIN, authed, cleanDb, createSpaceWithMembers, loginAgent, type AuthedAgent } from './helpers.js';

// Phase 5 (persistence, privacy, shared access). Test accounts in
// the disposable test database only, clearly named as test accounts
// (P5 A / P5 B / P5 Out). No frontend code is involved.
function put(agent: AuthedAgent, url: string, body: unknown) {
  return agent.agent.put(url).set('Origin', ORIGIN).set('X-CSRF-Token', agent.csrf).send(body);
}

async function uploadPng(agent: AuthedAgent, spaceId: string, memoryId: string) {
  const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: { r: 200, g: 100, b: 50 } } }).png().toBuffer();
  const upload = await agent.agent
    .post(`/api/v1/spaces/${spaceId}/media`)
    .set('Origin', ORIGIN).set('X-CSRF-Token', agent.csrf)
    .field('linkedType', 'memory').field('linkedId', memoryId)
    .attach('file', png, 'photo.png');
  expect(upload.status).toBe(201);
  return (upload.body as { data: { id: string } }).data.id;
}

beforeAll(async () => {
  await cleanDb();
});

describe('Phase 5 export', () => {
  it('contains shared records only: shared memory/letter, delivered scheduled letter, appreciation, plan, reminder', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['P5 A', 'P5 B']);
    const [a, b] = agents as [NonNullable<(typeof agents)[0]>, NonNullable<(typeof agents)[1]>];
    const memory = await authed(a).post(`/api/v1/spaces/${spaceId}/memories`, { title: 'P5 Shared Memory' });
    const memoryId = (memory.body as { data: { id: string } }).data.id;
    await uploadPng(a, spaceId, memoryId);
    await authed(a).post(`/api/v1/spaces/${spaceId}/letters`, { title: 'P5 Shared Letter', body: 'P5 shared letter body', visibility: 'shared' });
    await authed(a).post(`/api/v1/spaces/${spaceId}/letters`, { title: 'P5 Delivered Letter', body: 'P5 delivered letter body', visibility: 'scheduled', revealAt: '2020-01-01T00:00:00.000Z' });
    await authed(a).post(`/api/v1/spaces/${spaceId}/appreciations`, { text: 'P5 appreciation text', kind: 'appreciation', forName: 'P5 B' });
    await authed(a).post(`/api/v1/spaces/${spaceId}/plans`, { title: 'P5 Shared Plan', category: 'trip' });
    await authed(a).post(`/api/v1/spaces/${spaceId}/reminders`, { text: 'P5 shared reminder', kind: 'note' });
    // Private content, all created by the partner (the caller below).
    await authed(b).post(`/api/v1/spaces/${spaceId}/letters`, { title: 'P5 Secret Draft Title', body: 'P5 secret draft body', visibility: 'private_draft' });
    await authed(b).post(`/api/v1/spaces/${spaceId}/letters`, { title: 'P5 Future Letter Title', body: 'P5 future letter body', visibility: 'scheduled', revealAt: '2999-01-01T00:00:00.000Z' });
    await authed(b).post(`/api/v1/spaces/${spaceId}/journals`, { title: 'P5 Secret Journal Title', body: 'P5 secret journal body' });
    await authed(b).post(`/api/v1/spaces/${spaceId}/voice-notes`, { title: 'P5 Secret Voice Title' });

    const res = await authed(b).get(`/api/v1/spaces/${spaceId}/export`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    const data = res.body.data as {
      spaceName: string; exportedAt: string; exportNote: string;
      memories: { title: string; mediaCount: number }[];
      letters: { title: string; body: string }[];
      appreciations: { text: string }[];
      plans: { title: string; mediaCount: number }[];
      reminders: { text: string }[];
    };
    expect(data.spaceName).toBe('Our Place');
    expect(data.exportedAt).toBeTruthy();
    expect(data.exportNote).toMatch(/shared records only/);
    expect(data.memories.map((m) => m.title)).toContain('P5 Shared Memory');
    expect(data.memories.find((m) => m.title === 'P5 Shared Memory')?.mediaCount).toBe(1);
    expect(data.letters.map((l) => l.title)).toContain('P5 Shared Letter');
    expect(data.letters.map((l) => l.title)).toContain('P5 Delivered Letter');
    expect(data.letters.find((l) => l.title === 'P5 Delivered Letter')?.body).toBe('P5 delivered letter body');
    expect(data.appreciations.map((x) => x.text)).toContain('P5 appreciation text');
    expect(data.plans.map((p) => p.title)).toContain('P5 Shared Plan');
    expect(data.plans.find((p) => p.title === 'P5 Shared Plan')?.mediaCount).toBe(0);
    expect(data.reminders.map((r) => r.text)).toContain('P5 shared reminder');
    // Excluded rows must not appear anywhere — not even in a count:
    // the whole serialised body must not contain their titles/bodies.
    const blob = JSON.stringify(res.body);
    for (const secret of ['P5 Secret Draft Title', 'P5 secret draft body', 'P5 Future Letter Title', 'P5 future letter body', 'P5 Secret Journal Title', 'P5 secret journal body', 'P5 Secret Voice Title']) {
      expect(blob).not.toContain(secret);
    }
    // No storage key or URL of any kind in the export.
    expect(blob).not.toContain('storageKey');
    expect(blob).not.toContain('http://');
    expect(blob).not.toContain('https://');
  });

  it('non-member export is a generic 404', async () => {
    const { spaceId } = await createSpaceWithMembers(['P5 C', 'P5 D']);
    const { agents: outsiders } = await createSpaceWithMembers(['P5 Out']);
    const [outsider] = outsiders as [NonNullable<(typeof outsiders)[0]>];
    expect((await authed(outsider).get(`/api/v1/spaces/${spaceId}/export`)).status).toBe(404);
    expect((await authed(outsider).get('/api/v1/spaces/00000000-0000-0000-0000-000000000000/export')).status).toBe(404);
  });
});

describe('Phase 5 preferences', () => {
  it('GET defaults, PUT persists, a second login reads the same row, another user has a separate row', async () => {
    const { agents } = await createSpaceWithMembers(['P5 E', 'P5 F']);
    const [a, b] = agents as [NonNullable<(typeof agents)[0]>, NonNullable<(typeof agents)[1]>];
    const defaults = await authed(a).get('/api/v1/auth/preferences');
    expect(defaults.status).toBe(200);
    expect(defaults.body.data).toEqual({ motion: 'system', soundEnabled: false, onboardingSeen: false });
    const saved = await put(a, '/api/v1/auth/preferences', { motion: 'reduce', soundEnabled: true, onboardingSeen: true });
    expect(saved.status).toBe(200);
    expect(saved.body.data).toEqual({ motion: 'reduce', soundEnabled: true, onboardingSeen: true });
    // Second login (fresh agent, same test account) reads the same row.
    const again = await loginAgent(a.user.email);
    const reread = await authed(again).get('/api/v1/auth/preferences');
    expect(reread.status).toBe(200);
    expect(reread.body.data).toEqual({ motion: 'reduce', soundEnabled: true, onboardingSeen: true });
    // The partner has their own separate row, still at defaults, and
    // changing it does not touch the first user's row.
    const partnerDefaults = await authed(b).get('/api/v1/auth/preferences');
    expect(partnerDefaults.body.data).toEqual({ motion: 'system', soundEnabled: false, onboardingSeen: false });
    await put(b, '/api/v1/auth/preferences', { motion: 'full', soundEnabled: false, onboardingSeen: false });
    const firstStill = await authed(a).get('/api/v1/auth/preferences');
    expect(firstStill.body.data).toEqual({ motion: 'reduce', soundEnabled: true, onboardingSeen: true });
  });

  it('a body-supplied userId, an invalid motion, and unknown fields are rejected', async () => {
    const { agents } = await createSpaceWithMembers(['P5 G', 'P5 H']);
    const [a, b] = agents as [NonNullable<(typeof agents)[0]>, NonNullable<(typeof agents)[1]>];
    expect((await put(a, '/api/v1/auth/preferences', { userId: b.user.id, motion: 'reduce' })).status).toBe(400);
    expect((await put(a, '/api/v1/auth/preferences', { motion: 'always' })).status).toBe(400);
    expect((await put(a, '/api/v1/auth/preferences', { motion: 'reduce', admin: true })).status).toBe(400);
    expect((await put(a, '/api/v1/auth/preferences', { soundEnabled: 'yes' })).status).toBe(400);
    // Nothing above was stored: defaults are still intact.
    expect((await authed(a).get('/api/v1/auth/preferences')).body.data).toEqual({ motion: 'system', soundEnabled: false, onboardingSeen: false });
  });
});

describe('Phase 5 favourite hardening and visibility regression', () => {
  it('favourite on an invisible row is 404; a visible shared row still toggles', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['P5 I', 'P5 J']);
    const [a, b] = agents as [NonNullable<(typeof agents)[0]>, NonNullable<(typeof agents)[1]>];
    const memory = await authed(a).post(`/api/v1/spaces/${spaceId}/memories`, { title: 'P5 Fav Memory' });
    const memoryId = (memory.body as { data: { id: string } }).data.id;
    // Visible shared row: partner can favourite and unfavourite.
    expect((await authed(b).post(`/api/v1/memory/${memoryId}/favourite`)).body.data).toEqual({ favourited: true });
    expect((await authed(b).post(`/api/v1/memory/${memoryId}/favourite`)).body.data).toEqual({ favourited: false });
    // Soft-deleted row is invisible: favourite is a 404.
    await authed(a).post(`/api/v1/memory/${memoryId}/soft-delete`);
    expect((await authed(b).post(`/api/v1/memory/${memoryId}/favourite`)).status).toBe(404);
    // A row in a space the caller is not a member of is a 404.
    const other = await createSpaceWithMembers(['P5 K', 'P5 L']);
    const [c] = other.agents as [NonNullable<(typeof other.agents)[0]>];
    const foreign = await authed(c).post(`/api/v1/spaces/${other.spaceId}/memories`, { title: 'P5 Foreign Memory' });
    const foreignId = (foreign.body as { data: { id: string } }).data.id;
    expect((await authed(b).post(`/api/v1/memory/${foreignId}/favourite`)).status).toBe(404);
  });

  it('partner direct-id GET/PATCH/DELETE of a private journal and private draft is 404 with no title leak', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['P5 M', 'P5 N']);
    const [a, b] = agents as [NonNullable<(typeof agents)[0]>, NonNullable<(typeof agents)[1]>];
    const journal = await authed(a).post(`/api/v1/spaces/${spaceId}/journals`, { title: 'P5 Hidden Journal Title', body: 'P5 hidden journal body' });
    const journalId = (journal.body as { data: { id: string } }).data.id;
    const draft = await authed(a).post(`/api/v1/spaces/${spaceId}/letters`, { title: 'P5 Hidden Draft Title', body: 'P5 hidden draft body', visibility: 'private_draft' });
    const draftId = (draft.body as { data: { id: string } }).data.id;
    for (const url of [`/api/v1/journal/${journalId}`, `/api/v1/letter/${draftId}`]) {
      const get = await authed(b).get(url);
      expect(get.status).toBe(404);
      expect(JSON.stringify(get.body)).not.toContain('Hidden');
      const patch = await authed(b).patch(url, { title: 'P5 Hacked Title' });
      expect(patch.status).toBe(404);
      expect(JSON.stringify(patch.body)).not.toContain('Hidden');
      const del = await authed(b).delete(url);
      expect(del.status).toBe(404);
      expect(JSON.stringify(del.body)).not.toContain('Hidden');
    }
    // The author still sees their own private rows.
    expect((await authed(a).get(`/api/v1/journal/${journalId}`)).status).toBe(200);
    expect((await authed(a).get(`/api/v1/letter/${draftId}`)).status).toBe(200);
  });

  it('shared record readable by both accounts; scheduled letter invisible pre-release and visible post-release (server time)', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['P5 O', 'P5 P']);
    const [a, b] = agents as [NonNullable<(typeof agents)[0]>, NonNullable<(typeof agents)[1]>];
    const memory = await authed(a).post(`/api/v1/spaces/${spaceId}/memories`, { title: 'P5 Both Memory' });
    const memoryId = (memory.body as { data: { id: string } }).data.id;
    expect((await authed(a).get(`/api/v1/memory/${memoryId}`)).status).toBe(200);
    expect((await authed(b).get(`/api/v1/memory/${memoryId}`)).status).toBe(200);
    const future = await authed(a).post(`/api/v1/spaces/${spaceId}/letters`, { title: 'P5 Not Yet Title', body: 'P5 not yet body', visibility: 'scheduled', revealAt: '2999-01-01T00:00:00.000Z' });
    const futureId = (future.body as { data: { id: string } }).data.id;
    const past = await authed(a).post(`/api/v1/spaces/${spaceId}/letters`, { title: 'P5 Already Title', body: 'P5 already body', visibility: 'scheduled', revealAt: '2020-01-01T00:00:00.000Z' });
    const pastId = (past.body as { data: { id: string } }).data.id;
    const futureGet = await authed(b).get(`/api/v1/letter/${futureId}`);
    expect(futureGet.status).toBe(404);
    expect(JSON.stringify(futureGet.body)).not.toContain('Not Yet');
    const list = await authed(b).get(`/api/v1/spaces/${spaceId}/letters`);
    expect((list.body.data as { title: string }[]).map((l) => l.title)).not.toContain('P5 Not Yet Title');
    expect((list.body.data as { title: string }[]).map((l) => l.title)).toContain('P5 Already Title');
    const pastGet = await authed(b).get(`/api/v1/letter/${pastId}`);
    expect(pastGet.status).toBe(200);
    expect((pastGet.body as { data: { body: string } }).data.body).toBe('P5 already body');
  });

  it('media stream of a shared memory asset works for a member and 404s for a non-member', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['P5 Q', 'P5 R']);
    const [a, b] = agents as [NonNullable<(typeof agents)[0]>, NonNullable<(typeof agents)[1]>];
    const memory = await authed(a).post(`/api/v1/spaces/${spaceId}/memories`, { title: 'P5 Stream Memory' });
    const memoryId = (memory.body as { data: { id: string } }).data.id;
    const assetId = await uploadPng(a, spaceId, memoryId);
    expect((await authed(b).get(`/api/v1/media/${assetId}`)).status).toBe(200);
    const { agents: outsiders } = await createSpaceWithMembers(['P5 Out2']);
    const [outsider] = outsiders as [NonNullable<(typeof outsiders)[0]>];
    expect((await authed(outsider).get(`/api/v1/media/${assetId}`)).status).toBe(404);
  });
});
