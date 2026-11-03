import { useEffect, useRef, useState } from 'react';
import type { PlaceStore } from '../lib/store';
import type { GameData, HeroConfig, HeroLook, HeroMission } from '../lib/games';
import { DEFAULT_HERO, loadGameData, saveGameConfig, saveGameProgress } from '../lib/games';
import { isSealed } from '../lib/utils';
import { Card, Button, Field, inputCls } from '../components/ui';
import { IntroMotif } from '../components/design-primitives';

/**
 * Phase 6 — the personalized superhero adventure, Phase 15 hero picker.
 *
 * An original hero and an original city. No official franchise maps,
 * models, assets, logos, dialogue or music are used: the hero is a simple
 * figure drawn from rectangles and circles with no web pattern and no
 * logo, the city is three original districts drawn as comic panels, and
 * the "web" move is a zip to a glowing anchor point — an original
 * traversal effect, not a copied swing mechanic.
 *
 * No large game engine is used: a single <canvas> with a small
 * requestAnimationFrame loop, plain AABB collision, and the same
 * game-config / game-progress tables Phase 5 introduced (game_key
 * 'hero'), so no new schema is needed.
 *
 * Phase 15: character selection and colours live in the same hero
 * game-config JSON (heroLook: palette + accessory). An older saved
 * config has no heroLook and falls back to the classic look, so nothing
 * stored is invalidated. The picker offers only shared, unsealed items
 * as rewards (see rewardLetters below): private drafts and sealed
 * letters are never offered and never shown, even if an older saved
 * mission names one.
 *
 * The final personal message is NEVER gated by gameplay: it is readable
 * from the intro and from the map, any time, without finishing a level.
 * Level rewards (a photo, letter or appreciation) unlock on reaching a
 * level's flag, regardless of how many tokens were collected — tokens
 * are an objective to aim for, not a gate.
 */

type Props = {
  store: PlaceStore;
  data: GameData;
  reload: () => Promise<void>;
  notify: (m: string, k?: 'ok' | 'error') => void;
  onBackToArcade: () => void;
};

const W = 960;
const H = 540;
const GROUND_Y = 480;

interface Platform { x: number; y: number; w: number; h: number }
interface Token { x: number; y: number; id: number }
interface LevelDef {
  platforms: Platform[];
  tokens: Token[];
  checkpointX: number;
  goalX: number;
  anchors: { x: number; y: number }[];
  signX: number;
}

function makeLevel(index: number): LevelDef {
  const base: LevelDef = {
    platforms: [
      { x: 200, y: 380, w: 180, h: 20 }, { x: 450, y: 300, w: 180, h: 20 },
      { x: 700, y: 380, w: 180, h: 20 }, { x: 950, y: 300, w: 180, h: 20 },
      { x: 1200, y: 380, w: 180, h: 20 }, { x: 1450, y: 300, w: 180, h: 20 },
    ],
    tokens: [
      { x: 280, y: 440, id: 0 }, { x: 530, y: 260, id: 1 },
      { x: 780, y: 440, id: 2 }, { x: 1030, y: 260, id: 3 },
    ],
    checkpointX: 900, goalX: 1700,
    anchors: [{ x: 600, y: 150 }, { x: 1250, y: 150 }],
    signX: 150,
  };
  if (index === 1) {
    base.platforms = [
      { x: 180, y: 400, w: 160, h: 20 }, { x: 420, y: 320, w: 160, h: 20 },
      { x: 660, y: 400, w: 160, h: 20 }, { x: 900, y: 320, w: 160, h: 20 },
      { x: 1140, y: 400, w: 160, h: 20 }, { x: 1380, y: 320, w: 160, h: 20 },
    ];
    base.tokens = [
      { x: 250, y: 440, id: 0 }, { x: 490, y: 280, id: 1 },
      { x: 730, y: 440, id: 2 }, { x: 970, y: 280, id: 3 },
    ];
    base.checkpointX = 850; base.goalX = 1650;
    base.anchors = [{ x: 500, y: 140 }, { x: 1100, y: 140 }];
  }
  if (index === 2) {
    base.platforms = [
      { x: 200, y: 360, w: 160, h: 20 }, { x: 440, y: 280, w: 160, h: 20 },
      { x: 700, y: 260, w: 700, h: 20 }, { x: 1500, y: 340, w: 160, h: 20 },
    ];
    base.tokens = [
      { x: 270, y: 440, id: 0 }, { x: 510, y: 240, id: 1 },
      { x: 900, y: 220, id: 2 }, { x: 1250, y: 220, id: 3 },
    ];
    base.checkpointX = 900; base.goalX = 1700;
    base.anchors = [{ x: 700, y: 120 }, { x: 1300, y: 120 }];
  }
  return base;
}

interface Player { x: number; y: number; vx: number; vy: number; onGround: boolean }

/** Phase 15 — original colour choices for the drawn hero figure. */
const HERO_PALETTES: Record<HeroLook['palette'], { label: string; body: string; accent: string }> = {
  classic: { label: 'Classic red & blue', body: '#3E5A80', accent: '#B85A5A' },
  dusk: { label: 'Dusk purple & gold', body: '#6B5B8F', accent: '#E8B84B' },
  forest: { label: 'Forest green & peach', body: '#4E7A5A', accent: '#D98E73' },
  night: { label: 'Night blue & sky', body: '#3A3F5A', accent: '#8FB8D8' },
};
const HERO_ACCESSORIES: Record<HeroLook['accessory'], string> = {
  cape: 'Cape', scarf: 'Scarf', hat: 'Hat', none: 'No accessory',
};
const DEFAULT_LOOK: HeroLook = { palette: 'classic', accessory: 'cape' };

export function HeroAdventure({ store, data, reload, notify, onBackToArcade }: Props) {
  const config: HeroConfig = data.configs.hero ?? DEFAULT_HERO;
  const look: HeroLook = config.heroLook ?? DEFAULT_LOOK;
  const [lookDraft, setLookDraft] = useState<HeroLook>(look);
  const missions = config.missions.length >= 3 ? config.missions.slice(0, 3) : [...config.missions, ...DEFAULT_HERO.missions.slice(config.missions.length)];
  const [screen, setScreen] = useState<'intro' | 'map' | 'playing' | 'levelDone' | 'allDone'>('intro');
  const [levelIndex, setLevelIndex] = useState(0);
  const [completed, setCompleted] = useState<Set<string>>(() => {
    const heroProg = (data.progress ?? []).filter((p) => p.gameKey === 'hero');
    const first = heroProg[0];
    const arr = first?.details?.levelsCompleted;
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  });
  const [tokens, setTokens] = useState(0);
  const [paused, setPaused] = useState(false);
  const [checkpointMsg, setCheckpointMsg] = useState<string | null>(null);
  const [clueOn, setClueOn] = useState(false);
  const [showFinal, setShowFinal] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editMissions, setEditMissions] = useState<HeroMission[]>(missions);
  const [editFinal, setEditFinal] = useState(config.finalMessage);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const keysRef = useRef<Set<string>>(new Set());
  const gameRef = useRef<{
    player: Player; level: LevelDef; collected: Set<number>; respawn: { x: number; y: number };
    checkpointReached: boolean; zip: { from: { x: number; y: number }; to: { x: number; y: number }; t: number } | null;
    done: boolean;
  } | null>(null);

  const mission = missions[levelIndex] ?? missions[0];
  const level = makeLevel(levelIndex);

  const startLevel = (idx: number) => {
    const def = makeLevel(idx);
    gameRef.current = {
      player: { x: 80, y: GROUND_Y - 36, vx: 0, vy: 0, onGround: true },
      level: def, collected: new Set(), respawn: { x: 80, y: GROUND_Y - 36 },
      checkpointReached: false, zip: null, done: false,
    };
    setLevelIndex(idx); setTokens(0); setPaused(false); setCheckpointMsg(null); setClueOn(false);
    setScreen('playing');
  };

  const finishLevel = async () => {
    const newCompleted = new Set(completed);
    newCompleted.add(mission.id);
    setCompleted(newCompleted);
    // Tokens come from the live game state: the loop's closure captures the
    // tokens state from when the level started, which is still 0 at finish.
    const liveTokens = gameRef.current?.collected.size ?? tokens;
    setTokens(liveTokens);
    try {
      await saveGameProgress(store, {
        gameKey: 'hero', score: newCompleted.size,
        details: { levelsCompleted: [...newCompleted], tokens: liveTokens },
      });
      await reload();
    } catch (e) { notify(e instanceof Error ? e.message : 'Progress could not be saved, but the level still counts here.', 'error'); }
    if (newCompleted.size >= missions.length) setScreen('allDone');
    else setScreen('levelDone');
  };

  // ---------- keyboard ----------
  useEffect(() => {
    if (screen !== 'playing') return;
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (['arrowleft', 'arrowright', 'arrowup', ' ', 'a', 'd', 'w', 'e', 'p'].includes(k)) e.preventDefault();
      keysRef.current.add(k);
      if (k === 'p') setPaused((p) => !p);
      if (k === 'e') tryZip();
    };
    const up = (e: KeyboardEvent) => keysRef.current.delete(e.key.toLowerCase());
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, levelIndex]);

  const tryZip = () => {
    const g = gameRef.current;
    if (!g || g.zip) return;
    const px = g.player.x + 14, py = g.player.y + 18;
    const anchor = g.level.anchors.find((a) => Math.hypot(a.x - px, a.y - py) < 220);
    if (anchor) g.zip = { from: { x: g.player.x, y: g.player.y }, to: { x: anchor.x - 14, y: anchor.y + 10 }, t: 0 };
  };

  const pressKey = (k: string, on: boolean) => {
    if (on) keysRef.current.add(k); else keysRef.current.delete(k);
  };

  // ---------- game loop ----------
  useEffect(() => {
    if (screen !== 'playing' || paused) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      raf = requestAnimationFrame(step);
      const dt = Math.min((now - last) / 16.67, 2);
      last = now;
      const g = gameRef.current;
      if (!g || g.done) return;
      const p = g.player;
      // Zip traversal: a short, straight zip to a glowing anchor, with a
      // web line drawn while it lasts. No gravity during the zip.
      if (g.zip) {
        g.zip.t += dt / 18;
        const t = Math.min(g.zip.t, 1);
        p.x = g.zip.from.x + (g.zip.to.x - g.zip.from.x) * t;
        p.y = g.zip.from.y + (g.zip.to.y - g.zip.from.y) * t;
        p.vx = 0; p.vy = 0;
        if (t >= 1) { g.zip = null; p.vy = -2; }
      } else {
        const keys = keysRef.current;
        const left = keys.has('arrowleft') || keys.has('a');
        const right = keys.has('arrowright') || keys.has('d');
        p.vx = left ? -4.5 : right ? 4.5 : 0;
        if ((keys.has(' ') || keys.has('arrowup') || keys.has('w')) && p.onGround) {
          p.vy = -13; p.onGround = false;
        }
        p.vy = Math.min(p.vy + 0.6 * dt, 15);
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.x = Math.max(0, Math.min(1800 - 28, p.x));
        // Collision: ground, then platforms. Horizontal movement is
        // resolved by the platform tops only in this simple platformer:
        // the player lands on a platform and walks off it, and never
        // passes through a platform from above.
        p.onGround = false;
        if (p.y + 36 >= GROUND_Y) { p.y = GROUND_Y - 36; p.vy = 0; p.onGround = true; }
        for (const plat of g.level.platforms) {
          const wasAbove = p.y + 36 - p.vy * dt <= plat.y + 1;
          if (p.x + 28 > plat.x && p.x < plat.x + plat.w && p.y + 36 >= plat.y && p.y + 36 <= plat.y + 30 && p.vy >= 0 && wasAbove) {
            p.y = plat.y - 36; p.vy = 0; p.onGround = true;
          }
        }
        // Fall below the world (only if the ground ever misses): respawn.
        if (p.y > H + 100) { p.x = g.respawn.x; p.y = g.respawn.y; p.vy = 0; }
      }
      // Tokens
      const cx = p.x + 14, cy = p.y + 18;
      for (const tok of g.level.tokens) {
        if (!g.collected.has(tok.id) && Math.hypot(tok.x - cx, tok.y - cy) < 42) {
          g.collected.add(tok.id);
          setTokens(g.collected.size);
        }
      }
      // Checkpoint
      if (!g.checkpointReached && Math.abs(cx - g.level.checkpointX) < 50) {
        g.checkpointReached = true;
        g.respawn = { x: g.level.checkpointX - 14, y: GROUND_Y - 36 };
        setCheckpointMsg('Checkpoint reached — if you fall, you restart from here, tokens kept.');
      }
      // Clue sign
      setClueOn((prev) => {
        const near = Math.abs(cx - g.level.signX) < 70;
        return near === prev ? prev : near;
      });
      // Goal
      if (!g.done && Math.abs(cx - g.level.goalX) < 50) {
        g.done = true;
        finishLevel();
      }
      draw(ctx, g);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, paused, levelIndex]);

  const draw = (ctx: CanvasRenderingContext2D, g: NonNullable<typeof gameRef.current>) => {
    const p = g.player;
    const cam = Math.max(0, Math.min(1800 - W, p.x - 300));
    ctx.clearRect(0, 0, W, H);
    // Sky (dusk pastel, in the site's palette family)
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#DFEAF3'); sky.addColorStop(0.6, '#F4DFE3'); sky.addColorStop(1, '#F8EDC9');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    // Distant city silhouettes
    ctx.fillStyle = '#51443D';
    for (let i = 0; i < 14; i++) {
      const bx = i * 140 - (cam * 0.3 % 140) - 40;
      const bh = 120 + ((i * 37) % 90);
      ctx.globalAlpha = 0.18;
      ctx.fillRect(bx, GROUND_Y - bh, 90, bh);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = '#E3EBDD';
    ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
    // Platforms (rooftops)
    for (const plat of g.level.platforms) {
      ctx.fillStyle = '#51443D';
      ctx.fillRect(plat.x - cam, plat.y, plat.w, plat.h);
      ctx.fillStyle = '#F8EDC9';
      ctx.fillRect(plat.x - cam, plat.y, plat.w, 4);
      ctx.fillStyle = '#F4DFE3';
      ctx.fillRect(plat.x - cam + 12, plat.y - 18, 14, 18);
    }
    // Ground rooftops edge
    ctx.fillStyle = '#51443D';
    ctx.fillRect(0, GROUND_Y, W, 6);
    // Tokens: glowing stars
    for (const tok of g.level.tokens) {
      if (g.collected.has(tok.id)) continue;
      ctx.save();
      ctx.shadowColor = '#E8B84B'; ctx.shadowBlur = 14;
      ctx.fillStyle = '#F8EDC9';
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? 14 : 6;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const sx = tok.x - cam + r * Math.cos(a), sy = tok.y + r * Math.sin(a);
        if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      }
      ctx.closePath(); ctx.fill(); ctx.restore();
    }
    // Checkpoint flag
    ctx.strokeStyle = '#51443D'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(g.level.checkpointX - cam, GROUND_Y); ctx.lineTo(g.level.checkpointX - cam, GROUND_Y - 60); ctx.stroke();
    ctx.fillStyle = g.checkpointReached ? '#B85A5A' : '#C9B8A8';
    ctx.beginPath(); ctx.moveTo(g.level.checkpointX - cam, GROUND_Y - 60); ctx.lineTo(g.level.checkpointX - cam + 28, GROUND_Y - 50); ctx.lineTo(g.level.checkpointX - cam, GROUND_Y - 40); ctx.closePath(); ctx.fill();
    // Goal flag
    ctx.strokeStyle = '#51443D'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(g.level.goalX - cam, GROUND_Y); ctx.lineTo(g.level.goalX - cam, GROUND_Y - 90); ctx.stroke();
    ctx.fillStyle = '#B85A5A';
    ctx.beginPath(); ctx.moveTo(g.level.goalX - cam, GROUND_Y - 90); ctx.lineTo(g.level.goalX - cam + 44, GROUND_Y - 75); ctx.lineTo(g.level.goalX - cam, GROUND_Y - 60); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#51443D'; ctx.font = 'bold 13px sans-serif';
    ctx.fillText('FINISH', g.level.goalX - cam - 14, GROUND_Y - 100);
    // Clue sign
    ctx.fillStyle = '#51443D';
    ctx.fillRect(g.level.signX - cam - 2, GROUND_Y - 46, 4, 46);
    ctx.fillStyle = '#F8EDC9';
    ctx.fillRect(g.level.signX - cam - 20, GROUND_Y - 78, 40, 32);
    ctx.fillStyle = '#51443D'; ctx.font = 'bold 20px serif'; ctx.textAlign = 'center';
    ctx.fillText('!', g.level.signX - cam, GROUND_Y - 54);
    ctx.textAlign = 'left';
    // Zip anchors
    for (const a of g.level.anchors) {
      ctx.save();
      ctx.strokeStyle = '#B85A5A'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(a.x - cam, a.y, 12, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#F4DFE3';
      ctx.beginPath(); ctx.arc(a.x - cam, a.y, 5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    // Zip line + motion lines while zipping
    if (g.zip) {
      ctx.strokeStyle = 'rgba(184,90,90,0.8)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(p.x + 14 - cam, p.y + 18); ctx.lineTo(g.zip.to.x + 14 - cam, g.zip.to.y + 18); ctx.stroke();
      ctx.strokeStyle = 'rgba(81,68,61,0.5)';
      for (let i = 0; i < 4; i++) {
        const y = p.y + i * 10;
        ctx.beginPath(); ctx.moveTo(p.x - cam - 20 - i * 6, y); ctx.lineTo(p.x - cam - 4, y); ctx.stroke();
      }
    }
    // Player: original hero figure, no web pattern, no logo. Colours
    // and accessory come from the saved hero look (Phase 15 picker).
    const palette = HERO_PALETTES[look.palette] ?? HERO_PALETTES.classic;
    const px = p.x - cam, py = p.y;
    // Cape (flutters with movement) — only for the cape accessory.
    if (look.accessory === 'cape') {
      ctx.fillStyle = palette.accent;
      const flutter = p.vx !== 0 ? 6 : 2;
      ctx.beginPath(); ctx.moveTo(px + 4, py + 6); ctx.lineTo(px - 10 - flutter, py + 22); ctx.lineTo(px + 4, py + 30); ctx.closePath(); ctx.fill();
    }
    // Body
    ctx.fillStyle = palette.body;
    ctx.fillRect(px, py + 8, 28, 20);
    // Scarf: a band across the body with a short tail.
    if (look.accessory === 'scarf') {
      ctx.fillStyle = palette.accent;
      ctx.fillRect(px, py + 10, 28, 6);
      ctx.fillRect(px + 28, py + 12, 10, 5);
    }
    // Head + simple mask band
    ctx.fillStyle = '#E8C9A8';
    ctx.beginPath(); ctx.arc(px + 14, py + 4, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = palette.accent;
    ctx.fillRect(px + 5, py + 1, 18, 5);
    // Hat: a simple cap above the head, no cape with it.
    if (look.accessory === 'hat') {
      ctx.fillStyle = palette.accent;
      ctx.beginPath(); ctx.arc(px + 14, py - 1, 9, Math.PI, 0); ctx.fill();
      ctx.fillRect(px + 14, py - 4, 12, 3);
    }
    // Legs
    ctx.fillStyle = '#51443D';
    ctx.fillRect(px + 3, py + 28, 9, 8); ctx.fillRect(px + 16, py + 28, 9, 8);
  };

  // Phase 15 privacy fix: reward letters are shared, unsealed letters
  // only. The old picker used store.shared(), which only filters out
  // deleted items — a private draft or an unrevealed scheduled letter
  // could be picked and its body shown to the partner on completion.
  const rewardLetters = store.visibleLetters().filter((l) => l.visibility === 'shared' && !isSealed(l, store.viewerId));

  const rewardItem = () => {
    if (!mission || mission.rewardKind === 'none' || !mission.rewardId) return null;
    if (mission.rewardKind === 'memory') return store.shared(store.data.memories).find((m) => m.id === mission.rewardId);
    if (mission.rewardKind === 'letter') return rewardLetters.find((l) => l.id === mission.rewardId);
    return store.shared(store.data.appreciations).find((a) => a.id === mission.rewardId);
  };
  const reward = rewardItem();

  const saveEdits = async () => {
    try {
      await saveGameConfig(store, 'hero', { missions: editMissions, finalMessage: editFinal, heroLook: look });
      await reload(); setEditing(false); notify('Adventure missions saved.');
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not save missions.', 'error'); }
  };

  const saveLook = async () => {
    try {
      await saveGameConfig(store, 'hero', { missions: config.missions, finalMessage: config.finalMessage, heroLook: lookDraft });
      await reload(); notify('Hero look saved.');
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not save the hero look.', 'error'); }
  };

  const lookPreviewPalette = HERO_PALETTES[lookDraft.palette] ?? HERO_PALETTES.classic;

  return (
    <div>
      {screen === 'intro' && (
        <Card className="hero-panel">
          <IntroMotif world="hero" />
          <p className="text-3xl" aria-hidden="true">▣</p>
          <h2 className="font-serif-display mt-2 text-2xl">A Hero's City</h2>
          <p className="mt-2 text-sm leading-relaxed text-cocoa-soft">
            An original mini-adventure in a city you already know: run the rooftops, collect memory tokens, read the clues,
            and reach the far flag. The hero is yours — a simple red-and-blue figure with a cape, drawn for this game only.
            No official characters, maps or music are used here.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-cocoa-soft">
            Controls: <strong>← →</strong> or <strong>A D</strong> to run, <strong>Space / ↑ / W</strong> to jump, <strong>E</strong> to zip to a glowing anchor, <strong>P</strong> to pause.
            On a phone, use the buttons under the city. Falling just returns you to the last checkpoint, tokens kept.
            Checkpoints restart you mid-level; a finished district is saved when you reach its flag, and the map remembers it after a reload.
          </p>
          <div className="mt-4 rounded-2xl border border-cocoa/20 bg-paper p-4">
            <p className="font-serif-display text-lg">Choose your hero</p>
            <p className="mt-1 text-sm text-cocoa-soft">Original colours and accessories for the drawn figure — saved with this adventure's settings, and changeable any time. No new character is added; this is the same hero, recoloured.</p>
            <div className="mt-3 flex items-center gap-3">
              <svg width="60" height="60" viewBox="0 0 60 60" role="img" aria-label={`Hero preview: ${HERO_PALETTES[lookDraft.palette]?.label}, ${HERO_ACCESSORIES[lookDraft.accessory]}`}>
                {lookDraft.accessory === 'cape' && <path d="M18 14 L4 30 L18 38 Z" fill={lookPreviewPalette.accent} />}
                <rect x="16" y="22" width="28" height="20" fill={lookPreviewPalette.body} />
                {lookDraft.accessory === 'scarf' && <><rect x="16" y="24" width="28" height="6" fill={lookPreviewPalette.accent} /><rect x="44" y="26" width="10" height="5" fill={lookPreviewPalette.accent} /></>}
                <circle cx="30" cy="14" r="9" fill="#E8C9A8" />
                <rect x="21" y="11" width="18" height="5" fill={lookPreviewPalette.accent} />
                {lookDraft.accessory === 'hat' && <><path d="M21 8 A9 9 0 0 1 39 8 Z" fill={lookPreviewPalette.accent} /><rect x="30" y="5" width="12" height="3" fill={lookPreviewPalette.accent} /></>}
                <rect x="19" y="42" width="9" height="8" fill="#51443D" /><rect x="32" y="42" width="9" height="8" fill="#51443D" />
              </svg>
              <div className="flex-1 space-y-2">
                <Field label="Hero colours"><select value={lookDraft.palette} onChange={(e) => setLookDraft({ ...lookDraft, palette: e.target.value as HeroLook['palette'] })} className={inputCls} aria-label="Hero colours">
                  {(Object.keys(HERO_PALETTES) as HeroLook['palette'][]).map((p) => <option key={p} value={p}>{HERO_PALETTES[p].label}</option>)}
                </select></Field>
                <Field label="Accessory"><select value={lookDraft.accessory} onChange={(e) => setLookDraft({ ...lookDraft, accessory: e.target.value as HeroLook['accessory'] })} className={inputCls} aria-label="Hero accessory">
                  {(Object.keys(HERO_ACCESSORIES) as HeroLook['accessory'][]).map((a) => <option key={a} value={a}>{HERO_ACCESSORIES[a]}</option>)}
                </select></Field>
              </div>
            </div>
            <div className="mt-3"><Button variant="quiet" onClick={saveLook}>Save hero look</Button></div>
            <p className="mt-2 text-xs text-cocoa-soft">Saved look: {HERO_PALETTES[look.palette]?.label}, {HERO_ACCESSORIES[look.accessory]}.</p>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => setScreen('map')}>Start the adventure</Button>
            <Button variant="quiet" onClick={() => setShowFinal(!showFinal)}>{showFinal ? 'Hide the final message' : 'Read the final message now'}</Button>
          </div>
          {showFinal && (
            <div className="mt-4 rounded-2xl border border-cocoa/20 bg-paper p-4">
              <p className="text-xs text-cocoa-soft">The final message — yours to read any time, no levels needed.</p>
              <p className="font-serif-display mt-2 text-xl leading-relaxed">{config.finalMessage}</p>
            </div>
          )}
        </Card>
      )}

      {screen === 'map' && (
        <div>
          <Card className="hero-map">
            <h2 className="font-serif-display text-2xl">Choose a district</h2>
            <p className="mt-1 text-sm text-cocoa-soft">Three short districts. Finish them in any order — the map remembers which ones you have done.</p>
            <p className="mt-1 text-sm text-cocoa-soft">Playing as: {HERO_PALETTES[look.palette]?.label}, {HERO_ACCESSORIES[look.accessory]} (change it on the intro screen).</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {missions.map((m, i) => {
                const done = completed.has(m.id);
                return (
                  <div key={m.id} className="rounded-2xl border border-cocoa/20 bg-paper p-4">
                    <p className="font-serif-display text-xl">{m.title}</p>
                    <p className="mt-1 text-sm text-cocoa-soft">{m.clue}</p>
                    <p className="mt-2 text-xs text-cocoa-soft">Aim for {m.tokenGoal} of 4 tokens · {done ? 'Done ✓' : 'Not done yet'}</p>
                    <div className="mt-3"><Button onClick={() => startLevel(i)}>{done ? 'Play again' : 'Play this district'}</Button></div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="quiet" onClick={() => setShowFinal(!showFinal)}>{showFinal ? 'Hide the final message' : 'Read the final message now'}</Button>
              <Button variant="quiet" onClick={() => { setEditMissions(missions); setEditFinal(config.finalMessage); setEditing(!editing); }}>{editing ? 'Hide editor' : 'Edit missions and final message'}</Button>
            </div>
            {showFinal && (
              <div className="mt-4 rounded-2xl border border-cocoa/20 bg-paper p-4">
                <p className="text-xs text-cocoa-soft">The final message — yours to read any time, no levels needed.</p>
                <p className="font-serif-display mt-2 text-xl leading-relaxed">{config.finalMessage}</p>
              </div>
            )}
          </Card>
          {editing && (
            <Card className="mt-4">
              <h3 className="font-serif-display text-xl">Make it yours</h3>
              <p className="mt-1 text-sm text-cocoa-soft">Edit titles, clues, token goals and reward messages. The three districts keep their rooftops — only the story around them changes. These are starter missions — replace them with your own places and memories. Nothing here is your real history until you write it. Reward items are shared items only: private drafts and sealed letters are never offered, and a reward chosen here is shown to whoever finishes the district, so pick only what you mean to share.</p>
              <div className="mt-4 space-y-4">
                {editMissions.map((m, i) => (
                  <div key={m.id} className="space-y-3 rounded-2xl border border-cocoa/15 p-3">
                    <Field label={`District ${i + 1} title`}><input value={m.title} onChange={(e) => { const next = [...editMissions]; next[i] = { ...m, title: e.target.value }; setEditMissions(next); }} className={inputCls} maxLength={100} /></Field>
                    <Field label="Clue"><input value={m.clue} onChange={(e) => { const next = [...editMissions]; next[i] = { ...m, clue: e.target.value }; setEditMissions(next); }} className={inputCls} maxLength={500} /></Field>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Tokens to aim for (of 4)"><select value={m.tokenGoal} onChange={(e) => { const next = [...editMissions]; next[i] = { ...m, tokenGoal: Number(e.target.value) }; setEditMissions(next); }} className={inputCls}>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}</select></Field>
                      <Field label="Reward type"><select value={m.rewardKind} onChange={(e) => { const next = [...editMissions]; next[i] = { ...m, rewardKind: e.target.value as HeroMission['rewardKind'], rewardId: null }; setEditMissions(next); }} className={inputCls}><option value="none">Just a message</option><option value="memory">A shared photo / memory</option><option value="letter">A shared letter</option><option value="appreciation">An appreciation note</option></select></Field>
                    </div>
                    {m.rewardKind !== 'none' && (
                      <Field label="Reward item"><select value={m.rewardId ?? ''} onChange={(e) => { const next = [...editMissions]; next[i] = { ...m, rewardId: e.target.value || null }; setEditMissions(next); }} className={inputCls}>
                        <option value="">No item yet</option>
                        {m.rewardKind === 'memory' && store.shared(store.data.memories).map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
                        {m.rewardKind === 'letter' && rewardLetters.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
                        {m.rewardKind === 'appreciation' && store.shared(store.data.appreciations).map((x) => <option key={x.id} value={x.id}>{x.text.slice(0, 60)}</option>)}
                      </select></Field>
                    )}
                    <Field label="Reward message"><input value={m.rewardMessage} onChange={(e) => { const next = [...editMissions]; next[i] = { ...m, rewardMessage: e.target.value }; setEditMissions(next); }} className={inputCls} maxLength={500} /></Field>
                  </div>
                ))}
                <Field label="Final personal message"><textarea value={editFinal} onChange={(e) => setEditFinal(e.target.value)} className={inputCls} rows={3} maxLength={2000} /></Field>
                <Button onClick={saveEdits}>Save missions and final message</Button>
              </div>
            </Card>
          )}
        </div>
      )}

      {screen === 'playing' && (
        <div>
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-serif-display text-2xl">{mission.title}</h2>
              <span className="flex gap-2">
                <Button variant="quiet" onClick={() => setPaused(!paused)}>{paused ? 'Resume' : 'Pause'}</Button>
                <Button variant="quiet" onClick={() => startLevel(levelIndex)}>Restart level</Button>
                <Button variant="quiet" onClick={() => setScreen('map')}>Back to map</Button>
              </span>
            </div>
            <p className="mt-1 text-sm text-cocoa-soft" aria-live="polite">
              Objective: collect {mission.tokenGoal} of 4 tokens, then reach the FINISH flag. Tokens: {tokens} / 4.
              {checkpointMsg ? ` ${checkpointMsg}` : ''}
            </p>
            {clueOn && <p className="mt-2 rounded-2xl bg-butter p-3 text-sm leading-relaxed" role="status">Clue: {mission.clue}</p>}
            {paused && <p className="mt-2 text-sm text-cocoa-soft" role="status">Paused — press P or Resume to continue.</p>}
            <div className="mt-3 overflow-hidden rounded-3xl border border-cocoa/20">
              <canvas ref={canvasRef} width={W} height={H} className="block h-auto w-full" role="img" aria-label={`${mission.title}: a side-scrolling rooftop city. Use the buttons below or the keyboard to run, jump and zip.`} />
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2">
              <button type="button" aria-label="Move left" className="min-h-12 rounded-2xl border border-cocoa/25 bg-paper text-xl font-bold active:bg-butter"
                onPointerDown={() => pressKey('arrowleft', true)} onPointerUp={() => pressKey('arrowleft', false)} onPointerLeave={() => pressKey('arrowleft', false)} onPointerCancel={() => pressKey('arrowleft', false)}>◀</button>
              <button type="button" aria-label="Move right" className="min-h-12 rounded-2xl border border-cocoa/25 bg-paper text-xl font-bold active:bg-butter"
                onPointerDown={() => pressKey('arrowright', true)} onPointerUp={() => pressKey('arrowright', false)} onPointerLeave={() => pressKey('arrowright', false)} onPointerCancel={() => pressKey('arrowright', false)}>▶</button>
              <button type="button" aria-label="Jump" className="min-h-12 rounded-2xl border border-cocoa/25 bg-paper font-bold active:bg-butter"
                onPointerDown={() => pressKey(' ', true)} onPointerUp={() => pressKey(' ', false)} onPointerLeave={() => pressKey(' ', false)} onPointerCancel={() => pressKey(' ', false)}>Jump</button>
              <button type="button" aria-label="Zip to anchor" className="min-h-12 rounded-2xl border border-cocoa/25 bg-paper font-bold active:bg-butter"
                onPointerDown={() => tryZip()}>Zip</button>
            </div>
            <p className="mt-2 text-xs text-cocoa-soft">Keyboard: ← → / A D to run, Space / ↑ / W to jump, E to zip to a nearby glowing anchor, P to pause. Touch: the four buttons above.</p>
          </Card>
        </div>
      )}

      {screen === 'levelDone' && (
        <Card>
          <h2 className="font-serif-display text-2xl">District complete — {mission.title}</h2>
          <p className="mt-2 text-sm leading-relaxed text-cocoa-soft">Tokens collected: {tokens} / 4 (aim was {mission.tokenGoal}). {mission.rewardMessage}</p>
          {reward && (
            <div className="mt-4 rounded-2xl border border-cocoa/20 bg-paper p-4">
              <p className="text-xs text-cocoa-soft">Your reward from this district:</p>
              {'title' in reward && <p className="font-serif-display mt-1 text-xl">{(reward as { title: string }).title}</p>}
              {'mediaUrl' in reward && (reward as { mediaUrl: string | null }).mediaUrl && <img src={(reward as { mediaUrl: string }).mediaUrl} alt={(reward as { title: string }).title} className="mt-2 max-h-64 rounded-2xl object-contain" />}
              {'caption' in reward && (reward as { caption: string }).caption && <p className="mt-1 text-sm text-cocoa-soft">{(reward as { caption: string }).caption}</p>}
              {'body' in reward && <p className="mt-1 text-sm leading-relaxed">{(reward as { body: string }).body}</p>}
              {'text' in reward && <p className="mt-1 text-sm leading-relaxed">{(reward as { text: string }).text}</p>}
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => { const next = missions.findIndex((m) => !completed.has(m.id)); startLevel(next === -1 ? 0 : next); }}>Next district</Button>
            <Button variant="quiet" onClick={() => setScreen('map')}>Back to map</Button>
            <Button variant="quiet" onClick={() => startLevel(levelIndex)}>Replay this district</Button>
          </div>
        </Card>
      )}

      {screen === 'allDone' && (
        <Card>
          <h2 className="font-serif-display text-3xl">The whole city, together.</h2>
          <p className="mt-2 text-sm text-cocoa-soft">All three districts complete. Here is the message this adventure was keeping:</p>
          <p className="font-serif-display mt-3 text-xl leading-relaxed">{config.finalMessage}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => { setCompleted(new Set()); startLevel(0); }}>Replay the adventure</Button>
            <Button variant="quiet" onClick={() => setScreen('map')}>Back to map</Button>
            <Button variant="quiet" onClick={onBackToArcade}>Back to the arcade</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
