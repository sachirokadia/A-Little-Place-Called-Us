/**
 * Phase 14 — Secret Detective Mission: pure rules and sample cases.
 *
 * This file holds NO UI and NO store access, so the mission's rules can
 * be read and tested without rendering anything. Answer checking is
 * CLIENT-SIDE ONLY: it normalises with the same rule as games.ts
 * (lower-case, strip punctuation, collapse spaces) but there is no
 * server validation behind it — see the engine/security notes in
 * Arcade.tsx. Never present a detective result as server-validated.
 *
 * Privacy: a case is plain config text. It never reads memories,
 * letters, journals, appreciations or plans, so it cannot surface a
 * private journal, a private draft, a sealed letter, or a scheduled
 * letter before reveal. Custom cases are shared with the partner by
 * design (they live in the shared game config), and the editor says so.
 *
 * Samples: both built-in cases are labelled SAMPLE in the UI and in
 * the data (sample: true). They are invented cosy mysteries, not
 * shared relationship memories, and they use no real user content.
 * No photograph, person or text is copied from any reference image;
 * the "photographs" in a case are written descriptions of illustrated
 * cards (a pinned illustration, a sketch), never real photos.
 * Nothing violent or grim: the mysteries are a missing teapot and a
 * misplaced key, solved by following a trail, not by any harm.
 *
 * Cottage symbol: the brass star is NOT invented here. The arcade
 * already uses a star as its collectible token (HeroAdventure tokens,
 * Memory Match pattern cards, the Phase 11/13 arcade motifs and the
 * pixel road). The detective cases reuse that existing star token
 * as a trail marker — a small brass star left along the way.
 */

export interface DetectiveEvidence {
  id: string;
  title: string;
  detail: string;
  clue: string;
}

export interface DetectiveRiddle {
  id: string;
  question: string;
  answer: string;
  hint: string;
}

export interface DetectiveBoardLink {
  clue: string;
  conclusion: string;
}

export interface DetectiveCase {
  id: string;
  title: string;
  intro: string;
  hint: string;
  evidence: DetectiveEvidence[];
  riddles: DetectiveRiddle[];
  links: DetectiveBoardLink[];
  distractors: string[];
  ending: string;
  surprise: string;
  sample: boolean;
}

export interface DetectiveConfig {
  cases: DetectiveCase[];
}

/** Per-case, per-viewer progress. Persisted in this browser only (see
 *  loadDetectiveProgress / saveDetectiveProgress): in demo mode that is
 *  the same localStorage the other game data uses; in a synced space
 *  it does NOT travel to the partner's device — each partner keeps
 *  their own in-progress case, which is also what stops one partner
 *  overwriting the other's half-solved case. A completed case is
 *  recorded separately through the existing game-progress path. */
export interface DetectiveProgress {
  collected: string[];
  solvedRiddles: string[];
  boardAnswers: Record<number, string>;
  completed: boolean;
}

export type DetectiveProgressMap = Record<string, DetectiveProgress>;

export function emptyProgress(): DetectiveProgress {
  return { collected: [], solvedRiddles: [], boardAnswers: {}, completed: false };
}

/** Same normalisation rule as games.normaliseAnswer, kept local so
 *  this module has no import cycle with games.ts. */
export function normaliseDetectiveAnswer(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ');
}

export function riddleCorrect(riddle: DetectiveRiddle, guess: string): boolean {
  return normaliseDetectiveAnswer(guess) === normaliseDetectiveAnswer(riddle.answer);
}

export function boardLinkCorrect(link: DetectiveBoardLink, answer: string): boolean {
  return normaliseDetectiveAnswer(answer) === normaliseDetectiveAnswer(link.conclusion);
}

/** Board options for a case: every true conclusion plus the case's
 *  distractors, in case order (the UI shuffles presentation per render
 *  is avoided — a stable order keeps keyboard play predictable). */
export function boardOptions(c: DetectiveCase): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of [...c.links.map((l) => l.conclusion), ...c.distractors]) {
    const k = normaliseDetectiveAnswer(s);
    if (s.trim() && !seen.has(k)) { seen.add(k); out.push(s); }
  }
  return out;
}

export function caseComplete(c: DetectiveCase, p: DetectiveProgress): boolean {
  const allClues = c.evidence.every((e) => p.collected.includes(e.id));
  const allRiddles = c.riddles.every((r) => p.solvedRiddles.includes(r.id));
  const boardOk = c.links.every((l, i) => boardLinkCorrect(l, p.boardAnswers[i] ?? ''));
  return allClues && allRiddles && boardOk;
}

export function caseProgressLabel(c: DetectiveCase, p: DetectiveProgress): string {
  const clues = c.evidence.filter((e) => p.collected.includes(e.id)).length;
  const riddles = c.riddles.filter((r) => p.solvedRiddles.includes(r.id)).length;
  const board = c.links.filter((l, i) => boardLinkCorrect(l, p.boardAnswers[i] ?? '')).length;
  return `${clues}/${c.evidence.length} clues · ${riddles}/${c.riddles.length} riddles · ${board}/${c.links.length} board links`;
}

const STAR_CLUE = 'A small brass star — the arcade\u2019s own star token — left as a trail marker. Whoever passed this way wanted the trail to be followed, not feared.';

export const DEFAULT_DETECTIVE: DetectiveConfig = {
  cases: [
    {
      id: 'case-teapot',
      title: 'The Case of the Missing Teapot',
      intro: 'Saturday morning, and the teapot that always sits on the kitchen shelf is gone. Nobody is upset — but everybody is curious. Follow the trail, collect the clues, solve the riddles, and connect it all on the investigation board. Sample case: an invented cosy mystery, not a real memory.',
      hint: 'Start in the kitchen, then follow the footprints. Nothing here is hidden to trick you — every clue is in plain sight once you look.',
      evidence: [
        { id: 'e-note', title: 'A note on the kitchen table', detail: 'A handwritten note in looping letters, left beside two empty cups.', clue: 'The note says: \u201cBorrowed for the garden tea — back by sunset.\u201d Someone borrowed the teapot on purpose, and meant to bring it back.' },
        { id: 'e-star', title: 'A small brass star on the windowsill', detail: 'A little brass star, just like the star tokens collected in the arcade, sitting where the light catches it.', clue: STAR_CLUE },
        { id: 'e-footprints', title: 'Muddy footprints by the back door', detail: 'A cheerful trail of small muddy prints across the kitchen floor, heading out — not away.', clue: 'The footprints lead to the garden shed, not out of the gate. The trail ends inside your own garden.' },
        { id: 'e-shed', title: 'A pinned illustration of the garden shed', detail: 'An illustrated card pinned to the clue board: the shed with its door ajar, a thin curl of steam rising from inside.', clue: 'The shed door is ajar, and steam curls from inside. Something warm is waiting in there.' },
      ],
      riddles: [
        { id: 'r-teapot', question: 'I whistle when I am happy and pour when I am tipped. I live on the kitchen shelf. What am I?', answer: 'a teapot', hint: 'It holds the tea.' },
        { id: 'r-shed', question: 'I am made of wood, I keep out the rain, and I hide the best tea parties. What am I?', answer: 'a shed', hint: 'The footprints lead here.' },
      ],
      links: [
        { clue: 'The borrowed-teapot note', conclusion: 'Someone borrowed the teapot on purpose, and meant to bring it back.' },
        { clue: 'The brass star on the sill', conclusion: 'The star marks the trail — follow it, do not fear it.' },
        { clue: 'The footprints and the shed illustration', conclusion: 'The trail ends at the shed, inside your own garden.' },
      ],
      distractors: ['Someone took the teapot away for good.', 'The teapot was never in the kitchen at all.'],
      ending: 'Case closed: the teapot was in the garden shed all along, keeping warm for a surprise tea party. Whoever borrowed it had set out cups, a blanket, and a second chair — for you.',
      surprise: 'Surprise ending: make a pot of tea together this evening. The case file insists.',
      sample: true,
    },
    {
      id: 'case-key',
      title: 'The Case of the Vanishing Library Key',
      intro: 'The little key to the shared library box — the one that holds the books you lend each other — has vanished from its hook by the door. No drama, just a mystery: where do small important things go when nobody is looking? Sample case: an invented cosy mystery, not a real memory.',
      hint: 'Check the places a key would hide if it wanted a nap: pockets, pages, and anywhere warm.',
      evidence: [
        { id: 'e-bookmark', title: 'A bookmark in yesterday\u2019s book', detail: 'A ribbon bookmark, still marking the page where reading stopped last night.', clue: 'The bookmark is in a chapter about a lighthouse keeper. The reader stopped mid-chapter — in a hurry, or mid-thought.' },
        { id: 'e-star2', title: 'A brass star tucked into the bookmark', detail: 'Another little brass star, the arcade\u2019s trail marker, tucked where the ribbon meets the page.', clue: STAR_CLUE },
        { id: 'e-pocket', title: 'A coat pocket, turned out', detail: 'The pocket of the coat worn on yesterday\u2019s walk, turned inside out for inspection.', clue: 'The pocket is empty — but it smells faintly of rain and old paper. The key was here, and then it was not.' },
        { id: 'e-cushion', title: 'A cushion with a suspicious dent', detail: 'The reading chair\u2019s cushion, dented on one side as if something small slipped down beside it.', clue: 'Something small and metal-shaped has been resting down the side of the cushion. Look there, not under it.' },
      ],
      riddles: [
        { id: 'r-key', question: 'I am small, I open things, and I am always lost exactly when you need me most. What am I?', answer: 'a key', hint: 'It fits the library box.' },
        { id: 'r-book', question: 'I have pages but no voice, and I remember every story you leave inside me. What am I?', answer: 'a book', hint: 'The bookmark lives in one.' },
      ],
      links: [
        { clue: 'The bookmark and the brass star', conclusion: 'The trail starts where reading stopped last night.' },
        { clue: 'The empty coat pocket', conclusion: 'The key travelled on yesterday\u2019s walk, then came home.' },
        { clue: 'The dented cushion', conclusion: 'The key slipped down the side of the reading chair.' },
      ],
      distractors: ['The key was thrown away by mistake.', 'The library box was never locked at all.'],
      ending: 'Case closed: the key was down the side of the reading chair all along, keeping the bookmark company. The library box opens again — and the lighthouse keeper finally gets to finish his chapter.',
      surprise: 'Surprise ending: read one chapter together tonight, out loud if you like. The case file insists.',
      sample: true,
    },
  ],
};

const DETECTIVE_LOCAL_KEY = 'our-place-detective-progress-v1';

export function detectiveLocalKey(spaceId: string, viewerId: string): string {
  return `${DETECTIVE_LOCAL_KEY}:${spaceId}:${viewerId}`;
}

export function loadDetectiveProgress(spaceId: string, viewerId: string): DetectiveProgressMap {
  try {
    const raw = localStorage.getItem(detectiveLocalKey(spaceId, viewerId));
    if (raw) {
      const parsed = JSON.parse(raw) as DetectiveProgressMap;
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch { /* fall through */ }
  return {};
}

export function saveDetectiveProgress(spaceId: string, viewerId: string, map: DetectiveProgressMap): void {
  try { localStorage.setItem(detectiveLocalKey(spaceId, viewerId), JSON.stringify(map)); } catch { /* ignore */ }
}

export function validateDetectiveCase(c: DetectiveCase): string | null {
  if (!c.title.trim()) return 'A case needs a title.';
  if (!c.intro.trim()) return 'A case needs an introduction.';
  if (c.evidence.length < 1) return 'A case needs at least one piece of evidence.';
  if (c.evidence.some((e) => !e.title.trim() || !e.clue.trim())) return 'Every piece of evidence needs a title and a clue.';
  if (c.riddles.length < 1) return 'A case needs at least one riddle.';
  if (c.riddles.some((r) => !r.question.trim() || !r.answer.trim())) return 'Every riddle needs a question and an answer.';
  if (c.links.length < 1) return 'A case needs at least one board link.';
  if (c.links.some((l) => !l.clue.trim() || !l.conclusion.trim())) return 'Every board link needs a clue and a conclusion.';
  if (!c.ending.trim()) return 'A case needs an ending.';
  return null;
}
