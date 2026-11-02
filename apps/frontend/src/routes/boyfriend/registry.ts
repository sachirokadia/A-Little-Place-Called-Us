// Boyfriend Arcade game registry — adding a future game is one new
// entry here plus one component. The arcade map renders from this
// list, so the arcade itself does not need rewriting per game.
// Existing arcade games (symbol Memory Match, Mini-Mystery, Sample
// Quiz, Trading Board) predate this registry and keep their own
// sections below; these five are the database-backed Boyfriend
// Arcade games.

export type BoyfriendGameEntry = {
  id: string;
  title: string;
  description: string;
  anchor: string;
};

export const BOYFRIEND_GAMES: BoyfriendGameEntry[] = [
  {
    id: 'photo-match',
    title: 'Photo Memory Match',
    description: 'Match pairs built from your real shared photos — or pattern cards when photos are short.',
    anchor: 'game-photo-match',
  },
  {
    id: 'quiz',
    title: 'How Well Do You Know Us?',
    description: 'Questions you both write, stored in the database, with a server-computed score.',
    anchor: 'game-quiz-db',
  },
  {
    id: 'catch-hearts',
    title: 'Catch the Hearts',
    description: 'Tap the hearts before they fade. Thirty seconds, pause when you need it.',
    anchor: 'game-catch-hearts',
  },
  {
    id: 'guess',
    title: 'Guess My Answer',
    description: 'One partner sets a private answer; the other gets exactly one guess.',
    anchor: 'game-guess',
  },
  {
    id: 'chest',
    title: 'Unlock the Chest',
    description: 'Solve riddles in order to open the chest and its reward.',
    anchor: 'game-chest',
  },
];
