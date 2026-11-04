/* Phase 17 — "Find something we kept": cross-room search.
 *
 * Placement (decided, per the brief): a dedicated view, reached from
 * the front-door rooms menu on Home (like the Keepsake Box) and from
 * the desk drawer in Settings. NO global header bar was added to any
 * room — rooms keep their own local search boxes untouched.
 *
 * Privacy: see src/lib/search.ts. The pool is authorised content
 * only; journals are never searched (even the author's own), private
 * drafts never appear, sealed/scheduled letters never appear (no
 * title, no body, no count), deleted items never appear. Results link
 * to the item's ROOM ("Open in …") — there is no existing deep-open
 * mechanism for an item, so none is faked here.
 *
 * Recent searches: device-local only (our-place-search-recent-v1),
 * stored on submit, capped at 8, one-tap clear, labelled as device-
 * only — because a query itself can contain private words.
 *
 * STORYBOOK WORLDS (continuation): Search is now a real world, not
 * a tinted Page — the full-screen RoomWorld shell (own background,
 * own header, own enter animation, own scroll container, footer
 * return), a drawer-cabinet environment built from CSS and generic
 * room-name drawer fronts (aria-hidden, never content), and the
 * search form itself sitting in a pulled-out drawer panel. The
 * previous plain-page version is what the "partial world" verdict
 * referred to; this replaces it, with no search behaviour changed. */

import { useEffect, useMemo, useState } from 'react';
import type { PlaceStore } from '../lib/store';
import { loadGameData } from '../lib/games';
import { searchAll, SEARCH_TYPE_LABEL, type SearchType } from '../lib/search';
import { feedAuthorLabel } from '../lib/activity';
import { clearRecentSearches, pushRecentSearch, readRecentSearches } from '../lib/preferences';
import { Button, Card, inputCls } from '../components/ui';
import { RoomEmpty } from '../components/design-primitives';
import { RoomWorld } from '../components/RoomWorld';
import type { RoomId } from '../lib/types';

type Props = { store: PlaceStore; refresh: () => void; notify: (m: string, k?: 'ok' | 'error') => void; go: (r: RoomId) => void; onSwitchViewer?: () => void; viewerLabel?: string; otherViewerLabel?: string };

const TYPES: SearchType[] = ['memory', 'letter', 'appreciation', 'plan', 'reminder', 'keepsake'];

export function SearchRoom({ store, go, onSwitchViewer, viewerLabel = 'You', otherViewerLabel = 'Partner' }: Props) {
  const [q, setQ] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [typeFilter, setTypeFilter] = useState<SearchType | 'all'>('all');
  const [authorFilter, setAuthorFilter] = useState<string | 'all'>('all');
  const [arcadeKeys, setArcadeKeys] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>(() => readRecentSearches());
  useEffect(() => {
    let alive = true;
    loadGameData(store).then((g) => { if (alive) setArcadeKeys([...new Set(g.progress.filter((p) => p.completed).map((p) => p.gameKey))]); }).catch(() => {});
    return () => { alive = false; };
  }, [store]);
  const results = useMemo(
    () => searchAll(store, arcadeKeys, submitted, typeFilter, authorFilter),
    [store, store.version, arcadeKeys, submitted, typeFilter, authorFilter],
  );
  const submit = (query: string) => {
    const trimmed = query.trim();
    setQ(query);
    setSubmitted(trimmed);
    if (trimmed) setRecent(pushRecentSearch(trimmed));
  };
  const clearAll = () => { setQ(''); setSubmitted(''); setTypeFilter('all'); setAuthorFilter('all'); };
  const members = store.data.members;

  return (
    <RoomWorld room="search" title="Find something we kept" handNote="the drawer cabinet — every drawer labelled, nothing hidden away"
      intro="Open the drawer and look for what you kept — only shared things are ever in here."
      subtitle="One search across the shared things in your home — memories, letters, notes, plans and keepsakes. Journals are never searched, private drafts never appear, and sealed or scheduled letters never appear, not even by title. Results open their room; there is no per-item deep view to fake."
      decor={<div className="search-drawer-fronts" aria-hidden="true">
        <span className="search-drawer-front"><i />Memories</span>
        <span className="search-drawer-front"><i />Letters</span>
        <span className="search-drawer-front"><i />Plans</span>
      </div>}
      isDemo={store.mode === 'demo'} viewerLabel={viewerLabel} otherViewerLabel={otherViewerLabel} onSwitchViewer={onSwitchViewer}>
      <section className="search-drawer" aria-label="Search drawer">
        <span className="search-drawer-handle" aria-hidden="true" />
        <form onSubmit={(e) => { e.preventDefault(); submit(q); }} className="mb-4 flex flex-col gap-2 sm:flex-row">
          <label className="flex-1"><span className="sr-only">Search your shared home</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles, words, notes, plans…" className={inputCls} aria-label="Search your shared home" />
          </label>
          <Button type="submit">Search</Button>
          {submitted && <Button variant="quiet" onClick={clearAll}>Clear search</Button>}
        </form>

        <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Filter results by type">
          <span className="text-sm font-bold text-cocoa">Type:</span>
          <button type="button" onClick={() => setTypeFilter('all')} aria-pressed={typeFilter === 'all'} className={`min-h-11 rounded-full px-4 py-2 text-sm ${typeFilter === 'all' ? 'bg-cocoa text-cream' : 'border border-cocoa/25 bg-paper text-cocoa'}`}>All types</button>
          {TYPES.map((t) => (
            <button key={t} type="button" onClick={() => setTypeFilter(t)} aria-pressed={typeFilter === t} className={`min-h-11 rounded-full px-4 py-2 text-sm ${typeFilter === t ? 'bg-cocoa text-cream' : 'border border-cocoa/25 bg-paper text-cocoa'}`}>{SEARCH_TYPE_LABEL[t]}</button>
          ))}
        </div>
        {members.length > 1 && (
          <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Filter results by author">
            <span className="text-sm font-bold text-cocoa">From:</span>
            <button type="button" onClick={() => setAuthorFilter('all')} aria-pressed={authorFilter === 'all'} className={`min-h-11 rounded-full px-4 py-2 text-sm ${authorFilter === 'all' ? 'bg-cocoa text-cream' : 'border border-cocoa/25 bg-paper text-cocoa'}`}>Both of you</button>
            {members.map((m) => (
              <button key={m.id} type="button" onClick={() => setAuthorFilter(m.id)} aria-pressed={authorFilter === m.id} className={`min-h-11 rounded-full px-4 py-2 text-sm ${authorFilter === m.id ? 'bg-cocoa text-cream' : 'border border-cocoa/25 bg-paper text-cocoa'}`}>{feedAuthorLabel(store, m.id, m.displayName)}</button>
            ))}
            <span className="text-xs text-cocoa-soft">Author is matched by member, not by the stored name — a renamed member still filters correctly. Keepsakes carry no author, so choosing an author hides keepsake results rather than guessing one.</span>
          </div>
        )}
      </section>

      {!submitted ? (
        <div className="mt-4 space-y-4">
          <RoomEmpty room="search" title="What are you looking for?" body="Type a word above and press Search — a name, a place, a phrase from a letter you shared, a plan you made. Private journals and drafts are never searched, so they can never turn up here, for either of you." />
          {recent.length > 0 && (
            <Card>
              <h2 className="font-serif-display text-xl">Recent searches — on this device only</h2>
              <p className="mt-1 text-sm text-cocoa-soft">These live only on this device (never shared, never synced), because a search phrase itself can hold private words.</p>
              <ul className="mt-3 space-y-2">
                {recent.map((r) => (
                  <li key={r}><button type="button" onClick={() => submit(r)} className="min-h-11 w-full rounded-2xl border border-cocoa/25 bg-paper px-4 py-2 text-left text-sm hover:bg-cream-deep">🔍 {r}</button></li>
                ))}
              </ul>
              <div className="mt-3"><Button variant="quiet" onClick={() => { clearRecentSearches(); setRecent([]); }}>Clear recent searches</Button></div>
            </Card>
          )}
        </div>
      ) : results.length === 0 ? (
        <div className="mt-4"><RoomEmpty room="search" title="Nothing kept matches that" body={`No shared memory, letter, note, plan, reminder or keepsake matches “${submitted}”${typeFilter !== 'all' ? ` as a ${SEARCH_TYPE_LABEL[typeFilter].toLowerCase()}` : ''}. Private drafts, journals and sealed letters are never searched, so they never appear here even if the words match. Try a different word, or clear the filters.`} action={<Button onClick={clearAll}>Clear search and filters</Button>} /></div>
      ) : (
        <div className="mt-4">
          <p role="status" className="mb-3 text-sm text-cocoa-soft" data-testid="search-count">{results.length} result{results.length === 1 ? '' : 's'} for “{submitted}”.</p>
          <ul className="grid gap-3">
            {results.map((r) => (
              <li key={r.key} data-testid="search-result" data-type={r.type}>
                <Card>
                  <p className="text-xs font-bold uppercase tracking-widest text-plum">{SEARCH_TYPE_LABEL[r.type]}</p>
                  <p className="font-serif-display mt-1 text-xl leading-snug">{r.title}</p>
                  {r.snippet && <p className="mt-1 text-sm leading-relaxed text-cocoa-soft">{r.snippet}</p>}
                  <p className="mt-2 text-xs text-cocoa-soft">{r.authorLabel ? `From ${r.authorLabel} · ` : ''}In {r.roomName}</p>
                  <div className="mt-3"><Button variant="quiet" onClick={() => go(r.linkRoom)}>Open in {r.linkRoomName}</Button></div>
                </Card>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-6 text-xs leading-relaxed text-cocoa-soft">Search honesty note: this search opens rooms, not individual items — there is no per-item deep view in the app to open into, so “Open in …” takes you to the room that holds it. Sealed letters are excluded from search entirely, which is stricter than the Letters room (where a sealed envelope is visible): a search must never confirm a sealed letter even exists.</p>
    </RoomWorld>
  );
}
