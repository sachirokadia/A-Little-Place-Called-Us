// Our Little World — an ORIGINAL local two-player board game.
//
// No borrowed board-game property appears here: no name, logo, or
// card text from any published board game, in code, comments, or UI.
// Custom terminology only: Memory Coins, Plot Twists, Little
// Surprises, Places and Moments, tokens.
//
// The engine is the single source of truth: the rules text is fetched
// from GET /spaces/:spaceId/board/rules and rendered verbatim — this
// file never contains its own copy of the rules. Dice are rolled
// server-side; this UI never sends balances, positions, ownership,
// or dice values. Editing a config never changes a running game:
// games play from the config snapshot taken at creation.
//
// API contract (worker B): all paths below are relative to /api/v1
// via the shared api() helper (same base URL, cookie session, and
// CSRF handling the hero adventure uses). Responses are unwrapped
// from the { data } envelope by api().
//   GET    /spaces/:spaceId/board/configs
//   POST   /spaces/:spaceId/board/configs
//   PATCH  /spaces/:spaceId/board/configs/:id
//   DELETE /spaces/:spaceId/board/configs/:id
//   GET    /spaces/:spaceId/board/rules            -> { rules: string }
//   POST   /spaces/:spaceId/board/games
//   GET    /spaces/:spaceId/board/games/:gameId
//   POST   /spaces/:spaceId/board/games/:gameId/actions
//   POST   /spaces/:spaceId/board/games/:gameId/restart

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, listItems, type AnyItem, type Me, type Space } from '../../lib/api.js';
import styles from './board.module.css';

// ---------------------------------------------------------------------------
// Types (tolerant reads: the server is authoritative, so unknown extra
// fields are ignored and missing optional fields fall back safely).
// ---------------------------------------------------------------------------

export type BoardSpace = {
  id: string;
  kind: string;
  name: string;
  description?: string;
  price?: number;
  rent?: number;
  category?: string;
  memoryId?: string;
};

export type BoardCard = {
  id: string;
  text: string;
  // Effect as sent by the server. The editor sends { type, amount?,
  // steps? }; reads also accept a plain string effect or top-level
  // effectType/amount/steps fields.
  effect?: unknown;
  effectType?: string;
  amount?: number;
  steps?: number;
};

export type BoardConfigData = {
  spaces: BoardSpace[];
  plotTwists: BoardCard[];
  littleSurprises: BoardCard[];
  startCoins: number;
  passStartBonus: number;
  taxAmount: number;
};

export type BoardConfig = {
  id: string;
  name: string;
  config: BoardConfigData;
  isDefault?: boolean;
  authorId?: string | null;
};

export type BoardPlayerState = {
  name: string;
  token: string;
  coins: number;
  position: number;
  missTurns?: number;
  bankrupt?: boolean;
};

export type BoardTrade = {
  proposer: number;
  giveSpaceIds: string[];
  giveCoins: number;
  wantSpaceIds: string[];
  wantCoins: number;
};

export type BoardGameState = {
  version?: number;
  status?: string;
  players: BoardPlayerState[];
  owners: Record<string, 0 | 1 | null>;
  turn: number;
  phase: string;
  dice?: number | number[] | null;
  pendingTrade?: unknown;
  lastEvent?: unknown;
  lastCard?: { deck: string; cardId: string; text: string } | null;
  log?: unknown;
  winner?: number | null;
  isDraw?: boolean;
  plotTwistIndex?: number | null;
  littleSurpriseIndex?: number | null;
};

export type BoardGame = {
  id: string;
  configId: string;
  configSnapshot: BoardConfigData;
  state: BoardGameState;
  version?: number;
  status?: string;
};

type Action =
  | { actor: number; type: 'roll' }
  | { actor: number; type: 'buy' }
  | { actor: number; type: 'passPurchase' }
  | { actor: number; type: 'proposeTrade'; giveSpaceIds: string[]; giveCoins: number; wantSpaceIds: string[]; wantCoins: number }
  | { actor: number; type: 'respondTrade'; accept: boolean }
  | { actor: number; type: 'endEarly' };

// ---------------------------------------------------------------------------
// Board perimeter layout, by position index only.
//
// Cells are walked in config order: top row left-to-right, right
// column top-to-bottom, bottom row right-to-left, left column
// bottom-to-top. The cell for position i is cells[i]; names are never
// used to order anything. Exported so the order can be unit-checked.
// ---------------------------------------------------------------------------

export function boardPerimeterCells(count: number): { row: number; col: number }[] {
  if (count <= 0) return [];
  const side = Math.max(2, Math.ceil((count + 4) / 4));
  const cells: { row: number; col: number }[] = [];
  for (let c = 0; c < side; c++) cells.push({ row: 0, col: c });
  for (let r = 1; r < side; r++) cells.push({ row: r, col: side - 1 });
  for (let c = side - 2; c >= 0; c--) cells.push({ row: side - 1, col: c });
  for (let r = side - 2; r >= 1; r--) cells.push({ row: r, col: 0 });
  return cells.slice(0, count);
}

export function boardSide(count: number): number {
  return Math.max(2, Math.ceil((count + 4) / 4));
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const PLAYER_COLORS = ['#c94f4f', '#3a6ea5'];

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function asNumber(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function parseTrade(raw: unknown): BoardTrade | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = asRecord(raw);
  const proposerRaw = t.proposer ?? t.from ?? t.actor ?? t.player ?? t.by;
  const proposer = typeof proposerRaw === 'number' ? proposerRaw : proposerRaw === 'player2' || proposerRaw === '1' ? 1 : 0;
  return {
    proposer: proposer === 1 ? 1 : 0,
    giveSpaceIds: asStringArray(t.giveSpaceIds ?? t.give),
    giveCoins: asNumber(t.giveCoins, 0),
    wantSpaceIds: asStringArray(t.wantSpaceIds ?? t.want),
    wantCoins: asNumber(t.wantCoins, 0),
  };
}

function eventText(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  const r = asRecord(raw);
  return asString(r.text ?? r.message ?? r.description);
}

function logEntries(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((e) => (typeof e === 'string' ? e : eventText(e))).filter(Boolean);
  const s = eventText(raw);
  return s ? [s] : [];
}

function prettyKind(kind: string): string {
  switch (kind) {
    case 'start': return 'Start';
    case 'place': return 'Place';
    case 'plot-twist': return 'Plot Twist';
    case 'little-surprise': return 'Little Surprise';
    case 'tax': return 'Tax';
    case 'rest': return 'Rest';
    case 'miss-turn': return 'Miss a turn';
    default: return kind ? kind.replace(/([A-Z])/g, ' $1').trim() : 'Space';
  }
}

const PASTELS = ['#fde8d7', '#d7ecd7', '#fdf3c4', '#e2ecfb', '#f6ddf0', '#dff3f0', '#fbe3d5'];

function categoryColor(category?: string): string {
  if (!category) return '#fffdf6';
  let h = 0;
  for (let i = 0; i < category.length; i++) h = (h * 31 + category.charCodeAt(i)) % 997;
  return PASTELS[h % PASTELS.length]!;
}

function kindTint(kind: string): string {
  switch (kind) {
    case 'start': return '#d7ecd7';
    case 'plot-twist': return '#e9ddf6';
    case 'little-surprise': return '#fdf3c4';
    case 'tax': return '#e8e2dc';
    case 'rest': return '#d7ecd7';
    case 'miss-turn': return '#f6ddf0';
    default: return '';
  }
}

function cardEffect(card: BoardCard): { type: string; amount: number; steps: number } {
  const eff = asRecord(card.effect);
  return {
    type: asString(card.effectType ?? eff.type ?? (typeof card.effect === 'string' ? card.effect : '')),
    amount: asNumber(card.amount ?? eff.amount, 0),
    steps: asNumber(card.steps ?? eff.steps, 0),
  };
}

function newCardId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 10000)}`;
}

// Editor draft shapes (form strings for numbers, converted on save).
type SpaceDraft = {
  id: string;
  kind: string;
  name: string;
  description: string;
  price: string;
  rent: string;
  category: string;
  memoryId: string;
};

type CardDraft = { id: string; text: string; effectType: string; amount: string; steps: string };

type ConfigDraft = {
  name: string;
  spaces: SpaceDraft[];
  plotTwists: CardDraft[];
  littleSurprises: CardDraft[];
  startCoins: string;
  passStartBonus: string;
  taxAmount: string;
};

function toSpaceDraft(s: BoardSpace): SpaceDraft {
  return {
    id: s.id,
    kind: s.kind || 'place',
    name: s.name || '',
    description: s.description || '',
    price: s.price !== undefined ? String(s.price) : '',
    rent: s.rent !== undefined ? String(s.rent) : '',
    category: s.category || '',
    memoryId: s.memoryId || '',
  };
}

function toCardDraft(c: BoardCard): CardDraft {
  const e = cardEffect(c);
  return { id: c.id, text: c.text || '', effectType: e.type, amount: e.amount ? String(e.amount) : '', steps: e.steps ? String(e.steps) : '' };
}

function toConfigDraft(data: BoardConfigData, name: string): ConfigDraft {
  return {
    name,
    spaces: (data.spaces || []).map(toSpaceDraft),
    plotTwists: (data.plotTwists || []).map(toCardDraft),
    littleSurprises: (data.littleSurprises || []).map(toCardDraft),
    startCoins: String(data.startCoins ?? ''),
    passStartBonus: String(data.passStartBonus ?? ''),
    taxAmount: String(data.taxAmount ?? ''),
  };
}

function draftToConfigData(d: ConfigDraft): BoardConfigData {
  const num = (v: string): number | undefined => {
    const n = Number(v);
    return v.trim() !== '' && Number.isFinite(n) ? n : undefined;
  };
  return {
    spaces: d.spaces.map((s) => ({
      id: s.id,
      kind: s.kind,
      name: s.name.trim() || 'Untitled place',
      ...(s.description.trim() ? { description: s.description.trim() } : {}),
      ...(num(s.price) !== undefined ? { price: num(s.price) } : {}),
      ...(num(s.rent) !== undefined ? { rent: num(s.rent) } : {}),
      ...(s.category.trim() ? { category: s.category.trim() } : {}),
      ...(s.kind === 'place' && s.memoryId.trim() ? { memoryId: s.memoryId.trim() } : {}),
    })),
    plotTwists: d.plotTwists.map((c) => ({
      id: c.id,
      text: c.text,
      effect: {
        type: c.effectType,
        ...(num(c.amount) !== undefined ? { amount: num(c.amount) } : {}),
        ...(num(c.steps) !== undefined ? { steps: num(c.steps) } : {}),
      },
    })),
    littleSurprises: d.littleSurprises.map((c) => ({
      id: c.id,
      text: c.text,
      effect: {
        type: c.effectType,
        ...(num(c.amount) !== undefined ? { amount: num(c.amount) } : {}),
        ...(num(c.steps) !== undefined ? { steps: num(c.steps) } : {}),
      },
    })),
    startCoins: num(d.startCoins) ?? 0,
    passStartBonus: num(d.passStartBonus) ?? 0,
    taxAmount: num(d.taxAmount) ?? 0,
  };
}

const TOKEN_PRESETS = ['A', 'B', 'X', 'O'];
const KIND_OPTIONS = ['place', 'start', 'plot-twist', 'little-surprise', 'tax', 'rest', 'miss-turn'];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BoardGame({ space, me }: { space: Space; me: Me }) {
  const [configs, setConfigs] = useState<BoardConfig[]>([]);
  const [configsError, setConfigsError] = useState<string | null>(null);
  const [configsLoading, setConfigsLoading] = useState(true);
  const [rules, setRules] = useState<string | null>(null);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [rulesOpen, setRulesOpen] = useState(true);

  const [selectedConfigId, setSelectedConfigId] = useState<string>('');
  const [p1Name, setP1Name] = useState('Player 1');
  const [p2Name, setP2Name] = useState('Player 2');
  const [p1Token, setP1Token] = useState('A');
  const [p2Token, setP2Token] = useState('B');

  const [game, setGame] = useState<BoardGame | null>(null);
  const [gameError, setGameError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [restartConfirm, setRestartConfirm] = useState(false);

  // Trade form (propose before rolling).
  const [giveIds, setGiveIds] = useState<string[]>([]);
  const [giveCoins, setGiveCoins] = useState('');
  const [wantIds, setWantIds] = useState<string[]>([]);
  const [wantCoins, setWantCoins] = useState('');

  // Config editor.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ConfigDraft | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [editorSaving, setEditorSaving] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Memory list for the optional memory link (hero-editor pattern:
  // listItems, with a plain id input as fallback when it fails).
  const [memories, setMemories] = useState<AnyItem[]>([]);
  const [memoriesFailed, setMemoriesFailed] = useState(false);

  const refreshConfigs = useCallback(async () => {
    setConfigsLoading(true);
    setConfigsError(null);
    try {
      const list = await api<BoardConfig[]>(`/spaces/${space.id}/board/configs`);
      const arr = Array.isArray(list) ? list : [];
      setConfigs(arr);
      setSelectedConfigId((prev) => {
        if (prev && arr.some((c) => c.id === prev)) return prev;
        const def = arr.find((c) => c.isDefault) ?? arr[0];
        return def ? def.id : '';
      });
    } catch (e) {
      setConfigsError(e instanceof Error ? e.message : 'Board setups could not be loaded.');
    } finally {
      setConfigsLoading(false);
    }
  }, [space.id]);

  const refreshRules = useCallback(async () => {
    setRulesError(null);
    try {
      const data = await api<{ rules: string }>(`/spaces/${space.id}/board/rules`);
      setRules(typeof data?.rules === 'string' ? data.rules : '');
    } catch (e) {
      setRulesError(e instanceof Error ? e.message : 'Rules could not be loaded.');
    }
  }, [space.id]);

  useEffect(() => { void refreshConfigs(); }, [refreshConfigs]);
  useEffect(() => { void refreshRules(); }, [refreshRules]);

  // Resume: the current game id is kept in localStorage per space, so
  // a browser refresh restores the in-progress (or just-finished)
  // game instead of dropping back to setup. A missing game clears
  // the stored id; "New game (back to setup)" clears it explicitly.
  useEffect(() => {
    const key = `lp-board-game-${space.id}`;
    const storedId = window.localStorage.getItem(key);
    if (!storedId) return;
    let cancelled = false;
    api<BoardGame>(`/spaces/${space.id}/board/games/${storedId}`)
      .then((g) => { if (!cancelled) setGame(g); })
      .catch(() => { if (!cancelled) window.localStorage.removeItem(key); });
    return () => { cancelled = true; };
  }, [space.id]);

  useEffect(() => {
    let cancelled = false;
    listItems(space.id, 'memories')
      .then((items) => { if (!cancelled) { setMemories(items); setMemoriesFailed(false); } })
      .catch(() => { if (!cancelled) setMemoriesFailed(true); });
    return () => { cancelled = true; };
  }, [space.id]);

  const selectedConfig = useMemo(
    () => configs.find((c) => c.id === selectedConfigId) ?? null,
    [configs, selectedConfigId],
  );

  const state = game?.state ?? null;
  const snapshot = game?.configSnapshot ?? null;
  const spaces = snapshot?.spaces ?? [];
  const version = game?.version ?? state?.version ?? 0;
  const turn = state?.turn ?? 0;
  const phase = state?.phase ?? '';
  const pendingTrade = parseTrade(state?.pendingTrade);
  const isOver = Boolean(
    state && (state.winner !== null && state.winner !== undefined || state.isDraw === true ||
      state.status === 'finished' || state.status === 'over' || state.phase === 'over' ||
      game?.status === 'finished' || game?.status === 'over'),
  );
  const diceText = state?.dice === null || state?.dice === undefined
    ? 'Not rolled yet'
    : Array.isArray(state.dice) ? state.dice.join(' + ') : String(state.dice);
  const lastEventMessage = eventText(state?.lastEvent);
  const log = logEntries(state?.log).slice(-10);

  // Event card: the engine records the most recently drawn card on
  // state.lastCard (set on the draw, cleared when the next roll
  // begins), so the scrapbook card shows the drawn card itself even
  // though lastEvent has since moved on to the card's effect.
  const eventCard = useMemo(() => {
    const card = state?.lastCard;
    if (!card || typeof card.text !== 'string' || !card.text) return null;
    return { kind: card.deck === 'plot-twist' ? 'Plot Twist' : 'Little Surprise', text: card.text };
  }, [state?.lastCard]);

  const ownedCount = useCallback((playerIndex: number): number => {
    if (!state) return 0;
    return Object.values(state.owners || {}).filter((o) => o === playerIndex).length;
  }, [state]);

  const ownedSpaces = useCallback((playerIndex: number): BoardSpace[] => {
    if (!state) return [];
    return spaces.filter((s) => state.owners?.[s.id] === playerIndex);
  }, [state, spaces]);

  const spaceName = useCallback((id: string): string => {
    return spaces.find((s) => s.id === id)?.name ?? id;
  }, [spaces]);

  const refetchGame = useCallback(async () => {
    if (!game) return;
    try {
      const fresh = await api<BoardGame>(`/spaces/${space.id}/board/games/${game.id}`);
      setGame(fresh);
    } catch (e) {
      setGameError(e instanceof Error ? e.message : 'The game could not be reloaded.');
    }
  }, [game, space.id]);

  const doAction = useCallback(async (action: Action) => {
    if (!game) return;
    setActionBusy(true);
    setGameError(null);
    try {
      const updated = await api<BoardGame>(`/spaces/${space.id}/board/games/${game.id}/actions`, {
        method: 'POST',
        body: { action, expectedVersion: version },
      });
      setGame(updated);
      setGiveIds([]); setGiveCoins(''); setWantIds([]); setWantCoins('');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'That move could not be made.';
      if (/stale|version|conflict|changed/i.test(msg)) {
        setGameError('This game changed — it was just reloaded');
        await refetchGame();
      } else {
        setGameError(msg);
      }
    } finally {
      setActionBusy(false);
    }
  }, [game, space.id, version, refetchGame]);

  const startGame = useCallback(async () => {
    if (!selectedConfigId) { setGameError('Choose a board setup first.'); return; }
    setStarting(true);
    setGameError(null);
    try {
      const created = await api<BoardGame>(`/spaces/${space.id}/board/games`, {
        method: 'POST',
        body: {
          configId: selectedConfigId,
          player1: { name: p1Name.trim() || 'Player 1', token: p1Token.trim() || 'A' },
          player2: { name: p2Name.trim() || 'Player 2', token: p2Token.trim() || 'B' },
        },
      });
      setGame(created);
      window.localStorage.setItem(`lp-board-game-${space.id}`, created.id);
      setRestartConfirm(false);
      setGiveIds([]); setGiveCoins(''); setWantIds([]); setWantCoins('');
    } catch (e) {
      setGameError(e instanceof Error ? e.message : 'The game could not be started.');
    } finally {
      setStarting(false);
    }
  }, [selectedConfigId, space.id, p1Name, p1Token, p2Name, p2Token]);

  const restartGame = useCallback(async () => {
    if (!game) return;
    const players = game.state.players;
    setActionBusy(true);
    setGameError(null);
    try {
      const fresh = await api<BoardGame>(`/spaces/${space.id}/board/games/${game.id}/restart`, {
        method: 'POST',
        body: {
          player1: { name: players[0]?.name ?? p1Name, token: players[0]?.token ?? p1Token },
          player2: { name: players[1]?.name ?? p2Name, token: players[1]?.token ?? p2Token },
        },
      });
      setGame(fresh);
      window.localStorage.setItem(`lp-board-game-${space.id}`, fresh.id);
      setRestartConfirm(false);
      setGiveIds([]); setGiveCoins(''); setWantIds([]); setWantCoins('');
    } catch (e) {
      setGameError(e instanceof Error ? e.message : 'The game could not be restarted.');
    } finally {
      setActionBusy(false);
    }
  }, [game, space.id, p1Name, p1Token, p2Name, p2Token]);

  const toggleId = (list: string[], id: string, set: (v: string[]) => void) => {
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  };

  const proposeTrade = () => {
    if (!game) return;
    void doAction({
      actor: turn,
      type: 'proposeTrade',
      giveSpaceIds: giveIds,
      giveCoins: Number(giveCoins) || 0,
      wantSpaceIds: wantIds,
      wantCoins: Number(wantCoins) || 0,
    });
  };

  // ---- Config editor ------------------------------------------------------

  const startNewConfig = () => {
    const base = selectedConfig?.config;
    setEditingId(null);
    setEditorError(null);
    setDraft(base ? toConfigDraft(base, '') : {
      name: '', spaces: [], plotTwists: [], littleSurprises: [],
      startCoins: '', passStartBonus: '', taxAmount: '',
    });
  };

  const startEditConfig = (cfg: BoardConfig) => {
    setEditingId(cfg.id);
    setEditorError(null);
    setDraft(toConfigDraft(cfg.config, cfg.name));
  };

  const saveConfig = async () => {
    if (!draft) return;
    if (!draft.name.trim()) { setEditorError('Give the setup a name first.'); return; }
    setEditorSaving(true);
    setEditorError(null);
    try {
      const config = draftToConfigData(draft);
      if (editingId) {
        await api(`/spaces/${space.id}/board/configs/${editingId}`, {
          method: 'PATCH', body: { name: draft.name.trim(), config },
        });
      } else {
        await api(`/spaces/${space.id}/board/configs`, {
          method: 'POST', body: { name: draft.name.trim(), config },
        });
      }
      setDraft(null);
      setEditingId(null);
      await refreshConfigs();
    } catch (e) {
      setEditorError(e instanceof Error ? e.message : 'The setup could not be saved.');
    } finally {
      setEditorSaving(false);
    }
  };

  const deleteConfig = async (id: string) => {
    setDeletingId(id);
    setEditorError(null);
    try {
      await api(`/spaces/${space.id}/board/configs/${id}`, { method: 'DELETE' });
      setDeleteConfirmId(null);
      await refreshConfigs();
    } catch (e) {
      setEditorError(e instanceof Error ? e.message : 'The setup could not be deleted.');
    } finally {
      setDeletingId(null);
    }
  };

  const updateSpaceDraft = (index: number, patch: Partial<SpaceDraft>) => {
    if (!draft) return;
    const next = [...draft.spaces];
    next[index] = { ...next[index]!, ...patch };
    setDraft({ ...draft, spaces: next });
  };

  const updateCardDraft = (list: 'plotTwists' | 'littleSurprises', index: number, patch: Partial<CardDraft>) => {
    if (!draft) return;
    const next = [...draft[list]];
    next[index] = { ...next[index]!, ...patch };
    setDraft({ ...draft, [list]: next });
  };

  // ---- Board render -------------------------------------------------------

  const cells = useMemo(() => boardPerimeterCells(spaces.length), [spaces.length]);
  const side = boardSide(spaces.length);

  const renderBoard = () => {
    if (!game || !state || spaces.length === 0) return null;
    return (
      <div
        className={styles.boardGrid}
        style={{ gridTemplateColumns: `repeat(${side}, minmax(0, 1fr))` }}
        role="group"
        aria-label="Game board, spaces in order around the edge"
      >
        {side >= 3 && (
          <div className={styles.centerPanel} style={{ gridRow: `2 / ${side}`, gridColumn: `2 / ${side}` }}>
            <p><strong>Our Little World</strong></p>
            <p>Turn: {state.players[turn]?.name ?? `Player ${turn + 1}`}</p>
            <p>Dice: {diceText}</p>
            {lastEventMessage && <p>{lastEventMessage}</p>}
          </div>
        )}
        {spaces.map((s, i) => {
          const cell = cells[i]!;
          const owner = state.owners?.[s.id] ?? null;
          const here = state.players
            .map((p, pi) => (p.position === i ? pi : null))
            .filter((x): x is number => x !== null);
          const bg = kindTint(s.kind) || categoryColor(s.category);
          return (
            <div
              key={s.id}
              className={`${styles.cell} ${here.length > 0 ? styles.cellActive : ''}`}
              style={{ gridRow: cell.row + 1, gridColumn: cell.col + 1, background: bg }}
            >
              <span className={styles.cellName}>{s.name}</span>
              <span className={styles.cellKind}>{prettyKind(s.kind)}{s.category ? ` · ${s.category}` : ''}</span>
              {s.kind === 'place' && s.price !== undefined && (
                <span className={styles.cellMoney}>Price {s.price} · Rent {s.rent ?? '—'}</span>
              )}
              {owner !== null && owner !== undefined && (
                <span
                  className={styles.ownerChip}
                  style={{ borderColor: PLAYER_COLORS[owner] }}
                >
                  Owned by {state.players[owner]?.token ?? `Player ${owner + 1}`}
                </span>
              )}
              {here.length > 0 && (
                <span className={styles.tokenRow} aria-label={`${here.map((pi) => state.players[pi]?.name ?? '').join(' and ')} here`}>
                  {here.map((pi) => (
                    <span key={pi} className={styles.tokenChip} style={{ borderColor: PLAYER_COLORS[pi] }}>
                      {state.players[pi]?.token ?? `P${pi + 1}`}
                    </span>
                  ))}
                </span>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const renderTurnPanel = () => {
    if (!game || !state) return null;
    const current = state.players[turn];
    const responder = pendingTrade ? 1 - pendingTrade.proposer : null;
    return (
      <div className={styles.panel}>
        <h3>Turn panel</h3>
        <div className={styles.playerRow}>
          {state.players.map((p, i) => (
            <div key={i} className={styles.scoreBox} role="status">
              <strong>
                {p.name} ({p.token})
                {turn === i && !isOver ? ' — your turn' : ''}
                {p.bankrupt ? ' — bankrupt' : ''}
              </strong>
              <p>{p.coins} Memory Coins · on {spaces[p.position]?.name ?? `space ${p.position + 1}`} · {ownedCount(i)} owned place{ownedCount(i) === 1 ? '' : 's'}
                {p.missTurns ? ` · misses ${p.missTurns} turn${p.missTurns === 1 ? '' : 's'}` : ''}</p>
            </div>
          ))}
        </div>
        <p role="status">
          {isOver
            ? 'Game over.'
            : <>It is {current?.name ?? `Player ${turn + 1}`}&apos;s turn · Phase: {phase || '—'} · Dice: {diceText}</>}
        </p>
        {/* Linked-memory detail for the landed space (and, below it,
            for owned places with a link). The link only points at
            the Memory Wall — the memory itself is never gated
            behind this game and stays reachable from its own room. */}
        {(() => {
          const landed = current ? spaces[current.position] : undefined;
          if (!landed || !landed.memoryId) return null;
          const memory = memories.find((m) => m.id === landed.memoryId);
          return (
            <p role="status">
              On {landed.name} — linked memory:{' '}
              <Link to="/memories">
                {memory && typeof memory.title === 'string' ? `“${memory.title}” — ` : ''}See it on the Memory Wall →
              </Link>
            </p>
          );
        })()}
        {ownedSpaces(turn).filter((s) => s.memoryId).length > 0 && (
          <p>
            <small>
              {current?.name ?? `Player ${turn + 1}`}&apos;s places with a linked memory:{' '}
              {ownedSpaces(turn).filter((s) => s.memoryId).map((s, i) => (
                <span key={s.id}>
                  {i > 0 ? ', ' : ''}
                  <Link to="/memories">{s.name}</Link>
                </span>
              ))}
              {' '}— each opens on the Memory Wall, not inside this game.
            </small>
          </p>
        )}
        {lastEventMessage && <p role="status">Last event: {lastEventMessage}</p>}

        {eventCard && (
          <div className={styles.eventCard} role="status">
            <p><strong>{eventCard.kind}</strong></p>
            <p>{eventCard.text}</p>
          </div>
        )}

        {gameError && <p className={styles.error} role="alert">{gameError}</p>}

        {!isOver && pendingTrade && responder !== null && (
          <div className={styles.tradeOffer} role="status">
            <p><strong>Trade offer for {state.players[responder]?.name ?? `Player ${responder + 1}`}:</strong></p>
            <p>
              {state.players[pendingTrade.proposer]?.name ?? `Player ${pendingTrade.proposer + 1}`} offers{' '}
              {pendingTrade.giveSpaceIds.length > 0 ? pendingTrade.giveSpaceIds.map(spaceName).join(', ') : 'no places'}
              {pendingTrade.giveCoins > 0 ? ` and ${pendingTrade.giveCoins} Memory Coins` : ''}, and asks for{' '}
              {pendingTrade.wantSpaceIds.length > 0 ? pendingTrade.wantSpaceIds.map(spaceName).join(', ') : 'no places'}
              {pendingTrade.wantCoins > 0 ? ` and ${pendingTrade.wantCoins} Memory Coins` : ''}.
            </p>
            <div className={styles.btnRow}>
              <button className={styles.btn} type="button" disabled={actionBusy} onClick={() => void doAction({ actor: responder, type: 'respondTrade', accept: true })}>
                {state.players[responder]?.name ?? 'Player'}: Accept trade
              </button>
              <button className={`${styles.btn} ${styles.btnQuiet}`} type="button" disabled={actionBusy} onClick={() => void doAction({ actor: responder, type: 'respondTrade', accept: false })}>
                {state.players[responder]?.name ?? 'Player'}: Decline trade
              </button>
            </div>
          </div>
        )}

        {!isOver && !pendingTrade && phase === 'awaitingRoll' && (
          <div>
            <div className={styles.btnRow}>
              <button className={styles.btn} type="button" disabled={actionBusy} onClick={() => void doAction({ actor: turn, type: 'roll' })}>
                {current?.name ?? 'Player'}: Roll
              </button>
              <button className={`${styles.btn} ${styles.btnQuiet}`} type="button" disabled={actionBusy} onClick={() => setRestartConfirm(true)}>
                Restart game
              </button>
              <button className={`${styles.btn} ${styles.btnQuiet}`} type="button" disabled={actionBusy} onClick={() => void doAction({ actor: turn, type: 'endEarly' })}>
                End game early
              </button>
            </div>
            <div className={styles.tradeForm}>
              <h4>Propose a trade (before rolling — a trade never consumes the turn)</h4>
              <p>{current?.name ?? 'Player'}, pick your own places and coins to give, and what you want in return.</p>
              <fieldset>
                <legend>Give: your places</legend>
                {ownedSpaces(turn).length === 0 && <p>You own no places yet.</p>}
                {ownedSpaces(turn).map((s) => (
                  <label key={s.id} className={styles.checkLabel}>
                    <input type="checkbox" checked={giveIds.includes(s.id)} onChange={() => toggleId(giveIds, s.id, setGiveIds)} />
                    {s.name}
                  </label>
                ))}
                <label className={styles.fieldLabel}>
                  Coins to give
                  <input type="number" min="0" inputMode="numeric" value={giveCoins} onChange={(e) => setGiveCoins(e.target.value)} />
                </label>
              </fieldset>
              <fieldset>
                <legend>Want: the other player&apos;s places</legend>
                {ownedSpaces(1 - turn).length === 0 && <p>The other player owns no places yet.</p>}
                {ownedSpaces(1 - turn).map((s) => (
                  <label key={s.id} className={styles.checkLabel}>
                    <input type="checkbox" checked={wantIds.includes(s.id)} onChange={() => toggleId(wantIds, s.id, setWantIds)} />
                    {s.name}
                  </label>
                ))}
                <label className={styles.fieldLabel}>
                  Coins to want
                  <input type="number" min="0" inputMode="numeric" value={wantCoins} onChange={(e) => setWantCoins(e.target.value)} />
                </label>
              </fieldset>
              <button className={styles.btn} type="button" disabled={actionBusy} onClick={proposeTrade}>
                Propose trade
              </button>
            </div>
          </div>
        )}

        {!isOver && !pendingTrade && phase === 'purchaseDecision' && (
          <div className={styles.btnRow}>
            <button className={styles.btn} type="button" disabled={actionBusy} onClick={() => void doAction({ actor: turn, type: 'buy' })}>
              Buy {spaces[current?.position ?? 0]?.name ?? 'this place'}
            </button>
            <button className={`${styles.btn} ${styles.btnQuiet}`} type="button" disabled={actionBusy} onClick={() => void doAction({ actor: turn, type: 'passPurchase' })}>
              Pass on buying
            </button>
          </div>
        )}

        {!isOver && !pendingTrade && phase !== 'awaitingRoll' && phase !== 'purchaseDecision' && (
          <p>Waiting for the game to update. If nothing changes, reload the game below.</p>
        )}

        {restartConfirm && !isOver && (
          <div className={styles.confirmBox} role="status">
            <p>Start a fresh game from the same board setup? The current game will be replaced.</p>
            <div className={styles.btnRow}>
              <button className={styles.btn} type="button" disabled={actionBusy} onClick={() => void restartGame()}>Yes, restart</button>
              <button className={`${styles.btn} ${styles.btnQuiet}`} type="button" onClick={() => setRestartConfirm(false)}>Keep playing</button>
            </div>
          </div>
        )}

        <div className={styles.btnRow}>
          <button className={`${styles.btn} ${styles.btnQuiet}`} type="button" disabled={actionBusy} onClick={() => void refetchGame()}>Reload game</button>
          <button className={`${styles.btn} ${styles.btnQuiet}`} type="button" onClick={() => { setGame(null); setRestartConfirm(false); window.localStorage.removeItem(`lp-board-game-${space.id}`); if (game) setSelectedConfigId(game.configId); }}>
            New game (back to setup)
          </button>
        </div>

        {log.length > 0 && (
          <div>
            <h4>Game log</h4>
            <ul className={styles.logList}>
              {log.map((entry, i) => <li key={i}>{entry}</li>)}
            </ul>
          </div>
        )}
      </div>
    );
  };

  const renderGameOver = () => {
    if (!game || !state || !isOver) return null;
    const winner = state.winner;
    return (
      <div className={styles.panel} role="status">
        <h3>Game over</h3>
        {state.isDraw || winner === null || winner === undefined ? (
          <p><strong>It&apos;s a draw</strong></p>
        ) : (
          <p><strong>{state.players[winner]?.name ?? `Player ${winner + 1}`} wins!</strong></p>
        )}
        <div className={styles.playerRow}>
          {state.players.map((p, i) => (
            <div key={i} className={styles.scoreBox}>
              <strong>{p.name} ({p.token})</strong>
              <p>{p.coins} Memory Coins · {ownedCount(i)} owned place{ownedCount(i) === 1 ? '' : 's'}{p.bankrupt ? ' · bankrupt' : ''}</p>
            </div>
          ))}
        </div>
        {gameError && <p className={styles.error} role="alert">{gameError}</p>}
        <div className={styles.btnRow}>
          <button className={styles.btn} type="button" disabled={actionBusy} onClick={() => void restartGame()}>Play again (same board setup)</button>
          <button className={`${styles.btn} ${styles.btnQuiet}`} type="button" onClick={() => { setGame(null); window.localStorage.removeItem(`lp-board-game-${space.id}`); if (game) setSelectedConfigId(game.configId); }}>
            Back to arcade options
          </button>
        </div>
      </div>
    );
  };

  const renderEditorField = (label: string, value: string, onChange: (v: string) => void, type = 'text') => (
    <label className={styles.fieldLabel}>
      {label}
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );

  const renderCardEditor = (list: 'plotTwists' | 'littleSurprises', title: string) => {
    if (!draft) return null;
    const cards = draft[list];
    return (
      <div>
        <h4>{title}</h4>
        {cards.length === 0 && <p>No cards yet.</p>}
        {cards.map((c, i) => (
          <div key={c.id} className={styles.cardEditor}>
            <label className={styles.fieldLabel}>
              Card text
              <input type="text" value={c.text} onChange={(e) => updateCardDraft(list, i, { text: e.target.value })} />
            </label>
            <label className={styles.fieldLabel}>
              Effect type
              <select value={c.effectType} onChange={(e) => updateCardDraft(list, i, { effectType: e.target.value })}>
                <option value="">Choose an effect…</option>
                <option value="coins">Memory Coins (amount)</option>
                <option value="move">Move (steps)</option>
                <option value="missTurn">Miss a turn</option>
                <option value="toStart">Return to Start</option>
              </select>
            </label>
            <div className={styles.inlineFields}>
              {renderEditorField('Amount', c.amount, (v) => updateCardDraft(list, i, { amount: v }), 'number')}
              {renderEditorField('Steps', c.steps, (v) => updateCardDraft(list, i, { steps: v }), 'number')}
            </div>
            <button
              className={`${styles.btn} ${styles.btnQuiet} ${styles.btnSmall}`}
              type="button"
              onClick={() => setDraft({ ...draft, [list]: cards.filter((_, j) => j !== i) })}
            >
              Remove this card
            </button>
          </div>
        ))}
        <button
          className={`${styles.btn} ${styles.btnQuiet}`}
          type="button"
          onClick={() => setDraft({ ...draft, [list]: [...cards, { id: newCardId(list === 'plotTwists' ? 'twist' : 'surprise'), text: '', effectType: '', amount: '', steps: '' }] })}
        >
          Add a {list === 'plotTwists' ? 'Plot Twist' : 'Little Surprise'} card
        </button>
      </div>
    );
  };

  const renderEditor = () => (
    <div className={styles.panel}>
      <h3>Board setups</h3>
      <p>Setups are shared: a setup you save here appears in the setup list for both partners. Editing a setup never changes a running game — games play from the snapshot taken when they start.</p>
      {configsError && <p className={styles.error} role="alert">{configsError}</p>}
      {configsLoading && <p>Loading setups…</p>}
      {!configsLoading && configs.length === 0 && <p>No board setups yet.</p>}
      <ul className={styles.configList}>
        {configs.map((cfg) => {
          const mine = cfg.authorId === me.id;
          return (
            <li key={cfg.id} className={styles.configItem}>
              <span>
                <strong>{cfg.name}</strong>
                {cfg.isDefault ? ' (default setup)' : ''}
                {cfg.authorId === me.id ? ' (yours)' : ''}
                {' '}· {(cfg.config.spaces || []).length} spaces
              </span>
              {mine && (
                <span className={styles.btnRow}>
                  <button className={`${styles.btn} ${styles.btnQuiet} ${styles.btnSmall}`} type="button" onClick={() => startEditConfig(cfg)}>Edit</button>
                  {deleteConfirmId === cfg.id ? (
                    <>
                      <button className={styles.btn} type="button" disabled={deletingId === cfg.id} onClick={() => void deleteConfig(cfg.id)}>
                        {deletingId === cfg.id ? 'Deleting…' : 'Yes, delete'}
                      </button>
                      <button className={`${styles.btn} ${styles.btnQuiet} ${styles.btnSmall}`} type="button" onClick={() => setDeleteConfirmId(null)}>Keep it</button>
                    </>
                  ) : (
                    <button className={`${styles.btn} ${styles.btnQuiet} ${styles.btnSmall}`} type="button" onClick={() => setDeleteConfirmId(cfg.id)}>Delete</button>
                  )}
                </span>
              )}
              {!mine && <span><small>Only its author can edit or delete this setup.</small></span>}
            </li>
          );
        })}
      </ul>
      <div className={styles.btnRow}>
        <button className={styles.btn} type="button" disabled={configsLoading} onClick={startNewConfig}>New setup (from the selected setup)</button>
        {draft && (
          <button className={`${styles.btn} ${styles.btnQuiet}`} type="button" onClick={() => { setDraft(null); setEditingId(null); }}>Cancel editing</button>
        )}
      </div>
      {editorError && <p className={styles.error} role="alert">{editorError}</p>}

      {draft && (
        <div className={styles.editorForm}>
          <h4>{editingId ? 'Edit setup' : 'New setup'}</h4>
          {renderEditorField('Setup name', draft.name, (v) => setDraft({ ...draft, name: v }))}
          <div className={styles.inlineFields}>
            {renderEditorField('Start Memory Coins', draft.startCoins, (v) => setDraft({ ...draft, startCoins: v }), 'number')}
            {renderEditorField('Pass Start bonus', draft.passStartBonus, (v) => setDraft({ ...draft, passStartBonus: v }), 'number')}
            {renderEditorField('Tax amount', draft.taxAmount, (v) => setDraft({ ...draft, taxAmount: v }), 'number')}
          </div>
          <h4>Spaces (in board order)</h4>
          {draft.spaces.length === 0 && <p>No spaces yet — add one below.</p>}
          {draft.spaces.map((s, i) => (
            <div key={s.id} className={styles.spaceEditor}>
              <p><strong>Space {i + 1}</strong></p>
              <div className={styles.inlineFields}>
                {renderEditorField('Name', s.name, (v) => updateSpaceDraft(i, { name: v }))}
                <label className={styles.fieldLabel}>
                  Kind
                  <select value={s.kind} onChange={(e) => updateSpaceDraft(i, { kind: e.target.value })}>
                    {KIND_OPTIONS.map((k) => <option key={k} value={k}>{prettyKind(k)}</option>)}
                  </select>
                </label>
              </div>
              <label className={styles.fieldLabel}>
                Description
                <input type="text" value={s.description} onChange={(e) => updateSpaceDraft(i, { description: e.target.value })} />
              </label>
              <div className={styles.inlineFields}>
                {renderEditorField('Price (Memory Coins)', s.price, (v) => updateSpaceDraft(i, { price: v }), 'number')}
                {renderEditorField('Rent (Memory Coins)', s.rent, (v) => updateSpaceDraft(i, { rent: v }), 'number')}
                {renderEditorField('Category', s.category, (v) => updateSpaceDraft(i, { category: v }))}
              </div>
              {s.kind === 'place' && (
                <div>
                  <label className={styles.fieldLabel}>
                    Linked memory (optional)
                    {!memoriesFailed ? (
                      <select value={s.memoryId} onChange={(e) => updateSpaceDraft(i, { memoryId: e.target.value })}>
                        <option value="">No linked memory</option>
                        {memories.map((m) => (
                          <option key={m.id} value={m.id}>{asString(m.title ?? m.caption, 'Untitled memory')}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={s.memoryId}
                        placeholder="Memory id (the memory list could not be loaded)"
                        onChange={(e) => updateSpaceDraft(i, { memoryId: e.target.value })}
                      />
                    )}
                  </label>
                  {memoriesFailed && <p><small>The shared memory list could not be loaded, so enter a memory id directly.</small></p>}
                </div>
              )}
              <button
                className={`${styles.btn} ${styles.btnQuiet} ${styles.btnSmall}`}
                type="button"
                onClick={() => setDraft({ ...draft, spaces: draft.spaces.filter((_, j) => j !== i) })}
              >
                Remove this space
              </button>
            </div>
          ))}
          <button
            className={`${styles.btn} ${styles.btnQuiet}`}
            type="button"
            onClick={() => setDraft({ ...draft, spaces: [...draft.spaces, { id: newCardId('space'), kind: 'place', name: '', description: '', price: '', rent: '', category: '', memoryId: '' }] })}
          >
            Add a space
          </button>
          {renderCardEditor('plotTwists', 'Plot Twist cards')}
          {renderCardEditor('littleSurprises', 'Little Surprise cards')}
          <div className={styles.btnRow}>
            <button className={styles.btn} type="button" disabled={editorSaving} onClick={() => void saveConfig()}>
              {editorSaving ? 'Saving…' : editingId ? 'Save changes' : 'Save new setup'}
            </button>
          </div>
        </div>
      )}
    </div>
  );

  const renderSetup = () => (
    <div className={styles.panel}>
      <h3>Set up a game</h3>
      {configsError && <p className={styles.error} role="alert">{configsError}</p>}
      {gameError && <p className={styles.error} role="alert">{gameError}</p>}
      <label className={styles.fieldLabel}>
        Board setup
        <select value={selectedConfigId} onChange={(e) => setSelectedConfigId(e.target.value)} disabled={configsLoading}>
          {configs.length === 0 && <option value="">No setups available</option>}
          {configs.map((cfg) => (
            <option key={cfg.id} value={cfg.id}>
              {cfg.name}{cfg.isDefault ? ' (default sample)' : ''}{cfg.authorId === me.id ? ' (yours)' : ''}
            </option>
          ))}
        </select>
      </label>
      {selectedConfig && (
        <p><small>{(selectedConfig.config.spaces || []).length} spaces · Start: {selectedConfig.config.startCoins} Memory Coins · Pass Start bonus: {selectedConfig.config.passStartBonus}</small></p>
      )}
      <div className={styles.playerForm}>
        <div>
          <h4>Player 1</h4>
          {renderEditorField('Name', p1Name, setP1Name)}
          {renderEditorField('Token (short text label)', p1Token, (v) => setP1Token(v.slice(0, 6)))}
          <div className={styles.btnRow} role="group" aria-label="Player 1 token choices">
            {TOKEN_PRESETS.map((t) => (
              <button key={t} className={`${styles.btn} ${styles.btnQuiet} ${styles.btnSmall}`} type="button" onClick={() => setP1Token(t)}>Use {t}</button>
            ))}
          </div>
        </div>
        <div>
          <h4>Player 2</h4>
          {renderEditorField('Name', p2Name, setP2Name)}
          {renderEditorField('Token (short text label)', p2Token, (v) => setP2Token(v.slice(0, 6)))}
          <div className={styles.btnRow} role="group" aria-label="Player 2 token choices">
            {TOKEN_PRESETS.map((t) => (
              <button key={t} className={`${styles.btn} ${styles.btnQuiet} ${styles.btnSmall}`} type="button" onClick={() => setP2Token(t)}>Use {t}</button>
            ))}
          </div>
        </div>
      </div>
      <div className={styles.btnRow}>
        <button className={styles.btn} type="button" disabled={starting || !selectedConfigId} onClick={() => void startGame()}>
          {starting ? 'Starting…' : 'Start game'}
        </button>
      </div>
    </div>
  );

  return (
    <div className={styles.wrap}>
      <h3 style={{ marginTop: 0 }}>Our Little World</h3>
      <p>Local two-player on this device — both players take turns on this same device. This is not online or synced play.</p>

      <div className={styles.panel}>
        <div className={styles.btnRow}>
          <button className={`${styles.btn} ${styles.btnQuiet}`} type="button" aria-expanded={rulesOpen} onClick={() => setRulesOpen((o) => !o)}>
            {rulesOpen ? 'Hide the rules' : 'Show the rules'}
          </button>
          {rulesError && (
            <button className={`${styles.btn} ${styles.btnQuiet}`} type="button" onClick={() => void refreshRules()}>Reload the rules</button>
          )}
        </div>
        {rulesOpen && (
          <div>
            {rulesError && <p className={styles.error} role="alert">{rulesError}</p>}
            {rules === null && !rulesError && <p>Loading the rules…</p>}
            {rules !== null && <p className={styles.rulesText}>{rules}</p>}
          </div>
        )}
      </div>

      {!game && renderSetup()}
      {game && (
        <>
          <div className={styles.panel}>
            <p role="status">
              Playing on: <strong>{selectedConfig?.name ?? 'this board setup'}</strong>
              {' '}· Local two-player on this device
            </p>
          </div>
          {renderBoard()}
          {renderTurnPanel()}
          {renderGameOver()}
        </>
      )}
      {renderEditor()}
    </div>
  );
}
