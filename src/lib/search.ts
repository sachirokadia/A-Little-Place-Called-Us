/* Phase 17 — Cross-room search: "Find something we kept".
 *
 * Search ONLY authorised content, through the EXISTING visibility
 * paths — no new query, no new permission logic invented here:
 *  - memories: store.shared() (non-deleted) — title, caption, story, tags
 *  - letters: store.visibleLetters() AND visibility === 'shared' AND
 *    NOT sealed — title and body. This is STRICTER than the Letters
 *    room: private drafts are gone (visibility filter), scheduled
 *    letters are gone (visibility filter), and sealed letters are gone
 *    entirely — no title, no body, no count — before authorised
 *    opening, even though the Letters room shows a sealed envelope.
 *  - appreciations: store.shared() — kind, forName, and text. The
 *    audit found appreciations have NO private variant: the text is
 *    shown to both members in Things I See in You, so searching it
 *    reveals nothing the viewer cannot already read in that room.
 *  - plans: store.shared() — title, detail
 *  - reminders: store.shared() — text (reminders are space-visible by
 *    model; the room shows every note to both members)
 *  - keepsakes: deriveKeepsakes() (already permission-filtered) —
 *    title, detail, category
 * NEVER: journals (excluded entirely, even the author's own, per the
 * brief — this is a shared search, and journals are author-only),
 * voice notes, private drafts, sealed/scheduled letters, deleted
 * items, account details, emails, passwords, tokens.
 *
 * Author filter: by authorId (stable), displayed via the members list
 * (same resolution as the Phase 16 feed: member displayName where
 * known, else the stored authorName). Stored authorName does not
 * update on rename, so filtering never matches on the stored string.
 * Deep-open: NOT supported — there is no existing deep-open mechanism
 * for an item (rooms open lists, and Letters opens a modal only from
 * its own list). Results therefore link to the item's ROOM, honestly
 * labelled "Open in …", and deep-open is reported as a gap. */

import type { PlaceStore } from './store';
import type { RoomId } from './types';
import { deriveKeepsakes } from './garden';
import { feedAuthorLabel } from './activity';
import { isSealed } from './utils';

export type SearchType = 'memory' | 'letter' | 'appreciation' | 'plan' | 'reminder' | 'keepsake';
export const SEARCH_TYPE_LABEL: Record<SearchType, string> = {
  memory: 'Memory',
  letter: 'Letter',
  appreciation: 'Appreciation note',
  plan: 'Future plan',
  reminder: 'Reminder note',
  keepsake: 'Keepsake',
};
export const SEARCH_TYPE_ROOM: Record<SearchType, RoomId> = {
  memory: 'memories',
  letter: 'letters',
  appreciation: 'appreciations',
  plan: 'future',
  reminder: 'reminders',
  keepsake: 'keepsakes',
};
export const SEARCH_ROOM_NAME: Record<SearchType, string> = {
  memory: 'Memory Wall',
  letter: 'Letters',
  appreciation: 'Things I See in You',
  plan: 'Our Future',
  reminder: 'Reminder Room',
  keepsake: 'Keepsake Box',
};

export interface SearchResult {
  key: string;
  type: SearchType;
  title: string;
  snippet: string;
  authorLabel: string;
  room: RoomId;
  roomName: string;
  /** Keepsake results link to their SOURCE room, not to the box. */
  linkRoom: RoomId;
  linkRoomName: string;
}

function hay(...parts: (string | string[] | null | undefined)[]): string {
  return parts.flatMap((p) => (Array.isArray(p) ? p : [p ?? ''])).join(' ').toLowerCase();
}

export function searchAll(
  store: PlaceStore,
  arcadeKeys: string[],
  query: string,
  typeFilter: SearchType | 'all',
  authorId: string | 'all',
): SearchResult[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const byAuthor = <T extends { authorId: string }>(items: T[]): T[] =>
    authorId === 'all' ? items : items.filter((i) => i.authorId === authorId);
  const out: SearchResult[] = [];
  const want = (t: SearchType) => typeFilter === 'all' || typeFilter === t;

  if (want('memory')) {
    for (const m of byAuthor(store.shared(store.data.memories))) {
      if (hay(m.title, m.caption, m.story, m.tags).includes(needle)) {
        out.push({ key: `memory:${m.id}`, type: 'memory', title: m.title, snippet: m.caption || m.story.slice(0, 140), authorLabel: feedAuthorLabel(store, m.authorId, m.authorName), room: 'memories', roomName: 'Memory Wall', linkRoom: 'memories', linkRoomName: 'Memory Wall' });
      }
    }
  }
  if (want('letter')) {
    // Shared + unsealed only. visibleLetters() already drops other
    // people's private drafts; the visibility + isSealed filters drop
    // the author's own drafts, every scheduled letter, and every sealed
    // letter — so a partner query for a private/sealed term matches
    // nothing here, by construction, not by hiding rows after the fact.
    const pool = store.visibleLetters().filter((l) => l.visibility === 'shared' && !isSealed(l, store.viewerId));
    for (const l of byAuthor(pool)) {
      if (hay(l.title, l.body).includes(needle)) {
        out.push({ key: `letter:${l.id}`, type: 'letter', title: l.title, snippet: l.body.slice(0, 140), authorLabel: feedAuthorLabel(store, l.authorId, l.authorName), room: 'letters', roomName: 'Letters', linkRoom: 'letters', linkRoomName: 'Letters' });
      }
    }
  }
  if (want('appreciation')) {
    for (const a of byAuthor(store.shared(store.data.appreciations))) {
      if (hay(a.kind, a.forName, a.text).includes(needle)) {
        out.push({ key: `appreciation:${a.id}`, type: 'appreciation', title: a.text.length > 80 ? `${a.text.slice(0, 80)}…` : a.text, snippet: `For ${a.forName} · ${a.kind}`, authorLabel: feedAuthorLabel(store, a.authorId, a.authorName), room: 'appreciations', roomName: 'Things I See in You', linkRoom: 'appreciations', linkRoomName: 'Things I See in You' });
      }
    }
  }
  if (want('plan')) {
    for (const p of byAuthor(store.shared(store.data.plans))) {
      if (hay(p.title, p.detail).includes(needle)) {
        out.push({ key: `plan:${p.id}`, type: 'plan', title: p.title, snippet: p.detail.slice(0, 140), authorLabel: feedAuthorLabel(store, p.authorId, p.authorName), room: 'future', roomName: 'Our Future', linkRoom: 'future', linkRoomName: 'Our Future' });
      }
    }
  }
  if (want('reminder')) {
    for (const r of byAuthor(store.shared(store.data.reminders))) {
      if (hay(r.text).includes(needle)) {
        out.push({ key: `reminder:${r.id}`, type: 'reminder', title: r.text.length > 80 ? `${r.text.slice(0, 80)}…` : r.text, snippet: '', authorLabel: feedAuthorLabel(store, r.authorId, r.authorName), room: 'reminders', roomName: 'Reminder Room', linkRoom: 'reminders', linkRoomName: 'Reminder Room' });
      }
    }
  }
  if (want('keepsake')) {
    for (const k of deriveKeepsakes(store, arcadeKeys)) {
      if (hay(k.title, k.detail, k.category).includes(needle)) {
        // Keepsakes carry no authorId; author filter cannot apply to
        // them reliably, so an author filter hides keepsake results
        // rather than guessing an author for them.
        if (authorId !== 'all') continue;
        out.push({ key: `keepsake:${k.key}`, type: 'keepsake', title: k.title, snippet: k.detail ? `${k.category} · ${k.detail.slice(0, 120)}` : k.category, authorLabel: k.authorName || '', room: 'keepsakes', roomName: 'Keepsake Box', linkRoom: k.sourceRoom, linkRoomName: k.sourceRoomName });
      }
    }
  }
  return out;
}
