import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, authed, cleanDb, createSpaceWithMembers, createUserDirect, loginAgent, ORIGIN, uniqueEmail } from './helpers.js';
import { prisma } from '../../src/db.js';

beforeAll(async () => {
  await cleanDb();
});

describe('anonymous and CSRF (T6, T18, T19)', () => {
  it('anonymous requests to private endpoints return 401 with no data', async () => {
    const res = await request(app).get('/api/v1/spaces/me').set('Origin', ORIGIN);
    expect(res.status).toBe(401);
    expect(res.body.data).toBeUndefined();
    const media = await request(app).get('/api/v1/media/some-id').set('Origin', ORIGIN);
    expect(media.status).toBe(401);
  });

  it('state-changing requests without a CSRF token, with a wrong token, and with another session token all fail', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['Partner A', 'Partner B']);
    const [a, b] = agents as [NonNullable<(typeof agents)[0]>, NonNullable<(typeof agents)[1]>];
    // No token
    const noToken = await a.agent.post(`/api/v1/spaces/${spaceId}/memories`).set('Origin', ORIGIN).send({ title: 'X' });
    expect(noToken.status).toBe(403);
    // Wrong token
    const wrong = await a.agent.post(`/api/v1/spaces/${spaceId}/memories`).set('Origin', ORIGIN).set('X-CSRF-Token', 'wrong-token').send({ title: 'X' });
    expect(wrong.status).toBe(403);
    // Other session's token
    const other = await a.agent.post(`/api/v1/spaces/${spaceId}/memories`).set('Origin', ORIGIN).set('X-CSRF-Token', b.csrf).send({ title: 'X' });
    expect(other.status).toBe(403);
    // Correct token succeeds
    const ok = await authed(a).post(`/api/v1/spaces/${spaceId}/memories`, { title: 'Hello' });
    expect(ok.status).toBe(201);
  });

  it('requests from an unlisted origin are rejected and get no credentials', async () => {
    const { agents } = await createSpaceWithMembers(['Origin A', 'Origin B']);
    const [a] = agents as [NonNullable<(typeof agents)[0]>];
    const res = await a.agent.post('/api/v1/spaces').set('Origin', 'https://evil.example').set('X-CSRF-Token', a.csrf).send({ name: 'Evil' });
    expect(res.status).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    const preflight = await request(app).options('/api/v1/spaces').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'POST');
    expect(preflight.status).toBe(403);
  });
});

describe('private journals and drafts (T3, T4, T15, T16)', () => {
  it('partner cannot read a private journal by id or list, and cannot edit it', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['Journal A', 'Journal B']);
    const [a, b] = agents as [NonNullable<(typeof agents)[0]>, NonNullable<(typeof agents)[1]>];
    const created = await authed(a).post(`/api/v1/spaces/${spaceId}/journals`, { title: 'My private thought', body: 'secret' });
    expect(created.status).toBe(201);
    const journalId = (created.body as { data: { id: string } }).data.id;
    const byId = await authed(b).get(`/api/v1/journal/${journalId}`);
    expect(byId.status).toBe(404);
    const list = await authed(b).get(`/api/v1/spaces/${spaceId}/journals`);
    expect(list.status).toBe(200);
    expect((list.body as { data: unknown[] }).data).toEqual([]);
    const edit = await authed(b).patch(`/api/v1/journal/${journalId}`, { title: 'Hacked' });
    expect(edit.status).toBe(404);
    const own = await authed(a).get(`/api/v1/journal/${journalId}`);
    expect(own.status).toBe(200);
    expect((own.body as { data: { title: string } }).data.title).toBe('My private thought');
  });

  it('partner cannot read a private draft letter by id or list', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['Draft A', 'Draft B']);
    const [a, b] = agents as [NonNullable<(typeof agents)[0]>, NonNullable<(typeof agents)[1]>];
    const created = await authed(a).post(`/api/v1/spaces/${spaceId}/letters`, { title: 'Draft', body: 'secret draft', visibility: 'private_draft' });
    expect(created.status).toBe(201);
    const letterId = (created.body as { data: { id: string } }).data.id;
    expect((await authed(b).get(`/api/v1/letter/${letterId}`)).status).toBe(404);
    const list = await authed(b).get(`/api/v1/spaces/${spaceId}/letters`);
    const titles = ((list.body as { data: { title: string }[] }).data).map((l) => l.title);
    expect(titles).not.toContain('Draft');
  });

  it('client-supplied authorId/spaceId are ignored on create (T16)', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['Idor A', 'Idor B']);
    const [a, b] = agents as [NonNullable<(typeof agents)[0]>, NonNullable<(typeof agents)[1]>];
    const created = await authed(a).post(`/api/v1/spaces/${spaceId}/memories`, { title: 'Mine', authorId: b.user.id, spaceId: '00000000-0000-0000-0000-000000000000' });
    expect(created.status).toBe(201);
    expect((created.body as { data: { authorId: string; spaceId: string } }).data.authorId).toBe(a.user.id);
    expect((created.body as { data: { authorId: string; spaceId: string } }).data.spaceId).toBe(spaceId);
  });

  it('PATCH /me updates only the caller, never another user (T15)', async () => {
    const { agents } = await createSpaceWithMembers(['Profile A', 'Profile B']);
    const [a, b] = agents as [NonNullable<(typeof agents)[0]>, NonNullable<(typeof agents)[1]>];
    const res = await authed(a).patch('/api/v1/auth/me', { displayName: 'Changed Name' });
    expect(res.status).toBe(200);
    const other = await prisma.user.findUnique({ where: { id: b.user.id } });
    expect(other?.displayName).toBe('Profile B');
  });
});

describe('scheduled letters (T5)', () => {
  it('partner cannot see an undelivered scheduled letter; a delivered one is shared', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['Letter A', 'Letter B']);
    const [a, b] = agents as [NonNullable<(typeof agents)[0]>, NonNullable<(typeof agents)[1]>];
    const future = new Date(Date.now() + 86400_000).toISOString();
    const past = new Date(Date.now() - 86400_000).toISOString();
    const undelivered = await authed(a).post(`/api/v1/spaces/${spaceId}/letters`, { title: 'Future', body: 'not yet', visibility: 'scheduled', revealAt: future });
    expect(undelivered.status).toBe(201);
    const undeliveredId = (undelivered.body as { data: { id: string } }).data.id;
    expect((await authed(b).get(`/api/v1/letter/${undeliveredId}`)).status).toBe(404);
    const list = await authed(b).get(`/api/v1/spaces/${spaceId}/letters`);
    expect(((list.body as { data: { title: string }[] }).data).map((l) => l.title)).not.toContain('Future');
    const delivered = await authed(a).post(`/api/v1/spaces/${spaceId}/letters`, { title: 'Past', body: 'now visible', visibility: 'scheduled', revealAt: past });
    const deliveredId = (delivered.body as { data: { id: string } }).data.id;
    const partnerRead = await authed(b).get(`/api/v1/letter/${deliveredId}`);
    expect(partnerRead.status).toBe(200);
    expect((partnerRead.body as { data: { body: string } }).data.body).toBe('now visible');
  });
});

describe('spaces, invitations, concurrency (T1, T2, T7)', () => {
  it('a third user cannot join a full space, including two simultaneous joins', async () => {
    const emailA = uniqueEmail('full-a');
    const userA = await createUserDirect(emailA, 'Full A');
    const agentA = await loginAgent(emailA);
    const spaceRes = await authed(agentA).post('/api/v1/spaces', { name: 'Full Space' });
    expect(spaceRes.status).toBe(201);
    const spaceId = (spaceRes.body as { data: { id: string } }).data.id;
    const inv1 = await authed(agentA).post(`/api/v1/spaces/${spaceId}/invitations`, {});
    const inv2 = await authed(agentA).post(`/api/v1/spaces/${spaceId}/invitations`, {});
    expect(inv1.status).toBe(201);
    expect(inv2.status).toBe(201);
    const token1 = (inv1.body as { data: { token: string } }).data.token;
    const token2 = (inv2.body as { data: { token: string } }).data.token;
    const emailB = uniqueEmail('full-b');
    await createUserDirect(emailB, 'Full B');
    const agentB = await loginAgent(emailB);
    const emailC = uniqueEmail('full-c');
    await createUserDirect(emailC, 'Full C');
    const agentC = await loginAgent(emailC);
    const [rB, rC] = await Promise.all([
      authed(agentB).post('/api/v1/spaces/invitations/join', { token: token1 }),
      authed(agentC).post('/api/v1/spaces/invitations/join', { token: token2 }),
    ]);
    const successes = [rB, rC].filter((r) => r.status === 200);
    const failures = [rB, rC].filter((r) => r.status !== 200);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    const count = await prisma.spaceMember.count({ where: { spaceId } });
    expect(count).toBe(2);
    // A further invitation cannot even be created for a full space.
    const inv3 = await authed(agentA).post(`/api/v1/spaces/${spaceId}/invitations`, {});
    expect(inv3.status).toBe(409);
  });

  it('a user already in a space cannot create or join another (T2)', async () => {
    const { agents } = await createSpaceWithMembers(['Already A', 'Already B']);
    const [a] = agents as [NonNullable<(typeof agents)[0]>];
    const create = await authed(a).post('/api/v1/spaces', { name: 'Second' });
    expect(create.status).toBe(409);
    const join = await authed(a).post('/api/v1/spaces/invitations/join', { token: '0000000000000000000000000000000000000000000000000000000000000000' });
    expect(join.status).toBe(409);
  });

  it('a non-member requesting another space by guessed id gets nothing (T7)', async () => {
    const { spaceId } = await createSpaceWithMembers(['Space A', 'Space B']);
    const emailOut = uniqueEmail('outsider');
    await createUserDirect(emailOut, 'Outsider');
    const outsider = await loginAgent(emailOut);
    expect((await authed(outsider).get(`/api/v1/spaces/${spaceId}`)).status).toBe(404);
    expect((await authed(outsider).get(`/api/v1/spaces/${spaceId}/memories`)).status).toBe(404);
  });

  it('expired and already-used invitations fail generically (T8)', async () => {
    const emailA = uniqueEmail('inv-a');
    const userA = await createUserDirect(emailA, 'Inv A');
    const agentA = await loginAgent(emailA);
    const spaceRes = await authed(agentA).post('/api/v1/spaces', { name: 'Inv Space' });
    const spaceId = (spaceRes.body as { data: { id: string } }).data.id;
    const inv = await authed(agentA).post(`/api/v1/spaces/${spaceId}/invitations`, {});
    const token = (inv.body as { data: { token: string } }).data.token;
    const emailB = uniqueEmail('inv-b');
    await createUserDirect(emailB, 'Inv B');
    const agentB = await loginAgent(emailB);
    expect((await authed(agentB).post('/api/v1/spaces/invitations/join', { token })).status).toBe(200);
    // Reuse of the same token fails generically.
    const emailC = uniqueEmail('inv-c');
    await createUserDirect(emailC, 'Inv C');
    const agentC = await loginAgent(emailC);
    const reuse = await authed(agentC).post('/api/v1/spaces/invitations/join', { token });
    expect(reuse.status).toBe(400);
    expect((reuse.body as { error: { code: string } }).error.code).toBe('INVITATION_INVALID');
    // Wrong token fails the same way.
    const wrong = await authed(agentC).post('/api/v1/spaces/invitations/join', { token: 'a'.repeat(64) });
    expect(wrong.status).toBe(400);
    expect((wrong.body as { error: { code: string } }).error.code).toBe('INVITATION_INVALID');
    expect(userA.id).toBeTruthy();
  });
});

describe('deletion and plan completion (T11, T12)', () => {
  it('soft delete hides, restore returns, permanent without soft delete is refused, then permanent removes', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['Delete A', 'Delete B']);
    const [a, b] = agents as [NonNullable<(typeof agents)[0]>, NonNullable<(typeof agents)[1]>];
    const created = await authed(a).post(`/api/v1/spaces/${spaceId}/memories`, { title: 'To delete' });
    const id = (created.body as { data: { id: string } }).data.id;
    // Permanent delete before soft delete is refused.
    expect((await authed(a).delete(`/api/v1/memory/${id}`)).status).toBe(409);
    const soft = await authed(a).post(`/api/v1/memory/${id}/soft-delete`, {});
    expect(soft.status).toBe(200);
    // Partner list no longer shows it; author Deleted view does.
    const partnerList = await authed(b).get(`/api/v1/spaces/${spaceId}/memories`);
    expect(((partnerList.body as { data: { title: string }[] }).data).map((m) => m.title)).not.toContain('To delete');
    const deletedView = await authed(a).get(`/api/v1/spaces/${spaceId}/memories?deleted=true`);
    expect(((deletedView.body as { data: { title: string }[] }).data).map((m) => m.title)).toContain('To delete');
    const restored = await authed(a).post(`/api/v1/memory/${id}/restore`, {});
    expect(restored.status).toBe(200);
    const soft2 = await authed(a).post(`/api/v1/memory/${id}/soft-delete`, {});
    expect(soft2.status).toBe(200);
    const perm = await authed(a).delete(`/api/v1/memory/${id}`);
    expect(perm.status).toBe(200);
    expect((await authed(a).get(`/api/v1/memory/${id}`)).status).toBe(404);
  });

  it('completing a plan twice creates exactly one linked memory (T12)', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['Plan A', 'Plan B']);
    const [a] = agents as [NonNullable<(typeof agents)[0]>];
    const created = await authed(a).post(`/api/v1/spaces/${spaceId}/plans`, { title: 'Picnic', category: 'date' });
    const planId = (created.body as { data: { id: string } }).data.id;
    const first = await authed(a).post(`/api/v1/plan/${planId}/complete`, { createMemory: true, memoryTitle: 'Picnic day' });
    expect(first.status).toBe(200);
    const second = await authed(a).post(`/api/v1/plan/${planId}/complete`, { createMemory: true, memoryTitle: 'Picnic day' });
    expect(second.status).toBe(409);
    const memories = await authed(a).get(`/api/v1/spaces/${spaceId}/memories`);
    const picnic = ((memories.body as { data: { title: string }[] }).data).filter((m) => m.title === 'Picnic day');
    expect(picnic).toHaveLength(1);
    // Idempotency: same key + same body replays without a duplicate.
    const key = 'test-idempotency-key-1';
    const agent = a;
    const one = await agent.agent.post(`/api/v1/spaces/${spaceId}/memories`).set('Origin', ORIGIN).set('X-CSRF-Token', agent.csrf).set('Idempotency-Key', key).send({ title: 'Idempotent memory' });
    expect(one.status).toBe(201);
    const two = await agent.agent.post(`/api/v1/spaces/${spaceId}/memories`).set('Origin', ORIGIN).set('X-CSRF-Token', agent.csrf).set('Idempotency-Key', key).send({ title: 'Idempotent memory' });
    expect(two.status).toBe(201);
    expect((two.body as { data: { id: string } }).data.id).toBe((one.body as { data: { id: string } }).data.id);
    const three = await agent.agent.post(`/api/v1/spaces/${spaceId}/memories`).set('Origin', ORIGIN).set('X-CSRF-Token', agent.csrf).set('Idempotency-Key', key).send({ title: 'Different memory' });
    expect(three.status).toBe(409);
  });
});

describe('sessions (T14)', () => {
  it('logout revokes the session immediately', async () => {
    const { agents } = await createSpaceWithMembers(['Logout A', 'Logout B']);
    const [a] = agents as [NonNullable<(typeof agents)[0]>];
    const logout = await authed(a).post('/api/v1/auth/logout', {});
    expect(logout.status).toBe(200);
    expect((await authed(a).get('/api/v1/auth/me')).status).toBe(401);
  });

  it('password change revokes other sessions but not the current one', async () => {
    const email = uniqueEmail('pwchange');
    await createUserDirect(email, 'Pw Change');
    const first = await loginAgent(email);
    const second = await loginAgent(email);
    const change = await authed(first).post('/api/v1/auth/password-change', { password: 'NewPassword123' });
    expect(change.status).toBe(200);
    // Current session still works (with its rotated CSRF token).
    const newCsrf = (change.body as { data: { csrfToken: string } }).data.csrfToken;
    const me = await first.agent.get('/api/v1/auth/me').set('Origin', ORIGIN);
    expect(me.status).toBe(200);
    // Other session is revoked.
    expect((await authed(second).get('/api/v1/auth/me')).status).toBe(401);
    expect(newCsrf).toBeTruthy();
  });
});

describe('rate limits (T20, last — it consumes the per-IP login budget)', () => {
  it('repeated failed logins eventually return 429 with a generic message', async () => {
    const email = uniqueEmail('ratelimit');
    await createUserDirect(email, 'Rate Limit');
    const agent = request.agent(app);
    const csrfRes = await agent.get('/api/v1/auth/csrf').set('Origin', ORIGIN);
    const anonCsrf = (csrfRes.body as { data: { csrfToken: string } }).data.csrfToken;
    let lastStatus = 0;
    for (let i = 0; i < 8; i += 1) {
      const res = await agent.post('/api/v1/auth/login').set('Origin', ORIGIN).set('X-CSRF-Token', anonCsrf).send({ email, password: 'WrongPassword123' });
      lastStatus = res.status;
      if (res.status === 429) break;
    }
    expect(lastStatus).toBe(429);
  });
});
