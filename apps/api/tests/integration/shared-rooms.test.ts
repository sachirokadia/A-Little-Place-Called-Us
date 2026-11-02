import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { app, authed, cleanDb, createSpaceWithMembers, ORIGIN } from './helpers.js';

beforeAll(async () => {
  await cleanDb();
});

function data(res: { body: unknown }): Record<string, unknown> {
  return (res.body as { data: Record<string, unknown> }).data;
}
function list(res: { body: unknown }): Record<string, unknown>[] {
  return (res.body as { data: Record<string, unknown>[] }).data;
}

describe('shared rooms: reminders, tags, letter visibility, display media', () => {
  it('reminder CRUD + favourites + random with both accounts', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['Rem A', 'Rem B']);
    const [a, b] = agents as [NonNullable<(typeof agents)[0]>, NonNullable<(typeof agents)[1]>];
    const created = await authed(a).post(`/api/v1/spaces/${spaceId}/reminders`, { text: 'Drink water, love', kind: 'note' });
    expect(created.status).toBe(201);
    const id = data(created).id as string;
    const prompt = await authed(a).post(`/api/v1/spaces/${spaceId}/reminders`, { text: 'What made you smile today?', kind: 'prompt' });
    expect(prompt.status).toBe(201);
    const promptId = data(prompt).id as string;
    // Edit (kind choice + text) by the author.
    const edited = await authed(a).patch(`/api/v1/reminder/${id}`, { text: 'Drink water, love — edited', kind: 'prompt' });
    expect(edited.status).toBe(200);
    expect(data(edited).text).toBe('Drink water, love — edited');
    expect(data(edited).kind).toBe('prompt');
    // Partner can read and favourite, but not edit.
    expect((await authed(b).patch(`/api/v1/reminder/${id}`, { text: 'hijack' })).status).toBe(404);
    expect((await authed(b).post(`/api/v1/reminder/${id}/favourite`)).status).toBe(200);
    const favs = await authed(b).get(`/api/v1/spaces/${spaceId}/reminders?favourited=true`);
    expect(list(favs).map((r) => r.id)).toContain(id);
    // Random picks only from real saved reminders.
    const random = await authed(b).get(`/api/v1/spaces/${spaceId}/reminders/random`);
    expect(random.status).toBe(200);
    expect([id, promptId]).toContain(data(random).id);
    // Soft-delete + restore via Deleted, author only.
    expect((await authed(b).post(`/api/v1/reminder/${id}/soft-delete`)).status).toBe(404);
    expect((await authed(a).post(`/api/v1/reminder/${id}/soft-delete`)).status).toBe(200);
    const deleted = await authed(a).get(`/api/v1/spaces/${spaceId}/reminders?deleted=true`);
    expect(list(deleted).map((r) => r.id)).toContain(id);
    expect((await authed(a).post(`/api/v1/reminder/${id}/restore`)).status).toBe(200);
    const again = await authed(a).get(`/api/v1/spaces/${spaceId}/reminders`);
    expect(list(again).map((r) => r.id)).toContain(id);
  });

  it('memory tags round-trip on create and edit, and are listed to the partner', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['Tag A', 'Tag B']);
    const [a, b] = agents as [NonNullable<(typeof agents)[0]>, NonNullable<(typeof agents)[1]>];
    const created = await authed(a).post(`/api/v1/spaces/${spaceId}/memories`, { title: 'Beach day', tags: ['summer', 'sea'] });
    expect(created.status).toBe(201);
    expect(data(created).tags).toEqual(['summer', 'sea']);
    const id = data(created).id as string;
    const edited = await authed(a).patch(`/api/v1/memory/${id}`, { tags: ['summer', 'sunset'] });
    expect(edited.status).toBe(200);
    expect(data(edited).tags).toEqual(['summer', 'sunset']);
    const partnerList = await authed(b).get(`/api/v1/spaces/${spaceId}/memories`);
    const row = list(partnerList).find((m) => m.id === id);
    expect(row?.tags).toEqual(['summer', 'sunset']);
    // Partner cannot edit tags (author-only edit).
    expect((await authed(b).patch(`/api/v1/memory/${id}`, { tags: ['hijack'] })).status).toBe(404);
    // Empty tags round-trip.
    const plain = await authed(a).post(`/api/v1/spaces/${spaceId}/memories`, { title: 'No tags' });
    expect(data(plain).tags).toEqual([]);
  });

  it('letter visibility edit + scheduled/delivered data, undelivered hidden from partner', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['Let A', 'Let B']);
    const [a, b] = agents as [NonNullable<(typeof agents)[0]>, NonNullable<(typeof agents)[1]>];
    const future = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
    const past = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const sealed = await authed(a).post(`/api/v1/spaces/${spaceId}/letters`, { title: 'Sealed one', body: 'secret', visibility: 'scheduled', revealAt: future });
    expect(sealed.status).toBe(201);
    const sealedId = data(sealed).id as string;
    // Undelivered scheduled letter is invisible to the partner.
    const partnerList = await authed(b).get(`/api/v1/spaces/${spaceId}/letters`);
    expect(list(partnerList).map((l) => l.id)).not.toContain(sealedId);
    expect((await authed(b).patch(`/api/v1/letter/${sealedId}`, { visibility: 'shared' })).status).toBe(404);
    // Delivered scheduled letter (revealAt in the past) IS visible to
    // the partner, with visibility + revealAt intact for the client
    // "Delivered — was scheduled, now open" label.
    const delivered = await authed(a).post(`/api/v1/spaces/${spaceId}/letters`, { title: 'Opened one', body: 'hello', visibility: 'scheduled', revealAt: past });
    const deliveredId = data(delivered).id as string;
    const partnerList2 = await authed(b).get(`/api/v1/spaces/${spaceId}/letters`);
    const deliveredRow = list(partnerList2).find((l) => l.id === deliveredId);
    expect(deliveredRow?.visibility).toBe('scheduled');
    expect(typeof deliveredRow?.revealAt).toBe('string');
    expect(new Date(deliveredRow?.revealAt as string).getTime()).toBeLessThan(Date.now());
    // Visibility edit: scheduled -> shared, with a new revealAt.
    const edited = await authed(a).patch(`/api/v1/letter/${sealedId}`, { visibility: 'shared', revealAt: future });
    expect(edited.status).toBe(200);
    expect(data(edited).visibility).toBe('shared');
    // Scheduled without revealAt is still a 400 on edit (existing
    // validation is not weakened): shared letter -> scheduled, no date.
    const shared = await authed(a).post(`/api/v1/spaces/${spaceId}/letters`, { title: 'Plain', body: 'hi', visibility: 'shared' });
    expect((await authed(a).patch(`/api/v1/letter/${data(shared).id as string}`, { visibility: 'scheduled' })).status).toBe(400);
    // Private draft invisible to the partner, uneditable by them.
    const draft = await authed(a).post(`/api/v1/spaces/${spaceId}/letters`, { title: 'Draft', body: 'mine', visibility: 'private_draft' });
    const draftId = data(draft).id as string;
    expect(list(await authed(b).get(`/api/v1/spaces/${spaceId}/letters`).then((r) => r)).map((l) => l.id)).not.toContain(draftId);
    expect((await authed(b).patch(`/api/v1/letter/${draftId}`, { body: 'hijack' })).status).toBe(404);
  });

  it('media ?size=display: auth, aspect preservation, GIF unchanged', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['Media A', 'Media B']);
    const [a, b] = agents as [NonNullable<(typeof agents)[0]>, NonNullable<(typeof agents)[1]>];
    const memory = await authed(a).post(`/api/v1/spaces/${spaceId}/memories`, { title: 'Wide photo' });
    const memoryId = data(memory).id as string;
    const wide = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: { r: 40, g: 120, b: 80 } } }).png().toBuffer();
    const upload = await a.agent
      .post(`/api/v1/spaces/${spaceId}/media`)
      .set('Origin', ORIGIN).set('X-CSRF-Token', a.csrf)
      .field('linkedType', 'memory').field('linkedId', memoryId)
      .attach('file', wide, 'wide.png');
    expect(upload.status).toBe(201);
    const assetId = data(upload).id as string;
    expect(data(upload).width).toBe(2000);
    expect(data(upload).height).toBe(1000);
    const full = await authed(a).get(`/api/v1/media/${assetId}`);
    expect(full.status).toBe(200);
    const display = await authed(a).get(`/api/v1/media/${assetId}?size=display`);
    expect(display.status).toBe(200);
    expect(display.headers['cache-control']).toBe('private, no-store');
    const meta = await sharp(display.body as Buffer).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(1200);
    expect(meta.width).toBe(1200);
    expect(meta.height).toBe(600);
    // Aspect within rounding: 2000:1000 -> 1200:600 exactly.
    expect(Math.abs((meta.width! / meta.height!) - 2)).toBeLessThan(0.01);
    // Partner may stream the display variant; outsider and anonymous may not.
    expect((await authed(b).get(`/api/v1/media/${assetId}?size=display`)).status).toBe(200);
    const other = await createSpaceWithMembers(['Media C', 'Media D']);
    const [c] = other.agents as [NonNullable<(typeof other.agents)[0]>];
    expect((await authed(c).get(`/api/v1/media/${assetId}?size=display`)).status).toBe(404);
    expect((await request(app).get(`/api/v1/media/${assetId}?size=display`).set('Origin', ORIGIN)).status).toBe(401);
    // GIF passes through unchanged (display bytes == full bytes).
    const gif = await sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 200, g: 30, b: 30 } } }).gif().toBuffer();
    const gifUpload = await a.agent
      .post(`/api/v1/spaces/${spaceId}/media`)
      .set('Origin', ORIGIN).set('X-CSRF-Token', a.csrf)
      .field('linkedType', 'memory').field('linkedId', memoryId)
      .attach('file', gif, 'anim.gif');
    expect(gifUpload.status).toBe(201);
    const gifId = data(gifUpload).id as string;
    const gifFull = await authed(a).get(`/api/v1/media/${gifId}`);
    const gifDisplay = await authed(a).get(`/api/v1/media/${gifId}?size=display`);
    expect(Buffer.compare(gifFull.body as Buffer, gifDisplay.body as Buffer)).toBe(0);
    // Full stream still serves the original dimensions.
    const fullMeta = await sharp(full.body as Buffer).metadata();
    expect(fullMeta.width).toBe(2000);
    expect(fullMeta.height).toBe(1000);
  });

  it('authorisation boundaries: partner cannot edit/delete private items or upload to another author memory', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['Bound A', 'Bound B']);
    const [a, b] = agents as [NonNullable<(typeof agents)[0]>, NonNullable<(typeof agents)[1]>];
    const journal = await authed(a).post(`/api/v1/spaces/${spaceId}/journals`, { title: 'Private journal', body: 'mine only' });
    const journalId = data(journal).id as string;
    expect((await authed(b).patch(`/api/v1/journal/${journalId}`, { body: 'hijack' })).status).toBe(404);
    expect((await authed(b).post(`/api/v1/journal/${journalId}/soft-delete`)).status).toBe(404);
    expect(list(await authed(b).get(`/api/v1/spaces/${spaceId}/journals`))).toHaveLength(0);
    const memory = await authed(a).post(`/api/v1/spaces/${spaceId}/memories`, { title: 'My memory' });
    const memoryId = data(memory).id as string;
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
    const partnerUpload = await b.agent
      .post(`/api/v1/spaces/${spaceId}/media`)
      .set('Origin', ORIGIN).set('X-CSRF-Token', b.csrf)
      .field('linkedType', 'memory').field('linkedId', memoryId)
      .attach('file', png, 'photo.png');
    expect(partnerUpload.status).toBe(404);
    // Voice notes are author-only too.
    const vn = await authed(a).post(`/api/v1/spaces/${spaceId}/voice-notes`, { title: 'My note' });
    const vnId = data(vn).id as string;
    expect((await authed(b).get(`/api/v1/media/for/voiceNote/${vnId}`)).status).toBe(404);
  });
});
