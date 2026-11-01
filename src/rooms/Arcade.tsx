import { useEffect, useMemo, useRef, useState } from 'react';
import type { PlaceStore } from '../lib/store';
import type { ChestConfig, GameData, MemoryConfig, QuizConfig, QuizQuestion } from '../lib/games';
import { DEFAULT_CONFIGS, createGuessRound, loadGameData, normaliseAnswer, saveGameConfig, saveGameProgress, submitGuess, visibleRounds } from '../lib/games';
import { Page, Card, Empty, Button, Field, inputCls, ConfirmDelete } from '../components/ui';
import { formatDate } from '../lib/utils';
import { HeroAdventure } from './HeroAdventure';
import { BoardGame } from './BoardGame';

type Props = { store: PlaceStore; refresh: () => void; notify: (m: string, k?: 'ok' | 'error') => void };
type GameProps = Props & { data: GameData; reload: () => Promise<void> };

/**
 * Phase 5 — the Boyfriend Arcade.
 *
 * A game registry, not a rewrite: adding a game means adding one entry to
 * GAMES below and one component in this file. No sound is included at all
 * (sound is optional, and off here means absent, not a fake toggle).
 * Scores are only ever recorded through saveGameProgress, which the server
 * validates (see server/index.js); a client cannot invent a quiz score
 * above the stored question count or a Memory Match win in fewer moves
 * than there are pairs.
 */
type GameKey = 'memory' | 'quiz' | 'catch' | 'guess' | 'chest' | 'hero' | 'board';
const GAMES: { key: GameKey; title: string; line: string; icon: string; bg: string }[] = [
  { key: 'memory', title: 'Memory Match', line: 'Flip pairs of cards — patterns, or your own shared photographs.', icon: '▦', bg: 'bg-butter' },
  { key: 'quiz', title: 'How Well Do You Know Us?', line: 'A quiz you write together, played one question at a time.', icon: '?', bg: 'bg-powder' },
  { key: 'catch', title: 'Catch the Hearts', line: 'Thirty seconds, a field of hearts, tap or tab to catch them.', icon: '♥', bg: 'bg-rose' },
  { key: 'guess', title: 'Guess My Answer', line: 'One partner sets a secret answer; the other gets one guess.', icon: '✉', bg: 'bg-lilac' },
  { key: 'chest', title: 'Unlock the Chest', line: 'Solve the riddles together and open the final message.', icon: '▣', bg: 'bg-sage' },
  { key: 'hero', title: "A Hero's City", line: 'An original rooftop adventure: run, jump, zip, collect tokens and uncover a personal story.', icon: '⬆', bg: 'bg-powder' },
  { key: 'board', title: 'Our Little World', line: 'A two-player property-trading board game about your places, memories and future plans. Local play on one device.', icon: '▦', bg: 'bg-butter' },
];

export function ArcadeRoom({ store, refresh, notify }: Props) {
  void refresh; // the arcade reloads its own game data; room refresh is for room data
  const [game, setGame] = useState<GameKey | null>(null);
  const [data, setData] = useState<GameData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = async () => {
    try {
      const d = await loadGameData(store);
      d.rounds = visibleRounds(d.rounds, store.viewerId);
      setData(d);
    } catch (e) { setLoadError(e instanceof Error ? e.message : 'Could not load the arcade.'); }
  };
  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const progressFor = (key: string) => (data?.progress ?? []).filter((p) => p.gameKey === key);

  return (
    <Page title="Game Arcade" subtitle="A small, hidden collection of games inside your shared home. No sound, no timers that nag, no scores that shame — play one, then go back to the rooms.">
      {!game && (
        <>
          {loadError && <p className="mb-4 text-sm text-cocoa-soft">{loadError} Games still play in this browser, but progress may not save until the connection is back.</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            {GAMES.map((g) => {
              const prog = progressFor(g.key);
              const last = prog[0];
              return (
                <Card key={g.key} className={g.bg}>
                  <p className="text-3xl" aria-hidden="true">{g.icon}</p>
                  <h2 className="font-serif-display mt-2 text-2xl">{g.title}</h2>
                  <p className="mt-1 text-sm leading-relaxed text-cocoa-soft">{g.line}</p>
                  <p className="mt-2 text-xs text-cocoa-soft">{last ? `Last played by ${last.userName}: ${last.score} point${last.score === 1 ? '' : 's'}${last.moves ? ` · ${last.moves} moves` : ''}` : 'Not played yet — be the first.'}</p>
                  <div className="mt-3"><Button onClick={() => setGame(g.key)}>Play {g.title}</Button></div>
                </Card>
              );
            })}
          </div>
          <p className="mt-4 text-xs text-cocoa-soft">Adding a game later means adding one entry to the arcade registry and one component — the config, progress and rounds tables already exist for it.</p>
        </>
      )}
      {game && data && (
        <>
          <div className="mb-4"><Button variant="quiet" onClick={() => setGame(null)}>← Back to the arcade</Button></div>
          {game === 'memory' && <MemoryGame store={store} refresh={refresh} data={data} reload={reload} notify={notify} />}
          {game === 'quiz' && <QuizGame store={store} refresh={refresh} data={data} reload={reload} notify={notify} />}
          {game === 'catch' && <CatchGame store={store} refresh={refresh} reload={reload} notify={notify} />}
          {game === 'guess' && <GuessGame store={store} refresh={refresh} data={data} reload={reload} notify={notify} />}
          {game === 'chest' && <ChestGame store={store} refresh={refresh} data={data} reload={reload} notify={notify} />}
          {game === 'hero' && <HeroAdventure store={store} data={data} reload={reload} notify={notify} onBackToArcade={() => setGame(null)} />}
          {game === 'board' && <BoardGame store={store} data={data} reload={reload} notify={notify} onBackToArcade={() => setGame(null)} />}
        </>
      )}
      {game && !data && !loadError && <p className="text-sm text-cocoa-soft">Loading the arcade…</p>}
    </Page>
  );
}

// ---------- shared helpers ----------

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ---------- 1. Memory Match ----------

const PATTERNS = ['★', '●', '◆', '♥', '☾', '✿', '♫', '♦', '▲', '⬢'];

type DeckCard = { id: number; value: string; photoUrl: string | null; photoTitle: string | null; flipped: boolean; matched: boolean };

function MemoryGame({ store, data, reload, notify }: GameProps) {
  const config: MemoryConfig = data.configs.memory ?? DEFAULT_CONFIGS.memory;
  const [gameId, setGameId] = useState(0);
  const [pairs, setPairs] = useState(config.pairs);
  const [source, setSource] = useState<'patterns' | 'memories'>(config.source);
  const photos = useMemo(() => store.shared(store.data.memories).filter((m) => m.mediaUrl), [store.version]);
  const deckSource = source === 'memories' && photos.length >= pairs ? 'memories' : 'patterns';
  const deck = useMemo<DeckCard[]>(() => {
    const values = deckSource === 'memories'
      ? photos.slice(0, pairs).map((m) => ({ value: m.title, photoUrl: m.mediaUrl, photoTitle: m.title }))
      : PATTERNS.slice(0, pairs).map((v) => ({ value: v, photoUrl: null, photoTitle: null }));
    const doubled = shuffle([...values, ...values]);
    return doubled.map((v, i) => ({ id: i, ...v, flipped: false, matched: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, pairs, deckSource]);
  const [cards, setCards] = useState<DeckCard[]>(deck);
  const [moves, setMoves] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [completed, setCompleted] = useState(false);
  const savedRef = useRef(false);
  const matched = cards.filter((c) => c.matched).length / 2;

  useEffect(() => { setCards(deck); setMoves(0); setStartedAt(null); setElapsed(0); setCompleted(false); savedRef.current = false; }, [deck]);
  useEffect(() => {
    if (!startedAt || completed) return;
    const t = setInterval(() => setElapsed(Date.now() - startedAt), 500);
    return () => clearInterval(t);
  }, [startedAt, completed]);

  const flip = (id: number) => {
    if (completed) return;
    const card = cards.find((c) => c.id === id);
    if (!card || card.flipped || card.matched) return;
    const flipped = cards.filter((c) => c.flipped && !c.matched);
    if (flipped.length >= 2) return;
    if (!startedAt) setStartedAt(Date.now());
    const next = cards.map((c) => (c.id === id ? { ...c, flipped: true } : c));
    setCards(next);
    const nowFlipped = next.filter((c) => c.flipped && !c.matched);
    if (nowFlipped.length === 2) {
      setMoves((m) => m + 1);
      const [a, b] = nowFlipped;
      if (a.value === b.value) {
        const matchedCards = next.map((c) => (c.id === a.id || c.id === b.id ? { ...c, matched: true } : c));
        setCards(matchedCards);
        if (matchedCards.every((c) => c.matched)) {
          const finalElapsed = startedAt ? Date.now() - startedAt : 0;
          setElapsed(finalElapsed); setCompleted(true);
        }
      } else {
        setTimeout(() => setCards((cur) => cur.map((c) => (c.id === a.id || c.id === b.id ? { ...c, flipped: false } : c))), 700);
      }
    }
  };

  useEffect(() => {
    if (!completed || savedRef.current) return;
    savedRef.current = true;
    saveGameProgress(store, { gameKey: 'memory', score: pairs, moves, timeMs: elapsed, details: { pairs, source: deckSource } })
      .then(() => { reload(); notify(`Memory Match complete — ${pairs} pairs in ${moves} moves, ${formatTime(elapsed)}.`); })
      .catch((e) => notify(e instanceof Error ? e.message : 'Could not save that result.', 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completed]);

  const saveConfig = async () => {
    try { await saveGameConfig(store, 'memory', { pairs, source }); await reload(); notify('Memory Match settings saved.'); }
    catch (e) { notify(e instanceof Error ? e.message : 'Could not save settings.', 'error'); }
  };

  return (
    <div>
      <Card>
        <h2 className="font-serif-display text-2xl">Memory Match</h2>
        <p className="mt-1 text-sm text-cocoa-soft">Flip two cards. Find the pair. Cards are buttons, so Tab + Enter works, and touch works the same as a click. Restart any time.</p>
        <p className="mt-2 text-sm" aria-live="polite">Pairs found: {matched} / {pairs} · Moves: {moves} · Time: {formatTime(elapsed)}</p>
        {deckSource === 'patterns' && source === 'memories' && <p className="mt-1 text-xs text-cocoa-soft">Not enough shared photographs yet (need {pairs}) — using pattern cards for now. Add photos on the Memory Wall, then switch back.</p>}
        {completed && <p className="font-serif-display mt-3 text-xl">All pairs found! Lovely work — {moves} moves in {formatTime(elapsed)}.</p>}
        <div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-6">
          {cards.map((c) => (
            <button key={c.id} type="button" onClick={() => flip(c.id)} disabled={c.matched}
              aria-label={c.flipped || c.matched ? `Card: ${c.photoTitle ?? c.value}` : 'Face-down card'}
              className={`flex aspect-square items-center justify-center rounded-2xl border p-1 text-2xl transition-transform ${c.flipped || c.matched ? 'border-cocoa/30 bg-paper' : 'border-cocoa/25 bg-butter hover:bg-cream-deep'}`}>
              {(c.flipped || c.matched) ? (c.photoUrl ? <img src={c.photoUrl} alt={c.photoTitle ?? ''} className="h-full w-full rounded-xl object-contain" /> : <span aria-hidden="true">{c.value}</span>) : <span aria-hidden="true">?</span>}
            </button>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => setGameId((g) => g + 1)}>Restart</Button>
          <Button variant="quiet" onClick={() => { setGameId((g) => g + 1); }}>Play again</Button>
        </div>
      </Card>
      <Card className="mt-4">
        <h3 className="font-serif-display text-xl">Make it yours</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Pairs"><select value={pairs} onChange={(e) => setPairs(Number(e.target.value))} className={inputCls}><option value={4}>4 pairs</option><option value={6}>6 pairs</option><option value={8}>8 pairs</option></select></Field>
          <Field label="Cards from"><select value={source} onChange={(e) => setSource(e.target.value as typeof source)} className={inputCls}><option value="patterns">Pattern cards</option><option value="memories">Shared photographs</option></select></Field>
        </div>
        <div className="mt-3"><Button variant="quiet" onClick={saveConfig}>Save settings</Button></div>
      </Card>
    </div>
  );
}

// ---------- 2. How Well Do You Know Us? ----------

function QuizGame({ store, data, reload, notify }: GameProps) {
  const config: QuizConfig = data.configs.quiz ?? DEFAULT_CONFIGS.quiz;
  const [editing, setEditing] = useState(false);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [answered, setAnswered] = useState(false);
  const [score, setScore] = useState(0);
  const [finished, setFinished] = useState(false);
  const savedRef = useRef(false);
  const [editForm, setEditForm] = useState<{ id: string | null; question: string; options: string[]; correctIndex: number }>({ id: null, question: '', options: ['', '', '', ''], correctIndex: 0 });

  const questions = config.questions ?? [];
  const current = questions[index];

  const answer = (i: number) => {
    if (answered || !current) return;
    setSelected(i); setAnswered(true);
    if (i === current.correctIndex) setScore((s) => s + 1);
  };
  const next = () => {
    if (index + 1 >= questions.length) setFinished(true);
    else { setIndex(index + 1); setSelected(null); setAnswered(false); }
  };
  useEffect(() => {
    if (!finished || savedRef.current || questions.length === 0) return;
    savedRef.current = true;
    saveGameProgress(store, { gameKey: 'quiz', score, details: { total: questions.length } })
      .then(() => { reload(); notify(`Quiz complete — ${score} out of ${questions.length}.`); })
      .catch((e) => notify(e instanceof Error ? e.message : 'Could not save that result.', 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  const saveQuestions = async (qs: QuizQuestion[]) => {
    try { await saveGameConfig(store, 'quiz', { questions: qs }); await reload(); setEditing(false); notify('Quiz questions saved.'); }
    catch (e) { notify(e instanceof Error ? e.message : 'Could not save questions.', 'error'); }
  };
  const saveEditForm = () => {
    const options = editForm.options.map((o) => o.trim()).filter(Boolean);
    if (!editForm.question.trim()) return notify('A question is needed.', 'error');
    if (options.length < 2) return notify('At least two options are needed.', 'error');
    if (editForm.correctIndex >= options.length) return notify('The correct answer must be one of the options.', 'error');
    const q: QuizQuestion = { id: editForm.id ?? `q-${Date.now()}`, question: editForm.question.trim(), options, correctIndex: editForm.correctIndex };
    const qs = editForm.id ? questions.map((x) => (x.id === editForm.id ? q : x)) : [...questions, q];
    saveQuestions(qs);
    setEditForm({ id: null, question: '', options: ['', '', '', ''], correctIndex: 0 });
  };

  if (questions.length === 0) {
    return (
      <Card>
        <h2 className="font-serif-display text-2xl">How Well Do You Know Us?</h2>
        <Empty title="No questions yet" body="Add the first question below — the quiz is yours to write, so make it about the two of you." />
        <div className="mt-4"><Button onClick={() => setEditing(true)}>Add a question</Button></div>
        {editing && <QuizEditForm editForm={editForm} setEditForm={setEditForm} onSave={saveEditForm} onCancel={() => setEditing(false)} />}
      </Card>
    );
  }

  return (
    <div>
      <Card>
        <h2 className="font-serif-display text-2xl">How Well Do You Know Us?</h2>
        {finished ? (
          <div className="py-4 text-center">
            <p className="font-serif-display text-3xl">You scored {score} out of {questions.length}.</p>
            <p className="mt-2 text-sm text-cocoa-soft">Every answer — right or not — is just a thing you now know about each other. That is the whole game.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button onClick={() => { setIndex(0); setSelected(null); setAnswered(false); setScore(0); setFinished(false); savedRef.current = false; }}>Play again</Button>
              <Button variant="quiet" onClick={() => setEditing(true)}>Edit questions</Button>
            </div>
          </div>
        ) : (
          <>
            <p className="mt-1 text-sm text-cocoa-soft">Question {index + 1} of {questions.length} · Score so far: {score}</p>
            <p className="font-serif-display mt-3 text-xl leading-relaxed">{current.question}</p>
            <div className="mt-4 space-y-2">
              {current.options.map((opt, i) => {
                const isCorrect = answered && i === current.correctIndex;
                const isWrongPick = answered && selected === i && i !== current.correctIndex;
                return (
                  <button key={i} type="button" onClick={() => answer(i)} disabled={answered}
                    className={`min-h-11 w-full rounded-2xl border px-4 py-2 text-left text-sm ${isCorrect ? 'border-cocoa/40 bg-sage' : isWrongPick ? 'border-cocoa/30 bg-rose' : 'border-cocoa/25 bg-paper hover:bg-cream-deep'}`}>
                    {opt}{isCorrect && answered ? ' ✓' : ''}
                  </button>
                );
              })}
            </div>
            {answered && (
              <div className="mt-4">
                <p className="text-sm leading-relaxed text-cocoa-soft">{selected === current.correctIndex ? 'That is right — nice one.' : `Not quite — the answer was “${current.options[current.correctIndex]}”. No worries at all; that is a fun one to learn.`}</p>
                <div className="mt-3"><Button onClick={next}>{index + 1 >= questions.length ? 'See my score' : 'Next question'}</Button></div>
              </div>
            )}
          </>
        )}
      </Card>
      <Card className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-serif-display text-xl">Your questions ({questions.length})</h3>
          <Button variant="quiet" onClick={() => setEditing(!editing)}>{editing ? 'Hide editor' : 'Add / edit questions'}</Button>
        </div>
        {editing && (
          <div className="mt-4">
            <p className="mb-3 text-sm leading-relaxed text-cocoa-soft">These are starter questions — replace them with your own memories, inside jokes, and answers. Nothing here is your real history until you write it.</p>
            <ul className="space-y-2">
              {questions.map((q) => (
                <li key={q.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-cocoa/15 p-3">
                  <span className="text-sm">{q.question}</span>
                  <span className="flex gap-2">
                    <Button variant="quiet" onClick={() => setEditForm({ id: q.id, question: q.question, options: [...q.options, '', '', '', ''].slice(0, 4), correctIndex: q.correctIndex })}>Edit</Button>
                    <ConfirmDelete label="Remove" note="Remove this question for good? This cannot be undone." confirmLabel="Yes, remove" onConfirm={async () => saveQuestions(questions.filter((x) => x.id !== q.id))} />
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-4"><QuizEditForm editForm={editForm} setEditForm={setEditForm} onSave={saveEditForm} onCancel={() => setEditForm({ id: null, question: '', options: ['', '', '', ''], correctIndex: 0 })} /></div>
          </div>
        )}
      </Card>
    </div>
  );
}

function QuizEditForm({ editForm, setEditForm, onSave, onCancel }: {
  editForm: { id: string | null; question: string; options: string[]; correctIndex: number };
  setEditForm: (f: { id: string | null; question: string; options: string[]; correctIndex: number }) => void;
  onSave: () => void; onCancel: () => void;
}) {
  return (
    <div className="space-y-3 rounded-2xl border border-cocoa/15 p-3">
      <Field label="Question"><input value={editForm.question} onChange={(e) => setEditForm({ ...editForm, question: e.target.value })} className={inputCls} maxLength={500} /></Field>
      {editForm.options.map((opt, i) => (
        <Field key={i} label={`Option ${i + 1}${i < 2 ? ' (required)' : ' (optional)'}`}><input value={opt} onChange={(e) => { const o = [...editForm.options]; o[i] = e.target.value; setEditForm({ ...editForm, options: o }); }} className={inputCls} maxLength={200} /></Field>
      ))}
      <Field label="Correct option"><select value={editForm.correctIndex} onChange={(e) => setEditForm({ ...editForm, correctIndex: Number(e.target.value) })} className={inputCls}>{editForm.options.map((_, i) => <option key={i} value={i}>Option {i + 1}</option>)}</select></Field>
      <div className="flex gap-2"><Button onClick={onSave}>{editForm.id ? 'Save question' : 'Add question'}</Button><Button variant="quiet" onClick={onCancel}>Cancel</Button></div>
    </div>
  );
}

// ---------- 3. Catch the Hearts ----------

function CatchGame({ store, reload, notify }: Omit<GameProps, 'data'>) {
  const [phase, setPhase] = useState<'idle' | 'playing' | 'paused' | 'done'>('idle');
  const [timeLeft, setTimeLeft] = useState(30);
  const [score, setScore] = useState(0);
  const [hearts, setHearts] = useState<{ id: number; x: number; y: number }[]>([]);
  const idRef = useRef(0);
  const savedRef = useRef(false);
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    if (phase !== 'playing') return;
    const t = setInterval(() => setTimeLeft((s) => {
      if (s <= 1) { setPhase('done'); return 0; }
      return s - 1;
    }), 1000);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'playing') return;
    const spawn = setInterval(() => {
      const id = ++idRef.current;
      const heart = { id, x: 5 + Math.random() * 80, y: 5 + Math.random() * 65 };
      setHearts((h) => [...h.slice(-11), heart]);
      setTimeout(() => setHearts((h) => h.filter((x) => x.id !== id)), 1600);
    }, 800);
    return () => clearInterval(spawn);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'done' || savedRef.current) return;
    savedRef.current = true;
    saveGameProgress(store, { gameKey: 'catch', score, timeMs: 30000, details: { durationSeconds: 30 } })
      .then(() => { reload(); notify(`Catch the Hearts — you caught ${score} hearts in 30 seconds.`); })
      .catch((e) => notify(e instanceof Error ? e.message : 'Could not save that result.', 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const start = () => { setScore(0); setTimeLeft(30); setHearts([]); savedRef.current = false; setPhase('playing'); };
  const pause = () => { setPhase('paused'); setHearts([]); };
  const resume = () => setPhase('playing');

  return (
    <Card>
      <h2 className="font-serif-display text-2xl">Catch the Hearts</h2>
      <p className="mt-1 text-sm text-cocoa-soft">Hearts pop up in the field for a moment each. Tap one, or Tab to it and press Enter. Thirty seconds, then the field rests. Hearts sit still while they are up, so they are easy to tap.</p>
      <p className="mt-2 text-sm" aria-live="polite">Score: {score} · Time left: {timeLeft}s · {phase === 'playing' ? 'Playing' : phase === 'paused' ? 'Paused' : phase === 'done' ? 'Finished' : 'Ready'}</p>
      {phase === 'idle' && <div className="mt-4"><Button onClick={start}>Start — 30 seconds</Button></div>}
      {phase === 'done' && (
        <div className="mt-4">
          <p className="font-serif-display text-xl">Time! You caught {score} heart{score === 1 ? '' : 's'}.</p>
          <div className="mt-3 flex gap-2"><Button onClick={start}>Play again</Button></div>
        </div>
      )}
      {(phase === 'playing' || phase === 'paused') && (
        <>
          <div className="relative mt-4 h-72 overflow-hidden rounded-3xl border border-cocoa/20 bg-powder" role="region" aria-label="Heart field">
            {phase === 'playing' && hearts.map((h) => (
              <button key={h.id} type="button" onClick={() => { setScore((s) => s + 1); setHearts((cur) => cur.filter((x) => x.id !== h.id)); }}
                aria-label="Catch this heart"
                style={{ left: `${h.x}%`, top: `${h.y}%` }}
                className="absolute -translate-x-1/2 -translate-y-1/2 text-4xl text-[#b85a5a]">♥</button>
            ))}
            {phase === 'paused' && <p className="absolute inset-0 flex items-center justify-center text-sm text-cocoa-soft">Paused — hearts are resting.</p>}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {phase === 'playing' && <Button variant="quiet" onClick={pause}>Pause</Button>}
            {phase === 'paused' && <Button onClick={resume}>Resume</Button>}
            <Button variant="quiet" onClick={start}>Restart</Button>
          </div>
        </>
      )}
    </Card>
  );
}

// ---------- 4. Guess My Answer ----------

function GuessGame({ store, data, reload, notify }: GameProps) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [guesses, setGuesses] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const rounds = data.rounds;

  const create = async () => {
    if (!question.trim()) return notify('A question is needed.', 'error');
    if (!answer.trim()) return notify('A private answer is needed — that is the whole game.', 'error');
    try {
      // The answer is sent to the server, but the server (or the masked view)
      // never returns it to the other partner until the round is revealed.
      await createGuessRound(store, question, answer);
      setQuestion(''); setAnswer(''); await reload(); notify('Your secret question is set. Your partner gets one guess.');
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not set that question.', 'error'); }
  };

  const submit = async (roundId: string) => {
    const guess = (guesses[roundId] || '').trim();
    if (!guess) return notify('Please enter a guess.', 'error');
    setBusy(roundId);
    try {
      const res = await submitGuess(store, roundId, guess);
      await reload();
      notify(res.correct ? `Exactly right! The answer was “${res.answer}”.` : `Not quite — the answer was “${res.answer}”. No worries, that is a good one to know.`);
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not submit that guess.', 'error'); }
    setBusy(null);
  };

  return (
    <div>
      <Card>
        <h2 className="font-serif-display text-2xl">Guess My Answer</h2>
        <p className="mt-1 text-sm text-cocoa-soft">One partner writes a question and a private answer. The other gets exactly one guess — then the answer is revealed, right or not. No second guesses, no peeking: the answer stays hidden until the reveal.</p>
        <div className="mt-4 space-y-3">
          <Field label="Your question"><input value={question} onChange={(e) => setQuestion(e.target.value)} className={inputCls} maxLength={500} placeholder="e.g. What was the first song we danced to?" /></Field>
          <Field label="Your private answer" hint="Only you see this until your partner guesses."><input value={answer} onChange={(e) => setAnswer(e.target.value)} className={inputCls} maxLength={500} /></Field>
          <Button onClick={create}>Set this question privately</Button>
        </div>
      </Card>
      <div className="mt-4 space-y-3">
        {rounds.length === 0 && <Card><Empty title="No secret questions yet" body="Set the first one above. Your partner will see the question, not the answer, and gets one guess." /></Card>}
        {rounds.map((r) => {
          const mine = r.creatorId === store.viewerId;
          return (
            <Card key={r.id}>
              <p className="text-xs text-cocoa-soft">{r.creatorName} asked · {formatDate(r.createdAt)}</p>
              <p className="font-serif-display mt-1 text-xl leading-relaxed">{r.question}</p>
              {r.revealed ? (
                <div className="mt-2 text-sm leading-relaxed">
                  <p>Guess: “{r.guess}” — {r.correct ? 'Exactly right!' : 'Not quite, and that is fine.'}</p>
                  <p className="mt-1">Answer: “{r.answer}”</p>
                </div>
              ) : mine ? (
                <div className="mt-2 text-sm text-cocoa-soft">
                  <p>Waiting for your partner to guess. Your private answer is kept for you: “{r.answer}”.</p>
                </div>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  <input value={guesses[r.id] || ''} onChange={(e) => setGuesses({ ...guesses, [r.id]: e.target.value })} className={`${inputCls} min-w-52 flex-1`} maxLength={500} placeholder="Your one guess…" aria-label={`Your guess for: ${r.question}`} />
                  <Button onClick={() => submit(r.id)} disabled={busy === r.id}>{busy === r.id ? 'Revealing…' : 'Submit my one guess'}</Button>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ---------- 5. Unlock the Chest ----------

function ChestGame({ store, data, reload, notify }: GameProps) {
  const config: ChestConfig = data.configs.chest ?? DEFAULT_CONFIGS.chest;
  const [editing, setEditing] = useState(false);
  const [index, setIndex] = useState(0);
  const [answerInput, setAnswerInput] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [showFinal, setShowFinal] = useState(false);
  const savedRef = useRef(false);
  const [editForm, setEditForm] = useState<{ id: string | null; question: string; answer: string; hint: string }>({ id: null, question: '', answer: '', hint: '' });
  const [finalMessage, setFinalMessage] = useState(config.finalMessage);
  const [finalMemoryId, setFinalMemoryId] = useState<string | null>(config.finalMemoryId);

  const riddles = config.riddles ?? [];
  const current = riddles[index];
  const finalMemory = finalMemoryId ? store.data.memories.find((m) => m.id === finalMemoryId) : null;
  const sharedMemories = store.shared(store.data.memories);

  useEffect(() => {
    if (!unlocked || savedRef.current) return;
    savedRef.current = true;
    saveGameProgress(store, { gameKey: 'chest', score: riddles.length, details: { riddles: riddles.length } })
      .then(() => { reload(); notify('The chest is open!'); })
      .catch((e) => notify(e instanceof Error ? e.message : 'Could not save that result.', 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked]);

  const tryAnswer = () => {
    if (!current) return;
    if (normaliseAnswer(answerInput) === normaliseAnswer(current.answer)) {
      if (index + 1 >= riddles.length) setUnlocked(true);
      else { setIndex(index + 1); setAnswerInput(''); setFeedback('That is right — on to the next clue.'); }
    } else {
      setFeedback('Not quite — try another guess. No penalty, no rush.');
    }
  };

  const saveChest = async (cfg: ChestConfig) => {
    try { await saveGameConfig(store, 'chest', cfg); await reload(); setEditing(false); notify('Chest saved.'); }
    catch (e) { notify(e instanceof Error ? e.message : 'Could not save the chest.', 'error'); }
  };
  const saveRiddle = () => {
    if (!editForm.question.trim() || !editForm.answer.trim()) return notify('A riddle and its answer are needed.', 'error');
    const r = { id: editForm.id ?? `r-${Date.now()}`, question: editForm.question.trim(), answer: editForm.answer.trim(), hint: editForm.hint.trim() || undefined };
    const rs = editForm.id ? riddles.map((x) => (x.id === editForm.id ? r : x)) : [...riddles, r];
    saveChest({ riddles: rs, finalMessage, finalMemoryId });
    setEditForm({ id: null, question: '', answer: '', hint: '' });
  };

  return (
    <div>
      <Card>
        <h2 className="font-serif-display text-2xl">Unlock the Chest</h2>
        {unlocked ? (
          <div className="py-4 text-center">
            <p className="text-5xl" aria-hidden="true">▣</p>
            <p className="font-serif-display mt-3 text-2xl">The chest opens.</p>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-cocoa-soft">{config.finalMessage}</p>
            {finalMemory && (
              <figure className="mx-auto mt-4 max-w-sm">
                {finalMemory.mediaUrl && <img src={finalMemory.mediaUrl} alt={finalMemory.title} className="mx-auto max-h-72 rounded-2xl object-contain" />}
                <figcaption className="mt-2 text-sm text-cocoa-soft">{finalMemory.title}{finalMemory.caption ? ` — ${finalMemory.caption}` : ''}</figcaption>
              </figure>
            )}
            <div className="mt-4"><Button onClick={() => { setIndex(0); setAnswerInput(''); setFeedback(null); setUnlocked(false); savedRef.current = false; }}>Lock it again and replay</Button></div>
          </div>
        ) : riddles.length === 0 ? (
          <Empty title="No riddles yet" body="Add the first riddle below, then set the final message the chest will hold. Until then, the chest stays closed — and that is the point." />
        ) : (
          <>
            <p className="mt-1 text-sm text-cocoa-soft">Riddle {index + 1} of {riddles.length} · Solve them in order to open the chest.</p>
            <p className="font-serif-display mt-3 text-xl leading-relaxed">{current.question}</p>
            {current.hint && <p className="mt-1 text-sm text-cocoa-soft">Hint: {current.hint}</p>}
            <div className="mt-4 flex flex-wrap gap-2">
              <input value={answerInput} onChange={(e) => setAnswerInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') tryAnswer(); }} className={`${inputCls} min-w-52 flex-1`} maxLength={500} placeholder="Your answer…" aria-label="Your answer to the riddle" />
              <Button onClick={tryAnswer}>Try this answer</Button>
            </div>
            {feedback && <p className="mt-3 text-sm text-cocoa-soft" role="status">{feedback}</p>}
            <div className="mt-3 flex flex-wrap gap-2"><Button variant="quiet" onClick={() => { setIndex(0); setAnswerInput(''); setFeedback(null); }}>Start over</Button><Button variant="quiet" onClick={() => setShowFinal(!showFinal)}>{showFinal ? 'Hide the final message' : 'Read the final message now'}</Button></div>
            {showFinal && (
              <div className="mt-4 rounded-2xl border border-cocoa/20 bg-paper p-4">
                <p className="text-xs text-cocoa-soft">The final message — yours to read any time, no riddles needed.</p>
                <p className="font-serif-display mt-2 text-xl leading-relaxed">{config.finalMessage}</p>
                {finalMemory && (
                  <figure className="mx-auto mt-4 max-w-sm">
                    {finalMemory.mediaUrl && <img src={finalMemory.mediaUrl} alt={finalMemory.title} className="mx-auto max-h-72 rounded-2xl object-contain" />}
                    <figcaption className="mt-2 text-sm text-cocoa-soft">{finalMemory.title}{finalMemory.caption ? ` — ${finalMemory.caption}` : ''}</figcaption>
                  </figure>
                )}
              </div>
            )}
          </>
        )}
      </Card>
      <Card className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-serif-display text-xl">Make it yours</h3>
          <Button variant="quiet" onClick={() => setEditing(!editing)}>{editing ? 'Hide editor' : 'Edit riddles and reward'}</Button>
        </div>
        {editing && (
          <div className="mt-4 space-y-3">
            <p className="text-sm leading-relaxed text-cocoa-soft">These are starter riddles — replace them with your own clues, inside jokes, and reward message. Nothing here is your real history until you write it.</p>
            <ul className="space-y-2">
              {riddles.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-cocoa/15 p-3">
                  <span className="text-sm">{r.question} <span className="text-cocoa-soft">(answer: {r.answer})</span></span>
                  <span className="flex gap-2">
                    <Button variant="quiet" onClick={() => setEditForm({ id: r.id, question: r.question, answer: r.answer, hint: r.hint ?? '' })}>Edit</Button>
                    <ConfirmDelete label="Remove" note="Remove this riddle for good? This cannot be undone." confirmLabel="Yes, remove" onConfirm={async () => saveChest({ riddles: riddles.filter((x) => x.id !== r.id), finalMessage, finalMemoryId })} />
                  </span>
                </li>
              ))}
            </ul>
            <div className="space-y-3 rounded-2xl border border-cocoa/15 p-3">
              <Field label="Riddle"><input value={editForm.question} onChange={(e) => setEditForm({ ...editForm, question: e.target.value })} className={inputCls} maxLength={500} /></Field>
              <Field label="Answer"><input value={editForm.answer} onChange={(e) => setEditForm({ ...editForm, answer: e.target.value })} className={inputCls} maxLength={500} /></Field>
              <Field label="Hint (optional)"><input value={editForm.hint} onChange={(e) => setEditForm({ ...editForm, hint: e.target.value })} className={inputCls} maxLength={300} /></Field>
              <div className="flex gap-2"><Button onClick={saveRiddle}>{editForm.id ? 'Save riddle' : 'Add riddle'}</Button><Button variant="quiet" onClick={() => setEditForm({ id: null, question: '', answer: '', hint: '' })}>Clear</Button></div>
            </div>
            <Field label="Final message inside the chest"><textarea value={finalMessage} onChange={(e) => setFinalMessage(e.target.value)} className={inputCls} rows={3} maxLength={2000} /></Field>
            <Field label="Final photograph or memory (optional)"><select value={finalMemoryId ?? ''} onChange={(e) => setFinalMemoryId(e.target.value || null)} className={inputCls}><option value="">Just the message</option>{sharedMemories.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}</select></Field>
            <Button onClick={() => saveChest({ riddles, finalMessage, finalMemoryId })}>Save final message and memory</Button>
          </div>
        )}
      </Card>
    </div>
  );
}
