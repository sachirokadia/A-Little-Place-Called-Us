import { useMemo, useState } from 'react';
import type { PlaceStore } from '../lib/store';
import type { Memory } from '../lib/types';
import { formatDate, todayIsoDate, validateRequired } from '../lib/utils';
import { Page, Card, Empty, Button, Field, inputCls, Modal, FavoriteButton, ConfirmDelete, Washi } from '../components/ui';

type Props = { store: PlaceStore; refresh: () => void; notify: (m: string, k?: 'ok' | 'error') => void };

export function RemindersRoom({ store, refresh, notify }: Props) {
  const [text, setText] = useState('');
  const [onlyFav, setOnlyFav] = useState(false);
  const [random, setRandom] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const items = useMemo(() => {
    let list = store.shared(store.data.reminders).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (onlyFav) list = list.filter((i) => i.isFavorite);
    return list;
  }, [store.version, onlyFav]);

  const save = async () => {
    const err = validateRequired(text, 'A note', 2000);
    if (err) return notify(err, 'error');
    try {
      await store.create('reminders', { spaceId: store.data.space.id, authorId: store.viewerId, authorName: store.viewerName, text: text.trim(), kind: 'note' });
      setText(''); refresh(); notify('Note left in the Reminder Room.');
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not save.', 'error'); }
  };

  const pickRandom = () => {
    const pool = store.shared(store.data.reminders);
    if (!pool.length) return notify('No notes yet — write the first one.', 'error');
    setRandom(pool[Math.floor(Math.random() * pool.length)].text);
  };

  return (
    <Page title="Reminder Room" subtitle="Personal encouragement, left for ordinary days. Nothing here expires, and nothing here nags — come back when you want to." actions={<>
      <Button variant="quiet" onClick={pickRandom}>Surprise me</Button>
      <Button variant={onlyFav ? 'primary' : 'quiet'} onClick={() => setOnlyFav(!onlyFav)}>{onlyFav ? 'Showing favourites' : 'Favourites only'}</Button>
    </>}>
      {random && <Card className="mb-4 border-gold/40"><p className="text-xs uppercase tracking-widest text-gold-soft">A note for you</p><p className="font-serif-display mt-2 text-xl leading-relaxed">{random}</p><div className="mt-3"><Button variant="quiet" onClick={() => setRandom(null)}>Put it back</Button></div></Card>}

      <Card className="mb-5">
        <h2 className="font-serif-display text-xl">Leave a note</h2>
        <div className="mt-3 space-y-3">
          <Field label="Your encouragement"><textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={2000} className={inputCls} placeholder="Something kind, in your own words…" /></Field>
          <Button onClick={save}>Leave it here</Button>
        </div>
      </Card>

      {items.length === 0 ? <Empty title="Nothing here yet" body="Leave the first note. It can be one sentence — the small ones are often the ones that land." /> : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {items.map((r) => (
            <li key={r.id}>
              <Card>
                <p className="font-serif-display text-lg leading-relaxed">{r.text}</p>
                <p className="mt-3 text-xs text-ivory-dim">From {r.authorName} · {formatDate(r.createdAt)}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <FavoriteButton active={r.isFavorite} label={r.isFavorite ? 'Remove from favourites' : 'Save to favourites'} onToggle={async () => { await store.toggleFavorite('reminders', r.id); refresh(); }} />
                  {r.authorId === store.viewerId && <Button variant="quiet" onClick={() => { setEditing(r.id); setEditText(r.text); }}>Edit</Button>}
                  <ConfirmDelete onConfirm={async () => { await store.softDelete('reminders', r.id); refresh(); notify('Moved to Deleted. You can restore it there.'); }} />
                </div>
                {editing === r.id && (
                  <div className="mt-3 space-y-2">
                    <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={3} className={inputCls} aria-label="Edit note" />
                    <div className="flex gap-2"><Button onClick={async () => { await store.update('reminders', r.id, { text: editText.trim() }); setEditing(null); refresh(); notify('Note updated.'); }}>Save</Button><Button variant="quiet" onClick={() => setEditing(null)}>Cancel</Button></div>
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}

export function MemoriesRoom({ store, refresh, notify }: Props) {
  const [q, setQ] = useState('');
  const [onlyFav, setOnlyFav] = useState(false);
  const [sort, setSort] = useState<'new' | 'old' | 'happened'>('happened');
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState<Memory | null>(null);
  const [form, setForm] = useState({ title: '', caption: '', story: '', happenedOn: todayIsoDate() });
  const [photo, setPhoto] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const items = useMemo(() => {
    let list = store.shared(store.data.memories);
    const needle = q.trim().toLowerCase();
    if (needle) list = list.filter((m) => [m.title, m.caption, m.story, m.authorName].join(' ').toLowerCase().includes(needle));
    if (onlyFav) list = list.filter((m) => m.isFavorite);
    const sorted = [...list];
    if (sort === 'new') sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (sort === 'old') sorted.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (sort === 'happened') sorted.sort((a, b) => b.happenedOn.localeCompare(a.happenedOn));
    return sorted;
  }, [store.version, q, onlyFav, sort]);

  const save = async () => {
    const err = validateRequired(form.title, 'A title', 200) || validateRequired(form.caption, 'A caption', 2000);
    if (err) return notify(err, 'error');
    setSaving(true);
    try {
      let mediaUrl: string | null = null; let mediaPath: string | null = null;
      if (photo) { const up = await store.uploadMedia(photo, 'photo'); mediaUrl = up.url; mediaPath = up.path || null; }
      await store.create('memories', { spaceId: store.data.space.id, authorId: store.viewerId, authorName: store.viewerName, title: form.title.trim(), caption: form.caption.trim(), story: form.story.trim(), happenedOn: form.happenedOn, mediaUrl, mediaPath, mediaType: photo ? 'photo' : 'none' });
      setShowForm(false); setPhoto(null); setForm({ title: '', caption: '', story: '', happenedOn: todayIsoDate() }); refresh(); notify('Memory added to the wall.');
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not save.', 'error'); } finally { setSaving(false); }
  };

  return (
    <Page title="Memory Wall" subtitle="Photographs, captions, dates, and the story only you two remember. Search it, save favourites, and sort by when it happened." actions={<Button onClick={() => setShowForm(true)}>Add a memory</Button>}>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <label className="flex-1"><span className="sr-only">Search memories</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles, captions, stories…" className={inputCls} /></label>
        <label><span className="sr-only">Sort memories</span><select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className={`${inputCls} sm:w-44`}><option value="happened">When it happened</option><option value="new">Newest added</option><option value="old">Oldest added</option></select></label>
        <Button variant={onlyFav ? 'primary' : 'quiet'} onClick={() => setOnlyFav(!onlyFav)}>{onlyFav ? 'Favourites ✓' : 'Favourites only'}</Button>
      </div>

      {items.length === 0 ? <Empty title={q ? 'Nothing matches that search' : 'The wall is waiting'} body={q ? 'Try a different word, or clear the search to see everything again.' : 'Add your first memory — a photo is welcome, but a date and a sentence are enough.'} action={<Button onClick={() => setShowForm(true)}>Add a memory</Button>} /> : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((m, i) => (
            <li key={m.id}>
              <div className={`polaroid flex h-full flex-col ${i % 3 === 0 ? 'rot-l' : i % 3 === 1 ? 'rot-r' : 'rot-0'}`}>
                <Washi tone={i % 3 === 0 ? 'sage' : i % 3 === 1 ? 'rose' : 'butter'} />
                {m.mediaUrl && <img src={m.mediaUrl} alt={m.caption || m.title} className="mb-3 aspect-[4/3] w-full rounded-lg object-cover" loading="lazy" />}
                <button onClick={() => setSelected(m)} className="text-left"><span className="font-serif-display text-xl leading-snug text-ivory">{m.title}</span><span className="font-hand mt-1 block text-2xl leading-snug text-plum">{m.caption}</span></button>
                <p className="mt-auto pt-3 text-xs text-ivory-dim">{formatDate(m.happenedOn)} · {m.authorName}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <FavoriteButton active={m.isFavorite} label="Save memory to favourites" onToggle={async () => { await store.toggleFavorite('memories', m.id); refresh(); }} />
                  <Button variant="quiet" onClick={() => setSelected(m)}>Read more</Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {showForm && <Modal title="Add a memory" onClose={() => setShowForm(false)}>
        <div className="space-y-3">
          <Field label="Title"><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={inputCls} maxLength={200} placeholder="e.g. The walk home" /></Field>
          <Field label="Date it happened"><input type="date" value={form.happenedOn} onChange={(e) => setForm({ ...form, happenedOn: e.target.value })} className={inputCls} /></Field>
          <Field label="Caption"><input value={form.caption} onChange={(e) => setForm({ ...form, caption: e.target.value })} className={inputCls} maxLength={500} placeholder="One line to remember it by" /></Field>
          <Field label="Story (optional)"><textarea value={form.story} onChange={(e) => setForm({ ...form, story: e.target.value })} rows={4} className={inputCls} maxLength={5000} placeholder="The detail you do not want to forget…" /></Field>
          <Field label="Photo (optional)" hint={store.mode === 'demo' ? 'In demo mode this photo stays on this device only. Connect Supabase for private, synced storage.' : 'Stored in your private Supabase bucket; only space members can open it.'}><input type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] || null)} className="text-sm" /></Field>
          <div className="flex gap-2"><Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Add to the wall'}</Button><Button variant="quiet" onClick={() => setShowForm(false)}>Cancel</Button></div>
        </div>
      </Modal>}

      {selected && <Modal title={selected.title} onClose={() => setSelected(null)}>
        {selected.mediaUrl && <img src={selected.mediaUrl} alt={selected.caption} className="mb-3 w-full rounded-xl object-cover" />}
        <p className="text-sm text-ivory-dim">{formatDate(selected.happenedOn)} · by {selected.authorName}</p>
        <p className="font-hand mt-3 text-3xl leading-snug text-plum">{selected.caption}</p>
        {selected.story && <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ivory">{selected.story}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <FavoriteButton active={selected.isFavorite} label="Save memory to favourites" onToggle={async () => { await store.toggleFavorite('memories', selected.id); refresh(); setSelected({ ...selected, isFavorite: !selected.isFavorite }); }} />
          <ConfirmDelete onConfirm={async () => { await store.softDelete('memories', selected.id); setSelected(null); refresh(); notify('Moved to Deleted.'); }} />
        </div>
      </Modal>}
    </Page>
  );
}
