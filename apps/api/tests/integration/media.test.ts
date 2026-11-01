import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { app, authed, cleanDb, createSpaceWithMembers, ORIGIN } from './helpers.js';

beforeAll(async () => {
  await cleanDb();
});

describe('media gate and EXIF (T9, T10)', () => {
  it('member can upload and stream, outsider and anonymous cannot, disallowed types are refused', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['Media A', 'Media B']);
    const [a, b] = agents as [NonNullable<(typeof agents)[0]>, NonNullable<(typeof agents)[1]>];
    const memory = await authed(a).post(`/api/v1/spaces/${spaceId}/memories`, { title: 'Photo memory' });
    const memoryId = (memory.body as { data: { id: string } }).data.id;
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: { r: 200, g: 100, b: 50 } } }).png().toBuffer();
    const upload = await a.agent
      .post(`/api/v1/spaces/${spaceId}/media`)
      .set('Origin', ORIGIN).set('X-CSRF-Token', a.csrf)
      .field('linkedType', 'memory').field('linkedId', memoryId)
      .attach('file', png, 'photo.png');
    expect(upload.status).toBe(201);
    const assetId = (upload.body as { data: { id: string } }).data.id;
    expect((upload.body as { data: { storageKey?: string } }).data.storageKey).toBeUndefined();
    // Partner (same space) can stream.
    const partnerStream = await authed(b).get(`/api/v1/media/${assetId}`);
    expect(partnerStream.status).toBe(200);
    // Anonymous cannot.
    const anon = await request(app).get(`/api/v1/media/${assetId}`).set('Origin', ORIGIN);
    expect(anon.status).toBe(401);
    // Outsider in another space cannot.
    const other = await createSpaceWithMembers(['Media C', 'Media D']);
    const [c] = other.agents as [NonNullable<(typeof other.agents)[0]>];
    expect((await authed(c).get(`/api/v1/media/${assetId}`)).status).toBe(404);
    // Disallowed type refused.
    const bad = await a.agent
      .post(`/api/v1/spaces/${spaceId}/media`)
      .set('Origin', ORIGIN).set('X-CSRF-Token', a.csrf)
      .field('linkedType', 'memory').field('linkedId', memoryId)
      .attach('file', Buffer.from('MZ fake exe'), 'evil.exe');
    expect(bad.status).toBe(400);
  });

  it('EXIF GPS/description metadata is stripped on upload', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['Exif A', 'Exif B']);
    const [a] = agents as [NonNullable<(typeof agents)[0]>];
    const memory = await authed(a).post(`/api/v1/spaces/${spaceId}/memories`, { title: 'Exif memory' });
    const memoryId = (memory.body as { data: { id: string } }).data.id;
    const jpegWithExif = await sharp({ create: { width: 10, height: 10, channels: 3, background: { r: 10, g: 20, b: 30 } } })
      .jpeg()
      .withMetadata({ exif: { IFD0: { ImageDescription: 'TestGPSMarkerXYZ' } } } as never)
      .toBuffer();
    expect(jpegWithExif.includes(Buffer.from('TestGPSMarkerXYZ'))).toBe(true);
    const upload = await a.agent
      .post(`/api/v1/spaces/${spaceId}/media`)
      .set('Origin', ORIGIN).set('X-CSRF-Token', a.csrf)
      .field('linkedType', 'memory').field('linkedId', memoryId)
      .attach('file', jpegWithExif, 'photo.jpg');
    expect(upload.status).toBe(201);
    const assetId = (upload.body as { data: { id: string } }).data.id;
    const stream = await authed(a).get(`/api/v1/media/${assetId}`);
    expect(stream.status).toBe(200);
    const body = stream.body as Buffer;
    expect(Buffer.isBuffer(body) ? body.includes(Buffer.from('TestGPSMarkerXYZ')) : false).toBe(false);
  });
});

describe('register and password reset deferral', () => {
  it('register creates an account and a session, and duplicate email is a conflict', async () => {
    const agent = request.agent(app);
    const csrfRes = await agent.get('/api/v1/auth/csrf').set('Origin', ORIGIN);
    const anonCsrf = (csrfRes.body as { data: { csrfToken: string } }).data.csrfToken;
    const email = `register-${Date.now()}@example.test`;
    const res = await agent.post('/api/v1/auth/register').set('Origin', ORIGIN).set('X-CSRF-Token', anonCsrf).send({ email, password: 'TestPassword123', displayName: 'New User' });
    expect(res.status).toBe(201);
    expect((res.body as { data: { csrfToken: string } }).data.csrfToken).toBeTruthy();
    const dupAgent = request.agent(app);
    const csrf2 = await dupAgent.get('/api/v1/auth/csrf').set('Origin', ORIGIN);
    const anon2 = (csrf2.body as { data: { csrfToken: string } }).data.csrfToken;
    const dup = await dupAgent.post('/api/v1/auth/register').set('Origin', ORIGIN).set('X-CSRF-Token', anon2).send({ email, password: 'TestPassword123', displayName: 'Again' });
    expect(dup.status).toBe(409);
  });

  it('password reset endpoints are explicitly deferred and send nothing (R3)', async () => {
    const agent = request.agent(app);
    const csrfRes = await agent.get('/api/v1/auth/csrf').set('Origin', ORIGIN);
    const anonCsrf = (csrfRes.body as { data: { csrfToken: string } }).data.csrfToken;
    const res = await agent.post('/api/v1/auth/password-reset/request').set('Origin', ORIGIN).set('X-CSRF-Token', anonCsrf).send({ email: 'someone@example.test' });
    expect(res.status).toBe(501);
    expect((res.body as { error: { code: string } }).error.code).toBe('PASSWORD_RESET_DEFERRED');
  });
});
