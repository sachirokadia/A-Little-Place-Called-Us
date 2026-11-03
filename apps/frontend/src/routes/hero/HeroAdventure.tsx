import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, getPreferences, listItems, type AnyItem, type Me, type Space } from '../../lib/api.js';
import { Card, ErrorBox } from '../../components/ui.js';
import { getFinalMessage, joinParagraphs, saveFinalMessage, splitParagraphs, type FinalMessage } from '../../lib/final-messages.js';
import styles from './hero.module.css';
import {
  EMPTY_HERO_PROGRESS,
  GENERIC_FINAL_MESSAGE,
  GENERIC_MISSIONS,
  LEVELS,
  LEVEL_IDS,
  LEVEL_LAYOUTS,
  parseHeroProgress,
  type GenericMission,
  type HeroMission,
  type HeroProgress,
  type LevelId,
} from './hero-data.js';

// ---------------------------------------------------------------------------
// The Rooftop Adventure — an ORIGINAL superhero-inspired adventure.
//
// No official superhero property appears here: no name, logo, asset,
// dialogue, or soundtrack from any such property, in code, UI, or
// comments. The protagonist is simple shapes in a red-and-blue palette;
// the city is CSS/canvas shapes (rooftops, silhouettes, motion lines).
// NO SOUND AT ALL is added: the arcade sound toggle stays off by
// default and this game never plays audio.
//
// Game: one plain <canvas> + requestAnimationFrame + plain AABB
// collision. No game-engine library. One level at a time; each level
// asks the player to collect 5 memory tokens, read the clue signs,
// and reach the finish flag. A checkpoint flag mid-level is the
// respawn point if the hero falls into a pit; tokens already
// collected are kept on respawn.
//
// Controls (also listed on the intro screen):
//   Move: Arrow keys or A/D. Jump: Space, W, or Up arrow.
//   Traversal (zip to a glowing anchor): X or either Shift key.
//   Pause: P or Escape. Touch: on-screen Left / Right / Jump /
//   Zip / Pause buttons, all 48px or taller.
// ---------------------------------------------------------------------------

const WORLD_W = 720;
const WORLD_H = 400;
const GROUND_Y = 356;
const SPEED = 230;
const JUMP_VELOCITY = -580;
const GRAVITY = 1550;
const PLAYER_W = 26;
const PLAYER_H = 38;
const ZIP_RANGE = 300;
const ZIP_MS = 180;

type View = 'intro' | 'map' | 'playing' | 'level-done';

type PlayerState = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  grounded: boolean;
  facing: 1 | -1;
  moving: boolean;
  collected: Set<number>;
  checkpoint: { x: number; y: number } | null;
  checkpointReached: boolean;
  zip: { fromX: number; fromY: number; toX: number; toY: number; startedAt: number } | null;
};

type DisplayMission = {
  id: string;
  title: string;
  clue: string;
  rewardMessage: string;
  authorId?: string;
  rewardMemoryId?: string;
  rewardLetterId?: string;
  rewardAppreciationId?: string;
};

function toDisplayMission(m: HeroMission): DisplayMission {
  return {
    id: m.id,
    title: m.title,
    clue: m.clue,
    rewardMessage: m.rewardMessage,
    authorId: m.authorId,
    rewardMemoryId: m.rewardMemoryId,
    rewardLetterId: m.rewardLetterId,
    rewardAppreciationId: m.rewardAppreciationId,
  };
}

function toDisplayGeneric(levelId: LevelId, m: GenericMission, i: number): DisplayMission {
  return { id: `generic-${levelId}-${i}`, title: m.title, clue: m.clue, rewardMessage: m.rewardMessage };
}

function freshPlayer(levelId: LevelId): PlayerState {
  const layout = LEVEL_LAYOUTS[levelId];
  return {
    x: layout.startX,
    y: GROUND_Y - PLAYER_H,
    vx: 0,
    vy: 0,
    grounded: true,
    facing: 1,
    moving: false,
    collected: new Set(),
    checkpoint: null,
    checkpointReached: false,
    zip: null,
  };
}

function overlaps(ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function RewardLinks({ mission }: { mission: DisplayMission }) {
  const links: React.ReactNode[] = [];
  if (mission.rewardMemoryId) {
    links.push(<Link key="memory" to="/memories">Open the linked memory on the Memory Wall →</Link>);
  }
  if (mission.rewardLetterId) {
    links.push(<Link key="letter" to="/letters">Open the linked letter →</Link>);
  }
  if (mission.rewardAppreciationId) {
    links.push(<Link key="appreciation" to="/appreciations">Open the linked appreciation →</Link>);
  }
  if (links.length === 0) return null;
  return (
    <p>
      Linked item — still open from its own room whether or not you play this game; the game never locks it away:{' '}
      {links}
    </p>
  );
}

export function HeroAdventure({ space, me }: { space: Space; me: Me }) {
  const [view, setView] = useState<View>('intro');
  const [activeLevel, setActiveLevel] = useState<LevelId | null>(null);
  const [progress, setProgress] = useState<HeroProgress>({ ...EMPTY_HERO_PROGRESS });
  const [collectedByLevel, setCollectedByLevel] = useState<Record<LevelId, number>>({
    'rooftop-row': 0,
    'market-lane': 0,
    'harbour-lights': 0,
  });
  const [dbMissions, setDbMissions] = useState<HeroMission[]>([]);
  const [missionsFailed, setMissionsFailed] = useState(false);
  // -- Mission editor state (frontend only; the server enforces
  // author-only edit/delete and the at-most-one reward link) -----
  type RewardKind = 'none' | 'memory' | 'letter' | 'appreciation';
  const [editorLevel, setEditorLevel] = useState<LevelId>('rooftop-row');
  const [editorTitle, setEditorTitle] = useState('');
  const [editorClue, setEditorClue] = useState('');
  const [editorRewardMessage, setEditorRewardMessage] = useState('');
  const [editorRewardKind, setEditorRewardKind] = useState<RewardKind>('none');
  const [editorRewardItemId, setEditorRewardItemId] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorSaving, setEditorSaving] = useState(false);
  const [editorDeletingId, setEditorDeletingId] = useState<string | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [editorSuccess, setEditorSuccess] = useState<string | null>(null);
  const [rewardLists, setRewardLists] = useState<Record<Exclude<RewardKind, 'none'>, AnyItem[]>>({
    memory: [],
    letter: [],
    appreciation: [],
  });
  const [rewardListsFailed, setRewardListsFailed] = useState(false);
  const [localOnly, setLocalOnly] = useState(false);
  const [paused, setPaused] = useState(false);
  const [finalOpen, setFinalOpen] = useState(false);
  // DB-backed hero final message (personalisation): either partner
  // may read and overwrite it, never gated on completion. Until a
  // row is saved, the generic sample below is shown, still labelled
  // as a sample; a saved row is never presented as the sample.
  const [savedFinal, setSavedFinal] = useState<FinalMessage | null>(null);
  const [editingFinal, setEditingFinal] = useState(false);
  const [finalDraft, setFinalDraft] = useState('');
  const [finalSaveError, setFinalSaveError] = useState<string | null>(null);
  const [savingFinal, setSavingFinal] = useState(false);
  useEffect(() => {
    let cancelled = false;
    getFinalMessage(space.id, 'hero-final')
      .then((row) => { if (!cancelled) setSavedFinal(row); })
      .catch(() => { /* No saved message yet: the sample below is shown. */ });
    return () => { cancelled = true; };
  }, [space.id]);
  const shownFinalParagraphs = (() => {
    const saved = savedFinal ? splitParagraphs(savedFinal.text) : [];
    return saved.length > 0 ? saved : GENERIC_FINAL_MESSAGE;
  })();
  const finalMessageLabel = savedFinal
    ? 'Edited by a partner — this replaces the original sample'
    : 'Generic sample final message — a draft the author can personalise later.';
  const startFinalEdit = () => {
    setFinalDraft(savedFinal ? savedFinal.text : joinParagraphs(GENERIC_FINAL_MESSAGE));
    setFinalSaveError(null);
    setEditingFinal(true);
  };
  const saveFinal = async () => {
    if (!finalDraft.trim() || savingFinal) return;
    setSavingFinal(true);
    setFinalSaveError(null);
    try {
      const saved = await saveFinalMessage(space.id, 'hero-final', finalDraft);
      setSavedFinal(saved);
      setEditingFinal(false);
    } catch (err) {
      setFinalSaveError(err instanceof Error ? err.message : 'Could not save this message.');
    } finally {
      setSavingFinal(false);
    }
  };
  const renderFinalEdit = () => editingFinal ? (
    <div>
      <p><small>Write your own version below — separate paragraphs with a blank line. Saving replaces the sample for both partners.</small></p>
      <textarea
        value={finalDraft}
        onChange={(e) => setFinalDraft(e.target.value)}
        rows={10}
        style={{ width: '100%', boxSizing: 'border-box' }}
        aria-label="Final message"
      />
      <ErrorBox message={finalSaveError} />
      <p style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
        <button className={styles.btn} type="button" onClick={() => void saveFinal()} disabled={savingFinal || !finalDraft.trim()}>
          {savingFinal ? 'Saving…' : 'Save this message'}
        </button>
        <button className={`${styles.btn} ${styles.btnQuiet}`} type="button" onClick={() => setEditingFinal(false)}>Cancel</button>
      </p>
    </div>
  ) : (
    <p>
      <button className={`${styles.btn} ${styles.btnQuiet}`} type="button" onClick={startFinalEdit}>
        Edit this message
      </button>
    </p>
  );
  const [saveError, setSaveError] = useState<string | null>(null);
  const [levelDone, setLevelDone] = useState<{ levelId: LevelId; adventureDone: boolean } | null>(null);
  const [hud, setHud] = useState<{ tokens: number; checkpoint: boolean; sign: string | null; message: string }>({
    tokens: 0,
    checkpoint: false,
    sign: null,
    message: '',
  });
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const playerRef = useRef<PlayerState | null>(null);
  const keysRef = useRef<Set<string>>(new Set());
  const hudRef = useRef(hud);
  const progressRef = useRef(progress);
  const collectedRef = useRef(collectedByLevel);
  const activeLevelRef = useRef<LevelId | null>(null);
  const pausedRef = useRef(paused);
  const reducedRef = useRef(reduced);
  const viewRef = useRef(view);
  hudRef.current = hud;
  progressRef.current = progress;
  collectedRef.current = collectedByLevel;
  activeLevelRef.current = activeLevel;
  pausedRef.current = paused;
  reducedRef.current = reduced;
  viewRef.current = view;

  // Reduced motion: account preference first (via the existing
  // preferences helper), OS media query otherwise — same pattern as
  // the other arcade games.
  useEffect(() => {
    let cancelled = false;
    getPreferences()
      .then((prefs) => {
        if (cancelled) return;
        if (prefs.motion === 'reduce') setReduced(true);
        else if (prefs.motion === 'full') setReduced(false);
        else setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      })
      .catch(() => { /* matchMedia value already in state */ });
    return () => { cancelled = true; };
  }, []);

  // Load saved progress: server first, localStorage fallback.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api<{ gameKey?: string; progress?: unknown } | unknown>(
          `/spaces/${space.id}/game-progress/hero-adventure`,
        );
        const raw = (res as { progress?: unknown })?.progress ?? res;
        if (!cancelled) {
          setProgress(parseHeroProgress(raw));
          setLocalOnly(false);
        }
      } catch {
        try {
          const stored = localStorage.getItem('lp-hero-adventure');
          if (stored && !cancelled) {
            setProgress(parseHeroProgress(JSON.parse(stored) as unknown));
            setLocalOnly(true);
          }
        } catch { /* empty local storage is fine */ }
      }
    })();
    return () => { cancelled = true; };
  }, [space.id]);

  // Load partner-written missions. Any failure (including the
  // backend route not existing yet) falls back to generic samples.
  const refreshMissions = useCallback(async () => {
    try {
      const res = await api<HeroMission[] | { missions?: HeroMission[] }>(`/spaces/${space.id}/hero-missions`);
      const list = Array.isArray(res) ? res : (res.missions ?? []);
      setDbMissions(list.filter((m) => m && typeof m.title === 'string' && typeof m.clue === 'string'));
      setMissionsFailed(false);
    } catch {
      setDbMissions([]);
      setMissionsFailed(true);
    }
  }, [space.id]);

  useEffect(() => {
    void refreshMissions();
  }, [refreshMissions]);

  // Reward-link item lists, using the same listItems pattern the
  // room pages use (GET /spaces/:spaceId/<plural>). A failed load
  // falls back to a plain item-id text input in the editor form.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [memories, letters, appreciations] = await Promise.all([
          listItems(space.id, 'memories'),
          listItems(space.id, 'letters'),
          listItems(space.id, 'appreciations'),
        ]);
        if (!cancelled) {
          setRewardLists({ memory: memories, letter: letters, appreciation: appreciations });
          setRewardListsFailed(false);
        }
      } catch {
        if (!cancelled) setRewardListsFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [space.id]);

  const saveProgress = useCallback(async (next: HeroProgress) => {
    setProgress(next);
    setSaveError(null);
    try {
      await api(`/spaces/${space.id}/game-progress/hero-adventure`, {
        method: 'PUT',
        body: { progress: next },
      });
      setLocalOnly(false);
    } catch {
      try { localStorage.setItem('lp-hero-adventure', JSON.stringify(next)); } catch { /* ignore */ }
      setLocalOnly(true);
      setSaveError('Progress could not be saved to the server, so it lives on this device only for now.');
    }
  }, [space.id]);

  const missionsForLevel = useCallback((levelId: LevelId): { source: 'partner' | 'generic'; missions: DisplayMission[] } => {
    const db = dbMissions.filter((m) => m.levelId === levelId).map(toDisplayMission);
    if (db.length > 0) return { source: 'partner', missions: db };
    return { source: 'generic', missions: GENERIC_MISSIONS[levelId].map((m, i) => toDisplayGeneric(levelId, m, i)) };
  }, [dbMissions]);

  // -- Mission editor: create / edit / delete -----------------------
  // Hiding Edit/Delete for other authors' missions is UI only; the
  // server remains the enforcement (author-only PATCH/DELETE, with
  // a generic 404 for a partner's mission).
  const resetEditor = useCallback(() => {
    setEditingId(null);
    setEditorLevel('rooftop-row');
    setEditorTitle('');
    setEditorClue('');
    setEditorRewardMessage('');
    setEditorRewardKind('none');
    setEditorRewardItemId('');
  }, []);

  const startEditMission = useCallback((mission: HeroMission) => {
    setEditingId(mission.id);
    setEditorLevel((LEVEL_IDS as readonly string[]).includes(mission.levelId) ? (mission.levelId as LevelId) : 'rooftop-row');
    setEditorTitle(mission.title);
    setEditorClue(mission.clue);
    setEditorRewardMessage(mission.rewardMessage ?? '');
    if (mission.rewardMemoryId) {
      setEditorRewardKind('memory');
      setEditorRewardItemId(mission.rewardMemoryId);
    } else if (mission.rewardLetterId) {
      setEditorRewardKind('letter');
      setEditorRewardItemId(mission.rewardLetterId);
    } else if (mission.rewardAppreciationId) {
      setEditorRewardKind('appreciation');
      setEditorRewardItemId(mission.rewardAppreciationId);
    } else {
      setEditorRewardKind('none');
      setEditorRewardItemId('');
    }
    setEditorError(null);
    setEditorSuccess(null);
    // The editor form lives on the intro/map screens.
    setView('map');
  }, []);

  const handleEditRequest = useCallback((displayId: string) => {
    const mission = dbMissions.find((m) => m.id === displayId);
    if (mission) startEditMission(mission);
  }, [dbMissions, startEditMission]);

  const handleDeleteMission = useCallback(async (displayId: string, title: string) => {
    if (!window.confirm(`Delete the mission "${title}"? This cannot be undone.`)) return;
    setEditorDeletingId(displayId);
    setEditorError(null);
    setEditorSuccess(null);
    try {
      await api(`/spaces/${space.id}/hero-missions/${displayId}`, { method: 'DELETE' });
      if (editingId === displayId) resetEditor();
      await refreshMissions();
      setEditorSuccess('Mission deleted.');
    } catch (e) {
      setEditorError(e instanceof Error ? e.message : 'Could not delete this mission.');
      // The editor (and its error display) lives on the map screen.
      setView('map');
    } finally {
      setEditorDeletingId(null);
    }
  }, [space.id, editingId, refreshMissions, resetEditor]);

  const handleEditorSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const title = editorTitle.trim();
    const clue = editorClue.trim();
    const rewardMessage = editorRewardMessage.trim();
    if (!title || !clue) {
      setEditorError('A title and a clue are both required.');
      return;
    }
    // One kind select enforces at most one reward link by
    // construction; a chosen kind still needs an item picked.
    if (editorRewardKind !== 'none' && !editorRewardItemId) {
      setEditorError('Choose an item to link, or set the reward link back to None.');
      return;
    }
    const rewardFields =
      editorRewardKind === 'memory' ? { rewardMemoryId: editorRewardItemId }
      : editorRewardKind === 'letter' ? { rewardLetterId: editorRewardItemId }
      : editorRewardKind === 'appreciation' ? { rewardAppreciationId: editorRewardItemId }
      : {};
    setEditorSaving(true);
    setEditorError(null);
    setEditorSuccess(null);
    try {
      if (editingId) {
        // PATCH: always send the reward fields explicitly — a
        // chosen link plus nulls for the other two replaces the
        // stored link; all nulls clears it.
        await api(`/spaces/${space.id}/hero-missions/${editingId}`, {
          method: 'PATCH',
          body: {
            levelId: editorLevel,
            title,
            clue,
            rewardMessage,
            rewardMemoryId: rewardFields.rewardMemoryId ?? null,
            rewardLetterId: rewardFields.rewardLetterId ?? null,
            rewardAppreciationId: rewardFields.rewardAppreciationId ?? null,
          },
        });
        setEditorSuccess('Mission updated — it now appears in the list above.');
      } else {
        await api(`/spaces/${space.id}/hero-missions`, {
          method: 'POST',
          body: {
            levelId: editorLevel,
            title,
            clue,
            ...(rewardMessage ? { rewardMessage } : {}),
            ...rewardFields,
          },
        });
        setEditorSuccess('Mission added — it now appears in the list above.');
      }
      await refreshMissions();
      resetEditor();
    } catch (err) {
      setEditorError(err instanceof Error ? err.message : 'Could not save this mission.');
    } finally {
      setEditorSaving(false);
    }
  }, [editorTitle, editorClue, editorRewardMessage, editorRewardKind, editorRewardItemId, editorLevel, editingId, space.id, refreshMissions, resetEditor]);

  const rewardItemLabel = useCallback((kind: Exclude<typeof editorRewardKind, 'none'>, item: AnyItem): string => {
    const text = (v: unknown): string => (typeof v === 'string' ? v : '');
    if (kind === 'memory') return text(item.title) || text(item.caption) || 'Untitled memory';
    if (kind === 'letter') return text(item.title) || (text(item.body).slice(0, 60) || 'Untitled letter');
    return text(item.text).slice(0, 60) || (text(item.forName) ? `For ${text(item.forName)}` : 'Untitled card');
  }, []);

  // Edit/Delete buttons for one database mission card. Generic
  // samples (no authorId) and other authors' missions get none.
  // Hiding is UI only — see the comment above resetEditor.
  const missionCardActions = (mission: DisplayMission) => {
    if (mission.authorId !== me.id) return null;
    return (
      <div className={styles.missionActions}>
        <button className={`${styles.btn} ${styles.btnQuiet}`} type="button" onClick={() => handleEditRequest(mission.id)}>
          Edit
        </button>
        <button
          className={`${styles.btn} ${styles.btnQuiet}`}
          type="button"
          disabled={editorDeletingId === mission.id}
          onClick={() => void handleDeleteMission(mission.id, mission.title)}
        >
          {editorDeletingId === mission.id ? 'Deleting…' : 'Delete'}
        </button>
      </div>
    );
  };

  const totalTokens = useCallback((): number => {
    const p = progressRef.current;
    const c = collectedRef.current;
    return LEVEL_IDS.reduce((sum, id) => sum + (p.levelsCompleted.includes(id) ? 5 : (c[id] ?? 0)), 0);
  }, []);

  const setHudIfChanged = useCallback((next: Partial<typeof hud>) => {
    const cur = hudRef.current;
    const merged = { ...cur, ...next };
    if (merged.tokens !== cur.tokens || merged.checkpoint !== cur.checkpoint || merged.sign !== cur.sign || merged.message !== cur.message) {
      hudRef.current = merged;
      setHud(merged);
    }
  }, []);

  const startLevel = useCallback((levelId: LevelId) => {
    playerRef.current = freshPlayer(levelId);
    keysRef.current.clear();
    setActiveLevel(levelId);
    setLevelDone(null);
    setFinalOpen(false);
    setPaused(false);
    setHud({ tokens: 0, checkpoint: false, sign: null, message: 'Collect 5 tokens, read the clue signs, and reach the finish flag.' });
    hudRef.current = { tokens: 0, checkpoint: false, sign: null, message: 'Collect 5 tokens, read the clue signs, and reach the finish flag.' };
    setView('playing');
  }, []);

  const restartLevel = useCallback(() => {
    const levelId = activeLevelRef.current;
    if (!levelId) return;
    playerRef.current = freshPlayer(levelId);
    keysRef.current.clear();
    setPaused(false);
    setHud({ tokens: 0, checkpoint: false, sign: null, message: 'Level restarted. Collect 5 tokens and reach the finish flag.' });
    hudRef.current = { tokens: 0, checkpoint: false, sign: null, message: 'Level restarted. Collect 5 tokens and reach the finish flag.' };
  }, []);

  const completeLevel = useCallback((levelId: LevelId) => {
    const prev = progressRef.current;
    const levelsCompleted = prev.levelsCompleted.includes(levelId)
      ? prev.levelsCompleted
      : [...prev.levelsCompleted, levelId];
    const adventureDone = LEVEL_IDS.every((id) => levelsCompleted.includes(id));
    const next: HeroProgress = {
      levelsCompleted,
      // Monotonic: a restarted level that ends with fewer in-session
      // tokens never pulls the saved total backwards.
      tokensCollected: Math.max(prev.tokensCollected, LEVEL_IDS.reduce(
        (sum, id) => sum + (levelsCompleted.includes(id) ? 5 : (collectedRef.current[id] ?? 0)),
        0,
      )),
      adventureCompleted: adventureDone,
    };
    void saveProgress(next);
    setCollectedByLevel((c) => ({ ...c, [levelId]: 5 }));
    setLevelDone({ levelId, adventureDone });
    setView('level-done');
  }, [saveProgress]);

  const backToMap = useCallback(() => {
    // Save partial token progress on the way out (monotonic guard in
    // the saved total, same as on completion).
    const prev = progressRef.current;
    const next: HeroProgress = {
      levelsCompleted: prev.levelsCompleted,
      tokensCollected: Math.max(prev.tokensCollected, totalTokens()),
      adventureCompleted: prev.adventureCompleted,
    };
    if (next.tokensCollected !== prev.tokensCollected) void saveProgress(next);
    keysRef.current.clear();
    setPaused(false);
    setActiveLevel(null);
    setLevelDone(null);
    setView('map');
  }, [saveProgress, totalTokens]);

  const replayAdventure = useCallback(() => {
    const cleared: HeroProgress = { ...EMPTY_HERO_PROGRESS };
    void saveProgress(cleared);
    try { localStorage.removeItem('lp-hero-adventure'); } catch { /* ignore */ }
    setCollectedByLevel({ 'rooftop-row': 0, 'market-lane': 0, 'harbour-lights': 0 });
    collectedRef.current = { 'rooftop-row': 0, 'market-lane': 0, 'harbour-lights': 0 };
    setLevelDone(null);
    setActiveLevel(null);
    setView('map');
  }, [saveProgress]);

  // -- Physics + AABB collision (one rAF step) -------------------------
  const stepGame = useCallback((dt: number) => {
    const levelId = activeLevelRef.current;
    const player = playerRef.current;
    if (!levelId || !player || viewRef.current !== 'playing' || pausedRef.current) return;
    const layout = LEVEL_LAYOUTS[levelId];
    const surfaces = [...layout.ground, ...layout.platforms];
    const keys = keysRef.current;

    // Zip animation: interpolate along a plain straight line, then
    // hand control back. Under reduced motion the zip is instant
    // (handled in triggerZip), so this only animates otherwise.
    if (player.zip) {
      const t = Math.min(1, (performance.now() - player.zip.startedAt) / ZIP_MS);
      player.x = player.zip.fromX + (player.zip.toX - player.zip.fromX) * t;
      player.y = player.zip.fromY + (player.zip.toY - player.zip.fromY) * t;
      if (t >= 1) {
        player.zip = null;
        player.vy = 0;
        player.vx = 0;
      }
      return;
    }

    const left = keys.has('left');
    const right = keys.has('right');
    player.moving = left !== right;
    if (left && !right) { player.vx = -SPEED; player.facing = -1; }
    else if (right && !left) { player.vx = SPEED; player.facing = 1; }
    else player.vx = 0;

    player.vy += GRAVITY * dt;
    if (player.vy > 900) player.vy = 900;

    // Horizontal move + AABB push-out.
    player.x += player.vx * dt;
    if (player.x < 0) player.x = 0;
    if (player.x > WORLD_W - PLAYER_W) player.x = WORLD_W - PLAYER_W;
    for (const s of surfaces) {
      if (overlaps(player.x, player.y, PLAYER_W, PLAYER_H, s.x, s.y, s.w, s.h)) {
        if (player.vx > 0) player.x = s.x - PLAYER_W;
        else if (player.vx < 0) player.x = s.x + s.w;
      }
    }

    // Vertical move + AABB landing / head-bump.
    const prevBottom = player.y + PLAYER_H;
    const wasFalling = player.vy >= 0;
    player.y += player.vy * dt;
    player.grounded = false;
    for (const s of surfaces) {
      if (!overlaps(player.x, player.y, PLAYER_W, PLAYER_H, s.x, s.y, s.w, s.h)) continue;
      if (wasFalling && prevBottom <= s.y + 8) {
        player.y = s.y - PLAYER_H;
        player.vy = 0;
        player.grounded = true;
      } else if (!wasFalling) {
        player.y = s.y + s.h;
        player.vy = 0;
      }
    }

    // Tokens: AABB-ish centre-distance pickup.
    let picked = false;
    layout.tokens.forEach((token, i) => {
      if (player.collected.has(i)) return;
      const pcx = player.x + PLAYER_W / 2;
      const pcy = player.y + PLAYER_H / 2;
      if (Math.abs(pcx - token.x) < 30 && Math.abs(pcy - token.y) < 32) {
        player.collected.add(i);
        picked = true;
      }
    });
    if (picked) {
      const count = player.collected.size;
      setCollectedByLevel((c) => ({ ...c, [levelId]: count }));
      collectedRef.current = { ...collectedRef.current, [levelId]: count };
      setHudIfChanged({
        tokens: count,
        message: count >= 5
          ? 'All 5 tokens collected! Now reach the finish flag.'
          : `Token collected — ${count} of 5.`,
      });
    }

    // Clue signs: touching a sign shows that level's mission clue.
    for (const sign of layout.signs) {
      if (!overlaps(player.x, player.y, PLAYER_W, PLAYER_H, sign.x, GROUND_Y - 56, 28, 56)) continue;
      const missions = missionsForLevel(levelId).missions;
      const clue = missions[sign.missionIndex]?.clue
        ?? GENERIC_MISSIONS[levelId][sign.missionIndex]?.clue
        ?? null;
      if (clue && hudRef.current.sign !== clue) setHudIfChanged({ sign: clue });
      break;
    }

    // Checkpoint flag: sets the respawn point.
    if (!player.checkpointReached && overlaps(player.x, player.y, PLAYER_W, PLAYER_H, layout.checkpointX, GROUND_Y - 72, 30, 72)) {
      player.checkpointReached = true;
      player.checkpoint = { x: layout.checkpointX, y: GROUND_Y - PLAYER_H };
      setHudIfChanged({ checkpoint: true, message: 'Checkpoint reached! If you fall, you will return here.' });
    }

    // Finish flag: completes only with all 5 tokens.
    if (overlaps(player.x, player.y, PLAYER_W, PLAYER_H, layout.finishX, GROUND_Y - 84, 34, 84)) {
      if (player.collected.size >= 5) {
        completeLevel(levelId);
        return;
      }
      if (hudRef.current.message !== 'The finish flag waits — collect all 5 tokens first.') {
        setHudIfChanged({ message: 'The finish flag waits — collect all 5 tokens first.' });
      }
    }

    // Falling into a pit: respawn at the last checkpoint (or the
    // start), with tokens already collected kept.
    if (player.y > WORLD_H + 20) {
      const spawn = player.checkpoint ?? { x: layout.startX, y: GROUND_Y - PLAYER_H };
      player.x = spawn.x;
      player.y = spawn.y;
      player.vx = 0;
      player.vy = 0;
      setHudIfChanged({ message: 'You slipped into the gap — back at the last checkpoint, tokens kept.' });
    }
  }, [completeLevel, missionsForLevel, setHudIfChanged]);

  const triggerJump = useCallback(() => {
    const player = playerRef.current;
    if (!player || viewRef.current !== 'playing' || pausedRef.current || player.zip) return;
    if (player.grounded) {
      player.vy = JUMP_VELOCITY;
      player.grounded = false;
    }
  }, []);

  const triggerZip = useCallback(() => {
    const levelId = activeLevelRef.current;
    const player = playerRef.current;
    if (!levelId || !player || viewRef.current !== 'playing' || pausedRef.current || player.zip) return;
    const layout = LEVEL_LAYOUTS[levelId];
    const pcx = player.x + PLAYER_W / 2;
    const pcy = player.y + PLAYER_H / 2;
    let best: { x: number; y: number } | null = null;
    let bestDist = ZIP_RANGE;
    for (const anchor of layout.anchors) {
      const dist = Math.hypot(anchor.x - pcx, anchor.y - pcy);
      if (dist < bestDist) { bestDist = dist; best = anchor; }
    }
    if (!best) {
      setHudIfChanged({ message: 'No glowing anchor nearby — walk closer to one and try again.' });
      return;
    }
    const toX = best.x - PLAYER_W / 2;
    const toY = best.y - PLAYER_H / 2;
    if (reducedRef.current) {
      // Reduced motion: instant, no line animation.
      player.x = toX;
      player.y = toY;
      player.vy = 0;
      player.vx = 0;
    } else {
      player.zip = { fromX: player.x, fromY: player.y, toX, toY, startedAt: performance.now() };
    }
    setHudIfChanged({ message: 'Zipped to the glowing anchor!' });
  }, [setHudIfChanged]);

  const togglePause = useCallback(() => {
    if (viewRef.current !== 'playing') return;
    keysRef.current.clear();
    setPaused((p) => !p);
  }, []);

  // Keyboard controls, active only while a level is playing.
  useEffect(() => {
    if (view !== 'playing') return undefined;
    const down = (e: KeyboardEvent) => {
      const code = e.code;
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'Space'].includes(code)) e.preventDefault();
      if (code === 'ArrowLeft' || code === 'KeyA') keysRef.current.add('left');
      else if (code === 'ArrowRight' || code === 'KeyD') keysRef.current.add('right');
      else if (code === 'Space' || code === 'KeyW' || code === 'ArrowUp') { if (!e.repeat) triggerJump(); }
      else if (code === 'KeyX' || code === 'ShiftLeft' || code === 'ShiftRight') { if (!e.repeat) triggerZip(); }
      else if (code === 'KeyP' || code === 'Escape') { if (!e.repeat) togglePause(); }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') keysRef.current.delete('left');
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') keysRef.current.delete('right');
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      keysRef.current.clear();
    };
  }, [view, triggerJump, triggerZip, togglePause]);

  // -- Canvas drawing (plain shapes only) ------------------------------
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const levelId = activeLevelRef.current;
    const player = playerRef.current;
    if (!canvas || !levelId || !player) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const meta = LEVELS.find((l) => l.id === levelId)!;
    const layout = LEVEL_LAYOUTS[levelId];
    const reducedMotion = reducedRef.current;
    const now = performance.now();

    const sky = ctx.createLinearGradient(0, 0, 0, WORLD_H);
    sky.addColorStop(0, meta.skyTop);
    sky.addColorStop(1, meta.skyBottom);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);

    // Sun + static rooftop silhouettes (no parallax, so reduced
    // motion needs no special path here).
    ctx.fillStyle = '#ffd97a';
    ctx.beginPath();
    ctx.arc(640, 60, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(90, 70, 90, 0.18)';
    const roofs = [[0, 300, 120, 56], [150, 310, 140, 46], [330, 300, 130, 56], [500, 312, 110, 44], [620, 300, 100, 56]];
    for (const [x, y, w, h] of roofs) {
      ctx.fillRect(x, y, w, h);
      ctx.beginPath();
      ctx.moveTo(x - 6, y);
      ctx.lineTo(x + w / 2, y - 26);
      ctx.lineTo(x + w + 6, y);
      ctx.closePath();
      ctx.fill();
    }

    // Zip line: a plain straight line, only while zipping and only
    // when motion is allowed.
    if (player.zip && !reducedMotion) {
      ctx.strokeStyle = meta.accent;
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.moveTo(player.zip.fromX + PLAYER_W / 2, player.zip.fromY + PLAYER_H / 2);
      ctx.lineTo(player.zip.toX + PLAYER_W / 2, player.zip.toY + PLAYER_H / 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Ground + platforms.
    ctx.fillStyle = meta.ground;
    for (const g of layout.ground) ctx.fillRect(g.x, g.y, g.w, g.h);
    for (const p of layout.platforms) {
      ctx.fillStyle = '#6b4a2f';
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.fillStyle = meta.accent;
      ctx.fillRect(p.x, p.y, p.w, 4);
    }

    // Tokens: gold discs. Gentle bob only when motion is allowed.
    layout.tokens.forEach((token, i) => {
      if (player.collected.has(i)) return;
      const bob = reducedMotion ? 0 : Math.sin(now / 400 + i) * 3;
      ctx.fillStyle = '#f2b705';
      ctx.beginPath();
      ctx.arc(token.x, token.y + bob, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff3c4';
      ctx.font = 'bold 14px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('★', token.x, token.y + bob);
    });

    // Zip anchors: glowing rings (static under reduced motion).
    for (const anchor of layout.anchors) {
      ctx.strokeStyle = meta.accent;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(anchor.x, anchor.y, reducedMotion ? 14 : 13 + Math.sin(now / 300) * 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = meta.accent;
      ctx.beginPath();
      ctx.arc(anchor.x, anchor.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Clue signs.
    for (const sign of layout.signs) {
      ctx.fillStyle = '#6b4a2f';
      ctx.fillRect(sign.x + 12, GROUND_Y - 56, 4, 56);
      ctx.fillStyle = '#fffdf6';
      ctx.strokeStyle = '#2b2118';
      ctx.lineWidth = 2;
      ctx.fillRect(sign.x, GROUND_Y - 56, 28, 22);
      ctx.strokeRect(sign.x, GROUND_Y - 56, 28, 22);
      ctx.fillStyle = '#2b2118';
      ctx.font = 'bold 14px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', sign.x + 14, GROUND_Y - 45);
    }

    // Checkpoint flag (grey until reached, accent after).
    ctx.fillStyle = '#2b2118';
    ctx.fillRect(layout.checkpointX + 14, GROUND_Y - 72, 3, 72);
    ctx.fillStyle = player.checkpointReached ? meta.accent : '#b9b0a4';
    ctx.beginPath();
    ctx.moveTo(layout.checkpointX + 17, GROUND_Y - 72);
    ctx.lineTo(layout.checkpointX + 17, GROUND_Y - 50);
    ctx.lineTo(layout.checkpointX + 38, GROUND_Y - 61);
    ctx.closePath();
    ctx.fill();

    // Finish flag: taller pole, two-tone flag.
    ctx.fillStyle = '#2b2118';
    ctx.fillRect(layout.finishX + 16, GROUND_Y - 84, 3, 84);
    ctx.fillStyle = meta.accent;
    ctx.beginPath();
    ctx.moveTo(layout.finishX + 19, GROUND_Y - 84);
    ctx.lineTo(layout.finishX + 19, GROUND_Y - 56);
    ctx.lineTo(layout.finishX + 46, GROUND_Y - 70);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#fffdf6';
    ctx.font = 'bold 11px Georgia, serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('FINISH', layout.finishX - 8, GROUND_Y - 96);

    // Hero: simple shapes in a red-and-blue palette. Cape is a plain
    // triangle on the side opposite the facing direction.
    const hx = player.x;
    const hy = player.y;
    const capeX = player.facing === 1 ? hx - 4 : hx + PLAYER_W + 4;
    const capeTip = player.facing === 1 ? hx - 16 : hx + PLAYER_W + 16;
    ctx.fillStyle = '#a63a3a';
    ctx.beginPath();
    ctx.moveTo(capeX, hy + 10);
    ctx.lineTo(capeTip, hy + 22);
    ctx.lineTo(capeX, hy + 30);
    ctx.closePath();
    ctx.fill();
    // Legs (blue), torso (red), head.
    ctx.fillStyle = '#3b5f9e';
    ctx.fillRect(hx + 3, hy + 26, 8, 12);
    ctx.fillRect(hx + 15, hy + 26, 8, 12);
    ctx.fillStyle = '#c94f4f';
    ctx.fillRect(hx + 2, hy + 12, 22, 15);
    ctx.fillStyle = '#f2c9a0';
    ctx.beginPath();
    ctx.arc(hx + 13, hy + 6, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2b2118';
    ctx.beginPath();
    ctx.arc(hx + 13, hy + 1, 8, Math.PI, Math.PI * 2);
    ctx.fill();
    // Motion lines, sparingly, only while moving and only when
    // motion is allowed.
    if (player.moving && !reducedMotion) {
      ctx.strokeStyle = 'rgba(43, 33, 24, 0.5)';
      ctx.lineWidth = 2;
      const dir = player.facing;
      const back = dir === 1 ? hx - 6 : hx + PLAYER_W + 6;
      for (let i = 0; i < 3; i++) {
        const y = hy + 8 + i * 10;
        ctx.beginPath();
        ctx.moveTo(back, y);
        ctx.lineTo(back - dir * 12, y);
        ctx.stroke();
      }
    }

    if (pausedRef.current) {
      ctx.fillStyle = 'rgba(255, 253, 246, 0.7)';
      ctx.fillRect(0, 0, WORLD_W, WORLD_H);
      ctx.fillStyle = '#2b2118';
      ctx.font = 'bold 28px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Paused', WORLD_W / 2, WORLD_H / 2);
    }
  }, []);

  // rAF loop: runs only while a level is playing. Pausing freezes
  // updates; the draw still runs so the paused overlay shows.
  useEffect(() => {
    if (view !== 'playing' || !activeLevel) return undefined;
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      if (!pausedRef.current) stepGame(dt);
      draw();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [view, activeLevel, paused, stepGame, draw]);

  const scrollToTop = () => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
  };

  const holdKey = (key: string) => ({
    onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); keysRef.current.add(key); },
    onPointerUp: () => { keysRef.current.delete(key); },
    onPointerLeave: () => { keysRef.current.delete(key); },
    onPointerCancel: () => { keysRef.current.delete(key); },
  });

  const doneCount = progress.levelsCompleted.length;
  const total = LEVEL_IDS.reduce(
    (sum, id) => sum + (progress.levelsCompleted.includes(id) ? 5 : (collectedByLevel[id] ?? 0)),
    0,
  );

  const finalMessagePanel = finalOpen && (
    <div className={styles.finalMessage} role="region" aria-label={savedFinal ? 'Final message, edited by a partner' : 'Generic sample final message'}>
      <p><strong>{finalMessageLabel}</strong></p>
      <p>Yours to read any time — no completion needed.</p>
      {shownFinalParagraphs.map((paragraph, i) => (
        <p key={i}>{paragraph}</p>
      ))}
      {renderFinalEdit()}
      <p>
        <button className={`${styles.btn} ${styles.btnQuiet}`} type="button" onClick={() => setFinalOpen(false)}>
          Close the final message
        </button>
      </p>
    </div>
  );

  const missionEditorNote = (
    <p>
      <small>
        Partners can add their own missions for each level — when they do, those replace the generic samples below.
        Nothing here invents personal content: until then, only these clearly-labelled samples appear.
      </small>
    </p>
  );

  // Mission list + editor, shown on the intro and map screens
  // below the level cards. The form is plain inputs, no animation.
  const renderMissionEditor = () => {
    const rewardItems = editorRewardKind === 'none' ? [] : rewardLists[editorRewardKind];
    return (
      <div className={styles.panel}>
        <h3>Missions for every level</h3>
        <p>
          <small>
            When you add your own missions for a level, those replace the generic samples for that level.
            Only your own missions show Edit and Delete — your partner's missions are read-only here.
          </small>
        </p>
        {LEVELS.map((level) => {
          const info = missionsForLevel(level.id);
          return (
            <div key={level.id}>
              <h4 style={{ color: level.accent }}>
                {level.name} {info.source === 'generic' ? '(generic samples)' : '(written by a partner)'}
              </h4>
              <div className={styles.missionList}>
                {info.missions.map((mission) => (
                  <div key={mission.id} className={styles.missionCard}>
                    <p>
                      <strong>{mission.title}</strong>
                      {info.source === 'generic' ? ' — generic sample' : mission.authorId === me.id ? ' — written by you' : ' — written by your partner'}
                    </p>
                    <p>Clue: {mission.clue}</p>
                    {mission.rewardMessage ? <p>{mission.rewardMessage}</p> : null}
                    <RewardLinks mission={mission} />
                    {missionCardActions(mission)}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        <h3>{editingId ? 'Edit mission' : 'Add your own missions'}</h3>
        {editingId && (
          <p>
            <small>Editing a mission you wrote. Saving replaces its title, clue, reward message, and reward link.</small>
          </p>
        )}
        {editorError && <ErrorBox message={editorError} />}
        {editorSuccess && (
          <p role="status"><small>{editorSuccess}</small></p>
        )}
        <form className={styles.editorForm} onSubmit={(e) => void handleEditorSubmit(e)}>
          <div className={styles.field}>
            <label htmlFor="hero-mission-level">Level</label>
            <select
              id="hero-mission-level"
              value={editorLevel}
              onChange={(e) => setEditorLevel(e.target.value as LevelId)}
            >
              {LEVELS.map((level) => (
                <option key={level.id} value={level.id}>{level.name}</option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="hero-mission-title">Title (required)</label>
            <input
              id="hero-mission-title"
              type="text"
              maxLength={200}
              required
              value={editorTitle}
              onChange={(e) => setEditorTitle(e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="hero-mission-clue">Clue (required)</label>
            <textarea
              id="hero-mission-clue"
              maxLength={1000}
              required
              value={editorClue}
              onChange={(e) => setEditorClue(e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="hero-mission-reward">Reward message (optional)</label>
            <textarea
              id="hero-mission-reward"
              maxLength={1000}
              value={editorRewardMessage}
              onChange={(e) => setEditorRewardMessage(e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="hero-mission-reward-kind">Reward link (optional — at most one)</label>
            <select
              id="hero-mission-reward-kind"
              value={editorRewardKind}
              onChange={(e) => {
                setEditorRewardKind(e.target.value as typeof editorRewardKind);
                setEditorRewardItemId('');
              }}
            >
              <option value="none">None</option>
              <option value="memory">Memory</option>
              <option value="letter">Letter</option>
              <option value="appreciation">Appreciation</option>
            </select>
          </div>
          {editorRewardKind !== 'none' && (
            rewardListsFailed ? (
              <div className={styles.field}>
                <label htmlFor="hero-mission-reward-item">
                  {editorRewardKind === 'memory' ? 'Memory' : editorRewardKind === 'letter' ? 'Letter' : 'Appreciation'} id
                </label>
                <input
                  id="hero-mission-reward-item"
                  type="text"
                  value={editorRewardItemId}
                  onChange={(e) => setEditorRewardItemId(e.target.value.trim())}
                  placeholder="Paste the item id — the list could not be loaded"
                />
                <p><small>The list could not be loaded, so paste the item id instead. It must be a real item in this space that you can see.</small></p>
              </div>
            ) : rewardItems.length === 0 ? (
              <p><small>No {editorRewardKind === 'memory' ? 'memories' : editorRewardKind === 'letter' ? 'letters' : 'appreciations'} yet — add one from its own room first, or set the reward link back to None.</small></p>
            ) : (
              <div className={styles.field}>
                <label htmlFor="hero-mission-reward-item">
                  Choose a {editorRewardKind === 'memory' ? 'memory' : editorRewardKind === 'letter' ? 'letter' : 'appreciation'}
                </label>
                <select
                  id="hero-mission-reward-item"
                  value={editorRewardItemId}
                  onChange={(e) => setEditorRewardItemId(e.target.value)}
                >
                  <option value="">— Choose an item —</option>
                  {rewardItems.map((item) => (
                    <option key={item.id} value={item.id}>{rewardItemLabel(editorRewardKind, item)}</option>
                  ))}
                </select>
              </div>
            )
          )}
          <div className={styles.btnRow}>
            <button className={styles.btn} type="submit" disabled={editorSaving}>
              {editorSaving ? 'Saving…' : editingId ? 'Save mission' : 'Add mission'}
            </button>
            {editingId && (
              <button className={`${styles.btn} ${styles.btnQuiet}`} type="button" onClick={resetEditor}>
                Cancel editing
              </button>
            )}
          </div>
        </form>
      </div>
    );
  };

  return (
    <Card>
      <h2 style={{ marginTop: 0 }}>The Rooftop Adventure</h2>
      <p>
        An original rooftop adventure in a little city of rooftops, market stalls, and harbour lamps.
        Three levels, five memory tokens each, and a finish flag at the end of every street. No sound — this game is silent.
      </p>
      {localOnly && (
        <div className={styles.note} role="status">
          <p>Saved on this device only — the server save did not go through, so this progress lives in this browser for now.</p>
        </div>
      )}
      {saveError && <ErrorBox message={saveError} />}
      <p role="status">
        Progress: {doneCount} of 3 levels done · {total} of 15 tokens collected
        {progress.adventureCompleted ? ' · Adventure complete!' : ''}
      </p>

      {view === 'intro' && (
        <div className={styles.panel}>
          <h3>Welcome to the little city</h3>
          <p>
            <strong>How to play:</strong> move with the Arrow keys or A/D, jump with Space, W, or the Up arrow,
            and zip to a glowing anchor ring with X or either Shift key. Pause with P or Escape. On touch screens,
            use the on-screen Left, Right, Jump, Zip, and Pause buttons.
          </p>
          <p>
            <strong>Each level asks three things:</strong> collect 5 memory tokens, read the clue signs, and reach
            the finish flag. A checkpoint flag halfway along is your safety net — fall into a gap and you return
            there with your tokens kept.
          </p>
          <div className={styles.btnRow}>
            <button className={styles.btn} type="button" onClick={() => setView('map')}>Start the adventure</button>
            <button className={`${styles.btn} ${styles.btnQuiet}`} type="button" onClick={() => setFinalOpen((v) => !v)}>
              Read the final message now
            </button>
          </div>
          <p><small>The final message is yours to read any time — no completion needed.</small></p>
          {finalMessagePanel}
        </div>
      )}
      {view === 'intro' && renderMissionEditor()}

      {view === 'map' && (
        <div className={styles.panel}>
          <h3>City map — choose a level</h3>
          <p>Levels can be played in any order. A level is done when all 5 of its tokens are collected and the finish flag is reached.</p>
          <div className={styles.levelGrid}>
            {LEVELS.map((level) => {
              const done = progress.levelsCompleted.includes(level.id);
              const tokens = done ? 5 : (collectedByLevel[level.id] ?? 0);
              return (
                <button key={level.id} className={styles.levelCard} type="button" onClick={() => startLevel(level.id)}>
                  <span style={{ display: 'block', fontWeight: 700, color: level.accent }}>{level.name}</span>
                  <span style={{ display: 'block', margin: '0.35rem 0' }}>{level.blurb}</span>
                  <span role="status">{done ? '✓ Done' : `${tokens} of 5 tokens`}</span>
                </button>
              );
            })}
          </div>
          <div className={styles.btnRow}>
            <button className={`${styles.btn} ${styles.btnQuiet}`} type="button" onClick={() => setFinalOpen((v) => !v)}>
              Read the final message now
            </button>
            {progress.levelsCompleted.length > 0 && (
              <button className={`${styles.btn} ${styles.btnQuiet}`} type="button" onClick={replayAdventure}>
                Replay the whole adventure
              </button>
            )}
          </div>
          <p><small>The final message is yours to read any time — no completion needed.</small></p>
          {finalMessagePanel}
          {missionsFailed && (
            <p role="status"><small>Partner missions could not be loaded, so generic samples are shown below.</small></p>
          )}
        </div>
      )}
      {view === 'map' && renderMissionEditor()}

      {view === 'playing' && activeLevel && (
        <div>
          {(() => {
            const meta = LEVELS.find((l) => l.id === activeLevel)!;
            const missionInfo = missionsForLevel(activeLevel);
            return (
              <div>
                <div className={styles.panel}>
                  <h3 style={{ color: meta.accent }}>{meta.name}</h3>
                  <p role="status">
                    <strong>Objective, at all times:</strong> collect 5 tokens, read the clue signs, reach the finish flag.
                    {' '}Tokens: {hud.tokens} of 5
                    {hud.checkpoint ? ' · Checkpoint reached' : ' · No checkpoint yet'}
                    {paused ? ' · Paused' : ''}
                  </p>
                  <p role="status">{hud.message}</p>
                  {hud.sign && <p role="status"><strong>Clue sign reads:</strong> {hud.sign}</p>}
                  <h4>Missions for this level {missionInfo.source === 'generic' ? '(generic samples)' : '(written by your partner)'}</h4>
                  <div className={styles.missionList}>
                    {missionInfo.missions.map((mission) => (
                      <div key={mission.id} className={styles.missionCard}>
                        <p><strong>{mission.title}</strong>{missionInfo.source === 'generic' ? ' — generic sample' : ''}</p>
                        <p>Clue: {mission.clue}</p>
                        {missionCardActions(mission)}
                      </div>
                    ))}
                  </div>
                  {missionEditorNote}
                </div>

                <div className={styles.canvasFrame}>
                  <canvas
                    ref={canvasRef}
                    width={WORLD_W}
                    height={WORLD_H}
                    role="img"
                    aria-label={`${meta.name} game world: move, jump, collect 5 tokens, and reach the finish flag.`}
                  />
                </div>

                <div className={styles.touchRow} role="group" aria-label="Touch controls">
                  <button className={styles.touchBtn} type="button" aria-label="Move left" {...holdKey('left')}>◀ Left</button>
                  <button className={styles.touchBtn} type="button" aria-label="Move right" {...holdKey('right')}>Right ▶</button>
                  <button
                    className={styles.touchBtn}
                    type="button"
                    onPointerDown={(e) => { e.preventDefault(); triggerJump(); }}
                  >
                    Jump
                  </button>
                  <button
                    className={styles.touchBtn}
                    type="button"
                    onPointerDown={(e) => { e.preventDefault(); triggerZip(); }}
                  >
                    Zip
                  </button>
                  <button className={styles.touchBtn} type="button" onClick={togglePause}>
                    {paused ? 'Resume' : 'Pause'}
                  </button>
                </div>

                <p>
                  <small>
                    Keyboard: Arrows or A/D to move · Space, W, or Up to jump · X or Shift to zip to a glowing anchor ·
                    P or Escape to pause. Keyboard controls work while the game is on screen.
                  </small>
                </p>
                <div className={styles.btnRow}>
                  <button className={`${styles.btn} ${styles.btnQuiet}`} type="button" onClick={restartLevel}>Restart this level</button>
                  <button className={`${styles.btn} ${styles.btnQuiet}`} type="button" onClick={backToMap}>Back to the city map</button>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {view === 'level-done' && levelDone && (
        <div className={styles.panel} role="status">
          <h3>
            {levelDone.adventureDone
              ? 'You finished the whole adventure!'
              : `${LEVELS.find((l) => l.id === levelDone.levelId)?.name} — complete!`}
          </h3>
          <p>
            All 5 tokens collected and the finish flag reached.
            {levelDone.adventureDone
              ? ' All three levels are done — 15 of 15 tokens.'
              : ` ${3 - progress.levelsCompleted.length} level${3 - progress.levelsCompleted.length === 1 ? '' : 's'} still to go.`}
          </p>
          <h4>Mission rewards for this level</h4>
          <div className={styles.missionList}>
            {missionsForLevel(levelDone.levelId).missions.map((mission) => (
              <div key={mission.id} className={styles.missionCard}>
                <p><strong>{mission.title}</strong>{missionsForLevel(levelDone.levelId).source === 'generic' ? ' — generic sample' : ''}</p>
                <p>{mission.rewardMessage}</p>
                <RewardLinks mission={mission} />
                {missionCardActions(mission)}
              </div>
            ))}
          </div>
          {levelDone.adventureDone && (
            <div>
              <p>The adventure is complete — here is the final message, also readable any time from the map screen.</p>
              <div className={styles.finalMessage} role="region" aria-label={savedFinal ? 'Final message, edited by a partner' : 'Generic sample final message'}>
                <p><strong>{finalMessageLabel}</strong></p>
                {shownFinalParagraphs.map((paragraph, i) => (
                  <p key={i}>{paragraph}</p>
                ))}
                {renderFinalEdit()}
              </div>
            </div>
          )}
          <div className={styles.btnRow}>
            <button className={styles.btn} type="button" onClick={backToMap}>Back to the city map</button>
            {(() => {
              const next = LEVEL_IDS.find((id) => !progress.levelsCompleted.includes(id));
              return next ? (
                <button className={styles.btn} type="button" onClick={() => startLevel(next)}>
                  Play the next level: {LEVELS.find((l) => l.id === next)?.name}
                </button>
              ) : null;
            })()}
            <button className={`${styles.btn} ${styles.btnQuiet}`} type="button" onClick={replayAdventure}>Replay the whole adventure</button>
            <button className={`${styles.btn} ${styles.btnQuiet}`} type="button" onClick={scrollToTop}>Back to the arcade</button>
            <Link to="/">Back to Home →</Link>
          </div>
        </div>
      )}
    </Card>
  );
}
