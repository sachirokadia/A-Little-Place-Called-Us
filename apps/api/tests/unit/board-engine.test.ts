import { describe, expect, it } from 'vitest';
import {
  applyAction,
  BOARD_RULES_TEXT,
  createGame,
  DEFAULT_BOARD_CONFIG,
  type BoardConfigData,
  type GameState,
} from '@little-place/shared';

const PLAYERS = [
  { name: 'Player One', token: 'star' },
  { name: 'Player Two', token: 'moon' },
] as [{ name: string; token: string }, { name: string; token: string }];

const dice = (a: number, b: number) => () => [a, b] as [number, number];

function newGame(config: BoardConfigData = DEFAULT_BOARD_CONFIG): GameState {
  return createGame(config, PLAYERS);
}

/** Deep copy of a state with the given player placed and ready to roll. */
function placed(
  state: GameState,
  player: 0 | 1,
  position: number,
  coins?: number,
): GameState {
  const next: GameState = JSON.parse(JSON.stringify(state)) as GameState;
  next.turn = player;
  next.phase = 'awaitingRoll';
  next.players[player].position = position;
  if (coins !== undefined) next.players[player].coins = coins;
  return next;
}

function owned(state: GameState, spaceId: string, owner: 0 | 1 | null): GameState {
  const next: GameState = JSON.parse(JSON.stringify(state)) as GameState;
  next.owners[spaceId] = owner;
  return next;
}

function configCopy(): BoardConfigData {
  return JSON.parse(JSON.stringify(DEFAULT_BOARD_CONFIG)) as BoardConfigData;
}

describe('createGame and the default board', () => {
  it('starts both players on Start with the starting coins, turn 0, awaitingRoll', () => {
    const game = newGame();
    expect(game.version).toBe(1);
    expect(game.status).toBe('playing');
    expect(game.turn).toBe(0);
    expect(game.phase).toBe('awaitingRoll');
    expect(game.dice).toBeNull();
    expect(game.pendingTrade).toBeNull();
    expect(game.winner).toBeNull();
    expect(game.isDraw).toBe(false);
    expect(game.plotTwistIndex).toBe(0);
    expect(game.littleSurpriseIndex).toBe(0);
    for (const player of game.players) {
      expect(player.position).toBe(0);
      expect(player.coins).toBe(1500);
      expect(player.missTurns).toBe(0);
      expect(player.bankrupt).toBe(false);
    }
    expect(Object.values(game.owners)).toHaveLength(12);
    expect(Object.values(game.owners).every((owner) => owner === null)).toBe(true);
  });

  it('default board: 20 spaces, 12 Places in 4 categories of 3, 2 + 2 card spaces, 1 tax / rest / miss-turn', () => {
    const { spaces } = DEFAULT_BOARD_CONFIG;
    expect(spaces).toHaveLength(20);
    expect(spaces[0].kind).toBe('start');
    const places = spaces.filter((space) => space.kind === 'place');
    expect(places).toHaveLength(12);
    const byCategory = new Map<string, number>();
    for (const place of places) {
      byCategory.set(place.category ?? '', (byCategory.get(place.category ?? '') ?? 0) + 1);
    }
    expect([...byCategory.values()].sort()).toEqual([3, 3, 3, 3]);
    expect(spaces.filter((space) => space.kind === 'plot-twist')).toHaveLength(2);
    expect(spaces.filter((space) => space.kind === 'little-surprise')).toHaveLength(2);
    expect(spaces.filter((space) => space.kind === 'tax')).toHaveLength(1);
    expect(spaces.filter((space) => space.kind === 'rest')).toHaveLength(1);
    expect(spaces.filter((space) => space.kind === 'miss-turn')).toHaveLength(1);
    expect(DEFAULT_BOARD_CONFIG.plotTwists).toHaveLength(6);
    expect(DEFAULT_BOARD_CONFIG.littleSurprises).toHaveLength(6);
    expect(DEFAULT_BOARD_CONFIG.startCoins).toBe(1500);
    expect(DEFAULT_BOARD_CONFIG.passStartBonus).toBe(200);
    expect(DEFAULT_BOARD_CONFIG.taxAmount).toBe(100);
    for (const place of places) {
      expect(place.price).toBeGreaterThanOrEqual(60);
      expect(place.price).toBeLessThanOrEqual(300);
      expect(place.rent).toBeGreaterThanOrEqual((place.price ?? 0) * 0.1);
      expect(place.rent).toBeLessThanOrEqual((place.price ?? 0) * 0.2);
    }
  });

  it('rejects a game with anything other than exactly two players', () => {
    expect(() =>
      createGame(DEFAULT_BOARD_CONFIG, [{ name: 'Solo', token: 'star' }] as never),
    ).toThrow();
  });
});

describe('movement, wrapping, and the pass-Start bonus', () => {
  it('a roll moves by the dice sum and lands on the matching space', () => {
    const game = applyAction(newGame(), { actor: 0, type: 'roll' }, dice(1, 2));
    expect(game.dice).toEqual([1, 2]);
    // 0 + 3 = The Corner Bookshop, unowned and affordable: purchaseDecision, turn stays.
    expect(game.players[0].position).toBe(3);
    expect(game.phase).toBe('purchaseDecision');
    expect(game.turn).toBe(0);
  });

  it('wraps past Start and pays the pass-Start bonus once per roll', () => {
    const start = placed(newGame(), 0, 18);
    const game = applyAction(start, { actor: 0, type: 'roll' }, dice(1, 2));
    expect(game.players[0].position).toBe(1);
    expect(game.players[0].coins).toBe(1700);
    expect(game.phase).toBe('purchaseDecision');
  });

  it('landing exactly on Start pays the bonus once', () => {
    const start = placed(newGame(), 0, 17);
    const game = applyAction(start, { actor: 0, type: 'roll' }, dice(1, 2));
    expect(game.players[0].position).toBe(0);
    expect(game.players[0].coins).toBe(1700);
    expect(game.phase).toBe('awaitingRoll');
    expect(game.turn).toBe(1);
  });

  it('a roll with no rng uses two fair dice in range and moves by their sum', () => {
    const game = applyAction(newGame(), { actor: 0, type: 'roll' });
    expect(game.dice).not.toBeNull();
    const [a, b] = game.dice as [number, number];
    expect(a).toBeGreaterThanOrEqual(1);
    expect(a).toBeLessThanOrEqual(6);
    expect(b).toBeGreaterThanOrEqual(1);
    expect(b).toBeLessThanOrEqual(6);
    expect(game.players[0].position).toBe(a + b);
  });
});

describe('buying Places', () => {
  it('landing on an unowned affordable Place waits for a buy / pass choice without advancing the turn', () => {
    const game = applyAction(newGame(), { actor: 0, type: 'roll' }, dice(1, 2));
    expect(game.phase).toBe('purchaseDecision');
    expect(game.turn).toBe(0);
  });

  it('buy deducts the price, sets the owner, and advances the turn', () => {
    const rolled = applyAction(newGame(), { actor: 0, type: 'roll' }, dice(1, 2));
    const game = applyAction(rolled, { actor: 0, type: 'buy' });
    expect(game.owners['corner-bookshop']).toBe(0);
    expect(game.players[0].coins).toBe(1400);
    expect(game.phase).toBe('awaitingRoll');
    expect(game.turn).toBe(1);
  });

  it('passPurchase advances the turn without buying', () => {
    const rolled = applyAction(newGame(), { actor: 0, type: 'roll' }, dice(1, 2));
    const game = applyAction(rolled, { actor: 0, type: 'passPurchase' });
    expect(game.owners['corner-bookshop']).toBeNull();
    expect(game.players[0].coins).toBe(1500);
    expect(game.phase).toBe('awaitingRoll');
    expect(game.turn).toBe(1);
  });

  it('buying a Place you already own throws DOUBLE_PURCHASE', () => {
    const state = owned(newGame(), 'corner-bookshop', 0);
    const crafted: GameState = { ...placed(state, 0, 3), phase: 'purchaseDecision' };
    expect(() => applyAction(crafted, { actor: 0, type: 'buy' })).toThrow(/DOUBLE_PURCHASE/);
  });

  it('buying a Place owned by the other player throws ALREADY_OWNED', () => {
    const state = owned(newGame(), 'corner-bookshop', 1);
    const crafted: GameState = { ...placed(state, 0, 3), phase: 'purchaseDecision' };
    expect(() => applyAction(crafted, { actor: 0, type: 'buy' })).toThrow(/ALREADY_OWNED/);
  });

  it('buying a non-Place space throws NOT_FOR_SALE', () => {
    const crafted: GameState = { ...placed(newGame(), 0, 0), phase: 'purchaseDecision' };
    expect(() => applyAction(crafted, { actor: 0, type: 'buy' })).toThrow(/NOT_FOR_SALE/);
  });

  it('buying without enough coins throws CANNOT_AFFORD', () => {
    const crafted: GameState = { ...placed(newGame(), 0, 3, 50), phase: 'purchaseDecision' };
    expect(() => applyAction(crafted, { actor: 0, type: 'buy' })).toThrow(/CANNOT_AFFORD/);
  });

  it('landing on a Place you cannot afford resolves as nothing and advances the turn', () => {
    const start = placed(newGame(), 0, 0, 50);
    const game = applyAction(start, { actor: 0, type: 'roll' }, dice(1, 2));
    expect(game.players[0].position).toBe(3);
    expect(game.players[0].coins).toBe(50);
    expect(game.phase).toBe('awaitingRoll');
    expect(game.turn).toBe(1);
  });
});

describe('rent', () => {
  it('landing on the other player\'s Place pays normal rent', () => {
    const start = owned(newGame(), 'corner-bookshop', 1);
    const game = applyAction(start, { actor: 0, type: 'roll' }, dice(1, 2));
    expect(game.players[0].coins).toBe(1485);
    expect(game.players[1].coins).toBe(1515);
    expect(game.turn).toBe(1);
  });

  it('rent doubles when the owner holds every Place in the category', () => {
    let start = newGame();
    start = owned(start, 'cafe-corner', 1);
    start = owned(start, 'corner-bookshop', 1);
    start = owned(start, 'sunday-market', 1);
    const game = applyAction(start, { actor: 0, type: 'roll' }, dice(1, 2));
    expect(game.players[0].coins).toBe(1470);
    expect(game.players[1].coins).toBe(1530);
  });

  it('rent does not double when the owner holds only part of the category', () => {
    let start = newGame();
    start = owned(start, 'cafe-corner', 1);
    start = owned(start, 'corner-bookshop', 1);
    const game = applyAction(start, { actor: 0, type: 'roll' }, dice(1, 2));
    expect(game.players[0].coins).toBe(1485);
    expect(game.players[1].coins).toBe(1515);
  });

  it('rent the payer cannot fully pay bankrupts them: they pay all they have, lose their Places, and the other wins', () => {
    let start = owned(newGame(), 'corner-bookshop', 1);
    start = owned(start, 'cafe-corner', 0);
    start = placed(start, 0, 0, 10);
    const game = applyAction(start, { actor: 0, type: 'roll' }, dice(1, 2));
    expect(game.players[0].coins).toBe(0);
    expect(game.players[0].bankrupt).toBe(true);
    expect(game.players[1].coins).toBe(1510);
    expect(game.owners['cafe-corner']).toBeNull();
    expect(game.owners['corner-bookshop']).toBe(1);
    expect(game.status).toBe('finished');
    expect(game.phase).toBe('finished');
    expect(game.winner).toBe(1);
  });

  it('paying rent exactly equal to all coins held is not bankruptcy', () => {
    const start = placed(owned(newGame(), 'corner-bookshop', 1), 0, 0, 15);
    const game = applyAction(start, { actor: 0, type: 'roll' }, dice(1, 2));
    expect(game.players[0].coins).toBe(0);
    expect(game.players[0].bankrupt).toBe(false);
    expect(game.status).toBe('playing');
    expect(game.turn).toBe(1);
  });

  it('landing on your own Place does nothing', () => {
    const start = owned(newGame(), 'corner-bookshop', 0);
    const game = applyAction(start, { actor: 0, type: 'roll' }, dice(1, 2));
    expect(game.players[0].coins).toBe(1500);
    expect(game.phase).toBe('awaitingRoll');
    expect(game.turn).toBe(1);
  });
});

describe('tax, rest, and miss-turn spaces', () => {
  it('a tax space deducts the tax amount', () => {
    const start = placed(newGame(), 0, 4);
    const game = applyAction(start, { actor: 0, type: 'roll' }, dice(1, 2));
    expect(game.players[0].position).toBe(7);
    expect(game.players[0].coins).toBe(1400);
    expect(game.turn).toBe(1);
  });

  it('tax owed beyond coins held bankrupts the player', () => {
    let start = placed(newGame(), 0, 4, 50);
    start = owned(start, 'cafe-corner', 0);
    const game = applyAction(start, { actor: 0, type: 'roll' }, dice(1, 2));
    expect(game.players[0].coins).toBe(0);
    expect(game.players[0].bankrupt).toBe(true);
    expect(game.owners['cafe-corner']).toBeNull();
    expect(game.status).toBe('finished');
    expect(game.winner).toBe(1);
  });

  it('tax exactly equal to all coins held is not bankruptcy', () => {
    const start = placed(newGame(), 0, 4, 100);
    const game = applyAction(start, { actor: 0, type: 'roll' }, dice(1, 2));
    expect(game.players[0].coins).toBe(0);
    expect(game.players[0].bankrupt).toBe(false);
    expect(game.status).toBe('playing');
  });

  it('a rest space does nothing', () => {
    const start = placed(newGame(), 0, 7);
    const game = applyAction(start, { actor: 0, type: 'roll' }, dice(1, 2));
    expect(game.players[0].position).toBe(10);
    expect(game.players[0].coins).toBe(1500);
    expect(game.turn).toBe(1);
  });

  it('a miss-turn space sets missTurns and advances the turn', () => {
    const start = placed(newGame(), 0, 14);
    const game = applyAction(start, { actor: 0, type: 'roll' }, dice(1, 2));
    expect(game.players[0].position).toBe(17);
    expect(game.players[0].missTurns).toBe(1);
    expect(game.turn).toBe(1);
  });

  it('a roll from a player with a miss-turn is spent skipping: no move, counter drops, turn passes', () => {
    const state = placed(newGame(), 0, 5);
    state.players[0].missTurns = 1;
    const game = applyAction(state, { actor: 0, type: 'roll' }, dice(6, 6));
    expect(game.players[0].position).toBe(5);
    expect(game.players[0].missTurns).toBe(0);
    expect(game.dice).toBeNull();
    expect(game.turn).toBe(1);
  });
});

describe('Plot Twist and Little Surprise cards', () => {
  it('a Plot Twist coins card gains coins and advances the deck index', () => {
    const game = applyAction(newGame(), { actor: 0, type: 'roll' }, dice(1, 1));
    expect(game.players[0].position).toBe(2);
    expect(game.players[0].coins).toBe(1650);
    expect(game.plotTwistIndex).toBe(1);
    expect(game.turn).toBe(1);
  });

  it('a Plot Twist coins card can take coins', () => {
    const state = placed(newGame(), 0, 0);
    state.plotTwistIndex = 1;
    const game = applyAction(state, { actor: 0, type: 'roll' }, dice(1, 1));
    expect(game.players[0].coins).toBe(1420);
    expect(game.plotTwistIndex).toBe(2);
  });

  it('a move card moves the piece but does not trigger the space landed on', () => {
    const state = placed(newGame(), 0, 0);
    state.plotTwistIndex = 2;
    const game = applyAction(state, { actor: 0, type: 'roll' }, dice(1, 1));
    expect(game.players[0].position).toBe(5);
    expect(game.littleSurpriseIndex).toBe(0);
    expect(game.players[0].coins).toBe(1500);
    expect(game.turn).toBe(1);
  });

  it('a backwards move card moves back without any pass-Start bonus', () => {
    const state = placed(newGame(), 0, 0);
    state.plotTwistIndex = 3;
    const game = applyAction(state, { actor: 0, type: 'roll' }, dice(1, 1));
    expect(game.players[0].position).toBe(0);
    expect(game.players[0].coins).toBe(1500);
  });

  it('a missTurn card sets missTurns', () => {
    const state = placed(newGame(), 0, 0);
    state.plotTwistIndex = 4;
    const game = applyAction(state, { actor: 0, type: 'roll' }, dice(1, 1));
    expect(game.players[0].missTurns).toBe(1);
    expect(game.turn).toBe(1);
  });

  it('a toStart card moves to Start and pays the pass-Start bonus once', () => {
    const state = placed(newGame(), 0, 0);
    state.plotTwistIndex = 5;
    const game = applyAction(state, { actor: 0, type: 'roll' }, dice(1, 1));
    expect(game.players[0].position).toBe(0);
    expect(game.players[0].coins).toBe(1700);
  });

  it('a Little Surprise space draws from the Little Surprise deck, not the Plot Twist deck', () => {
    const start = placed(newGame(), 0, 3);
    const game = applyAction(start, { actor: 0, type: 'roll' }, dice(1, 1));
    expect(game.players[0].position).toBe(5);
    expect(game.players[0].coins).toBe(1600);
    expect(game.littleSurpriseIndex).toBe(1);
    expect(game.plotTwistIndex).toBe(0);
  });

  it('decks wrap around: after the last card the next draw is the first card again', () => {
    const first = placed(newGame(), 0, 0);
    first.plotTwistIndex = 5;
    const afterLast = applyAction(first, { actor: 0, type: 'roll' }, dice(1, 1));
    expect(afterLast.plotTwistIndex).toBe(0);
    expect(afterLast.players[0].coins).toBe(1700);
    const second = applyAction(afterLast, { actor: 1, type: 'roll' }, dice(1, 1));
    expect(second.players[1].coins).toBe(1650);
    expect(second.plotTwistIndex).toBe(1);
  });

  it('a coins card owed beyond coins held bankrupts the player', () => {
    let state = placed(newGame(), 0, 0, 50);
    state = owned(state, 'cafe-corner', 0);
    state.plotTwistIndex = 1;
    const game = applyAction(state, { actor: 0, type: 'roll' }, dice(1, 1));
    expect(game.players[0].coins).toBe(0);
    expect(game.players[0].bankrupt).toBe(true);
    expect(game.owners['cafe-corner']).toBeNull();
    expect(game.status).toBe('finished');
    expect(game.winner).toBe(1);
  });

  it('a move card that wraps past Start pays the pass-Start bonus', () => {
    const custom: BoardConfigData = {
      ...configCopy(),
      plotTwists: [
        { id: 'big-move', text: 'Move forward 10 spaces.', effect: { type: 'move', steps: 10 } },
      ],
    };
    const start = placed(newGame(custom), 0, 10);
    const game = applyAction(start, { actor: 0, type: 'roll' }, dice(1, 1));
    expect(game.players[0].position).toBe(2);
    expect(game.players[0].coins).toBe(1700);
    expect(game.plotTwistIndex).toBe(0);
  });
});

describe('trading', () => {
  function tradeSetup(): GameState {
    let state = newGame();
    state = owned(state, 'corner-bookshop', 0);
    state = owned(state, 'cafe-corner', 1);
    return state;
  }

  it('proposeTrade waits for an answer, keeps the turn, and does not move anything yet', () => {
    const game = applyAction(tradeSetup(), {
      actor: 0, type: 'proposeTrade', giveSpaceIds: ['corner-bookshop'], giveCoins: 50, wantSpaceIds: ['cafe-corner'], wantCoins: 20,
    });
    expect(game.phase).toBe('tradeOffer');
    expect(game.turn).toBe(0);
    expect(game.pendingTrade).toEqual({
      from: 0, to: 1, giveSpaceIds: ['corner-bookshop'], giveCoins: 50, wantSpaceIds: ['cafe-corner'], wantCoins: 20,
    });
    expect(game.owners['corner-bookshop']).toBe(0);
    expect(game.players[0].coins).toBe(1500);
  });

  it('accept transfers Places and coins in both directions and does not consume the turn', () => {
    const proposed = applyAction(tradeSetup(), {
      actor: 0, type: 'proposeTrade', giveSpaceIds: ['corner-bookshop'], giveCoins: 50, wantSpaceIds: ['cafe-corner'], wantCoins: 20,
    });
    const game = applyAction(proposed, { actor: 1, type: 'respondTrade', accept: true });
    expect(game.owners['corner-bookshop']).toBe(1);
    expect(game.owners['cafe-corner']).toBe(0);
    expect(game.players[0].coins).toBe(1470);
    expect(game.players[1].coins).toBe(1530);
    expect(game.pendingTrade).toBeNull();
    expect(game.phase).toBe('awaitingRoll');
    expect(game.turn).toBe(0);
    const rolled = applyAction(game, { actor: 0, type: 'roll' }, dice(1, 1));
    expect(rolled.turn).toBe(1);
  });

  it('decline cancels the trade, changes nothing, and leaves the turn alone', () => {
    const proposed = applyAction(tradeSetup(), {
      actor: 0, type: 'proposeTrade', giveSpaceIds: ['corner-bookshop'], giveCoins: 50, wantSpaceIds: ['cafe-corner'], wantCoins: 0,
    });
    const game = applyAction(proposed, { actor: 1, type: 'respondTrade', accept: false });
    expect(game.pendingTrade).toBeNull();
    expect(game.phase).toBe('awaitingRoll');
    expect(game.turn).toBe(0);
    expect(game.owners['corner-bookshop']).toBe(0);
    expect(game.owners['cafe-corner']).toBe(1);
    expect(game.players[0].coins).toBe(1500);
  });

  it('proposing a Place you do not own throws INVALID_TRADE', () => {
    expect(() =>
      applyAction(tradeSetup(), {
        actor: 0, type: 'proposeTrade', giveSpaceIds: ['cafe-corner'], giveCoins: 0, wantSpaceIds: [], wantCoins: 0,
      }),
    ).toThrow(/INVALID_TRADE/);
  });

  it('an empty trade throws INVALID_TRADE', () => {
    expect(() =>
      applyAction(newGame(), {
        actor: 0, type: 'proposeTrade', giveSpaceIds: [], giveCoins: 0, wantSpaceIds: [], wantCoins: 0,
      }),
    ).toThrow(/INVALID_TRADE/);
  });

  it('negative coins or coins beyond holdings throw INVALID_TRADE', () => {
    expect(() =>
      applyAction(newGame(), {
        actor: 0, type: 'proposeTrade', giveSpaceIds: [], giveCoins: -5, wantSpaceIds: ['cafe-corner'], wantCoins: 0,
      }),
    ).toThrow(/INVALID_TRADE/);
    expect(() =>
      applyAction(newGame(), {
        actor: 0, type: 'proposeTrade', giveSpaceIds: [], giveCoins: 99999, wantSpaceIds: ['cafe-corner'], wantCoins: 0,
      }),
    ).toThrow(/INVALID_TRADE/);
  });

  it('proposing out of turn throws OUT_OF_TURN', () => {
    expect(() =>
      applyAction(newGame(), {
        actor: 1, type: 'proposeTrade', giveSpaceIds: [], giveCoins: 10, wantSpaceIds: [], wantCoins: 0,
      }),
    ).toThrow(/OUT_OF_TURN/);
  });

  it('proposing while a purchase decision waits throws WRONG_PHASE', () => {
    const rolled = applyAction(newGame(), { actor: 0, type: 'roll' }, dice(1, 2));
    expect(rolled.phase).toBe('purchaseDecision');
    expect(() =>
      applyAction(rolled, {
        actor: 0, type: 'proposeTrade', giveSpaceIds: [], giveCoins: 10, wantSpaceIds: [], wantCoins: 0,
      }),
    ).toThrow(/WRONG_PHASE/);
  });

  it('answering with no trade pending throws TRADE_NOT_PENDING', () => {
    expect(() => applyAction(newGame(), { actor: 1, type: 'respondTrade', accept: true })).toThrow(
      /TRADE_NOT_PENDING/,
    );
  });

  it('answering your own proposal throws NOT_YOUR_TURN', () => {
    const proposed = applyAction(tradeSetup(), {
      actor: 0, type: 'proposeTrade', giveSpaceIds: ['corner-bookshop'], giveCoins: 0, wantSpaceIds: ['cafe-corner'], wantCoins: 0,
    });
    expect(() => applyAction(proposed, { actor: 0, type: 'respondTrade', accept: true })).toThrow(
      /NOT_YOUR_TURN/,
    );
  });

  it('accept re-validates: if the proposer no longer owns the offered Place, accept throws INVALID_TRADE and changes nothing', () => {
    const proposed = applyAction(tradeSetup(), {
      actor: 0, type: 'proposeTrade', giveSpaceIds: ['corner-bookshop'], giveCoins: 0, wantSpaceIds: ['cafe-corner'], wantCoins: 0,
    });
    const tampered = owned(proposed, 'corner-bookshop', null);
    expect(() => applyAction(tampered, { actor: 1, type: 'respondTrade', accept: true })).toThrow(
      /INVALID_TRADE/,
    );
    expect(tampered.pendingTrade).not.toBeNull();
    expect(tampered.owners['corner-bookshop']).toBeNull();
  });

  it('rolling while a trade waits throws WRONG_PHASE', () => {
    const proposed = applyAction(tradeSetup(), {
      actor: 0, type: 'proposeTrade', giveSpaceIds: ['corner-bookshop'], giveCoins: 0, wantSpaceIds: ['cafe-corner'], wantCoins: 0,
    });
    expect(() => applyAction(proposed, { actor: 0, type: 'roll' }, dice(1, 1))).toThrow(/WRONG_PHASE/);
  });
});

describe('turn order, phases, and ending the game', () => {
  it('rolling out of turn throws OUT_OF_TURN', () => {
    expect(() => applyAction(newGame(), { actor: 1, type: 'roll' }, dice(1, 1))).toThrow(/OUT_OF_TURN/);
  });

  it('rolling while a purchase decision waits throws WRONG_PHASE', () => {
    const rolled = applyAction(newGame(), { actor: 0, type: 'roll' }, dice(1, 2));
    expect(() => applyAction(rolled, { actor: 0, type: 'roll' }, dice(1, 1))).toThrow(/WRONG_PHASE/);
  });

  it('endEarly crowns the player holding more coins', () => {
    let state = placed(newGame(), 0, 0, 1600);
    state.players[1].coins = 1400;
    const game = applyAction(state, { actor: 0, type: 'endEarly' });
    expect(game.status).toBe('finished');
    expect(game.phase).toBe('finished');
    expect(game.winner).toBe(0);
    expect(game.isDraw).toBe(false);
  });

  it('endEarly with equal coins is a draw with no winner', () => {
    const game = applyAction(newGame(), { actor: 0, type: 'endEarly' });
    expect(game.status).toBe('finished');
    expect(game.winner).toBeNull();
    expect(game.isDraw).toBe(true);
  });

  it('endEarly out of turn throws OUT_OF_TURN and while a purchase waits throws WRONG_PHASE', () => {
    expect(() => applyAction(newGame(), { actor: 1, type: 'endEarly' })).toThrow(/OUT_OF_TURN/);
    const rolled = applyAction(newGame(), { actor: 0, type: 'roll' }, dice(1, 2));
    expect(() => applyAction(rolled, { actor: 0, type: 'endEarly' })).toThrow(/WRONG_PHASE/);
  });

  it('a finished game rejects further actions with GAME_FINISHED', () => {
    const finished = applyAction(newGame(), { actor: 0, type: 'endEarly' });
    expect(() => applyAction(finished, { actor: 0, type: 'roll' }, dice(1, 1))).toThrow(/GAME_FINISHED/);
    expect(() => applyAction(finished, { actor: 0, type: 'buy' })).toThrow(/GAME_FINISHED/);
    expect(() => applyAction(finished, { actor: 0, type: 'endEarly' })).toThrow(/GAME_FINISHED/);
  });
});

describe('invalid board configs', () => {
  it('rejects fewer than 16 spaces', () => {
    const config = configCopy();
    config.spaces = config.spaces.slice(0, 10);
    expect(() => createGame(config, PLAYERS)).toThrow(/between 16 and 24/);
  });

  it('rejects more than 24 spaces', () => {
    const config = configCopy();
    config.spaces = [...config.spaces, ...config.spaces.slice(0, 5)];
    expect(() => createGame(config, PLAYERS)).toThrow(/between 16 and 24/);
  });

  it('rejects a start space that is not at index 0', () => {
    const config = configCopy();
    [config.spaces[0], config.spaces[1]] = [config.spaces[1], config.spaces[0]];
    expect(() => createGame(config, PLAYERS)).toThrow(/index 0/);
  });

  it('rejects more than one start space', () => {
    const config = configCopy();
    config.spaces[1].kind = 'start';
    expect(() => createGame(config, PLAYERS)).toThrow(/exactly one start/);
  });

  it('rejects a Place without a price greater than 0', () => {
    const config = configCopy();
    delete config.spaces[1].price;
    expect(() => createGame(config, PLAYERS)).toThrow(/price greater than 0/);
  });

  it('rejects a Place with negative rent', () => {
    const config = configCopy();
    config.spaces[1].rent = -5;
    expect(() => createGame(config, PLAYERS)).toThrow(/rent of 0 or more/);
  });

  it('rejects a Place without a category', () => {
    const config = configCopy();
    delete config.spaces[1].category;
    expect(() => createGame(config, PLAYERS)).toThrow(/category/);
  });

  it('rejects duplicate Place ids', () => {
    const config = configCopy();
    config.spaces[3].id = config.spaces[1].id;
    expect(() => createGame(config, PLAYERS)).toThrow(/duplicate space id/);
  });

  it('rejects an empty Plot Twist deck', () => {
    const config = configCopy();
    config.plotTwists = [];
    expect(() => createGame(config, PLAYERS)).toThrow(/at least one Plot Twist/);
  });

  it('rejects an empty Little Surprise deck', () => {
    const config = configCopy();
    config.littleSurprises = [];
    expect(() => createGame(config, PLAYERS)).toThrow(/at least one Little Surprise/);
  });

  it('rejects negative startCoins, passStartBonus, and taxAmount', () => {
    const a = configCopy();
    a.startCoins = -1;
    expect(() => createGame(a, PLAYERS)).toThrow(/startCoins/);
    const b = configCopy();
    b.passStartBonus = -1;
    expect(() => createGame(b, PLAYERS)).toThrow(/passStartBonus/);
    const c = configCopy();
    c.taxAmount = -1;
    expect(() => createGame(c, PLAYERS)).toThrow(/taxAmount/);
  });
});

describe('purity', () => {
  it('a roll never mutates its input', () => {
    const game = newGame();
    const snapshot = JSON.stringify(game);
    const result = applyAction(game, { actor: 0, type: 'roll' }, dice(1, 2));
    expect(JSON.stringify(game)).toBe(snapshot);
    expect(result).not.toBe(game);
    expect(result.players[0].position).not.toBe(game.players[0].position);
  });

  it('a buy never mutates its input', () => {
    const rolled = applyAction(newGame(), { actor: 0, type: 'roll' }, dice(1, 2));
    const snapshot = JSON.stringify(rolled);
    const result = applyAction(rolled, { actor: 0, type: 'buy' });
    expect(JSON.stringify(rolled)).toBe(snapshot);
    expect(result.owners['corner-bookshop']).toBe(0);
    expect(rolled.owners['corner-bookshop']).toBeNull();
  });
});

describe('rules text', () => {
  it('covers every rules topic and matches the implemented behaviour', () => {
    for (const topic of [
      'Setup',
      'Turn order and dice',
      'Passing Start',
      'Buying Places',
      'Rent and owning a whole category',
      'Plot Twists and Little Surprises',
      'Tax, rest, and miss-turn spaces',
      'Trading',
      'Bankruptcy',
      'Ending the game early',
      'Restart and new games',
    ]) {
      expect(BOARD_RULES_TEXT).toContain(topic);
    }
    expect(BOARD_RULES_TEXT).toContain('Doubles have no special effect');
    expect(BOARD_RULES_TEXT).toContain('does not use up your turn');
    expect(BOARD_RULES_TEXT).toContain('only when you owe more than you hold');
  });
});

describe('reconciliation: unknown space kinds are rejected, never silently treated as a card draw', () => {
  it('rejects a camelCase kind from an older editor draft', () => {
    const config = JSON.parse(JSON.stringify(DEFAULT_BOARD_CONFIG)) as BoardConfigData;
    const space = config.spaces.find((s) => s.kind === 'plot-twist')!;
    (space as { kind: string }).kind = 'plotTwist';
    expect(() => createGame(config, [{ name: 'A', token: 'A' }, { name: 'B', token: 'B' }])).toThrow(/unknown kind/);
  });

  it('rejects a wholly unknown kind', () => {
    const config = JSON.parse(JSON.stringify(DEFAULT_BOARD_CONFIG)) as BoardConfigData;
    (config.spaces[1] as { kind: string }).kind = 'mystery-portal';
    expect(() => createGame(config, [{ name: 'A', token: 'A' }, { name: 'B', token: 'B' }])).toThrow(/unknown kind/);
  });
});

describe('reconciliation: lastCard for the scrapbook event card (D2 fix)', () => {
  it('a card draw records lastCard with the drawn card text', () => {
    // Default board index 2 is a Plot Twist space; a roll of 1+1 lands on it.
    const game = applyAction(newGame(), { actor: 0, type: 'roll' }, dice(1, 1));
    expect(game.lastCard).not.toBeNull();
    expect(game.lastCard!.deck).toBe('plot-twist');
    expect(game.lastCard!.text).toBe(DEFAULT_BOARD_CONFIG.plotTwists[0]!.text);
    expect(game.lastCard!.cardId).toBe(DEFAULT_BOARD_CONFIG.plotTwists[0]!.id);
  });

  it('the next roll clears lastCard even though lastEvent moves on', () => {
    const drawn = applyAction(newGame(), { actor: 0, type: 'roll' }, dice(1, 1));
    expect(drawn.lastCard).not.toBeNull();
    // Player 2 rolls 1+2 onto index 3 (a Place), not a card space.
    const after = applyAction(drawn, { actor: 1, type: 'roll' }, dice(1, 2));
    expect(after.lastCard).toBeNull();
  });

  it('a roll that does not draw leaves lastCard null', () => {
    // From the last space, a roll of 1+1 wraps to index 1 (a Place), not a card space.
    const start = placed(newGame(), 0, 19);
    const game = applyAction(start, { actor: 0, type: 'roll' }, dice(1, 1));
    expect(game.phase).toBe('purchaseDecision');
    expect(game.lastCard).toBeNull();
  });
});
