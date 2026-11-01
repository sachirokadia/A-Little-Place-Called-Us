import { useMemo, useState } from 'react';
import type { PlaceStore } from '../lib/store';
import type { Appreciation, CollectionName } from '../lib/types';
import { formatDate, validateImageFile, validateRequired } from '../lib/utils';
import { Page, Card, Empty, Button, Field, inputCls, Modal, FavoriteButton, ConfirmDelete } from '../components/ui';

type Props = { store: PlaceStore; refresh: () => void; notify: (m: string, k?: 'ok' | 'error') => void };

const KIND_LABEL: Record<Appreciation['kind'], string> = { appreciation: 'Appreciation', achievement: 'Achievement', encouragement: 'Encouragement' };

export function AppreciationsRoom({ store, refresh, notify }: Props) {
  const [text, setText] = useState('');
  const [kind, setKind] = useState<Appreciation['kind']>('appreciation');
  const [filter, setFilter] = useState<'all' | Appreciation['kind']>('all');
  const [onlyFav, setOnlyFav] = useState(false);
  const [sort, setSort] = useState<'new' | 'old'>('new');
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const items = useMemo(() => {
    let list = store.shared(store.data.appreciations);
    if (filter !== 'all') list = list.filter((i) => i.kind === filter);
    if (onlyFav) list = list.filter((i) => i.isFavorite);
    const sorted = [...list];
    sorted.sort((a, b) => sort === 'new' ? b.createdAt.localeCompare(a.createdAt) : a.createdAt.localeCompare(b.createdAt));
    return sorted;
  }, [store.version, filter, onlyFav, sort]);

  const save = async () => {
    const err = validateRequired(text, 'Your note', 2000);
    if (err) return notify(err, 'error');
    setSaving(true);
    try {
      await store.create('appreciations', { spaceId: store.data.space.id, authorId: store.viewerId, authorName: store.viewerName, text: text.trim(), kind, forName: 'Partner' });
      setText(''); refresh(); notify('Noted — and it matters more than you think.');
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not save.', 'error'); } finally { setSaving(false); }
  };

  return (
    <Page title="Things I See in You" subtitle="Appreciation, achievements, and encouragement — specific, not generic. Name the thing you actually noticed.">
      <Card className="mb-5">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="md:col-span-2"><Field label="What do you see in them?"><textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className={inputCls} maxLength={2000} placeholder="e.g. The way you stayed patient when the plan fell apart…" /></Field></div>
          <Field label="Kind of note"><select value={kind} onChange={(e) => setKind(e.target.value as Appreciation['kind'])} className={inputCls}><option value="appreciation">Appreciation</option><option value="achievement">Achievement</option><option value="encouragement">Encouragement</option></select></Field>
        </div>
        <div className="mt-3"><Button onClick={save} disabled={saving}>{saving ? 'Leaving…' : 'Leave this note'}</Button></div>
      </Card>

      <div className="mb-4 flex flex-wrap gap-2">
        {(['all', 'appreciation', 'achievement', 'encouragement'] as const).map((k) => (
          <button key={k} onClick={() => setFilter(k)} aria-pressed={filter === k} className={`min-h-11 rounded-full px-4 py-2 text-sm ${filter === k ? 'bg-gold text-night-900' : 'border border-cocoa/25 text-ivory'}`}>{k === 'all' ? 'All' : KIND_LABEL[k]}</button>
        ))}
        <Button variant={onlyFav ? 'primary' : 'quiet'} onClick={() => setOnlyFav(!onlyFav)}>Favourites only</Button>
        <label className="flex items-center gap-2 text-sm text-ivory-dim">Browse <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className={`${inputCls} w-auto`}><option value="new">Newest first</option><option value="old">Oldest first</option></select></label>
      </div>

      {items.length === 0 ? <Empty title="Nothing here yet" body="Start with one specific thing — a moment, a quality, a small win. Specific beats grand, every time." /> : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {items.map((a) => (
            <li key={a.id}>
              <Card>
                <p className="text-xs uppercase tracking-widest text-gold-soft">{KIND_LABEL[a.kind]}</p>
                {editing === a.id ? (
                  <div className="mt-3 space-y-2">
                    <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={3} className={inputCls} maxLength={2000} aria-label="Edit note" />
                    <div className="flex gap-2"><Button onClick={async () => { await store.update('appreciations', a.id, { text: editText.trim() }); setEditing(null); refresh(); notify('Note updated.'); }}>Save</Button><Button variant="quiet" onClick={() => setEditing(null)}>Cancel</Button></div>
                  </div>
                ) : (
                  <p className="font-serif-display mt-2 text-lg leading-relaxed">“{a.text}”</p>
                )}
                <p className="mt-3 text-xs text-ivory-dim">From {a.authorName} · {formatDate(a.createdAt)}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <FavoriteButton active={a.isFavorite} label="Save note to favourites" onToggle={async () => { await store.toggleFavorite('appreciations', a.id); refresh(); }} />
                  {/* Personal-voice note: only its author edits its words. */}
                  {a.authorId === store.viewerId && <Button variant="quiet" onClick={() => { setEditing(a.id); setEditText(a.text); }}>Edit</Button>}
                  <ConfirmDelete onConfirm={async () => { await store.softDelete('appreciations', a.id); refresh(); notify('Moved to Deleted.'); }} />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}

export function FutureRoom({ store, refresh, notify }: Props) {
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

  const items = useMemo(() => {
    let list = store.shared(store.data.plans).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (statusFilter !== 'all') list = list.filter((i) => i.status === statusFilter);
    if (catFilter !== 'all') list = list.filter((i) => i.category === catFilter);
    return list;
  }, [store.version, statusFilter, catFilter]);

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
    <Page title="Our Future" subtitle="Bucket lists, date ideas, and plans — with a clear done state, and an optional photo only after you actually do it.">
      <Card className="mb-5">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="What shall we do?"><input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} maxLength={200} placeholder="e.g. Cook a meal together, no phones" /></Field>
          <Field label="Kind"><select value={category} onChange={(e) => setCategory(e.target.value as typeof category)} className={inputCls}><option value="date">Date idea</option><option value="bucket">Bucket list</option><option value="plan">Plan</option></select></Field>
        </div>
        <div className="mt-3"><Field label="Details (optional)"><textarea value={detail} onChange={(e) => setDetail(e.target.value)} rows={2} className={inputCls} maxLength={2000} placeholder="Where, when, what to bring…" /></Field></div>
        <div className="mt-3"><Field label="Target date (optional)" hint="A hope, not a deadline — leave it blank if there is no date in mind yet."><input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className={inputCls} /></Field></div>
        <div className="mt-3"><Button onClick={save} disabled={saving}>{saving ? 'Adding…' : 'Add to Our Future'}</Button></div>
      </Card>

      <div className="mb-4 flex flex-wrap gap-2">
        {(['all', 'planned', 'done'] as const).map((s) => <button key={s} onClick={() => setStatusFilter(s)} aria-pressed={statusFilter === s} className={`min-h-11 rounded-full px-4 py-2 text-sm ${statusFilter === s ? 'bg-gold text-night-900' : 'border border-cocoa/25 text-ivory'}`}>{s === 'all' ? 'All' : s === 'planned' ? 'Still to do' : 'Done'}</button>)}
        {(['all', 'bucket', 'date', 'plan'] as const).map((c) => <button key={c} onClick={() => setCatFilter(c)} aria-pressed={catFilter === c} className={`min-h-11 rounded-full px-4 py-2 text-sm ${catFilter === c ? 'bg-gold text-night-900' : 'border border-cocoa/25 text-ivory'}`}>{c === 'all' ? 'Every kind' : c === 'bucket' ? 'Bucket list' : c === 'date' ? 'Date ideas' : 'Plans'}</button>)}
      </div>

      {items.length === 0 ? <Empty title="Nothing planned yet" body="Add something small first. A future does not have to start grand — it just has to start." /> : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {items.map((p) => (
            <li key={p.id}>
              <Card>
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
                  {p.status === 'planned' && <Button variant="quiet" onClick={() => setCompleting(p.id)}>Mark done</Button>}
                  {p.status === 'done' && <Button variant="quiet" onClick={async () => { await store.update('plans', p.id, { status: 'planned', completedAt: null }); refresh(); }}>Back to planned</Button>}
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
      )}
    </Page>
  );
}

const COLLECTION_LABEL: Record<CollectionName, string> = { reminders: 'Reminder', memories: 'Memory', letters: 'Letter', journals: 'Private journal', appreciations: 'Note', plans: 'Future plan', voiceNotes: 'Voice note' };

export function DeletedRoom({ store, refresh, notify }: Props) {
  const [confirmPurge, setConfirmPurge] = useState<string | null>(null);
  const items = store.deletedItems();
  return (
    <Page title="Deleted — recoverable" subtitle="Deletion here is soft, not instant and final. Everything below can be restored, or permanently deleted in a second, deliberate step. Permanent deletion cannot be undone.">
      {items.length === 0 ? <Empty title="Nothing deleted" body="When you delete something from a room, it lands here first — so a tired tap does not erase a memory." /> : (
        <ul className="space-y-3">
          {items.map(({ collection, item }) => (
            <li key={`${collection}-${item.id}`}>
              <Card>
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
      )}
    </Page>
  );
}
