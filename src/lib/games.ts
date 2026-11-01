import type { PlaceStore } from './store';
import type { BoardConfig } from './boardGame';
import { DEFAULT_BOARD } from './boardGame';
import { supabase } from './supabase';
import { apiFetch } from './api';

/**
 * Phase 5 — the arcade data layer.
 *
 * Configs are shared (either member may edit them — both partners are the
 * "authorized partners" of this space). Progress is per user, visible to
 * both members (a completed game is something to celebrate, not a secret).
 * Guess rounds are different: the answer is private to the creator until
 * the round is revealed, and that rule is enforced by the server/view, not
 * by hiding a button — see the API endpoints and migration 0006.
 *
 * Demo mode keeps the same shapes in localStorage, with the same masking
 * applied in visibleRounds() (a demo profile switch must not leak answers).
 */

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
}

export interface Riddle {
  id: string;
  question: string;
  answer: string;
  hint?: string;
}

export interface QuizConfig { questions: QuizQuestion[] }
export interface ChestConfig { riddles: Riddle[]; finalMessage: string; finalMemoryId: string | null }
export interface MemoryConfig { pairs: number; source: 'patterns' | 'memories' }

export interface HeroMission {
  id: string;
  title: string;
  district: string;
  clue: string;
  tokenGoal: number;
  rewardMessage: string;
  rewardKind: 'none' | 'memory' | 'letter' | 'appreciation';
  rewardId: string | null;
}

export interface HeroConfig {
  missions: HeroMission[];
  finalMessage: string;
}

export interface GameConfigs {
  quiz: QuizConfig;
  chest: ChestConfig;
  memory: MemoryConfig;
  hero: HeroConfig;
  board: BoardConfig;
}

export interface GameProgress {
  id: string;
  gameKey: string;
  userId: string;
  userName: string;
  score: number;
  moves: number | null;
  timeMs: number | null;
  completed: boolean;
  details: Record<string, unknown>;
  updatedAt: string;
}

export interface GuessRound {
  id: string;
  spaceId: string;
  creatorId: string;
  creatorName: string;
  question: string;
  /** Null for the guesser until the round is revealed. */
  answer: string | null;
  guess: string | null;
  guessedBy: string | null;
  correct: boolean | null;
  revealed: boolean;
  createdAt: string;
}

export interface GameData {
  configs: GameConfigs;
  progress: GameProgress[];
  rounds: GuessRound[];
}

const DEMO_KEY = 'our-place-games-v1';

export const DEFAULT_QUIZ: QuizConfig = {
  questions: [
    { id: 'q1', question: 'What is our favourite way to spend a slow evening?', options: ['Cooking together', 'A walk with no destination', 'A film under a blanket', 'Reading in the same room'], correctIndex: 1 },
    { id: 'q2', question: 'Who is more likely to fall asleep first?', options: ['Me', 'My partner', 'Whoever had the longer day', 'We both pretend we did not'], correctIndex: 2 },
    { id: 'q3', question: 'What small thing always makes us laugh?', options: ['An inside joke', 'A mistimed text', 'The same old story, retold', 'A shared look across a room'], correctIndex: 0 },
  ],
};

export const DEFAULT_CHEST: ChestConfig = {
  riddles: [
    { id: 'r1', question: 'I have a face but no eyes, hands but no arms, and I tell you when it is time to go home. What am I?', answer: 'a clock', hint: 'It ticks.' },
    { id: 'r2', question: 'The more of me you take, the more you leave behind. What am I?', answer: 'footsteps' },
  ],
  finalMessage: 'You solved it together — and that is the whole point. Keep this one somewhere safe.',
  finalMemoryId: null,
};

export const DEFAULT_HERO: HeroConfig = {
  missions: [
    { id: 'h1', title: 'Rooftop Dawn', district: 'Rooftop Dawn', clue: 'Follow the lanterns east. The first token waits where the rooftops almost touch.', tokenGoal: 3, rewardMessage: 'A quiet morning, kept safe.', rewardKind: 'none', rewardId: null },
    { id: 'h2', title: 'Lantern Alley', district: 'Lantern Alley', clue: 'Zip across the gap where the alley bends. The checkpoint flag marks the way home.', tokenGoal: 3, rewardMessage: 'A small light, carried together.', rewardKind: 'none', rewardId: null },
    { id: 'h3', title: 'Starlight Bridge', district: 'Starlight Bridge', clue: 'Cross the bridge at the top of the city. The last token is near the far flag.', tokenGoal: 3, rewardMessage: 'The whole city, seen from above.', rewardKind: 'none', rewardId: null },
  ],
  finalMessage: 'You made it across the whole city — not because it was hard, but because you went together. That is the story this adventure was always telling.',
};

export const DEFAULT_CONFIGS: GameConfigs = {
  quiz: DEFAULT_QUIZ,
  chest: DEFAULT_CHEST,
  memory: { pairs: 6, source: 'patterns' },
  hero: DEFAULT_HERO,
  board: DEFAULT_BOARD,
};

export function normaliseAnswer(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ');
}

function loadDemo(): GameData {
  try {
    const raw = localStorage.getItem(DEMO_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<GameData>;
      if (parsed && parsed.configs) {
        return {
          configs: { quiz: parsed.configs.quiz ?? DEFAULT_QUIZ, chest: parsed.configs.chest ?? DEFAULT_CHEST, memory: parsed.configs.memory ?? DEFAULT_CONFIGS.memory, hero: parsed.configs.hero ?? DEFAULT_HERO, board: parsed.configs.board ?? DEFAULT_BOARD },
          progress: parsed.progress ?? [],
          rounds: parsed.rounds ?? [],
        };
      }
    }
  } catch { /* fall through */ }
  return { configs: DEFAULT_CONFIGS, progress: [], rounds: [] };
}

function saveDemo(data: GameData) {
  try { localStorage.setItem(DEMO_KEY, JSON.stringify(data)); } catch { /* ignore */ }
}

/** Rounds as the current viewer may see them: answers masked until revealed, or if they are the creator. */
export function visibleRounds(rounds: GuessRound[], viewerId: string): GuessRound[] {
  return rounds.map((r) => (r.revealed || r.creatorId === viewerId ? r : { ...r, answer: null }));
}

export async function loadGameData(store: PlaceStore): Promise<GameData> {
  if (store.mode === 'demo') return loadDemo();
  if (store.mode === 'api') {
    const data = await apiFetch('/api/games/data') as { configs: Partial<GameConfigs>; progress: GameProgress[]; rounds: GuessRound[] };
    return {
      configs: { quiz: data.configs.quiz ?? DEFAULT_QUIZ, chest: data.configs.chest ?? DEFAULT_CHEST, memory: data.configs.memory ?? DEFAULT_CONFIGS.memory, hero: data.configs.hero ?? DEFAULT_HERO, board: data.configs.board ?? DEFAULT_BOARD },
      progress: data.progress ?? [],
      rounds: data.rounds ?? [],
    };
  }
  if (!supabase) return loadDemo();
  const spaceId = store.data.space.id;
  const [cfgRes, progRes, roundRes] = await Promise.all([
    supabase.from('game_configs').select('*').eq('space_id', spaceId),
    supabase.from('game_progress').select('*').eq('space_id', spaceId).order('updated_at', { ascending: false }),
    supabase.from('game_rounds_visible').select('*').eq('space_id', spaceId).order('created_at', { ascending: false }),
  ]);
  const configs: GameConfigs = { ...DEFAULT_CONFIGS };
  for (const row of (cfgRes.data || []) as { game_key: string; config: unknown }[]) {
    if (row.game_key === 'quiz') configs.quiz = row.config as QuizConfig;
    if (row.game_key === 'chest') configs.chest = row.config as ChestConfig;
    if (row.game_key === 'memory') configs.memory = row.config as MemoryConfig;
    if (row.game_key === 'hero') configs.hero = row.config as HeroConfig;
    if (row.game_key === 'board') configs.board = row.config as BoardConfig;
  }
  const progress: GameProgress[] = ((progRes.data || []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id), gameKey: String(r.game_key), userId: String(r.user_id), userName: '',
    score: Number(r.score ?? 0), moves: r.moves ? Number(r.moves) : null, timeMs: r.time_ms ? Number(r.time_ms) : null,
    completed: true, details: (r.progress as Record<string, unknown>) || {}, updatedAt: String(r.updated_at),
  }));
  const rounds: GuessRound[] = ((roundRes.data || []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id), spaceId: String(r.space_id), creatorId: String(r.creator_id), creatorName: '',
    question: String(r.question), answer: r.answer ? String(r.answer) : null, guess: r.guess ? String(r.guess) : null,
    guessedBy: r.guessed_by ? String(r.guessed_by) : null, correct: r.correct === null ? null : Boolean(r.correct),
    revealed: Boolean(r.revealed), createdAt: String(r.created_at),
  }));
  // Names for progress/rounds come from the space members list, not from the
  // game tables (which store ids only).
  const nameById = new Map(store.data.members.map((m) => [m.id, m.displayName]));
  for (const p of progress) p.userName = nameById.get(p.userId) ?? 'Partner';
  for (const r of rounds) r.creatorName = nameById.get(r.creatorId) ?? 'Partner';
  return { configs, progress, rounds };
}

export async function saveGameConfig(store: PlaceStore, key: keyof GameConfigs, config: QuizConfig | ChestConfig | MemoryConfig | HeroConfig | BoardConfig): Promise<void> {
  if (store.mode === 'demo') {
    const data = loadDemo();
    data.configs[key] = config as never;
    saveDemo(data);
    return;
  }
  if (store.mode === 'api') {
    await apiFetch(`/api/games/config/${key}`, { method: 'PUT', body: JSON.stringify({ config }) });
    return;
  }
  if (!supabase) throw new Error('Supabase is not configured.');
  const { error } = await supabase.from('game_configs').upsert(
    { space_id: store.data.space.id, game_key: key, config, updated_by: store.viewerId },
    { onConflict: 'space_id,game_key' },
  );
  if (error) throw new Error(error.message);
}

export async function saveGameProgress(store: PlaceStore, input: { gameKey: string; score: number; moves?: number | null; timeMs?: number | null; details?: Record<string, unknown> }): Promise<void> {
  if (store.mode === 'demo') {
    const data = loadDemo();
    data.progress.unshift({
      id: `demo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, gameKey: input.gameKey,
      userId: store.viewerId, userName: store.viewerName, score: input.score, moves: input.moves ?? null,
      timeMs: input.timeMs ?? null, completed: true, details: input.details ?? {}, updatedAt: new Date().toISOString(),
    });
    saveDemo(data);
    return;
  }
  if (store.mode === 'api') {
    await apiFetch('/api/games/progress', { method: 'POST', body: JSON.stringify(input) });
    return;
  }
  if (!supabase) throw new Error('Supabase is not configured.');
  const { error } = await supabase.from('game_progress').upsert(
    { space_id: store.data.space.id, user_id: store.viewerId, game_key: input.gameKey, score: input.score, progress: input.details ?? {} },
    { onConflict: 'space_id,user_id,game_key' },
  );
  if (error) throw new Error(error.message);
  // A finished session row, for the "completed challenges" history.
  await supabase.from('game_sessions').insert({
    space_id: store.data.space.id, game_key: input.gameKey, status: 'finished',
    started_by: store.viewerId, ended_at: new Date().toISOString(),
  }).then(() => { /* best effort */ });
}

export async function createGuessRound(store: PlaceStore, question: string, answer: string): Promise<void> {
  if (store.mode === 'demo') {
    const data = loadDemo();
    data.rounds.unshift({
      id: `demo-${Date.now()}`, spaceId: store.data.space.id, creatorId: store.viewerId, creatorName: store.viewerName,
      question: question.trim(), answer: answer.trim(), guess: null, guessedBy: null, correct: null,
      revealed: false, createdAt: new Date().toISOString(),
    });
    saveDemo(data);
    return;
  }
  if (store.mode === 'api') {
    await apiFetch('/api/games/rounds', { method: 'POST', body: JSON.stringify({ question, answer }) });
    return;
  }
  if (!supabase) throw new Error('Supabase is not configured.');
  const { error } = await supabase.from('game_rounds').insert({
    space_id: store.data.space.id, creator_id: store.viewerId, question: question.trim(), answer: answer.trim(),
  });
  if (error) throw new Error(error.message);
}

export async function submitGuess(store: PlaceStore, roundId: string, guess: string): Promise<{ correct: boolean; answer: string }> {
  if (store.mode === 'demo') {
    const data = loadDemo();
    const round = data.rounds.find((r) => r.id === roundId);
    if (!round) throw new Error('That round could not be found.');
    if (round.creatorId === store.viewerId) throw new Error('You cannot guess your own question.');
    if (round.revealed) throw new Error('That round has already been guessed.');
    const correct = normaliseAnswer(guess) === normaliseAnswer(round.answer || '');
    round.guess = guess.trim(); round.guessedBy = store.viewerId; round.correct = correct; round.revealed = true;
    saveDemo(data);
    return { correct, answer: round.answer || '' };
  }
  if (store.mode === 'api') {
    const res = await apiFetch(`/api/games/rounds/${roundId}/guess`, { method: 'POST', body: JSON.stringify({ guess }) }) as { correct: boolean; answer: string };
    return res;
  }
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('guess_answer', { p_round_id: roundId, p_guess: guess });
  if (error || !data) throw new Error(error?.message || 'Could not submit that guess.');
  const row = data as { correct: boolean; answer: string };
  return { correct: Boolean(row.correct), answer: String(row.answer) };
}
