import { useEffect, useMemo, useState } from 'react';
import type { PlaceStore } from '../lib/store';
import { loadGameData } from '../lib/games';
import { deriveKeepsakes } from '../lib/garden';
import { formatDate } from '../lib/utils';
import { RoomWorld } from '../components/RoomWorld';
import { RoomEmpty } from '../components/design-primitives';
import { Button, Card } from '../components/ui';

/* Phase 13 — Keepsake Box: ONE dedicated aggregation view, frontend
   routing only, no model change. Entries come only from deriveKeepsakes
   (explicit favourites, favourited + done plans, completed games).
   Private drafts, scheduled/sealed letters, journals and voice notes
   are excluded by construction in garden.ts and are named below so the
   exclusion is visible, not silent. Link-back sets the hash, which
   App's hashchange listener turns into the room — no new router. */

type Props = { store: PlaceStore; refresh: () => void; notify: (m: string, k?: 'ok' | 'error') => void; onSwitchViewer?: () => void; viewerLabel: string; otherViewerLabel: string };

export function KeepsakesRoom({ store, refresh, notify, onSwitchViewer, viewerLabel, otherViewerLabel }: Props) {
  const [arcadeKeys, setArcadeKeys] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    loadGameData(store).then((g) => {
      if (!alive) return;
      setArcadeKeys([...new Set(g.progress.filter((p) => p.completed).map((p) => p.gameKey))]);
    }).catch(() => { /* arcade part is simply empty, never guessed */ });
    return () => { alive = false; };
  }, [store]);
  const keepsakes = useMemo(() => deriveKeepsakes(store, arcadeKeys), [store, store.version, arcadeKeys]);
  /* Phase 17 — category filter (new; frontend-only over the existing
     derived categories — the box previously listed every category with
     no way to narrow it). The filter is view state only, not stored. */
  const [categoryFilter, setCategoryFilter] = useState<string | 'all'>('all');
  const categories = useMemo(() => [...new Set(keepsakes.map((k) => k.category))].sort(), [keepsakes]);
  const filtered = categoryFilter === 'all' ? keepsakes : keepsakes.filter((k) => k.category === categoryFilter);
  const groups = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (const k of filtered) map.set(k.category, [...(map.get(k.category) ?? []), k]);
    return [...map.entries()];
  }, [filtered]);
  /* STORYBOOK WORLDS: no forced scroll-to-top here — App.tsx restores
     the destination room's saved scroll position, or the top when
     there is none. Forcing top here would erase a restored position. */
  const goRoom = (room: string) => { location.hash = room; };

  return (
    <RoomWorld room="keepsakes" title="Keepsake Box" handNote="only what you chose to keep — nothing auto-added"
      intro="Lift the lid only when you want to — everything inside was chosen, on purpose, to be kept."
      subtitle="Everything here was explicitly favourited, completed, or both. Un-favouriting an item in its own room removes it from this box. Private drafts, sealed or scheduled letters, journals and voice notes never enter this box."
      decor={<p className="keepsake-box-strip" aria-hidden="true"><span>▢</span><span>kept with care</span><span>▢</span></p>}
      isDemo={store.mode === 'demo'} viewerLabel={viewerLabel} otherViewerLabel={otherViewerLabel} onSwitchViewer={onSwitchViewer}>
      <p className="mb-4 text-sm text-cocoa-soft" data-testid="keepsake-count">
        {keepsakes.length === 0 ? 'Nothing kept yet.' : `${keepsakes.length} keepsake${keepsakes.length === 1 ? '' : 's'} kept.`} Viewing as {viewerLabel} — the partner sees only shared keepsakes and their own, never your private items.
      </p>
      <p className="mb-4 text-xs leading-relaxed text-cocoa-soft">Dates below are the item&apos;s own date (memory date, letter/note date, or completion date) — the model stores no “saved on” date for a favourite, so no saved date is shown or invented. Games have no item date.</p>
      {keepsakes.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Filter keepsakes by category">
          <span className="text-sm font-bold text-cocoa">Category:</span>
          <button type="button" onClick={() => setCategoryFilter('all')} aria-pressed={categoryFilter === 'all'} className={`min-h-11 rounded-full px-4 py-2 text-sm ${categoryFilter === 'all' ? 'bg-cocoa text-cream' : 'border border-cocoa/25 bg-paper text-cocoa'}`}>All ({keepsakes.length})</button>
          {categories.map((c) => (
            <button key={c} type="button" onClick={() => setCategoryFilter(c)} aria-pressed={categoryFilter === c} className={`min-h-11 rounded-full px-4 py-2 text-sm ${categoryFilter === c ? 'bg-cocoa text-cream' : 'border border-cocoa/25 bg-paper text-cocoa'}`}>{c} ({keepsakes.filter((k) => k.category === c).length})</button>
          ))}
        </div>
      )}
      {keepsakes.length > 0 && filtered.length === 0 && (
        <p className="mb-4 text-sm text-cocoa-soft">Nothing in this category — choose another category above.</p>
      )}
      {keepsakes.length === 0 && (
        <RoomEmpty room="keepsakes" title="The box is empty for now" body="Favourite a memory, letter, appreciation, note, or completed adventure in its own room, or finish a game in the Arcade, and it will appear here. Nothing is added on its own." />
      )}
      {groups.map(([category, items]) => (
        <section key={category} aria-label={category} className="mb-6">
          <h2 className="font-serif-display mb-3 text-2xl">{category}</h2>
          <div className="grid gap-3">
            {items.map((k) => (
              <div key={k.key} data-testid="keepsake-item" data-category={k.category}><Card>
                <p className="font-serif-display text-xl leading-snug">{k.title}</p>
                {k.detail && <p className="mt-1 text-sm leading-relaxed text-cocoa-soft">{k.detail}</p>}
                <p className="mt-2 text-sm text-cocoa-soft">
                  From {k.sourceRoomName}{k.authorName ? ` · by ${k.authorName}` : ''}{k.itemDate ? ` · ${k.itemDateLabel}: ${formatDate(k.itemDate)}` : ''}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="quiet" onClick={() => goRoom(k.sourceRoom)}>Open in {k.sourceRoomName}</Button>
                  {k.canUnfavourite && k.collection && k.sourceId && (
                    <Button variant="quiet" onClick={async () => { await store.toggleFavorite(k.collection!, k.sourceId!); refresh(); notify('Removed from the Keepsake Box.'); }}>Remove from Keepsake Box</Button>
                  )}
                </div>
              </Card></div>
            ))}
          </div>
        </section>
      ))}
      <section aria-label="What never enters the Keepsake Box" className="mt-6 rounded-2xl border border-cocoa/25 bg-paper p-4">
        <h2 className="font-serif-display text-xl">What never enters this box, and why</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-cocoa-soft">
          <li>Private drafts — author-only; a favourite flag on one must never make it shared.</li>
          <li>Scheduled letters before reveal and sealed letters — the recipient may not read them yet, so they cannot be listed, titled, or counted here.</li>
          <li>Private journals and voice notes — author-only by design, never aggregated.</li>
          <li>Unfavourited, deleted, or un-completed items — deletion, un-favouriting, or moving a plan back to planned removes its keepsake immediately, because this box stores nothing of its own.</li>
        </ul>
      </section>
    </RoomWorld>
  );
}
