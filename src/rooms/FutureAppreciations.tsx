import { useMemo, useState } from 'react';
import type { PlaceStore } from '../lib/store';
import type { Appreciation, CollectionName } from '../lib/types';
import { formatDate, validateImageFile, validateRequired } from '../lib/utils';
import { Page, Card, Button, Field, inputCls, Modal, FavoriteButton, ConfirmDelete } from '../components/ui';
import { RoomEmpty, CreateEntry } from '../components/design-primitives';
import { useDirtyGuard } from '../lib/dirtyGuard';
import { RoomWorld } from '../components/RoomWorld';

type Props = { store: PlaceStore; refresh: () => void; notify: (m: string, k?: 'ok' | 'error') => void; onSwitchViewer?: () => void; viewerLabel?: string; otherViewerLabel?: string };

const KIND_LABEL: Record<Appreciation['kind'], string> = { appreciation: 'Appreciation', achievement: 'Achievement', encouragement: 'Encouragement' };

/* Phase 12, Appreciations: the personal museum. Notes are framed cards
   with a keepsake label underneath, and the kind filters are the
   collections (Appreciation / Achievement / Encouragement), now with
   real counts from the partners' own notes. "On display" picks one real
   note at random from the current collection — never an invented
   quality or history, and nothing at all when the collection is empty.
   Phase 12B: the museum is now a full-screen world (RoomWorld, same
   shell as 12A). Clicking a framed note opens the full note in a
   viewer; the Keepsake Box below is a view over favourited notes only
   (the same favourites Home already hangs as bunting — one mechanism,
   not a second collection). The recipient is now chosen from the
   space's real members on the existing forName field, defaulting to
   the other member — previously creation hardcoded 'Partner', so a
   note written while viewing as Partner was addressed to itself.
   Editing and deleting are author-only in the UI (previously Edit was
   gated but Delete was not). Honest model limits, stated in the room
   itself: notes hold words only — there is no photo field and no
   separate date field for appreciations, so the date shown is when the
   note was left; the brief's five browse categories do not exist as a
   field, so browsing stays on the three kinds the model stores. */
export function AppreciationsRoom({ store, refresh, notify, onSwitchViewer, viewerLabel = 'You', otherViewerLabel = 'Partner' }: Props) {
  const [text, setText] = useState('');
  const [kind, setKind] = useState<Appreciation['kind']>('appreciation');
  const [forName, setForName] = useState(() => {
    const other = store.data.members.find((m) => m.id !== store.viewerId);
    return other ? other.displayName : 'Partner';
  });
  const [filter, setFilter] = useState<'all' | Appreciation['kind']>('all');
  const [onlyFav, setOnlyFav] = useState(false);
  const [sort, setSort] = useState<'new' | 'old'>('new');
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editKind, setEditKind] = useState<Appreciation['kind']>('appreciation');
  const [editForName, setEditForName] = useState('Partner');
  const [selected, setSelected] = useState<Appreciation | null>(null);
  const [onDisplay, setOnDisplay] = useState<Appreciation | null>(null);
  const appreciationDirty = Boolean(text.trim()) || (editing !== null && (editText !== (store.shared(store.data.appreciations).find((a) => a.id === editing)?.text ?? '') || editKind !== (store.shared(store.data.appreciations).find((a) => a.id === editing)?.kind ?? 'appreciation')));
  useDirtyGuard(appreciationDirty, {
    label: 'a note you are writing',
    isDirty: () => appreciationDirty,
    discard: () => { setText(''); setEditing(null); setEditText(''); },
  });

  const counts = useMemo(() => {
    const all = store.shared(store.data.appreciations);
    return { all: all.length, appreciation: all.filter((i) => i.kind === 'appreciation').length, achievement: all.filter((i) => i.kind === 'achievement').length, encouragement: all.filter((i) => i.kind === 'encouragement').length };
  }, [store.version]);
  const items = useMemo(() => {
    let list = store.shared(store.data.appreciations);
    if (filter !== 'all') list = list.filter((i) => i.kind === filter);
    if (onlyFav) list = list.filter((i) => i.isFavorite);
    const sorted = [...list];
    sorted.sort((a, b) => sort === 'new' ? b.createdAt.localeCompare(a.createdAt) : a.createdAt.localeCompare(b.createdAt));
    return sorted;
  }, [store.version, filter, onlyFav, sort]);

  const pickRandom = () => {
    if (!items.length) return notify('No notes in this collection yet — write the first one.', 'error');
    setOnDisplay(items[Math.floor(Math.random() * items.length)]);
  };

  const save = async () => {
    const err = validateRequired(text, 'Your note', 2000);
    if (err) return notify(err, 'error');
    setSaving(true);
    try {
      await store.create('appreciations', { spaceId: store.data.space.id, authorId: store.viewerId, authorName: store.viewerName, text: text.trim(), kind, forName: forName.trim() || 'Partner' });
      setText(''); refresh(); notify('Noted — and it matters more than you think.');
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not save.', 'error'); } finally { setSaving(false); }
  };

  const keepsakes = useMemo(() => store.shared(store.data.appreciations).filter((i) => i.isFavorite), [store.version]);
  const memberNames = useMemo(() => store.data.members.map((m) => m.displayName), [store.version]);

  return (
    <RoomWorld room="appreciations" title="Things I See in You" handNote="our little museum — framed notes, paper labels, flowers on the sill"
      intro="Welcome to the little museum — every frame on the wall holds something true that was noticed and kept."
      subtitle="Appreciation, achievements, and encouragement — specific, not generic. Name the thing you actually noticed. Tap a framed note to read it in full."
      actions={<Button variant="quiet" onClick={pickRandom}>Show me one at random</Button>}
      decor={<p className="pressed-flowers" aria-hidden="true"><span>✿</span><span>❦</span><span>✿</span><span>✦</span><span>✿</span></p>}
      isDemo={store.mode === 'demo'} viewerLabel={viewerLabel} otherViewerLabel={otherViewerLabel} onSwitchViewer={onSwitchViewer}>
      <CreateEntry room="appreciations" note="hung on the gallery wall">
      <Card className="mb-5">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="md:col-span-2"><Field label="What do you see in them?"><textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className={inputCls} maxLength={2000} placeholder="e.g. The way you stayed patient when the plan fell apart…" /></Field></div>
          <Field label="Kind of note"><select value={kind} onChange={(e) => setKind(e.target.value as Appreciation['kind'])} className={inputCls}><option value="appreciation">Appreciation</option><option value="achievement">Achievement</option><option value="encouragement">Encouragement</option></select></Field>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <Field label="This note is for"><select value={forName} onChange={(e) => setForName(e.target.value)} className={inputCls}>{memberNames.map((n) => <option key={n} value={n}>{n}</option>)}</select></Field>
          <p className="self-end text-xs leading-relaxed text-cocoa-soft">Notes hold words only — there is no photograph field for appreciations, and the date shown on a note is the day it was left.</p>
        </div>
        <div className="mt-3"><Button onClick={save} disabled={saving}>{saving ? 'Leaving…' : 'Leave this note'}</Button></div>
      </Card>
      </CreateEntry>

      {onDisplay && (
        <Card className="mb-5 border-gold/40">
          <p className="text-xs uppercase tracking-widest text-gold-soft">On display · from the {KIND_LABEL[onDisplay.kind]} collection</p>
          <p className="font-serif-display mt-2 text-xl leading-relaxed">“{onDisplay.text}”</p>
          <p className="mt-2 text-sm text-ivory-dim">From {onDisplay.authorName} · {formatDate(onDisplay.createdAt)}</p>
          <div className="mt-3 flex flex-wrap gap-2"><Button variant="quiet" onClick={pickRandom}>Show me another</Button><Button variant="quiet" onClick={() => setOnDisplay(null)}>Put it back</Button></div>
        </Card>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Collections">
        <span className="text-sm font-bold text-cocoa">Collections:</span>
        {(['all', 'appreciation', 'achievement', 'encouragement'] as const).map((k) => (
          <button key={k} onClick={() => setFilter(k)} aria-pressed={filter === k} className={`min-h-11 rounded-full px-4 py-2 text-sm ${filter === k ? 'bg-gold text-night-900' : 'border border-cocoa/25 text-ivory'}`}>{k === 'all' ? `All (${counts.all})` : `${KIND_LABEL[k]} (${counts[k]})`}</button>
        ))}
        <Button variant={onlyFav ? 'primary' : 'quiet'} onClick={() => setOnlyFav(!onlyFav)}>Favourites only</Button>
        <Button variant="quiet" onClick={pickRandom}>Show me one at random</Button>
        <label className="flex items-center gap-2 text-sm text-ivory-dim">Browse <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className={`${inputCls} w-auto`}><option value="new">Newest first</option><option value="old">Oldest first</option></select></label>
      </div>

      {items.length === 0 ? <RoomEmpty room="appreciations" title="Nothing here yet" body="Start with one specific thing — a moment, a quality, a small win. Specific beats grand, every time." /> : (
        <div className="museum-wall museum-shelf">
        <ul className="grid gap-3 sm:grid-cols-2">
          {items.map((a) => (
            <li key={a.id}>
              <Card className="museum-frame">
                <p aria-hidden="true" className="text-center text-xl">✧</p>
                <p className="text-xs uppercase tracking-widest text-gold-soft">{KIND_LABEL[a.kind]} · for {a.forName}</p>
                {editing === a.id ? (
                  <div className="mt-3 space-y-2">
                    <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={3} className={inputCls} maxLength={2000} aria-label="Edit note" />
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Kind of note"><select value={editKind} onChange={(e) => setEditKind(e.target.value as Appreciation['kind'])} className={inputCls}><option value="appreciation">Appreciation</option><option value="achievement">Achievement</option><option value="encouragement">Encouragement</option></select></Field>
                      <Field label="This note is for"><select value={editForName} onChange={(e) => setEditForName(e.target.value)} className={inputCls}>{memberNames.map((n) => <option key={n} value={n}>{n}</option>)}</select></Field>
                    </div>
                    <div className="flex gap-2"><Button onClick={async () => { const err = validateRequired(editText, 'Your note', 2000); if (err) return notify(err, 'error'); await store.update('appreciations', a.id, { text: editText.trim(), kind: editKind, forName: editForName }); setEditing(null); refresh(); notify('Note updated.'); }}>Save</Button><Button variant="quiet" onClick={() => setEditing(null)}>Cancel</Button></div>
                  </div>
                ) : (
                  <button type="button" onClick={() => setSelected(a)} className="museum-exhibit text-left" aria-label={`Read the full note: ${a.text.slice(0, 60)}`}>
                    <span className="font-serif-display mt-2 block text-lg leading-relaxed">“{a.text}”</span>
                    <span className="mt-1 block text-xs text-cocoa-soft">Tap to read the full note</span>
                  </button>
                )}
                <p className="mt-3 text-xs text-ivory-dim">From {a.authorName} · for {a.forName} · {formatDate(a.createdAt)}</p>
                <p><span className="museum-label">{KIND_LABEL[a.kind]} · kept with care</span></p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <FavoriteButton active={a.isFavorite} label="Save note to favourites" onToggle={async () => { await store.toggleFavorite('appreciations', a.id); refresh(); }} />
                  {/* Personal-voice note: only its author edits or deletes its words. */}
                  {a.authorId === store.viewerId && <Button variant="quiet" onClick={() => { setEditing(a.id); setEditText(a.text); setEditKind(a.kind); setEditForName(a.forName); }}>Edit</Button>}
                  {a.authorId === store.viewerId && <ConfirmDelete onConfirm={async () => { await store.softDelete('appreciations', a.id); refresh(); notify('Moved to Deleted.'); }} />}
                </div>
              </Card>
            </li>
          ))}
        </ul>
        </div>
      )}

      {keepsakes.length > 0 && (
        <section aria-label="Keepsake Box" className="keepsake-strip mt-5">
          <h2 className="font-serif-display text-xl">The Keepsake Box</h2>
          <p className="mt-1 text-sm leading-relaxed text-cocoa-soft">Favourite notes, kept together here — the same favourites Home hangs as bunting, not a second collection. Tap one to read it in full.</p>
          <ul className="mt-3 space-y-2">
            {keepsakes.map((a) => (
              <li key={a.id}><button type="button" onClick={() => setSelected(a)} className="w-full rounded-xl border border-cocoa/20 bg-paper px-3 py-2 text-left text-sm leading-relaxed"><span className="font-bold">{KIND_LABEL[a.kind]}</span> · “{a.text.length > 110 ? `${a.text.slice(0, 110)}…` : a.text}” <span className="text-cocoa-soft">— from {a.authorName}, for {a.forName}</span></button></li>
            ))}
          </ul>
        </section>
      )}

      {selected && <Modal title="A note from the museum wall" onClose={() => setSelected(null)}>
        <p className="text-xs uppercase tracking-widest text-gold-soft">{KIND_LABEL[selected.kind]} · for {selected.forName}</p>
        <p className="font-serif-display mt-3 text-xl leading-relaxed">“{selected.text}”</p>
        <p className="mt-3 text-sm text-cocoa-soft">From {selected.authorName} · left {formatDate(selected.createdAt)}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <FavoriteButton active={selected.isFavorite} label="Save note to favourites" onToggle={async () => { await store.toggleFavorite('appreciations', selected.id); refresh(); setSelected({ ...selected, isFavorite: !selected.isFavorite }); }} />
          {selected.authorId === store.viewerId && <Button variant="quiet" onClick={() => { setEditing(selected.id); setEditText(selected.text); setEditKind(selected.kind); setEditForName(selected.forName); setSelected(null); }}>Edit this note</Button>}
          {selected.authorId === store.viewerId && <ConfirmDelete onConfirm={async () => { await store.softDelete('appreciations', selected.id); setSelected(null); refresh(); notify('Moved to Deleted.'); }} />}
          <Button variant="quiet" onClick={() => setSelected(null)}>Put it back</Button>
        </div>
      </Modal>}
    </RoomWorld>
  );
}

export function FutureRoom({ store, refresh, notify, onSwitchViewer, viewerLabel = 'You', otherViewerLabel = 'Partner' }: Props) {
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [category, setCategory] = useState<'bucket' | 'date' | 'plan'>('date');
  const [targetDate, setTargetDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'planned' | 'done'>('all');
  const [catFilter, setCatFilter] = useState<'all' | 'bucket' | 'date' | 'plan'>('all');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [completing, setCompleting] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ title: '', detail: '', category: 'date' as 'bucket' | 'date' | 'plan', targetDate: '' });
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmKeep, setConfirmKeep] = useState<string | null>(null);
  const planDirty = Boolean(title.trim() || detail.trim() || targetDate) || (editing !== null && (() => { const orig = store.shared(store.data.plans).find((x) => x.id === editing); return !orig || editForm.title !== orig.title || editForm.detail !== orig.detail || editForm.category !== orig.category || editForm.targetDate !== (orig.targetDate ?? ''); })());
  useDirtyGuard(planDirty, {
    label: 'a plan you are writing',
    isDirty: () => planDirty,
    discard: () => { setTitle(''); setDetail(''); setTargetDate(''); setEditing(null); },
  });

  /* Phase 12, Future: the adventure map. Destinations are stops along a
     dashed trail, ordered by target date (dated plans first, undated
     after), so the map reads like a journey rather than a grid. Planned
     stops get a map pin, done stops get a flag. The states are exactly
     the ones the database allows — planned and done. An "in-progress"
     state would need a status CHECK change, so it is listed as deferred
     rather than faked in the UI. Completion photos, target dates, edit,
     mark-done and soft-delete all live inside each stop, unchanged.
     Phase 12B: the map is now a full-screen world (RoomWorld, same
     shell as 12A) with a clickable marker map — every marker opens
     its plan — an "up next" strip derived from planned target dates,
     and a confirmed-only plan-to-memory step for done plans: it uses
     the existing memory-create path (title, detail as story, completion
     photo if one exists, completion date or today), creates nothing
     without an explicit confirmation, and never touches the plan
     itself. Board-game locations are NOT derived from plans — the
     board's spaces are a fixed config — so no such link is shown or
     implied. The brief's six browse categories do not exist as a
     field; browsing stays on the three kinds the model stores. */
  const upcoming = useMemo(() => {
    const planned = store.shared(store.data.plans).filter((i) => i.status === 'planned');
    const dated = planned.filter((i) => i.targetDate).sort((a, b) => (a.targetDate as string).localeCompare(b.targetDate as string));
    return dated[0] ?? planned.sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0] ?? null;
  }, [store.version]);
  const selectedPlan = selected ? store.shared(store.data.plans).find((p) => p.id === selected) ?? null : null;

  const keepAsMemory = async (id: string) => {
    const p = store.shared(store.data.plans).find((i) => i.id === id);
    if (!p) return;
    try {
      await store.create('memories', {
        spaceId: store.data.space.id, authorId: store.viewerId, authorName: store.viewerName,
        title: p.title, caption: p.detail ? p.detail.slice(0, 500) : p.title,
        story: `Kept from Our Future: ${p.title}${p.detail ? ` — ${p.detail}` : ''}${p.completedAt ? ` Completed ${formatDate(p.completedAt)}.` : ''}`,
        happenedOn: p.completedAt ? p.completedAt.slice(0, 10) : new Date().toISOString().slice(0, 10),
        mediaUrl: p.completionPhotoUrl, mediaPath: p.completionPhotoPath, mediaType: p.completionPhotoUrl ? 'photo' : 'none', tags: [],
      });
      setConfirmKeep(null); setSelected(null); refresh(); notify('Kept as a memory on the Memory Wall. The plan itself is unchanged.');
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not keep it as a memory.', 'error'); }
  };
  const items = useMemo(() => {
    let list = store.shared(store.data.plans).slice();
    if (statusFilter !== 'all') list = list.filter((i) => i.status === statusFilter);
    if (catFilter !== 'all') list = list.filter((i) => i.category === catFilter);
    list.sort((a, b) => {
      if (a.targetDate && b.targetDate) return a.targetDate.localeCompare(b.targetDate);
      if (a.targetDate) return -1;
      if (b.targetDate) return 1;
      return b.createdAt.localeCompare(a.createdAt);
    });
    return list;
  }, [store.version, statusFilter, catFilter]);
  const mapCounts = useMemo(() => {
    const all = store.shared(store.data.plans);
    return { planned: all.filter((i) => i.status === 'planned').length, done: all.filter((i) => i.status === 'done').length };
  }, [store.version]);

  const save = async () => {
    const err = validateRequired(title, 'A title', 200);
    if (err) return notify(err, 'error');
    setSaving(true);
    try {
      await store.create('plans', { spaceId: store.data.space.id, authorId: store.viewerId, authorName: store.viewerName, title: title.trim(), detail: detail.trim(), category, status: 'planned', targetDate: targetDate || null, completedAt: null, completionPhotoUrl: null, completionPhotoPath: null });
      setTitle(''); setDetail(''); setTargetDate(''); refresh(); notify('Added to Our Future.');
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not save.', 'error'); } finally { setSaving(false); }
  };

  const complete = async (id: string) => {
    if (photoFile) { const fileErr = validateImageFile(photoFile); if (fileErr) return notify(fileErr, 'error'); }
    try {
      let url: string | null = null; let path: string | null = null;
      if (photoFile) { const up = await store.uploadMedia(photoFile, 'photo'); url = up.url; path = up.path || null; }
      await store.update('plans', id, { status: 'done', completedAt: new Date().toISOString(), completionPhotoUrl: url, completionPhotoPath: path });
      setCompleting(null); setPhotoFile(null); refresh(); notify('Done — and kept, with a photo if you added one.');
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not mark it done.', 'error'); }
  };

  return (
    <RoomWorld room="future" title="Our Future" handNote="the adventure map — little islands, winding paths, pins where we mean to go"
      intro="Unfold the map — every island is a plan waiting for its day, and every path is one you can choose."
      subtitle="Bucket lists, date ideas, and plans — with a clear done state, and an optional photo only after you actually do it. Tap a marker on the map to open its plan."
      actions={<><Button variant="quiet" onClick={() => setStatusFilter(statusFilter === 'done' ? 'all' : 'done')}>{statusFilter === 'done' ? 'Show all stops' : 'Show visited stops'}</Button><Button variant="quiet" onClick={() => document.getElementById('future-create')?.scrollIntoView({ block: 'start' })}>Add a new stop</Button></>}
      decor={<p className="pressed-flowers" aria-hidden="true"><span>⌖</span><span>⚑</span><span>✦</span><span>⌖</span><span>⚑</span></p>}
      isDemo={store.mode === 'demo'} viewerLabel={viewerLabel} otherViewerLabel={otherViewerLabel} onSwitchViewer={onSwitchViewer}>





      {items.length > 0 && (
        <section aria-label="Adventure map" className="map-scene mb-5">
          <h2 className="font-serif-display text-xl">The map itself</h2>
          <p className="mt-1 text-sm leading-relaxed text-cocoa-soft">Every stop below is a real plan — tap a marker to open it. A completed stop keeps its flag, and can be kept as a Memory Wall entry from its own card, only after you confirm.</p>
          <div className="map-markers mt-3">
            {items.map((p) => (
              <button key={p.id} type="button" onClick={() => setSelected(p.id)} className={`map-marker-btn${p.status === 'done' ? ' done' : ''}`} aria-label={`Open plan: ${p.title}${p.status === 'done' ? ', visited' : ', still to do'}`}>
                <span aria-hidden="true">{p.status === 'done' ? '⚑' : '⌖'}</span> {p.title}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-cocoa-soft">Our Little World board-game spaces are fixed — plans do not become board locations. That link does not exist in the board engine, so none is shown here.</p>
        </section>
      )}

      {upcoming && (
        <section aria-label="Up next" className="upcoming-strip mb-4">
          <p className="text-xs uppercase tracking-widest text-cocoa-soft">Up next on the map</p>
          <button type="button" onClick={() => setSelected(upcoming.id)} className="mt-1 text-left"><span className="font-serif-display text-xl leading-snug">{upcoming.title}</span>{upcoming.targetDate && <span className="ml-2 text-sm text-cocoa-soft">hoped for {formatDate(upcoming.targetDate)} — a hope, not a deadline</span>}</button>
          <p className="mt-1 text-sm text-cocoa-soft">Tap it to open the plan. No date in mind yet? Undated plans wait at the end of the trail.</p>
        </section>
      )}

      <p className="mb-4 text-sm text-ivory-dim">{mapCounts.planned} destination{mapCounts.planned === 1 ? '' : 's'} still to visit · {mapCounts.done} already visited{mapCounts.done ? ' — flagged on the map above' : ''}. Ordered by target date, undated plans at the end of the trail.</p>
      <p className="future-legend">Map key: ⌖ trail stop — still to do · ⚑ flag — visited and collected</p>

      <div className="mb-4 flex flex-wrap gap-2">
        {(['all', 'planned', 'done'] as const).map((s) => <button key={s} onClick={() => setStatusFilter(s)} aria-pressed={statusFilter === s} className={`min-h-11 rounded-full px-4 py-2 text-sm ${statusFilter === s ? 'bg-gold text-night-900' : 'border border-cocoa/25 text-ivory'}`}>{s === 'all' ? 'All' : s === 'planned' ? 'Still to do' : 'Done'}</button>)}
        {(['all', 'bucket', 'date', 'plan'] as const).map((c) => <button key={c} onClick={() => setCatFilter(c)} aria-pressed={catFilter === c} className={`min-h-11 rounded-full px-4 py-2 text-sm ${catFilter === c ? 'bg-gold text-night-900' : 'border border-cocoa/25 text-ivory'}`}>{c === 'all' ? 'Every kind' : c === 'bucket' ? 'Bucket list' : c === 'date' ? 'Date ideas' : 'Plans'}</button>)}
      </div>

      {items.length === 0 ? <RoomEmpty room="future" title="Nothing planned yet" body="Add something small first. A future does not have to start grand — it just has to start." /> : (
        <div className="map-trail">
        <ul className="space-y-4">
          {items.map((p) => (
            <li key={p.id} className="relative">
              <span className={`map-pin ${p.status === 'done' ? 'bg-cottage-mint' : 'bg-cottage-butter'}`} aria-hidden="true">{p.status === 'done' ? '⚑' : '⌖'}</span>
              <Card className={p.status === 'done' ? 'future-done' : 'future-planned'}>
                <p className="text-xs uppercase tracking-widest text-blue-soft">{p.category === 'bucket' ? 'Bucket list' : p.category === 'date' ? 'Date idea' : 'Plan'} · {p.status === 'done' ? 'Done ✓' : 'Planned'}</p>
                {editing === p.id ? (
                  <div className="mt-3 space-y-2">
                    <Field label="What shall we do?"><input value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} className={inputCls} maxLength={200} /></Field>
                    <Field label="Details (optional)"><textarea value={editForm.detail} onChange={(e) => setEditForm({ ...editForm, detail: e.target.value })} rows={2} className={inputCls} maxLength={2000} /></Field>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Kind"><select value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value as typeof editForm.category })} className={inputCls}><option value="date">Date idea</option><option value="bucket">Bucket list</option><option value="plan">Plan</option></select></Field>
                      <Field label="Target date (optional)"><input type="date" value={editForm.targetDate} onChange={(e) => setEditForm({ ...editForm, targetDate: e.target.value })} className={inputCls} /></Field>
                    </div>
                    <div className="flex gap-2"><Button onClick={async () => { await store.update('plans', p.id, { title: editForm.title.trim(), detail: editForm.detail.trim(), category: editForm.category, targetDate: editForm.targetDate || null }); setEditing(null); refresh(); notify('Plan updated.'); }}>Save changes</Button><Button variant="quiet" onClick={() => setEditing(null)}>Cancel</Button></div>
                  </div>
                ) : (
                  <>
                    <p className="font-serif-display mt-2 text-xl leading-snug">{p.title}</p>
                    {p.detail && <p className="mt-1 text-sm leading-relaxed text-ivory-dim">{p.detail}</p>}
                    {p.targetDate && <p className="mt-1 text-sm text-ivory-dim">Target: {formatDate(p.targetDate)}</p>}
                  </>
                )}
                {p.status === 'done' && p.completionPhotoUrl && <img src={p.completionPhotoUrl} alt={`After completing: ${p.title}`} className="mt-3 w-full rounded-xl object-contain" loading="lazy" decoding="async" />}
                {p.status === 'done' && p.completedAt && <p className="mt-2 text-xs text-ivory-dim">Completed {formatDate(p.completedAt)}</p>}
                <p className="mt-2 text-xs text-ivory-dim">Added by {p.authorName}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="quiet" onClick={() => setSelected(p.id)}>Open plan</Button>
                  {p.status === 'planned' && <Button variant="quiet" onClick={() => setCompleting(p.id)}>Mark done</Button>}
                  {p.status === 'done' && <Button variant="quiet" onClick={async () => { await store.update('plans', p.id, { status: 'planned', completedAt: null }); refresh(); }}>Back to planned</Button>}
                  {p.status === 'done' && (confirmKeep === p.id ? (
                    <span className="inline-flex flex-wrap items-center gap-2"><span className="text-xs text-cocoa-soft">Keep this as a Memory Wall entry too? The plan stays as it is.</span><Button onClick={() => keepAsMemory(p.id)}>Yes, keep it as a memory</Button><Button variant="quiet" onClick={() => setConfirmKeep(null)}>Not yet</Button></span>
                  ) : <Button variant="quiet" onClick={() => setConfirmKeep(p.id)}>Keep as a memory</Button>)}
                  <FavoriteButton active={p.isFavorite} label="Save plan to favourites" onToggle={async () => { await store.toggleFavorite('plans', p.id); refresh(); }} />
                  {/* Shared plan: either member may edit it. */}
                  <Button variant="quiet" onClick={() => { setEditing(p.id); setEditForm({ title: p.title, detail: p.detail, category: p.category, targetDate: p.targetDate ?? '' }); }}>Edit</Button>
                  <ConfirmDelete onConfirm={async () => { await store.softDelete('plans', p.id); refresh(); notify('Moved to Deleted.'); }} />
                </div>
                {completing === p.id && (
                  <div className="mt-3 space-y-2 rounded-xl border border-cocoa/15 p-3">
                    <Field label="Photo from after you did it (optional)" hint="Completion photos are only added here, after the activity — never as a placeholder before it."><input type="file" accept="image/*" onChange={(e) => setPhotoFile(e.target.files?.[0] || null)} className="text-sm" /></Field>
                    <div className="flex gap-2"><Button onClick={() => complete(p.id)}>Confirm done</Button><Button variant="quiet" onClick={() => { setCompleting(null); setPhotoFile(null); }}>Not yet</Button></div>
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
        </div>
      )}


      <section id="future-create" aria-label="Add a new stop" className="mt-6">
        <h2 className="font-serif-display mb-3 text-2xl">Add a new stop to the map</h2>
      <CreateEntry room="future" note="a new stop on the map">
      <Card className="mb-5">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="What shall we do?"><input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} maxLength={200} placeholder="e.g. Cook a meal together, no phones" /></Field>
          <Field label="Kind"><select value={category} onChange={(e) => setCategory(e.target.value as typeof category)} className={inputCls}><option value="date">Date idea</option><option value="bucket">Bucket list</option><option value="plan">Plan</option></select></Field>
        </div>
        <div className="mt-3"><Field label="Details (optional)"><textarea value={detail} onChange={(e) => setDetail(e.target.value)} rows={2} className={inputCls} maxLength={2000} placeholder="Where, when, what to bring…" /></Field></div>
        <div className="mt-3"><Field label="Target date (optional)" hint="A hope, not a deadline — leave it blank if there is no date in mind yet."><input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className={inputCls} /></Field></div>
        <div className="mt-3"><Button onClick={save} disabled={saving}>{saving ? 'Adding…' : 'Add to Our Future'}</Button></div>
      </Card>
      </CreateEntry>
      </section>

      {selectedPlan && <Modal title={selectedPlan.title} onClose={() => setSelected(null)}>
        <p className="text-xs uppercase tracking-widest text-blue-soft">{selectedPlan.category === 'bucket' ? 'Bucket list' : selectedPlan.category === 'date' ? 'Date idea' : 'Plan'} · {selectedPlan.status === 'done' ? 'Done ✓' : 'Planned'}</p>
        {selectedPlan.detail && <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{selectedPlan.detail}</p>}
        {selectedPlan.targetDate && <p className="mt-2 text-sm text-cocoa-soft">Target: {formatDate(selectedPlan.targetDate)} — a hope, not a deadline.</p>}
        {selectedPlan.status === 'done' && selectedPlan.completedAt && <p className="mt-2 text-sm text-cocoa-soft">Completed {formatDate(selectedPlan.completedAt)}</p>}
        {selectedPlan.status === 'done' && selectedPlan.completionPhotoUrl && <img src={selectedPlan.completionPhotoUrl} alt={`After completing: ${selectedPlan.title}`} className="mt-3 w-full rounded-xl object-contain" loading="lazy" decoding="async" />}
        <p className="mt-3 text-sm text-cocoa-soft">Added by {selectedPlan.authorName} · {selectedPlan.isFavorite ? 'saved to favourites' : 'not favourited'}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <FavoriteButton active={selectedPlan.isFavorite} label="Save plan to favourites" onToggle={async () => { await store.toggleFavorite('plans', selectedPlan.id); refresh(); setSelected(selectedPlan.id); }} />
          {selectedPlan.status === 'planned' && <Button variant="quiet" onClick={() => { setSelected(null); setCompleting(selectedPlan.id); }}>Mark done</Button>}
          {selectedPlan.status === 'done' && (confirmKeep === selectedPlan.id ? (
            <span className="inline-flex flex-wrap items-center gap-2"><span className="text-xs text-cocoa-soft">Keep this as a Memory Wall entry too? The plan stays as it is.</span><Button onClick={() => keepAsMemory(selectedPlan.id)}>Yes, keep it as a memory</Button><Button variant="quiet" onClick={() => setConfirmKeep(null)}>Not yet</Button></span>
          ) : <Button variant="quiet" onClick={() => setConfirmKeep(selectedPlan.id)}>Keep as a memory</Button>)}
          <Button variant="quiet" onClick={() => setSelected(null)}>Close</Button>
        </div>
      </Modal>}
    </RoomWorld>
  );
}

const COLLECTION_LABEL: Record<CollectionName, string> = { reminders: 'Reminder', memories: 'Memory', letters: 'Letter', journals: 'Private journal', appreciations: 'Note', plans: 'Future plan', voiceNotes: 'Voice note' };

export function DeletedRoom({ store, refresh, notify }: Props) {
  const [confirmPurge, setConfirmPurge] = useState<string | null>(null);
  /* Phase 12A privacy fix (frontend filter only, no model change):
     deletedItems() returns every soft-deleted item in local data, so in
     demo mode a partner's deleted journal TITLE and a partner's deleted
     private-draft title were listed here — a leak of private content
     into a shared surface, contradicting the Quiet Room and Letters
     privacy rules. Journals and private drafts are now shown only to
     their author. (In synced mode the journals query is author-only
     anyway, so this is defence in depth there and the actual fix in
     demo mode.) Shared items stay visible to both members, as before. */
  const items = store.deletedItems().filter(({ collection, item }) => {
    if (collection === 'journals') return item.authorId === store.viewerId;
    if (collection === 'letters' && (item as { visibility?: string }).visibility === 'private_draft') return item.authorId === store.viewerId;
    return true;
  });
  return (
    <Page identity="deleted" title="Deleted — recoverable" subtitle="Deletion here is soft, not instant and final. Everything below can be restored, or permanently deleted in a second, deliberate step. Permanent deletion cannot be undone.">
      {items.length === 0 ? <RoomEmpty room="deleted" title="Nothing deleted" body="When you delete something from a room, it lands here first — so a tired tap does not erase a memory." /> : (
        <div className="keepsake-box">
        <ul className="space-y-3">
          {items.map(({ collection, item }) => (
            <li key={`${collection}-${item.id}`}>
              <Card className="keepsake-item">
                <p className="text-sm text-ivory-dim">{COLLECTION_LABEL[collection]} · deleted {formatDate(item.deletedAt)} · by {item.authorName}</p>
                <p className="font-serif-display mt-1 text-lg">{'title' in item ? (item as { title: string }).title : 'text' in item ? (item as { text: string }).text.slice(0, 80) : 'Untitled'}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button onClick={async () => { await store.restore(collection, item.id); refresh(); notify('Restored.'); }}>Restore</Button>
                  {confirmPurge === item.id ? (
                    <span className="inline-flex flex-wrap items-center gap-2"><span className="text-xs text-ivory-dim">Permanently delete, for good?</span><Button variant="danger" onClick={async () => { await store.purge(collection, item.id); setConfirmPurge(null); refresh(); notify('Permanently deleted.'); }}>Yes, delete forever</Button><Button variant="quiet" onClick={() => setConfirmPurge(null)}>Keep in Deleted</Button></span>
                  ) : <Button variant="danger" onClick={() => setConfirmPurge(item.id)}>Delete permanently</Button>}
                </div>
              </Card>
            </li>
          ))}
        </ul>
        </div>
      )}
    </Page>
  );
}
