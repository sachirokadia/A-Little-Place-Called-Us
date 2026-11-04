import { useEffect, useMemo, useRef, useState } from 'react';
import type { PlaceStore } from '../lib/store';
import type { ChestConfig, GameData, MemoryConfig, QuizConfig, QuizQuestion } from '../lib/games';
import { DEFAULT_CONFIGS, createGuessRound, loadGameData, normaliseAnswer, saveGameConfig, saveGameProgress, submitGuess, visibleRounds } from '../lib/games';
import type { DetectiveCase, DetectiveConfig, DetectiveProgress } from '../lib/detective';
import { DEFAULT_DETECTIVE, boardLinkCorrect, boardOptions, caseComplete, caseProgressLabel, emptyProgress, loadDetectiveProgress, riddleCorrect, saveDetectiveProgress, validateDetectiveCase } from '../lib/detective';
import { catchDifficultyLabel, catchSpawnIntervalMs, memoryDifficultyLabel } from '../lib/arcadeRules';
import { Page, Card, Button, Field, inputCls, ConfirmDelete } from '../components/ui';
import { RoomEmpty } from '../components/design-primitives';
import { formatDate } from '../lib/utils';
import { HeroAdventure } from './HeroAdventure';
import { BoardGame } from './BoardGame';

type Props = { store: PlaceStore; refresh: () => void; notify: (m: string, k?: 'ok' | 'error') => void };
type GameProps = Props & { data: GameData; reload: () => Promise<void> };

/**
 * Phase 5 — the Boyfriend Arcade. Phase 14 adds the Secret Detective
 * Mission (see DetectiveGame below) and extends the arcade-world
 * header with a detective-desk strip; the arcade shell itself is
 * unchanged (it is a Page, not a RoomWorld — Phase 12's RoomWorld
 * shell covers the six other rooms, and the arcade keeps its own
 * arcade-world scene, which Phase 14 extends rather than replaces).
 *
 * No sound is included at all (sound is optional, and off here means
 * absent, not a fake toggle — there is deliberately no sound control
 * to flip, real or otherwise).
 *
 * HONEST VALIDATION STATEMENT (Phase 14, correcting the looser Phase 5
 * comment this replaces): scores are recorded through saveGameProgress,
 * but how much that is checked depends on the backend in use, and
 * none of it is full trusted validation:
 * - API server (server/index.js): validates ranges — non-negative
 *   integers, a quiz score no higher than the stored question count,
 *   a Memory Match win in at least as many moves as there are pairs.
 *   It does NOT verify that the player actually played, so a client
 *   can still submit a plausible-but-unearned score.
 * - Supabase mode: RLS only checks space membership and that the
 *   row's user_id is the caller. There is NO server-side score check,
 *   and board scores are NOT tamper-proof even with local migration
 *   0012 (that migration hardens other tables; it does not validate
 *   game scores). A client-submitted score must never be presented
 *   as server-validated here.
 * - Demo mode: localStorage, fully client-side, no validation at all.
 * Detective answers, quiz answers and chest riddles are all checked
 * client-side with normaliseAnswer; that is stated in the UI where it
 * matters and must never be described as server validation.
 * Progress keying: the API server and Supabase upsert on
 * (space_id, user_id, game_key), and demo mode stores the viewer id
 * on every row, so one partner's progress row cannot overwrite the
 * other's — each partner has their own row per game. Completed
 * results are visible to both (they are celebrations, not secrets);
 * in-progress detective state is per-viewer in this browser only.
 */
type GameKey = 'detective' | 'memory' | 'quiz' | 'catch' | 'guess' | 'chest' | 'hero' | 'board';
const GAMES: { key: GameKey; title: string; line: string; icon: string; bg: string }[] = [
  { key: 'detective', title: 'Secret Detective Mission', line: 'NEW — Open a case file, collect clues, solve riddles and connect the board. Two cosy sample cases, plus your own.', icon: '🔍', bg: 'bg-powder' },
  { key: 'memory', title: 'Memory Match', line: 'Flip pairs of cards — patterns, or your own shared photographs.', icon: '▦', bg: 'bg-butter' },
  { key: 'quiz', title: 'How Well Do You Know Us?', line: 'A quiz you write together, played one question at a time.', icon: '?', bg: 'bg-powder' },
  { key: 'catch', title: 'Catch the Hearts', line: 'Thirty seconds, a field of hearts, tap or tab to catch them.', icon: '♥', bg: 'bg-rose' },
  { key: 'guess', title: 'Guess My Answer', line: 'One partner sets a secret answer; the other gets one guess.', icon: '✉', bg: 'bg-lilac' },
  { key: 'chest', title: 'Unlock the Chest', line: 'Solve the riddles together and open the final message.', icon: '▣', bg: 'bg-sage' },
  { key: 'hero', title: "A Hero's City", line: 'An original rooftop adventure: run, jump, zip, collect tokens and uncover a personal story.', icon: '⬆', bg: 'bg-powder' },
  { key: 'board', title: 'Our Little World', line: 'A two-player property-trading board game about your places, memories and future plans. Turn-based, with a shared saved game.', icon: '▦', bg: 'bg-butter' },
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
    <Page identity="arcade" title="Game Arcade" intro="Step through the arcade sign — the machines are lit, the cases are open, and play is just for fun." homeLabel="⌂ Back to our cottage" homeAriaLabel="Back to our cottage" subtitle="A small, hidden collection of games inside your shared home. No sound, no timers that nag, no scores that shame — play one, then go back to the rooms.">
      {!game && (
        <>
          {loadError && <p className="mb-4 text-sm text-cocoa-soft">{loadError} Games still play in this browser, but progress may not save until the connection is back.</p>}
          <div className="arcade-world">
          {/* Phase 13 story path, arcade treatment: a small pixel road
              (CSS only, aria-hidden, one thin row above the marquee —
              it is the arcade world's header decoration, like the
              RoomIdentity strip, and it never narrows or displaces a
              game cabinet or game content). */}
          <div aria-hidden="true" data-testid="arcade-pixel-road" className="pixel-road"><span>▓</span><span>░</span><span>▓</span><span>░</span><span>▓</span><span>★</span><span>▓</span><span>░</span><span>▓</span><span>░</span><span>▓</span><span>●</span><span>▓</span><span>░</span><span>▓</span></div>
          <p className="arcade-marquee">Step right up — pick a cabinet and play.</p>
          <div className="detective-desk" role="note" aria-label="Secret Detective Mission">
            <span className="detective-desk-glyph" aria-hidden="true">🔍</span>
            <div>
              <p className="font-serif-display text-xl">The Secret Detective Desk</p>
              <p className="mt-1 text-sm leading-relaxed text-cocoa-soft">Two cosy sample cases are waiting in the case files — a missing teapot, a vanishing key — plus room to write your own. Follow the little brass stars: they are the arcade&apos;s trail markers, and they always lead somewhere kind.</p>
              <div className="mt-2"><Button onClick={() => setGame('detective')}>Open the case files</Button></div>
            </div>
            <svg className="detective-string" aria-hidden="true" viewBox="0 0 120 40" preserveAspectRatio="none"><path d="M5 30 Q 40 5, 65 25 T 115 10" fill="none" stroke="#b85a5a" strokeWidth="2" strokeDasharray="5 4" /><circle cx="5" cy="30" r="4" fill="#b85a5a" /><circle cx="65" cy="25" r="4" fill="#b85a5a" /><circle cx="115" cy="10" r="4" fill="#b85a5a" /></svg>
          </div>
          <p className="text-sm font-bold text-cocoa-soft">Pick a game — each mini-game takes just a few minutes.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {GAMES.map((g) => {
              const prog = progressFor(g.key);
              const last = prog[0];
              return (
                <Card key={g.key} className={`${g.bg} arcade-cabinet`}>
                  <p className="text-3xl" aria-hidden="true">{g.icon}</p>
                  <h2 className="font-serif-display mt-2 text-2xl">{g.title}</h2>
                  <p className="mt-1 text-sm leading-relaxed text-cocoa-soft">{g.line}</p>
                  <p className="mt-2 text-xs text-cocoa-soft">{last ? `Last played by ${last.userName}: ${last.score} point${last.score === 1 ? '' : 's'}${last.moves ? ` · ${last.moves} moves` : ''}` : 'Not played yet — be the first.'}</p>
                  <div className="mt-3"><Button onClick={() => setGame(g.key)}>Play {g.title}</Button></div>
                </Card>
              );
            })}
          </div>
          </div>
          <p className="mt-4 text-xs text-cocoa-soft">Adding a game later means adding one entry to the arcade registry and one component — the config, progress and rounds tables already exist for it.</p>
        </>
      )}
      {game && data && (
        <>
          <div className="mb-4"><Button variant="quiet" onClick={() => setGame(null)}>← Back to the arcade</Button></div>
          {game === 'detective' && <DetectiveGame store={store} refresh={refresh} data={data} reload={reload} notify={notify} />}
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

// ---------- 0. Secret Detective Mission (Phase 14) ----------
// Flow: case list → case file (introduction) → evidence (examine to
// collect clues) → riddles (client-side checked, stated as such) →
// investigation board (connect each clue to its conclusion) →
// completion screen with a personal ending + surprise → replay.
// In-progress state lives in this browser, keyed per viewer (see
// detective.ts), so reloading resumes a half-solved case on the same
// device and one partner can never overwrite the other's. Completed
// cases are recorded through saveGameProgress like every other game.
// The mission never reads memories, letters, journals or plans, so
// no private content can appear here; custom cases are shared config
// by design and the editor says so in plain words.

type DetectiveStep = 'file' | 'evidence' | 'riddles' | 'board';

function blankCaseForm(): DetectiveCase {
  return {
    id: `case-${Date.now()}`, title: '', intro: '', hint: '',
    evidence: [{ id: 'e1', title: '', detail: '', clue: '' }],
    riddles: [{ id: 'r1', question: '', answer: '', hint: '' }],
    links: [{ clue: '', conclusion: '' }],
    distractors: [''], ending: '', surprise: '', sample: false,
  };
}

function DetectiveGame({ store, data, reload, notify }: GameProps) {
  const config: DetectiveConfig = data.configs.detective ?? DEFAULT_DETECTIVE;
  const cases = config.cases.length > 0 ? config.cases : DEFAULT_DETECTIVE.cases;
  const [caseId, setCaseId] = useState<string | null>(null);
  const [step, setStep] = useState<DetectiveStep>('file');
  const [progressMap, setProgressMap] = useState<Record<string, DetectiveProgress>>(() =>
    loadDetectiveProgress(store.data.space.id, store.viewerId));
  const [riddleInputs, setRiddleInputs] = useState<Record<string, string>>({});
  const [riddleFeedback, setRiddleFeedback] = useState<Record<string, string>>({});
  const [showHint, setShowHint] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<DetectiveCase>(blankCaseForm);
  const [restoring, setRestoring] = useState(false);
  const savedRef = useRef<Set<string>>(new Set());

  const active = cases.find((c) => c.id === caseId) ?? null;
  const progress: DetectiveProgress = active ? (progressMap[active.id] ?? emptyProgress()) : emptyProgress();

  const persist = (next: Record<string, DetectiveProgress>) => {
    setProgressMap(next);
    saveDetectiveProgress(store.data.space.id, store.viewerId, next);
  };
  const updateProgress = (id: string, patch: Partial<DetectiveProgress>) => {
    const cur = progressMap[id] ?? emptyProgress();
    persist({ ...progressMap, [id]: { ...cur, ...patch } });
  };

  const openCase = (id: string) => { setCaseId(id); setStep('file'); setShowHint(false); };
  const closeCase = () => { setCaseId(null); setStep('file'); };

  const examine = (evidenceId: string) => {
    if (!active || progress.collected.includes(evidenceId)) return;
    updateProgress(active.id, { collected: [...progress.collected, evidenceId] });
  };
  const tryRiddle = (riddleId: string, answer: string) => {
    if (!active) return;
    const r = active.riddles.find((x) => x.id === riddleId);
    if (!r) return;
    if (riddleCorrect(r, riddleInputs[riddleId] ?? '')) {
      if (!progress.solvedRiddles.includes(riddleId)) updateProgress(active.id, { solvedRiddles: [...progress.solvedRiddles, riddleId] });
      setRiddleFeedback({ ...riddleFeedback, [riddleId]: 'That is right — the clue fits.' });
    } else {
      setRiddleFeedback({ ...riddleFeedback, [riddleId]: 'Not quite — try another guess. No penalty, no rush.' });
    }
    void answer;
  };
  const setBoardAnswer = (index: number, conclusion: string) => {
    if (!active) return;
    updateProgress(active.id, { boardAnswers: { ...progress.boardAnswers, [index]: conclusion } });
  };

  const solved = active ? caseComplete(active, progress) : false;
  useEffect(() => {
    if (!active || !solved || progress.completed || savedRef.current.has(active.id)) return;
    savedRef.current.add(active.id);
    updateProgress(active.id, { completed: true });
    saveGameProgress(store, { gameKey: 'detective', score: active.evidence.length + active.riddles.length + active.links.length, details: { caseId: active.id, caseTitle: active.title } })
      .then(() => { reload(); notify(`Case closed: ${active.title}`); })
      .catch((e) => notify(e instanceof Error ? e.message : 'Could not save that result.', 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solved, active?.id]);

  const replay = () => {
    if (!active) return;
    savedRef.current.delete(active.id);
    persist({ ...progressMap, [active.id]: emptyProgress() });
    setRiddleInputs({}); setRiddleFeedback({}); setStep('file'); setShowHint(false);
  };

  const startEdit = (c: DetectiveCase | null) => {
    setForm(c ? { ...c, evidence: c.evidence.map((e) => ({ ...e })), riddles: c.riddles.map((r) => ({ ...r })), links: c.links.map((l) => ({ ...l })), distractors: [...c.distractors] } : blankCaseForm());
    setEditing(true);
  };
  const saveCase = async () => {
    const err = validateDetectiveCase(form);
    if (err) return notify(err, 'error');
    const cleaned: DetectiveCase = {
      ...form,
      evidence: form.evidence.map((e, i) => ({ ...e, id: e.id || `e${i}` })),
      riddles: form.riddles.map((r, i) => ({ ...r, id: r.id || `r${i}` })),
      distractors: form.distractors.map((d) => d.trim()).filter(Boolean),
    };
    const next: DetectiveConfig = {
      cases: form.id && cases.some((c) => c.id === form.id)
        ? cases.map((c) => (c.id === form.id ? cleaned : c))
        : [...cases, { ...cleaned, id: cleaned.id || `case-${Date.now()}` }],
    };
    try { await saveGameConfig(store, 'detective', next); await reload(); setEditing(false); notify('Case saved — it is shared with your partner, like every other game config.'); }
    catch (e) { notify(e instanceof Error ? e.message : 'Could not save that case.', 'error'); }
  };
  const removeCase = async (id: string) => {
    try { await saveGameConfig(store, 'detective', { cases: cases.filter((c) => c.id !== id) }); await reload(); if (caseId === id) closeCase(); notify('Case removed.'); }
    catch (e) { notify(e instanceof Error ? e.message : 'Could not remove that case.', 'error'); }
  };
  const restoreSamples = async () => {
    try { await saveGameConfig(store, 'detective', DEFAULT_DETECTIVE); await reload(); setRestoring(false); notify('Sample cases restored.'); }
    catch (e) { notify(e instanceof Error ? e.message : 'Could not restore the samples.', 'error'); }
  };

  const steps: { key: DetectiveStep; label: string }[] = [
    { key: 'file', label: 'Case file' },
    { key: 'evidence', label: 'Evidence' },
    { key: 'riddles', label: 'Riddles' },
    { key: 'board', label: 'Investigation board' },
  ];

  if (!active) {
    return (
      <div>
        <Card>
          <h2 className="font-serif-display text-2xl">Secret Detective Mission</h2>
          <p className="mt-1 text-sm leading-relaxed text-cocoa-soft">Open a case file, read the introduction, examine the evidence, collect the clues, solve the riddles, and connect everything on the investigation board. Every mystery here is cosy and gentle — a missing teapot, a vanishing key — never grim, never violent. Answers are checked on this device only (client-side checking, not server validation), hints are always free, and you can replay any case. No sound: there is no sound control because there is no sound to turn on.</p>
          <p className="mt-2 text-sm text-cocoa-soft">Your half-solved case is saved in this browser and resumes after a reload, on this device. A finished case is recorded like any other game result.</p>
          <ul className="mt-4 space-y-3">
            {cases.map((c) => {
              const p = progressMap[c.id] ?? emptyProgress();
              return (
                <li key={c.id} className="detective-folder">
                  <p className="text-xs font-bold tracking-wide text-cocoa-soft">{c.sample ? 'SAMPLE CASE — invented, not a real memory' : 'YOUR CASE — written by you, shared with your partner'}</p>
                  <p className="font-serif-display mt-1 text-xl">{c.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-cocoa-soft">{p.completed ? 'Case closed ✓ — play it again any time.' : p.collected.length > 0 || p.solvedRiddles.length > 0 ? `In progress — ${caseProgressLabel(c, p)}` : 'Not started yet.'}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button onClick={() => openCase(c.id)}>{p.completed ? 'Reopen the case file' : p.collected.length > 0 || p.solvedRiddles.length > 0 ? 'Continue the case' : 'Open the case file'}</Button>
                    <Button variant="quiet" onClick={() => startEdit(c)}>Edit this case</Button>
                    {!c.sample && <ConfirmDelete label="Remove" note="Remove this case for good? This cannot be undone." confirmLabel="Yes, remove" onConfirm={() => removeCase(c.id)} />}
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="quiet" onClick={() => startEdit(null)}>Write your own case</Button>
            {restoring ? (
              <span className="flex flex-wrap gap-2"><Button onClick={restoreSamples}>Yes, restore the two sample cases</Button><Button variant="quiet" onClick={() => setRestoring(false)}>Keep my cases</Button></span>
            ) : (
              <Button variant="quiet" onClick={() => setRestoring(true)}>Restore sample cases</Button>
            )}
          </div>
        </Card>
        {editing && <DetectiveEditor form={form} setForm={setForm} onSave={saveCase} onCancel={() => setEditing(false)} />}
      </div>
    );
  }

  return (
    <div>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-serif-display text-2xl">{active.title}</h2>
          <Button variant="quiet" onClick={closeCase}>← Back to the case files</Button>
        </div>
        <p className="mt-1 text-xs font-bold tracking-wide text-cocoa-soft">{active.sample ? 'SAMPLE CASE — invented, not a real memory' : 'YOUR CASE — shared with your partner by design'}</p>
        <p className="mt-2 text-sm" aria-live="polite">{caseProgressLabel(active, progress)}{progress.completed ? ' · Case closed ✓' : ''}</p>
        <div className="mt-3 flex flex-wrap gap-2" role="tablist" aria-label="Case steps">
          {steps.map((s) => (
            <button key={s.key} type="button" onClick={() => setStep(s.key)} aria-selected={step === s.key}
              className={`rounded-full border px-3 py-1.5 text-sm ${step === s.key ? 'border-cocoa/40 bg-butter' : 'border-cocoa/25 bg-paper hover:bg-cream-deep'}`}>{s.label}</button>
          ))}
        </div>
        <div className="mt-3"><Button variant="quiet" onClick={() => setShowHint(!showHint)}>{showHint ? 'Hide the hint' : 'I need a hint'}</Button></div>
        {showHint && <p className="mt-2 rounded-2xl border border-cocoa/20 bg-paper p-3 text-sm leading-relaxed" role="status">Hint: {active.hint}</p>}

        {step === 'file' && (
          <div className="mt-4">
            <p className="font-serif-display text-lg leading-relaxed">The case file</p>
            <p className="mt-2 text-sm leading-relaxed">{active.intro}</p>
            <p className="mt-3 text-sm text-cocoa-soft">How it works: examine each piece of evidence to collect its clue, solve the riddles, then connect each clue to what it means on the investigation board. Finish all three and the case closes with its ending and a surprise.</p>
            <div className="mt-3"><Button onClick={() => setStep('evidence')}>Start examining the evidence →</Button></div>
          </div>
        )}

        {step === 'evidence' && (
          <div className="mt-4 space-y-3">
            <p className="font-serif-display text-lg">Evidence — examine each item to collect its clue</p>
            {active.evidence.map((e) => {
              const got = progress.collected.includes(e.id);
              return (
                <div key={e.id} className="clue-card">
                  <p className="font-serif-display text-lg">{e.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-cocoa-soft">{e.detail}</p>
                  {got ? (
                    <p className="mt-2 rounded-xl bg-sage p-3 text-sm leading-relaxed">🔍 Clue collected: {e.clue}</p>
                  ) : (
                    <div className="mt-2"><Button onClick={() => examine(e.id)}>Examine this evidence</Button></div>
                  )}
                </div>
              );
            })}
            <div className="mt-2"><Button variant="quiet" onClick={() => setStep('riddles')}>On to the riddles →</Button></div>
          </div>
        )}

        {step === 'riddles' && (
          <div className="mt-4 space-y-4">
            <p className="font-serif-display text-lg">Riddles — answers are checked on this device only</p>
            {active.riddles.map((r) => {
              const solvedR = progress.solvedRiddles.includes(r.id);
              return (
                <div key={r.id} className="rounded-2xl border border-cocoa/20 bg-paper p-4">
                  <p className="font-serif-display text-lg leading-relaxed">{r.question}</p>
                  {solvedR ? (
                    <p className="mt-2 text-sm text-cocoa-soft">Solved ✓ — the answer was “{r.answer}”.</p>
                  ) : (
                    <>
                      <p className="mt-1 text-sm text-cocoa-soft">Hint: {r.hint}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <input value={riddleInputs[r.id] ?? ''} onChange={(e) => setRiddleInputs({ ...riddleInputs, [r.id]: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') tryRiddle(r.id, riddleInputs[r.id] ?? ''); }} className={`${inputCls} min-w-52 flex-1`} maxLength={500} placeholder="Your answer…" aria-label={`Your answer to: ${r.question}`} />
                        <Button onClick={() => tryRiddle(r.id, riddleInputs[r.id] ?? '')}>Try this answer</Button>
                      </div>
                      {riddleFeedback[r.id] && <p className="mt-2 text-sm text-cocoa-soft" role="status">{riddleFeedback[r.id]}</p>}
                    </>
                  )}
                </div>
              );
            })}
            <div className="mt-2"><Button variant="quiet" onClick={() => setStep('board')}>On to the investigation board →</Button></div>
          </div>
        )}

        {step === 'board' && (
          <div className="mt-4">
            <p className="font-serif-display text-lg">The investigation board</p>
            <p className="mt-1 text-sm leading-relaxed text-cocoa-soft">Connect each clue to what it means. The red strings are just decoration — the connections are your choices below, and every choice is a button or a select, so keyboard play works throughout.</p>
            <svg className="detective-board-svg" aria-hidden="true" viewBox="0 0 300 60" preserveAspectRatio="none">
              <path d="M10 45 Q 80 5, 150 35 T 290 15" fill="none" stroke="#b85a5a" strokeWidth="2" strokeDasharray="5 4" />
              <circle cx="10" cy="45" r="5" fill="#b85a5a" /><circle cx="150" cy="35" r="5" fill="#b85a5a" /><circle cx="290" cy="15" r="5" fill="#b85a5a" />
            </svg>
            <div className="mt-2 space-y-3">
              {active.links.map((l, i) => {
                const ok = boardLinkCorrect(l, progress.boardAnswers[i] ?? '');
                return (
                  <div key={i} className="clue-card">
                    <p className="text-sm"><span className="font-bold">Clue:</span> {l.clue}</p>
                    <Field label="What does it mean?">
                      <select value={progress.boardAnswers[i] ?? ''} onChange={(e) => setBoardAnswer(i, e.target.value)} className={inputCls} aria-label={`What does this clue mean: ${l.clue}`}>
                        <option value="">Choose a connection…</option>
                        {boardOptions(active).map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </Field>
                    {progress.boardAnswers[i] && <p className="mt-1 text-sm text-cocoa-soft" role="status">{ok ? 'That connection fits ✓' : 'That connection does not fit yet — try another.'}</p>}
                  </div>
                );
              })}
            </div>
            {solved && (
              <div className="mt-4 rounded-3xl border border-cocoa/30 bg-butter p-4 text-center">
                <p className="text-4xl" aria-hidden="true">★</p>
                <p className="font-serif-display mt-2 text-2xl">Case closed!</p>
                <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed">{active.ending}</p>
                <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed font-bold">{active.surprise}</p>
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  <Button onClick={replay}>Play this case again</Button>
                  <Button variant="quiet" onClick={closeCase}>Back to the case files</Button>
                </div>
              </div>
            )}
            {!solved && <p className="mt-3 text-sm text-cocoa-soft">Close the case by collecting every clue, solving every riddle, and connecting every clue correctly. Nothing is timed and nothing is lost if you stop halfway — your progress is saved in this browser.</p>}
          </div>
        )}
      </Card>
      <Card className="mt-4">
        <p className="text-sm leading-relaxed text-cocoa-soft">Privacy note: this mission never looks at your memories, letters, journals or plans, so nothing private can appear in a case. Custom cases are the exception by design — they are written by you and shared with your partner through the game config, so only write what you are happy for them to see. Never paste a private journal, a private draft, a sealed letter, or a scheduled letter into a case.</p>
      </Card>
    </div>
  );
}

function DetectiveEditor({ form, setForm, onSave, onCancel }: {
  form: DetectiveCase;
  setForm: (f: DetectiveCase) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const set = (patch: Partial<DetectiveCase>) => setForm({ ...form, ...patch });
  const editList = <T,>(list: T[], i: number, patch: Partial<T>): T[] => list.map((x, j) => (j === i ? { ...x, ...patch } : x));
  return (
    <Card className="mt-4">
      <h3 className="font-serif-display text-xl">{form.id && form.title ? `Edit case: ${form.title}` : 'Write your own case'}</h3>
      <p className="mt-1 text-sm leading-relaxed text-cocoa-soft">Custom cases are shared with your partner by design — they live in the shared game config, like quiz questions and chest riddles. Only write what you are happy for them to see. Never paste private journals, private drafts, sealed letters, or scheduled letters here. Sample cases are labelled as samples until you rewrite them into your own.</p>
      <div className="mt-4 space-y-3">
        <Field label="Case title"><input value={form.title} onChange={(e) => set({ title: e.target.value })} className={inputCls} maxLength={200} /></Field>
        <Field label="Introduction — what happened?"><textarea value={form.intro} onChange={(e) => set({ intro: e.target.value })} className={inputCls} rows={3} maxLength={2000} /></Field>
        <Field label="Hint for when someone is stuck"><input value={form.hint} onChange={(e) => set({ hint: e.target.value })} className={inputCls} maxLength={500} /></Field>
        <p className="font-serif-display text-lg">Evidence — each item reveals one clue when examined</p>
        {form.evidence.map((e, i) => (
          <div key={i} className="space-y-3 rounded-2xl border border-cocoa/15 p-3">
            <Field label={`Evidence ${i + 1} title`}><input value={e.title} onChange={(ev) => set({ evidence: editList(form.evidence, i, { title: ev.target.value }) })} className={inputCls} maxLength={200} /></Field>
            <Field label="What does it look like?"><input value={e.detail} onChange={(ev) => set({ evidence: editList(form.evidence, i, { detail: ev.target.value }) })} className={inputCls} maxLength={500} /></Field>
            <Field label="The clue it reveals"><input value={e.clue} onChange={(ev) => set({ evidence: editList(form.evidence, i, { clue: ev.target.value }) })} className={inputCls} maxLength={500} /></Field>
            <Button variant="quiet" onClick={() => set({ evidence: form.evidence.filter((_, j) => j !== i) })}>Remove this evidence</Button>
          </div>
        ))}
        <div><Button variant="quiet" onClick={() => set({ evidence: [...form.evidence, { id: `e${form.evidence.length + 1}`, title: '', detail: '', clue: '' }] })}>Add evidence</Button></div>
        <p className="font-serif-display text-lg">Riddles — checked on the device, never on a server</p>
        {form.riddles.map((r, i) => (
          <div key={i} className="space-y-3 rounded-2xl border border-cocoa/15 p-3">
            <Field label={`Riddle ${i + 1}`}><input value={r.question} onChange={(ev) => set({ riddles: editList(form.riddles, i, { question: ev.target.value }) })} className={inputCls} maxLength={500} /></Field>
            <Field label="Answer"><input value={r.answer} onChange={(ev) => set({ riddles: editList(form.riddles, i, { answer: ev.target.value }) })} className={inputCls} maxLength={200} /></Field>
            <Field label="Hint"><input value={r.hint} onChange={(ev) => set({ riddles: editList(form.riddles, i, { hint: ev.target.value }) })} className={inputCls} maxLength={300} /></Field>
            <Button variant="quiet" onClick={() => set({ riddles: form.riddles.filter((_, j) => j !== i) })}>Remove this riddle</Button>
          </div>
        ))}
        <div><Button variant="quiet" onClick={() => set({ riddles: [...form.riddles, { id: `r${form.riddles.length + 1}`, question: '', answer: '', hint: '' }] })}>Add riddle</Button></div>
        <p className="font-serif-display text-lg">Investigation board — each clue connects to one conclusion</p>
        {form.links.map((l, i) => (
          <div key={i} className="space-y-3 rounded-2xl border border-cocoa/15 p-3">
            <Field label={`Board clue ${i + 1}`}><input value={l.clue} onChange={(ev) => set({ links: editList(form.links, i, { clue: ev.target.value }) })} className={inputCls} maxLength={300} /></Field>
            <Field label="What it means (the correct connection)"><input value={l.conclusion} onChange={(ev) => set({ links: editList(form.links, i, { conclusion: ev.target.value }) })} className={inputCls} maxLength={300} /></Field>
            <Button variant="quiet" onClick={() => set({ links: form.links.filter((_, j) => j !== i) })}>Remove this link</Button>
          </div>
        ))}
        <div><Button variant="quiet" onClick={() => set({ links: [...form.links, { clue: '', conclusion: '' }] })}>Add board link</Button></div>
        <Field label="Wrong connections (one per line, offered as decoys on the board)"><textarea value={form.distractors.join('\n')} onChange={(e) => set({ distractors: e.target.value.split('\n') })} className={inputCls} rows={2} maxLength={1000} /></Field>
        <Field label="Ending — what really happened?"><textarea value={form.ending} onChange={(e) => set({ ending: e.target.value })} className={inputCls} rows={3} maxLength={2000} /></Field>
        <Field label="Surprise — a small personal ending"><textarea value={form.surprise} onChange={(e) => set({ surprise: e.target.value })} className={inputCls} rows={2} maxLength={1000} /></Field>
        <div className="flex flex-wrap gap-2"><Button onClick={onSave}>Save this case</Button><Button variant="quiet" onClick={onCancel}>Cancel</Button></div>
      </div>
    </Card>
  );
}

// ---------- 1. Memory Match ----------

const PATTERNS = ['★', '●', '◆', '♥', '☾', '✿', '♫', '♦', '▲', '⬢'];

type DeckCard = { id: number; value: string; photoUrl: string | null; photoTitle: string | null; flipped: boolean; matched: boolean };

function MemoryGame({ store, data, reload, notify }: GameProps) {
  const config: MemoryConfig = data.configs.memory ?? DEFAULT_CONFIGS.memory;
  const [gameId, setGameId] = useState(0);
  const [started, setStarted] = useState(false);
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
    if (completed || !started) return;
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
        {!started ? (
          <div className="mt-3 rounded-2xl border border-cocoa/20 bg-paper p-4">
            <p className="font-serif-display text-lg">How to play — read this first</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-cocoa-soft">
              <li>Flip two cards. If they match, they stay face-up; if not, they flip back.</li>
              <li>Find every pair. Your moves and time are counted, gently — there is no penalty for a wrong flip.</li>
              <li>Cards are pattern cards, or your own shared photographs (never a private photo — see the settings below).</li>
              <li>A game takes a few minutes. Restart any time, and replay from the results screen when you finish.</li>
            </ul>
            <div className="mt-3"><Button onClick={() => setStarted(true)}>Start matching</Button></div>
          </div>
        ) : (
          <p className="mt-1 text-sm text-cocoa-soft">Flip two cards. Find the pair. Cards are buttons, so Tab + Enter works, and touch works the same as a click. Restart any time.</p>
        )}
        {started && <p className="mt-2 text-sm" aria-live="polite">Pairs found: {matched} / {pairs} · {memoryDifficultyLabel(pairs)} difficulty · Moves: {moves} · Time: {formatTime(elapsed)}</p>}
        {deckSource === 'patterns' && source === 'memories' && <p className="mt-1 text-xs text-cocoa-soft">Not enough shared photographs yet (need {pairs}) — using pattern cards for now. Add photos on the Memory Wall, then switch back.</p>}
        {started && (<div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-6">
          {cards.map((c) => (
            <button key={c.id} type="button" onClick={() => flip(c.id)} disabled={c.matched}
              aria-label={c.flipped || c.matched ? `Card: ${c.photoTitle ?? c.value}` : 'Face-down card'}
              className={`arcade-card-flip flex aspect-square items-center justify-center rounded-2xl border p-1 text-2xl transition-transform ${c.flipped || c.matched ? 'border-cocoa/30 bg-paper' : 'border-cocoa/25 bg-butter hover:bg-cream-deep'}`}>
              {(c.flipped || c.matched) ? (c.photoUrl ? <img src={c.photoUrl} alt={c.photoTitle ?? ''} className="h-full w-full rounded-xl object-contain" /> : <span aria-hidden="true">{c.value}</span>) : <span aria-hidden="true">?</span>}
            </button>
          ))}
        </div>)}
        {started && !completed && (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => setGameId((g) => g + 1)}>Restart</Button>
          </div>
        )}
        {completed && (
          <div className="mt-4 rounded-3xl border border-cocoa/30 bg-butter p-4 text-center">
            <p className="font-serif-display text-2xl">Results — all pairs found!</p>
            <p className="mt-2 text-sm leading-relaxed">Lovely work — {pairs} pairs in {moves} moves, {formatTime(elapsed)} ({memoryDifficultyLabel(pairs)} difficulty, {deckSource === 'memories' ? 'shared photographs' : 'pattern cards'}).</p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <Button onClick={() => setGameId((g) => g + 1)}>Play again</Button>
              <Button variant="quiet" onClick={() => { setGameId((g) => g + 1); setStarted(false); }}>Back to instructions</Button>
            </div>
          </div>
        )}
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
  const [started, setStarted] = useState(false);
  const [round, setRound] = useState(1);
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
        <RoomEmpty room="arcade" title="No questions yet" body="Add the first question below — the quiz is yours to write, so make it about the two of you." />
        <div className="mt-4"><Button onClick={() => setEditing(true)}>Add a question</Button></div>
        {editing && <QuizEditForm editForm={editForm} setEditForm={setEditForm} onSave={saveEditForm} onCancel={() => setEditing(false)} />}
      </Card>
    );
  }

  return (
    <div>
      <Card>
        <h2 className="font-serif-display text-2xl">How Well Do You Know Us?</h2>
        {!started ? (
          <div className="mt-3 rounded-2xl border border-cocoa/20 bg-paper p-4">
            <p className="font-serif-display text-lg">How to play — read this first</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-cocoa-soft">
              <li>Answer one question at a time, picking one of the options. Your score is tallied as you go.</li>
              <li>After each answer you see the right one — no rush, and a wrong answer is just something new you now know.</li>
              <li>At the end you get a results screen with your score and a replay button. A round takes a few minutes.</li>
              <li>The questions are yours to write: use the editor below to add or edit them any time.</li>
            </ul>
            <div className="mt-3"><Button onClick={() => setStarted(true)}>Start the quiz</Button></div>
          </div>
        ) : finished ? (
          <div className="py-4 text-center">
            <p className="font-serif-display text-3xl">You scored {score} out of {questions.length}.</p>
            <p className="mt-2 text-sm text-cocoa-soft">Every answer — right or not — is just a thing you now know about each other. That is the whole game.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button onClick={() => { setIndex(0); setSelected(null); setAnswered(false); setScore(0); setFinished(false); setRound((r) => r + 1); savedRef.current = false; }}>Play again</Button>
              <Button variant="quiet" onClick={() => { setIndex(0); setSelected(null); setAnswered(false); setScore(0); setFinished(false); savedRef.current = false; setStarted(false); }}>See instructions</Button>
              <Button variant="quiet" onClick={() => setEditing(true)}>Edit questions</Button>
            </div>
          </div>
        ) : (
          <>
            <p className="mt-1 text-sm text-cocoa-soft">Round {round} · Question {index + 1} of {questions.length} · Score so far: {score}</p>
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
  const [hearts, setHearts] = useState<{ id: number; x: number; y: number; kind: 'heart' | 'star' }[]>([]);
  const idRef = useRef(0);
  const savedRef = useRef(false);

  useEffect(() => {
    if (phase !== 'playing') return;
    const t = setInterval(() => setTimeLeft((s) => {
      if (s <= 1) { setPhase('done'); return 0; }
      return s - 1;
    }), 1000);
    return () => clearInterval(t);
  }, [phase]);

  // Phase 14 — increasing difficulty, stated in the UI: hearts and star
  // tokens spawn faster as the round goes on (see arcadeRules.ts).
  // Tokens sit still while up (no motion to chase), and the global
  // reduced-motion CSS applies; touch and keyboard paths are identical
  // because every token is a real button.
  const elapsedSeconds = 30 - timeLeft;
  const difficulty = catchDifficultyLabel(elapsedSeconds);
  useEffect(() => {
    if (phase !== 'playing') return;
    const spawn = setInterval(() => {
      const id = ++idRef.current;
      const heart = { id, x: 5 + Math.random() * 80, y: 5 + Math.random() * 65, kind: (Math.random() < 0.3 ? 'star' : 'heart') as 'heart' | 'star' };
      setHearts((h) => [...h.slice(-11), heart]);
      setTimeout(() => setHearts((h) => h.filter((x) => x.id !== id)), 1600);
    }, catchSpawnIntervalMs(elapsedSeconds));
    return () => clearInterval(spawn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, difficulty]);

  useEffect(() => {
    if (phase !== 'done' || savedRef.current) return;
    savedRef.current = true;
    saveGameProgress(store, { gameKey: 'catch', score, timeMs: (30 - timeLeft) * 1000, details: { durationSeconds: 30 - timeLeft, finishedEarly: timeLeft > 0 } })
      .then(() => { reload(); notify(`Catch the Hearts — you caught ${score} hearts and stars in ${30 - timeLeft} seconds.`); })
      .catch((e) => notify(e instanceof Error ? e.message : 'Could not save that result.', 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const start = () => { setScore(0); setTimeLeft(30); setHearts([]); savedRef.current = false; setPhase('playing'); };
  const pause = () => { setPhase('paused'); setHearts([]); };
  const resume = () => setPhase('playing');

  return (
    <Card>
      <h2 className="font-serif-display text-2xl">Catch the Hearts</h2>
      <div className="mt-3 rounded-2xl border border-cocoa/20 bg-paper p-4">
        <p className="font-serif-display text-lg">How to play — read this first</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-cocoa-soft">
          <li>Hearts and little star tokens pop up in the field for a moment each — each one caught is one point, heart or star alike.</li>
          <li>Tap one, or Tab to it and press Enter. Tokens sit still while they are up, so they are easy to tap.</li>
          <li>The round lasts at most thirty seconds, and tokens appear faster as it goes on. You can pause, restart, or finish early any time.</li>
          <li>When the round ends you get a results screen with your score and a replay button.</li>
        </ul>
      </div>
      <p className="mt-2 text-sm" aria-live="polite">Score: {score} · Time left: {timeLeft}s · Pace: {difficulty} · {phase === 'playing' ? 'Playing' : phase === 'paused' ? 'Paused' : phase === 'done' ? 'Finished' : 'Ready'}</p>
      {phase === 'idle' && <div className="mt-4"><Button onClick={start}>Start — 30 seconds</Button></div>}
      {phase === 'done' && (
        <div className="mt-4">
          <p className="font-serif-display text-xl">Time! You caught {score} heart{score === 1 ? '' : 's'} and star{score === 1 ? '' : 's'}.</p>
          <div className="mt-3 flex gap-2"><Button onClick={start}>Play again</Button></div>
        </div>
      )}
      {(phase === 'playing' || phase === 'paused') && (
        <>
          <div className="relative mt-4 h-72 overflow-hidden rounded-3xl border border-cocoa/20 bg-powder" role="region" aria-label="Heart field">
            {phase === 'playing' && hearts.map((h) => (
              <button key={h.id} type="button" onClick={() => { setScore((s) => s + 1); setHearts((cur) => cur.filter((x) => x.id !== h.id)); }}
                aria-label={h.kind === 'star' ? 'Catch this star token' : 'Catch this heart'}
                style={{ left: `${h.x}%`, top: `${h.y}%` }}
                className="absolute -translate-x-1/2 -translate-y-1/2 text-4xl text-[#b85a5a]">{h.kind === 'star' ? '★' : '♥'}</button>
            ))}
            {phase === 'paused' && <p className="absolute inset-0 flex items-center justify-center text-sm text-cocoa-soft">Paused — hearts are resting.</p>}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {phase === 'playing' && <Button variant="quiet" onClick={pause}>Pause</Button>}
            {phase === 'paused' && <Button onClick={resume}>Resume</Button>}
            {phase === 'playing' && <Button variant="quiet" onClick={() => setPhase('done')}>Finish now</Button>}
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
        <div className="mt-3 rounded-2xl border border-cocoa/20 bg-paper p-4">
          <p className="font-serif-display text-lg">How to play — read this first</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-relaxed text-cocoa-soft">
            <li>One partner writes a question and a private answer below. The answer stays hidden from the other partner until the reveal.</li>
            <li>The other partner gets exactly one guess — no second guesses, no peeking.</li>
            <li>After the guess, the results appear on that round&apos;s card: the guess, whether it was right, and the answer.</li>
            <li>To play again, set another secret question with the same form. Each round takes a minute or two.</li>
          </ol>
        </div>
        <div className="mt-4 space-y-3">
          <Field label="Your question"><input value={question} onChange={(e) => setQuestion(e.target.value)} className={inputCls} maxLength={500} placeholder="e.g. What was the first song we danced to?" /></Field>
          <Field label="Your private answer" hint="Only you see this until your partner guesses."><input value={answer} onChange={(e) => setAnswer(e.target.value)} className={inputCls} maxLength={500} /></Field>
          <Button onClick={create}>Set this question privately</Button>
        </div>
      </Card>
      <div className="mt-4 space-y-3">
        {rounds.length === 0 && <Card><RoomEmpty room="arcade" title="No secret questions yet" body="Set the first one above. Your partner will see the question, not the answer, and gets one guess." /></Card>}
        {rounds.map((r) => {
          const mine = r.creatorId === store.viewerId;
          return (
            <Card key={r.id}>
              <p className="text-xs text-cocoa-soft">{r.creatorName} asked · {formatDate(r.createdAt)}</p>
              <p className="font-serif-display mt-1 text-xl leading-relaxed">{r.question}</p>
              {r.revealed ? (
                <div className="mt-2 text-sm leading-relaxed">
                  <p className="font-bold">Result: {r.correct ? 'Exactly right!' : 'Not quite — and that is fine.'}</p>
                  <p>Guess: “{r.guess}”</p>
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
  const [started, setStarted] = useState(false);
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
        <p className="mt-1 text-xs text-cocoa-soft">Starter riddles — replace them with your own below. The final message is never gated: you can read it any time with the button below, riddles or not.</p>
        {!started ? (
          <div className="mt-3 rounded-2xl border border-cocoa/20 bg-paper p-4">
            <p className="font-serif-display text-lg">How to play — read this first</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-cocoa-soft">
              <li>Solve the riddles in order. Hints are free, wrong guesses cost nothing, and there is no timer.</li>
              <li>Solve them all and the chest opens on a results screen with the final message inside — and a replay button to lock it again.</li>
              <li>The final message is never locked away: read it any time from here, riddles or not.</li>
              <li>A game takes a few minutes. Start over any time.</li>
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={() => setStarted(true)}>Start solving</Button>
              <Button variant="quiet" onClick={() => setShowFinal(!showFinal)}>{showFinal ? 'Hide the final message' : 'Read the final message now'}</Button>
            </div>
            {showFinal && <p className="font-serif-display mt-3 text-xl leading-relaxed">{config.finalMessage}</p>}
          </div>
        ) : unlocked ? (
          <div className="py-4 text-center">
            <p className="chest-open text-5xl" aria-hidden="true">▣</p>
            <p className="font-serif-display mt-3 text-2xl">Results — the chest opens.</p>
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
          <RoomEmpty room="arcade" title="No riddles yet" body="Add the first riddle below, then set the final message the chest will hold. Until then, the chest stays closed — and that is the point." />
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
