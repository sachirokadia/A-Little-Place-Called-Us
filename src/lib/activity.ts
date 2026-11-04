/* Phase 16 — Gentle shared activity feed (frontend derivation only).
 *
 * The feed is derived from EXISTING saved content through the existing
 * store abstraction. No new table, column, migration, backend call, or
 * notification channel is added. No email or push notification exists
 * in this app, and none is claimed here: the toggles below are in-app
 * feed preferences only.
 *
 * Privacy rules (absolute, mirrored from the store + Letters room):
 * - NEVER a private journal, NEVER a private draft.
 * - NEVER a scheduled/sealed letter before its reveal time — the feed
 *   is deliberately STRICTER than the Letters room here: the Letters
 *   room shows a sealed letter's envelope (title + opens date) to the
 *   partner by design, but the feed omits sealed/scheduled letters
 *   entirely, so it cannot leak even an envelope's existence or timing
 *   into a shared timeline.
 * - NEVER a body: feed entries carry a title/label only, never letter,
 *   journal, memory-story, or appreciation text.
 * - Deleted items are excluded by shared()/visibleLetters() themselves.
 * - Author names resolve through the space members list (never a raw
 *   id). In demo mode the two test profiles are literally named "You"
 *   and "Partner", so the viewer-relative labels below keep the demo
 *   honest: the other test profile reads as "Partner", never as a
 *   real person's name.
 */

import type { PlaceStore } from './store';
import type { Profile } from './types';
import { GAME_TITLES } from './garden';
import { isSealed } from './utils';
import type { GameProgress } from './games';

export type ActivityType = 'memory' | 'letter' | 'plan' | 'appreciation' | 'game';

export interface ActivityEvent {
  key: string;
  type: ActivityType;
  at: string;
  authorId: string;
  authorLabel: string;
  title: string;
  detail: string;
}

export const ACTIVITY_TYPE_LABEL: Record<ActivityType, string> = {
  memory: 'Shared memory',
  letter: 'Shared letter',
  plan: 'Future plan completed',
  appreciation: 'Note saved',
  game: 'Game completed',
};

/** Viewer-relative author label. Never returns a raw id. */
export function feedAuthorLabel(store: PlaceStore, authorId: string, storedName: string): string {
  if (store.mode === 'demo') return authorId === store.viewerId ? 'You' : 'Partner';
  const member: Profile | undefined = store.data.members.find((m) => m.id === authorId);
  if (member?.displayName) return member.displayName;
  return storedName || 'A member of this space';
}

export function deriveActivity(store: PlaceStore, gameProgress: GameProgress[]): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  for (const m of store.shared(store.data.memories)) {
    events.push({
      key: `memory-${m.id}`, type: 'memory', at: m.createdAt, authorId: m.authorId,
      authorLabel: feedAuthorLabel(store, m.authorId, m.authorName),
      title: m.title, detail: 'Added to the Memory Wall',
    });
  }
  // Shared + unsealed only. Private drafts are filtered by
  // visibleLetters(); scheduled/sealed letters are excluded here even
  // though their envelope is visible in the Letters room (see header).
  for (const l of store.visibleLetters().filter((x) => x.visibility === 'shared' && !isSealed(x, store.viewerId))) {
    events.push({
      key: `letter-${l.id}`, type: 'letter', at: l.createdAt, authorId: l.authorId,
      authorLabel: feedAuthorLabel(store, l.authorId, l.authorName),
      title: l.title, detail: 'Arrived in Letters',
    });
  }
  for (const p of store.shared(store.data.plans).filter((x) => x.status === 'done')) {
    events.push({
      key: `plan-${p.id}`, type: 'plan', at: p.completedAt || p.updatedAt, authorId: p.authorId,
      authorLabel: feedAuthorLabel(store, p.authorId, p.authorName),
      title: p.title, detail: 'Completed in Our Future',
    });
  }
  for (const a of store.shared(store.data.appreciations)) {
    events.push({
      key: `appreciation-${a.id}`, type: 'appreciation', at: a.createdAt, authorId: a.authorId,
      authorLabel: feedAuthorLabel(store, a.authorId, a.authorName),
      // Title only: the note's words stay in Things I See in You.
      title: `A note for ${a.forName}`, detail: 'Saved in Things I See in You',
    });
  }
  for (const g of gameProgress.filter((x) => x.completed)) {
    events.push({
      key: `game-${g.id}`, type: 'game', at: g.updatedAt, authorId: g.userId,
      authorLabel: feedAuthorLabel(store, g.userId, g.userName),
      title: GAME_TITLES[g.gameKey] ?? g.gameKey, detail: 'Completed in the Game Arcade',
    });
  }
  return events.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 50);
}

// ---------- in-app feed preferences (localStorage, this device only) ----------

export interface ActivityPrefs {
  enabled: boolean;
  types: Record<ActivityType, boolean>;
}

export const ACTIVITY_PREFS_KEY = 'our-place-activity-prefs-v1';

export const DEFAULT_ACTIVITY_PREFS: ActivityPrefs = {
  enabled: true,
  types: { memory: true, letter: true, plan: true, appreciation: true, game: true },
};

export function readActivityPrefs(): ActivityPrefs {
  try {
    const raw = localStorage.getItem(ACTIVITY_PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ActivityPrefs>;
      if (parsed && typeof parsed.enabled === 'boolean' && parsed.types) {
        return { enabled: parsed.enabled, types: { ...DEFAULT_ACTIVITY_PREFS.types, ...parsed.types } };
      }
    }
  } catch { /* fall through to defaults */ }
  return { ...DEFAULT_ACTIVITY_PREFS, types: { ...DEFAULT_ACTIVITY_PREFS.types } };
}

export function saveActivityPrefs(prefs: ActivityPrefs): void {
  try { localStorage.setItem(ACTIVITY_PREFS_KEY, JSON.stringify(prefs)); } catch { /* private mode */ }
}

// ---------- device-local profile extras (model gaps, NOT shared) ----------

/* The profile model has no description and no favourite colour (see
 * Profile in lib/types.ts: id, displayName, shortName, avatar only).
 * These two fields are therefore stored per device, per profile id,
 * and labelled everywhere as visible on this device only. They are
 * never written into a shared field and never presented as something
 * the partner can see. A backend migration would be needed to share
 * them; that is a Phase 10-plan item, not something this phase fakes. */

export interface DeviceProfileExtras {
  description: string;
  colour: string;
}

export const DEVICE_PROFILE_KEY = 'our-place-device-profile-v1';

export const DEVICE_COLOURS = [
  { key: 'sage', label: 'Sage green', hex: '#8fa98f' },
  { key: 'rose', label: 'Rose', hex: '#d49a9a' },
  { key: 'butter', label: 'Butter yellow', hex: '#e3c878' },
  { key: 'powder', label: 'Powder blue', hex: '#9ab8c9' },
  { key: 'plum', label: 'Plum', hex: '#9a7aa8' },
] as const;

export function readDeviceProfileExtras(profileId: string): DeviceProfileExtras {
  try {
    const raw = localStorage.getItem(DEVICE_PROFILE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, DeviceProfileExtras>;
      const entry = parsed?.[profileId];
      if (entry) return { description: entry.description || '', colour: entry.colour || '' };
    }
  } catch { /* fall through */ }
  return { description: '', colour: '' };
}

export function saveDeviceProfileExtras(profileId: string, extras: DeviceProfileExtras): void {
  try {
    const raw = localStorage.getItem(DEVICE_PROFILE_KEY);
    const parsed = (raw ? JSON.parse(raw) : {}) as Record<string, DeviceProfileExtras>;
    parsed[profileId] = extras;
    localStorage.setItem(DEVICE_PROFILE_KEY, JSON.stringify(parsed));
  } catch { /* private mode */ }
}
