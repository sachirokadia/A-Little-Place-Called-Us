import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, DEFAULT_PREFERENCES, getPreferences, listItems, savePreferences, type Me, type Preferences, type Space } from '../lib/api.js';
import { Page } from '../components/ui.js';
import styles from './arcade.module.css';
import { PhotoMatch } from './boyfriend/PhotoMatch.js';
import { QuizGame } from './boyfriend/QuizGame.js';
import { CatchHearts } from './boyfriend/CatchHearts.js';
import { GuessGame } from './boyfriend/GuessGame.js';
import { ChestGame } from './boyfriend/ChestGame.js';
import { HeroAdventure } from './hero/HeroAdventure.js';
import { BoardGame } from './board/BoardGame.js';
import { BOYFRIEND_GAMES } from './boyfriend/registry.js';
import {
  BOARD_PASS_START_BONUS, BOARD_PLACES, BOARD_START_COINS, MATCH_DECK, MYSTERY_CLUES,
  MYSTERY_OPTIONS, MYSTERY_SOLUTION_ID, QUIZ_QUESTIONS, UNLOCKABLES, UNLOCK_KEYS,
  type UnlockKey,
} from './arcade-data.js';
import { FINAL_LETTER_PARAGRAPHS } from './final-letter.js';

// ---------------------------------------------------------------------------
// Progress persistence: server first, localStorage fallback second.
// Contract (backend worker, in parallel): GET/PUT
//   /spaces/:spaceId/game-progress/:gameKey  ->  { gameKey, progress }
// or 404 when nothing is saved yet. Any failure falls back to
// localStorage keys prefixed 'lp-arcade-' and the page says so honestly
// ("Saved on this device only") — it never claims a server save happened.
// ---------------------------------------------------------------------------

export type MemoryProgress = { completedGames: number; bestTurns: number | null; lastTurns: number | null; lastPairs: number };
export type MysteryProgress = { completed: boolean; foundClues: string[] };
export type QuizProgress = { answered: number; correct: number };
export type UnlocksProgress = { unlocks: string[] };

const clampInt = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.floor(v))) : fallback;

function parseProgress<T>(key: string, raw: unknown, fallback: T): T {
  if (!raw || typeof raw !== 'object') return fallback;
  const p = raw as Record<string, unknown>;
  if (key === 'memory-match') {
    const best = p.bestTurns;
    const last = p.lastTurns;
    return {
      completedGames: clampInt(p.completedGames, 0, 10000, 0),
      bestTurns: typeof best === 'number' ? clampInt(best, 8, 500, 8) : null,
      lastTurns: typeof last === 'number' ? clampInt(last, 8, 500, 8) : null,
      lastPairs: clampInt(p.lastPairs, 0, 12, 0),
    } as T;
  }
  if (key === 'mystery') {
    return {
      completed: p.completed === true,
      foundClues: Array.isArray(p.foundClues) ? p.foundClues.filter((c): c is string => typeof c === 'string') : [],
    } as T;
  }
  if (key === 'quiz') {
    return { answered: clampInt(p.answered, 0, 100, 0), correct: clampInt(p.correct, 0, 100, 0) } as T;
  }
  return {
    unlocks: Array.isArray(p.unlocks)
      ? p.unlocks.filter((u): u is string => typeof u === 'string' && (UNLOCK_KEYS as string[]).includes(u))
      : [],
  } as T;
}

function useGameProgress<T>(spaceId: string, key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const [localOnly, setLocalOnly] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const valueRef = useRef(value);
  valueRef.current = value;
  const localKey = `lp-arcade-${key}`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api<{ gameKey?: string; progress?: unknown } | unknown>(`/spaces/${spaceId}/game-progress/${key}`);
        const progress = (res as { progress?: unknown })?.progress ?? res;
        if (!cancelled) {
          setValue(parseProgress(key, progress, initial));
          setLocalOnly(false);
        }
      } catch {
        // Server has nothing (404) or is unreachable: local fallback.
        try {
          const raw = localStorage.getItem(localKey);
          if (raw && !cancelled) {
            setValue(parseProgress(key, JSON.parse(raw) as unknown, initial));
            setLocalOnly(true);
          }
        } catch { /* empty local storage is fine */ }
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId, key]);

  const save = useCallback(async (next: T) => {
    setValue(next);
    try {
      await api(`/spaces/${spaceId}/game-progress/${key}`, { method: 'PUT', body: { progress: next } });
      setLocalOnly(false);
    } catch {
      try { localStorage.setItem(localKey, JSON.stringify(next)); } catch { /* ignore */ }
      setLocalOnly(true);
    }
  }, [spaceId, key, localKey]);

  return { value, valueRef, save, localOnly, loaded };
}

// ---------------------------------------------------------------------------
// Sound: gentle WebAudio blips, OFF by default, no autoplay. The context is
// created lazily on first play and closed on toggle-off and on unmount.
// ---------------------------------------------------------------------------

function useSound() {
  // Sound preference: the server preference first, OFF by default.
  // If the server read fails, fall back to the existing local
  // behaviour (this device only) and say so honestly in the UI.
  const [enabled, setEnabled] = useState(false);
  const [serverPrefs, setServerPrefs] = useState<Preferences | null>(null);
  const [serverFailed, setServerFailed] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPreferences()
      .then((data) => {
        if (cancelled) return;
        const prefs = { ...DEFAULT_PREFERENCES, ...data };
        setServerFailed(false);
        setServerPrefs(prefs);
        setEnabled(prefs.soundEnabled);
      })
      .catch(() => { if (!cancelled) setServerFailed(true); });
    return () => { cancelled = true; };
  }, []);

  const close = useCallback(() => {
    const ctx = ctxRef.current;
    ctxRef.current = null;
    if (ctx) void ctx.close().catch(() => undefined);
  }, []);

  useEffect(() => () => { close(); }, [close]);

  const toggle = useCallback(() => {
    const next = !enabled;
    if (enabled) close();
    setEnabled(next);
    if (serverPrefs) {
      const updated = { ...serverPrefs, soundEnabled: next };
      savePreferences(updated)
        .then((data) => setServerPrefs({ ...DEFAULT_PREFERENCES, ...data }))
        .catch(() => setServerFailed(true));
    } else {
      setServerFailed(true);
    }
  }, [close, serverPrefs, enabled]);

  const play = useCallback((kind: 'flip' | 'match' | 'win') => {
    if (!enabled) return;
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = ctxRef.current ?? new Ctx();
      ctxRef.current = ctx;
      if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
      const freqs = kind === 'flip' ? [520] : kind === 'match' ? [660, 880] : [523, 659, 784, 1047];
      freqs.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.09);
        gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + i * 0.09 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.09 + 0.18);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.09);
        osc.stop(ctx.currentTime + i * 0.09 + 0.2);
      });
    } catch { /* sound is optional */ }
  }, [enabled]);

  return { enabled, toggle, play, serverFailed };
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

function scrollToSection(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  (el as HTMLElement).focus({ preventScroll: true });
}

// ---------------------------------------------------------------------------
// Memory Match
// ---------------------------------------------------------------------------

function MemoryMatch({ progress, onSave, onUnlock, play }: {
  progress: MemoryProgress;
  onSave: (next: MemoryProgress) => Promise<void>;
  onUnlock: (key: UnlockKey) => void;
  play: (kind: 'flip' | 'match' | 'win') => void;
}) {
  const [gameId, setGameId] = useState(0);
  const cards = useRef(shuffle(MATCH_DECK.flatMap((pair, pairIndex) => [
    { pairIndex, cardId: `${pairIndex}-a` },
    { pairIndex, cardId: `${pairIndex}-b` },
  ]))).current;
  // Re-shuffle only when a new game starts.
  const [deck, setDeck] = useState(cards);
  const [flipped, setFlipped] = useState<number[]>([]);
  const [matched, setMatched] = useState<Set<number>>(new Set());
  const [turns, setTurns] = useState(0);
  const [busy, setBusy] = useState(false);
  const [justWon, setJustWon] = useState(false);
  const savedForGame = useRef(-1);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const restart = () => {
    setDeck(shuffle(MATCH_DECK.flatMap((pair, pairIndex) => [
      { pairIndex, cardId: `${pairIndex}-a` },
      { pairIndex, cardId: `${pairIndex}-b` },
    ])));
    setFlipped([]);
    setMatched(new Set());
    setTurns(0);
    setBusy(false);
    setJustWon(false);
    setGameId((g) => g + 1);
  };

  const flip = (index: number) => {
    if (busy || flipped.includes(index)) return;
    const pairIndex = deck[index]!.pairIndex;
    if (matched.has(pairIndex)) return;
    play('flip');
    if (flipped.length === 0) {
      setFlipped([index]);
      return;
    }
    const first = deck[flipped[0]!]!.pairIndex;
    const newTurns = turns + 1;
    setTurns(newTurns);
    setFlipped([flipped[0]!, index]);
    if (first === pairIndex) {
      const newMatched = new Set(matched);
      newMatched.add(pairIndex);
      setMatched(newMatched);
      setFlipped([]);
      play('match');
      if (newMatched.size === MATCH_DECK.length && savedForGame.current !== gameId) {
        savedForGame.current = gameId;
        setJustWon(true);
        play('win');
        const best = progress.bestTurns === null ? newTurns : Math.min(progress.bestTurns, newTurns);
        void onSave({ completedGames: progress.completedGames + 1, bestTurns: best, lastTurns: newTurns, lastPairs: MATCH_DECK.length });
        onUnlock('golden-star');
      }
    } else {
      setBusy(true);
      window.setTimeout(() => { setFlipped([]); setBusy(false); }, 800);
    }
  };

  const onCardKeyDown = (e: React.KeyboardEvent, index: number) => {
    const col = index % 4;
    const row = Math.floor(index / 4);
    let next = index;
    if (e.key === 'ArrowLeft') next = row * 4 + Math.max(0, col - 1);
    else if (e.key === 'ArrowRight') next = row * 4 + Math.min(3, col + 1);
    else if (e.key === 'ArrowUp') next = Math.max(0, row - 1) * 4 + col;
    else if (e.key === 'ArrowDown') next = Math.min(3, row + 1) * 4 + col;
    else return;
    e.preventDefault();
    btnRefs.current[next]?.focus();
  };

  const pairsFound = matched.size;
  return (
    <div>
      <p>Flip two cards. Find all {MATCH_DECK.length} pairs in as few turns as you can. Playable by tap, click, or keyboard: Tab to a card, use the arrow keys to move across the grid, and press Enter or Space to flip.</p>
      <p role="status">
        Turns: {turns} · Pairs found: {pairsFound} of {MATCH_DECK.length}
        {progress.completedGames > 0 && (
          <> · Saved: {progress.completedGames} completed game{progress.completedGames === 1 ? '' : 's'}
            {progress.bestTurns !== null ? `, best ${progress.bestTurns} turns` : ''}</>
        )}
      </p>
      <div className={styles.cardGrid} role="group" aria-label="Memory match card grid">
        {deck.map((card, i) => {
          const pair = MATCH_DECK[card.pairIndex]!;
          const isUp = flipped.includes(i) || matched.has(card.pairIndex);
          const isMatched = matched.has(card.pairIndex);
          return (
            <button
              key={card.cardId}
              ref={(el) => { btnRefs.current[i] = el; }}
              type="button"
              className={`${styles.cardBtn} ${isUp ? styles.cardBtnRevealed : ''} ${isMatched ? styles.cardBtnMatched : ''}`}
              aria-label={isUp ? `${pair.label} card` : 'Face-down card'}
              onClick={() => flip(i)}
              onKeyDown={(e) => onCardKeyDown(e, i)}
            >
              {isUp ? (<><span aria-hidden="true">{pair.symbol}</span><span className={styles.cardLabel}>{pair.label}</span></>) : (<span aria-hidden="true">?</span>)}
            </button>
          );
        })}
      </div>
      <button className={`${styles.btn} ${styles.btnQuiet}`} type="button" onClick={restart}>Restart this game</button>
      {justWon && (
        <div role="status" style={{ marginTop: '1rem' }}>
          <p><strong>You matched every pair in {turns} turns!</strong> A golden star has been added to your unlocks — look for it back on Home.</p>
          <div className={styles.confetti} aria-hidden="true"><span>★</span><span>✦</span><span>★</span><span>✦</span><span>★</span></div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detective mini-mystery (fictional sample only)
// ---------------------------------------------------------------------------

function MiniMystery({ progress, onSave, onUnlock, play }: {
  progress: MysteryProgress;
  onSave: (next: MysteryProgress) => Promise<void>;
  onUnlock: (key: UnlockKey) => void;
  play: (kind: 'flip' | 'match' | 'win') => void;
}) {
  const [found, setFound] = useState<string[]>(progress.completed ? MYSTERY_CLUES.map((c) => c.id) : progress.foundClues);
  const [picked, setPicked] = useState<string | null>(null);
  const [solved, setSolved] = useState(progress.completed);
  const [attemptedWrong, setAttemptedWrong] = useState(false);
  const savedRef = useRef(progress.completed);

  const revealClue = (id: string) => {
    if (found.includes(id)) return;
    play('flip');
    const next = [...found, id];
    setFound(next);
    void onSave({ completed: false, foundClues: next });
  };

  const answer = (id: string) => {
    setPicked(id);
    if (id === MYSTERY_SOLUTION_ID) {
      setSolved(true);
      play('win');
      if (!savedRef.current) {
        savedRef.current = true;
        void onSave({ completed: true, foundClues: found });
        onUnlock('lantern');
      }
    } else {
      setAttemptedWrong(true);
    }
  };

  const allFound = found.length === MYSTERY_CLUES.length;
  return (
    <div>
      <div className={styles.note}><p><strong>Sample mystery — replace with your own story later.</strong> This is a fictional sample. It is not a real event, and it names no real people or dates.</p></div>
      <p>A case of the missing station parcel, in a fictional town. Inspect the clues in order — each clue unlocks the next — then choose your answer.</p>
      <div className={styles.clueList}>
        {MYSTERY_CLUES.map((clue, i) => {
          const unlocked = i === 0 || found.includes(MYSTERY_CLUES[i - 1]!.id);
          const revealed = found.includes(clue.id);
          return (
            <div key={clue.id}>
              <button
                className={styles.clueBtn}
                type="button"
                disabled={!unlocked || revealed}
                aria-expanded={revealed}
                onClick={() => revealClue(clue.id)}
              >
                {revealed ? `${clue.title} — revealed` : unlocked ? `${clue.title} — click to inspect` : `${clue.title} — inspect the previous clue first`}
              </button>
              {revealed && <p style={{ margin: '0.5rem 0 0' }}>{clue.text}</p>}
            </div>
          );
        })}
      </div>
      <p role="status">Clues found: {found.length} of {MYSTERY_CLUES.length}</p>
      {allFound && !solved && (
        <div>
          <h3>Who took the parcel — and how?</h3>
          <div className={styles.clueList}>
            {MYSTERY_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                className={`${styles.optionBtn} ${picked === opt.id ? styles.optionBtnSelected : ''}`}
                type="button"
                onClick={() => answer(opt.id)}
              >
                {opt.text}
              </button>
            ))}
          </div>
          {attemptedWrong && picked !== MYSTERY_SOLUTION_ID && (
            <p role="status">Not quite — that answer does not fit all four clues. Read the clues again and try another answer; nothing is lost.</p>
          )}
        </div>
      )}
      {solved && (
        <div role="status">
          <h3>The slow train, and the light</h3>
          <p>The parcel was never stolen. It was put on the slow train by mistake, and it waited at the little station where the lamp is left burning — the station the fast train skips. The slow train stops there, the parcel is found in cabinet 3&apos;s lost-property box, and the case closes with a cup of tea in the waiting room. Every clue pointed the same way: the smudged ticket, the cabinet key, the torn timetable, and the pencil note.</p>
          <p>A lantern has been added to your unlocks — look for it back on Home.</p>
          <div className={styles.note}>
            <p style={{ margin: 0 }}><strong>Sample reward note (placeholder — replace with a real message later)</strong></p>
            <p style={{ margin: '0.5rem 0 0' }}>[A short reward note can go here later. This panel is intentionally left as a placeholder.]</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Relationship quiz (sample questions, compare-style)
// ---------------------------------------------------------------------------

function SampleQuiz({ progress, onSave, onUnlock }: {
  progress: QuizProgress;
  onSave: (next: QuizProgress) => Promise<void>;
  onUnlock: (key: UnlockKey) => void;
}) {
  const [qIndex, setQIndex] = useState(0);
  const [turn, setTurn] = useState<1 | 2>(1);
  const [picks, setPicks] = useState<{ p1: string | null; p2: string | null }>({ p1: null, p2: null });
  const [finished, setFinished] = useState(false);
  const [runCorrect, setRunCorrect] = useState(0);
  const [savedDisplay, setSavedDisplay] = useState<{ answered: number; correct: number } | null>(null);
  const savedRef = useRef(false);

  const question = QUIZ_QUESTIONS[qIndex]!;
  const pick = (option: string) => {
    if (turn === 1) {
      setPicks({ p1: option, p2: null });
      setTurn(2);
    } else {
      const newPicks = { p1: picks.p1, p2: option };
      setPicks(newPicks);
      if (newPicks.p1 === question.sampleAnswer && newPicks.p2 === question.sampleAnswer) {
        setRunCorrect((c) => c + 1);
      }
    }
  };

  const next = () => {
    if (qIndex + 1 >= QUIZ_QUESTIONS.length) {
      setFinished(true);
      if (!savedRef.current) {
        savedRef.current = true;
        const totals = { answered: Math.min(100, progress.answered + QUIZ_QUESTIONS.length), correct: Math.min(100, progress.correct + runCorrect) };
        setSavedDisplay(totals);
        void onSave(totals);
        onUnlock('banner');
      }
    } else {
      setQIndex(qIndex + 1);
      setTurn(1);
      setPicks({ p1: null, p2: null });
    }
  };

  const restart = () => {
    setQIndex(0);
    setTurn(1);
    setPicks({ p1: null, p2: null });
    setFinished(false);
    setRunCorrect(0);
    setSavedDisplay(null);
    savedRef.current = false;
  };

  if (finished) {
    return (
      <div role="status">
        <h3>Sample score: {runCorrect} out of {QUIZ_QUESTIONS.length}</h3>
        <p>That score counts only questions where both players picked the sample matching answer. These are sample questions, not facts about any real couple — the fun is comparing what you each picked, not the number.</p>
        <p>This run: {QUIZ_QUESTIONS.length} answered, {runCorrect} sample matches. Saved totals across all your quiz runs: {savedDisplay ? `${savedDisplay.answered} answered, ${savedDisplay.correct} sample matches` : 'saving…'}. A bunting banner has been added to your unlocks.</p>
        <button className={`${styles.btn} ${styles.btnQuiet}`} type="button" onClick={restart}>Play the sample quiz again</button>
      </div>
    );
  }

  const revealed = picks.p1 !== null && picks.p2 !== null;
  return (
    <div>
      <div className={styles.note}><p><strong>Sample questions — edit these in arcade-data.ts.</strong> Both players answer on this same device, one after the other. Answers are shown side by side as what each player picked — never as facts about the couple.</p></div>
      <p role="status">Question {qIndex + 1} of {QUIZ_QUESTIONS.length} · Sample score so far this run: {runCorrect}</p>
      <h3>{question.question}</h3>
      {!revealed && (
        <>
          <p>{turn === 1 ? 'Player 1, pick an answer. Player 2, look away for a moment.' : 'Player 2, now pick your answer.'}</p>
          <div className={styles.clueList}>
            {question.options.map((opt) => (
              <button key={opt} className={styles.optionBtn} type="button" onClick={() => pick(opt)}>{opt}</button>
            ))}
          </div>
        </>
      )}
      {revealed && (
        <div role="status">
          <p>Player 1 picked: <strong>{picks.p1}</strong></p>
          <p>Player 2 picked: <strong>{picks.p2}</strong></p>
          <p>Sample matching answer (sample only): <strong>{question.sampleAnswer}</strong></p>
          <p>{picks.p1 === picks.p2
            ? (picks.p1 === question.sampleAnswer ? 'You both picked the sample answer — that counts as a sample match.' : 'You both picked the same answer, but it is not the sample answer — so no sample match this time.')
            : 'You picked different answers — that is the comparison, not a wrong answer.'}</p>
          <button className={styles.btn} type="button" onClick={next}>{qIndex + 1 >= QUIZ_QUESTIONS.length ? 'Finish the sample quiz' : 'Next question'}</button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Property-trading board: pass-and-play, two players, one device.
// Fully playable: dice, loop movement, buying, rent, bankruptcy, restart.
// ---------------------------------------------------------------------------

type BoardPlayer = { coins: number; pos: number };

function TradingBoard({ onUnlock }: { onUnlock: (key: UnlockKey) => void }) {
  const fresh = (): { players: BoardPlayer[]; owners: (number | null)[]; turn: number; dice: number | null; phase: 'roll' | 'decide' | 'over'; winner: number | null; log: string } => ({
    players: [{ coins: BOARD_START_COINS, pos: 0 }, { coins: BOARD_START_COINS, pos: 0 }],
    owners: BOARD_PLACES.map(() => null),
    turn: 0,
    dice: null,
    phase: 'roll',
    winner: null,
    log: `Player 1 starts on Start Square with ${BOARD_START_COINS} coins.`,
  });
  const [state, setState] = useState(fresh);
  const unlockedRef = useRef(false);

  const nextTurn = (s: typeof state, keepLog: string) => ({
    ...s,
    turn: s.turn === 0 ? 1 : 0,
    dice: null,
    phase: 'roll' as const,
    log: keepLog,
  });

  const roll = () => {
    const dice = 1 + Math.floor(Math.random() * 6);
    const me = state.players[state.turn]!;
    const rawPos = me.pos + dice;
    const passedStart = rawPos >= BOARD_PLACES.length;
    const pos = rawPos % BOARD_PLACES.length;
    let coins = me.coins + (passedStart ? BOARD_PASS_START_BONUS : 0);
    const place = BOARD_PLACES[pos]!;
    const players = state.players.map((p, i) => (i === state.turn ? { ...p, pos, coins } : p));
    let base: typeof state = {
      ...state,
      players,
      dice,
      log: `Player ${state.turn + 1} rolled ${dice} and landed on ${place.name}.${passedStart ? ` Passing Start Square added ${BOARD_PASS_START_BONUS} coins.` : ''}`,
    };
    if (pos === 0 || place.price === 0) return setState(nextTurn(base, base.log));
    const owner = state.owners[pos];
    if (owner === null) {
      if (coins < place.price) return setState(nextTurn(base, `${base.log} It costs ${place.price} coins, which Player ${state.turn + 1} cannot afford, so it stays unowned.`));
      return setState({ ...base, phase: 'decide' });
    }
    if (owner === state.turn) return setState(nextTurn(base, `${base.log} Player ${state.turn + 1} already owns it.`));
    // Rent to the other player.
    if (coins < place.rent) {
      return setState({ ...base, phase: 'over', winner: owner, log: `${base.log} Rent is ${place.rent} coins, but Player ${state.turn + 1} only has ${coins} — bankrupt! Player ${owner + 1} wins.` });
    }
    coins -= place.rent;
    const paid = players.map((p, i) => {
      if (i === state.turn) return { ...p, coins };
      if (i === owner) return { ...p, coins: p.coins + place.rent };
      return p;
    });
    return setState(nextTurn({ ...base, players: paid }, `${base.log} Player ${state.turn + 1} paid ${place.rent} coins rent to Player ${owner + 1}.`));
  };

  const buy = () => {
    const me = state.players[state.turn]!;
    const place = BOARD_PLACES[me.pos]!;
    const players = state.players.map((p, i) => (i === state.turn ? { ...p, coins: p.coins - place.price } : p));
    const owners = state.owners.map((o, i) => (i === me.pos ? state.turn : o));
    setState(nextTurn({ ...state, players, owners }, `Player ${state.turn + 1} bought ${place.name} for ${place.price} coins.`));
  };

  const skipBuy = () => {
    const place = BOARD_PLACES[state.players[state.turn]!.pos]!;
    setState(nextTurn(state, `Player ${state.turn + 1} left ${place.name} unowned.`));
  };

  const restart = () => { unlockedRef.current = false; setState(fresh()); };

  useEffect(() => {
    if (state.phase === 'over' && state.winner !== null && !unlockedRef.current) {
      unlockedRef.current = true;
      onUnlock('pixel-cat');
    }
  }, [state.phase, state.winner, onUnlock]);

  const currentPlace = BOARD_PLACES[state.players[state.turn]!.pos]!;
  return (
    <div>
      <p>Pass-and-play on this one device: Player 1 and Player 2 take turns. No invented partner names — just Player 1 and Player 2. Roll the dice, move around the loop, buy places with coins, and pay rent when you land on the other player&apos;s place. Run out of coins on rent and you are bankrupt — the other player wins.</p>
      <div className={styles.scoreRow}>
        {state.players.map((p, i) => (
          <div key={i} className={styles.scoreBox} role="status">
            <strong>Player {i + 1}{state.turn === i && state.phase !== 'over' ? ' — your turn' : ''}</strong>
            <p style={{ margin: '0.25rem 0 0' }}>{p.coins} coins · on {BOARD_PLACES[p.pos]!.name}</p>
          </div>
        ))}
      </div>
      <p role="status">{state.log}</p>
      {state.phase === 'roll' && (
        <button className={styles.btn} type="button" onClick={roll}>Player {state.turn + 1}: roll the dice{state.dice !== null ? ` (last roll: ${state.dice})` : ''}</button>
      )}
      {state.phase === 'decide' && (
        <div>
          <p><strong>{currentPlace.name}</strong> is unowned. It costs {currentPlace.price} coins (rent {currentPlace.rent}). Player {state.turn + 1} has {state.players[state.turn]!.coins} coins.</p>
          <button className={styles.btn} type="button" onClick={buy}>Buy {currentPlace.name} for {currentPlace.price} coins</button>{' '}
          <button className={`${styles.btn} ${styles.btnQuiet}`} type="button" onClick={skipBuy}>Leave it unowned</button>
        </div>
      )}
      {state.phase === 'over' && state.winner !== null && (
        <div role="status">
          <h3>Player {state.winner + 1} wins!</h3>
          <p>The other player went bankrupt on rent. A pixel cat has been added to your unlocks — look for it back on Home.</p>
          <button className={styles.btn} type="button" onClick={restart}>Play again</button>
        </div>
      )}
      {state.phase !== 'over' && <p><button className={`${styles.btn} ${styles.btnQuiet}`} type="button" onClick={restart}>Restart the board</button></p>}
      <div className={styles.boardTiles}>
        {BOARD_PLACES.map((place, i) => {
          const owner = state.owners[i];
          const here = state.players.map((p, pi) => (p.pos === i ? pi + 1 : null)).filter((x): x is number => x !== null);
          return (
            <div key={place.name} className={`${styles.tile} ${here.length > 0 ? styles.tileActive : ''}`}>
              <p><strong>{place.name}</strong>{here.length > 0 ? ` — Player ${here.join(' & Player ')} is here` : ''}</p>
              {place.price > 0 ? (
                <><p>Price: {place.price} coins · Rent: {place.rent} coins</p><p>{owner === null ? 'Unowned' : `Owned by Player ${owner + 1}`}</p></>
              ) : (
                <p>Passing here adds {BOARD_PASS_START_BONUS} coins.</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Arcade page
// ---------------------------------------------------------------------------

export function ArcadeContent({ space, me }: { space: Space; me: Me }) {
  const memory = useGameProgress<MemoryProgress>(space.id, 'memory-match', { completedGames: 0, bestTurns: null, lastTurns: null, lastPairs: 0 });
  const mystery = useGameProgress<MysteryProgress>(space.id, 'mystery', { completed: false, foundClues: [] });
  const quiz = useGameProgress<QuizProgress>(space.id, 'quiz', { answered: 0, correct: 0 });
  const unlocks = useGameProgress<UnlocksProgress>(space.id, 'arcade-unlocks', { unlocks: [] });
  const sound = useSound();

  const addUnlock = useCallback((key: UnlockKey) => {
    const current = unlocks.valueRef.current.unlocks;
    if (current.includes(key)) return;
    let next = [...current, key];
    // The pixel fox appears once the other four are all unlocked.
    const base: UnlockKey[] = ['golden-star', 'lantern', 'banner', 'pixel-cat'];
    if (base.every((k) => next.includes(k)) && !next.includes('pixel-fox')) next = [...next, 'pixel-fox'];
    void unlocks.save({ unlocks: next });
  }, [unlocks]);

  const [memories, setMemories] = useState<{ id: string; title: string }[]>([]);
  useEffect(() => {
    listItems(space.id, 'memories').then((items) => {
      setMemories(items.filter((i) => typeof i.title === 'string').map((i) => ({ id: i.id, title: i.title as string })).slice(0, 1));
    }).catch(() => setMemories([]));
  }, [space.id]);

  const [starRevealed, setStarRevealed] = useState(() => {
    try { return localStorage.getItem('lp-hidden-step') === 'arcade'; } catch { return false; }
  });
  const starClickedRef = useRef(false);
  useEffect(() => {
    if (starRevealed && starClickedRef.current) {
      starClickedRef.current = false;
      scrollToSection('star-message');
    }
  }, [starRevealed]);
  // Letter replay: re-triggers ONLY the CSS opening animation by changing
  // the letter element's key. It writes nothing (no localStorage, no API)
  // and changes no unlock/star/progress state.
  const [letterReplayKey, setLetterReplayKey] = useState(0);
  const replayLetter = () => setLetterReplayKey((k) => k + 1);

  const openStar = () => {
    try { localStorage.setItem('lp-hidden-step', 'arcade'); } catch { /* ignore */ }
    starClickedRef.current = true;
    setStarRevealed(true);
  };

  const localOnly = memory.localOnly || mystery.localOnly || quiz.localOnly || unlocks.localOnly;
  const unlockedSet = new Set(unlocks.value.unlocks);

  return (
    <Page title="Secret Arcade" subtitle="A playful little pixel world, tucked inside the storybook rooms." backHome>
      <div className={styles.wrap}>
        <div className={styles.arch} aria-label="Arcade doorway">
          <p className={styles.archTitle}>✦ Secret Arcade ✦</p>
          <p className={styles.archText}>Step through this doorway: you are stepping from the storybook rooms into the playful arcade. The cottage, the letters and the memories are still right behind you — nothing here locks anything away.</p>
          <div className={styles.pixelRow} aria-hidden="true"><span>★</span><span>♦</span><span>♪</span><span>☾</span><span>★</span><span>♦</span><span>♪</span><span>☾</span></div>
          <div className={styles.pixelRow} aria-hidden="true"><span>▓▓▓</span><span>█ █</span><span>▓▓▓</span><span>█ █</span><span>▓▓▓</span></div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', alignItems: 'center', marginBottom: '1rem' }}>
          <button className={`${styles.btn} ${styles.btnQuiet}`} type="button" aria-pressed={sound.enabled} onClick={sound.toggle}>
            Sound: {sound.enabled ? 'on' : 'off'}
          </button>
          <p style={{ margin: 0 }}>Sound is off by default. Turn it on for gentle blips when cards flip, match, or a game is won.</p>
          {sound.serverFailed && <p style={{ margin: 0 }}><small>Sound preference could not be loaded from your account, so this setting is saved on this device only for now.</small></p>}
        </div>

        {localOnly && (
          <div className={styles.note} role="status"><p>Saved on this device only — the server save did not go through, so this progress lives in this browser for now. Nothing here pretends otherwise.</p></div>
        )}

        <nav className={styles.mapNav} aria-label="Arcade map">
          <button className={styles.mapBtn} type="button" onClick={() => scrollToSection('game-memory')}>Memory Match</button>
          <button className={styles.mapBtn} type="button" onClick={() => scrollToSection('game-mystery')}>Mini-Mystery</button>
          <button className={styles.mapBtn} type="button" onClick={() => scrollToSection('game-quiz')}>Sample Quiz</button>
          <button className={styles.mapBtn} type="button" onClick={() => scrollToSection('game-board')}>Trading Board</button>
          <button className={styles.mapBtn} type="button" onClick={() => scrollToSection('game-collectible')}>Memory Collectible</button>
          <button className={styles.mapBtn} type="button" onClick={() => scrollToSection('arcade-star')}>Brass Star</button>
        </nav>

        <nav className={styles.mapNav} aria-label="Boyfriend Arcade map">
          {BOYFRIEND_GAMES.map((game) => (
            <button key={game.id} className={styles.mapBtn} type="button" onClick={() => scrollToSection(game.anchor)}>{game.title}</button>
          ))}
        </nav>

        <section className={styles.section} aria-label="The Boyfriend Arcade">
          <h2 style={{ marginTop: 0 }}>The Boyfriend Arcade</h2>
          <p>More games, tucked inside the same arcade. Questions, riddles, and guess rounds are ones you write yourselves and are stored in the database — nothing here invents a memory, and the chest never locks a real memory away.</p>
        </section>

        <div className={styles.starCard} id="arcade-star">
          <h2 style={{ marginTop: 0 }}>Brass star</h2>
          <p>You followed the star from Home. This star&apos;s message is pinned just below — open it.</p>
          <p>This marker works whether or not you came here from Home, so the reveal is never blocked by a lost step: if you found this star on your own, it works exactly the same way.</p>
          <button className={styles.btn} type="button" onClick={openStar}>Read the final star message</button>
        </div>

        <section className={styles.section} id="game-memory" tabIndex={-1} aria-labelledby="memory-heading">
          <h2 id="memory-heading">Memory Match</h2>
          <MemoryMatch progress={memory.value} onSave={memory.save} onUnlock={addUnlock} play={sound.play} />
        </section>

        <section className={styles.section} id="game-mystery" tabIndex={-1} aria-labelledby="mystery-heading">
          <h2 id="mystery-heading">Detective Mini-Mystery</h2>
          <MiniMystery progress={mystery.value} onSave={mystery.save} onUnlock={addUnlock} play={sound.play} />
        </section>

        <section className={styles.section} id="game-quiz" tabIndex={-1} aria-labelledby="quiz-heading">
          <h2 id="quiz-heading">Relationship Quiz — samples</h2>
          <SampleQuiz progress={quiz.value} onSave={quiz.save} onUnlock={addUnlock} />
        </section>

        <section className={styles.section} id="game-board" tabIndex={-1} aria-labelledby="board-heading">
          <h2 id="board-heading">Property-Trading Board</h2>
          <TradingBoard onUnlock={addUnlock} />
        </section>

        <section className={styles.section} id="game-collectible" tabIndex={-1} aria-labelledby="collectible-heading">
          <h2 id="collectible-heading">Memory collectible</h2>
          {memories.length > 0 ? (
            <p>Your collectible for today is a real memory from your Memory Wall: <Link to="/memories">“{memories[0]!.title}” — open it on the Memory Wall →</Link></p>
          ) : (
            <p>A generic arcade collectible: a pixel star token, earned simply by visiting the arcade. There is no memory linked here yet — when you add a real memory to the Memory Wall, a real one will appear here instead. Nothing here invents a memory.</p>
          )}
        </section>

        <section className={styles.section} id="game-photo-match" tabIndex={-1} aria-labelledby="photo-match-heading">
          <h2 id="photo-match-heading">Photo Memory Match</h2>
          <PhotoMatch space={space} me={me} />
        </section>

        <section className={styles.section} id="game-quiz-db" tabIndex={-1} aria-labelledby="quiz-db-heading">
          <h2 id="quiz-db-heading">How Well Do You Know Us?</h2>
          <QuizGame space={space} me={me} />
        </section>

        <section className={styles.section} id="game-catch-hearts" tabIndex={-1} aria-labelledby="catch-hearts-heading">
          <h2 id="catch-hearts-heading">Catch the Hearts</h2>
          <CatchHearts space={space} me={me} />
        </section>

        <section className={styles.section} id="game-guess" tabIndex={-1} aria-labelledby="guess-heading">
          <h2 id="guess-heading">Guess My Answer</h2>
          <GuessGame space={space} me={me} />
        </section>

        <section className={styles.section} id="game-chest" tabIndex={-1} aria-labelledby="chest-heading">
          <h2 id="chest-heading">Unlock the Chest</h2>
          <ChestGame space={space} me={me} />
        </section>

        <section className={styles.section} id="game-hero-adventure" tabIndex={-1} aria-labelledby="hero-adventure-heading">
          <h2 id="hero-adventure-heading">The Rooftop Adventure</h2>
          <HeroAdventure space={space} me={me} />
        </section>

        <section className={styles.section} id="game-our-little-world" tabIndex={-1} aria-labelledby="our-little-world-heading">
          <h2 id="our-little-world-heading">Our Little World</h2>
          <BoardGame space={space} me={me} />
        </section>

        <section className={styles.section} aria-label="Your arcade unlocks">
          <h2 style={{ marginTop: 0 }}>Your unlocks</h2>
          {unlockedSet.size === 0 ? (
            <p>No unlocks yet. Finish a game above and its decoration appears here — and back on Home, beside the cottage. Unlocks never gate any room.</p>
          ) : (
            <div className={styles.unlockRow}>
              {UNLOCKABLES.filter((u) => unlockedSet.has(u.key)).map((u) => (
                <span key={u.key} className={styles.unlockChip}>{u.label} — {u.blurb}</span>
              ))}
            </div>
          )}
        </section>

        {starRevealed && (
          <section className={styles.section} id="star-message" tabIndex={-1} aria-labelledby="star-message-heading">
            <h2 id="star-message-heading">The final star message</h2>
            <p>Draft letter — to be personalised by its author later</p>
            <div key={letterReplayKey} className={`${styles.letterPage} ${styles.letterOpen}`}>
              {FINAL_LETTER_PARAGRAPHS.map((paragraph, i) => (
                <p key={i} className={styles.letterParagraph}>{paragraph}</p>
              ))}
            </div>
            <p>
              <button className={`${styles.btn} ${styles.btnQuiet}`} type="button" onClick={replayLetter}>Read it again</button>
            </p>
            <p><Link to="/">Back to Home →</Link></p>
          </section>
        )}
      </div>
    </Page>
  );
}
