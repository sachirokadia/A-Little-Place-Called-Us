import { useMemo, useState } from 'react';
import type { PlaceStore } from '../lib/store';
import type { Memory } from '../lib/types';
import { formatDate, todayIsoDate, parseTags, validateImageFile, validateRequired } from '../lib/utils';
import { Card, Button, Field, inputCls, Modal, FavoriteButton, ConfirmDelete, Washi } from '../components/ui';
import { RoomEmpty, CreateEntry } from '../components/design-primitives';
import { attemptLeave, useDirtyGuard } from '../lib/dirtyGuard';
import { RoomWorld } from '../components/RoomWorld';

type Props = { store: PlaceStore; refresh: () => void; notify: (m: string, k?: 'ok' | 'error') => void; onSwitchViewer?: () => void; viewerLabel?: string; otherViewerLabel?: string };

/* Phase 12, Reminder Room: a noticeboard, not a dashboard list. Notes are
   pinned cards with varied tilts, on a warm board panel. Categories are
   NOT invented here: reminders.kind in the database is only 'note' or
   'prompt', so a new encouragement/appreciation/humour/support category
   would need a migration — that is listed as deferred, not faked with a
   per-device tag. What this pass does add is browsing by author, which
   the data already supports, alongside the existing favourites and
   random-note flows. Nothing here requires a reply, a streak, or any
   emotional disclosure.
   Phase 12B: the noticeboard is now a full-screen world (RoomWorld,
   same shell as 12A). Clicking a note's Open control reads it in full
   in a viewer; the random note now gently unfolds as a full card
   (author and date included, transform/opacity only) instead of a bare
   line of text. Favourites are the pin mechanism: a favourited note
   carries a "Pinned" label on the board. Edit and delete are now
   author-only in the UI (previously both were open to either member
   under the shared-artefact rule; the store path is still used, never
   bypassed). Audience is NOT invented: the model has no for-partner /
   for-self field — every reminder is space-visible to both members and
   carries its author's name, so a note "for yourself" cannot be
   distinguished from one for your partner; that is reported as a gap,
   not papered over with a selector that stores nothing. A reminder is
   a gift with no reply expected — that framing is now stated on the
   board itself. */
export function RemindersRoom({ store, refresh, notify, onSwitchViewer, viewerLabel = 'You', otherViewerLabel = 'Partner' }: Props) {
  const [text, setText] = useState('');
  const [onlyFav, setOnlyFav] = useState(false);
  const [authorFilter, setAuthorFilter] = useState<string | null>(null);
  const [random, setRandom] = useState<{ text: string; authorName: string; createdAt: string } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [saving, setSaving] = useState(false);
  const reminderDirty = Boolean(text.trim()) || (editing !== null && editText !== (store.shared(store.data.reminders).find((r) => r.id === editing)?.text ?? ''));
  useDirtyGuard(reminderDirty, {
    label: 'a note you are writing',
    isDirty: () => reminderDirty,
    discard: () => { setText(''); setEditing(null); setEditText(''); },
  });

  const authors = useMemo(() => [...new Set(store.shared(store.data.reminders).map((r) => r.authorName))].sort(), [store.version]);
  const items = useMemo(() => {
    let list = store.shared(store.data.reminders).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (onlyFav) list = list.filter((i) => i.isFavorite);
    if (authorFilter) list = list.filter((i) => i.authorName === authorFilter);
    return list;
  }, [store.version, onlyFav, authorFilter]);

  const save = async () => {
    const err = validateRequired(text, 'A note', 2000);
    if (err) return notify(err, 'error');
    setSaving(true);
    try {
      await store.create('reminders', { spaceId: store.data.space.id, authorId: store.viewerId, authorName: store.viewerName, text: text.trim(), kind: 'note' });
      setText(''); refresh(); notify('Note left in the Reminder Room.');
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not save.', 'error'); } finally { setSaving(false); }
  };

  const pickRandom = () => {
    const pool = store.shared(store.data.reminders);
    if (!pool.length) return notify('No notes yet — write the first one.', 'error');
    const pick = pool[Math.floor(Math.random() * pool.length)];
    setRandom({ text: pick.text, authorName: pick.authorName, createdAt: pick.createdAt });
  };
  const selectedNote = selected ? store.shared(store.data.reminders).find((r) => r.id === selected) ?? null : null;

  return (
    <RoomWorld room="reminders" title="Reminder Room" handNote="little notes for difficult days — pinned paper, folded messages, a jar of kind words"
      intro="Step up to the board, or draw a note from the jar — nothing here hurries you, and no reply is ever expected."
      subtitle="Personal encouragement, left for ordinary days. Nothing here expires, and nothing here nags — come back when you want to. A reminder is a gift: no reply is expected, ever."
      actions={<><Button variant={onlyFav ? 'primary' : 'quiet'} onClick={() => setOnlyFav(!onlyFav)}>{onlyFav ? 'Showing favourites' : 'Favourites only'}</Button></>}
      decor={<p className="pressed-flowers" aria-hidden="true"><span>✿</span><span>✦</span><span>✿</span><span>❦</span><span>✿</span></p>}
      isDemo={store.mode === 'demo'} viewerLabel={viewerLabel} otherViewerLabel={otherViewerLabel} onSwitchViewer={onSwitchViewer}>
      {random && <Card className="note-unfold mb-4 border-gold/40"><p className="text-xs uppercase tracking-widest text-gold-soft">A note for you — unfolded gently</p><p className="font-serif-display mt-2 text-xl leading-relaxed">{random.text}</p><p className="mt-2 text-sm text-cocoa-soft">From {random.authorName} · {formatDate(random.createdAt)}</p><div className="mt-3 flex flex-wrap gap-2"><Button variant="quiet" onClick={pickRandom}>Unfold another</Button><Button variant="quiet" onClick={() => setRandom(null)}>Fold it back</Button></div></Card>}

      {/* STORYBOOK WORLDS — the jar of kind words, now a real object, not
          just a line in the hand note: drawing from it runs the same
          random-note flow as before (shared reminders only, by the
          model's own visibility), and the drawn note unfolds below
          and folds back on demand. No new data, no new model field. */}
      <section aria-label="Jar of kind words" className="kind-jar mb-4">
        <p className="font-serif-display text-xl" aria-hidden="true">🫙 The jar of kind words</p>
        <p className="mt-1 text-sm leading-relaxed text-cocoa-soft">Every shared note on the board is in the jar. Draw one at random — it unfolds below, and folds back when you are done with it.</p>
        <div className="mt-3"><Button onClick={pickRandom}>Draw a note from the jar</Button></div>
      </section>

      {authors.length > 1 && (
        <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Filter notes by author">
          <span className="text-sm font-bold text-cocoa">From:</span>
          <button onClick={() => setAuthorFilter(null)} aria-pressed={!authorFilter} className={`rounded-full px-3 py-1 text-xs ${!authorFilter ? 'bg-cocoa text-cream' : 'border border-cocoa/25 text-cocoa'}`}>Both of you</button>
          {authors.map((a) => (
            <button key={a} onClick={() => setAuthorFilter(authorFilter === a ? null : a)} aria-pressed={authorFilter === a} className={`rounded-full px-3 py-1 text-xs ${authorFilter === a ? 'bg-cocoa text-cream' : 'border border-cocoa/25 text-cocoa'}`}>{a}</button>
          ))}
        </div>
      )}

      <CreateEntry room="reminders" note="pinned here, for ordinary days">
      <Card className="mb-5">
        <h2 className="font-serif-display text-xl">Leave a note</h2>
        <p className="mt-1 text-sm leading-relaxed text-cocoa-soft">For your partner, or for a future you — the board shows every note to both of you, with the author's name attached. There is no separate "for me / for them" setting to choose, because the reminder model does not store one. Nothing here asks for a reply.</p>
        <div className="mt-3 space-y-3">
          <Field label="Your encouragement"><textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={2000} className={inputCls} placeholder="Something kind, in your own words…" /></Field>
          <Button onClick={save} disabled={saving}>{saving ? 'Leaving…' : 'Leave it here'}</Button>
        </div>
      </Card>
      </CreateEntry>

      {items.length === 0 ? <RoomEmpty room="reminders" title="Nothing here yet" body="Leave the first note. It can be one sentence — the small ones are often the ones that land." /> : (
        <div className="noticeboard noticeboard-frame note-board-world">
        <ul className="grid gap-4 sm:grid-cols-2">
          {items.map((r, i) => (
            <li key={r.id} className="pinned-note note-pinned">
              <Card className={i % 3 === 0 ? 'rot-l' : i % 3 === 1 ? 'rot-r' : 'rot-0'}>
                {r.isFavorite && <p><span className="pinned-label">📌 Pinned favourite</span></p>}
                <p className="font-serif-display mt-2 text-lg leading-relaxed">{r.text.length > 160 ? `${r.text.slice(0, 160)}…` : r.text}</p>
                <p className="mt-3 text-xs text-ivory-dim">From {r.authorName} · {formatDate(r.createdAt)}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button variant="quiet" onClick={() => setSelected(r.id)}>Open note</Button>
                  <FavoriteButton active={r.isFavorite} label={r.isFavorite ? 'Remove from favourites' : 'Pin to favourites'} onToggle={async () => { await store.toggleFavorite('reminders', r.id); refresh(); }} />
                  {/* Author-only in 12B: only the writer edits or deletes their own note. */}
                  {r.authorId === store.viewerId && <Button variant="quiet" onClick={() => { setEditing(r.id); setEditText(r.text); }}>Edit</Button>}
                  {r.authorId === store.viewerId && <ConfirmDelete onConfirm={async () => { await store.softDelete('reminders', r.id); refresh(); notify('Moved to Deleted. You can restore it there.'); }} />}
                </div>
                {editing === r.id && (
                  <div className="mt-3 space-y-2">
                    <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={3} className={inputCls} aria-label="Edit note" />
                    <div className="flex gap-2"><Button onClick={async () => { const err = validateRequired(editText, 'A note', 2000); if (err) return notify(err, 'error'); await store.update('reminders', r.id, { text: editText.trim() }); setEditing(null); refresh(); notify('Note updated.'); }}>Save</Button><Button variant="quiet" onClick={() => setEditing(null)}>Cancel</Button></div>
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
        </div>
      )}

      {selectedNote && <Modal title="A note from the board" onClose={() => setSelected(null)}>
        <p className="font-serif-display text-xl leading-relaxed">{selectedNote.text}</p>
        <p className="mt-3 text-sm text-cocoa-soft">From {selectedNote.authorName} · {formatDate(selectedNote.createdAt)}{selectedNote.isFavorite ? ' · pinned favourite' : ''}</p>
        <p className="mt-2 text-sm text-cocoa-soft">No reply expected — just a note, when you wanted one.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <FavoriteButton active={selectedNote.isFavorite} label={selectedNote.isFavorite ? 'Remove from favourites' : 'Pin to favourites'} onToggle={async () => { await store.toggleFavorite('reminders', selectedNote.id); refresh(); setSelected(selectedNote.id); }} />
          {selectedNote.authorId === store.viewerId && <Button variant="quiet" onClick={() => { setEditing(selectedNote.id); setEditText(selectedNote.text); setSelected(null); }}>Edit this note</Button>}
          {selectedNote.authorId === store.viewerId && <ConfirmDelete onConfirm={async () => { await store.softDelete('reminders', selectedNote.id); setSelected(null); refresh(); notify('Moved to Deleted. You can restore it there.'); }} />}
          <Button variant="quiet" onClick={() => setSelected(null)}>Pin it back</Button>
        </div>
      </Modal>}
    </RoomWorld>
  );
}

/* Phase 12, Memory Wall: three ways to browse the same memories, chosen
   per device (localStorage, no shared data). Scrapbook is the polaroid
   grid, Timeline walks the dates in order, Collage is a looser layered
   wall. The add/edit/delete/favourite flows are identical in all three —
   they all open the same detail modal. */
export type MemoryLayout = 'scrapbook' | 'timeline' | 'collage';
function readMemoryLayout(): MemoryLayout {
  try { const v = localStorage.getItem('our-place-memory-layout'); return v === 'timeline' || v === 'collage' ? v : 'scrapbook'; } catch { return 'scrapbook'; }
}

export function MemoriesRoom({ store, refresh, notify, onSwitchViewer, viewerLabel = 'You', otherViewerLabel = 'Partner' }: Props) {
  const [q, setQ] = useState('');
  const [onlyFav, setOnlyFav] = useState(false);
  const [sort, setSort] = useState<'new' | 'old' | 'happened'>('happened');
  /* Phase 12A: filter by year, on the existing happenedOn field only —
     no new field, no new model. The year list is derived from the
     memories themselves, so an empty wall shows no year filter. */
  const [yearFilter, setYearFilter] = useState<string | null>(null);
  /* Phase 12A: local preview URL for the photograph being placed, so
     adding feels like laying a polaroid on the page. The preview is
     never stored; only the store's single upload path saves anything. */
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [layout, setLayoutState] = useState<MemoryLayout>(readMemoryLayout);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const setLayout = (l: MemoryLayout) => { setLayoutState(l); try { localStorage.setItem('our-place-memory-layout', l); } catch { /* private mode */ } };
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState<Memory | null>(null);
  const [form, setForm] = useState({ title: '', caption: '', story: '', happenedOn: todayIsoDate(), tags: '' });
  const [photo, setPhoto] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ title: '', caption: '', story: '', happenedOn: todayIsoDate(), tags: '' });
  const memoryCreateDirty = showForm && Boolean(form.title.trim() || form.caption.trim() || form.story.trim() || form.tags.trim() || photo);
  const memoryEditDirty = editing && Boolean(selected) && (editForm.title !== selected!.title || editForm.caption !== selected!.caption || editForm.story !== selected!.story || editForm.happenedOn !== selected!.happenedOn || editForm.tags !== (selected!.tags ?? []).join(', '));
  const memoryDirty = memoryCreateDirty || memoryEditDirty;
  useDirtyGuard(memoryDirty, {
    label: editing ? 'a memory you are editing' : 'a memory you are adding',
    isDirty: () => memoryDirty,
    discard: () => { setShowForm(false); setPhoto(null); setPhotoPreview(null); setForm({ title: '', caption: '', story: '', happenedOn: todayIsoDate(), tags: '' }); setEditing(false); },
  });

  const allTags = useMemo(() => {
    const s = new Set<string>();
    store.shared(store.data.memories).forEach((m) => (m.tags ?? []).forEach((t) => s.add(t)));
    return [...s].sort();
  }, [store.version]);
  const allYears = useMemo(() => {
    const s = new Set<string>();
    store.shared(store.data.memories).forEach((m) => { if (m.happenedOn) s.add(m.happenedOn.slice(0, 4)); });
    return [...s].sort().reverse();
  }, [store.version]);
  /* Phase 12A: the thread through time — every shared memory in
     happenedOn order, as a ribbon above the wall, so the chronological
     connection is visible in every layout, not only in Timeline view. */
  const thread = useMemo(() => store.shared(store.data.memories).slice().sort((a, b) => a.happenedOn.localeCompare(b.happenedOn)), [store.version]);
  const items = useMemo(() => {
    let list = store.shared(store.data.memories);
    const needle = q.trim().toLowerCase();
    if (needle) list = list.filter((m) => [m.title, m.caption, m.story, m.authorName, ...(m.tags ?? [])].join(' ').toLowerCase().includes(needle));
    if (onlyFav) list = list.filter((m) => m.isFavorite);
    if (tagFilter) list = list.filter((m) => (m.tags ?? []).includes(tagFilter));
    if (yearFilter) list = list.filter((m) => m.happenedOn.startsWith(yearFilter));
    const sorted = [...list];
    if (sort === 'new') sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (sort === 'old') sorted.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (sort === 'happened') sorted.sort((a, b) => b.happenedOn.localeCompare(a.happenedOn));
    if (layout === 'timeline') sorted.sort((a, b) => a.happenedOn.localeCompare(b.happenedOn));
    return sorted;
  }, [store.version, q, onlyFav, sort, tagFilter, layout, yearFilter]);

  const save = async () => {
    const err = validateRequired(form.title, 'A title', 200) || validateRequired(form.caption, 'A caption', 2000);
    if (err) return notify(err, 'error');
    if (photo) { const fileErr = validateImageFile(photo); if (fileErr) return notify(fileErr, 'error'); }
    setSaving(true);
    try {
      let mediaUrl: string | null = null; let mediaPath: string | null = null;
      if (photo) { const up = await store.uploadMedia(photo, 'photo'); mediaUrl = up.url; mediaPath = up.path || null; }
      await store.create('memories', { spaceId: store.data.space.id, authorId: store.viewerId, authorName: store.viewerName, title: form.title.trim(), caption: form.caption.trim(), story: form.story.trim(), happenedOn: form.happenedOn, mediaUrl, mediaPath, mediaType: photo ? 'photo' : 'none', tags: parseTags(form.tags) });
      setShowForm(false); setSaveFailed(null); setPhoto(null); setPhotoPreview(null); setForm({ title: '', caption: '', story: '', happenedOn: todayIsoDate(), tags: '' }); refresh(); notify('Memory added to the wall.');
    } catch (e) { const m = e instanceof Error ? e.message : 'Could not save.'; setSaveFailed(m); notify(m, 'error'); } finally { setSaving(false); }
  };

  const saveEdit = async () => {
    if (!selected) return;
    const err = validateRequired(editForm.title, 'A title', 200) || validateRequired(editForm.caption, 'A caption', 2000);
    if (err) return notify(err, 'error');
    try {
      await store.update('memories', selected.id, { title: editForm.title.trim(), caption: editForm.caption.trim(), story: editForm.story.trim(), happenedOn: editForm.happenedOn, tags: parseTags(editForm.tags) });
      setEditing(false); setSelected(null); refresh(); notify('Memory updated.');
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not save that change.', 'error'); }
  };

  return (
    <RoomWorld room="memories" title="Memory Wall" handNote="our scrapbook, kept in no particular order — except the order things happened"
      intro="Step into the garden, where every keepsake has its place in the sun."
      subtitle="Photographs, captions, dates, and the story only you two remember. Search it, save favourites, and sort by when it happened. One photograph per memory — that is what the memory model holds; a second photograph gets its own memory."
      actions={<Button onClick={() => setShowForm(true)}>Add a memory</Button>}
      decor={<><p className="pressed-flowers" aria-hidden="true"><span>✿</span><span>❦</span><span>✿</span><span>✦</span><span>✿</span></p><p className="garden-bed" aria-hidden="true"><span>✿</span><span>❦</span><span>✿</span><span>✦</span><span>✿</span><span>❦</span><span>✿</span></p></>}
      isDemo={store.mode === 'demo'} viewerLabel={viewerLabel} otherViewerLabel={otherViewerLabel} onSwitchViewer={onSwitchViewer}>
      {thread.length > 1 && (
        <nav className="timeline-ribbon" aria-label="Memories in the order they happened">
          <p className="timeline-ribbon-label">The thread through time — oldest to newest:</p>
          <ol>
            {thread.map((m) => (
              <li key={m.id}><button type="button" onClick={() => setSelected(m)} title={m.title}><span className="timeline-ribbon-dot" aria-hidden="true" /><span className="timeline-ribbon-date">{formatDate(m.happenedOn)}</span><span className="timeline-ribbon-title">{m.title}</span></button></li>
            ))}
          </ol>
        </nav>
      )}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <label className="flex-1"><span className="sr-only">Search memories</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles, captions, stories…" className={inputCls} /></label>
        <label><span className="sr-only">Sort memories</span><select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className={`${inputCls} sm:w-44`}><option value="happened">When it happened</option><option value="new">Newest added</option><option value="old">Oldest added</option></select></label>
        <Button variant={onlyFav ? 'primary' : 'quiet'} onClick={() => setOnlyFav(!onlyFav)}>{onlyFav ? 'Favourites ✓' : 'Favourites only'}</Button>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="How to browse the wall">
        <span className="text-sm font-bold text-cocoa">Browse as:</span>
        {(['scrapbook', 'timeline', 'collage'] as const).map((l) => (
          <button key={l} onClick={() => setLayout(l)} aria-pressed={layout === l} className={`min-h-11 rounded-full px-4 py-2 text-sm ${layout === l ? 'bg-cocoa text-cream' : 'border border-cocoa/25 text-cocoa'}`}>{l === 'scrapbook' ? 'Scrapbook' : l === 'timeline' ? 'Timeline' : 'Collage'}</button>
        ))}
      </div>
      {allYears.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Filter memories by year">
          <span className="text-sm font-bold text-cocoa">Year:</span>
          <button onClick={() => setYearFilter(null)} aria-pressed={!yearFilter} className={`rounded-full px-3 py-1 text-xs ${!yearFilter ? 'bg-cocoa text-cream' : 'border border-cocoa/25 text-cocoa'}`}>All years</button>
          {allYears.map((y) => (
            <button key={y} onClick={() => setYearFilter(yearFilter === y ? null : y)} aria-pressed={yearFilter === y} className={`rounded-full px-3 py-1 text-xs ${yearFilter === y ? 'bg-cocoa text-cream' : 'border border-cocoa/25 text-cocoa'}`}>{y}</button>
          ))}
        </div>
      )}
      {allTags.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Filter by tag">
          <span className="text-sm font-bold text-cocoa">Tag:</span>
          <button onClick={() => setTagFilter(null)} aria-pressed={!tagFilter} className={`rounded-full px-3 py-1 text-xs ${!tagFilter ? 'bg-cocoa text-cream' : 'border border-cocoa/25 text-cocoa'}`}>All tags</button>
          {allTags.map((t) => (
            <button key={t} onClick={() => setTagFilter(tagFilter === t ? null : t)} aria-pressed={tagFilter === t} className={`rounded-full px-3 py-1 text-xs ${tagFilter === t ? 'bg-cocoa text-cream' : 'border border-cocoa/25 text-cocoa'}`}>#{t}</button>
          ))}
        </div>
      )}

      {items.length === 0 ? <RoomEmpty room="memories" title={q || tagFilter || yearFilter ? 'Nothing matches that filter' : 'The wall is waiting'} body={q || tagFilter || yearFilter ? 'Try a different word, tag, or year, or clear the filters to see everything again.' : 'Add your first memory — a photo is welcome, but a date and a sentence are enough.'} action={<Button onClick={() => setShowForm(true)}>Add a memory</Button>} /> : layout === 'timeline' ? (
        <div className="timeline-wrap">
          <ul className="space-y-4">
            {items.map((m) => (
              <li key={m.id} className="relative">
                <span className="timeline-dot" aria-hidden="true" />
                <Card>
                  <p className="text-xs font-extrabold uppercase tracking-widest text-plum">{formatDate(m.happenedOn)}</p>
                  <div className="mt-2 flex flex-col gap-3 sm:flex-row">
                    {m.mediaUrl && <img src={m.mediaUrl} alt={m.caption || m.title} className="h-24 w-24 shrink-0 rounded-lg border border-cocoa/15 object-cover" loading="lazy" decoding="async" />}
                    <div className="min-w-0">
                      <button onClick={() => setSelected(m)} className="text-left"><span className="font-serif-display text-xl leading-snug text-ivory">{m.title}</span><span className="font-hand mt-1 block text-2xl leading-snug text-plum">{m.caption}</span></button>
                      <p className="mt-1 text-xs text-ivory-dim">By {m.authorName}{(m.tags ?? []).length > 0 ? ` · ${(m.tags ?? []).map((t) => `#${t}`).join(' ')}` : ''}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <FavoriteButton active={m.isFavorite} label="Save memory to favourites" onToggle={async () => { await store.toggleFavorite('memories', m.id); refresh(); }} />
                        <Button variant="quiet" onClick={() => setSelected(m)}>Read more</Button>
                      </div>
                    </div>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </div>
      ) : layout === 'collage' ? (
        <div className="collage-wrap">
          {items.map((m, i) => (
            <div key={m.id} className="collage-item">
              <div className={`polaroid flex flex-col ${i % 3 === 0 ? 'rot-l' : i % 3 === 1 ? 'rot-r' : 'rot-0'}`}>
                <Washi tone={i % 3 === 0 ? 'sage' : i % 3 === 1 ? 'rose' : 'butter'} />
                {m.mediaUrl && <img src={m.mediaUrl} alt={m.caption || m.title} className="mb-3 w-full rounded-lg object-contain" loading="lazy" decoding="async" />}
                <button onClick={() => setSelected(m)} className="text-left"><span className="font-serif-display text-xl leading-snug text-ivory">{m.title}</span><span className="font-hand mt-1 block text-2xl leading-snug text-plum">{m.caption}</span></button>
                {(m.tags ?? []).length > 0 && <p className="mt-2 flex flex-wrap gap-1">{(m.tags ?? []).map((t) => <span key={t} className="rounded-full border border-cocoa/20 bg-cream px-2 py-0.5 text-xs text-cocoa-soft">#{t}</span>)}</p>}
                <p className="mt-auto pt-3 text-xs text-ivory-dim">{formatDate(m.happenedOn)} · {m.authorName}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <FavoriteButton active={m.isFavorite} label="Save memory to favourites" onToggle={async () => { await store.toggleFavorite('memories', m.id); refresh(); }} />
                  <Button variant="quiet" onClick={() => setSelected(m)}>Read more</Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="scrapbook-spread">
        <ul className="grid gap-3 scrapbook-grid sm:grid-cols-2 lg:grid-cols-3">
          {items.map((m, i) => (
            <li key={m.id}>
              <div className={`polaroid flex h-full flex-col ${i % 3 === 0 ? 'rot-l' : i % 3 === 1 ? 'rot-r' : 'rot-0'}`}>
                <Washi tone={i % 3 === 0 ? 'sage' : i % 3 === 1 ? 'rose' : 'butter'} />
                {/* Proportion-preserving: object-contain, no fixed aspect, so
                    a portrait photo is never cropped into a landscape box. */}
                {m.mediaUrl && <img src={m.mediaUrl} alt={m.caption || m.title} className="mb-3 w-full rounded-lg object-contain" loading="lazy" decoding="async" />}
                <button onClick={() => setSelected(m)} className="text-left"><span className="font-serif-display text-xl leading-snug text-ivory">{m.title}</span><span className="font-hand mt-1 block text-2xl leading-snug text-plum">{m.caption}</span></button>
                {(m.tags ?? []).length > 0 && <p className="mt-2 flex flex-wrap gap-1">{(m.tags ?? []).map((t) => <span key={t} className="rounded-full border border-cocoa/20 bg-cream px-2 py-0.5 text-xs text-cocoa-soft">#{t}</span>)}</p>}
                <p className="mt-auto pt-3 text-xs text-ivory-dim">{formatDate(m.happenedOn)} · {m.authorName}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <FavoriteButton active={m.isFavorite} label="Save memory to favourites" onToggle={async () => { await store.toggleFavorite('memories', m.id); refresh(); }} />
                  <Button variant="quiet" onClick={() => setSelected(m)}>Read more</Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
        </div>
      )}

      {showForm && <Modal title="Add a memory" onClose={() => { if (attemptLeave()) { setShowForm(false); setPhotoPreview(null); } }}>
        <div className="space-y-3 scrapbook-form">
          <p className="font-hand text-center text-2xl leading-snug text-plum">Place a photograph in the scrapbook — one photo per memory, stuck in with washi tape.</p>
          {photoPreview && <div className="memory-preview-polaroid"><Washi tone="rose" /><img src={photoPreview} alt="Preview of the photograph you chose" /><p className="font-hand mt-2 text-center text-2xl leading-none text-plum">{form.caption || 'your caption will sit here'}</p></div>}
          <Field label="Title"><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={inputCls} maxLength={200} placeholder="e.g. The walk home" /></Field>
          <Field label="Date it happened"><input type="date" value={form.happenedOn} onChange={(e) => setForm({ ...form, happenedOn: e.target.value })} className={inputCls} /></Field>
          <Field label="Caption"><input value={form.caption} onChange={(e) => setForm({ ...form, caption: e.target.value })} className={inputCls} maxLength={500} placeholder="One line to remember it by" /></Field>
          <Field label="Story (optional)"><textarea value={form.story} onChange={(e) => setForm({ ...form, story: e.target.value })} rows={4} className={inputCls} maxLength={5000} placeholder="The detail you do not want to forget…" /></Field>
          <Field label="Tags (optional)" hint="Comma-separated, e.g. trip, home — used by search."><input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} className={inputCls} maxLength={200} placeholder="trip, home" /></Field>
          <Field label="Photo (optional)" hint={store.mode === 'demo' ? 'In demo mode this photo stays on this device only. One photograph per memory — the memory holds a single photo, so a second photograph needs its own memory. Images only, up to 25 MB.' : 'Stored in private storage; only space members can open it. One photograph per memory. Images only, up to 25 MB, shown at their real proportions.'}><input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0] || null; setPhoto(f); setPhotoPreview(f ? URL.createObjectURL(f) : null); }} className="text-sm" /></Field>
          {saving && photo && <p role="status" className="text-sm text-cocoa-soft">Uploading your photo… (no percentage is shown — the upload API does not report progress, so this stays indeterminate until the photo is saved.)</p>}
          {saveFailed && <p role="alert" className="rounded-xl border border-cocoa/25 bg-rose px-3 py-2 text-sm">Saving failed: {saveFailed} <span className="mt-2 flex flex-wrap gap-2"><Button onClick={save} disabled={saving}>Try saving again</Button><Button variant="quiet" onClick={() => setSaveFailed(null)}>Dismiss</Button></span></p>}
          <div className="flex gap-2"><Button onClick={save} disabled={saving}>{saving ? 'Placing…' : 'Place it in the scrapbook'}</Button><Button variant="quiet" onClick={() => { if (attemptLeave()) { setShowForm(false); setPhotoPreview(null); } }}>Cancel</Button></div>
        </div>
      </Modal>}

      {selected && <Modal title={editing ? 'Edit memory' : selected.title} onClose={() => { if (!editing || attemptLeave()) { setSelected(null); setEditing(false); } }}>
        {!editing && <p className="font-hand mb-3 text-center text-2xl leading-snug text-plum">pasted in on {formatDate(selected.happenedOn)} · by {selected.authorName}</p>}
        {editing ? (
          <div className="space-y-3">
            <Field label="Title"><input value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} className={inputCls} maxLength={200} /></Field>
            <Field label="Date it happened"><input type="date" value={editForm.happenedOn} onChange={(e) => setEditForm({ ...editForm, happenedOn: e.target.value })} className={inputCls} /></Field>
            <Field label="Caption"><input value={editForm.caption} onChange={(e) => setEditForm({ ...editForm, caption: e.target.value })} className={inputCls} maxLength={500} /></Field>
            <Field label="Story (optional)"><textarea value={editForm.story} onChange={(e) => setEditForm({ ...editForm, story: e.target.value })} rows={4} className={inputCls} maxLength={5000} /></Field>
            <Field label="Tags (optional)" hint="Comma-separated."><input value={editForm.tags} onChange={(e) => setEditForm({ ...editForm, tags: e.target.value })} className={inputCls} maxLength={200} /></Field>
            <p className="text-xs text-ivory-dim">The photo itself cannot be replaced here — delete this memory and add it again with a new photo if the photo is wrong.</p>
            <div className="flex gap-2"><Button onClick={saveEdit}>Save changes</Button><Button variant="quiet" onClick={() => { if (attemptLeave()) setEditing(false); }}>Cancel</Button></div>
          </div>
        ) : (
          <div className="memory-viewer">
            <Washi tone="sage" />
            {selected.mediaUrl && <img src={selected.mediaUrl} alt={selected.caption} className="mb-3 w-full rounded-xl object-contain" />}
            <p className="font-hand mt-3 text-3xl leading-snug text-plum">{selected.caption}</p>
            {selected.story && <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ivory">{selected.story}</p>}
            {(selected.tags ?? []).length > 0 && <p className="mt-3 flex flex-wrap gap-1">{(selected.tags ?? []).map((t) => <span key={t} className="rounded-full border border-cocoa/20 bg-cream px-2 py-0.5 text-xs text-cocoa-soft">#{t}</span>)}</p>}
            <div className="mt-4 flex flex-wrap gap-2">
              <FavoriteButton active={selected.isFavorite} label="Save memory to favourites" onToggle={async () => { await store.toggleFavorite('memories', selected.id); refresh(); setSelected({ ...selected, isFavorite: !selected.isFavorite }); }} />
              <Button variant="quiet" onClick={() => { setEditForm({ title: selected.title, caption: selected.caption, story: selected.story, happenedOn: selected.happenedOn, tags: (selected.tags ?? []).join(', ') }); setEditing(true); }}>Edit</Button>
              <ConfirmDelete onConfirm={async () => { await store.softDelete('memories', selected.id); setSelected(null); refresh(); notify('Moved to Deleted.'); }} />
            </div>
          </div>
        )}
      </Modal>}
    </RoomWorld>
  );
}
