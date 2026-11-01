/**
 * Phase 7 — "Our Little World": the board-game engine.
 *
 * Pure, deterministic, and separate from any visual component. Every
 * function takes a state and (where needed) a config, and returns either
 * a new state or an error — it never reads the clock, the network, or
 * the DOM, and it never mutates its input. Dice values are supplied by
 * the caller, so a test can replay an exact game: the engine does not
 * roll its own dice.
 *
 * Original game, original terminology. It is inspired by the general
 * mechanics of classic property-trading games (roll, move, buy, rent,
 * event cards, bankruptcy) but uses no Monopoly branding, logo, board
 * artwork, card text or branded assets: currency is Memory Coins,
 * event cards are Plot Twists and Little Surprises, properties are
 * Places and Moments, and every name, rule and card here is written
 * for this game.
 */

export type SpaceKind = 'start' | 'place' | 'plot' | 'surprise' | 'tax' | 'rest' | 'jail';

export interface BoardSpace {
  id: string;
  kind: SpaceKind;
  name: string;
  description: string;
  /** Places only. */
  price?: number;
  /** Places only: rent before any category bonus. */
  rent?: number;
  /** Places only, for the category bonus and for grouping in the editor. */
  category?: string;
  /** Tax / penalty spaces only. */
  amount?: number;
  /** Places only: a shared photo/memory to show with the space. */
  memoryId?: string | null;
}

export type CardEffectType = 'coins' | 'moveTo' | 'moveBy' | 'skip' | 'jail' | 'payPartner' | 'collectPartner';

export interface EventCard {
  id: string;
  title: string;
  text: string;
  effect: CardEffectType;
  /** Coins: +collect / -pay. payPartner/collectPartner: amount moved between players. */
  amount?: number;
  /** moveTo: index into the board spaces. */
  target?: number;
}

export interface BoardConfig {
  spaces: BoardSpace[];
  plotTwists: EventCard[];
  surprises: EventCard[];
  startCoins: number;
  passStartBonus: number;
}

export interface BoardPlayer {
  name: string;
  token: string;
  coins: number;
  position: number;
  skipTurns: number;
  bankrupt: boolean;
}

export type BoardPhase = 'roll' | 'decide' | 'trade' | 'gameover';

export interface PendingTrade {
  propertyId: string;
  price: number;
  from: number;
  to: number;
}

export interface BoardState {
  players: BoardPlayer[];
  /** Index into players. */
  current: number;
  phase: BoardPhase;
  dice: [number, number] | null;
  /** Space id the current player may buy, when phase is 'decide'. */
  pendingSpaceId: string | null;
  pendingTrade: PendingTrade | null;
  /** spaceId -> player index. */
  owners: Record<string, number>;
  log: string[];
  plotIndex: number;
  surpriseIndex: number;
  lastCard: EventCard | null;
  winner: number | null;
  /** Draw (end-early with equal coins) is a finished game with no winner. */
  draw: boolean;
  turn: number;
}

export type EngineResult = { ok: true; state: BoardState } | { ok: false; error: string };

function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)) as T; }

function log(state: BoardState, msg: string): void {
  state.log = [...state.log.slice(-49), msg];
}

function endTurn(state: BoardState): void {
  state.dice = null;
  state.pendingSpaceId = null;
  state.pendingTrade = null;
  // lastCard is deliberately NOT cleared here: the UI shows the card drawn
  // on the turn that just ended. It is cleared when the next roll starts.
  state.phase = 'roll';
  // Advance to the next player who is not bankrupt.
  for (let i = 0; i < 2; i++) {
    state.current = (state.current + 1) % 2;
    if (!state.players[state.current].bankrupt) break;
  }
  state.turn += 1;
}

function bankrupt(state: BoardState, playerIndex: number): void {
  const p = state.players[playerIndex];
  p.coins = 0;
  p.bankrupt = true;
  for (const [spaceId, owner] of Object.entries(state.owners)) {
    if (owner === playerIndex) delete state.owners[spaceId];
  }
  const other = 1 - playerIndex;
  state.winner = state.players[other].bankrupt ? null : other;
  state.phase = 'gameover';
  log(state, `${p.name} is out of Memory Coins and bankrupt. ${state.players[other].name} wins Our Little World.`);
}

/** Pay `amount` from `from` to the bank (to = -1) or to a player. Returns false if it bankrupts the payer. */
function pay(state: BoardState, from: number, to: number, amount: number, reason: string): boolean {
  const payer = state.players[from];
  if (amount <= 0) return true;
  if (payer.coins < amount) {
    const paid = payer.coins;
    if (to >= 0) state.players[to].coins += paid;
    log(state, `${payer.name} pays ${paid} Memory Coins for ${reason} and cannot pay the rest.`);
    bankrupt(state, from);
    return false;
  }
  payer.coins -= amount;
  if (to >= 0) state.players[to].coins += amount;
  log(state, `${payer.name} pays ${amount} Memory Coins for ${reason}.`);
  return true;
}

function categoryBonus(state: BoardState, config: BoardConfig, space: BoardSpace): boolean {
  if (!space.category) return false;
  const siblings = config.spaces.filter((s) => s.kind === 'place' && s.category === space.category);
  if (siblings.length < 2) return false;
  const owner = state.owners[space.id];
  return siblings.every((s) => state.owners[s.id] === owner);
}

export function rentFor(state: BoardState, config: BoardConfig, space: BoardSpace): number {
  const base = space.rent ?? 0;
  return categoryBonus(state, config, space) ? base * 2 : base;
}

export function createBoardGame(config: BoardConfig, players: { name: string; token: string }[]): EngineResult {
  if (config.spaces.length < 8) return { ok: false, error: 'A board needs at least 8 spaces.' };
  if (config.startCoins <= 0) return { ok: false, error: 'Starting Memory Coins must be positive.' };
  if (players.length !== 2) return { ok: false, error: 'Our Little World is a two-player game.' };
  if (!config.spaces.some((s) => s.kind === 'start')) return { ok: false, error: 'The board needs a Home Base start space.' };
  const state: BoardState = {
    players: players.map((p) => ({ name: p.name.trim() || 'Player', token: p.token, coins: config.startCoins, position: 0, skipTurns: 0, bankrupt: false })),
    current: 0,
    phase: 'roll',
    dice: null,
    pendingSpaceId: null,
    pendingTrade: null,
    owners: {},
    log: ['Our Little World begins. Both players start at Home Base.'],
    plotIndex: 0,
    surpriseIndex: 0,
    lastCard: null,
    winner: null,
    draw: false,
    turn: 0,
  };
  return { ok: true, state };
}

function resolveLanding(state: BoardState, config: BoardConfig): void {
  const player = state.players[state.current];
  const space = config.spaces[player.position];
  if (!space) { endTurn(state); return; }
  log(state, `${player.name} lands on ${space.name}.`);
  switch (space.kind) {
    case 'start':
    case 'rest':
      endTurn(state);
      return;
    case 'tax': {
      const amount = space.amount ?? 0;
      if (amount > 0 && !pay(state, state.current, -1, amount, space.name)) return;
      endTurn(state);
      return;
    }
    case 'jail':
      player.skipTurns = 1;
      log(state, `${player.name} spends a turn in the Time-Out Corner, resting.`);
      endTurn(state);
      return;
    case 'plot':
    case 'surprise': {
      const deck = space.kind === 'plot' ? config.plotTwists : config.surprises;
      if (deck.length === 0) { endTurn(state); return; }
      const idx = space.kind === 'plot' ? state.plotIndex % deck.length : state.surpriseIndex % deck.length;
      const card = deck[idx];
      if (space.kind === 'plot') state.plotIndex += 1; else state.surpriseIndex += 1;
      state.lastCard = card;
      log(state, `${player.name} draws "${card.title}": ${card.text}`);
      applyCard(state, config, card);
      return;
    }
    case 'place': {
      const owner = state.owners[space.id];
      if (owner === undefined) {
        if (player.coins < (space.price ?? 0)) {
          log(state, `${player.name} cannot afford ${space.name} (${space.price} Memory Coins).`);
          endTurn(state);
          return;
        }
        state.phase = 'decide';
        state.pendingSpaceId = space.id;
        return;
      }
      if (owner === state.current) { endTurn(state); return; }
      const rent = rentFor(state, config, space);
      if (rent > 0) {
        const other = state.players[owner];
        if (!pay(state, state.current, owner, rent, `rent for ${space.name}${categoryBonus(state, config, space) ? ' (category bonus: rent doubled)' : ''}`)) return;
        log(state, `${other.name} collects the rent.`);
      }
      endTurn(state);
      return;
    }
  }
}

function applyCard(state: BoardState, config: BoardConfig, card: EventCard): void {
  const me = state.current;
  const other = 1 - me;
  const player = state.players[me];
  switch (card.effect) {
    case 'coins': {
      const amount = card.amount ?? 0;
      if (amount >= 0) { player.coins += amount; log(state, `${player.name} collects ${amount} Memory Coins.`); }
      else if (!pay(state, me, -1, -amount, card.title)) return;
      break;
    }
    case 'payPartner': {
      const amount = card.amount ?? 0;
      if (!pay(state, me, other, amount, card.title)) return;
      break;
    }
    case 'collectPartner': {
      const amount = card.amount ?? 0;
      if (!pay(state, other, me, amount, card.title)) {
        // If the partner bankrupts paying, the game is over; do not end the turn again.
        return;
      }
      break;
    }
    case 'moveTo': {
      const target = card.target ?? 0;
      if (target >= 0 && target < config.spaces.length) {
        if (target < player.position) player.coins += config.passStartBonus;
        player.position = target;
        log(state, `${player.name} moves to ${config.spaces[target].name}.`);
      }
      break;
    }
    case 'moveBy': {
      const steps = card.amount ?? 0;
      const next = player.position + steps;
      if (next >= config.spaces.length) player.coins += config.passStartBonus;
      player.position = next % config.spaces.length;
      log(state, `${player.name} moves ${steps} spaces.`);
      break;
    }
    case 'skip':
      player.skipTurns += 1;
      log(state, `${player.name} will miss a turn.`);
      break;
    case 'jail':
      player.skipTurns = 1;
      log(state, `${player.name} spends a turn in the Time-Out Corner.`);
      break;
  }
  if (state.phase !== 'gameover') endTurn(state);
}

export function roll(state: BoardState, config: BoardConfig, d1: number, d2: number): EngineResult {
  if (state.phase !== 'roll') return { ok: false, error: 'It is not time to roll — finish the current decision first.' };
  if (!Number.isInteger(d1) || !Number.isInteger(d2) || d1 < 1 || d1 > 6 || d2 < 1 || d2 > 6) {
    return { ok: false, error: 'Dice must be two numbers from 1 to 6.' };
  }
  const next = clone(state);
  const player = next.players[next.current];
  if (player.bankrupt) return { ok: false, error: 'A bankrupt player cannot roll.' };
  next.dice = [d1, d2];
  next.lastCard = null;
  if (player.skipTurns > 0) {
    player.skipTurns -= 1;
    log(next, `${player.name} rests this turn (Time-Out Corner / skipped turn).`);
    endTurn(next);
    return { ok: true, state: next };
  }
  const total = d1 + d2;
  const oldPos = player.position;
  const newPos = (oldPos + total) % config.spaces.length;
  if (oldPos + total >= config.spaces.length) {
    player.coins += config.passStartBonus;
    log(next, `${player.name} passes Home Base and collects ${config.passStartBonus} Memory Coins.`);
  }
  player.position = newPos;
  log(next, `${player.name} rolls ${d1} + ${d2} = ${total} and moves to ${config.spaces[newPos].name}.`);
  resolveLanding(next, config);
  return { ok: true, state: next };
}

export function buy(state: BoardState, config: BoardConfig): EngineResult {
  if (state.phase !== 'decide' || !state.pendingSpaceId) return { ok: false, error: 'There is nothing to buy right now.' };
  const space = config.spaces.find((s) => s.id === state.pendingSpaceId);
  if (!space || space.kind !== 'place') return { ok: false, error: 'That space cannot be bought.' };
  if (state.owners[space.id] !== undefined) return { ok: false, error: 'That place is already owned.' };
  const next = clone(state);
  const player = next.players[next.current];
  const price = space.price ?? 0;
  if (player.coins < price) return { ok: false, error: 'Not enough Memory Coins to buy that place.' };
  player.coins -= price;
  next.owners[space.id] = next.current;
  log(next, `${player.name} buys ${space.name} for ${price} Memory Coins.`);
  endTurn(next);
  return { ok: true, state: next };
}

export function declineBuy(state: BoardState): EngineResult {
  if (state.phase !== 'decide' || !state.pendingSpaceId) return { ok: false, error: 'There is no purchase to decline right now.' };
  const next = clone(state);
  log(next, `${next.players[next.current].name} passes on buying.`);
  endTurn(next);
  return { ok: true, state: next };
}

export function proposeTrade(state: BoardState, propertyId: string, price: number): EngineResult {
  if (state.phase !== 'roll') return { ok: false, error: 'Trades are proposed before rolling, not during another decision.' };
  if (state.owners[propertyId] !== state.current) return { ok: false, error: 'You can only trade a place you own.' };
  if (!Number.isInteger(price) || price < 0) return { ok: false, error: 'A trade price must be a whole number of Memory Coins, at least 0.' };
  const next = clone(state);
  next.pendingTrade = { propertyId, price, from: next.current, to: 1 - next.current };
  next.phase = 'trade';
  log(next, `${next.players[next.current].name} offers a place for ${price} Memory Coins.`);
  return { ok: true, state: next };
}

export function respondTrade(state: BoardState, accept: boolean): EngineResult {
  if (state.phase !== 'trade' || !state.pendingTrade) return { ok: false, error: 'There is no trade to answer right now.' };
  const next = clone(state);
  const trade = next.pendingTrade as PendingTrade;
  const buyer = next.players[trade.to];
  const seller = next.players[trade.from];
  if (accept) {
    if (buyer.coins < trade.price) return { ok: false, error: 'The buyer does not have enough Memory Coins for that trade.' };
    buyer.coins -= trade.price;
    seller.coins += trade.price;
    next.owners[trade.propertyId] = trade.to;
    log(next, `${buyer.name} accepts the trade and pays ${trade.price} Memory Coins.`);
  } else {
    log(next, `${buyer.name} declines the trade.`);
  }
  next.pendingTrade = null;
  next.phase = 'roll';
  return { ok: true, state: next };
}

export function endEarly(state: BoardState): EngineResult {
  if (state.phase === 'gameover') return { ok: false, error: 'This game is already over.' };
  const next = clone(state);
  const [a, b] = next.players;
  if (a.coins === b.coins) {
    next.draw = true;
    log(next, 'The game ends early in a draw — both players hold the same Memory Coins.');
  } else {
    next.winner = a.coins > b.coins ? 0 : 1;
    log(next, `The game ends early. ${next.players[next.winner as number].name} holds more Memory Coins and wins.`);
  }
  next.phase = 'gameover';
  return { ok: true, state: next };
}

export const DEFAULT_BOARD: BoardConfig = {
  startCoins: 1000,
  passStartBonus: 200,
  spaces: [
    { id: 's0', kind: 'start', name: 'Home Base', description: 'Start here. Collect 200 Memory Coins every time you pass.' },
    { id: 's1', kind: 'place', name: 'First Coffee Corner', description: 'Where the first coffee turned into a long conversation.', price: 60, rent: 10, category: 'Everyday' },
    { id: 's2', kind: 'place', name: 'The Walk Home Lane', description: 'The slow walk home, every time.', price: 60, rent: 10, category: 'Everyday' },
    { id: 's3', kind: 'plot', name: 'Plot Twist', description: 'Draw a Plot Twist card.' },
    { id: 's4', kind: 'tax', name: 'Rainy Day Fund', description: 'Pay 40 Memory Coins into the rainy-day jar.', amount: 40 },
    { id: 's5', kind: 'place', name: 'Sunday Market', description: 'Stalls, snacks and one shared bag.', price: 100, rent: 20, category: 'Weekend' },
    { id: 's6', kind: 'place', name: 'Blanket Fort', description: 'Built once, remembered always.', price: 100, rent: 20, category: 'Weekend' },
    { id: 's7', kind: 'surprise', name: 'Little Surprise', description: 'Draw a Little Surprise card.' },
    { id: 's8', kind: 'place', name: 'The Old Cinema', description: 'Popcorn, a dark room, a shared film.', price: 140, rent: 30, category: 'Dates' },
    { id: 's9', kind: 'place', name: 'Harbour Lights', description: 'Lights on the water, late at night.', price: 140, rent: 30, category: 'Dates' },
    { id: 's10', kind: 'rest', name: 'Picnic Spot', description: 'Rest here. Nothing happens, and that is the point.' },
    { id: 's11', kind: 'place', name: 'Dream Trip: Kyoto', description: 'A dream destination, still on the list.', price: 180, rent: 40, category: 'Dreams' },
    { id: 's12', kind: 'plot', name: 'Plot Twist', description: 'Draw a Plot Twist card.' },
    { id: 's13', kind: 'tax', name: 'Broken Umbrella', description: 'Pay 60 Memory Coins for a replacement umbrella.', amount: 60 },
    { id: 's14', kind: 'place', name: 'Future Kitchen', description: 'The kitchen you will cook in together one day.', price: 180, rent: 40, category: 'Dreams' },
    { id: 's15', kind: 'surprise', name: 'Little Surprise', description: 'Draw a Little Surprise card.' },
    { id: 's16', kind: 'place', name: 'Starlight Rooftop', description: 'Above the city, under the stars.', price: 220, rent: 50, category: 'Milestones' },
    { id: 's17', kind: 'jail', name: 'Time-Out Corner', description: 'Miss your next turn and rest here.' },
    { id: 's18', kind: 'place', name: 'Our Little Library', description: 'Books read aloud, one chapter at a time.', price: 220, rent: 50, category: 'Milestones' },
    { id: 's19', kind: 'place', name: 'The Place We Met', description: 'The most valuable place on the board, for obvious reasons.', price: 260, rent: 60, category: 'Milestones' },
  ],
  plotTwists: [
    { id: 'p1', title: 'A sudden rain plan', text: 'Plans change, umbrellas fail. Pay 30 Memory Coins.', effect: 'coins', amount: -30 },
    { id: 'p2', title: 'Found an old photo', text: 'In a drawer, a perfect afternoon. Collect 50 Memory Coins.', effect: 'coins', amount: 50 },
    { id: 'p3', title: 'Go to Home Base', text: 'Back to where it all started. Collect the Home Base bonus.', effect: 'moveTo', target: 0 },
    { id: 'p4', title: 'Stay in and rest', text: 'A quiet night in. Miss your next turn.', effect: 'skip' },
    { id: 'p5', title: 'A shared treat', text: 'Your partner treats you. Collect 40 Memory Coins from them.', effect: 'collectPartner', amount: 40 },
    { id: 'p6', title: 'Move forward three', text: 'A small step forward, together. Move 3 spaces.', effect: 'moveBy', amount: 3 },
  ],
  surprises: [
    { id: 'u1', title: 'A note on the fridge', text: 'Left in the morning, found at night. Collect 40 Memory Coins.', effect: 'coins', amount: 40 },
    { id: 'u2', title: 'Shared dessert', text: 'One dessert, two spoons. Collect 20 Memory Coins.', effect: 'coins', amount: 20 },
    { id: 'u3', title: 'A quiet evening in', text: 'No plans, no rush. Collect 30 Memory Coins.', effect: 'coins', amount: 30 },
    { id: 'u4', title: 'An old joke, retold', text: 'Still funny. Collect 60 Memory Coins.', effect: 'coins', amount: 60 },
    { id: 'u5', title: 'Help with a chore', text: 'You pitch in. Pay 20 Memory Coins.', effect: 'coins', amount: -20 },
    { id: 'u6', title: 'Go to the Picnic Spot', text: 'Rest a while. Move to the Picnic Spot.', effect: 'moveTo', target: 10 },
  ],
};

export const BOARD_RULES = `Our Little World — the rules, in full.

Goal: be the last player holding Memory Coins. The other player going bankrupt ends the game, and the remaining player wins.

Setup: both players start at Home Base with the same Memory Coins (default 1,000). Take turns rolling two dice and moving that many spaces around the board, in order.

Passing Home Base: every time you pass Home Base (including by wrapping around the board), collect 200 Memory Coins. Landing exactly on Home Base collects nothing extra.

Places and Moments: landing on an unowned place lets you buy it for its price, or pass. Landing on a place owned by your partner means you pay its rent to them. Owning every place in a category doubles the rent on each place in that category. You cannot buy a place you cannot afford, and you cannot buy a place that is already owned.

Plot Twists and Little Surprises: draw the next card in that deck (decks cycle in order, they are not shuffled, so the game stays deterministic). Follow the card exactly: collect or pay Memory Coins, move, miss a turn, or move to a named space. A card that moves you does not trigger the landing effect of the space you arrive on.

Rainy Day Fund and Broken Umbrella: pay the stated amount to the bank.

Picnic Spot: rest. Nothing happens, and that is the point.

Time-Out Corner: miss your next turn, then play normally.

Trades: before rolling, the current player may offer one place they own to their partner for a price. The partner accepts (paying that price, if they can afford it) or declines. A trade does not use up your turn — you may still roll afterwards.

Bankruptcy: if you cannot pay rent, a tax, or a card payment in full, you pay what you have, return all your places to the bank, and go bankrupt. Your partner wins immediately.

Ending early: either player may end the game early at any time; the player holding more Memory Coins wins, and equal coins is a draw. This is a house rule for a shorter game, and it is the only way to win without a bankruptcy.

Turn order and fairness: only the current player may roll, buy, pass or propose a trade, and only the other player may answer a trade. The game refuses every other action, and the server (when you play through an account) re-checks each action against the saved game before applying it — it never accepts a balance or an ownership list sent by a device at face value.

Online multiplayer is NOT part of this release: this is a local two-player game on one device. If a future version adds it, it will need real-time synchronization and conflict handling, and it will be tested before it is claimed.`;
