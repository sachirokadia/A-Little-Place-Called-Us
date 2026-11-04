import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import type { RoomId } from '../lib/types';
import type { PlaceStore } from '../lib/store';
import { isSealed } from '../lib/utils';
import { loadGameData } from '../lib/games';
import { deriveGarden } from '../lib/garden';
import { Washi, AvatarPair, Button } from './ui';

const ROOMS: { id: RoomId; name: string; line: string; icon: string; bg: string; rot: string; doodle: string }[] = [
  { id: 'reminders', name: 'Reminder Room', line: 'Small notes to find on ordinary days.', icon: '✦', bg: 'bg-cottage-butter', rot: '-1deg', doodle: 'a note pinned with love' },
  { id: 'memories', name: 'Memory Wall', line: 'Photos, dates, and the stories behind them.', icon: '❦', bg: 'bg-cottage-pink', rot: '0.8deg', doodle: 'pressed flowers, kept' },
  { id: 'letters', name: 'Letters', line: 'Shared letters, private drafts, and sealed ones.', icon: '✉', bg: 'bg-cottage-sky', rot: '-0.6deg', doodle: 'sealed with a sticker' },
  { id: 'quiet', name: 'Quiet Room', line: 'Support, slow breathing, and private journals.', icon: '☾', bg: 'bg-cottage-mint', rot: '1deg', doodle: 'a quiet corner, just yours' },
  { id: 'appreciations', name: 'Things I See in You', line: 'Appreciation, achievements, encouragement.', icon: '✧', bg: 'bg-cottage-lavender', rot: '-0.8deg', doodle: 'noticed, and written down' },
  { id: 'future', name: 'Our Future', line: 'Bucket lists, date ideas, and plans to keep.', icon: '→', bg: 'bg-cottage-butter', rot: '0.6deg', doodle: 'to do, together, someday' },
  { id: 'arcade', name: 'Game Arcade', line: 'Seven games to play together, from Memory Match to Our Little World.', icon: '◎', bg: 'bg-cottage-sky', rot: '-0.4deg', doodle: 'seven games, ready to play' },
];

export const WELCOME_KEY = 'our-place-welcome-dismissed';

/* NOTE (fullscreen rebuild): WelcomeCard is PRESERVED here but no
   longer rendered on the new fullscreen Home — the welcome panel, the
   statistics sentences, the recent sections and the room grid were all
   removed from Home's layout, and the actions it linked to live inside
   their rooms now. The component stays in the codebase (and its
   Settings "Show the welcome again" control still clears the key) so
   the welcome can be restored without rewriting it. */
function WelcomeCard({ store, go }: { store: PlaceStore; go: (r: RoomId) => void }) {
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(WELCOME_KEY) === '1'; } catch { return false; }
  });
  if (dismissed) return null;
  const dismiss = () => {
    try { localStorage.setItem(WELCOME_KEY, '1'); } catch { /* private mode: dismissal lasts for this session */ }
    setDismissed(true);
  };
  const d = store.data;
  // Real names only: in demo mode the members are literally "You" and "Partner",
  // so naming them would read as a template, not as two people. In a real space,
  // the members' display names are theirs, set in Settings.
  const realNames = store.mode !== 'demo' && d.members.length >= 2
    ? d.members.map((m) => m.displayName).filter(Boolean) : [];
  // Real notes only: demo samples are explicitly labelled samples elsewhere, but
  // showing one here as "A note for you" would present invented content as if a
  // partner wrote it. In demo mode the welcome always shows the invitation, and
  // in a real space it shows the latest real appreciation or shared letter.
  const latestAppreciation = store.mode === 'demo' ? undefined : store.shared(d.appreciations)[0];
  const latestLetter = store.mode === 'demo' ? undefined : store.visibleLetters().filter((l) => l.visibility === 'shared' && !isSealed(l, store.viewerId))[0];
  // Handwritten note, not a panel: the four quick actions survive as a
  // postscript list of text links, and the hide control survives as a
  // single button at the foot of the note (restorable from Settings).
  const postscript: { label: string; room: RoomId }[] = [
    { label: 'Add a memory', room: 'memories' },
    { label: 'Write a letter', room: 'letters' },
    { label: 'Leave an appreciation', room: 'appreciations' },
    { label: 'Add a small plan', room: 'future' },
  ];
  return (
    <section aria-label="Welcome home" className="mt-8">
      <div className="paper-card relative rounded-[28px] p-6 sm:p-8" style={{ transform: 'rotate(-0.4deg)' }}>
        <Washi tone="sage" />
        <p className="font-hand text-3xl leading-snug text-cocoa sm:text-4xl">
          {realNames.length >= 2 ? `Welcome home, ${realNames[0]} and ${realNames[1]}.` : 'Welcome home.'}
        </p>
        <p className="font-serif-display mt-3 text-lg leading-relaxed text-cocoa">
          This is your shared home — made for the two of you, filled by both of you.
          Take your time looking around. Nothing here needs a reply, a score, or a finish.
        </p>
        <p className="mt-4 text-sm leading-relaxed text-cocoa-soft">
          The Arcade has seven small games — Memory Match, a quiz, a board game and more.
          They are for fun, not for proving anything: every final message can be read without winning,
          and nothing you write here depends on a score.
        </p>
        <div className="mt-5 border-t border-dashed border-cocoa/25 pt-4">
          <p className="text-xs font-extrabold uppercase tracking-widest text-cocoa-soft">A note for you</p>
          {latestAppreciation ? (
            <><p className="font-serif-display mt-2 text-xl leading-relaxed text-cocoa">“{latestAppreciation.text}”</p>
            <p className="mt-2 text-sm text-cocoa-soft">— {latestAppreciation.authorName}, in Things I See in You</p></>
          ) : latestLetter ? (
            <><p className="font-serif-display mt-2 text-xl leading-relaxed text-cocoa">{latestLetter.title}</p>
            <p className="mt-2 text-sm text-cocoa-soft">— {latestLetter.authorName}, in Letters. Open it there when you want to read it in full.</p></>
          ) : (
            <p className="mt-2 text-sm leading-relaxed text-cocoa-soft">
              A note from each other will live here. When you are ready — no rush, no occasion needed —
              write one in Letters or leave an appreciation in Things I See in You.
            </p>
          )}
        </div>
        <p className="font-hand mt-5 text-2xl text-plum">P.S. — somewhere to begin, when you like:</p>
        <ul className="mt-1 space-y-1">
          {postscript.map((a) => (
            <li key={a.room}>
              <button type="button" onClick={() => go(a.room)} className="min-h-11 text-left text-sm font-bold text-plum underline decoration-plum/40 underline-offset-4 hover:text-cocoa">
                {a.label} →
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-dashed border-cocoa/25 pt-4">
          <Button variant="quiet" onClick={dismiss}>Hide this welcome</Button>
          <span className="text-xs text-cocoa-soft">You can bring it back any time from Settings.</span>
        </div>
      </div>
    </section>
  );
}

/* Phase 11 cottage theme: a per-device preference, stored in localStorage
   like the welcome dismissal — it changes no shared data. 'day' is the
   new daytime cottage picture; 'night' keeps the earlier night photograph
   instead of deleting it. */
export const COTTAGE_THEME_KEY = 'our-place-cottage-theme';
export function readCottageTheme(): 'day' | 'night' {
  try { return localStorage.getItem(COTTAGE_THEME_KEY) === 'night' ? 'night' : 'day'; } catch { return 'day'; }
}

/* HOME AS A WORLD — evolution rules (all derived from existing store data,
   no new model, no invented counts):
   - FLOWERS: one flower per shared, non-deleted memory, in a fixed
     deterministic order along the garden strip, capped at 12 so the scene
     never overflows. Zero memories = a bare garden, stated honestly —
     nothing is drawn to fake a fuller garden.
   - KEEPSAKES: favourited items (isFavorite) across the shared
     collections the store exposes — reminders, memories, visible letters,
     appreciations, plans — PLUS one per distinct arcade gameKey with a
     completed progress row (loadGameData, the existing arcade loader;
     on any load failure the arcade part is simply 0, never guessed).
     Private journals and voice notes are NOT counted: journals are
     owner-only, so they must not decorate a shared scene. Collected
     keepsakes hang as bunting across the top of the scene, capped at 10
     flags. Zero keepsakes = no bunting at all.
   - Completed-plan markers live inside the Future room, not here. */
/* Flowers as SOURCE-image points (derived from the old plate spots, whose
   left% ran across the plate width and bottom% up from the plate bottom;
   the plate was the full width and source rows 161–801, so
   x = left% × 1024 and y = 801 − bottom% × 640). The crop mapping below
   turns each point into a displayed pixel, so a flower sits on the same
   garden bed at every viewport aspect instead of drifting with a
   percentage of the viewport. Points outside the visible crop are
   clipped by the scene's overflow:hidden — they are decoration, never
   a control, so cropping them loses nothing interactive. */
const FLOWER_POINTS: { x: number; y: number; color: string; size: number; rot: string }[] = [
  { x: 20.48, y: 711.4, color: '#d96a8b', size: 26, rot: '-6deg' },
  { x: 71.68, y: 685.8, color: '#b678c2', size: 20, rot: '8deg' },
  { x: 122.88, y: 717.8, color: '#e8a33d', size: 24, rot: '-3deg' },
  { x: 184.32, y: 679.4, color: '#7fae8a', size: 19, rot: '5deg' },
  { x: 245.76, y: 711.4, color: '#5b8ec4', size: 25, rot: '-8deg' },
  { x: 296.96, y: 685.8, color: '#d96a8b', size: 20, rot: '4deg' },
  { x: 624.64, y: 711.4, color: '#b678c2', size: 26, rot: '-5deg' },
  { x: 686.08, y: 685.8, color: '#e8a33d', size: 19, rot: '7deg' },
  { x: 747.52, y: 717.8, color: '#7fae8a', size: 24, rot: '-4deg' },
  { x: 808.96, y: 679.4, color: '#d96a8b', size: 20, rot: '6deg' },
  { x: 880.64, y: 711.4, color: '#5b8ec4', size: 25, rot: '-7deg' },
  { x: 952.32, y: 685.8, color: '#b678c2', size: 21, rot: '3deg' },
];
const BUNTING_COLORS = ['#d96a8b', '#e8a33d', '#7fae8a', '#5b8ec4', '#b678c2'];

/* Cottage element targets, in SOURCE-image coordinates of the DAY
   picture (1024×1024), re-derived from the polish phase's measured plate
   boxes — NOT copied as plate percentages. The old plate was 16/10,
   object-position 50% 42%, over the 1024×1024 source, so the visible
   crop was the full width and source rows 161–801 (a 640px slice, offset
   (1024−640)×0.42 = 161.3). For each target, with plate left/top as
   CENTRES: source centre = (plate-left% × 1024, 161 + plate-top% × 640),
   source size = (plate-width% × 1024, plate-height% × 640), and the box
   below is centre ± size/2:
   - door:    centre (43%×1024=440.3, 161+63%×640=564.2), size (17%×1024=174.1, 31%×640=198.4) → x 353.3, y 465.0
   - mailbox: centre (58%×1024=593.9, 161+74.5%×640=637.8), size (7%×1024=71.7, 11%×640=70.4) → x 558.1, y 602.6
   - window:  centre (69%×1024=706.6, 161+63%×640=564.2), size (15%×1024=153.6, 22%×640=140.8) → x 629.8, y 493.8
   - garden:  centre (11%×1024=112.6, 161+89%×640=730.6), size (22%×1024=225.3, 20%×640=128.0) → x 0.0, y 666.6
   - map:     centre (40%×1024=409.6, 161+90%×640=737.0), size (12%×1024=122.9, 16%×640=102.4) → x 348.2, y 685.8
   Cross-checked against independent visual grounding on the source file
   (door ≈ x 350–490, y 430–615; mailbox ≈ x 530–610, y 550–690; lit
   window ≈ x 590–760, y 435–615, in 0–1000 normalised coords): the
   plate-derived boxes overlap those rough boxes on every target, with
   centres within ~40 source px — the grounding boxes are approximate,
   the plate measurements are the precise ones, so the plate boxes win.
   The ARCADE sign is new (the photo has no arcade sign): box x 275,
   y 712, 84×84, laid on the path stones between the bunny and the
   parchment map marker — it touches neither the map box (starts 348.2)
   nor the garden box (ends 225.3), and its drawn graphic sits inside
   the box with clearance from the map's graphic. The NIGHT picture is
   a different photograph of a different cottage (and a different size,
   1200×630), so these day boxes do NOT sit on the same features at
   night — at night the targets still open the same rooms, and a small
   note on the scene says so plainly, rather than claiming night
   alignment that was not achieved. */
type SourceBox = { x: number; y: number; w: number; h: number };
type CottageTarget = {
  room: RoomId | 'inside';
  label: string;
  shortLabel: string;
  box: SourceBox;
  radius: string;
  shapeNote: string;
  sign?: 'map' | 'arcade';
};
const COTTAGE_TARGETS: CottageTarget[] = [
  { room: 'inside', label: 'Step inside — rooms in your home', shortLabel: 'Step inside', box: { x: 353.3, y: 465.0, w: 174.1, h: 198.4 }, radius: '46% 46% 10px 10px', shapeNote: 'Arched outline tracing the lavender front door, centre of the cottage.' },
  { room: 'letters', label: 'Mailbox — Letters', shortLabel: 'Mailbox', box: { x: 558.1, y: 602.6, w: 71.7, h: 70.4 }, radius: '12px', shapeNote: 'Small rounded outline around the purple mailbox right of the door.' },
  { room: 'quiet', label: 'Lit window — Quiet Room', shortLabel: 'Lit window', box: { x: 629.8, y: 493.8, w: 153.6, h: 140.8 }, radius: '40% 40% 12px 12px', shapeNote: 'Arched-top outline around the glowing window on the right — the reading nook inside.' },
  { room: 'memories', label: 'Garden — Memory Wall', shortLabel: 'Garden', box: { x: 0.0, y: 666.6, w: 225.3, h: 128.0 }, radius: '50%', shapeNote: 'Wide oval over the flower beds at the bottom left of the garden.' },
  { room: 'future', label: 'Adventure map — Our Future', shortLabel: 'Map', box: { x: 348.2, y: 685.8, w: 122.9, h: 102.4 }, radius: '6px', shapeNote: 'Illustrated parchment map marker laid on the garden path stones (no map exists in the photo, so this marker is drawn in the app illustration style); opens Our Future.', sign: 'map' },
  { room: 'arcade', label: 'Arcade sign — Game Arcade', shortLabel: 'Arcade', box: { x: 275.0, y: 712.0, w: 84.0, h: 84.0 }, radius: '6px', shapeNote: 'Small wooden arcade sign drawn in the scene style on the path stones, between the bunny and the map marker (no arcade sign exists in the photo); opens Game Arcade.', sign: 'arcade' },
  { room: 'appreciations', label: 'Flower display — Things I See in You', shortLabel: 'Flowers', box: { x: 790.0, y: 460.0, w: 188.0, h: 150.0 }, radius: '50%', shapeNote: 'Sunflower patch on the right side of the garden, measured by visual grounding on the 1024×1024 day photo (x 790–978, y 460–610); disjoint from the lit-window box (which ends at x 783.4) and from every other target box; opens Things I See in You directly, no menu.' },
  { room: 'reminders', label: 'Garden lantern — Reminder Room', shortLabel: 'Lantern', box: { x: 226.0, y: 438.0, w: 55.0, h: 74.0 }, radius: '12px', shapeNote: 'Hanging garden lantern on its post left of the front door, measured by visual grounding on the 1024×1024 day photo (x 226–281, y 438–512); disjoint from the door box (starts x 353.3), the arcade box (starts y 712.0) and the garden box (starts y 666.6); opens Reminder Room directly, no menu.' },
];

/* Cover-crop mapping — the hard part of the fullscreen rebuild. The old
   plate was a fixed 16/10 crop, so plate percentages held. A
   full-viewport cover crop changes with viewport aspect (tall phones
   crop the sides, wide desktops crop top/bottom), so fixed percentages
   WILL misalign. Instead, on mount and on every resize, this computes
   the actual cover-crop rectangle from the container size and the
   image's natural size — exactly the rectangle a CSS object-fit: cover
   image would show — and every hotspot, flower and the image itself are
   placed from that one rectangle, so button and picture can never drift
   apart:
   - scale = max(containerW / naturalW, containerH / naturalH)
   - visible source size vw = containerW / scale, vh = containerH / scale
   - vertical crop keeps the old plate's 42% rule: sy = 0.42 × (naturalH
     − vh) (at 16/10 over the 1024 square this reproduces rows 161–801
     exactly, so the desktop framing is the approved plate framing).
   - horizontal crop is chosen, deterministically, to keep as many
     hotspot centres visible as possible: among the crop starts that
     achieve the maximum visible-centre count, the one whose visible
     centres sit furthest from the crop edges wins (ties go to the
     centred crop). This is a calculation from the source boxes, not a
     per-width override — no viewport breakpoint appears anywhere.
   A hotspot whose centre falls outside the visible crop is NOT rendered
   (a button floating where its object is not would be a lie); its room
   stays reachable through the front-door menu. At very wide aspects
   (> ~1.97) the 42% vertical rule crops the bottom row (garden, map,
   arcade centres) out of view the same way — also menu-reachable, and
   reported as a limitation, never faked with a clamped position. */
type Crop = { scale: number; sx: number; sy: number; vw: number; vh: number; dw: number; dh: number };
function computeCrop(cw: number, ch: number, nw: number, nh: number, centres: number[]): Crop {
  const scale = Math.max(cw / nw, ch / nh);
  const vw = cw / scale;
  const vh = ch / scale;
  const sy = vh >= nh ? 0 : 0.42 * (nh - vh);
  let sx = 0;
  if (vw < nw) {
    const lo = 0;
    const hi = nw - vw;
    const centred = hi / 2;
    const crit = new Set<number>([lo, hi, centred]);
    for (const c of centres) {
      crit.add(Math.min(Math.max(c, lo), hi));
      crit.add(Math.min(Math.max(c - vw, lo), hi));
    }
    const sorted = [...crit].sort((a, b) => a - b);
    let bestSx = centred;
    let bestCount = -1;
    let bestMargin = -1;
    const consider = (s: number) => {
      const inside = centres.filter((c) => c >= s - 0.5 && c <= s + vw + 0.5);
      const count = inside.length;
      const margin = inside.length ? Math.min(...inside.map((c) => Math.min(c - s, s + vw - c))) : 0;
      if (
        count > bestCount ||
        (count === bestCount && (margin > bestMargin + 0.001 ||
          (Math.abs(margin - bestMargin) <= 0.001 && Math.abs(s - centred) < Math.abs(bestSx - centred))))
      ) {
        bestCount = count;
        bestMargin = margin;
        bestSx = s;
      }
    };
    for (const s of sorted) consider(s);
    // Span-centred starts inside each max-count interval: the count is
    // constant between consecutive critical points, so centring the
    // visible centres' span inside that interval maximises edge margin.
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      if (b - a < 0.01) continue;
      const mid = (a + b) / 2;
      const inside = centres.filter((c) => c >= mid - 0.5 && c <= mid + vw + 0.5);
      if (inside.length !== bestCount) continue;
      const spanMid = (Math.min(...inside) + Math.max(...inside)) / 2;
      consider(Math.min(Math.max(spanMid - vw / 2, a), b));
    }
    sx = bestSx;
  }
  return { scale, sx, sy, vw, vh, dw: nw * scale, dh: nh * scale };
}

/* Displayed button box for a source box: the centre maps through the
   crop, and the 44px minimum expands symmetrically around that centre
   (as the old plate did) so the centre never drifts when the minimum
   bites. */
function placedBox(box: SourceBox, crop: Crop) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const width = Math.max(box.w * crop.scale, 44);
  const height = Math.max(box.h * crop.scale, 44);
  return {
    left: (cx - crop.sx) * crop.scale - width / 2,
    top: (cy - crop.sy) * crop.scale - height / 2,
    width,
    height,
  };
}
function centreVisible(box: SourceBox, crop: Crop) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  return cx >= crop.sx - 0.5 && cx <= crop.sx + crop.vw + 0.5 && cy >= crop.sy - 0.5 && cy <= crop.sy + crop.vh + 0.5;
}

/* Door-menu entries: the seven room cards (same names/lines as the old
   grid) plus Deleted and Settings, which never had grid cards. */
const MENU_ROOMS: { id: RoomId; name: string; line: string }[] = [
  ...ROOMS.map((r) => ({ id: r.id, name: r.name, line: r.line })),
  { id: 'keepsakes' as RoomId, name: 'Keepsake Box', line: 'Only what you chose to keep, in one place.' },
  { id: 'search' as RoomId, name: 'Find something we kept', line: 'Search memories, letters, notes, plans and keepsakes.' },
  { id: 'deleted' as RoomId, name: 'Deleted', line: 'Kept safe, restorable.' },
  { id: 'settings' as RoomId, name: 'Settings', line: 'Your place, your rules.' },
];

export function Home({ store, go, onSwitchViewer }: {
  store: PlaceStore;
  go: (r: RoomId) => void;
  /* Kept for API stability: the old quick actions (random reminder, Add
     a memory, Write a letter) are no longer homepage buttons — those
     actions live inside their rooms now. App still passes its handler. */
  onRandomReminder: () => void;
  /* Demo-mode viewer switching, re-homed from the suppressed demo
     banner: App passes the same switcher the banner used. */
  onSwitchViewer?: () => void;
}) {
  const d = store.data;
  const memoryCount = store.shared(d.memories).length;
  const flowerCount = Math.min(memoryCount, 12);
  // Keepsakes (broader than a favourites count — see the evolution-rules
  // comment): every favourited shared item, plus arcade.
  const keepsakeFavourites = [
    ...store.shared(d.reminders), ...store.shared(d.memories),
    ...store.visibleLetters(), ...store.shared(d.appreciations), ...store.shared(d.plans),
  ].filter((i) => i.isFavorite).length;
  const [arcadeGames, setArcadeGames] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    loadGameData(store).then((g) => {
      if (!alive) return;
      setArcadeGames([...new Set(g.progress.filter((p) => p.completed).map((p) => p.gameKey))]);
    }).catch(() => { /* arcade progress unavailable: keepsakes fall back to favourites alone */ });
    return () => { alive = false; };
  }, [store]);
  const keepsakes = keepsakeFavourites + arcadeGames.length;
  const buntingCount = Math.min(keepsakes, 10);
  /* Phase 13 living garden: ornaments + milestones are pure derivations
     (see src/lib/garden.ts) — completed plans, favourited appreciations
     and pinned notes; first memory / first completed plan / five
     completions. No local-only garden state exists to fake anything:
     the pre-existing flowers + bunting were already derivations, and
     these extend the same rule. Rendered as one small absolute strip
     at the scene's bottom edge (pointer-events-none, so it can never
     block a hotspot) — it displaces nothing, because it is overlaid,
     not laid out in flow. */
  const garden = deriveGarden(store);

  const cottageTheme = readCottageTheme();
  // Fallbacks are the verified natural sizes (day 1024×1024, night
  // 1200×630); the img onLoad replaces them with the real values.
  const [natural, setNatural] = useState(() => (cottageTheme === 'night' ? { w: 1200, h: 630 } : { w: 1024, h: 1024 }));
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const [crop, setCrop] = useState<Crop | null>(null);
  const centres = COTTAGE_TARGETS.map((t) => t.box.x + t.box.w / 2);
  useLayoutEffect(() => {
    const el = sceneRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setCrop(computeCrop(r.width, r.height, natural.w, natural.h, centres));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [natural.w, natural.h]);

  // Fullscreen Home must not scroll: lock page scroll while Home is
  // mounted, restore exactly on leaving Home so other routes scroll
  // normally again.
  useEffect(() => {
    const bodyPrev = document.body.style.overflow;
    const docPrev = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = bodyPrev;
      document.documentElement.style.overflow = docPrev;
    };
  }, []);

  const [activeTarget, setActiveTarget] = useState<string | null>(null);
  const [pressedTarget, setPressedTarget] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuCloseRef = useRef<HTMLButtonElement | null>(null);
  const doorButtonRef = useRef<HTMLButtonElement | null>(null);
  const openMenu = () => setMenuOpen(true);
  const closeMenu = () => {
    setMenuOpen(false);
    doorButtonRef.current?.focus();
  };
  useEffect(() => { if (menuOpen) menuCloseRef.current?.focus(); }, [menuOpen]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeMenu(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuOpen]);
  const activateTarget = (t: CottageTarget) => {
    if (t.room === 'inside') openMenu();
    else go(t.room);
  };

  const reduceMotion = useReducedMotion();
  return (
    <motion.main initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} aria-label="A Little Place Called Us — your cottage home" className="home-fullscreen">
      {/* The scene fills the whole viewport: the image is placed from the
          same crop rectangle as the hotspots (see computeCrop), so the
          picture and its targets move together at every aspect. No
          title card, no welcome panel, no statistics, no recent
          sections, no room grid, no bottom nav, no demo banner live on
          this page — only the cottage world, its living decorations
          (flowers from real memories, bunting from real keepsakes, with
          NO accompanying statistics text), its storybook sign, its
          hotspots, and one small settings control. */}
      <div ref={sceneRef} className="absolute inset-0 overflow-hidden">
        <img
          src={cottageTheme === 'night' ? '/night-cottage.jpg' : '/day-cottage.jpg'}
          alt={cottageTheme === 'night'
            ? 'A stone cottage at night, its windows glowing warm, beneath a moonlit garden of ferns, hostas and jasmine'
            : 'A pastel cottage in a sunny garden, with a pink roof, mint walls, a lavender door, flowers, butterflies, and small animals'}
          onLoad={(e) => {
            const im = e.currentTarget;
            if (im.naturalWidth > 0 && im.naturalHeight > 0) setNatural({ w: im.naturalWidth, h: im.naturalHeight });
          }}
          style={crop
            ? { position: 'absolute', left: -crop.sx * crop.scale, top: -crop.sy * crop.scale, width: crop.dw, height: crop.dh, maxWidth: 'none' }
            : { width: '100%', height: '100%', objectFit: 'cover', objectPosition: '50% 42%' }}
        />
        {/* Living world, drawn on the scene (decorative only, never
            interactive, so it can never steal a target's tap): flowers
            grown from real memories, bunting hung from real keepsakes. */}
        {buntingCount > 0 && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-between px-3 pt-2 sm:px-6 sm:pt-3">
            {Array.from({ length: buntingCount }).map((_, i) => (
              <span key={i} className="bunting-flag" style={{ width: 14, height: 18, background: BUNTING_COLORS[i % BUNTING_COLORS.length], clipPath: 'polygon(0 0, 100% 0, 50% 100%)', opacity: 0.95, animationDelay: `${i * 0.35}s` }} />
            ))}
          </div>
        )}
        {crop && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-10">
            {FLOWER_POINTS.slice(0, flowerCount).map((f, i) => {
              const dx = (f.x - crop.sx) * crop.scale;
              const dy = (f.y - crop.sy) * crop.scale;
              return (
                <span key={i} style={{ position: 'absolute', left: dx, top: dy, transform: `translate(-50%, -50%) rotate(${f.rot})` }}>
                  <span className="scene-flower" style={{ display: 'inline-block', color: f.color, fontSize: f.size, lineHeight: 1, textShadow: '0 1px 2px rgba(255,253,248,0.9)', animationDelay: `${i * 0.3}s` }}>✿</span>
                </span>
              );
            })}
          </div>
        )}
        {(garden.ornaments.length > 0 || garden.milestones.length > 0) && (
          <div data-testid="garden-strip" aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-1 z-10 flex flex-wrap items-center justify-center gap-1 px-2">
            {garden.ornaments.map((o) => (
              <span key={o.sourceId} data-testid="garden-ornament" title={o.label} style={{ fontSize: 17, lineHeight: 1, textShadow: '0 1px 2px rgba(255,253,248,0.9)' }}>{o.glyph}</span>
            ))}
            {garden.milestones.map((m) => (
              <span key={m.key} data-testid="garden-milestone" title={m.detail} style={{ fontSize: 11, fontWeight: 800, color: '#51443d', background: 'rgba(255,253,248,0.88)', border: '1px solid rgba(81,68,61,0.3)', borderRadius: 9999, padding: '2px 8px', whiteSpace: 'nowrap' }}>{m.label}</span>
            ))}
          </div>
        )}
        {crop && (
          <nav aria-label="Places in your home" className="absolute inset-0 z-20">
            {COTTAGE_TARGETS.filter((t) => centreVisible(t.box, crop)).map((t) => {
              const active = activeTarget === t.label;
              const pressed = pressedTarget === t.label;
              const box = placedBox(t.box, crop);
              // Label edge guard: a label centred on a hotspot near a
              // viewport edge would clip (measured: the lit-window label
              // lost 5px at 390×844). Estimate the label's width from
              // its text and nudge it back inside with marginLeft — the
              // float animation owns transform, so margin is the lever
              // that survives it. The estimate only decides the nudge;
              // the label itself is never resized or reworded.
              const narrow = window.innerWidth < 640;
              const labelText = narrow ? t.shortLabel : t.label;
              const estLabelW = labelText.length * 6.8 + 22;
              const centrePx = (t.box.x + t.box.w / 2 - crop.sx) * crop.scale;
              const containerW = crop.vw * crop.scale;
              const overRight = centrePx + estLabelW / 2 - containerW + 4;
              const overLeft = 4 - (centrePx - estLabelW / 2);
              const labelShift = overRight > 0 ? -overRight : overLeft > 0 ? overLeft : 0;
              return (
                <button key={t.label} type="button" ref={(el) => { if (t.room === 'inside') doorButtonRef.current = el; }} onClick={() => activateTarget(t)}
                  onFocus={() => setActiveTarget(t.label)} onBlur={() => setActiveTarget(null)}
                  onMouseEnter={() => setActiveTarget(t.label)} onMouseLeave={() => setActiveTarget(null)}
                  onPointerDown={() => setPressedTarget(t.label)} onPointerUp={() => setPressedTarget(null)} onPointerCancel={() => setPressedTarget(null)} onPointerLeave={() => setPressedTarget(null)}
                  className="absolute flex items-center justify-center"
                  style={{
                    left: box.left, top: box.top, width: box.width, height: box.height,
                    transform: pressed ? 'scale(0.96)' : undefined,
                    transition: 'transform var(--duration-quick) var(--ease-gentle), border-color var(--duration-gentle) var(--ease-gentle), box-shadow var(--duration-gentle) var(--ease-gentle), background-color var(--duration-gentle) var(--ease-gentle)',
                    borderRadius: t.radius, background: pressed ? 'rgba(255,253,248,0.28)' : active ? 'rgba(255,253,248,0.18)' : 'rgba(255,253,248,0.06)',
                    border: active || pressed ? '2px solid rgba(255,253,248,0.95)' : '1.5px solid rgba(255,253,248,0.60)',
                    boxShadow: active || pressed ? '0 0 0 2px rgba(81,68,61,0.25), 0 4px 12px rgba(81,68,61,0.30)' : '0 1px 6px rgba(81,68,61,0.18)',
                    cursor: 'pointer',
                  }}
                  aria-label={t.label} title={t.shapeNote}>
                  {t.sign === 'map' ? (
                    <svg aria-hidden="true" viewBox="0 0 40 30" style={{ width: '78%', height: '78%' }}>
                      <rect x="1" y="1" width="38" height="28" rx="3" fill="#f7e8c3" stroke="#51443d" strokeWidth="1.5" />
                      <path d="M4 22 Q13 8 22 16 T37 7" fill="none" stroke="#b678c2" strokeWidth="1.6" strokeDasharray="3 2" />
                      <circle cx="9" cy="20" r="2.4" fill="#d96a8b" />
                      <circle cx="31" cy="10" r="2.4" fill="#7fae8a" />
                    </svg>
                  ) : t.sign === 'arcade' ? (
                    <svg aria-hidden="true" viewBox="0 0 40 30" style={{ width: '82%', height: '82%' }}>
                      <rect x="2" y="5" width="36" height="20" rx="3" fill="#8a6d4b" stroke="#51443d" strokeWidth="1.5" />
                      <line x1="2" y1="12" x2="38" y2="12" stroke="#51443d" strokeWidth="1" opacity="0.5" />
                      <line x1="2" y1="19" x2="38" y2="19" stroke="#51443d" strokeWidth="1" opacity="0.5" />
                      <text x="20" y="21" textAnchor="middle" fontSize="11" fill="#fffdf8">★</text>
                    </svg>
                  ) : (
                    <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: 'rgba(255,253,248,0.9)', opacity: active || pressed ? 1 : 0.55, boxShadow: '0 0 0 2px rgba(81,68,61,0.25)' }} />
                  )}
                  {/* Label ABOVE its target, never below: low targets sit
                      near the bottom edge, so a label under one would
                      clip. Above, every label sits on the photograph
                      itself. Labels float gently (cottage-label) and
                      lift on hover AND focus alike, because both set
                      the same active state; the press state brightens
                      it before the click navigates. Short labels on
                      narrow screens keep neighbouring labels apart. */}
                  <span aria-hidden="true" className="cottage-label" style={{
                    position: 'absolute', left: '50%', bottom: '100%', transform: 'translate(-50%, -4px)', whiteSpace: 'nowrap',
                    marginLeft: labelShift || undefined,
                    borderRadius: 9999, padding: '2px 9px', fontSize: 11, fontWeight: 800,
                    color: active || pressed ? '#fffdf8' : '#51443d', background: active || pressed ? '#51443d' : 'rgba(255,253,248,0.96)',
                    border: '1px solid rgba(81,68,61,0.3)', boxShadow: active || pressed ? '0 4px 12px rgba(81,68,61,0.30)' : '0 2px 8px rgba(81,68,61,0.2)', zIndex: 30,
                  }}>
                    <span className="sm:hidden">{t.shortLabel}</span><span className="hidden sm:inline">{t.label}</span>
                  </span>
                </button>
              );
            })}
          </nav>
        )}
        {/* Branding, in-scene: a small hanging storybook sign in the
            sky at the top-left, clear of the cottage, the bunting row
            (it sits below the flags) and every hotspot. The tagline is
            deliberately NOT carried here — no title card is reintroduced
            to hold it. */}
        <div className="absolute z-30" style={{ left: 12, top: 34, transform: 'rotate(-1.5deg)' }}>
          <p className="font-serif-display" style={{ background: '#f7e8c3', border: '2px solid rgba(81,68,61,0.6)', borderRadius: 10, padding: '6px 12px', fontSize: 15, lineHeight: 1.25, maxWidth: 190, boxShadow: '0 2px 8px rgba(81,68,61,0.25)' }}>
            A Little Place Called Us
          </p>
        </div>
        {/* Settings + account, without a dashboard nav bar: one tiny
            corner control (44px, translucent at rest, clearer on
            hover/focus), plus Settings in the front-door menu. Sign-out
            lives inside the Settings room itself, so nothing is
            stranded by suppressing the bottom nav on Home; in demo mode
            the viewer switch lives in the door menu (see below). */}
        <button type="button" aria-label="Open Settings" onClick={() => go('settings')}
          className="home-gear absolute z-30 flex items-center justify-center"
          style={{ right: 12, top: 34, width: 44, height: 44, borderRadius: 9999, fontSize: 20 }}>
          ⚙
        </button>
        {/* Night note, kept honestly: the day-drawn targets still open
            the same rooms on the night photo, but they do not sit on
            the same features there. Small, in-scene, non-interactive so
            it can never block a hotspot. */}
        {cottageTheme === 'night' && (
          <p className="pointer-events-none absolute z-30 text-center" style={{ left: '50%', bottom: 12, transform: 'translateX(-50%)', background: 'rgba(255,253,248,0.92)', border: '1px solid rgba(81,68,61,0.3)', borderRadius: 9999, padding: '3px 12px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', maxWidth: 'calc(100vw - 24px)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            Night cottage — markers open the same rooms, but were drawn for the day picture.
          </p>
        )}
      </div>

      {/* Front-door rooms menu: a navigation menu, never a forced
          sequence or a trap. User-initiated only (the door hotspot),
          dismissible via its close buttons, Escape, and backdrop click;
          opening it focuses the close button, closing it returns focus
          to the door. It lists EVERY room, including Deleted and
          Settings, and in demo mode it carries the demo notice and the
          viewer switch re-homed from the suppressed demo banner. */}
      {menuOpen && (
        <div className="fixed inset-0 z-50">
          <div aria-hidden="true" className="absolute inset-0" style={{ background: 'rgba(81,68,61,0.45)' }} onClick={closeMenu} />
          <div role="dialog" aria-label="Rooms in your home" className="paper-card absolute left-1/2 top-1/2 w-[calc(100vw-32px)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-[28px] p-5" style={{ maxHeight: '85dvh', overflowY: 'auto' }}>
            <div className="flex items-start justify-between gap-3">
              <h2 className="font-serif-display text-2xl text-cocoa">Rooms in your home</h2>
              <button ref={menuCloseRef} type="button" onClick={closeMenu} aria-label="Close rooms menu" className="min-h-11 min-w-11 shrink-0 rounded-full border border-cocoa/30 bg-paper px-3 text-base font-bold text-cocoa hover:bg-cream-deep">×</button>
            </div>
            {store.mode === 'demo' && (
              <p className="mt-3 text-sm leading-relaxed text-cocoa-soft">
                Demo mode — sample content, saved on this device only. You are viewing as <strong>{store.viewerName}</strong>.
              </p>
            )}
            {store.mode === 'demo' && onSwitchViewer && (
              <button type="button" onClick={() => { onSwitchViewer(); }} className="mt-2 min-h-11 rounded-full border border-cocoa/30 bg-paper px-4 py-2 text-sm font-bold text-cocoa underline decoration-plum/40 underline-offset-4 hover:bg-cream-deep">
                Switch to {store.viewerId === 'demo-you' ? 'Partner' : 'You'}
              </button>
            )}
            <ul className="mt-4 space-y-2">
              {MENU_ROOMS.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => { setMenuOpen(false); go(r.id); }} className="min-h-11 w-full rounded-2xl border border-cocoa/25 bg-paper px-4 py-2 text-left hover:bg-cream-deep">
                    <span className="font-bold text-cocoa">{r.name}</span>
                    <span className="block text-sm text-cocoa-soft">{r.line}</span>
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" onClick={closeMenu} className="mt-4 min-h-11 w-full rounded-full border border-cocoa/30 bg-paper px-4 py-2 text-sm font-bold text-cocoa hover:bg-cream-deep">Close</button>
          </div>
        </div>
      )}
    </motion.main>
  );
}
