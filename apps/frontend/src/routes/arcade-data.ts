// Secret Arcade data — edit the games in this one file.
// All content here is generic sample content. Nothing here refers to a
// real memory, a real event, or a real person: sample mysteries,
// sample quiz questions and generic board places only. Real memories
// are never invented here; the arcade page links to a real memory
// only when the server actually returns one.

export type MatchPair = { symbol: string; label: string };

// Typographic symbols only (no emoji). 8 pairs = 16 cards.
export const MATCH_DECK: MatchPair[] = [
  { symbol: '★', label: 'Star' },
  { symbol: '♦', label: 'Diamond' },
  { symbol: '♠', label: 'Spade' },
  { symbol: '♣', label: 'Clover' },
  { symbol: '♥', label: 'Heart' },
  { symbol: '♪', label: 'Note' },
  { symbol: '☀', label: 'Sun' },
  { symbol: '☾', label: 'Moon' },
];

export type MysteryClue = { id: string; title: string; text: string };

export const MYSTERY_CLUES: MysteryClue[] = [
  {
    id: 'clue-1',
    title: 'Clue 1 — A ticket stub',
    text: 'A sample ticket stub for a fictional night train, found tucked inside a library book. The destination is smudged, but the date is circled: the first Saturday of the month.',
  },
  {
    id: 'clue-2',
    title: 'Clue 2 — A brass key',
    text: 'A small brass key with a paper tag that reads only "cabinet 3". It does not fit any door in the fictional station waiting room — so it must open something smaller.',
  },
  {
    id: 'clue-3',
    title: 'Clue 3 — A torn timetable',
    text: 'Half a timetable, torn along the fold. The surviving half lists one train that stops at every station, and one that skips the town where the ticket stub was found.',
  },
  {
    id: 'clue-4',
    title: 'Clue 4 — A note in the margin',
    text: 'In the margin of the timetable, in pencil: "Not the fast train. The slow one stops where the light is." Nothing else — no name, no date, no signature.',
  },
];

export type MysteryOption = { id: string; text: string };

export const MYSTERY_OPTIONS: MysteryOption[] = [
  { id: 'fast', text: 'The fast train — it left first, so it must have carried the case away.' },
  { id: 'slow', text: 'The slow train — it stops at every station, including the one with the light.' },
  { id: 'cabinet', text: 'Cabinet 3 in the waiting room — the case never left the station at all.' },
  { id: 'library', text: 'The library book itself — the ticket stub was the whole trail, and there is no case.' },
];

export const MYSTERY_SOLUTION_ID = 'slow';

export type QuizQuestion = {
  id: string;
  question: string;
  options: string[];
  // The "matching answer" is a SAMPLE answer, not a fact about any
  // real couple. A question counts as a sample match only when both
  // players pick this sample answer.
  sampleAnswer: string;
};

export const QUIZ_QUESTIONS: QuizQuestion[] = [
  {
    id: 'quiz-1',
    question: 'Sample question: which of these would you pick for a quiet evening?',
    options: ['A board game', 'A walk after dinner', 'A film at home', 'Cooking something new'],
    sampleAnswer: 'A walk after dinner',
  },
  {
    id: 'quiz-2',
    question: 'Sample question: which snack would you reach for first?',
    options: ['Popcorn', 'Fruit', 'Chocolate', 'Crisps'],
    sampleAnswer: 'Popcorn',
  },
  {
    id: 'quiz-3',
    question: 'Sample question: which season do you like best?',
    options: ['Spring', 'Summer', 'Autumn', 'Winter'],
    sampleAnswer: 'Autumn',
  },
  {
    id: 'quiz-4',
    question: 'Sample question: which would you choose for a day out?',
    options: ['A market', 'A museum', 'A beach', 'A forest trail'],
    sampleAnswer: 'A forest trail',
  },
];

export type BoardPlace = { name: string; price: number; rent: number };

// Generic fictional places only — no real addresses, no real venues.
export const BOARD_PLACES: BoardPlace[] = [
  { name: 'Start Square', price: 0, rent: 0 },
  { name: 'Lantern Lane', price: 20, rent: 6 },
  { name: 'Maple Market', price: 30, rent: 9 },
  { name: 'Old Mill Corner', price: 25, rent: 7 },
  { name: 'Harbour Steps', price: 40, rent: 12 },
  { name: 'Juniper Garden', price: 35, rent: 10 },
  { name: 'Clocktower Row', price: 50, rent: 15 },
  { name: 'Willow Bridge', price: 30, rent: 9 },
  { name: 'Paper Star Studio', price: 45, rent: 13 },
  { name: 'Hilltop Lookout', price: 60, rent: 18 },
  { name: 'Cobble Court', price: 25, rent: 7 },
  { name: 'Festival Field', price: 55, rent: 16 },
];

export const BOARD_START_COINS = 150;
export const BOARD_PASS_START_BONUS = 20;

export const UNLOCKABLES = [
  { key: 'golden-star', label: 'Golden star', blurb: 'Won by finishing a game of Memory Match.' },
  { key: 'lantern', label: 'Lantern', blurb: 'Won by solving the sample mini-mystery.' },
  { key: 'banner', label: 'Bunting banner', blurb: 'Won by finishing the sample quiz.' },
  { key: 'pixel-cat', label: 'Pixel cat', blurb: 'Won by winning a trading-board game.' },
  { key: 'pixel-fox', label: 'Pixel fox', blurb: 'Appears once the star, lantern, banner and cat are all unlocked.' },
] as const;

export type UnlockKey = (typeof UNLOCKABLES)[number]['key'];

export const UNLOCK_KEYS: UnlockKey[] = UNLOCKABLES.map((u) => u.key);
