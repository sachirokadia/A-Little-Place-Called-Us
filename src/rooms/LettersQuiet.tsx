import { useEffect, useMemo, useState } from 'react';
import type { PlaceStore } from '../lib/store';
import type { Letter, LetterVisibility } from '../lib/types';
import { formatDate, formatDateTime, isSealed, validateRequired } from '../lib/utils';
import { Page, Card, Empty, Button, Field, inputCls, Modal, FavoriteButton, ConfirmDelete, Washi } from '../components/ui';

type Props = { store: PlaceStore; refresh: () => void; notify: (m: string, k?: 'ok' | 'error') => void };

export function LettersRoom({ store, refresh, notify }: Props) {
  const [tab, setTab] = useState<'shared' | 'drafts' | 'sealed' | 'all'>('shared');
  const [q, setQ] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState<Letter | null>(null);
  const [form, setForm] = useState({ title: '', body: '', visibility: 'shared' as LetterVisibility, revealAt: '' });

  const letters = useMemo(() => {
    let list = store.visibleLetters();
    const needle = q.trim().toLowerCase();
    if (needle) list = list.filter((l) => [l.title, l.authorName].join(' ').toLowerCase().includes(needle) || (!isSealed(l, store.viewerId) && l.body.toLowerCase().includes(needle)));
    if (tab === 'shared') list = list.filter((l) => l.visibility === 'shared');
    if (tab === 'drafts') list = list.filter((l) => l.visibility === 'private_draft' && l.authorId === store.viewerId);
    if (tab === 'sealed') list = list.filter((l) => l.visibility === 'scheduled' && (isSealed(l, store.viewerId) || (l.authorId === store.viewerId && l.revealAt && new Date(l.revealAt).getTime() > Date.now())));
    return list.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [store.version, q, tab]);

  const save = async () => {
    const err = validateRequired(form.title, 'A title', 200) || validateRequired(form.body, 'The letter', 20000);
    if (err) return notify(err, 'error');
    if (form.visibility === 'scheduled' && !form.revealAt) return notify('Choose a reveal date and time for a scheduled letter.', 'error');
    try {
      await store.create('letters', { spaceId: store.data.space.id, authorId: store.viewerId, authorName: store.viewerName, title: form.title.trim(), body: form.body.trim(), visibility: form.visibility, revealAt: form.visibility === 'scheduled' ? new Date(form.revealAt).toISOString() : null });
      setShowForm(false); setForm({ title: '', body: '', visibility: 'shared', revealAt: '' }); refresh();
      notify(form.visibility === 'scheduled' ? 'Letter sealed until its reveal time.' : form.visibility === 'private_draft' ? 'Private draft saved — only you can see it.' : 'Letter shared.');
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not save.', 'error'); }
  };

  return (
    <Page title="Letters" subtitle="Shared letters, private drafts, and letters sealed until a date you choose. A sealed letter shows only its envelope to the other person — never its words — until that time." actions={<Button onClick={() => setShowForm(true)}>Write a letter</Button>}>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <label className="flex-1"><span className="sr-only">Search letters</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by title or author (sealed letters are never searched by body)…" className={inputCls} /></label>
        <div role="tablist" aria-label="Letter views" className="flex flex-wrap gap-2">
          {(['shared', 'drafts', 'sealed', 'all'] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`min-h-11 rounded-full px-4 py-2 text-sm ${tab === t ? 'bg-gold text-night-900' : 'border border-cocoa/25 text-ivory'}`}>
              {t === 'shared' ? 'Shared' : t === 'drafts' ? 'My drafts' : t === 'sealed' ? 'Sealed' : 'All I can see'}
            </button>
          ))}
        </div>
      </div>

      {letters.length === 0 ? <Empty title="No letters here yet" body={tab === 'sealed' ? 'No sealed letters are waiting. When one is, it will show here as an envelope only.' : tab === 'drafts' ? 'Private drafts live here, visible only to you, until you decide otherwise.' : 'Write the first letter. It does not need an occasion.'} action={<Button onClick={() => setShowForm(true)}>Write a letter</Button>} /> : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {letters.map((l) => {
            const sealed = isSealed(l, store.viewerId);
            return (
              <li key={l.id}>
                <Card>
                  <Washi tone="powder" />
                  <p className="text-xs uppercase tracking-widest text-blue-soft">{sealed ? '✉ Sealed' : l.visibility === 'private_draft' ? 'Private draft · only you' : l.visibility === 'scheduled' && l.revealAt && new Date(l.revealAt).getTime() > Date.now() ? `Scheduled · opens ${formatDateTime(l.revealAt)}` : l.visibility === 'scheduled' ? `Revealed ${formatDateTime(l.revealAt)}` : 'Shared'}</p>
                  <button onClick={() => setSelected(l)} className="font-serif-display mt-2 block text-left text-xl leading-snug text-ivory">{l.title}</button>
                  <p className="mt-2 text-sm leading-relaxed text-ivory-dim">{sealed ? 'This letter is sealed. Its words will appear here at its reveal time.' : l.body.slice(0, 140) + (l.body.length > 140 ? '…' : '')}</p>
                  <p className="mt-3 text-xs text-ivory-dim">From {l.authorName} · {formatDate(l.createdAt)}{sealed && l.revealAt ? ` · Opens ${formatDateTime(l.revealAt)}` : ''}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="quiet" onClick={() => setSelected(l)}>{sealed ? 'See envelope' : 'Open'}</Button>
                    {!sealed && <FavoriteButton active={l.isFavorite} label="Save letter to favourites" onToggle={async () => { await store.toggleFavorite('letters', l.id); refresh(); }} />}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {showForm && <Modal title="Write a letter" onClose={() => setShowForm(false)}>
        <div className="space-y-3">
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
          <div className="flex gap-2"><Button onClick={save}>Save letter</Button><Button variant="quiet" onClick={() => setShowForm(false)}>Cancel</Button></div>
        </div>
      </Modal>}

      {selected && <Modal title={selected.title} onClose={() => setSelected(null)}>
        {isSealed(selected, store.viewerId) ? (
          <div className="py-6 text-center">
            <p className="text-4xl" aria-hidden="true">✉</p>
            <p className="font-serif-display mt-3 text-xl">Sealed, with care.</p>
            <p className="mt-2 text-sm leading-relaxed text-ivory-dim">From {selected.authorName}. This letter opens {formatDateTime(selected.revealAt)}. Nothing about its words is shown before then.</p>
          </div>
        ) : (
          <>
            <p className="text-sm text-ivory-dim">From {selected.authorName} · {formatDate(selected.createdAt)}{selected.visibility === 'private_draft' ? ' · Private draft' : ''}</p>
            <div className="letter-paper mt-4"><p className="whitespace-pre-wrap text-base leading-[28px]">{selected.body}</p></div>
            <div className="mt-4 flex flex-wrap gap-2">
              <FavoriteButton active={selected.isFavorite} label="Save letter to favourites" onToggle={async () => { await store.toggleFavorite('letters', selected.id); refresh(); setSelected({ ...selected, isFavorite: !selected.isFavorite }); }} />
              <ConfirmDelete onConfirm={async () => { await store.softDelete('letters', selected.id); setSelected(null); refresh(); notify('Moved to Deleted.'); }} />
            </div>
          </>
        )}
      </Modal>}
    </Page>
  );
}

const SUPPORTIVE = [
  'You do not have to fix everything today.',
  'Rest is not falling behind.',
  'You are allowed to have a slow day.',
  'One small thing at a time is enough.',
  'You have handled hard days before. You can handle this one gently.',
];

export function QuietRoom({ store, refresh, notify }: Props) {
  const [breathing, setBreathing] = useState(false);
  const [phase, setPhase] = useState<'Inhale' | 'Hold' | 'Exhale'>('Inhale');
  const [support, setSupport] = useState('');
  const [journalTitle, setJournalTitle] = useState('');
  const [journalBody, setJournalBody] = useState('');
  const [journalMood, setJournalMood] = useState('calm');
  const [voiceTitle, setVoiceTitle] = useState('');
  const [recording, setRecording] = useState<MediaRecorder | null>(null);
  const [voiceFile, setVoiceFile] = useState<File | null>(null);

  // Breathing cycle: inhale 4s, hold 4s, exhale 6s. No audio, ever, unless the user presses play on a recording.
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

  const journals = store.visibleJournals().slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const supportiveNotes = store.shared(store.data.appreciations).filter((a) => a.kind === 'encouragement');

  const saveJournal = async () => {
    const err = validateRequired(journalTitle, 'A title', 200) || validateRequired(journalBody, 'Your entry', 20000);
    if (err) return notify(err, 'error');
    try {
      await store.create('journals', { spaceId: store.data.space.id, authorId: store.viewerId, authorName: store.viewerName, title: journalTitle.trim(), body: journalBody.trim(), mood: journalMood, visibility: 'private' });
      setJournalTitle(''); setJournalBody(''); refresh(); notify('Private journal entry saved — only you can read it.');
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not save.', 'error'); }
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
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: BlobPart[] = [];
      const rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setVoiceFile(new File(chunks, `voice-note.${rec.mimeType.includes('mp4') ? 'm4a' : 'webm'}`, { type: rec.mimeType }));
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
    <Page title="Quiet Room" subtitle="A softer corner. Supportive words, a slow breath, and journals that belong to one person alone — never shared, never listed for the other person.">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="font-serif-display text-xl">Breathe, slowly</h2>
          <p className="mt-1 text-sm text-ivory-dim">Inhale 4 · Hold 4 · Exhale 6. No sound. Stop whenever you like.</p>
          <div className="flex flex-col items-center py-5">
            <div aria-live="polite" className={`flex h-28 w-28 items-center justify-center rounded-full border-2 border-cocoa/40 bg-sage text-center transition-all duration-[4000ms] ${breathing && phase === 'Inhale' ? 'scale-125' : breathing && phase === 'Exhale' ? 'scale-90' : 'scale-100'}`}>
              <span className="font-serif-display text-lg">{breathing ? phase : 'Ready'}</span>
            </div>
            <div className="mt-4 flex gap-2">
              {!breathing ? <Button onClick={startBreathing}>Begin breathing</Button> : <Button variant="quiet" onClick={stopBreathing}>Stop</Button>}
            </div>
          </div>
          <p className="text-xs text-ivory-dim">With reduced-motion on, the circle stays still and only the word changes.</p>
        </Card>

        <Card>
          <h2 className="font-serif-display text-xl">Something supportive</h2>
          <p className="mt-2 text-sm leading-relaxed text-ivory-dim">{SUPPORTIVE[Math.floor(Date.now() / 86400000) % SUPPORTIVE.length]}</p>
          <div className="mt-4 space-y-3">
            <Field label="Leave a supportive note for your partner"><textarea value={support} onChange={(e) => setSupport(e.target.value)} rows={3} className={inputCls} maxLength={2000} placeholder="Something gentle, for them to find…" /></Field>
            <Button onClick={saveSupport}>Leave it here</Button>
          </div>
          {supportiveNotes.length > 0 && <ul className="mt-4 space-y-2">{supportiveNotes.slice(0, 3).map((n) => <li key={n.id} className="text-sm leading-relaxed text-ivory">“{n.text}” <span className="text-ivory-dim">— {n.authorName}</span></li>)}</ul>}
        </Card>
      </div>

      <Card className="mt-4">
        <h2 className="font-serif-display text-xl">Voice notes — only when you press play</h2>
        <p className="mt-1 text-sm text-ivory-dim">Record a short note, or upload audio. Nothing here auto-plays, ever.</p>
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
      </Card>

      <Card className="mt-4">
        <h2 className="font-serif-display text-xl">My private journal</h2>
        <p className="mt-1 text-sm text-ivory-dim">Only you can read these. They are not shown to your partner in any list, search, or shared view — in demo mode or under Supabase RLS.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <Field label="Title"><input value={journalTitle} onChange={(e) => setJournalTitle(e.target.value)} className={inputCls} maxLength={200} /></Field>
          <Field label="How does it feel?"><select value={journalMood} onChange={(e) => setJournalMood(e.target.value)} className={inputCls}><option value="calm">Calm</option><option value="heavy">Heavy</option><option value="hopeful">Hopeful</option><option value="tired">Tired</option><option value="grateful">Grateful</option><option value="unsure">Unsure</option></select></Field>
        </div>
        <div className="mt-3"><Field label="Entry"><textarea value={journalBody} onChange={(e) => setJournalBody(e.target.value)} rows={5} className={inputCls} maxLength={20000} placeholder="Write only for yourself…" /></Field></div>
        <div className="mt-3"><Button onClick={saveJournal}>Save privately</Button></div>
        <ul className="mt-5 space-y-3">
          {journals.length === 0 && <li className="text-sm text-ivory-dim">No private entries yet.</li>}
          {journals.map((j) => (
            <li key={j.id} className="journal-private p-4">
              <p className="text-xs font-extrabold uppercase tracking-widest text-plum">🔒 Private — only you can read this</p>
              <p className="font-serif-display mt-1 text-lg">{j.title} <span className="text-sm text-ivory-dim">· {j.mood} · {formatDate(j.createdAt)}</span></p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ivory">{j.body}</p>
              <div className="mt-2"><ConfirmDelete onConfirm={async () => { await store.softDelete('journals', j.id); refresh(); notify('Moved to Deleted.'); }} /></div>
            </li>
          ))}
        </ul>
      </Card>
    </Page>
  );
}
