// Original relationship board game (Phase 7) — API + persistence +
// validation integration tests. Custom terminology only: Memory
// Coins, Plot Twists, Little Surprises, Places and Moments,
// tokens. No third-party board-game name, logo, or proprietary
// card text appears anywhere here.
//
// These tests run against the REAL shared board engine
// (packages/shared/src/board-engine.ts), not a stub: configs use
// the engine's kinds ('start' | 'place' | 'plot-twist' |
// 'little-surprise' | 'tax' | 'rest' | 'miss-turn') and its card
// effects ('coins' | 'move' | 'missTurn' | 'toStart'). Two
// deliberate test-design choices follow from engine semantics:
// - Dice are server-side and random, so the buy flow uses a
//   "landing board" whose spaces 2–12 (every possible first roll
//   from Start) are all unowned, affordable Places: the first
//   roll always lands in purchaseDecision, deterministically.
// - The engine's DOUBLE_PURCHASE branch is unreachable through
//   normal play (landing on your own Place advances the turn
//   without entering purchaseDecision), so the double-purchase
//   test asserts the observable guarantee instead: after a
//   completed purchase, the same actor buying again is a 400 and
//   the version does not move.
// - No online multiplayer or real-time sync is claimed or tested:
//   the conflicting-update test runs two POSTs with the same
//   expectedVersion SEQUENTIALLY — that is the honest test of
//   optimistic locking, not a real-time sync claim.

import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db.js';
import { authed, cleanDb, createSpaceWithMembers, type AuthedAgent } from './helpers.js';

beforeAll(async () => {
  // New tables first (helpers.cleanDb predates them and would
  // otherwise hit FK constraints on leftover rows).
  await prisma.boardGame.deleteMany();
  await prisma.boardConfig.deleteMany();
  await cleanDb();
});

type Pair = [AuthedAgent, AuthedAgent];
function pair(agents: AuthedAgent[]): Pair {
  return agents as unknown as Pair;
}

const BASE = (spaceId: string) => `/api/v1/spaces/${spaceId}/board`;
const CONFIGS = (spaceId: string) => `${BASE(spaceId)}/configs`;
const GAMES = (spaceId: string) => `${BASE(spaceId)}/games`;

// Rich valid board: every engine kind, both decks, every effect
// type. 18 spaces, one start at index 0.
function validConfig() {
  return {
    startCoins: 1500,
    passStartBonus: 200,
    taxAmount: 100,
    spaces: [
      { id: 'start', kind: 'start', name: 'Start' },
      { id: 'cafe', kind: 'place', name: 'The Old Café Corner', price: 80, rent: 12, category: 'Neighbourhood' },
      { id: 'twist-1', kind: 'plot-twist', name: 'Plot Twist' },
      { id: 'bookshop', kind: 'place', name: 'The Corner Bookshop', price: 100, rent: 15, category: 'Neighbourhood' },
      { id: 'rainy-walk', kind: 'place', name: 'A Rainy Walk', price: 90, rent: 12, category: 'Outdoors' },
      { id: 'surprise-1', kind: 'little-surprise', name: 'Little Surprise' },
      { id: 'market', kind: 'place', name: 'The Sunday Market Stall', price: 120, rent: 18, category: 'Neighbourhood' },
      { id: 'tax-1', kind: 'tax', name: 'The Rainy-Day Fund' },
      { id: 'hilltop', kind: 'place', name: 'The Hilltop Viewpoint', price: 140, rent: 20, category: 'Outdoors' },
      { id: 'riverside', kind: 'place', name: 'The Riverside Path', price: 110, rent: 15, category: 'Outdoors' },
      { id: 'bench', kind: 'rest', name: 'The Quiet Bench' },
      { id: 'coast', kind: 'place', name: 'Dream Trip: The Coast', price: 200, rent: 30, category: 'Dream Trips' },
      { id: 'twist-2', kind: 'plot-twist', name: 'Plot Twist' },
      { id: 'mountain', kind: 'place', name: 'Dream Trip: The Mountains', price: 240, rent: 35, category: 'Dream Trips' },
      { id: 'fort', kind: 'place', name: 'A Blanket Fort Evening', price: 60, rent: 8, category: 'Cosy Nights' },
      { id: 'surprise-2', kind: 'little-surprise', name: 'Little Surprise' },
      { id: 'nap', kind: 'miss-turn', name: 'The Long Nap' },
      { id: 'rooftop', kind: 'place', name: 'The Starlit Rooftop', price: 150, rent: 22, category: 'Cosy Nights' },
    ],
    plotTwists: [
      { id: 'pt-1', text: 'Refund! Collect 150 Memory Coins.', effect: { type: 'coins', amount: 150 } },
      { id: 'pt-2', text: 'Shortcut. Move forward 3 spaces.', effect: { type: 'move', steps: 3 } },
      { id: 'pt-3', text: 'Too long admiring the view. Miss your next turn.', effect: { type: 'missTurn' } },
      { id: 'pt-4', text: 'Change of plans. Back to Start.', effect: { type: 'toStart' } },
    ],
    littleSurprises: [
      { id: 'ls-1', text: 'Kind note and 100 Memory Coins.', effect: { type: 'coins', amount: 100 } },
      { id: 'ls-2', text: 'Lost a small bet. Pay 50 Memory Coins.', effect: { type: 'coins', amount: -50 } },
    ],
  };
}

// Landing board: spaces 2–12 are all unowned, affordable Places,
// so the first roll (2–12) always lands in purchaseDecision.
function buyBoardConfig() {
  const spaces: Record<string, unknown>[] = [{ id: 'start', kind: 'start', name: 'Start' }];
  for (let i = 1; i <= 15; i += 1) {
    spaces.push({
      id: `place-${i}`,
      kind: 'place',
      name: `Place ${i}`,
      price: 50,
      rent: 5,
      category: `cat-${i % 3}`,
    });
  }
  spaces.push({ id: 'twist-1', kind: 'plot-twist', name: 'Plot Twist' });
  spaces.push({ id: 'surprise-1', kind: 'little-surprise', name: 'Little Surprise' });
  return {
    startCoins: 1500,
    passStartBonus: 200,
    taxAmount: 100,
    spaces,
    plotTwists: [{ id: 'pt-1', text: 'Gain 10.', effect: { type: 'coins', amount: 10 } }],
    littleSurprises: [{ id: 'ls-1', text: 'Gain 10.', effect: { type: 'coins', amount: 10 } }],
  };
}

async function createConfig(agent: AuthedAgent, spaceId: string, name: string, config: unknown) {
  return authed(agent).post(CONFIGS(spaceId), { name, config });
}

async function createGame(agent: AuthedAgent, spaceId: string, configId: string) {
  return authed(agent).post(GAMES(spaceId), {
    configId,
    player1: { name: 'Player One', token: 'star' },
    player2: { name: 'Player Two', token: 'moon' },
  });
}

describe('board configs: CRUD and shared access', () => {
  it('first GET seeds one default config; both members read it; either member may create', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['B A', 'B B']);
    const [a, b] = pair(agents);
    const first = await authed(a).get(CONFIGS(spaceId));
    expect(first.status).toBe(200);
    expect(first.body.data).toHaveLength(1);
    expect(first.body.data[0].isDefault).toBe(true);
    expect(first.body.data[0].authorId).toBe(a.user.id);
    expect(first.body.data[0].config.spaces).toHaveLength(20);
    expect(first.body.data[0].config.startCoins).toBe(1500);
    // The partner reads the same seeded config; no second seed.
    const partnerView = await authed(b).get(CONFIGS(spaceId));
    expect(partnerView.status).toBe(200);
    expect(partnerView.body.data).toHaveLength(1);
    expect(partnerView.body.data[0].id).toBe(first.body.data[0].id);
    // Either member may create; the list then holds both.
    const created = await createConfig(b, spaceId, 'Our Board', validConfig());
    expect(created.status).toBe(201);
    expect(created.body.data.isDefault).toBe(false);
    expect(created.body.data.authorId).toBe(b.user.id);
    expect((await authed(a).get(CONFIGS(spaceId))).body.data).toHaveLength(2);
    // Response items carry exactly the contract fields.
    expect(Object.keys(created.body.data).sort()).toEqual(
      ['authorId', 'config', 'createdAt', 'id', 'isDefault', 'name', 'spaceId', 'updatedAt'].sort(),
    );
  });

  it('author-only edit/delete: partner gets a generic 404; author edit and delete work', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['B C', 'B D']);
    const [a, b] = pair(agents);
    const created = await createConfig(a, spaceId, 'Mine', validConfig());
    const cid = created.body.data.id as string;
    expect((await authed(b).patch(`${CONFIGS(spaceId)}/${cid}`, { name: 'Hijacked?' })).status).toBe(404);
    expect((await authed(b).delete(`${CONFIGS(spaceId)}/${cid}`)).status).toBe(404);
    const patched = await authed(a).patch(`${CONFIGS(spaceId)}/${cid}`, { name: 'Mine, renamed' });
    expect(patched.status).toBe(200);
    expect(patched.body.data.name).toBe('Mine, renamed');
    expect(patched.body.data.config.startCoins).toBe(1500);
    // Empty patch is a 400, not a no-op.
    expect((await authed(a).patch(`${CONFIGS(spaceId)}/${cid}`, {})).status).toBe(400);
    expect((await authed(a).delete(`${CONFIGS(spaceId)}/${cid}`)).status).toBe(200);
    // Only the seeded default remains.
    const listed = await authed(a).get(CONFIGS(spaceId));
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0].isDefault).toBe(true);
  });

  it('non-member gets a generic 404 on board routes', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['B E', 'B F']);
    const [a] = pair(agents);
    const { agents: outsiders } = await createSpaceWithMembers(['B Out']);
    const [outsider] = outsiders as [AuthedAgent];
    expect((await authed(outsider).get(CONFIGS(spaceId))).status).toBe(404);
    expect((await authed(outsider).post(CONFIGS(spaceId), { name: 'X', config: validConfig() })).status).toBe(404);
    expect((await authed(outsider).get(`${BASE(spaceId)}/rules`)).status).toBe(404);
    expect(
      (await authed(outsider).post(GAMES(spaceId), {
        configId: 'nope',
        player1: { name: 'P1', token: 'star' },
        player2: { name: 'P2', token: 'moon' },
      })).status,
    ).toBe(404);
    // A member's rules read works (control).
    expect((await authed(a).get(`${BASE(spaceId)}/rules`)).status).toBe(200);
  });

  it('rules endpoint returns the engine rules text', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['B G', 'B H']);
    const [a] = pair(agents);
    const res = await authed(a).get(`${BASE(spaceId)}/rules`);
    expect(res.status).toBe(200);
    expect(typeof res.body.data.rules).toBe('string');
    expect(res.body.data.rules).toContain('Memory Coins');
    expect(res.body.data.rules).toContain('Plot Twist');
  });
});

describe('board configs: invalid configs are 400', () => {
  it('space count outside 16–24 is 400', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['B I', 'B J']);
    const [a] = pair(agents);
    const tooFew = validConfig();
    (tooFew as { spaces: unknown[] }).spaces = tooFew.spaces.slice(0, 15);
    expect((await createConfig(a, spaceId, 'Too few', tooFew)).status).toBe(400);
    const tooMany = validConfig();
    for (let i = 0; i < 7; i += 1) {
      (tooMany as { spaces: Record<string, unknown>[] }).spaces.push({
        id: `extra-${i}`, kind: 'place', name: `Extra ${i}`, price: 10, rent: 1, category: 'Extra',
      });
    }
    expect(tooMany.spaces).toHaveLength(25);
    expect((await createConfig(a, spaceId, 'Too many', tooMany)).status).toBe(400);
  });

  it('place price/rent/category violations are 400', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['B K', 'B L']);
    const [a] = pair(agents);
    const zeroPrice = validConfig();
    (zeroPrice.spaces[1] as Record<string, unknown>).price = 0;
    expect((await createConfig(a, spaceId, 'Zero price', zeroPrice)).status).toBe(400);
    const negRent = validConfig();
    (negRent.spaces[1] as Record<string, unknown>).rent = -1;
    expect((await createConfig(a, spaceId, 'Negative rent', negRent)).status).toBe(400);
    const noCategory = validConfig();
    delete (noCategory.spaces[1] as Record<string, unknown>).category;
    expect((await createConfig(a, spaceId, 'No category', noCategory)).status).toBe(400);
  });

  it('duplicate space ids, start not at index 0, and two starts are 400', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['B M', 'B N']);
    const [a] = pair(agents);
    const dup = validConfig();
    (dup.spaces[3] as Record<string, unknown>).id = 'cafe';
    expect((await createConfig(a, spaceId, 'Dup ids', dup)).status).toBe(400);
    const swapped = validConfig();
    const first = swapped.spaces[0];
    swapped.spaces[0] = swapped.spaces[1];
    swapped.spaces[1] = first;
    expect((await createConfig(a, spaceId, 'Start moved', swapped)).status).toBe(400);
    const twoStarts = validConfig();
    (twoStarts.spaces[2] as Record<string, unknown>).kind = 'start';
    expect((await createConfig(a, spaceId, 'Two starts', twoStarts)).status).toBe(400);
  });

  it('empty decks and negative coins/bonus/tax are 400', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['B O', 'B P']);
    const [a] = pair(agents);
    const noTwists = validConfig();
    (noTwists as { plotTwists: unknown[] }).plotTwists = [];
    expect((await createConfig(a, spaceId, 'No twists', noTwists)).status).toBe(400);
    const noSurprises = validConfig();
    (noSurprises as { littleSurprises: unknown[] }).littleSurprises = [];
    expect((await createConfig(a, spaceId, 'No surprises', noSurprises)).status).toBe(400);
    const negCoins = validConfig();
    (negCoins as { startCoins: number }).startCoins = -5;
    expect((await createConfig(a, spaceId, 'Negative coins', negCoins)).status).toBe(400);
    const negBonus = validConfig();
    (negBonus as { passStartBonus: number }).passStartBonus = -1;
    expect((await createConfig(a, spaceId, 'Negative bonus', negBonus)).status).toBe(400);
    const negTax = validConfig();
    (negTax as { taxAmount: number }).taxAmount = -1;
    expect((await createConfig(a, spaceId, 'Negative tax', negTax)).status).toBe(400);
  });

  it('unknown card effect type is 400 (engine trial is authoritative)', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['B Q', 'B R']);
    const [a] = pair(agents);
    const badEffect = validConfig();
    (badEffect.plotTwists[0] as Record<string, unknown>).effect = { type: 'teleport', steps: 5 };
    expect((await createConfig(a, spaceId, 'Bad effect', badEffect)).status).toBe(400);
    // A free-text effect from an editor is likewise rejected, not stored.
    const freeText = validConfig();
    (freeText.littleSurprises[0] as Record<string, unknown>).effect = { type: 'lose a turn please' };
    expect((await createConfig(a, spaceId, 'Free-text effect', freeText)).status).toBe(400);
  });

  it('blank/over-long name and unknown top-level fields are 400', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['B S', 'B T']);
    const [a] = pair(agents);
    expect((await createConfig(a, spaceId, '   ', validConfig())).status).toBe(400);
    expect((await createConfig(a, spaceId, 'x'.repeat(201), validConfig())).status).toBe(400);
    expect(
      (await authed(a).post(CONFIGS(spaceId), { name: 'Ok', config: validConfig(), authorId: 'someone-else' }))
        .status,
    ).toBe(400);
    // A patch to an invalid config is 400 and leaves the stored config untouched.
    const created = await createConfig(a, spaceId, 'Good', validConfig());
    const cid = created.body.data.id as string;
    const bad = validConfig();
    (bad as { startCoins: number }).startCoins = -1;
    expect((await authed(a).patch(`${CONFIGS(spaceId)}/${cid}`, { config: bad })).status).toBe(400);
    const listed = await authed(a).get(CONFIGS(spaceId));
    const stored = listed.body.data.find((c: { id: string }) => c.id === cid);
    expect(stored.config.startCoins).toBe(1500);
  });
});

describe('board configs: memory reward links', () => {
  it('bogus, other-space, and deleted memory links are 400; a valid same-space link is 201', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['B U', 'B V']);
    const [a] = pair(agents);
    const withLink = (memoryId: string) => {
      const cfg = validConfig();
      (cfg.spaces[2] as Record<string, unknown>).memoryId = memoryId;
      return cfg;
    };
    const bogus = '00000000-0000-0000-0000-000000000000';
    expect((await createConfig(a, spaceId, 'Bogus link', withLink(bogus))).status).toBe(400);
    const { spaceId: otherSpace, agents: otherAgents } = await createSpaceWithMembers(['B W']);
    const [other] = otherAgents as [AuthedAgent];
    const otherMemory = await prisma.memory.create({
      data: { spaceId: otherSpace, authorId: other.user.id, title: 'Not Yours Memory' },
    });
    const cross = await createConfig(a, spaceId, 'Cross link', withLink(otherMemory.id));
    expect(cross.status).toBe(400);
    expect(JSON.stringify(cross.body)).not.toContain('Not Yours Memory');
    const deleted = await prisma.memory.create({
      data: { spaceId, authorId: a.user.id, title: 'Gone Memory' },
    });
    await prisma.memory.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });
    expect((await createConfig(a, spaceId, 'Deleted link', withLink(deleted.id))).status).toBe(400);
    const good = await prisma.memory.create({
      data: { spaceId, authorId: a.user.id, title: 'Shared Memory' },
    });
    const ok = await createConfig(a, spaceId, 'Good link', withLink(good.id));
    expect(ok.status).toBe(201);
    expect(ok.body.data.config.spaces[2].memoryId).toBe(good.id);
  });
});

describe('board games: creation, reads, and snapshot isolation', () => {
  it('creation copies the config into the snapshot and embeds it in state verbatim', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['B X', 'B Y']);
    const [a, b] = pair(agents);
    const cfg = validConfig();
    const created = await createConfig(a, spaceId, 'Snapshot source', cfg);
    const cid = created.body.data.id as string;
    const game = await createGame(b, spaceId, cid);
    expect(game.status).toBe(201);
    expect(game.body.data.version).toBe(1);
    expect(game.body.data.status).toBe('playing');
    expect(game.body.data.configId).toBe(cid);
    expect(game.body.data.createdById).toBe(b.user.id);
    expect(game.body.data.configSnapshot).toEqual(cfg);
    // Worker A deviation, accommodated: GameState.config travels
    // verbatim with the state, and is part of GET responses.
    expect(game.body.data.state.config).toEqual(cfg);
    expect(game.body.data.state.players).toHaveLength(2);
    expect(game.body.data.state.players[0].coins).toBe(1500);
    expect(game.body.data.state.players[0].position).toBe(0);
    expect(game.body.data.state.turn).toBe(0);
    // Game envelope carries exactly the contract fields.
    expect(Object.keys(game.body.data).sort()).toEqual(
      ['configId', 'configSnapshot', 'createdAt', 'createdById', 'id', 'spaceId', 'state', 'status', 'updatedAt', 'version'].sort(),
    );
  });

  it('config from another space is 404; game creation rejects unknown fields and blank players', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['B Z', 'B AA']);
    const [a] = pair(agents);
    const { spaceId: otherSpace, agents: otherAgents } = await createSpaceWithMembers(['B AB']);
    const [other] = otherAgents as [AuthedAgent];
    const otherConfig = await createConfig(other, otherSpace, 'Elsewhere', validConfig());
    const otherCid = otherConfig.body.data.id as string;
    expect((await createGame(a, spaceId, otherCid)).status).toBe(404);
    const own = await createConfig(a, spaceId, 'Own', validConfig());
    const cid = own.body.data.id as string;
    expect(
      (
        await authed(a).post(GAMES(spaceId), {
          configId: cid,
          player1: { name: 'P1', token: 'star' },
          player2: { name: 'P2', token: 'moon' },
          state: { hacked: true },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await authed(a).post(GAMES(spaceId), {
          configId: cid,
          player1: { name: '   ', token: 'star' },
          player2: { name: 'P2', token: 'moon' },
        })
      ).status,
    ).toBe(400);
  });

  it('either member reads a game; non-member and other-space reads are 404', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['B AC', 'B AD']);
    const [a, b] = pair(agents);
    const created = await createConfig(a, spaceId, 'Shared game', validConfig());
    const game = await createGame(a, spaceId, created.body.data.id as string);
    const gid = game.body.data.id as string;
    expect((await authed(b).get(`${GAMES(spaceId)}/${gid}`)).status).toBe(200);
    expect((await authed(b).get(`${GAMES(spaceId)}/${gid}`)).body.data.id).toBe(gid);
    const { agents: outsiders } = await createSpaceWithMembers(['B AE']);
    const [outsider] = outsiders as [AuthedAgent];
    expect((await authed(outsider).get(`${GAMES(spaceId)}/${gid}`)).status).toBe(404);
    expect((await authed(a).get(`${GAMES(spaceId)}/00000000-0000-0000-0000-000000000000`)).status).toBe(404);
  });

  it('config edits after creation leave the game snapshot unchanged; deleting the config never deletes the game', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['B AF', 'B AG']);
    const [a] = pair(agents);
    const cfg = validConfig();
    const created = await createConfig(a, spaceId, 'Editable', cfg);
    const cid = created.body.data.id as string;
    const game = await createGame(a, spaceId, cid);
    const gid = game.body.data.id as string;
    const edited = validConfig();
    (edited as { startCoins: number }).startCoins = 999;
    (edited.spaces[1] as Record<string, unknown>).price = 5;
    const patched = await authed(a).patch(`${CONFIGS(spaceId)}/${cid}`, { config: edited });
    expect(patched.status).toBe(200);
    expect(patched.body.data.config.startCoins).toBe(999);
    const afterEdit = await authed(a).get(`${GAMES(spaceId)}/${gid}`);
    expect(afterEdit.status).toBe(200);
    expect(afterEdit.body.data.configSnapshot.startCoins).toBe(1500);
    expect(afterEdit.body.data.configSnapshot.spaces[1].price).toBe(80);
    expect(afterEdit.body.data.state.config.startCoins).toBe(1500);
    // Deleting the config leaves the running game intact (plain
    // id, no cascade).
    expect((await authed(a).delete(`${CONFIGS(spaceId)}/${cid}`)).status).toBe(200);
    const afterDelete = await authed(a).get(`${GAMES(spaceId)}/${gid}`);
    expect(afterDelete.status).toBe(200);
    expect(afterDelete.body.data.configId).toBe(cid);
  });

  it('restart creates a new game from the old snapshot; the old row is untouched', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['B AH', 'B AI']);
    const [a] = pair(agents);
    const created = await createConfig(a, spaceId, 'Restart source', buyBoardConfig());
    const game = await createGame(a, spaceId, created.body.data.id as string);
    const gid = game.body.data.id as string;
    const rolled = await authed(a).post(`${GAMES(spaceId)}/${gid}/actions`, {
      action: { type: 'roll', actor: 0 },
      expectedVersion: 1,
    });
    expect(rolled.status).toBe(200);
    expect(rolled.body.data.version).toBe(2);
    const restarted = await authed(a).post(`${GAMES(spaceId)}/${gid}/restart`, {
      player1: { name: 'Fresh One', token: 'cat' },
      player2: { name: 'Fresh Two', token: 'fox' },
    });
    expect(restarted.status).toBe(201);
    expect(restarted.body.data.id).not.toBe(gid);
    expect(restarted.body.data.version).toBe(1);
    expect(restarted.body.data.status).toBe('playing');
    expect(restarted.body.data.configSnapshot).toEqual(rolled.body.data.configSnapshot);
    expect(restarted.body.data.state.players[0].name).toBe('Fresh One');
    expect(restarted.body.data.state.players[0].position).toBe(0);
    // Old row untouched by the restart.
    const old = await authed(a).get(`${GAMES(spaceId)}/${gid}`);
    expect(old.body.data.version).toBe(2);
    expect(old.body.data.state).toEqual(rolled.body.data.state);
    // Restart of a missing game is 404; restart with a blank player is 400.
    expect(
      (await authed(a).post(`${GAMES(spaceId)}/00000000-0000-0000-0000-000000000000/restart`, {
        player1: { name: 'P1', token: 'star' },
        player2: { name: 'P2', token: 'moon' },
      })).status,
    ).toBe(404);
    expect(
      (await authed(a).post(`${GAMES(spaceId)}/${gid}/restart`, {
        player1: { name: '', token: 'star' },
        player2: { name: 'P2', token: 'moon' },
      })).status,
    ).toBe(400);
  });
});

describe('board games: actions, validation, and optimistic locking', () => {
  it('out-of-turn roll is 400 and the version does not move', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['B AJ', 'B AK']);
    const [a] = pair(agents);
    const created = await createConfig(a, spaceId, 'Turns', validConfig());
    const game = await createGame(a, spaceId, created.body.data.id as string);
    const gid = game.body.data.id as string;
    const res = await authed(a).post(`${GAMES(spaceId)}/${gid}/actions`, {
      action: { type: 'roll', actor: 1 },
      expectedVersion: 1,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('OUT_OF_TURN');
    expect((await authed(a).get(`${GAMES(spaceId)}/${gid}`)).body.data.version).toBe(1);
  });

  it('buy before rolling is 400 (wrong phase); a completed purchase followed by a second buy is 400', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['B AL', 'B AM']);
    const [a] = pair(agents);
    const created = await createConfig(a, spaceId, 'Buy flow', buyBoardConfig());
    const game = await createGame(a, spaceId, created.body.data.id as string);
    const gid = game.body.data.id as string;
    // No roll yet: buy is a wrong-phase 400.
    expect(
      (
        await authed(a).post(`${GAMES(spaceId)}/${gid}/actions`, {
          action: { type: 'buy', actor: 0 },
          expectedVersion: 1,
        })
      ).status,
    ).toBe(400);
    // First roll always lands on an unowned, affordable Place.
    const rolled = await authed(a).post(`${GAMES(spaceId)}/${gid}/actions`, {
      action: { type: 'roll', actor: 0 },
      expectedVersion: 1,
    });
    expect(rolled.status).toBe(200);
    expect(rolled.body.data.state.phase).toBe('purchaseDecision');
    const bought = await authed(a).post(`${GAMES(spaceId)}/${gid}/actions`, {
      action: { type: 'buy', actor: 0 },
      expectedVersion: 2,
    });
    expect(bought.status).toBe(200);
    expect(bought.body.data.state.phase).toBe('awaitingRoll');
    expect(bought.body.data.state.turn).toBe(1);
    // Second buy by the same actor: 400, version unmoved.
    expect(
      (
        await authed(a).post(`${GAMES(spaceId)}/${gid}/actions`, {
          action: { type: 'buy', actor: 0 },
          expectedVersion: 3,
        })
      ).status,
    ).toBe(400);
    expect((await authed(a).get(`${GAMES(spaceId)}/${gid}`)).body.data.version).toBe(3);
  });

  it('forged balance/position/ownership/state/dice fields in the action body are rejected by the strict schema', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['B AN', 'B AO']);
    const [a] = pair(agents);
    const created = await createConfig(a, spaceId, 'Forged', validConfig());
    const game = await createGame(a, spaceId, created.body.data.id as string);
    const gid = game.body.data.id as string;
    const url = `${GAMES(spaceId)}/${gid}/actions`;
    const forged = [
      { type: 'roll', actor: 0, balance: 99999 },
      { type: 'roll', actor: 0, coins: 99999 },
      { type: 'roll', actor: 0, balances: [99999, 0] },
      { type: 'roll', actor: 0, position: 5 },
      { type: 'roll', actor: 0, ownership: { cafe: 0 } },
      { type: 'roll', actor: 0, state: { coins: 99999 } },
      { type: 'roll', actor: 0, dice: [6, 6] },
      { type: 'roll', actor: 0, version: 99 },
      { type: 'roll', actor: 2 },
      { type: 'roll' },
    ];
    for (const action of forged) {
      expect((await authed(a).post(url, { action, expectedVersion: 1 })).status).toBe(400);
    }
    // A top-level smuggled state is rejected too, and nothing moved.
    expect(
      (await authed(a).post(url, { action: { type: 'roll', actor: 0 }, expectedVersion: 1, state: {} }))
        .status,
    ).toBe(400);
    expect((await authed(a).get(`${GAMES(spaceId)}/${gid}`)).body.data.version).toBe(1);
  });

  it('stale expectedVersion is 409 with a stale/version message; the game is unchanged', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['B AP', 'B AQ']);
    const [a] = pair(agents);
    const created = await createConfig(a, spaceId, 'Stale', validConfig());
    const game = await createGame(a, spaceId, created.body.data.id as string);
    const gid = game.body.data.id as string;
    const res = await authed(a).post(`${GAMES(spaceId)}/${gid}/actions`, {
      action: { type: 'roll', actor: 0 },
      expectedVersion: 99,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('STALE_VERSION');
    // UI mapping contract: the message contains "stale" and "version".
    expect(res.body.error.message).toContain('stale');
    expect(res.body.error.message).toContain('version');
    expect((await authed(a).get(`${GAMES(spaceId)}/${gid}`)).body.data.version).toBe(1);
  });

  it('two action POSTs with the same expectedVersion, run sequentially: one succeeds, one 409s', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['B AR', 'B AS']);
    const [a] = pair(agents);
    const created = await createConfig(a, spaceId, 'Conflict', validConfig());
    const game = await createGame(a, spaceId, created.body.data.id as string);
    const gid = game.body.data.id as string;
    const url = `${GAMES(spaceId)}/${gid}/actions`;
    const first = await authed(a).post(url, { action: { type: 'roll', actor: 0 }, expectedVersion: 1 });
    expect(first.status).toBe(200);
    expect(first.body.data.version).toBe(2);
    const second = await authed(a).post(url, { action: { type: 'roll', actor: 0 }, expectedVersion: 1 });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('STALE_VERSION');
    // Sequential, not real-time: the second writer lost because
    // the first already advanced the version.
    expect((await authed(a).get(`${GAMES(spaceId)}/${gid}`)).body.data.version).toBe(2);
  });

  it('action on a finished game is 400 GAME_FINISHED (via endEarly); GET still works', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['B AT', 'B AU']);
    const [a] = pair(agents);
    const created = await createConfig(a, spaceId, 'Finished', validConfig());
    const game = await createGame(a, spaceId, created.body.data.id as string);
    const gid = game.body.data.id as string;
    const ended = await authed(a).post(`${GAMES(spaceId)}/${gid}/actions`, {
      action: { type: 'endEarly', actor: 0 },
      expectedVersion: 1,
    });
    expect(ended.status).toBe(200);
    expect(ended.body.data.status).toBe('finished');
    expect(ended.body.data.state.status).toBe('finished');
    expect(ended.body.data.state.isDraw).toBe(true);
    const after = await authed(a).post(`${GAMES(spaceId)}/${gid}/actions`, {
      action: { type: 'roll', actor: 0 },
      expectedVersion: 2,
    });
    expect(after.status).toBe(400);
    expect(after.body.error.code).toBe('GAME_FINISHED');
    expect((await authed(a).get(`${GAMES(spaceId)}/${gid}`)).status).toBe(200);
  });

  it('save/restore: GET returns the exact state after actions', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['B AV', 'B AW']);
    const [a] = pair(agents);
    const created = await createConfig(a, spaceId, 'Restore', buyBoardConfig());
    const game = await createGame(a, spaceId, created.body.data.id as string);
    const gid = game.body.data.id as string;
    const rolled = await authed(a).post(`${GAMES(spaceId)}/${gid}/actions`, {
      action: { type: 'roll', actor: 0 },
      expectedVersion: 1,
    });
    expect(rolled.status).toBe(200);
    const bought = await authed(a).post(`${GAMES(spaceId)}/${gid}/actions`, {
      action: { type: 'buy', actor: 0 },
      expectedVersion: 2,
    });
    expect(bought.status).toBe(200);
    const restored = await authed(a).get(`${GAMES(spaceId)}/${gid}`);
    expect(restored.status).toBe(200);
    expect(restored.body.data.state).toEqual(bought.body.data.state);
    expect(restored.body.data.version).toBe(3);
    // The stored state still carries its board config verbatim.
    expect(restored.body.data.state.config).toEqual(buyBoardConfig());
  });

  it('action on a missing game is 404; unknown action type is 400', async () => {
    const { spaceId, agents } = await createSpaceWithMembers(['B AX', 'B AY']);
    const [a] = pair(agents);
    expect(
      (
        await authed(a).post(`${GAMES(spaceId)}/00000000-0000-0000-0000-000000000000/actions`, {
          action: { type: 'roll', actor: 0 },
          expectedVersion: 1,
        })
      ).status,
    ).toBe(404);
    const created = await createConfig(a, spaceId, 'Unknown action', validConfig());
    const game = await createGame(a, spaceId, created.body.data.id as string);
    const gid = game.body.data.id as string;
    expect(
      (
        await authed(a).post(`${GAMES(spaceId)}/${gid}/actions`, {
          action: { type: 'endTurn', actor: 0 },
          expectedVersion: 1,
        })
      ).status,
    ).toBe(400);
  });

  it('paying exactly to zero is not bankruptcy: tax equal to holdings leaves the player at zero but still playing', async () => {
    // Forced deterministically: every first-roll landing (spaces
    // 2–12) is a tax space, and the tax equals the starting coins.
    const { spaceId, agents } = await createSpaceWithMembers(['B AZ', 'B BA']);
    const [a] = pair(agents);
    const spaces: Record<string, unknown>[] = [{ id: 'start', kind: 'start', name: 'Start' }];
    spaces.push({ id: 'place-1', kind: 'place', name: 'Place 1', price: 50, rent: 5, category: 'cat' });
    for (let i = 2; i <= 12; i += 1) {
      spaces.push({ id: `tax-${i}`, kind: 'tax', name: `Tax ${i}` });
    }
    for (let i = 13; i <= 15; i += 1) {
      spaces.push({ id: `place-${i}`, kind: 'place', name: `Place ${i}`, price: 50, rent: 5, category: 'cat' });
    }
    spaces.push({ id: 'twist-1', kind: 'plot-twist', name: 'Plot Twist' });
    spaces.push({ id: 'surprise-1', kind: 'little-surprise', name: 'Little Surprise' });
    const cfg = {
      startCoins: 100,
      passStartBonus: 200,
      taxAmount: 100,
      spaces,
      plotTwists: [{ id: 'pt-1', text: 'Gain 10.', effect: { type: 'coins', amount: 10 } }],
      littleSurprises: [{ id: 'ls-1', text: 'Gain 10.', effect: { type: 'coins', amount: 10 } }],
    };
    const created = await createConfig(a, spaceId, 'Exact zero', cfg);
    expect(created.status).toBe(201);
    const game = await createGame(a, spaceId, created.body.data.id as string);
    const gid = game.body.data.id as string;
    const rolled = await authed(a).post(`${GAMES(spaceId)}/${gid}/actions`, {
      action: { type: 'roll', actor: 0 },
      expectedVersion: 1,
    });
    expect(rolled.status).toBe(200);
    // Owing exactly what they hold is NOT bankruptcy (engine
    // rule: bankruptcy only when owing MORE than held).
    expect(rolled.body.data.state.players[0].coins).toBe(0);
    expect(rolled.body.data.state.players[0].bankrupt).toBe(false);
    expect(rolled.body.data.state.status).toBe('playing');
    expect(rolled.body.data.status).toBe('playing');
    expect(rolled.body.data.state.winner).toBeNull();
  });
});
