/* Phase 17 — Unsaved-change guard, one slot, hash-routing aware.
 *
 * A room with unsaved text registers ONE combined guard describing
 * all of its dirty forms; App's go() and its hashchange listener ask
 * attemptLeave() before navigating. If the user cancels the confirm
 * dialog, navigation does not happen and the text stays (the room is
 * still mounted, its state untouched). If the user confirms, discard()
 * runs (fields cleared, modals closed) and navigation proceeds — on
 * navigation the room unmounts anyway, so discard is belt-and-braces.
 *
 * Explicit Save / explicit Cancel inside a form are intentional
 * actions and do NOT go through the guard: the guard covers leaving
 * the room (room nav, Back to cottage, browser back/forward) and
 * closing a creation/edit modal (X, backdrop, modal Cancel button).
 * The Quiet Room journal is deliberately NOT guarded: it autosaves a
 * device-local draft on every keystroke and restores it, so leaving
 * mid-sentence loses nothing — guarding it would double-protect a
 * solved problem. Arcade custom-case/question/riddle editors are not
 * guarded (remaining gap, reported): they are inline editors with
 * explicit save buttons, not text forms in the guarded set. */

import { useEffect } from 'react';

export interface DirtyGuard {
  /** Human label for the confirm dialog, e.g. "a letter you are writing". */
  label: string;
  isDirty: () => boolean;
  discard: () => void;
}

let current: DirtyGuard | null = null;

export function registerDirtyGuard(g: DirtyGuard | null): void {
  current = g;
}

/** True = safe to leave (nothing dirty, or user confirmed discard). */
export function attemptLeave(): boolean {
  const g = current;
  if (!g || !g.isDirty()) return true;
  const ok = window.confirm(`You have unsaved words in ${g.label}. Leave and discard them?`);
  if (ok) {
    try { g.discard(); } catch { /* navigation unmounts anyway */ }
    return true;
  }
  return false;
}

/** Register `guard` while `dirty` is true; unregister when clean/unmounted.
 * Deliberately no dependency array: the guard object is a fresh literal
 * every render, and its isDirty/discard closures capture that render's
 * values. Re-registering after every render keeps the stored guard
 * fresh (a [dirty]-only effect would leave a stale guard registered
 * after the user typed back to a clean state, because the cleanup
 * compares against a different object identity). */
export function useDirtyGuard(dirty: boolean, guard: DirtyGuard): void {
  useEffect(() => {
    if (dirty) registerDirtyGuard(guard);
    else if (current === guard) registerDirtyGuard(null);
    return () => { if (current === guard) registerDirtyGuard(null); };
  });
}
