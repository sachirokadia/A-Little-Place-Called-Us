import type { PlaceStore } from './store';
import type { BoardConfig, BoardState } from './boardGame';
import { createBoardGame, roll, buy, declineBuy, proposeTrade, respondTrade, endEarly } from './boardGame';
import { supabase } from './supabase';
import { apiFetch } from './api';

/**
 * Phase 7 persistence for "Our Little World".
 *
 * Two stores, kept separate on purpose:
 *  - The shared board configuration (game_configs, key 'board') — either
 *    partner may edit it, and both partners read the same config. A game
 *    in progress is NOT affected by later config edits, because a game
 *    snapshots its config at creation (board_games.config).
 *  - The game itself (board_games + board_game_moves) — one row per game,
 *    with a version that increments on every accepted action.
 *
 * Validation, by mode:
 *  - API: the client sends only an ACTION (roll with two dice values,
 *    buy, pass, trade, trade answer, end early) plus the version it
 *    last saw. The server loads the stored state, re-runs the engine
 *    from that state, and only then writes the new state with
 *    version+1. A client-sent balance or ownership list is never
 *    accepted. A version mismatch is a 409: the client reloads and
 *    retries, so two conflicting updates cannot both land.
 *  - Supabase: the client runs the same engine locally, then updates
 *    the row only where version still matches what it read. A stale
 *    update writes nothing, and the client reloads. RLS already limits
 *    rows to space members, but this mode does NOT re-validate moves
 *    server-side — the API mode is the validated path, and online
 *    multiplayer is not claimed in either mode.
 *  - Demo: the same engine + version check, in localStorage, on one
 *    device for both local players.
 *
 * Local two-player mode is the only multiplayer in this release.
 * Both local players share one device and one game row; the two
 * player slots are names/tokens, not two accounts.
 */

export interface SavedBoardGame {
  id: string;
  config: BoardConfig;
  state: BoardState;
  version: number;
  status: 'active' | 'finished';
}

const DEMO_KEY = 'our-place-board-v1';

export type BoardAction =
  | { action: 'roll'; d1: number; d2: number }
  | { action: 'buy' }
  | { action: 'pass' }
  | { action: 'trade'; propertyId: string; price: number }
  | { action: 'tradeRespond'; accept: boolean }
  | { action: 'endEarly' };

function applyLocalAction(state: BoardState, config: BoardConfig, a: BoardAction) {
  switch (a.action) {
    case 'roll': return roll(state, config, a.d1, a.d2);
    case 'buy': return buy(state, config);
    case 'pass': return declineBuy(state);
    case 'trade': return proposeTrade(state, a.propertyId, a.price);
    case 'tradeRespond': return respondTrade(state, a.accept);
    case 'endEarly': return endEarly(state);
  }
}

function loadDemo(): SavedBoardGame | null {
  try {
    const raw = localStorage.getItem(DEMO_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedBoardGame;
    if (parsed && parsed.state && parsed.config) return parsed;
  } catch { /* ignore */ }
  return null;
}

function saveDemo(game: SavedBoardGame) {
  try { localStorage.setItem(DEMO_KEY, JSON.stringify(game)); } catch { /* ignore */ }
}

export async function loadBoardGame(store: PlaceStore): Promise<SavedBoardGame | null> {
  if (store.mode === 'demo') return loadDemo();
  if (store.mode === 'api') {
    const data = await apiFetch('/api/board/games') as { game: SavedBoardGame | null };
    return data.game;
  }
  if (!supabase) return loadDemo();
  const { data, error } = await supabase.from('board_games')
    .select('*').eq('space_id', store.data.space.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error || !data) return null;
  const row = data as Record<string, unknown>;
  return {
    id: String(row.id), config: row.config as BoardConfig, state: row.state as BoardState,
    version: Number(row.version ?? 0), status: (row.status as 'active' | 'finished') ?? 'active',
  };
}

export async function createBoardGameSaved(store: PlaceStore, config: BoardConfig, players: { name: string; token: string }[]): Promise<SavedBoardGame> {
  const created = createBoardGame(config, players);
  if (!created.ok) throw new Error(created.error);
  if (store.mode === 'demo') {
    const game: SavedBoardGame = { id: `demo-${Date.now()}`, config, state: created.state, version: 0, status: 'active' };
    saveDemo(game);
    return game;
  }
  if (store.mode === 'api') {
    const data = await apiFetch('/api/board/games', { method: 'POST', body: JSON.stringify({ config, players }) }) as { game: SavedBoardGame };
    return data.game;
  }
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.from('board_games').insert({
    space_id: store.data.space.id, config, state: created.state, version: 0, status: 'active', current_turn_user_id: store.viewerId,
  }).select('*').single();
  if (error || !data) throw new Error(error?.message || 'Could not start a board game.');
  const row = data as Record<string, unknown>;
  return { id: String(row.id), config: row.config as BoardConfig, state: row.state as BoardState, version: 0, status: 'active' };
}

export async function applyBoardAction(store: PlaceStore, game: SavedBoardGame, action: BoardAction): Promise<SavedBoardGame> {
  if (store.mode === 'api') {
    const data = await apiFetch(`/api/board/games/${game.id}/action`, {
      method: 'POST', body: JSON.stringify({ ...action, version: game.version }),
    }) as { game: SavedBoardGame };
    return data.game;
  }
  // Demo + Supabase: run the engine locally, then write only if the
  // version still matches what we read (optimistic concurrency).
  const result = applyLocalAction(game.state, game.config, action);
  if (!result.ok) throw new Error(result.error);
  const next: SavedBoardGame = {
    ...game, state: result.state, version: game.version + 1,
    status: result.state.phase === 'gameover' ? 'finished' : 'active',
  };
  if (store.mode === 'demo') { saveDemo(next); return next; }
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.from('board_games')
    .update({ state: next.state, version: next.version, status: next.status, updated_at: new Date().toISOString() })
    .eq('id', game.id).eq('version', game.version).select('*').maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('That game changed since you last saw it. Reload it and try again.');
  await supabase.from('board_game_moves').insert({ board_game_id: game.id, user_id: store.viewerId, move: { ...action, version: next.version } }).then(() => { /* best effort */ });
  return next;
}
