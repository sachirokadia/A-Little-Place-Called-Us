import type { PlaceStore } from './store';
import type { CollectionName, RoomId } from './types';
import { isSealed } from './utils';

/* Phase 13 — Living Cottage derivations.
   Pure functions of SAVED content only, through the existing store
   abstraction (store.shared / store.visibleLetters / loadGameData).
   No new model, no new storage key, no timer, no random element, no
   Supabase/Express call of any kind. The same saved content therefore
   renders the same cottage from any backend that serves it — that is
   the whole sync design; cross-device sync itself is NOT claimed here
   (demo mode is device-local localStorage by design).
   Privacy: journals and voice notes are never read here. Letters are
   read only through visibleLetters() and then restricted further to
   visibility === 'shared' with isSealed() false, so a private draft,
   a scheduled letter before reveal, and a sealed letter can never
   produce a garden element, a keepsake, a title, or a count. Deleted
   items are excluded by shared()/visibleLetters() themselves, so
   deleting (or unfavouriting, or un-completing) a source item removes
   its derived element on the next render — nothing is stored
   separately to go stale. */

export const GAME_TITLES: Record<string, string> = {
  memory: 'Memory Match',
  quiz: 'How Well Do You Know Us?',
  catch: 'Catch the Hearts',
  guess: 'Guess My Answer',
  chest: 'Unlock the Chest',
  hero: "A Hero's City",
  board: 'Our Little World',
};

export interface GardenOrnament {
  sourceId: string;
  glyph: string;
  label: string;
}
export interface GardenMilestone {
  key: string;
  label: string;
  detail: string;
}

const byCreated = (a: { createdAt: string }, b: { createdAt: string }) => a.createdAt.localeCompare(b.createdAt);

export function deriveGarden(store: PlaceStore): { ornaments: GardenOrnament[]; milestones: GardenMilestone[] } {
  const donePlans = store.shared(store.data.plans).filter((p) => p.status === 'done').sort(byCreated);
  const planGlyph = (category: string) => (category === 'bucket' ? '⛺' : category === 'date' ? '♥' : '⚑');
  const ornaments: GardenOrnament[] = [
    ...donePlans.slice(0, 6).map((p) => ({ sourceId: p.id, glyph: planGlyph(p.category), label: `Completed plan: ${p.title}` })),
    ...store.shared(store.data.appreciations).filter((a) => a.isFavorite).sort(byCreated).slice(0, 4)
      .map((a) => ({ sourceId: a.id, glyph: '✧', label: `Favourited appreciation for ${a.forName}` })),
    ...store.shared(store.data.reminders).filter((r) => r.isFavorite).sort(byCreated).slice(0, 2)
      .map((r) => ({ sourceId: r.id, glyph: '✦', label: 'Pinned favourite note' })),
  ].slice(0, 12);

  const milestones: GardenMilestone[] = [];
  const memories = store.shared(store.data.memories).slice().sort((a, b) => (a.happenedOn || a.createdAt).localeCompare(b.happenedOn || b.createdAt));
  if (memories.length > 0) milestones.push({ key: 'first-memory', label: '★ First shared memory', detail: memories[0].title });
  const completed = donePlans.slice().sort((a, b) => (a.completedAt || '').localeCompare(b.completedAt || ''));
  if (completed.length > 0) milestones.push({ key: 'first-completed', label: '⚑ First adventure completed', detail: completed[0].title });
  if (completed.length >= 5) milestones.push({ key: 'five-completed', label: '✦ Five adventures completed', detail: `${completed.length} plans completed` });
  return { ornaments, milestones };
}

export interface Keepsake {
  key: string;
  category: string;
  title: string;
  detail: string;
  authorName: string;
  sourceRoom: RoomId;
  sourceRoomName: string;
  collection: CollectionName | null;
  sourceId: string | null;
  canUnfavourite: boolean;
  /* Phase 17 — the item's OWN date, never a fabricated "saved on"
   * date: the model has no favourited-at timestamp (see Keepsakes
   * room text). Memory date = happenedOn; plan date = completedAt
   * (else createdAt); everything else = createdAt; games = null
   * (no item date exists for a completed game). */
  itemDate: string | null;
  itemDateLabel: string;
}

/* Keepsake Box aggregation. Entry rule is explicit choice only:
   favourited shared items, favourited + done plans, and distinct
   completed arcade games (completing a game is itself the explicit
   act). Favourited memories carrying a photo are flagged as
   "special photographs" inside their memory entry, not duplicated.
   Excluded, always, with the reason stated in the room: private
   drafts, scheduled letters before reveal, sealed letters, journals,
   and voice notes — none of these can be permission-filtered into a
   shared box safely from existing fields without risking a leak, and
   journals/voice notes are author-only by design. */
export function deriveKeepsakes(store: PlaceStore, arcadeKeys: string[]): Keepsake[] {
  const out: Keepsake[] = [];
  for (const m of store.shared(store.data.memories).filter((i) => i.isFavorite).sort(byCreated)) {
    out.push({
      key: `memory:${m.id}`, category: m.mediaUrl ? 'Special photograph' : 'Favourite memory',
      title: m.title, detail: m.caption || m.story || '', authorName: m.authorName,
      sourceRoom: 'memories', sourceRoomName: 'Memory Wall', collection: 'memories', sourceId: m.id, canUnfavourite: true,
      itemDate: m.happenedOn || m.createdAt, itemDateLabel: 'Memory date',
    });
  }
  for (const l of store.visibleLetters().filter((i) => i.isFavorite && i.visibility === 'shared' && !isSealed(i, store.viewerId)).sort(byCreated)) {
    out.push({
      key: `letter:${l.id}`, category: 'Shared letter', title: l.title, detail: '',
      authorName: l.authorName, sourceRoom: 'letters', sourceRoomName: 'Letters',
      collection: 'letters', sourceId: l.id, canUnfavourite: true,
      itemDate: l.createdAt, itemDateLabel: 'Letter date',
    });
  }
  for (const a of store.shared(store.data.appreciations).filter((i) => i.isFavorite).sort(byCreated)) {
    out.push({
      key: `appreciation:${a.id}`, category: 'Appreciation note', title: a.text.length > 60 ? `${a.text.slice(0, 60)}…` : a.text,
      detail: `For ${a.forName} · ${a.kind}`, authorName: a.authorName,
      sourceRoom: 'appreciations', sourceRoomName: 'Things I See in You', collection: 'appreciations', sourceId: a.id, canUnfavourite: true,
      itemDate: a.createdAt, itemDateLabel: 'Note date',
    });
  }
  for (const r of store.shared(store.data.reminders).filter((i) => i.isFavorite).sort(byCreated)) {
    out.push({
      key: `reminder:${r.id}`, category: 'Pinned note', title: r.text.length > 60 ? `${r.text.slice(0, 60)}…` : r.text,
      detail: '', authorName: r.authorName, sourceRoom: 'reminders', sourceRoomName: 'Reminder Room',
      collection: 'reminders', sourceId: r.id, canUnfavourite: true,
      itemDate: r.createdAt, itemDateLabel: 'Note date',
    });
  }
  for (const p of store.shared(store.data.plans).filter((i) => i.isFavorite && i.status === 'done').sort(byCreated)) {
    out.push({
      key: `plan:${p.id}`, category: 'Completed adventure', title: p.title, detail: p.detail || '',
      authorName: p.authorName, sourceRoom: 'future', sourceRoomName: 'Our Future',
      collection: 'plans', sourceId: p.id, canUnfavourite: true,
      itemDate: p.completedAt || p.createdAt, itemDateLabel: p.completedAt ? 'Completed on' : 'Plan date',
    });
  }
  for (const key of [...new Set(arcadeKeys)].sort()) {
    out.push({
      key: `game:${key}`, category: 'Game discovery', title: GAME_TITLES[key] ?? key, detail: 'Completed in the Game Arcade',
      authorName: '', sourceRoom: 'arcade', sourceRoomName: 'Game Arcade', collection: null, sourceId: null, canUnfavourite: false,
      itemDate: null, itemDateLabel: '',
    });
  }
  return out;
}
