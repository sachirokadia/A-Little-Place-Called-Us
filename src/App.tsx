import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PlaceStore } from './lib/store';
import { supabase, supabaseConfigured } from './lib/supabase';
import { apiConfigured, apiLogin, apiMe, apiRegister, clearApiToken, getApiToken } from './lib/api';
import type { RoomId } from './lib/types';
import { Home } from './components/Home';
import { Toast, Button, Modal, Field, inputCls, Card, Page } from './components/ui';
import { RemindersRoom, MemoriesRoom } from './rooms/RemindersMemories';
import { LettersRoom, QuietRoom } from './rooms/LettersQuiet';
import { AppreciationsRoom, FutureRoom, DeletedRoom } from './rooms/FutureAppreciations';

const NAV: { id: RoomId; label: string; icon: string }[] = [
  { id: 'home', label: 'Home', icon: '⌂' },
  { id: 'reminders', label: 'Reminders', icon: '✦' },
  { id: 'memories', label: 'Memories', icon: '❦' },
  { id: 'letters', label: 'Letters', icon: '✉' },
  { id: 'quiet', label: 'Quiet Room', icon: '☾' },
  { id: 'appreciations', label: 'See in You', icon: '✧' },
  { id: 'future', label: 'Our Future', icon: '→' },
];

export default function App() {
  const storeRef = useRef<PlaceStore | null>(null);
  if (!storeRef.current) storeRef.current = new PlaceStore('demo-you', 'You');
  const store = storeRef.current;
  const [, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  const [room, setRoom] = useState<RoomId>(() => (location.hash.replace('#', '') as RoomId) || 'home');
  const [toast, setToast] = useState<{ msg: string; kind: 'ok' | 'error' }>({ msg: '', kind: 'ok' });
  const [randomNote, setRandomNote] = useState<string | null>(null);
  const [authState, setAuthState] = useState<'unknown' | 'signed-out' | 'signed-in'>('unknown');
  const [authForm, setAuthForm] = useState({ email: '', password: '' });
  const [spaceForm, setSpaceForm] = useState({ name: 'A Little Place Called Us', invite: '' });
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const notify = useCallback((msg: string, kind: 'ok' | 'error' = 'ok') => {
    setToast({ msg, kind });
    setTimeout(() => setToast({ msg: '', kind: 'ok' }), 4000);
  }, []);

  const go = useCallback((r: RoomId) => {
    setRoom(r);
    location.hash = r;
    window.scrollTo({ top: 0 });
  }, []);

  useEffect(() => {
    const onHash = () => { const h = location.hash.replace('#', '') as RoomId; if (h) setRoom(h); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // PWA: register the service worker (production only; harmless in dev if it 404s).
  useEffect(() => {
    if ('serviceWorker' in navigator && import.meta.env.PROD) {
      navigator.serviceWorker.register('/sw.js').catch(() => { /* offline support is optional */ });
    }
  }, []);

  // Auth gate: PostgreSQL API mode first, then Supabase, otherwise demo mode is the whole app.
  useEffect(() => {
    if (apiConfigured) {
      if (!getApiToken()) { setAuthState('signed-out'); return; }
      apiMe().then(() => setAuthState('signed-in')).catch(() => { clearApiToken(); setAuthState('signed-out'); });
      return;
    }
    if (!supabaseConfigured || !supabase) { setAuthState('signed-in'); return; }
    supabase.auth.getSession().then(({ data }) => setAuthState(data.session ? 'signed-in' : 'signed-out'));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => setAuthState(session ? 'signed-in' : 'signed-out'));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (authState !== 'signed-in') return;
    if (apiConfigured) {
      setLoading(true);
      store.loadFromApi().then((ok) => {
        if (!ok) {
          setLoadError('You are signed in, but you are not in a space yet. Create one below, or join with an invite code.');
          store.clearToEmpty(); // never show demo samples to a signed-in user
        } else setLoadError(null);
        refresh();
      }).catch((e) => setLoadError(e instanceof Error ? e.message : 'Could not load your space.')).finally(() => setLoading(false));
      return;
    }
    if (!supabaseConfigured) return;
    setLoading(true);
    store.loadFromSupabase().then((ok) => {
      if (!ok) {
        setLoadError('You are signed in, but you are not in a space yet. Create one below, or join with an invite code.');
        store.clearToEmpty(); // never show demo samples to a signed-in user
      } else setLoadError(null);
      refresh();
    }).catch((e) => setLoadError(e instanceof Error ? e.message : 'Could not load your space.')).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState]);

  const viewerLabel = useMemo(() => (store.mode === 'demo' ? store.viewerName : 'You'), [store.version]);

  const pickRandom = () => {
    const pool = store.shared(store.data.reminders);
    if (!pool.length) return notify('No notes yet — write the first one in the Reminder Room.', 'error');
    setRandomNote(pool[Math.floor(Math.random() * pool.length)].text);
  };

  if (apiConfigured && authState === 'unknown') {
    return <main className="mx-auto max-w-md px-4 py-20 text-center"><p className="font-serif-display text-2xl">Opening your place…</p><p className="mt-2 text-sm text-[#d8d2c4]">Checking your session.</p></main>;
  }

  if (apiConfigured && authState === 'signed-out') {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-16">
        <p className="text-xs uppercase tracking-[0.25em] text-[#e8c87a]">A quiet place, kept for two</p>
        <h1 className="font-serif-display mt-3 text-4xl leading-tight">A Little Place Called Us</h1>
        <p className="mt-3 text-sm leading-relaxed text-[#d8d2c4]">Each person signs in with their own account, stored in PostgreSQL. A space holds exactly two members, invited by code — never public, never searchable.</p>
        <form className="mt-6 space-y-3 rounded-2xl bg-[#1d2a4a] border border-[#e8c87a]/40 p-5 [&_.field-label]:text-[#f8f1e7]" onSubmit={async (e) => {
          e.preventDefault();
          setLoading(true);
          try { await apiLogin(authForm.email, authForm.password); setAuthState('signed-in'); }
          catch (err) { notify(err instanceof Error ? err.message : 'Could not sign in.', 'error'); }
          setLoading(false);
        }}>
          <Field label="Email"><input type="email" required value={authForm.email} onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })} className={inputCls} autoComplete="email" /></Field>
          <Field label="Password"><input type="password" required minLength={8} value={authForm.password} onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })} className={inputCls} autoComplete="current-password" /></Field>
          <Button type="submit" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</Button>
          <Button variant="night-quiet" disabled={loading} onClick={async () => {
            if (!authForm.email.trim() || authForm.password.length < 8) { notify('Enter an email and a password (at least 8 characters) first.', 'error'); return; }
            setLoading(true);
            try { await apiRegister(authForm.email, authForm.password, authForm.email.split('@')[0]); setAuthState('signed-in'); notify('Account created. Now create or join a space.'); }
            catch (err) { notify(err instanceof Error ? err.message : 'Could not create an account.', 'error'); }
            setLoading(false);
          }}>Create an account instead</Button>
        </form>
        <p className="mt-4 text-xs leading-relaxed text-[#d8d2c4]">No analytics, no tracking, no notifications are built into this app.</p>
        <Toast message={toast.msg} kind={toast.kind} />
      </main>
    );
  }

  if (supabaseConfigured && authState === 'unknown') {
    return <main className="mx-auto max-w-md px-4 py-20 text-center"><p className="font-serif-display text-2xl">Opening your place…</p><p className="mt-2 text-sm text-[#d8d2c4]">Checking your session.</p></main>;
  }

  if (supabaseConfigured && authState === 'signed-out') {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-16">
        <p className="text-xs uppercase tracking-[0.25em] text-[#e8c87a]">A quiet place, kept for two</p>
        <h1 className="font-serif-display mt-3 text-4xl leading-tight">A Little Place Called Us</h1>
        <p className="mt-3 text-sm leading-relaxed text-[#d8d2c4]">Each person signs in with their own account. A space holds exactly two members, invited by code — never public, never searchable.</p>
        <form className="mt-6 space-y-3 rounded-2xl bg-[#1d2a4a] border border-[#e8c87a]/40 p-5 [&_.field-label]:text-[#f8f1e7]" onSubmit={async (e) => {
          e.preventDefault();
          if (!supabase) return;
          setLoading(true);
          const { error } = await supabase.auth.signInWithPassword({ email: authForm.email, password: authForm.password });
          setLoading(false);
          if (error) notify(error.message, 'error');
        }}>
          <Field label="Email"><input type="email" required value={authForm.email} onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })} className={inputCls} autoComplete="email" /></Field>
          <Field label="Password"><input type="password" required value={authForm.password} onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })} className={inputCls} autoComplete="current-password" /></Field>
          <Button type="submit" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</Button>
          <Button variant="night-quiet" disabled={loading} onClick={async () => {
            if (!supabase) return;
            if (!authForm.email.trim() || authForm.password.length < 8) { notify('Enter an email and a password (at least 8 characters) first.', 'error'); return; }
            setLoading(true);
            const { error } = await supabase.auth.signUp({ email: authForm.email, password: authForm.password });
            setLoading(false);
            notify(error ? error.message : 'Account created. Check your email to confirm, if Supabase email confirmation is on, then sign in.', error ? 'error' : 'ok');
          }}>Create an account instead</Button>
        </form>
        <p className="mt-4 text-xs leading-relaxed text-[#d8d2c4]">No analytics, no tracking, no notifications are built into this app.</p>
        <Toast message={toast.msg} kind={toast.kind} />
      </main>
    );
  }

  const roomProps = { store, refresh, notify };

  return (
    <div className="min-h-screen bg-[#0d1526] text-[#f8f1e7]">
      {store.mode === 'demo' && (
        <div role="status" className="bg-butter px-4 py-2 text-center text-xs leading-relaxed text-cocoa ring-1 ring-inset ring-cocoa/20">
          Demo mode — sample content, saved on this device only. Connect Supabase (see README) to sync privately across devices. You are viewing as <strong>{viewerLabel}</strong>.
          <button className="ml-2 underline" onClick={() => { const other = store.viewerId === 'demo-you' ? { id: 'demo-partner', name: 'Partner' } : { id: 'demo-you', name: 'You' }; store.setViewer(other.id, other.name); refresh(); notify(`Now viewing as ${other.name}. Private journals and drafts follow the viewer — try the Quiet Room and Letters drafts.`); }}>Switch to {store.viewerId === 'demo-you' ? 'Partner' : 'You'}</button>
        </div>
      )}

      {loadError && (
        <div role="alert" className="mx-auto mt-4 max-w-3xl px-4">
          <Card>
            <p className="font-serif-display text-xl">Your space is not set up yet</p>
            <p className="mt-1 text-sm text-cocoa-soft">{loadError}</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Field label="New space name"><input value={spaceForm.name} onChange={(e) => setSpaceForm({ ...spaceForm, name: e.target.value })} className={inputCls} /></Field>
                <Button onClick={async () => { try { const s = await store.createSpace(spaceForm.name); setLoadError(null); refresh(); notify(`Space created. Invite code: ${s.inviteCode} — share it privately with your partner.`); } catch (e) { notify(e instanceof Error ? e.message : 'Could not create space.', 'error'); } }}>Create a space</Button>
              </div>
              <div className="space-y-2">
                <Field label="Invite code from your partner"><input value={spaceForm.invite} onChange={(e) => setSpaceForm({ ...spaceForm, invite: e.target.value.toUpperCase() })} className={inputCls} placeholder="e.g. K7M2QX" /></Field>
                <Button variant="quiet" onClick={async () => { try { await store.joinSpace(spaceForm.invite); setLoadError(null); if (apiConfigured) await store.loadFromApi(); else await store.loadFromSupabase(); refresh(); notify('Joined your shared space.'); } catch (e) { notify(e instanceof Error ? e.message : 'Could not join.', 'error'); } }}>Join a space</Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {room === 'home' && <Home store={store} go={go} onRandomReminder={pickRandom} />}
      {room === 'reminders' && <RemindersRoom {...roomProps} />}
      {room === 'memories' && <MemoriesRoom {...roomProps} />}
      {room === 'letters' && <LettersRoom {...roomProps} />}
      {room === 'quiet' && <QuietRoom {...roomProps} />}
      {room === 'appreciations' && <AppreciationsRoom {...roomProps} />}
      {room === 'future' && <FutureRoom {...roomProps} />}
      {room === 'deleted' && <DeletedRoom {...roomProps} />}
      {room === 'settings' && (
        <Page title="Settings" subtitle="Your place, your rules. Nothing here is shared beyond your two-member space.">
          <div className="grid gap-3">
            <Card>
              <h2 className="font-serif-display text-xl">This space</h2>
              <p className="mt-2 text-sm text-cocoa-soft">Name: <span className="text-ivory">{store.data.space.name}</span></p>
              <p className="mt-1 text-sm text-cocoa-soft">Mode: <span className="text-ivory">{store.mode === 'demo' ? 'Demo (this device only)' : store.mode === 'api' ? 'PostgreSQL (synced, server-enforced)' : 'Supabase (synced, RLS-protected)'}</span></p>
              <p className="mt-1 text-sm text-cocoa-soft">Invite code: <span className="text-ivory">{store.data.space.inviteCode}</span> — share it privately, never publicly. A space holds at most two members.</p>
              <p className="mt-1 text-sm text-cocoa-soft">Deletion: soft first (Deleted room, restorable), permanent only by a second deliberate confirmation.</p>
            </Card>
            <Card>
              <h2 className="font-serif-display text-xl">Install on your phone</h2>
              <p className="mt-2 text-sm leading-relaxed text-cocoa-soft">On Android: open in Chrome → menu → “Add to Home screen”. On iPhone: open in Safari → Share → “Add to Home Screen”. The app works as a standalone app after that; no app store, no account beyond your own sign-in.</p>
            </Card>
            <Card>
              <h2 className="font-serif-display text-xl">Privacy, plainly</h2>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-cocoa-soft">
                <li>Private journals and private drafts are readable only by their author — enforced by Supabase RLS, not just hidden in the UI.</li>
                <li>Scheduled letters are masked for the recipient (SQL view) until their reveal time.</li>
                <li>Photos and voice notes live in a private storage bucket; the app uses short-lived signed URLs, never public links.</li>
                <li>No analytics, tracking, notifications, streaks, or guilt reminders are included.</li>
              </ul>
            </Card>
            <div className="flex flex-wrap gap-2">
              <Button variant="quiet" onClick={() => go('deleted')}>Open Deleted (recoverable)</Button>
              {store.mode === 'demo' && <Button variant="danger" onClick={() => { if (confirm('Clear all demo content on this device? This cannot be undone.')) { localStorage.removeItem('our-place-demo-v1'); location.reload(); } }}>Clear demo content</Button>}
              {apiConfigured && <Button variant="quiet" onClick={() => { clearApiToken(); location.reload(); }}>Sign out</Button>}
              {supabaseConfigured && <Button variant="quiet" onClick={async () => { await supabase?.auth.signOut(); }}>Sign out</Button>}
            </div>
          </div>
        </Page>
      )}

      {/* Game HUD dock: icon above label, labels wrap instead of truncating —
          the old single-line bar cut "See in You" off on narrow phones. */}
      <nav aria-label="Main navigation" className="fixed inset-x-0 bottom-0 z-30 border-t-2 border-[#e8c87a]/60 bg-[#101a30]/95 shadow-[0_-8px_24px_rgba(0,0,0,0.45)] backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-stretch justify-between gap-1 px-2 py-1.5">
          {NAV.map((n) => (
            <button key={n.id} onClick={() => go(n.id)} aria-current={room === n.id ? 'page' : undefined}
              className={`flex min-h-14 flex-1 flex-col items-center justify-center rounded-xl px-0.5 py-1 text-[10px] font-bold leading-tight sm:text-xs ${room === n.id ? 'bg-[#e8c87a] text-[#241d12]' : 'text-[#d8d2c4] hover:bg-white/10'}`}>
              <span aria-hidden="true" className="text-base leading-none">{n.icon}</span>
              <span>{n.label}</span>
            </button>
          ))}
          <button onClick={() => go('settings')} aria-current={room === 'settings' ? 'page' : undefined}
            className={`flex min-h-14 flex-1 flex-col items-center justify-center rounded-xl px-0.5 py-1 text-[10px] font-bold leading-tight sm:text-xs ${room === 'settings' ? 'bg-[#e8c87a] text-[#241d12]' : 'text-[#d8d2c4] hover:bg-white/10'}`}>
            <span aria-hidden="true" className="text-base leading-none">⚙</span>
            <span>Settings</span>
          </button>
        </div>
      </nav>

      {randomNote && <Modal title="A note for today" onClose={() => setRandomNote(null)}>
        <p className="font-serif-display text-xl leading-relaxed">{randomNote}</p>
        <p className="mt-3 text-sm text-[#d8d2c4]">No streak, no task attached. Just a note, when you wanted one.</p>
        <div className="mt-4"><Button onClick={() => setRandomNote(null)}>Keep it with me</Button></div>
      </Modal>}

      <Toast message={toast.msg} kind={toast.kind} />
    </div>
  );
}
