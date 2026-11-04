/**
 * Phase 14 — small pure rule helpers extracted from arcade UI.
 * These are presentation rules only; scoring, answers and progress
 * still go through games.ts / detective.ts. No behaviour is changed
 * by the extraction except Catch the Hearts' spawn interval, which
 * Phase 14 deliberately makes faster as the round goes on (see
 * catchSpawnIntervalMs) — that is the requested increasing
 * difficulty, stated here so it is not mistaken for a refactor.
 */

/** Memory Match board-size label: the pairs count already existed;
 *  this only names it, so the settings read as difficulties. */
export function memoryDifficultyLabel(pairs: number): string {
  if (pairs <= 4) return 'Easy';
  if (pairs <= 6) return 'Cosy';
  return 'Grand';
}

/** Catch the Hearts spawn interval in ms. Hearts and star tokens
 *  appear faster as the 30-second round goes on: gentle, then
 *  brisker, then quickest. secondsElapsed is 0..30. */
export function catchSpawnIntervalMs(secondsElapsed: number): number {
  if (secondsElapsed < 10) return 800;
  if (secondsElapsed < 20) return 650;
  return 500;
}

/** Catch the Hearts difficulty label for the same bands. */
export function catchDifficultyLabel(secondsElapsed: number): string {
  if (secondsElapsed < 10) return 'Gentle';
  if (secondsElapsed < 20) return 'Brisker';
  return 'Quickest';
}
