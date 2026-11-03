/**
 * "Our Custom Relationship Board Game" — pure board-game engine.
 *
 * Original game only: all terminology here is custom (Memory Coins,
 * Plot Twists, Little Surprises, Places and Moments, tokens). No
 * third-party board-game names, artwork, or card text are used.
 *
 * The engine is pure: applyAction never mutates its input. It deep-copies
 * the state first and returns the new state. Every illegal action throws
 * an Error whose message contains one of these codes:
 *   OUT_OF_TURN, NOT_YOUR_TURN, GAME_FINISHED, ALREADY_OWNED,
 *   NOT_FOR_SALE, CANNOT_AFFORD, DOUBLE_PURCHASE, INVALID_TRADE,
 *   TRADE_NOT_PENDING, WRONG_PHASE
 *
 * NOTE ON GameState.config: applyAction receives only (state, action),
 * so the board itself (spaces, prices, rents, categories, card decks)
 * has to travel with the state. createGame therefore stores the
 * validated board config on the state as `config`. Every other field
 * is exactly as specified; callers that persist or transport a game
 * must keep `config` verbatim, untouched, alongside the rest of the
 * state. applyAction reads spaces and decks from state.config and
 * never mutates it.
 *
 * Deterministic decks: Plot Twist and Little Surprise cards are drawn
 * in config order. plotTwistIndex / littleSurpriseIndex always point at
 * the NEXT card to draw; after the last card the index wraps to 0.
 *
 * Miss-turn skipping: when a player with missTurns > 0 takes their
 * roll action, no dice are rolled and the piece does not move. The
 * counter drops by one and the turn passes to the other player.
 *
 * Category-set rent doubling: if one player owns every Place in a
 * category, rent on each of those Places is doubled.
 *
 * Bankruptcy threshold: a player goes bankrupt only when they owe MORE
 * than they hold. Paying an amount exactly equal to everything they
 * hold leaves them at zero coins but still in the game.
 *
 * Move cards move the piece (with pass-Start bonus when the move wraps
 * past Start) but do NOT trigger the effect of the space landed on.
 * A toStart card moves the piece to index 0 and pays the pass-Start
 * bonus exactly once.
 *
 * Trades do not consume the turn: after a trade is proposed, answered,
 * or declined, the turn stays with the player who proposed it (or, for
 * a fresh proposal, with the current player), who still rolls after.
 */

export type BoardSpaceKind =
  | 'start'
  | 'place'
  | 'plot-twist'
  | 'little-surprise'
  | 'tax'
  | 'rest'
  | 'miss-turn';

const SPACE_KINDS: BoardSpaceKind[] = ['start', 'place', 'plot-twist', 'little-surprise', 'tax', 'rest', 'miss-turn'];

export interface SpaceConfig {
  id: string;
  kind: BoardSpaceKind;
  name: string;
  description?: string;
  price?: number;
  rent?: number;
  category?: string;
  memoryId?: string | null;
}

export type CardEffect =
  | { type: 'coins'; amount: number }
  | { type: 'move'; steps: number }
  | { type: 'missTurn' }
  | { type: 'toStart' };

export interface CardConfig {
  id: string;
  text: string;
  effect: CardEffect;
}

export interface BoardConfigData {
  spaces: SpaceConfig[];
  plotTwists: CardConfig[];
  littleSurprises: CardConfig[];
  startCoins: number;
  passStartBonus: number;
  taxAmount: number;
}

export interface PlayerState {
  name: string;
  token: string;
  coins: number;
  position: number;
  missTurns: number;
  bankrupt: boolean;
}

export interface GameState {
  version: number;
  status: 'playing' | 'finished';
  players: [PlayerState, PlayerState];
  owners: Record<string, 0 | 1 | null>;
  turn: 0 | 1;
  phase: 'awaitingRoll' | 'purchaseDecision' | 'tradeOffer' | 'finished';
  dice: [number, number] | null;
  pendingTrade: null | {
    from: 0 | 1;
    to: 0 | 1;
    giveSpaceIds: string[];
    giveCoins: number;
    wantSpaceIds: string[];
    wantCoins: number;
  };
  lastEvent: string | null;
  /** The most recently drawn Plot Twist / Little Surprise card, if any.
   * Set when a card is drawn and cleared when the next roll begins, so
   * the UI can show the drawn card as a scrapbook card even though
   * lastEvent moves on to the card's effect. */
  lastCard: null | { deck: 'plot-twist' | 'little-surprise'; cardId: string; text: string };
  log: string[];
  winner: 0 | 1 | null;
  isDraw: boolean;
  plotTwistIndex: number;
  littleSurpriseIndex: number;
  /** Validated board config, stored by createGame (see header note). */
  config: BoardConfigData;
}

export type BoardAction =
  | { actor: 0 | 1; type: 'roll' }
  | { actor: 0 | 1; type: 'buy' }
  | { actor: 0 | 1; type: 'passPurchase' }
  | {
      actor: 0 | 1;
      type: 'proposeTrade';
      giveSpaceIds: string[];
      giveCoins: number;
      wantSpaceIds: string[];
      wantCoins: number;
    }
  | { actor: 0 | 1; type: 'respondTrade'; accept: boolean }
  | { actor: 0 | 1; type: 'endEarly' };

// There is deliberately NO separate endTurn action: after a roll
// resolves, the turn advances automatically, except in the
// purchaseDecision phase, where buy / passPurchase advances it.

function fail(message: string): never {
  throw new Error(message);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function validateCard(card: CardConfig, deckName: string): void {
  if (!isNonEmptyString(card.id)) {
    fail(`Invalid board config: every ${deckName} card needs a non-empty id`);
  }
  if (!isNonEmptyString(card.text)) {
    fail(`Invalid board config: ${deckName} card "${card.id}" needs non-empty text`);
  }
  const effect = card.effect;
  if (!effect || typeof effect.type !== 'string') {
    fail(`Invalid board config: ${deckName} card "${card.id}" needs an effect`);
  }
  if (effect.type === 'coins') {
    if (!Number.isFinite(effect.amount)) {
      fail(`Invalid board config: ${deckName} card "${card.id}" coins amount must be a number`);
    }
  } else if (effect.type === 'move') {
    if (!Number.isInteger(effect.steps)) {
      fail(`Invalid board config: ${deckName} card "${card.id}" move steps must be an integer`);
    }
  } else if (effect.type !== 'missTurn' && effect.type !== 'toStart') {
    // Reached only for effect objects that do not match the CardEffect
    // union (e.g. a plain-JS caller passing an unknown type string).
    fail(`Invalid board config: ${deckName} card "${card.id}" has unknown effect type "${(effect as { type: unknown }).type}"`);
  }
}

function validateConfig(config: BoardConfigData): void {
  if (!config || typeof config !== 'object') {
    fail('Invalid board config: config is required');
  }
  if (!Array.isArray(config.spaces) || config.spaces.length < 16 || config.spaces.length > 24) {
    fail('Invalid board config: board must have between 16 and 24 spaces');
  }
  const startSpaces = config.spaces.filter((space) => space.kind === 'start');
  if (startSpaces.length !== 1) {
    fail('Invalid board config: board must have exactly one start space');
  }
  if (config.spaces[0].kind !== 'start') {
    fail('Invalid board config: the start space must be at index 0');
  }
  const seenIds = new Set<string>();
  for (const space of config.spaces) {
    if (!isNonEmptyString(space.id)) {
      fail('Invalid board config: every space needs a non-empty id');
    }
    if (seenIds.has(space.id)) {
      fail(`Invalid board config: duplicate space id "${space.id}"`);
    }
    seenIds.add(space.id);
    if (!isNonEmptyString(space.name)) {
      fail(`Invalid board config: space "${space.id}" needs a non-empty name`);
    }
    if (!SPACE_KINDS.includes(space.kind)) {
      fail(`Invalid board config: space "${space.id}" has unknown kind "${space.kind}"`);
    }
    if (space.kind === 'place') {
      if (!(typeof space.price === 'number' && Number.isFinite(space.price) && space.price > 0)) {
        fail(`Invalid board config: place "${space.id}" needs a price greater than 0`);
      }
      if (!isNonNegativeNumber(space.rent)) {
        fail(`Invalid board config: place "${space.id}" needs a rent of 0 or more`);
      }
      if (!isNonEmptyString(space.category)) {
        fail(`Invalid board config: place "${space.id}" needs a non-empty category`);
      }
    }
  }
  if (!Array.isArray(config.plotTwists) || config.plotTwists.length < 1) {
    fail('Invalid board config: at least one Plot Twist card is required');
  }
  if (!Array.isArray(config.littleSurprises) || config.littleSurprises.length < 1) {
    fail('Invalid board config: at least one Little Surprise card is required');
  }
  for (const card of config.plotTwists) validateCard(card, 'Plot Twist');
  for (const card of config.littleSurprises) validateCard(card, 'Little Surprise');
  if (!isNonNegativeNumber(config.startCoins)) {
    fail('Invalid board config: startCoins must be 0 or more');
  }
  if (!isNonNegativeNumber(config.passStartBonus)) {
    fail('Invalid board config: passStartBonus must be 0 or more');
  }
  if (!isNonNegativeNumber(config.taxAmount)) {
    fail('Invalid board config: taxAmount must be 0 or more');
  }
}

function deepCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function otherPlayer(player: 0 | 1): 0 | 1 {
  return player === 0 ? 1 : 0;
}

function advanceTurn(state: GameState): void {
  state.turn = otherPlayer(state.turn);
  state.phase = 'awaitingRoll';
}

/** Places of the player return to unowned and the other player wins. */
function bankrupt(
  state: GameState,
  player: 0 | 1,
  reason: string,
  transferCoinsToWinner: boolean,
): void {
  const loser = state.players[player];
  const winner = state.players[otherPlayer(player)];
  if (transferCoinsToWinner) {
    winner.coins += loser.coins;
  }
  loser.coins = 0;
  loser.bankrupt = true;
  for (const space of state.config.spaces) {
    if (space.kind === 'place' && state.owners[space.id] === player) {
      state.owners[space.id] = null;
    }
  }
  state.status = 'finished';
  state.phase = 'finished';
  state.winner = otherPlayer(player);
  state.isDraw = false;
  state.lastEvent = reason;
  state.log.push(reason);
}

function rentFor(state: GameState, space: SpaceConfig, owner: 0 | 1): number {
  const base = space.rent ?? 0;
  if (!space.category) return base;
  const categoryPlaces = state.config.spaces.filter(
    (candidate) => candidate.kind === 'place' && candidate.category === space.category,
  );
  const ownsWholeCategory = categoryPlaces.every(
    (candidate) => state.owners[candidate.id] === owner,
  );
  return ownsWholeCategory ? base * 2 : base;
}

type LandingOutcome = 'purchaseDecision' | 'advanced' | 'finished';

/**
 * Resolve the space the current player has just landed on, after movement
 * and any pass-Start bonus are already applied. Returns 'purchaseDecision'
 * when the turn must wait for a buy / passPurchase choice, 'finished'
 * when the landing bankrupted the player, and 'advanced' otherwise
 * (the caller then advances the turn).
 */
function resolveLanding(state: GameState, player: 0 | 1): LandingOutcome {
  const config = state.config;
  const me = state.players[player];
  const space = config.spaces[me.position];
  const name = me.name;

  if (space.kind === 'start') {
    const event = `${name} rests on Start.`;
    state.lastEvent = event;
    state.log.push(event);
    return 'advanced';
  }

  if (space.kind === 'place') {
    const owner = state.owners[space.id];
    if (owner === player) {
      const event = `${name} lands on their own Place, ${space.name}. Nothing happens.`;
      state.lastEvent = event;
      state.log.push(event);
      return 'advanced';
    }
    if (owner === null || owner === undefined) {
      const price = space.price ?? 0;
      if (me.coins < price) {
        const event =
          `${name} lands on ${space.name} but cannot afford it ` +
          `(${me.coins} Memory Coins against a price of ${price}). Nothing happens.`;
        state.lastEvent = event;
        state.log.push(event);
        return 'advanced';
      }
      const event = `${name} lands on unowned ${space.name} (price ${price} Memory Coins) and must choose to buy or pass.`;
      state.lastEvent = event;
      state.log.push(event);
      state.phase = 'purchaseDecision';
      return 'purchaseDecision';
    }
    const rent = rentFor(state, space, owner);
    const ownerName = state.players[owner].name;
    if (me.coins < rent) {
      const paid = me.coins;
      bankrupt(
        state,
        player,
        `${name} lands on ${space.name} and owes ${rent} Memory Coins in rent to ${ownerName} ` +
          `but holds only ${paid}, so ${name} pays everything held and goes bankrupt. ${ownerName} wins.`,
        true,
      );
      return 'finished';
    }
    me.coins -= rent;
    state.players[owner].coins += rent;
    const event = `${name} lands on ${space.name} and pays ${rent} Memory Coins in rent to ${ownerName}.`;
    state.lastEvent = event;
    state.log.push(event);
    return 'advanced';
  }

  if (space.kind === 'tax') {
    const tax = config.taxAmount;
    if (me.coins < tax) {
      const held = me.coins;
      bankrupt(
        state,
        player,
        `${name} lands on ${space.name} and owes ${tax} Memory Coins in tax ` +
          `but holds only ${held}, so ${name} pays everything held and goes bankrupt.`,
        false,
      );
      return 'finished';
    }
    me.coins -= tax;
    const event = `${name} lands on ${space.name} and pays ${tax} Memory Coins in tax.`;
    state.lastEvent = event;
    state.log.push(event);
    return 'advanced';
  }

  if (space.kind === 'rest') {
    const event = `${name} lands on ${space.name} and rests. Nothing happens.`;
    state.lastEvent = event;
    state.log.push(event);
    return 'advanced';
  }

  if (space.kind === 'miss-turn') {
    me.missTurns = 1;
    const event = `${name} lands on ${space.name} and will miss their next turn.`;
    state.lastEvent = event;
    state.log.push(event);
    return 'advanced';
  }

  // plot-twist / little-surprise: draw the next card in config order.
  const isPlotTwist = space.kind === 'plot-twist';
  const deck = isPlotTwist ? config.plotTwists : config.littleSurprises;
  const deckName = isPlotTwist ? 'Plot Twist' : 'Little Surprise';
  const indexKey = isPlotTwist ? 'plotTwistIndex' : 'littleSurpriseIndex';
  const card = deck[state[indexKey] % deck.length];
  state[indexKey] = (state[indexKey] + 1) % deck.length;
  const drawEvent = `${name} lands on ${space.name} and draws a ${deckName}: ${card.text}`;
  state.lastEvent = drawEvent;
  state.log.push(drawEvent);
  state.lastCard = { deck: isPlotTwist ? 'plot-twist' : 'little-surprise', cardId: card.id, text: card.text };

  const effect = card.effect;
  if (effect.type === 'coins') {
    if (effect.amount >= 0) {
      me.coins += effect.amount;
      const event = `${name} gains ${effect.amount} Memory Coins.`;
      state.lastEvent = event;
      state.log.push(event);
      return 'advanced';
    }
    const owed = -effect.amount;
    if (me.coins < owed) {
      const held = me.coins;
      bankrupt(
        state,
        player,
        `${name} owes ${owed} Memory Coins from a ${deckName} card but holds only ${held}, ` +
          `so ${name} pays everything held and goes bankrupt.`,
        false,
      );
      return 'finished';
    }
    me.coins += effect.amount;
    const event = `${name} loses ${owed} Memory Coins.`;
    state.lastEvent = event;
    state.log.push(event);
    return 'advanced';
  }

  if (effect.type === 'move') {
    const count = config.spaces.length;
    const total = me.position + effect.steps;
    const passes = effect.steps > 0 ? Math.floor(total / count) : 0;
    if (passes > 0) {
      me.coins += passes * config.passStartBonus;
    }
    me.position = ((total % count) + count) % count;
    const direction = effect.steps >= 0 ? 'forward' : 'back';
    const event =
      `${name} moves ${direction} ${Math.abs(effect.steps)} spaces to ` +
      `${config.spaces[me.position].name}` +
      (passes > 0 ? ` and collects ${passes * config.passStartBonus} Memory Coins for passing Start.` : '.');
    state.lastEvent = event;
    state.log.push(event);
    return 'advanced';
  }

  if (effect.type === 'missTurn') {
    me.missTurns = 1;
    const event = `${name} will miss their next turn.`;
    state.lastEvent = event;
    state.log.push(event);
    return 'advanced';
  }

  // toStart: move to index 0 and pay the pass-Start bonus exactly once.
  me.position = 0;
  me.coins += config.passStartBonus;
  const event = `${name} returns to Start and collects ${config.passStartBonus} Memory Coins.`;
  state.lastEvent = event;
  state.log.push(event);
  return 'advanced';
}

function defaultDice(): [number, number] {
  const rollDie = () => Math.floor(Math.random() * 6) + 1;
  return [rollDie(), rollDie()];
}

export function createGame(
  config: BoardConfigData,
  players: [{ name: string; token: string }, { name: string; token: string }],
): GameState {
  validateConfig(config);
  if (!Array.isArray(players) || players.length !== 2) {
    fail('Invalid players: exactly two players are required');
  }
  for (const player of players) {
    if (!isNonEmptyString(player.name)) {
      fail('Invalid players: every player needs a non-empty name');
    }
    if (!isNonEmptyString(player.token)) {
      fail('Invalid players: every player needs a non-empty token');
    }
  }
  const owners: Record<string, 0 | 1 | null> = {};
  for (const space of config.spaces) {
    if (space.kind === 'place') {
      owners[space.id] = null;
    }
  }
  return {
    version: 1,
    status: 'playing',
    players: players.map((player) => ({
      name: player.name,
      token: player.token,
      coins: config.startCoins,
      position: 0,
      missTurns: 0,
      bankrupt: false,
    })) as [PlayerState, PlayerState],
    owners,
    turn: 0,
    phase: 'awaitingRoll',
    dice: null,
    pendingTrade: null,
    lastEvent: null,
    lastCard: null,
    log: [],
    winner: null,
    isDraw: false,
    plotTwistIndex: 0,
    littleSurpriseIndex: 0,
    config: deepCopy(config),
  };
}

export function applyAction(
  state: GameState,
  action: BoardAction,
  rng?: () => [number, number],
): GameState {
  const next = deepCopy(state);
  if (!next.config || !Array.isArray(next.config.spaces)) {
    fail('INVALID_CONFIG: GameState is missing its board config; games must be created with createGame');
  }
  if (next.status === 'finished' || next.phase === 'finished') {
    fail('GAME_FINISHED: the game is finished; start a new game to play again');
  }

  const config = next.config;

  if (action.type === 'roll') {
    if (action.actor !== next.turn) {
      fail(`OUT_OF_TURN: it is ${next.players[next.turn].name}'s turn, not player ${action.actor}'s`);
    }
    if (next.phase !== 'awaitingRoll') {
      fail(`WRONG_PHASE: cannot roll while the game is in phase "${next.phase}"`);
    }
    const me = next.players[next.turn];
    if (me.missTurns > 0) {
      next.lastCard = null;
      me.missTurns -= 1;
      const event = `${me.name} misses this turn and does not move.`;
      next.lastEvent = event;
      next.log.push(event);
      next.dice = null;
      advanceTurn(next);
      return next;
    }
    const dice = rng ? rng() : defaultDice();
    if (
      !Array.isArray(dice) ||
      dice.length !== 2 ||
      dice.some((die) => !Number.isInteger(die) || die < 1 || die > 6)
    ) {
      fail('INVALID_DICE: rng must return two integers between 1 and 6');
    }
    next.lastCard = null;
    next.dice = [dice[0], dice[1]];
    const sum = dice[0] + dice[1];
    const count = config.spaces.length;
    const oldPosition = me.position;
    const total = oldPosition + sum;
    const passes = Math.floor(total / count);
    if (passes > 0) {
      me.coins += passes * config.passStartBonus;
    }
    me.position = total % count;
    const moveEvent =
      `${me.name} rolls ${dice[0]} and ${dice[1]} and moves from ` +
      `${config.spaces[oldPosition].name} to ${config.spaces[me.position].name}` +
      (passes > 0 ? `, passing Start and collecting ${passes * config.passStartBonus} Memory Coins.` : '.');
    next.lastEvent = moveEvent;
    next.log.push(moveEvent);
    const outcome = resolveLanding(next, next.turn);
    if (outcome === 'purchaseDecision' || outcome === 'finished') {
      return next;
    }
    advanceTurn(next);
    return next;
  }

  if (action.type === 'buy') {
    if (action.actor !== next.turn) {
      fail(`OUT_OF_TURN: it is ${next.players[next.turn].name}'s turn, not player ${action.actor}'s`);
    }
    if (next.phase !== 'purchaseDecision') {
      fail(`WRONG_PHASE: cannot buy while the game is in phase "${next.phase}"`);
    }
    const me = next.players[next.turn];
    const space = config.spaces[me.position];
    if (space.kind !== 'place') {
      fail(`NOT_FOR_SALE: ${space.name} is not a Place that can be bought`);
    }
    const owner = next.owners[space.id];
    if (owner === next.turn) {
      fail(`DOUBLE_PURCHASE: ${me.name} already owns ${space.name}`);
    }
    if (owner !== null && owner !== undefined) {
      fail(`ALREADY_OWNED: ${space.name} is already owned by ${next.players[owner].name}`);
    }
    const price = space.price ?? 0;
    if (me.coins < price) {
      fail(`CANNOT_AFFORD: ${space.name} costs ${price} Memory Coins but ${me.name} holds ${me.coins}`);
    }
    me.coins -= price;
    next.owners[space.id] = next.turn;
    const event = `${me.name} buys ${space.name} for ${price} Memory Coins.`;
    next.lastEvent = event;
    next.log.push(event);
    advanceTurn(next);
    return next;
  }

  if (action.type === 'passPurchase') {
    if (action.actor !== next.turn) {
      fail(`OUT_OF_TURN: it is ${next.players[next.turn].name}'s turn, not player ${action.actor}'s`);
    }
    if (next.phase !== 'purchaseDecision') {
      fail(`WRONG_PHASE: cannot pass on a purchase while the game is in phase "${next.phase}"`);
    }
    const me = next.players[next.turn];
    const space = config.spaces[me.position];
    const event = `${me.name} passes on buying ${space.name}.`;
    next.lastEvent = event;
    next.log.push(event);
    advanceTurn(next);
    return next;
  }

  if (action.type === 'proposeTrade') {
    if (action.actor !== next.turn) {
      fail(`OUT_OF_TURN: it is ${next.players[next.turn].name}'s turn, not player ${action.actor}'s`);
    }
    if (next.phase !== 'awaitingRoll') {
      fail(`WRONG_PHASE: trades can only be proposed before rolling, while the game is in phase "awaitingRoll"`);
    }
    if (next.pendingTrade !== null) {
      fail('INVALID_TRADE: a trade is already waiting for an answer');
    }
    const { giveSpaceIds, giveCoins, wantSpaceIds, wantCoins } = action;
    if (!Array.isArray(giveSpaceIds) || !Array.isArray(wantSpaceIds)) {
      fail('INVALID_TRADE: giveSpaceIds and wantSpaceIds must be arrays');
    }
    if (!isNonNegativeInteger(giveCoins) || !isNonNegativeInteger(wantCoins)) {
      fail('INVALID_TRADE: giveCoins and wantCoins must be whole numbers of 0 or more');
    }
    const allIds = [...giveSpaceIds, ...wantSpaceIds];
    if (new Set(allIds).size !== allIds.length) {
      fail('INVALID_TRADE: a Place cannot appear twice in one trade');
    }
    const placeIds = new Set(
      config.spaces.filter((space) => space.kind === 'place').map((space) => space.id),
    );
    for (const id of allIds) {
      if (!placeIds.has(id)) {
        fail(`INVALID_TRADE: "${id}" is not a Place on this board`);
      }
    }
    const totalOfferedOrWanted =
      giveSpaceIds.length + wantSpaceIds.length + giveCoins + wantCoins;
    if (totalOfferedOrWanted <= 0) {
      fail('INVALID_TRADE: a trade must offer or ask for at least one Place or one Memory Coin in total');
    }
    const me = next.players[next.turn];
    for (const id of giveSpaceIds) {
      if (next.owners[id] !== next.turn) {
        fail(`INVALID_TRADE: ${me.name} does not own "${id}"`);
      }
    }
    if (me.coins < giveCoins) {
      fail(`INVALID_TRADE: ${me.name} holds ${me.coins} Memory Coins but offered ${giveCoins}`);
    }
    next.pendingTrade = {
      from: next.turn,
      to: otherPlayer(next.turn),
      giveSpaceIds: [...giveSpaceIds],
      giveCoins,
      wantSpaceIds: [...wantSpaceIds],
      wantCoins,
    };
    next.phase = 'tradeOffer';
    const spaceName = (id: string): string => next.config.spaces.find((s) => s.id === id)?.name ?? id;
    const event =
      `${me.name} proposes a trade to ${next.players[otherPlayer(next.turn)].name}: ` +
      `give ${giveSpaceIds.length > 0 ? giveSpaceIds.map(spaceName).join(', ') : 'nothing'} and ${giveCoins} Memory Coins ` +
      `for ${wantSpaceIds.length > 0 ? wantSpaceIds.map(spaceName).join(', ') : 'nothing'} and ${wantCoins} Memory Coins.`;
    next.lastEvent = event;
    next.log.push(event);
    return next;
  }

  if (action.type === 'respondTrade') {
    if (next.pendingTrade === null || next.phase !== 'tradeOffer') {
      fail('TRADE_NOT_PENDING: there is no trade waiting for an answer');
    }
    const trade = next.pendingTrade;
    if (action.actor !== trade.to) {
      fail(`NOT_YOUR_TURN: this trade is waiting for ${next.players[trade.to].name}'s answer`);
    }
    const proposer = next.players[trade.from];
    const responder = next.players[trade.to];
    if (!action.accept) {
      next.pendingTrade = null;
      next.phase = 'awaitingRoll';
      const event = `${responder.name} declines the trade from ${proposer.name}.`;
      next.lastEvent = event;
      next.log.push(event);
      return next;
    }
    for (const id of trade.giveSpaceIds) {
      if (next.owners[id] !== trade.from) {
        fail(`INVALID_TRADE: ${proposer.name} no longer owns "${id}", so the trade cannot be completed`);
      }
    }
    for (const id of trade.wantSpaceIds) {
      if (next.owners[id] !== trade.to) {
        fail(`INVALID_TRADE: ${responder.name} no longer owns "${id}", so the trade cannot be completed`);
      }
    }
    if (proposer.coins < trade.giveCoins) {
      fail(`INVALID_TRADE: ${proposer.name} no longer holds the ${trade.giveCoins} Memory Coins offered`);
    }
    if (responder.coins < trade.wantCoins) {
      fail(`INVALID_TRADE: ${responder.name} no longer holds the ${trade.wantCoins} Memory Coins asked for`);
    }
    for (const id of trade.giveSpaceIds) {
      next.owners[id] = trade.to;
    }
    for (const id of trade.wantSpaceIds) {
      next.owners[id] = trade.from;
    }
    proposer.coins = proposer.coins - trade.giveCoins + trade.wantCoins;
    responder.coins = responder.coins - trade.wantCoins + trade.giveCoins;
    next.pendingTrade = null;
    next.phase = 'awaitingRoll';
    const event = `${responder.name} accepts the trade from ${proposer.name}.`;
    next.lastEvent = event;
    next.log.push(event);
    return next;
  }

  if (action.type === 'endEarly') {
    if (action.actor !== next.turn) {
      fail(`OUT_OF_TURN: it is ${next.players[next.turn].name}'s turn, not player ${action.actor}'s`);
    }
    if (next.phase !== 'awaitingRoll') {
      fail(`WRONG_PHASE: the game can only be ended early before rolling, while the game is in phase "awaitingRoll"`);
    }
    const [first, second] = next.players;
    next.status = 'finished';
    next.phase = 'finished';
    if (first.coins === second.coins) {
      next.isDraw = true;
      next.winner = null;
      const event = `The game ends early in a draw at ${first.coins} Memory Coins each.`;
      next.lastEvent = event;
      next.log.push(event);
    } else {
      next.winner = first.coins > second.coins ? 0 : 1;
      next.isDraw = false;
      const event =
        `The game ends early. ${next.players[next.winner].name} wins with ` +
        `${next.players[next.winner].coins} Memory Coins.`;
      next.lastEvent = event;
      next.log.push(event);
    }
    return next;
  }

  fail(`INVALID_ACTION: unknown action type "${(action as { type?: unknown }).type}"`);
}

export const BOARD_RULES_TEXT = [
  'Our Custom Relationship Board Game — rules',
  '',
  'Setup',
  'Two players each pick a token and start on Start with the board\'s starting amount of Memory Coins. ' +
    'Every Place on the board starts unowned. The Plot Twist and Little Surprise cards are drawn in the order ' +
    'listed in the board setup; after the last card in a deck, that deck starts again from its first card.',
  '',
  'Turn order and dice',
  'Players take turns, starting with the first player. On your turn, roll two six-sided dice and move your token ' +
    'forward that many spaces around the board. Doubles have no special effect: you move, resolve the space you ' +
    'land on, and then your turn ends.',
  '',
  'Passing Start',
  'Each time a move carries you past Start, or lands exactly on it, you collect the pass-Start bonus once for that ' +
    'pass. Moving backwards never collects the bonus.',
  '',
  'Buying Places',
  'Places and Moments are the board\'s buyable spaces. If you land on a Place nobody owns and you can afford its ' +
    'price, you must choose before anything else happens: buy it for its price, or pass. You cannot roll again ' +
    'until you choose, and buying or passing ends your turn. If you land on a Place you already own, nothing ' +
    'happens. If you land on a Place you cannot afford, nothing happens and your turn ends — your coins never ' +
    'go below zero from a missed purchase.',
  '',
  'Rent and owning a whole category',
  'If you land on a Place owned by the other player, you pay its rent to them automatically. If that owner owns ' +
    'every Place in the landed Place\'s category, the rent doubles. Paying rent with exactly the coins you hold ' +
    'leaves you at zero but still in the game.',
  '',
  'Plot Twists and Little Surprises',
  'Landing on a Plot Twist space draws the next Plot Twist card; landing on a Little Surprise space draws the next ' +
    'Little Surprise card. A coins card gives or takes that many Memory Coins. A move card moves you forward or ' +
    'back that many spaces, collecting the pass-Start bonus if the move wraps past Start, but it does not trigger ' +
    'the effect of the space you land on. A miss-turn card makes you miss your next turn. A toStart card moves you ' +
    'to Start and pays the pass-Start bonus exactly once.',
  '',
  'Tax, rest, and miss-turn spaces',
  'A tax space makes you pay the board\'s tax amount. A rest space does nothing. A miss-turn space makes you miss ' +
    'your next turn: when that turn comes round, your roll is spent skipping — your miss counter drops by one, ' +
    'you do not move, and play passes to the other player.',
  '',
  'Trading',
  'On your turn, before you roll, you may propose a trade to the other player, naming the Places and Memory Coins ' +
    'you give and the Places and Memory Coins you want. A proposal must include at least one Place or one Memory ' +
    'Coin on either side in total, you must own every Place you offer, and you must hold at least the coins you ' +
    'offer. Only one trade can wait for an answer at a time, and only the player it was offered to can answer it. ' +
    'If either side can no longer give what was promised when the trade is accepted, the trade does not go through ' +
    'and no Places or coins change hands. A proposed, accepted, or declined trade does not use up your turn: ' +
    'you still roll afterwards.',
  '',
  'Bankruptcy',
  'You go bankrupt only when you owe more than you hold — from rent, tax, or a coins card. When that happens you ' +
    'pay everything you hold (to the other player for rent, and nowhere for tax or a card), every Place you own ' +
    'returns to unowned, and the other player wins at once. Paying an amount exactly equal to everything you hold ' +
    'is not bankruptcy: you are left at zero coins and the game continues.',
  '',
  'Ending the game early',
  'On your turn, before you roll, you may end the game early. The player holding more Memory Coins wins; if both ' +
    'players hold the same amount, the game is a draw. Places are not counted — only Memory Coins. You cannot end ' +
    'the game early while a purchase decision or a trade is waiting.',
  '',
  'Restart and new games',
  'A finished game cannot be continued. To play again — including from the Restart button during a game, which starts ' +
    'a fresh game with the same board setup and leaves the old game as it is — start a new game; both players start ' +
    'again on Start with the starting amount of Memory Coins.',
].join('\n');

export const DEFAULT_BOARD_CONFIG: BoardConfigData = {
  startCoins: 1500,
  passStartBonus: 200,
  taxAmount: 100,
  spaces: [
    { id: 'start', kind: 'start', name: 'Start', description: 'Where every game begins.' },
    { id: 'cafe-corner', kind: 'place', name: 'The Old Café Corner', price: 80, rent: 12, category: 'Neighbourhood' },
    { id: 'plot-twist-1', kind: 'plot-twist', name: 'Plot Twist', description: 'Draw the next Plot Twist card.' },
    { id: 'corner-bookshop', kind: 'place', name: 'The Corner Bookshop', price: 100, rent: 15, category: 'Neighbourhood' },
    { id: 'rainy-walk', kind: 'place', name: 'A Rainy Walk', price: 90, rent: 12, category: 'Outdoors' },
    { id: 'little-surprise-1', kind: 'little-surprise', name: 'Little Surprise', description: 'Draw the next Little Surprise card.' },
    { id: 'sunday-market', kind: 'place', name: 'The Sunday Market Stall', price: 120, rent: 18, category: 'Neighbourhood' },
    { id: 'rainy-day-fund', kind: 'tax', name: 'The Rainy-Day Fund', description: 'Contribute the tax amount.' },
    { id: 'hilltop-view', kind: 'place', name: 'The Hilltop Viewpoint', price: 140, rent: 20, category: 'Outdoors' },
    { id: 'riverside-path', kind: 'place', name: 'The Riverside Path', price: 110, rent: 15, category: 'Outdoors' },
    { id: 'quiet-bench', kind: 'rest', name: 'The Quiet Bench', description: 'Sit a while. Nothing happens.' },
    { id: 'coast-trip', kind: 'place', name: 'Dream Trip: The Coast', price: 200, rent: 30, category: 'Dream Trips' },
    { id: 'plot-twist-2', kind: 'plot-twist', name: 'Plot Twist', description: 'Draw the next Plot Twist card.' },
    { id: 'mountain-trip', kind: 'place', name: 'Dream Trip: The Mountains', price: 240, rent: 35, category: 'Dream Trips' },
    { id: 'blanket-fort', kind: 'place', name: 'A Blanket Fort Evening', price: 60, rent: 8, category: 'Cosy Nights' },
    { id: 'little-surprise-2', kind: 'little-surprise', name: 'Little Surprise', description: 'Draw the next Little Surprise card.' },
    { id: 'old-town-trip', kind: 'place', name: 'Dream Trip: The Old Town', price: 300, rent: 45, category: 'Dream Trips' },
    { id: 'long-nap', kind: 'miss-turn', name: 'The Long Nap', description: 'Miss your next turn.' },
    { id: 'slow-breakfast', kind: 'place', name: 'The Slow Sunday Breakfast', price: 70, rent: 10, category: 'Cosy Nights' },
    { id: 'starlit-rooftop', kind: 'place', name: 'The Starlit Rooftop', price: 150, rent: 22, category: 'Cosy Nights' },
  ],
  plotTwists: [
    { id: 'pt-1', text: 'A surprise refund lands in your pocket. Collect 150 Memory Coins.', effect: { type: 'coins', amount: 150 } },
    { id: 'pt-2', text: 'You treat everyone to snacks. Pay 80 Memory Coins.', effect: { type: 'coins', amount: -80 } },
    { id: 'pt-3', text: 'A shortcut opens up. Move forward 3 spaces.', effect: { type: 'move', steps: 3 } },
    { id: 'pt-4', text: 'You take a long detour. Move back 2 spaces.', effect: { type: 'move', steps: -2 } },
    { id: 'pt-5', text: 'You stop to admire the view for too long. Miss your next turn.', effect: { type: 'missTurn' } },
    { id: 'pt-6', text: 'A sudden change of plans sends you back to Start. Move to Start and collect the pass-Start bonus.', effect: { type: 'toStart' } },
  ],
  littleSurprises: [
    { id: 'ls-1', text: 'A friend leaves you a kind note and 100 Memory Coins.', effect: { type: 'coins', amount: 100 } },
    { id: 'ls-2', text: 'You lose a small bet over coffee. Pay 50 Memory Coins.', effect: { type: 'coins', amount: -50 } },
    { id: 'ls-3', text: 'A friendly wave hurries you along. Move forward 2 spaces.', effect: { type: 'move', steps: 2 } },
    { id: 'ls-4', text: 'You linger over dessert. Miss your next turn.', effect: { type: 'missTurn' } },
    { id: 'ls-5', text: 'You head home early. Move to Start and collect the pass-Start bonus.', effect: { type: 'toStart' } },
    { id: 'ls-6', text: 'A lucky find on the walk home. Collect 200 Memory Coins.', effect: { type: 'coins', amount: 200 } },
  ],
};
