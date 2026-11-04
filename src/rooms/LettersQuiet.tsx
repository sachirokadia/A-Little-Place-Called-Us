import { useEffect, useMemo, useRef, useState } from 'react';
import type { PlaceStore } from '../lib/store';
import type { Letter, LetterVisibility } from '../lib/types';
import { formatDate, formatDateTime, isSealed, validateRequired } from '../lib/utils';
import { rainGain, readSoundPrefs } from '../lib/preferences';
import { attemptLeave, useDirtyGuard } from '../lib/dirtyGuard';
import { Card, Button, Field, inputCls, Modal, FavoriteButton, ConfirmDelete, Washi } from '../components/ui';
import { RoomEmpty, CreateEntry } from '../components/design-primitives';
import { RoomWorld } from '../components/RoomWorld';

type Props = { store: PlaceStore; refresh: () => void; notify: (m: string, k?: 'ok' | 'error') => void; onSwitchViewer?: () => void; viewerLabel?: string; otherViewerLabel?: string };

/* Phase 12, Letters: the little post office. The tabs are the pigeonholes
   (Shared / My drafts / Sealed / All I can see), each letter is an
   envelope card with a stamp corner, and the status line states delivery
   plainly: Delivered, Waiting until a reveal time, Revealed, Sealed, or
   Private draft. Unread is per-device only (localStorage): a shared or
   revealed letter from the partner that has not been opened on this
   device shows "New", and opening its body clears it. It is never synced,
   so it cannot be mistaken for a server read receipt. Sealed letters are
   never marked read from their envelope — their body has not been seen.
   The envelope-flap animation in the reader plays alongside the body
   for authorised readers; it never gates the body, and sealed letters
   get no animation and no body, as before. */
const READ_LETTERS_KEY = 'our-place-read-letters';
function readLetterIds(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(READ_LETTERS_KEY) || '[]') as string[]); } catch { return new Set(); }
}
function markLetterRead(id: string) {
  try { const s = readLetterIds(); s.add(id); localStorage.setItem(READ_LETTERS_KEY, JSON.stringify([...s])); } catch { /* private mode */ }
}

export function LettersRoom({ store, refresh, notify, onSwitchViewer, viewerLabel = 'You', otherViewerLabel = 'Partner' }: Props) {
  /* Phase 12A: the pigeonholes are now Received / Sent / Private drafts /
     Sealed / Scheduled / All I can see. Received and Sent are pure
     frontend splits of the existing visibleLetters() list by authorId —
     no new field, no new model. "Received" means a partner letter you
     can read now (sealed envelopes stay in Sealed); "Scheduled" is every
     scheduled letter you can see, waiting or revealed. */
  const [tab, setTab] = useState<'received' | 'sent' | 'drafts' | 'sealed' | 'scheduled' | 'all'>('received');
  const [onlyNew, setOnlyNew] = useState(false);
  const [readIds, setReadIds] = useState<Set<string>>(readLetterIds);
  const [q, setQ] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState<Letter | null>(null);
  const [form, setForm] = useState({ title: '', body: '', visibility: 'shared' as LetterVisibility, revealAt: '' });
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ title: '', body: '', visibility: 'shared' as LetterVisibility, revealAt: '' });
  const letterCreateDirty = showForm && Boolean(form.title.trim() || form.body.trim() || form.revealAt);
  const letterEditDirty = editing && Boolean(selected) && (editForm.title !== selected!.title || editForm.body !== selected!.body || editForm.visibility !== selected!.visibility || editForm.revealAt !== (selected!.revealAt ? selected!.revealAt.slice(0, 16) : ''));
  const letterDirty = letterCreateDirty || letterEditDirty;
  useDirtyGuard(letterDirty, {
    label: editing ? 'a letter you are editing' : 'a letter you are writing',
    isDirty: () => letterDirty,
    discard: () => { setShowForm(false); setForm({ title: '', body: '', visibility: 'shared', revealAt: '' }); setEditing(false); },
  });

  const isNewLetter = (l: Letter) => l.authorId !== store.viewerId && l.visibility !== 'private_draft' && !isSealed(l, store.viewerId) && !readIds.has(l.id);
  const letters = useMemo(() => {
    let list = store.visibleLetters();
    const needle = q.trim().toLowerCase();
    if (needle) list = list.filter((l) => [l.title, l.authorName].join(' ').toLowerCase().includes(needle) || (!isSealed(l, store.viewerId) && l.body.toLowerCase().includes(needle)));
    if (tab === 'received') list = list.filter((l) => l.authorId !== store.viewerId && !isSealed(l, store.viewerId) && l.visibility !== 'private_draft');
    if (tab === 'sent') list = list.filter((l) => l.authorId === store.viewerId && l.visibility !== 'private_draft');
    if (tab === 'drafts') list = list.filter((l) => l.visibility === 'private_draft' && l.authorId === store.viewerId);
    if (tab === 'sealed') list = list.filter((l) => l.visibility === 'scheduled' && (isSealed(l, store.viewerId) || (l.authorId === store.viewerId && l.revealAt && new Date(l.revealAt).getTime() > Date.now())));
    if (tab === 'scheduled') list = list.filter((l) => l.visibility === 'scheduled');
    if (onlyNew) list = list.filter((l) => isNewLetter(l));
    return list.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [store.version, q, tab, onlyNew, readIds]);

  const openLetter = (l: Letter) => {
    setSelected(l);
    if (!isSealed(l, store.viewerId) && l.authorId !== store.viewerId) { markLetterRead(l.id); setReadIds(readLetterIds()); }
  };

  const save = async () => {
    const err = validateRequired(form.title, 'A title', 200) || validateRequired(form.body, 'The letter', 20000);
    if (err) return notify(err, 'error');
    if (form.visibility === 'scheduled' && !form.revealAt) return notify('Choose a reveal date and time for a scheduled letter.', 'error');
    setSaving(true);
    try {
      await store.create('letters', { spaceId: store.data.space.id, authorId: store.viewerId, authorName: store.viewerName, title: form.title.trim(), body: form.body.trim(), visibility: form.visibility, revealAt: form.visibility === 'scheduled' ? new Date(form.revealAt).toISOString() : null });
      setShowForm(false); setSaveFailed(null); setForm({ title: '', body: '', visibility: 'shared', revealAt: '' }); refresh();
      notify(form.visibility === 'scheduled' ? 'Letter sealed until its reveal time.' : form.visibility === 'private_draft' ? 'Private draft saved — only you can see it.' : 'Letter shared.');
    } catch (e) { const m = e instanceof Error ? e.message : 'Could not save.'; setSaveFailed(m); notify(m, 'error'); } finally { setSaving(false); }
  };

  const saveEdit = async () => {
    if (!selected) return;
    const err = validateRequired(editForm.title, 'A title', 200) || validateRequired(editForm.body, 'The letter', 20000);
    if (err) return notify(err, 'error');
    if (editForm.visibility === 'scheduled' && !editForm.revealAt) return notify('Choose a reveal date and time for a scheduled letter.', 'error');
    try {
      await store.update('letters', selected.id, { title: editForm.title.trim(), body: editForm.body.trim(), visibility: editForm.visibility, revealAt: editForm.visibility === 'scheduled' ? new Date(editForm.revealAt).toISOString() : null });
      setEditing(false); setSelected(null); refresh(); notify('Letter updated.');
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not save that change.', 'error'); }
  };

  return (
    <RoomWorld room="letters" title="Our Little Post Office" handNote="pigeonholes, stamps, and letters that wait patiently for their day"
      intro="Step through the post-office door — the pigeonholes are full of paper, patience, and words waiting for their day."
      subtitle="Shared letters, private drafts, and letters sealed until a date you choose. A sealed letter shows only its envelope to the other person — never its words — until that time. In this two-person home a shared letter goes to your partner; there is no separate recipient list to pick from."
      actions={<Button onClick={() => setShowForm(true)}>Write a letter</Button>}
      decor={<p className="post-office-strip" aria-hidden="true"><span>✉</span><span>✿ stamp</span><span>✉</span><span>ink · paper · patience</span><span>✉</span></p>}
      isDemo={store.mode === 'demo'} viewerLabel={viewerLabel} otherViewerLabel={otherViewerLabel} onSwitchViewer={onSwitchViewer}>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <label className="flex-1"><span className="sr-only">Search letters</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by title or author (sealed letters are never searched by body)…" className={inputCls} /></label>
        <div role="tablist" aria-label="Pigeonholes" className="flex flex-wrap gap-2">
          {(['received', 'sent', 'drafts', 'sealed', 'scheduled', 'all'] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`min-h-11 rounded-full px-4 py-2 text-sm ${tab === t ? 'bg-gold text-night-900' : 'border border-cocoa/25 text-ivory'}`}>
              {t === 'received' ? 'Received' : t === 'sent' ? 'Sent' : t === 'drafts' ? 'Private drafts' : t === 'sealed' ? 'Sealed' : t === 'scheduled' ? 'Scheduled' : 'All I can see'}
            </button>
          ))}
          <button onClick={() => setOnlyNew(!onlyNew)} aria-pressed={onlyNew} className={`min-h-11 rounded-full px-4 py-2 text-sm ${onlyNew ? 'bg-cocoa text-cream' : 'border border-cocoa/25 text-ivory'}`}>New only</button>
        </div>
      </div>
      <p className="mb-4 text-xs leading-relaxed text-ivory-dim">Received = your partner's letters you can read now. Sent = letters you sent. Sealed = envelopes still waiting for their reveal time. Scheduled = every scheduled letter, waiting or revealed. Private drafts are yours alone — your partner sees no row, no title, and no count for them.</p>

      {letters.length === 0 ? <RoomEmpty room="letters" title="No letters here yet" body={tab === 'sealed' ? 'No sealed letters are waiting. When one is, it will show here as an envelope only.' : tab === 'drafts' ? 'Private drafts live here, visible only to you, until you decide otherwise.' : 'Write the first letter. It does not need an occasion.'} action={<Button onClick={() => setShowForm(true)}>Write a letter</Button>} /> : (
        <div className="post-office">
        <p className="post-counter">At the sorting counter — the envelopes below are sorted by the pigeonhole you picked above.</p>
        <ul className="grid gap-3 sm:grid-cols-2">
          {letters.map((l) => {
            const sealed = isSealed(l, store.viewerId);
            return (
              <li key={l.id}>
                <Card className="envelope-card">
                  <span className="stamp-corner" aria-hidden="true">✿</span>
                  {sealed && <span className="wax-seal" aria-hidden="true">✿</span>}
                  <Washi tone="powder" />
                  <p className="text-xs uppercase tracking-widest text-blue-soft">{sealed ? '✉ Sealed' : l.visibility === 'private_draft' ? 'Private draft · only you' : l.visibility === 'scheduled' && l.revealAt && new Date(l.revealAt).getTime() > Date.now() ? `Waiting · opens ${formatDateTime(l.revealAt)}` : l.visibility === 'scheduled' ? `Revealed ${formatDateTime(l.revealAt)}` : 'Delivered · shared'}</p>
                  {isNewLetter(l) && <p className="mt-1"><span className="rounded-full bg-cottage-pink px-2 py-0.5 text-xs font-extrabold text-cocoa">New · not yet opened on this device</span></p>}
                  <button onClick={() => openLetter(l)} className="font-serif-display mt-2 block pr-10 text-left text-xl leading-snug text-ivory">{l.title}</button>
                  <p className="mt-2 text-sm leading-relaxed text-ivory-dim">{sealed ? 'This letter is sealed. Its words will appear here at its reveal time.' : l.body.slice(0, 140) + (l.body.length > 140 ? '…' : '')}</p>
                  <p className="mt-3 text-xs text-ivory-dim">From {l.authorName} · {formatDate(l.createdAt)}{sealed && l.revealAt ? ` · Opens ${formatDateTime(l.revealAt)}` : ''}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="quiet" onClick={() => openLetter(l)}>{sealed ? 'See envelope' : 'Open'}</Button>
                    {!sealed && <FavoriteButton active={l.isFavorite} label="Save letter to favourites" onToggle={async () => { await store.toggleFavorite('letters', l.id); refresh(); }} />}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
        </div>
      )}

      {showForm && <Modal title="Write a letter" onClose={() => { if (attemptLeave()) setShowForm(false); }}>
        <div className="space-y-3 letter-desk">
          <p className="font-hand text-center text-2xl leading-snug text-plum">At the writing desk — pick a pigeonhole, then write.</p>
          <p className="text-xs leading-relaxed text-ivory-dim">To: {form.visibility === 'private_draft' ? 'only me (a private draft — your partner sees nothing of it)' : form.visibility === 'scheduled' ? 'your partner, sealed until the reveal time you choose' : 'your partner (shared — both of you, now)'}. Letters hold words only: the letter model has no photograph field, so a photograph cannot be attached here — put it on the Memory Wall instead. The letter text is plain text, as the model stores it; there is no rich-text editor.</p>
          <Field label="Title"><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={inputCls} maxLength={200} /></Field>
          <Field label="Letter"><textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} rows={8} className={inputCls} maxLength={20000} placeholder="In your own words…" /></Field>
          <Field label="Who can see this?">
            <select value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value as LetterVisibility })} className={inputCls}>
              <option value="shared">Shared — both of you, now</option>
              <option value="private_draft">Private draft — only me</option>
              <option value="scheduled">Scheduled — sealed until a reveal time</option>
            </select>
          </Field>
          {form.visibility === 'scheduled' && <Field label="Reveal date and time" hint="Until then, the other person sees only the envelope — not the body. You, as author, can still see it."><input type="datetime-local" value={form.revealAt} onChange={(e) => setForm({ ...form, revealAt: e.target.value })} className={inputCls} /></Field>}
          {saveFailed && <p role="alert" className="rounded-xl border border-cocoa/25 bg-rose px-3 py-2 text-sm">Saving failed: {saveFailed} <span className="mt-2 flex flex-wrap gap-2"><Button onClick={save} disabled={saving}>Try saving again</Button><Button variant="quiet" onClick={() => setSaveFailed(null)}>Dismiss</Button></span></p>}
          <div className="flex gap-2"><Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save letter'}</Button><Button variant="quiet" onClick={() => { if (attemptLeave()) setShowForm(false); }}>Cancel</Button></div>
        </div>
      </Modal>}

      {selected && <Modal title={editing ? 'Edit letter' : selected.title} onClose={() => { if (!editing || attemptLeave()) { setSelected(null); setEditing(false); } }}>
        {isSealed(selected, store.viewerId) ? (
          <div className="py-6 text-center">
            <p className="text-4xl" aria-hidden="true">✉</p>
            <span className="wax-seal wax-seal-large" aria-hidden="true">✿</span>
            <p className="font-serif-display mt-3 text-xl">Sealed, with care.</p>
            <p className="mt-2 text-sm leading-relaxed text-ivory-dim">From {selected.authorName}. This letter opens {formatDateTime(selected.revealAt)}. Nothing about its words is shown before then — no body, no preview, no search match.</p>
          </div>
        ) : editing ? (
          <div className="space-y-3">
            <Field label="Title"><input value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} className={inputCls} maxLength={200} /></Field>
            <Field label="Letter"><textarea value={editForm.body} onChange={(e) => setEditForm({ ...editForm, body: e.target.value })} rows={8} className={inputCls} maxLength={20000} /></Field>
            <Field label="Who can see this?">
              <select value={editForm.visibility} onChange={(e) => setEditForm({ ...editForm, visibility: e.target.value as LetterVisibility })} className={inputCls}>
                <option value="shared">Shared — both of you, now</option>
                <option value="private_draft">Private draft — only me</option>
                <option value="scheduled">Scheduled — sealed until a reveal time</option>
              </select>
            </Field>
            {editForm.visibility === 'scheduled' && <Field label="Reveal date and time"><input type="datetime-local" value={editForm.revealAt} onChange={(e) => setEditForm({ ...editForm, revealAt: e.target.value })} className={inputCls} /></Field>}
            <div className="flex gap-2"><Button onClick={saveEdit}>Save changes</Button><Button variant="quiet" onClick={() => { if (attemptLeave()) setEditing(false); }}>Cancel</Button></div>
          </div>
        ) : (
          <>
            <p className="text-sm text-ivory-dim">From {selected.authorName} · {formatDate(selected.createdAt)} · Visibility: {selected.visibility === 'private_draft' ? 'Private draft — only you' : selected.visibility === 'scheduled' ? `Scheduled — opens ${formatDateTime(selected.revealAt)}` : 'Shared — both of you'}</p>
            <div aria-hidden="true" className="envelope-flap envelope-flap-open mt-4" />
            <div className="letter-paper letter-unfold mt-4"><p className="whitespace-pre-wrap text-base leading-[28px]">{selected.body}</p></div>
            <div className="mt-4 flex flex-wrap gap-2">
              <FavoriteButton active={selected.isFavorite} label="Save letter to favourites" onToggle={async () => { await store.toggleFavorite('letters', selected.id); refresh(); setSelected({ ...selected, isFavorite: !selected.isFavorite }); }} />
              {/* A letter's words belong to its author: only the author edits.
                  A shared letter can still be favourited or soft-deleted by either member. */}
              {selected.authorId === store.viewerId && <Button variant="quiet" onClick={() => { setEditForm({ title: selected.title, body: selected.body, visibility: selected.visibility, revealAt: selected.revealAt ? selected.revealAt.slice(0, 16) : '' }); setEditing(true); }}>Edit</Button>}
              <ConfirmDelete onConfirm={async () => { await store.softDelete('letters', selected.id); setSelected(null); refresh(); notify('Moved to Deleted.'); }} />
            </div>
          </>
        )}
      </Modal>}
    </RoomWorld>
  );
}

// Fixed gentle prompts, not user content: partner-written supportive notes are
// stored persistently as appreciations (kind = encouragement) and listed below.
// Nothing in this array is presented as a user's note or stored as data.
const SUPPORTIVE = [
  'You do not have to fix everything today.',
  'Rest is not falling behind.',
  'You are allowed to have a slow day.',
  'One small thing at a time is enough.',
  'You have handled hard days before. You can handle this one gently.',
];

/* Phase 12, Quiet Room: the peaceful reading nook. The room opens with a
   rainy-window panel beside the breathing armchair, in muted sage and
   blue, with space around everything — the opposite of a dense dashboard.
   Calm animation is a visible toggle (on by default, per device), and it
   is overridden by the system / Settings reduced-motion preference.
   Rain sound is generated in the browser with the Web Audio API (filtered
   noise, no audio file, no recording, no autoplay): it is OFF by default,
   starts only on a tap, and stops when toggled off, when the room
   unmounts, or when breathing stops — whichever comes first. There is no
   way for it to keep playing unnoticed. Journals are unchanged and
   private: author-only in code and under RLS, never listed for the
   partner. */
function readQuietAnimation(): boolean {
  try { return localStorage.getItem('our-place-quiet-animation') !== '0'; } catch { return true; }
}

export function QuietRoom({ store, refresh, notify, onSwitchViewer, viewerLabel = 'You', otherViewerLabel = 'Partner' }: Props) {
  const [breathing, setBreathing] = useState(false);
  const [phase, setPhase] = useState<'Inhale' | 'Hold' | 'Exhale'>('Inhale');
  const [calmAnimation, setCalmAnimation] = useState(readQuietAnimation);
  /* Phase 12A: system reduced-motion, read live (in addition to the
     Settings .reduce-motion class and the global CSS block, which
     already collapse every animation). When it is on, the breathing
     circle stays still and only the word changes — the same content,
     static. No streak, no counter, no pressure mechanic exists here,
     and none is added. */
  const [systemReduced, setSystemReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setSystemReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  const animationOn = calmAnimation && !systemReduced;
  const [rainOn, setRainOn] = useState(false);
  const rainRef = useRef<AudioContext | null>(null);
  const stopRain = () => {
    try { rainRef.current?.close(); } catch { /* already closed */ }
    rainRef.current = null;
    setRainOn(false);
  };
  const toggleRain = async () => {
    if (rainOn) { stopRain(); return; }
    const soundPrefs = readSoundPrefs();
    if (!soundPrefs.enabled) { notify('Sound is off in Settings (desk drawer) — turn it on there to hear the rain.', 'error'); return; }
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      const len = ctx.sampleRate * 2;
      const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) { const white = Math.random() * 2 - 1; last = (last + 0.02 * white) / 1.02; data[i] = last * 3.5; }
      const src = ctx.createBufferSource();
      src.buffer = buffer; src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass'; filter.frequency.value = 800;
      const gain = ctx.createGain();
      gain.gain.value = rainGain(soundPrefs.volume);
      src.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
      src.start();
      rainRef.current = ctx;
      setRainOn(true);
    } catch { notify('Rain sound is not available on this device or browser.', 'error'); }
  };
  useEffect(() => () => { try { rainRef.current?.close(); } catch { /* already closed */ } }, []);
  const setAnimation = (on: boolean) => { setCalmAnimation(on); try { localStorage.setItem('our-place-quiet-animation', on ? '1' : '0'); } catch { /* private mode */ } };
  const [support, setSupport] = useState('');
  const [journalTitle, setJournalTitle] = useState('');
  const [journalBody, setJournalBody] = useState('');
  const [journalMood, setJournalMood] = useState('calm');
  /* Phase 12A: unfinished journal entries. The form autosaves to this
     device only (localStorage, per viewer — never synced, never shared,
     labelled as such in the UI), restores when you return, and clears
     when the entry is saved properly. Leaving the room mid-sentence no
     longer loses the entry. This is a device draft, not a new model:
     saved entries still go through the existing journals path only. */
  const journalDraftKey = `our-place-journal-draft-${store.viewerId}`;
  const [draftRestored, setDraftRestored] = useState(false);
  const [discardArmed, setDiscardArmed] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(journalDraftKey);
      if (raw && !journalTitle && !journalBody) {
        const d = JSON.parse(raw) as { title?: string; body?: string; mood?: string };
        if (d.title || d.body) { setJournalTitle(d.title || ''); setJournalBody(d.body || ''); if (d.mood) setJournalMood(d.mood); setDraftRestored(true); }
      }
    } catch { /* private mode: no draft to restore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.viewerId]);
  useEffect(() => {
    try {
      if (journalTitle || journalBody) localStorage.setItem(journalDraftKey, JSON.stringify({ title: journalTitle, body: journalBody, mood: journalMood }));
    } catch { /* private mode */ }
  }, [journalTitle, journalBody, journalMood, journalDraftKey]);
  const discardJournalDraft = () => {
    try { localStorage.removeItem(journalDraftKey); } catch { /* private mode */ }
    setJournalTitle(''); setJournalBody(''); setDraftRestored(false);
  };
  const [moodFilter, setMoodFilter] = useState<string | null>(null);
  const [journalSaving, setJournalSaving] = useState(false);
  const [editingJournal, setEditingJournal] = useState<string | null>(null);
  const [editJournal, setEditJournal] = useState({ title: '', body: '', mood: 'calm' });
  const [voiceTitle, setVoiceTitle] = useState('');
  const [recording, setRecording] = useState<MediaRecorder | null>(null);
  const [voiceFile, setVoiceFile] = useState<File | null>(null);

  // Breathing cycle: inhale 4s, hold 4s, exhale 6s. Breathing itself makes
  // no sound; the optional rain sound is a separate toggle above, and
  // recordings never auto-play.
  // Driven by an effect so stopping clears the pending timer — no runaway timers after Stop.
  useEffect(() => {
    if (!breathing) return;
    const ms = phase === 'Exhale' ? 6000 : 4000;
    const next = phase === 'Inhale' ? 'Hold' : phase === 'Hold' ? 'Exhale' : 'Inhale';
    const t = setTimeout(() => setPhase(next), ms);
    return () => clearTimeout(t);
  }, [breathing, phase]);
  const startBreathing = () => { setPhase('Inhale'); setBreathing(true); };
  const stopBreathing = () => { setBreathing(false); setPhase('Inhale'); };

  const journals = store.visibleJournals().filter((j) => !moodFilter || j.mood === moodFilter).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const supportiveNotes = store.shared(store.data.appreciations).filter((a) => a.kind === 'encouragement');

  const saveJournal = async () => {
    const err = validateRequired(journalTitle, 'A title', 200) || validateRequired(journalBody, 'Your entry', 20000);
    if (err) return notify(err, 'error');
    setJournalSaving(true);
    try {
      await store.create('journals', { spaceId: store.data.space.id, authorId: store.viewerId, authorName: store.viewerName, title: journalTitle.trim(), body: journalBody.trim(), mood: journalMood, visibility: 'private' });
      try { localStorage.removeItem(journalDraftKey); } catch { /* private mode */ }
      setJournalTitle(''); setJournalBody(''); setDraftRestored(false); refresh(); notify('Private journal entry saved — only you can read it.');
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not save.', 'error'); } finally { setJournalSaving(false); }
  };

  const saveJournalEdit = async (id: string) => {
    const err = validateRequired(editJournal.title, 'A title', 200) || validateRequired(editJournal.body, 'Your entry', 20000);
    if (err) return notify(err, 'error');
    try {
      await store.update('journals', id, { title: editJournal.title.trim(), body: editJournal.body.trim(), mood: editJournal.mood });
      setEditingJournal(null); refresh(); notify('Journal entry updated.');
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not save that change.', 'error'); }
  };

  const saveSupport = async () => {
    const err = validateRequired(support, 'A supportive message', 2000);
    if (err) return notify(err, 'error');
    try {
      await store.create('appreciations', { spaceId: store.data.space.id, authorId: store.viewerId, authorName: store.viewerName, text: support.trim(), kind: 'encouragement', forName: 'Partner' });
      setSupport(''); refresh(); notify('Supportive note left for your partner.');
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not save.', 'error'); }
  };

  const startRecording = async () => {
    // Guard first, so a device without MediaRecorder (some older iOS
    // browsers) gets an honest message instead of a misleading
    // "microphone not granted" error. Uploading an audio file still works.
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      notify('Recording is not supported on this device or browser. You can still upload an audio file instead.', 'error');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: BlobPart[] = [];
      const rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (!chunks.length) { notify('Nothing was recorded. Try again, or upload an audio file instead.', 'error'); return; }
        const mime = rec.mimeType || '';
        const ext = mime.includes('mp4') || mime.includes('m4a') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm';
        setVoiceFile(new File(chunks, `voice-note.${ext}`, { type: mime || undefined }));
      };
      rec.start(); setRecording(rec);
    } catch { notify('Microphone access was not granted, so recording could not start. You can still upload an audio file instead.', 'error'); }
  };

  const saveVoice = async () => {
    if (!voiceFile) return notify('Record or choose an audio file first.', 'error');
    const err = validateRequired(voiceTitle, 'A title for the voice note', 200);
    if (err) return notify(err, 'error');
    try {
      const up = await store.uploadMedia(voiceFile, 'voice');
      await store.create('voiceNotes', { spaceId: store.data.space.id, authorId: store.viewerId, authorName: store.viewerName, title: voiceTitle.trim(), durationSec: null, mediaPath: up.path || null, mediaUrl: up.url, room: 'quiet', linkedId: null });
      setVoiceTitle(''); setVoiceFile(null); refresh(); notify('Voice note saved. It never plays automatically — press play when you want it.');
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not save.', 'error'); }
  };

  return (
    <RoomWorld room="quiet" title="Your Little Corner" handNote="a cosy reading nook — armchair, warm lamp, rain on the window, no hurry"
      intro="Come in out of the hurry — the lamp is lit, the rain is on the window, and there is nowhere you need to be."
      subtitle="A softer corner. Supportive words, a slow breath, and journals that belong to one person alone — never shared, never listed for the other person, never counted anywhere shared. No streaks, no goals, no pressure — nothing here keeps score."
      decor={<p className="nook-strip" aria-hidden="true"><span>☾</span><span>lamplight · blankets · books</span><span>☔</span></p>}
      isDemo={store.mode === 'demo'} viewerLabel={viewerLabel} otherViewerLabel={otherViewerLabel} onSwitchViewer={onSwitchViewer}>
      <div className={`nook-window mb-4 ${animationOn ? 'rain-on' : ''}`} aria-hidden="true">
        <p className="relative z-10 rounded-full bg-paper/90 px-4 py-1 text-sm font-bold text-cocoa">Rain on the window · a warm lamp · a chair that waits</p>
      </div>
      <div className="reading-nook">
      <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Quiet Room comfort controls">
        <Button variant={calmAnimation ? 'primary' : 'quiet'} onClick={() => setAnimation(!calmAnimation)} aria-pressed={calmAnimation}>{calmAnimation ? 'Calm animation: on' : 'Calm animation: off'}</Button>
        <Button variant={rainOn ? 'primary' : 'quiet'} onClick={toggleRain} aria-pressed={rainOn}>{rainOn ? 'Rain sound: on — tap to stop' : 'Rain sound: off'}</Button>
        <span className="text-xs text-ivory-dim">Sound is off until you turn it on, and it stops when you leave or turn it off. Sound on/off and volume live in Settings → the desk drawer (this device only). Animation follows your reduced-motion setting too.</span>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="nook-armchair">
          <h2 className="font-serif-display text-xl">Breathe, slowly</h2>
          <p className="mt-1 text-sm text-ivory-dim">Inhale 4 · Hold 4 · Exhale 6. Stop whenever you like.</p>
          <div className="flex flex-col items-center py-5">
            <div aria-live="polite" className={`flex h-28 w-28 items-center justify-center rounded-full border-2 border-cocoa/40 bg-sage text-center transition-all motion-reduce:scale-100 ${animationOn ? 'duration-[4000ms]' : 'duration-0'} ${breathing && animationOn && phase === 'Inhale' ? 'scale-125' : breathing && animationOn && phase === 'Exhale' ? 'scale-90' : 'scale-100'}`}>
              <span className="font-serif-display text-lg">{breathing ? phase : 'Ready'}</span>
            </div>
            <div className="mt-4 flex gap-2">
              {!breathing ? <Button onClick={startBreathing}>Begin breathing</Button> : <Button variant="quiet" onClick={stopBreathing}>Stop</Button>}
            </div>
          </div>
          <p className="text-xs text-ivory-dim">With calm animation off, or reduced-motion on, the circle stays still and only the word changes.</p>
        </Card>

        <Card className="nook-note">
          <h2 className="font-serif-display text-xl">Something supportive</h2>
          <p className="mt-2 text-sm leading-relaxed text-ivory-dim">{SUPPORTIVE[Math.floor(Date.now() / 86400000) % SUPPORTIVE.length]}</p>
          <div className="mt-4 space-y-3">
            <Field label="Leave a supportive note for your partner"><textarea value={support} onChange={(e) => setSupport(e.target.value)} rows={3} className={inputCls} maxLength={2000} placeholder="Something gentle, for them to find…" /></Field>
            <Button onClick={saveSupport}>Leave it here</Button>
          </div>
          {supportiveNotes.length > 0 && <ul className="mt-4 space-y-2">{supportiveNotes.slice(0, 3).map((n) => <li key={n.id} className="text-sm leading-relaxed text-ivory">“{n.text}” <span className="text-ivory-dim">— {n.authorName}</span></li>)}</ul>}
        </Card>
      </div>
      </div>

      <Card className="mt-4">
        <h2 className="font-serif-display text-xl">Voice notes — only when you press play</h2>
        <p className="mt-1 text-sm text-ivory-dim">Record a short note, or upload audio. Voice notes are shared with your partner — unlike journals below, which are private. Nothing here auto-plays, ever.</p>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field label="Title"><input value={voiceTitle} onChange={(e) => setVoiceTitle(e.target.value)} className={inputCls} placeholder="e.g. For a hard morning" /></Field>
          <div className="flex flex-wrap gap-2">
            {!recording ? <Button variant="quiet" onClick={startRecording}>● Record</Button> : <Button variant="danger" onClick={() => { recording.stop(); setRecording(null); }}>■ Stop recording</Button>}
            <label className="min-h-11 cursor-pointer rounded-full border border-cocoa/25 px-4 py-2 text-sm hover:bg-cream-deep">Upload audio<input type="file" accept="audio/*" className="hidden" onChange={(e) => setVoiceFile(e.target.files?.[0] || null)} /></label>
            <Button onClick={saveVoice} disabled={!voiceFile}>Save voice note</Button>
          </div>
        </div>
        {voiceFile && <p className="mt-2 text-sm text-ivory-dim">Ready: {voiceFile.name}</p>}
        <ul className="mt-4 space-y-3">
          {store.shared(store.data.voiceNotes).filter((v) => v.room === 'quiet').map((v) => (
            <li key={v.id} className="rounded-xl border border-cocoa/15 p-3">
              <p className="font-medium">{v.title} <span className="text-xs text-ivory-dim">· {v.authorName}</span></p>
              {v.mediaUrl ? <audio controls preload="none" src={v.mediaUrl} className="mt-2 w-full" /> : <p className="mt-1 text-sm text-ivory-dim">Audio file reference saved ({v.mediaPath || 'no file'}).</p>}
            </li>
          ))}
        </ul>
        {store.shared(store.data.voiceNotes).filter((v) => v.room === 'quiet').length === 0 && <p className="mt-3 text-sm text-ivory-dim">No voice notes yet — record one above, or upload audio, and it will wait here until you press play.</p>}
      </Card>

      <CreateEntry room="quiet" note="for your eyes only">
      <Card className="mt-4">
        <h2 className="font-serif-display text-xl">My private journal</h2>
        <p className="mt-1 text-sm text-ivory-dim">Only you can read these. They are not shown to your partner in any list, search, Deleted, or shared view — in demo mode or under Supabase RLS. Nothing from a journal is ever put in a notification (this app sends none, by design).</p>
        {draftRestored && <p role="status" className="mt-3 rounded-xl border border-cocoa/25 bg-butter p-3 text-sm">An unfinished entry was restored from this device only — it was never shared or synced. {!discardArmed ? <button type="button" className="font-bold underline" onClick={() => setDiscardArmed(true)}>Discard it</button> : <span>Discard this unfinished draft for good? <button type="button" className="font-bold underline" onClick={() => { discardJournalDraft(); setDiscardArmed(false); }}>Yes, discard</button> <button type="button" className="font-bold underline" onClick={() => setDiscardArmed(false)}>Keep it</button></span>} or finish it and save privately below.</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Filter journal entries by mood">
          <span className="text-sm font-bold text-cocoa">Feeling:</span>
          <button onClick={() => setMoodFilter(null)} aria-pressed={!moodFilter} className={`rounded-full px-3 py-1 text-xs ${!moodFilter ? 'bg-cocoa text-cream' : 'border border-cocoa/25 text-cocoa'}`}>All moods</button>
          {(['calm', 'heavy', 'hopeful', 'tired', 'grateful', 'unsure'] as const).map((m) => (
            <button key={m} onClick={() => setMoodFilter(moodFilter === m ? null : m)} aria-pressed={moodFilter === m} className={`rounded-full px-3 py-1 text-xs ${moodFilter === m ? 'bg-cocoa text-cream' : 'border border-cocoa/25 text-cocoa'}`}>{m}</button>
          ))}
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <Field label="Title"><input value={journalTitle} onChange={(e) => setJournalTitle(e.target.value)} className={inputCls} maxLength={200} /></Field>
          <Field label="How does it feel?"><select value={journalMood} onChange={(e) => setJournalMood(e.target.value)} className={inputCls}><option value="calm">Calm</option><option value="heavy">Heavy</option><option value="hopeful">Hopeful</option><option value="tired">Tired</option><option value="grateful">Grateful</option><option value="unsure">Unsure</option></select></Field>
        </div>
        <div className="mt-3"><Field label="Entry"><textarea value={journalBody} onChange={(e) => setJournalBody(e.target.value)} rows={5} className={inputCls} maxLength={20000} placeholder="Write only for yourself…" /></Field></div>
        <div className="mt-3"><Button onClick={saveJournal} disabled={journalSaving}>{journalSaving ? 'Saving…' : 'Save privately'}</Button></div>
        {journals.length === 0 ? <div className="mt-5"><RoomEmpty room="quiet" title="No private entries yet" body="Write only for yourself — a private entry lives here, visible to you alone, and never appears in any shared list, search, or feed." /></div> : <ul className="mt-5 space-y-3">
          {journals.map((j) => (
            <li key={j.id} className="journal-private p-4">
              <p className="text-xs font-extrabold uppercase tracking-widest text-plum">🔒 Private — only you can read this</p>
              {editingJournal === j.id ? (
                <div className="mt-3 space-y-2">
                  <Field label="Title"><input value={editJournal.title} onChange={(e) => setEditJournal({ ...editJournal, title: e.target.value })} className={inputCls} maxLength={200} /></Field>
                  <Field label="How does it feel?"><select value={editJournal.mood} onChange={(e) => setEditJournal({ ...editJournal, mood: e.target.value })} className={inputCls}><option value="calm">Calm</option><option value="heavy">Heavy</option><option value="hopeful">Hopeful</option><option value="tired">Tired</option><option value="grateful">Grateful</option><option value="unsure">Unsure</option></select></Field>
                  <Field label="Entry"><textarea value={editJournal.body} onChange={(e) => setEditJournal({ ...editJournal, body: e.target.value })} rows={5} className={inputCls} maxLength={20000} /></Field>
                  <div className="flex gap-2"><Button onClick={() => saveJournalEdit(j.id)}>Save changes</Button><Button variant="quiet" onClick={() => setEditingJournal(null)}>Cancel</Button></div>
                </div>
              ) : (
                <>
                  <p className="font-serif-display mt-1 text-lg">{j.title} <span className="text-sm text-ivory-dim">· {j.mood} · {formatDate(j.createdAt)}</span></p>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ivory">{j.body}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button variant="quiet" onClick={() => { setEditingJournal(j.id); setEditJournal({ title: j.title, body: j.body, mood: j.mood }); }}>Edit</Button>
                    <ConfirmDelete onConfirm={async () => { await store.softDelete('journals', j.id); refresh(); notify('Moved to Deleted.'); }} />
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>}
      </Card>
      </CreateEntry>
    </RoomWorld>
  );
}
