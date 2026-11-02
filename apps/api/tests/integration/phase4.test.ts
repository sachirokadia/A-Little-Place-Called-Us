import { beforeAll, describe, expect, it } from 'vitest';
import { ORIGIN, authed, cleanDb, createSpaceWithMembers, type AuthedAgent } from './helpers.js';

// Phase 4 (Secret Arcade): per-player game progress only. The
// shared helpers expose no PUT wrapper, so PUTs go through the
// agent directly with the same Origin + CSRF headers authed() uses.
function put(agent: AuthedAgent, url: string, body: unknown) {
  return agent.agent.put(url).set('Origin', ORIGIN).set('X-CSRF-Token', agent.csrf).send(body);
}

beforeAll(async () => {
  await cleanDb();
});

describe('Phase 4 game progress', () => {
  it('saves then loads the caller\'s own memory-match progress', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['G4 A', 'G4 B']);
    const [a] = agents as [NonNullable<(typeof agents)[0]>];
    const saved = await put(a, `/api/v1/spaces/${spaceId}/game-progress/memory-match`, {
      progress: { completedGames: 3, bestTurns: 24, lastTurns: 30, lastPairs: 8 },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.data).toEqual({
      gameKey: 'memory-match',
      progress: { completedGames: 3, bestTurns: 24, lastTurns: 30, lastPairs: 8 },
    });
    const loaded = await authed(a).get(`/api/v1/spaces/${spaceId}/game-progress/memory-match`);
    expect(loaded.status).toBe(200);
    expect(loaded.body.data.progress).toEqual({ completedGames: 3, bestTurns: 24, lastTurns: 30, lastPairs: 8 });
    // Upsert replaces, it does not merge or append.
    const updated = await put(a, `/api/v1/spaces/${spaceId}/game-progress/memory-match`, {
      progress: { completedGames: 4, bestTurns: 20 },
    });
    expect(updated.status).toBe(200);
    expect(updated.body.data.progress).toEqual({ completedGames: 4, bestTurns: 20 });
    // A game with no row yet is a 404, not an empty object.
    expect((await authed(a).get(`/api/v1/spaces/${spaceId}/game-progress/quiz`)).status).toBe(404);
  });

  it('partner GET of the other player\'s row is a 404, and partner PUT cannot overwrite it', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['G4 C', 'G4 D']);
    const [a, b] = agents as [NonNullable<(typeof agents)[0]>, NonNullable<(typeof agents)[1]>];
    await put(a, `/api/v1/spaces/${spaceId}/game-progress/memory-match`, {
      progress: { completedGames: 5, bestTurns: 18 },
    });
    expect((await authed(b).get(`/api/v1/spaces/${spaceId}/game-progress/memory-match`)).status).toBe(404);
    // The partner PUT succeeds only for the partner's OWN row.
    const partnerSave = await put(b, `/api/v1/spaces/${spaceId}/game-progress/memory-match`, {
      progress: { completedGames: 99, bestTurns: 12 },
    });
    expect(partnerSave.status).toBe(200);
    expect(partnerSave.body.data.progress).toEqual({ completedGames: 99, bestTurns: 12 });
    const ownerStill = await authed(a).get(`/api/v1/spaces/${spaceId}/game-progress/memory-match`);
    expect(ownerStill.status).toBe(200);
    expect(ownerStill.body.data.progress).toEqual({ completedGames: 5, bestTurns: 18 });
  });

  it('a body-supplied playerId is rejected, never used to scope the row', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['G4 E', 'G4 F']);
    const [a, b] = agents as [NonNullable<(typeof agents)[0]>, NonNullable<(typeof agents)[1]>];
    const res = await put(b, `/api/v1/spaces/${spaceId}/game-progress/quiz`, {
      playerId: a.user.id,
      progress: { answered: 10, correct: 7 },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect((await authed(a).get(`/api/v1/spaces/${spaceId}/game-progress/quiz`)).status).toBe(404);
  });

  it('a non-member gets a generic 404, never a leak', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['G4 G', 'G4 H']);
    const [a] = agents as [NonNullable<(typeof agents)[0]>];
    await put(a, `/api/v1/spaces/${spaceId}/game-progress/mystery`, { progress: { completed: true } });
    const { agents: outsiders } = await createSpaceWithMembers(['G4 Out']);
    const [outsider] = outsiders as [NonNullable<(typeof outsiders)[0]>];
    expect((await authed(outsider).get(`/api/v1/spaces/${spaceId}/game-progress/mystery`)).status).toBe(404);
    expect((await put(outsider, `/api/v1/spaces/${spaceId}/game-progress/mystery`, { progress: { completed: true } })).status).toBe(404);
  });

  it('invalid gameKey is a 400 on both GET and PUT', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['G4 I', 'G4 J']);
    const [a] = agents as [NonNullable<(typeof agents)[0]>];
    expect((await authed(a).get(`/api/v1/spaces/${spaceId}/game-progress/leaderboard`)).status).toBe(400);
    const res = await put(a, `/api/v1/spaces/${spaceId}/game-progress/leaderboard`, { progress: {} });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('invalid progress shapes are 400 VALIDATION_ERROR', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['G4 K', 'G4 L']);
    const [a] = agents as [NonNullable<(typeof agents)[0]>];
    // Out-of-range int.
    expect((await put(a, `/api/v1/spaces/${spaceId}/game-progress/memory-match`, { progress: { bestTurns: 99999 } })).status).toBe(400);
    // Unknown unlock value.
    const hacked = await put(a, `/api/v1/spaces/${spaceId}/game-progress/arcade-unlocks`, { progress: { unlocks: ['hacked'] } });
    expect(hacked.status).toBe(400);
    expect(hacked.body.error.code).toBe('VALIDATION_ERROR');
    // Unknown key inside progress.
    expect((await put(a, `/api/v1/spaces/${spaceId}/game-progress/quiz`, { progress: { answered: 5, score: 9999 } })).status).toBe(400);
    // memory-match requires at least one field.
    expect((await put(a, `/api/v1/spaces/${spaceId}/game-progress/memory-match`, { progress: {} })).status).toBe(400);
    // progress must be an object, not an array or scalar.
    expect((await put(a, `/api/v1/spaces/${spaceId}/game-progress/quiz`, { progress: [1, 2] })).status).toBe(400);
    // Mystery clue too long / too many clues.
    expect((await put(a, `/api/v1/spaces/${spaceId}/game-progress/mystery`, { progress: { foundClues: ['x'.repeat(81)] } })).status).toBe(400);
    // Valid shapes still pass for the other keys.
    expect((await put(a, `/api/v1/spaces/${spaceId}/game-progress/mystery`, { progress: { completed: false, foundClues: ['drawer', 'key'] } })).status).toBe(200);
    expect((await put(a, `/api/v1/spaces/${spaceId}/game-progress/arcade-unlocks`, { progress: { unlocks: ['golden-star', 'pixel-cat'] } })).status).toBe(200);
  });

  it('quiz correct greater than answered is a 400', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['G4 M', 'G4 N']);
    const [a] = agents as [NonNullable<(typeof agents)[0]>];
    const res = await put(a, `/api/v1/spaces/${spaceId}/game-progress/quiz`, { progress: { answered: 3, correct: 4 } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect((await put(a, `/api/v1/spaces/${spaceId}/game-progress/quiz`, { progress: { answered: 3, correct: 3 } })).status).toBe(200);
  });
});
