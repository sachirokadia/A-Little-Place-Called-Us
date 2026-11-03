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
 * event cards, bankruptcy) but uses no branded board layout, logo,
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
  /** Phase 15 — board name, inside the existing board game-config JSON.
   *  Older saved configs have no name and the game falls back to
   *  'Our Little World'. No table, column or migration is involved. */
  name?: string;
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

function bankrupt(state: BoardState, playerIndex: number, gameName: string): void {
  const p = state.players[playerIndex];
  p.coins = 0;
  p.bankrupt = true;
  for (const [spaceId, owner] of Object.entries(state.owners)) {
    if (owner === playerIndex) delete state.owners[spaceId];
  }
  const other = 1 - playerIndex;
  state.winner = state.players[other].bankrupt ? null : other;
  state.phase = 'gameover';
  log(state, `${p.name} is out of Memory Coins and bankrupt. ${state.players[other].name} wins ${gameName}.`);
}

/** Pay `amount` from `from` to the bank (to = -1) or to a player. Returns false if it bankrupts the payer. */
function pay(state: BoardState, from: number, to: number, amount: number, reason: string, gameName = BOARD_NAME_FALLBACK): boolean {
  const payer = state.players[from];
  if (amount <= 0) return true;
  if (payer.coins < amount) {
    const paid = payer.coins;
    if (to >= 0) state.players[to].coins += paid;
    log(state, `${payer.name} pays ${paid} Memory Coins for ${reason} and cannot pay the rest.`);
    bankrupt(state, from, gameName);
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
  // Phase 15 fix: an unowned place has no owner, and "nobody owns any
  // place in the category" must not count as one owner owning them all
  // (every undefined === undefined made the board display doubled rent
  // for unowned places). Rent is only charged on owned places, so this
  // changed displayed rents, not charged rent — but the display was wrong.
  if (owner === undefined) return false;
  return siblings.every((s) => state.owners[s.id] === owner);
}

export function rentFor(state: BoardState, config: BoardConfig, space: BoardSpace): number {
  const base = space.rent ?? 0;
  return categoryBonus(state, config, space) ? base * 2 : base;
}

export function createBoardGame(config: BoardConfig, players: { name: string; token: string }[]): EngineResult {
  if (config.spaces.length < 8) return { ok: false, error: 'A board needs at least 8 spaces.' };
  if (config.startCoins <= 0) return { ok: false, error: 'Starting Memory Coins must be positive.' };
  if (players.length !== 2) return { ok: false, error: `${boardName(config)} is a two-player game.` };
  if (!config.spaces.some((s) => s.kind === 'start')) return { ok: false, error: 'The board needs a Home Base start space.' };
  const state: BoardState = {
    players: players.map((p) => ({ name: p.name.trim() || 'Player', token: p.token, coins: config.startCoins, position: 0, skipTurns: 0, bankrupt: false })),
    current: 0,
    phase: 'roll',
    dice: null,
    pendingSpaceId: null,
    pendingTrade: null,
    owners: {},
    log: [`${boardName(config)} begins. Both players start at Home Base.`],
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
      if (amount > 0 && !pay(state, state.current, -1, amount, space.name, boardName(config))) return;
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
        if (!pay(state, state.current, owner, rent, `rent for ${space.name}${categoryBonus(state, config, space) ? ' (category bonus: rent doubled)' : ''}`, boardName(config))) return;
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
      else if (!pay(state, me, -1, -amount, card.title, boardName(config))) return;
      break;
    }
    case 'payPartner': {
      const amount = card.amount ?? 0;
      if (!pay(state, me, other, amount, card.title, boardName(config))) return;
      break;
    }
    case 'collectPartner': {
      const amount = card.amount ?? 0;
      if (!pay(state, other, me, amount, card.title, boardName(config))) {
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

export const BOARD_RULES = `Our Little World — the rules, in full, as implemented.

Goal: be the last player holding Memory Coins. The other player going bankrupt ends the game, and the remaining player wins.

Setup: both players start at Home Base with the same Memory Coins (default 1,000). Take turns rolling two dice and moving that many spaces around the board, in order. There are 20 spaces on the default board.

Space types (the default board has exactly these):
- Home Base (1): the start space. See 'Passing Home Base' below.
- Places and Moments (11): buyable properties, grouped into categories (Everyday, Weekend, Dates, Dreams, Milestones). See below.
- Plot Twist (2) and Little Surprise (2): draw the next card from that deck. See below.
- Rainy Day Fund and Broken Umbrella (2 tax spaces): pay the stated amount to the bank (40 and 60 Memory Coins on the default board).
- Picnic Spot (1 rest space): nothing happens, and that is the point.
- Time-Out Corner (1): miss your next turn, then play normally.

Passing Home Base: every time you pass Home Base, collect 200 Memory Coins. Landing exactly on Home Base after wrapping around the board also collects the 200 — wrapping counts as passing. (An earlier version of these rules said landing exactly on Home Base collected nothing extra; that was wrong, and the engine has always paid the bonus on a wrap.)

Places and Moments: landing on an unowned place lets you buy it for its price, or pass. Landing on a place you already own does nothing. Landing on a place owned by your partner means you pay its rent to them. Default prices run 60 to 260 Memory Coins and default rents 10 to 60. Owning every place in a category doubles the rent on each place in that category. You cannot buy a place you cannot afford — if you land on one you cannot afford, your turn simply ends — and you cannot buy a place that is already owned.

Plot Twists and Little Surprises: draw the next card in that deck. Decks cycle in order, they are not shuffled, so the game stays deterministic. Follow the card exactly: collect or pay Memory Coins, pay your partner or collect from them, move to a named space, move forward a number of spaces, or miss a turn. A card that moves you does not trigger the landing effect of the space you arrive on. A card that moves you to Home Base from a later space collects the Home Base bonus; a card that moves you forward past Home Base collects it too. There are 6 Plot Twist cards and 6 Little Surprise cards on the default board.

Rainy Day Fund and Broken Umbrella: pay the stated amount to the bank.

Picnic Spot: rest. Nothing happens.

Time-Out Corner, and cards that make you miss a turn: on your next turn, roll (any dice) to spend the skipped turn — the roll is consumed and you do not move. Then you play normally.

Trades: before rolling, the current player may offer one place they own to their partner for a price (any whole number of Memory Coins, 0 or more). The partner accepts (paying that price, if they can afford it) or declines. A trade does not use up your turn — you may still roll afterwards. A trade can only be proposed before rolling, and only the other player may answer it.

Bankruptcy: if you cannot pay rent, a tax, or a card payment in full, you pay what you have, return all your places to the bank (they become buyable again), and go bankrupt. Your partner wins immediately. A bankrupt player cannot roll.

Ending early: either player may end the game early at any time; the player holding more Memory Coins wins, and equal coins is a draw. This is a house rule for a shorter game, and it is the only way to win without a bankruptcy.

What if neither player can complete an action? There is no reachable stuck state in this engine, and no ambiguous case is left open: in the roll phase you can always roll; in the buy phase you can always buy or pass; in a trade phase the partner can always accept or decline; a skipped turn is always spent by rolling. If a game ever feels stuck, End game early is always available and settles it by coins (or a draw).

Turn order and fairness: only the current player may roll, buy, pass or propose a trade, and only the other player may answer a trade. The game refuses every other action: rolling outside the roll phase, buying outside the buy phase, buying an already-owned place, a trade for a place you do not own, and dice outside 1–6 are all rejected with an error, and no state changes.

How moves are checked, per mode:
- API server mode: the device sends only an action (roll with two dice values, buy, pass, trade, trade answer, end early) plus the version it last saw. The server loads the saved game, re-runs the same engine from that saved state, and writes the new state with version + 1 only if the version still matches. A balance or ownership list sent by a device is never accepted, and a stale version is refused (409). This is the validated path. One limit even here: dice values come from the device and are only range-checked (1–6 each), so a fair roll cannot be proved server-side.
- Signed-in database mode without the API server: the device runs the engine locally and writes only where the version still matches what it read, so a stale update writes nothing. But moves are NOT re-validated server-side: a space member with direct database access can submit one forged step (version advanced by exactly 1, config unchanged, finished games untouched) and it will be accepted. Board results in this mode are therefore NOT tamper-proof, and must never be presented as such.
- Demo mode: the same engine plus a version check, in this browser's localStorage, on one device for both local players. Nothing here is validated by anyone else, and a second tab with an older copy is refused as stale rather than overwriting.

Multiplayer, in plain words: this is turn-based shared state, not live multiplayer. In a signed-in space, both partners open the same saved game; one moves, the other presses 'Reload saved game' to see it. Moves do not appear live — refresh to see your partner's move. Either member may act for either player slot; turns are not tied to accounts. In demo mode the game lives on this device only and the partner must play on this device.

Game history: every game keeps a move log (the last 50 entries; the screen shows the most recent 12). In signed-in modes each accepted move is also recorded in the moves table, but there is no completed-games list in the game screen — only the current or most recent game is shown. In demo mode there is no move history beyond the current game's log, and starting a new game replaces the saved one.

Save and resume: the game is saved after every accepted action, including mid-decision (buy choice, trade answer) states, so reloading or reopening the game resumes exactly where it left off. Replay and reset: start a new game at any time from the intro or the playing screen; a finished game stays visible as 'the last game finished' until a new one is started.

Customisation: the board name, every space name and description, every place price, rent and category, every tax amount, every card's title, text, effect and amount, the starting Memory Coins and the Home Base bonus are all editable in the board editor and apply to the next new game, never to a game already in progress (that game keeps its own snapshot). Player names and tokens are chosen per game. Spaces cannot be added, removed or re-typed in the editor, and there is no configurable win condition — bankruptcy and end-early are the fixed endings.`;

export const BOARD_NAME_FALLBACK = 'Our Little World';

export function boardName(config: BoardConfig): string {
  const name = (config.name ?? '').trim();
  return name || BOARD_NAME_FALLBACK;
}
