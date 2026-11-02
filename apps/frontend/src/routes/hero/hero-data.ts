// The Rooftop Adventure — data only, no gameplay logic here.
//
// ORIGINAL adventure: the protagonist, city, missions, and final
// message below are all invented for this little place. Nothing here
// names, quotes, or pictures any official superhero property, and no
// personal names, dates, or real history appear anywhere — the
// generic missions and final message are labelled as samples until
// the partners write their own.
//
// Contract (backend worker, in parallel):
//   Levels: 'rooftop-row', 'market-lane', 'harbour-lights'.
//   GameProgress (gameKey 'hero-adventure'):
//     { levelsCompleted: string[], tokensCollected: number (0-15),
//       adventureCompleted: boolean (true only when all 3 levels
//       are completed) }. 5 tokens per level, 15 total.
//   Missions: GET /spaces/:spaceId/hero-missions returns
//     { id, levelId, title, clue, rewardMessage, authorId } plus,
//     when a reward links a real item, rewardMemoryId /
//     rewardLetterId / rewardAppreciationId. If that GET fails or
//     returns no missions for a level, the generic samples below
//     are shown instead, clearly labelled as generic samples.

export const LEVEL_IDS = ['rooftop-row', 'market-lane', 'harbour-lights'] as const;
export type LevelId = (typeof LEVEL_IDS)[number];

export type LevelMeta = {
  id: LevelId;
  name: string;
  accent: string;
  skyTop: string;
  skyBottom: string;
  ground: string;
  blurb: string;
};

export const LEVELS: LevelMeta[] = [
  {
    id: 'rooftop-row',
    name: 'Rooftop Row',
    accent: '#c94f4f',
    skyTop: '#fde8d7',
    skyBottom: '#fbe9c9',
    ground: '#8a5a3b',
    blurb: 'Hop across the rooftops at sunset. Watch for the gap in the street below.',
  },
  {
    id: 'market-lane',
    name: 'Market Lane',
    accent: '#2f7d6b',
    skyTop: '#e2f2e6',
    skyBottom: '#fdf3d0',
    ground: '#7a6a4f',
    blurb: 'Weave between the market stalls. The awnings make handy steps.',
  },
  {
    id: 'harbour-lights',
    name: 'Harbour Lights',
    accent: '#3b5f9e',
    skyTop: '#dbe7f7',
    skyBottom: '#f6e3c8',
    ground: '#5a5a72',
    blurb: 'Cross the harbour walk as the lamps come on. Mind the gap in the pier.',
  },
];

// Canvas world: 720 x 400 logical pixels. Platforms are solid tops
// the hero lands on (AABB landing check); ground segments leave one
// pit gap per level, and falling into it respawns the hero at the
// last checkpoint with tokens already collected kept.
export type Rect = { x: number; y: number; w: number; h: number };
export type TokenSpot = { x: number; y: number };
export type AnchorSpot = { x: number; y: number };
export type SignSpot = { x: number; missionIndex: number };

export type LevelLayout = {
  ground: Rect[];
  platforms: Rect[];
  tokens: TokenSpot[];
  anchors: AnchorSpot[];
  signs: SignSpot[];
  checkpointX: number;
  finishX: number;
  startX: number;
};

const GROUND_Y = 356;

export const LEVEL_LAYOUTS: Record<LevelId, LevelLayout> = {
  'rooftop-row': {
    ground: [
      { x: 0, y: GROUND_Y, w: 300, h: 44 },
      { x: 360, y: GROUND_Y, w: 360, h: 44 },
    ],
    platforms: [
      { x: 90, y: 280, w: 110, h: 14 },
      { x: 230, y: 220, w: 110, h: 14 },
      { x: 420, y: 270, w: 110, h: 14 },
      { x: 560, y: 210, w: 110, h: 14 },
    ],
    tokens: [
      { x: 140, y: 250 },
      { x: 280, y: 190 },
      { x: 470, y: 240 },
      { x: 610, y: 180 },
      { x: 650, y: 322 },
    ],
    anchors: [
      { x: 180, y: 240 },
      { x: 470, y: 230 },
      { x: 610, y: 170 },
    ],
    signs: [
      { x: 60, missionIndex: 0 },
      { x: 440, missionIndex: 1 },
    ],
    checkpointX: 380,
    finishX: 685,
    startX: 20,
  },
  'market-lane': {
    ground: [
      { x: 0, y: GROUND_Y, w: 260, h: 44 },
      { x: 320, y: GROUND_Y, w: 400, h: 44 },
    ],
    platforms: [
      { x: 60, y: 280, w: 100, h: 14 },
      { x: 200, y: 220, w: 100, h: 14 },
      { x: 380, y: 280, w: 110, h: 14 },
      { x: 540, y: 220, w: 110, h: 14 },
    ],
    tokens: [
      { x: 105, y: 250 },
      { x: 245, y: 190 },
      { x: 430, y: 250 },
      { x: 590, y: 190 },
      { x: 680, y: 322 },
    ],
    anchors: [
      { x: 150, y: 240 },
      { x: 430, y: 240 },
      { x: 590, y: 180 },
    ],
    signs: [
      { x: 40, missionIndex: 0 },
      { x: 400, missionIndex: 1 },
    ],
    checkpointX: 360,
    finishX: 690,
    startX: 20,
  },
  'harbour-lights': {
    ground: [
      { x: 0, y: GROUND_Y, w: 280, h: 44 },
      { x: 340, y: GROUND_Y, w: 380, h: 44 },
    ],
    platforms: [
      { x: 80, y: 270, w: 110, h: 14 },
      { x: 240, y: 210, w: 110, h: 14 },
      { x: 410, y: 270, w: 110, h: 14 },
      { x: 560, y: 200, w: 110, h: 14 },
    ],
    tokens: [
      { x: 130, y: 240 },
      { x: 290, y: 180 },
      { x: 460, y: 240 },
      { x: 610, y: 170 },
      { x: 665, y: 322 },
    ],
    anchors: [
      { x: 180, y: 230 },
      { x: 460, y: 230 },
      { x: 610, y: 160 },
    ],
    signs: [
      { x: 50, missionIndex: 0 },
      { x: 420, missionIndex: 1 },
    ],
    checkpointX: 370,
    finishX: 690,
    startX: 20,
  },
};

// Missions: the shape the backend missions API returns, plus the
// optional reward links it may attach. A reward link never gates
// the item — the memory, letter, or appreciation stays open from
// its own room whether or not the game is played.
export type HeroMission = {
  id: string;
  levelId: string;
  title: string;
  clue: string;
  rewardMessage: string;
  authorId: string;
  rewardMemoryId?: string;
  rewardLetterId?: string;
  rewardAppreciationId?: string;
};

export type GenericMission = { title: string; clue: string; rewardMessage: string };

export const GENERIC_MISSIONS: Record<LevelId, GenericMission[]> = {
  'rooftop-row': [
    {
      title: 'First light',
      clue: 'Climb to the highest rooftop and look for the token that catches the last light.',
      rewardMessage: 'Sample reward: you made it across the rooftops — take a quiet moment together.',
    },
    {
      title: 'Mind the gap',
      clue: 'The street dips in the middle. Jump it cleanly, then wave the checkpoint flag.',
      rewardMessage: 'Sample reward: a clean jump over the gap deserves a small celebration.',
    },
  ],
  'market-lane': [
    {
      title: 'Stall to stall',
      clue: 'Step from awning to awning without touching the lane below.',
      rewardMessage: 'Sample reward: the market is yours — pick a favourite stall to remember.',
    },
    {
      title: 'The last token',
      clue: 'One token waits near the end of the lane, close to the finish flag.',
      rewardMessage: 'Sample reward: you found every token in the lane. Well wandered.',
    },
  ],
  'harbour-lights': [
    {
      title: 'Lamps on',
      clue: 'Follow the lamps along the pier until the checkpoint flag.',
      rewardMessage: 'Sample reward: the harbour lights are on, and so is the way home.',
    },
    {
      title: 'Over the water',
      clue: 'Jump the gap in the pier, then finish beneath the last lamp.',
      rewardMessage: 'Sample reward: across the water, together, without a splash.',
    },
  ],
};

// ONE generic, clearly-labelled sample final message. No invented
// names, dates, or personal history: the author personalises it
// later. It is readable from the intro/map screen without playing.
export const GENERIC_FINAL_MESSAGE: string[] = [
  'You walked every street of this little city together, one rooftop, one market lane, and one harbour walk at a time.',
  'Nothing here was a race. The tokens were small reminders to look around, and the flags were places to pause and catch your breath.',
  'This message is only a draft, a placeholder for the words the author will write one day. Until then, it simply says: thank you for playing, and for keeping this little place.',
];

export type HeroProgress = {
  levelsCompleted: string[];
  tokensCollected: number;
  adventureCompleted: boolean;
};

export const EMPTY_HERO_PROGRESS: HeroProgress = {
  levelsCompleted: [],
  tokensCollected: 0,
  adventureCompleted: false,
};

export function parseHeroProgress(raw: unknown): HeroProgress {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_HERO_PROGRESS };
  const p = raw as Record<string, unknown>;
  const levels = Array.isArray(p.levelsCompleted)
    ? p.levelsCompleted.filter((l): l is string => typeof l === 'string' && (LEVEL_IDS as readonly string[]).includes(l))
    : [];
  const tokens = typeof p.tokensCollected === 'number' && Number.isFinite(p.tokensCollected)
    ? Math.min(15, Math.max(0, Math.floor(p.tokensCollected)))
    : 0;
  // adventureCompleted is true only when all 3 levels are completed,
  // whatever the stored flag said.
  return {
    levelsCompleted: [...new Set(levels)],
    tokensCollected: tokens,
    adventureCompleted: LEVEL_IDS.every((id) => levels.includes(id)),
  };
}
