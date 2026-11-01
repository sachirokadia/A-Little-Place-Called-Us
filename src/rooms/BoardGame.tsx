import { useEffect, useState } from 'react';
import type { PlaceStore } from '../lib/store';
import type { GameData } from '../lib/games';
import { DEFAULT_BOARD, BOARD_RULES, rentFor } from '../lib/boardGame';
import type { BoardConfig, BoardSpace, EventCard } from '../lib/boardGame';
import type { SavedBoardGame, BoardAction } from '../lib/boardStore';
import { loadBoardGame, createBoardGameSaved, applyBoardAction } from '../lib/boardStore';
import { saveGameConfig } from '../lib/games';
import { Card, Button, Field, inputCls, ConfirmDelete } from '../components/ui';

type Props = {
  store: PlaceStore;
  data: GameData;
  reload: () => Promise<void>;
  notify: (m: string, k?: 'ok' | 'error') => void;
  onBackToArcade: () => void;
};

/**
 * Phase 7 — "Our Little World", a complete original property-trading
 * board game for two local players on one device.
 *
 * No Monopoly branding, logo, board artwork, card text or branded
 * assets are used: currency is Memory Coins, cards are Plot Twists and
 * Little Surprises, properties are Places and Moments, and every name
 * and rule here is written for this game.
 *
 * The engine (src/lib/boardGame.ts) is pure and deterministic; this
 * component only renders it and sends actions. Online multiplayer is
 * NOT claimed: both players play on this device, in turn, and the
 * saved game is one row with a version, so a stale update is refused
 * rather than silently overwriting a newer one.
 */

// Perimeter positions for a 20-space board on a 6x6 grid, clockwise
// from the top-left corner.
function boardPosition(index: number): { row: number; col: number } {
  if (index < 6) return { row: 0, col: index };
  if (index < 11) return { row: index - 5, col: 5 };
  if (index < 16) return { row: 5, col: 15 - index };
  return { row: 20 - index, col: 0 };
}

const TOKENS = ['★', '♥', '☾', '✿', '◆', '●'];
const CATEGORY_BG: Record<string, string> = {
  Everyday: 'bg-butter', Weekend: 'bg-sage', Dates: 'bg-rose', Dreams: 'bg-powder', Milestones: 'bg-lilac',
};

export function BoardGame({ store, data, reload, notify, onBackToArcade }: Props) {
  const sharedConfig: BoardConfig = data.configs.board ?? DEFAULT_BOARD;
  const [screen, setScreen] = useState<'intro' | 'setup' | 'playing'>('intro');
  const [showRules, setShowRules] = useState(false);
  const [editing, setEditing] = useState(false);
  const [game, setGame] = useState<SavedBoardGame | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [p1, setP1] = useState({ name: 'You', token: '★' });
  const [p2, setP2] = useState({ name: 'Partner', token: '♥' });
  const [editConfig, setEditConfig] = useState<BoardConfig>(sharedConfig);
  const [tradeProperty, setTradeProperty] = useState('');
  const [tradePrice, setTradePrice] = useState('50');

  const refreshGame = async () => {
    try { setGame(await loadBoardGame(store)); } catch { /* no saved game yet */ }
    setLoading(false);
  };
  useEffect(() => { refreshGame(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const doAction = async (action: BoardAction) => {
    if (!game || busy) return;
    setBusy(true);
    try {
      const next = await applyBoardAction(store, game, action);
      setGame(next);
      if (next.state.phase === 'gameover') notify(next.state.draw ? 'The game ends in a draw.' : `${next.state.players[next.state.winner ?? 0].name} wins Our Little World.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'That move could not be saved.';
      notify(msg, 'error');
      if (msg.includes('changed since you last saw it')) await refreshGame();
    }
    setBusy(false);
  };

  const rollDice = () => {
    const d1 = 1 + Math.floor(Math.random() * 6);
    const d2 = 1 + Math.floor(Math.random() * 6);
    doAction({ action: 'roll', d1, d2 });
  };

  const startGame = async () => {
    setBusy(true);
    try {
      const next = await createBoardGameSaved(store, sharedConfig, [p1, p2]);
      setGame(next); setScreen('playing');
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not start a game.', 'error'); }
    setBusy(false);
  };

  const saveSharedConfig = async () => {
    // Validate before saving: the engine will reject a bad board, but
    // check the obvious problems here so the editor explains them.
    if (editConfig.spaces.length < 8) return notify('A board needs at least 8 spaces.', 'error');
    if (editConfig.spaces.some((s) => s.kind === 'place' && ((s.price ?? 0) <= 0 || (s.rent ?? 0) < 0))) {
      return notify('Every place needs a price above 0 and a rent of 0 or more.', 'error');
    }
    if (editConfig.startCoins <= 0) return notify('Starting Memory Coins must be positive.', 'error');
    try {
      await saveGameConfig(store, 'board', editConfig);
      await reload(); setEditing(false); notify('Board configuration saved. It applies to the next new game, not to a game already in progress.');
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not save the board.', 'error'); }
  };

  const state = game?.state ?? null;
  const currentPlayer = state ? state.players[state.current] : null;
  const pendingSpace: BoardSpace | undefined = state?.pendingSpaceId ? game?.config.spaces.find((s) => s.id === state.pendingSpaceId) : undefined;

  const updateSpace = (idx: number, patch: Partial<BoardSpace>) => {
    const spaces = [...editConfig.spaces];
    spaces[idx] = { ...spaces[idx], ...patch };
    setEditConfig({ ...editConfig, spaces });
  };
  const updateCard = (deck: 'plotTwists' | 'surprises', idx: number, patch: Partial<EventCard>) => {
    const cards = [...editConfig[deck]];
    cards[idx] = { ...cards[idx], ...patch };
    setEditConfig({ ...editConfig, [deck]: cards });
  };

  return (
    <div>
      {screen === 'intro' && (
        <Card>
          <p className="text-3xl" aria-hidden="true">▦</p>
          <h2 className="font-serif-display mt-2 text-2xl">Our Little World</h2>
          <p className="mt-2 text-sm leading-relaxed text-cocoa-soft">
            A property-trading board game about your places, memories, inside jokes, dream destinations and future plans.
            Two players, one device, taking turns. Currency is Memory Coins; event cards are Plot Twists and Little Surprises;
            properties are Places and Moments. Nothing here uses Monopoly branding, artwork or card text.
          </p>
          <p className="mt-2 text-sm text-cocoa-soft">
            <strong>Local two-player only in this release.</strong> Online multiplayer is not claimed: it would need
            real-time synchronization and conflict handling, and it has not been built or tested here.
          </p>
          {game && state && state.phase !== 'gameover' && (
            <p className="mt-3 rounded-2xl bg-butter p-3 text-sm">
              A saved game is waiting: {state.players[0].name} ({state.players[0].coins} coins) vs {state.players[1].name} ({state.players[1].coins} coins), turn {state.turn + 1}.
            </p>
          )}
          {game && state && state.phase === 'gameover' && (
            <p className="mt-3 rounded-2xl bg-butter p-3 text-sm">
              The last game finished: {state.draw ? 'a draw' : `${state.players[state.winner ?? 0].name} won`}. Start a new one below.
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {game && state && state.phase !== 'gameover' && <Button onClick={() => setScreen('playing')}>Continue saved game</Button>}
            <Button onClick={() => setScreen('setup')}>{game && state && state.phase !== 'gameover' ? 'Start a new game' : 'Start a game'}</Button>
            <Button variant="quiet" onClick={() => setShowRules(!showRules)}>{showRules ? 'Hide the rules' : 'Read the rules first'}</Button>
            <Button variant="quiet" onClick={() => { setEditConfig(sharedConfig); setEditing(!editing); }}>{editing ? 'Hide board editor' : 'Edit the board'}</Button>
          </div>
          {showRules && (
            <div className="mt-4 rounded-2xl border border-cocoa/20 bg-paper p-4">
              <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-cocoa">{BOARD_RULES}</pre>
            </div>
          )}
          {editing && <BoardEditor editConfig={editConfig} setEditConfig={setEditConfig} updateSpace={updateSpace} updateCard={updateCard} onSave={saveSharedConfig} store={store} />}
        </Card>
      )}

      {screen === 'setup' && (
        <Card>
          <h2 className="font-serif-display text-2xl">Who is playing?</h2>
          <p className="mt-1 text-sm text-cocoa-soft">Two players on this device. Names and tokens are yours to choose; they are saved with this game only.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="space-y-3">
              <Field label="Player 1 name"><input value={p1.name} onChange={(e) => setP1({ ...p1, name: e.target.value })} className={inputCls} maxLength={40} /></Field>
              <Field label="Player 1 token"><select value={p1.token} onChange={(e) => setP1({ ...p1, token: e.target.value })} className={inputCls}>{TOKENS.map((t) => <option key={t} value={t}>{t}</option>)}</select></Field>
            </div>
            <div className="space-y-3">
              <Field label="Player 2 name"><input value={p2.name} onChange={(e) => setP2({ ...p2, name: e.target.value })} className={inputCls} maxLength={40} /></Field>
              <Field label="Player 2 token"><select value={p2.token} onChange={(e) => setP2({ ...p2, token: e.target.value })} className={inputCls}>{TOKENS.map((t) => <option key={t} value={t}>{t}</option>)}</select></Field>
            </div>
          </div>
          <p className="mt-3 text-xs text-cocoa-soft">Board: {sharedConfig.spaces.length} spaces, {sharedConfig.startCoins} starting Memory Coins, {sharedConfig.passStartBonus} for passing Home Base. Edit the board from the intro screen to change it.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={startGame} disabled={busy}>{busy ? 'Starting…' : 'Begin Our Little World'}</Button>
            <Button variant="quiet" onClick={() => setScreen('intro')}>Back</Button>
          </div>
        </Card>
      )}

      {screen === 'playing' && state && game && (
        <div>
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-serif-display text-2xl">Our Little World</h2>
              <span className="flex flex-wrap gap-2">
                <Button variant="quiet" onClick={refreshGame}>Reload saved game</Button>
                <Button variant="quiet" onClick={() => setScreen('setup')}>New game</Button>
                <Button variant="quiet" onClick={onBackToArcade}>Back to the arcade</Button>
              </span>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {state.players.map((pl, i) => (
                <div key={i} className={`rounded-2xl border p-3 ${i === state.current && state.phase !== 'gameover' ? 'border-cocoa/60 bg-butter' : 'border-cocoa/20 bg-paper'}`}>
                  <p className="font-serif-display text-xl">{pl.token} {pl.name}{i === state.current && state.phase !== 'gameover' ? ' — your turn' : ''}{pl.bankrupt ? ' — bankrupt' : ''}</p>
                  <p className="text-sm text-cocoa-soft">{pl.coins} Memory Coins · on {game.config.spaces[pl.position]?.name ?? 'Home Base'}{pl.skipTurns > 0 ? ` · misses ${pl.skipTurns} turn${pl.skipTurns === 1 ? '' : 's'}` : ''}</p>
                  <p className="text-xs text-cocoa-soft">Owns: {Object.entries(state.owners).filter(([, o]) => o === i).map(([id]) => game.config.spaces.find((s) => s.id === id)?.name).filter(Boolean).join(', ') || 'nothing yet'}</p>
                </div>
              ))}
            </div>
            {state.phase === 'gameover' && (
              <p className="font-serif-display mt-4 text-2xl" role="status">
                {state.draw ? 'It is a draw — both players hold the same Memory Coins.' : `${state.players[state.winner ?? 0].name} wins Our Little World!`}
              </p>
            )}
            {state.phase !== 'gameover' && currentPlayer && (
              <p className="mt-3 text-sm" aria-live="polite">
                Turn {state.turn + 1}: {currentPlayer.name}'s turn.
                {state.dice ? ` Last roll: ${state.dice[0]} + ${state.dice[1]} = ${state.dice[0] + state.dice[1]}.` : ''}
                {currentPlayer.skipTurns > 0 ? ` ${currentPlayer.name} must rest this turn — roll to skip it.` : ''}
              </p>
            )}
            {state.lastCard && (
              <div className="mt-3 rounded-2xl border border-dashed border-cocoa/40 bg-paper p-4" role="status">
                <p className="text-xs text-cocoa-soft">Last card drawn</p>
                <p className="font-serif-display mt-1 text-xl">{state.lastCard.title}</p>
                <p className="text-sm leading-relaxed text-cocoa-soft">{state.lastCard.text}</p>
              </div>
            )}
          </Card>

          <Card className="mt-4">
            <div className="grid grid-cols-6 gap-1.5" role="grid" aria-label="Our Little World board">
              {game.config.spaces.map((space, idx) => {
                const pos = boardPosition(idx);
                const owner = state.owners[space.id];
                const here = state.players.map((pl, i) => (pl.position === idx ? i : -1)).filter((i) => i >= 0);
                return (
                  <div key={space.id} role="gridcell" aria-label={`${space.name}${space.kind === 'place' ? `, ${space.price} Memory Coins, rent ${rentFor(state, game.config, space)}` : ''}${owner !== undefined ? `, owned by ${state.players[owner].name}` : ''}`}
                    className={`min-h-16 rounded-xl border p-1.5 text-left ${space.kind === 'place' ? (CATEGORY_BG[space.category ?? ''] ?? 'bg-paper') : 'bg-paper'} ${owner !== undefined ? 'border-cocoa/60' : 'border-cocoa/20'}`}
                    style={{ gridRow: pos.row + 1, gridColumn: pos.col + 1 }}>
                    <p className="text-[11px] font-bold leading-tight sm:text-xs">{space.name}</p>
                    {space.kind === 'place' && <p className="text-[10px] leading-tight text-cocoa-soft">{space.price} coins · rent {rentFor(state, game.config, space)}</p>}
                    {space.kind === 'tax' && <p className="text-[10px] leading-tight text-cocoa-soft">Pay {space.amount}</p>}
                    {owner !== undefined && <p className="text-[10px] font-bold leading-tight">Owned: {state.players[owner].token} {state.players[owner].name}</p>}
                    {here.length > 0 && <p className="text-sm leading-tight" aria-hidden="true">{here.map((i) => state.players[i].token).join(' ')}</p>}
                  </div>
                );
              })}
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-cocoa/30 bg-cream p-2 text-center" style={{ gridRow: '2 / 6', gridColumn: '2 / 6' }}>
                <p className="font-serif-display text-xl">Our Little World</p>
                <p className="mt-1 text-xs leading-relaxed text-cocoa-soft">Memory Coins · Plot Twists · Little Surprises<br />{game.config.spaces.length} spaces · {state.turn + 1} turns played</p>
                {state.dice && <p className="mt-2 text-3xl" aria-hidden="true">{state.dice[0]} + {state.dice[1]}</p>}
              </div>
            </div>

            {state.phase !== 'gameover' && (
              <div className="mt-4 flex flex-wrap gap-2">
                <Button onClick={rollDice} disabled={busy || state.phase !== 'roll'}>{busy ? 'Saving…' : currentPlayer?.skipTurns ? 'Roll to rest this turn' : 'Roll the dice'}</Button>
                {state.phase === 'decide' && pendingSpace && (
                  <>
                    <Button onClick={() => doAction({ action: 'buy' })} disabled={busy}>Buy {pendingSpace.name} ({pendingSpace.price} coins)</Button>
                    <Button variant="quiet" onClick={() => doAction({ action: 'pass' })} disabled={busy}>Pass on buying</Button>
                  </>
                )}
                <Button variant="quiet" onClick={() => doAction({ action: 'endEarly' })} disabled={busy}>End game early (winner by coins)</Button>
              </div>
            )}
            {state.phase === 'trade' && state.pendingTrade && (
              <div className="mt-3 rounded-2xl border border-cocoa/30 bg-paper p-3">
                <p className="text-sm">
                  {state.players[state.pendingTrade.from].name} offers {game.config.spaces.find((s) => s.id === state.pendingTrade?.propertyId)?.name} to {state.players[state.pendingTrade.to].name} for {state.pendingTrade.price} Memory Coins.
                  {state.players[state.pendingTrade.to].name}, do you accept?
                </p>
                <div className="mt-2 flex gap-2">
                  <Button onClick={() => doAction({ action: 'tradeRespond', accept: true })} disabled={busy}>Accept trade</Button>
                  <Button variant="quiet" onClick={() => doAction({ action: 'tradeRespond', accept: false })} disabled={busy}>Decline trade</Button>
                </div>
              </div>
            )}
            {state.phase === 'roll' && !state.pendingTrade && (
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <Field label="Trade a place you own"><select value={tradeProperty} onChange={(e) => setTradeProperty(e.target.value)} className={inputCls}>
                  <option value="">Choose a place…</option>
                  {Object.entries(state.owners).filter(([, o]) => o === state.current).map(([id]) => {
                    const sp = game.config.spaces.find((s) => s.id === id);
                    return sp ? <option key={id} value={id}>{sp.name}</option> : null;
                  })}
                </select></Field>
                <Field label="Trade price (Memory Coins)"><input type="number" min={0} value={tradePrice} onChange={(e) => setTradePrice(e.target.value)} className={inputCls} /></Field>
                <Button variant="quiet" disabled={!tradeProperty || busy} onClick={() => doAction({ action: 'trade', propertyId: tradeProperty, price: Number(tradePrice) })}>Offer trade</Button>
              </div>
            )}
            <div className="mt-4">
              <p className="text-xs font-bold text-cocoa-soft">Game log</p>
              <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto text-xs leading-relaxed text-cocoa-soft">
                {[...state.log].reverse().slice(0, 12).map((entry, i) => <li key={i}>{entry}</li>)}
              </ul>
            </div>
          </Card>
        </div>
      )}

      {screen === 'playing' && !state && !loading && (
        <Card><p className="text-sm text-cocoa-soft">No saved game was found. Go back and start a new one.</p><div className="mt-3"><Button variant="quiet" onClick={() => setScreen('intro')}>Back to intro</Button></div></Card>
      )}
      {loading && screen === 'intro' && <p className="mt-2 text-sm text-cocoa-soft">Loading any saved game…</p>}
    </div>
  );
}

function BoardEditor({ editConfig, setEditConfig, updateSpace, updateCard, onSave, store }: {
  editConfig: BoardConfig;
  setEditConfig: (c: BoardConfig) => void;
  updateSpace: (idx: number, patch: Partial<BoardSpace>) => void;
  updateCard: (deck: 'plotTwists' | 'surprises', idx: number, patch: Partial<EventCard>) => void;
  onSave: () => void;
  store: PlaceStore;
}) {
  const sharedMemories = store.shared(store.data.memories);
  return (
    <div className="mt-4 space-y-4 rounded-2xl border border-cocoa/20 bg-paper p-4">
      <h3 className="font-serif-display text-xl">Edit the board (shared configuration)</h3>
      <p className="text-sm text-cocoa-soft">Both partners read this same configuration. Changes apply to the next new game, never to a game already in progress (that game keeps its own snapshot).</p>
      <p className="text-sm leading-relaxed text-cocoa-soft">These are starter places — rename them to your real places, memories, inside jokes, and dream destinations. Nothing here is your real history until you write it.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Starting Memory Coins"><input type="number" min={1} value={editConfig.startCoins} onChange={(e) => setEditConfig({ ...editConfig, startCoins: Number(e.target.value) })} className={inputCls} /></Field>
        <Field label="Home Base bonus"><input type="number" min={0} value={editConfig.passStartBonus} onChange={(e) => setEditConfig({ ...editConfig, passStartBonus: Number(e.target.value) })} className={inputCls} /></Field>
      </div>
      <div className="space-y-3">
        {editConfig.spaces.map((space, idx) => (
          <div key={space.id} className="space-y-2 rounded-2xl border border-cocoa/15 p-3">
            <p className="text-xs font-bold text-cocoa-soft">Space {idx + 1} · {space.kind}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Name"><input value={space.name} onChange={(e) => updateSpace(idx, { name: e.target.value })} className={inputCls} maxLength={60} /></Field>
              <Field label="Description"><input value={space.description} onChange={(e) => updateSpace(idx, { description: e.target.value })} className={inputCls} maxLength={200} /></Field>
            </div>
            {space.kind === 'place' && (
              <div className="grid gap-2 sm:grid-cols-3">
                <Field label="Price"><input type="number" min={1} value={space.price ?? 0} onChange={(e) => updateSpace(idx, { price: Number(e.target.value) })} className={inputCls} /></Field>
                <Field label="Rent"><input type="number" min={0} value={space.rent ?? 0} onChange={(e) => updateSpace(idx, { rent: Number(e.target.value) })} className={inputCls} /></Field>
                <Field label="Category"><input value={space.category ?? ''} onChange={(e) => updateSpace(idx, { category: e.target.value })} className={inputCls} maxLength={30} /></Field>
              </div>
            )}
            {space.kind === 'tax' && (
              <Field label="Amount to pay"><input type="number" min={0} value={space.amount ?? 0} onChange={(e) => updateSpace(idx, { amount: Number(e.target.value) })} className={inputCls} /></Field>
            )}
            {space.kind === 'place' && (
              <Field label="Shared photo / memory (optional)"><select value={space.memoryId ?? ''} onChange={(e) => updateSpace(idx, { memoryId: e.target.value || null })} className={inputCls}>
                <option value="">No photo</option>
                {sharedMemories.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
              </select></Field>
            )}
          </div>
        ))}
      </div>
      {(['plotTwists', 'surprises'] as const).map((deck) => (
        <div key={deck} className="space-y-3">
          <h4 className="font-serif-display text-lg">{deck === 'plotTwists' ? 'Plot Twist cards' : 'Little Surprise cards'}</h4>
          {editConfig[deck].map((card, idx) => (
            <div key={card.id} className="space-y-2 rounded-2xl border border-cocoa/15 p-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="Title"><input value={card.title} onChange={(e) => updateCard(deck, idx, { title: e.target.value })} className={inputCls} maxLength={80} /></Field>
                <Field label="Text"><input value={card.text} onChange={(e) => updateCard(deck, idx, { text: e.target.value })} className={inputCls} maxLength={200} /></Field>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <Field label="Effect"><select value={card.effect} onChange={(e) => updateCard(deck, idx, { effect: e.target.value as EventCard['effect'] })} className={inputCls}>
                  <option value="coins">Collect / pay Memory Coins</option>
                  <option value="moveTo">Move to a space</option>
                  <option value="moveBy">Move forward spaces</option>
                  <option value="skip">Miss a turn</option>
                  <option value="jail">Time-Out Corner</option>
                  <option value="payPartner">Pay your partner</option>
                  <option value="collectPartner">Collect from your partner</option>
                </select></Field>
                <Field label="Amount"><input type="number" value={card.amount ?? 0} onChange={(e) => updateCard(deck, idx, { amount: Number(e.target.value) })} className={inputCls} /></Field>
                {card.effect === 'moveTo' && (
                  <Field label="Move to space"><select value={card.target ?? 0} onChange={(e) => updateCard(deck, idx, { target: Number(e.target.value) })} className={inputCls}>
                    {editConfig.spaces.map((s, i) => <option key={s.id} value={i}>{s.name}</option>)}
                  </select></Field>
                )}
              </div>
              <ConfirmDelete label="Remove card" note="Remove this card for good? This cannot be undone." confirmLabel="Yes, remove" onConfirm={() => {
                const cards = editConfig[deck].filter((_, i) => i !== idx);
                setEditConfig({ ...editConfig, [deck]: cards });
              }} />
            </div>
          ))}
          <Button variant="quiet" onClick={() => {
            const cards = [...editConfig[deck], { id: `${deck}-${Date.now()}`, title: 'A new card', text: 'Write what happens.', effect: 'coins' as const, amount: 20 }];
            setEditConfig({ ...editConfig, [deck]: cards });
          }}>Add a card</Button>
        </div>
      ))}
      <Button onClick={onSave}>Save board configuration</Button>
    </div>
  );
}
