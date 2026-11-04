import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PlaceStore, clearDemoData } from './lib/store';
import { supabase, supabaseConfigured } from './lib/supabase';
import { apiConfigured, apiLogin, apiMe, apiRegister, clearApiToken, getApiToken } from './lib/api';
import type { RoomId } from './lib/types';
import { Home, COTTAGE_THEME_KEY, readCottageTheme } from './components/Home';
import { Introduction, INTRO_KEY } from './components/Introduction';
import { Toast, Button, Modal, Field, inputCls, Card, Page } from './components/ui';
import { RoomFrame } from './components/design-primitives';
import { RemindersRoom, MemoriesRoom } from './rooms/RemindersMemories';
import { LettersRoom, QuietRoom } from './rooms/LettersQuiet';
import { AppreciationsRoom, FutureRoom, DeletedRoom } from './rooms/FutureAppreciations';
import { ArcadeRoom } from './rooms/Arcade';
import { KeepsakesRoom } from './rooms/Keepsakes';
import { SearchRoom } from './rooms/Search';
import { ActivityFeed, InvitationPanel, PersonalizationPanel, PrivacyLegend, ProfileCards } from './components/SpaceSection';
import { DeskDrawer } from './components/SettingsDrawer';
import { applyTextSize, readHighContrast, readSoundPrefs, readTextSize, saveHighContrast, saveSoundPrefs, saveTextSize, type SoundPrefs, type TextSize } from './lib/preferences';
import { attemptLeave } from './lib/dirtyGuard';

const NAV: { id: RoomId; label: string; icon: string }[] = [
  { id: 'home', label: 'Home', icon: '⌂' },
  { id: 'reminders', label: 'Reminders', icon: '✦' },
  { id: 'memories', label: 'Memories', icon: '❦' },
  { id: 'letters', label: 'Letters', icon: '✉' },
  { id: 'quiet', label: 'Quiet Room', icon: '☾' },
  { id: 'appreciations', label: 'See in You', icon: '✧' },
  { id: 'future', label: 'Our Future', icon: '→' },
  { id: 'arcade', label: 'Arcade', icon: '◎' },
];

export default function App() {
  const storeRef = useRef<PlaceStore | null>(null);
  if (!storeRef.current) storeRef.current = new PlaceStore('demo-you', 'You');
  const store = storeRef.current;
  const [, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  const [room, setRoom] = useState<RoomId>(() => (location.hash.replace('#', '') as RoomId) || 'home');
  /* Animated introduction: state lives in App, not in Home, so the
     Settings control below can reset it. The key is per-device
     localStorage, distinct from the welcome card's
     'our-place-welcome-dismissed' — dismissing one never dismisses the
     other. Both Enter and Skip set it (see dismissIntro). */
  const [introSeen, setIntroSeen] = useState(() => {
    try { return localStorage.getItem(INTRO_KEY) === '1'; } catch { return false; }
  });
  const dismissIntro = useCallback(() => {
    try { localStorage.setItem(INTRO_KEY, '1'); } catch { /* private mode: seen lasts for this session */ }
    setIntroSeen(true);
  }, []);
  /* Re-read on every Home landing: the Settings reset removes the key
     while this shell stays mounted, so a sticky "seen" would swallow
     the reset and the introduction would never reappear. The reset
     button also sets the state directly; this is the second layer. */
  useEffect(() => {
    if (room !== 'home') return;
    try { setIntroSeen(localStorage.getItem(INTRO_KEY) === '1'); } catch { /* private mode */ }
  }, [room]);
  const [toast, setToast] = useState<{ msg: string; kind: 'ok' | 'error' }>({ msg: '', kind: 'ok' });
  const [randomNote, setRandomNote] = useState<string | null>(null);
  const [authState, setAuthState] = useState<'unknown' | 'signed-out' | 'signed-in'>('unknown');
  const [authForm, setAuthForm] = useState({ email: '', password: '' });
  const [spaceForm, setSpaceForm] = useState({ name: 'A Little Place Called Us', invite: '' });
  const [cottageTheme, setCottageTheme] = useState<'day' | 'night'>('day');
  /* Reduced motion: read the stored preference at BOOT (state
     initialiser), not only when Settings renders — previously the
     state started false and was only re-read on landing in Settings,
     so a fresh load with the preference stored still animated until
     Settings was visited. The index.html boot script adds the same
     class to <html> before first paint; this effect keeps <html> in
     sync with the toggle afterwards. */
  const [reduceMotionPref, setReduceMotionPref] = useState(() => {
    try { return localStorage.getItem('our-place-reduce-motion') === '1'; } catch { return false; }
  });
  useEffect(() => {
    try {
      if (reduceMotionPref) document.documentElement.classList.add('reduce-motion');
      else document.documentElement.classList.remove('reduce-motion');
    } catch { /* private mode */ }
  }, [reduceMotionPref]);
  /* Phase 17 preferences (all device-local; see lib/preferences.ts).
     Text size applies to <html> on boot and on change; high contrast
     is a class on the root div below. */
  const [soundPrefs, setSoundPrefs] = useState<SoundPrefs>(() => readSoundPrefs());
  const [textSize, setTextSizeState] = useState<TextSize>(() => readTextSize());
  const [highContrast, setHighContrastState] = useState<boolean>(() => readHighContrast());
  const [isOnline, setIsOnline] = useState<boolean>(() => typeof navigator === 'undefined' || navigator.onLine);
  useEffect(() => { applyTextSize(textSize); }, [textSize]);
  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  const setTextSize = (v: TextSize) => { saveTextSize(v); setTextSizeState(v); };
  const setHighContrast = (v: boolean) => { saveHighContrast(v); setHighContrastState(v); };
  const setSound = (v: SoundPrefs) => { saveSoundPrefs(v); setSoundPrefs(v); };
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  useEffect(() => {
    if (room !== 'settings') return;
    setCottageTheme(readCottageTheme());
    try { setReduceMotionPref(localStorage.getItem('our-place-reduce-motion') === '1'); } catch { setReduceMotionPref(false); }
  }, [room]); // eslint-disable-line react-hooks/exhaustive-deps
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const notify = useCallback((msg: string, kind: 'ok' | 'error' = 'ok') => {
    setToast({ msg, kind });
    setTimeout(() => setToast({ msg: '', kind: 'ok' }), 4000);
  }, []);

  const roomRef = useRef<RoomId>('home');
  useEffect(() => { roomRef.current = room; }, [room]);
  /* STORYBOOK WORLDS — window-scroll restoration for Page rooms only
     (Arcade, Search, Settings, Deleted). RoomWorld rooms scroll inside
     their own element and restore themselves (see RoomWorld.tsx), so
     they are deliberately excluded here: restoring window scroll for
     them would fight the container restore. Home always lands at the
     top (fullscreen, scroll-locked). Values are bare numbers in
     sessionStorage — no content, nothing private. A saved position
     past a shortened page clamps to the new maximum, gracefully. */
  const isWorldRoom = (r: RoomId) => r === 'memories' || r === 'letters' || r === 'quiet' || r === 'appreciations' || r === 'future' || r === 'reminders' || r === 'keepsakes' || r === 'search';
  const saveWindowScroll = (r: RoomId) => { try { sessionStorage.setItem(`our-place-scroll-window-${r}`, String(window.scrollY)); } catch { /* private mode */ } };
  const restoreWindowScroll = (r: RoomId) => {
    if (r === 'home' || isWorldRoom(r)) { window.scrollTo({ top: 0 }); return; }
    let saved = 0;
    try { saved = Number(sessionStorage.getItem(`our-place-scroll-window-${r}`)) || 0; } catch { saved = 0; }
    requestAnimationFrame(() => window.scrollTo({ top: saved }));
  };
  // Deep-link / reload landing: restore the initial room's saved window scroll, if any.
  useEffect(() => { restoreWindowScroll(roomRef.current); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const go = useCallback((r: RoomId) => {
    if (!attemptLeave()) return; // unsaved text: stay, keep the text
    saveWindowScroll(roomRef.current);
    setRoom(r);
    location.hash = r;
    restoreWindowScroll(r);
  }, []);
  const scrollToId = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ block: 'start' });
  }, []);

  useEffect(() => {
    // An empty hash is Home — otherwise browser back from the first room
    // visited would leave the old room on screen with a blank hash.
    // Phase 17: a hash change (browser back/forward, Back-to-cottage
    // buttons that set location.hash directly) is also guarded: if
    // the user cancels the unsaved-changes confirm, the hash is
    // restored to the current room and the room does not change.
    let restoring = false;
    const onHash = () => {
      if (restoring) { restoring = false; return; }
      const h = (location.hash.replace('#', '') as RoomId) || 'home';
      if (h === roomRef.current) { setRoom(h); return; }
      if (!attemptLeave()) { restoring = true; location.hash = roomRef.current; return; }
      saveWindowScroll(roomRef.current);
      setRoom(h);
      restoreWindowScroll(h);
    };
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

  /* Demo-mode viewer switch, shared by the demo banner (other routes)
     and the front-door rooms menu on the fullscreen Home (where the
     banner is suppressed — see isCottageHome below). */
  const switchViewer = useCallback(() => {
    const other = store.viewerId === 'demo-you' ? { id: 'demo-partner', name: 'Partner' } : { id: 'demo-you', name: 'You' };
    store.setViewer(other.id, other.name);
    refresh();
    notify(`Now viewing as ${other.name}. Private journals and drafts follow the viewer — try the Quiet Room and Letters drafts.`);
  }, [store, refresh, notify]);

  if (apiConfigured && authState === 'unknown') {
    return <main className="mx-auto max-w-md px-4 py-20 text-center"><p className="font-serif-display text-2xl">Opening your place…</p><p className="mt-2 text-sm text-cocoa-soft">Checking your session.</p></main>;
  }

  if (apiConfigured && authState === 'signed-out') {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-16">
        <p className="text-xs uppercase tracking-[0.25em] text-plum">A quiet place, kept for two</p>
        <h1 className="font-serif-display mt-3 text-4xl leading-tight">A Little Place Called Us</h1>
        <p className="mt-3 text-sm leading-relaxed text-cocoa-soft">Each person signs in with their own account, stored in PostgreSQL. A space holds exactly two members, invited by code — never public, never searchable.</p>
        <form className="mt-6 space-y-3 rounded-2xl bg-paper border border-cocoa/25 p-5 shadow-[0_14px_30px_rgba(81,68,61,0.12)]" onSubmit={async (e) => {
          e.preventDefault();
          setLoading(true);
          try { await apiLogin(authForm.email, authForm.password); setAuthState('signed-in'); }
          catch (err) { notify(err instanceof Error ? err.message : 'Could not sign in.', 'error'); }
          setLoading(false);
        }}>
          <Field label="Email"><input type="email" required value={authForm.email} onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })} className={inputCls} autoComplete="email" /></Field>
          <Field label="Password"><input type="password" required minLength={8} value={authForm.password} onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })} className={inputCls} autoComplete="current-password" /></Field>
          <Button type="submit" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</Button>
          <Button variant="quiet" disabled={loading} onClick={async () => {
            if (!authForm.email.trim() || authForm.password.length < 8) { notify('Enter an email and a password (at least 8 characters) first.', 'error'); return; }
            setLoading(true);
            try { await apiRegister(authForm.email, authForm.password, authForm.email.split('@')[0]); setAuthState('signed-in'); notify('Account created. Now create or join a space.'); }
            catch (err) { notify(err instanceof Error ? err.message : 'Could not create an account.', 'error'); }
            setLoading(false);
          }}>Create an account instead</Button>
        </form>
        <p className="mt-4 text-xs leading-relaxed text-cocoa-soft">No analytics, no tracking, no notifications are built into this app.</p>
        <Toast message={toast.msg} kind={toast.kind} />
      </main>
    );
  }

  if (supabaseConfigured && authState === 'unknown') {
    return <main className="mx-auto max-w-md px-4 py-20 text-center"><p className="font-serif-display text-2xl">Opening your place…</p><p className="mt-2 text-sm text-cocoa-soft">Checking your session.</p></main>;
  }

  if (supabaseConfigured && authState === 'signed-out') {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-16">
        <p className="text-xs uppercase tracking-[0.25em] text-plum">A quiet place, kept for two</p>
        <h1 className="font-serif-display mt-3 text-4xl leading-tight">A Little Place Called Us</h1>
        <p className="mt-3 text-sm leading-relaxed text-cocoa-soft">Each person signs in with their own account. A space holds exactly two members, invited by code — never public, never searchable.</p>
        <form className="mt-6 space-y-3 rounded-2xl bg-paper border border-cocoa/25 p-5 shadow-[0_14px_30px_rgba(81,68,61,0.12)]" onSubmit={async (e) => {
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
          <Button variant="quiet" disabled={loading} onClick={async () => {
            if (!supabase) return;
            if (!authForm.email.trim() || authForm.password.length < 8) { notify('Enter an email and a password (at least 8 characters) first.', 'error'); return; }
            setLoading(true);
            const { error } = await supabase.auth.signUp({ email: authForm.email, password: authForm.password });
            setLoading(false);
            notify(error ? error.message : 'Account created. Check your email to confirm, if Supabase email confirmation is on, then sign in.', error ? 'error' : 'ok');
          }}>Create an account instead</Button>
          <Button variant="quiet" type="button" disabled={loading} onClick={async () => {
            if (!supabase) return;
            if (!authForm.email.trim()) { notify('Enter your email first, then use this button to send a reset link.', 'error'); return; }
            setLoading(true);
            const { error } = await supabase.auth.resetPasswordForEmail(authForm.email.trim(), { redirectTo: window.location.origin });
            setLoading(false);
            // Deliberately the same message whether or not an account exists.
            notify(error ? error.message : 'If that email has an account, a reset link is on its way. Open it, sign in here, then set a new password in Settings.', error ? 'error' : 'ok');
          }}>Forgot your password?</Button>
        </form>
        <p className="mt-4 text-xs leading-relaxed text-cocoa-soft">No analytics, no tracking, no notifications are built into this app.</p>
        <Toast message={toast.msg} kind={toast.kind} />
      </main>
    );
  }

  // Production misconfiguration gate: a production build with neither backend configured
  // (or with a non-HTTPS backend URL, which the config flags treat as unconfigured) must
  // NOT fall through to demo mode. Demo mode looks like a working shared home while saving
  // only to this device, so a misconfigured production deployment could silently swallow
  // real private content. Fail safe with a clear message instead. Local development
  // (import.meta.env.DEV) still allows demo mode, and a correctly configured production
  // build never reaches this screen.
  if (import.meta.env.PROD && !apiConfigured && !supabaseConfigured) {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-16">
        <p className="text-xs uppercase tracking-[0.25em] text-plum">A quiet place, kept for two</p>
        <h1 className="font-serif-display mt-3 text-4xl leading-tight">A Little Place Called Us</h1>
        <div className="mt-6 rounded-2xl bg-paper border border-cocoa/25 p-5 shadow-[0_14px_30px_rgba(81,68,61,0.12)]">
          <p className="font-serif-display text-xl">This deployment is not set up yet</p>
          <p className="mt-2 text-sm leading-relaxed text-cocoa-soft">No shared backend is configured for this deployment, so nothing you enter here would sync to your partner or be saved beyond this page. Please ask the person who deployed it to set the Supabase configuration (VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, HTTPS only) and redeploy. Nothing has been saved.</p>
        </div>
      </main>
    );
  }

  const roomProps = { store, refresh, notify };

  /* Fullscreen-Home chrome suppression (Home layout only): the cottage
     Home is the whole viewport, so the demo banner and the fixed bottom
     nav must not appear over it — but ONLY once the actual Home renders.
     While the first-visit Introduction is showing (room is 'home' but
     introSeen is false), the banner and nav stay, exactly as before:
     the Introduction is not the Home layout and keeps its own spacing
     for the nav. On every other route both stay as well. Sign-out is
     NOT stranded: it lives inside the Settings room. The demo viewer
     switch IS re-homed: the door menu on Home carries it (Home gets
     switchViewer below), and the banner keeps it on other routes. */
  const isCottageHome = room === 'home' && introSeen;

  /* Phase 12A — full-screen room worlds (Memories, Letters, Quiet only):
     while a world is open the demo banner and the fixed bottom nav are
     suppressed, exactly as on the fullscreen cottage Home, so the world
     fills the viewport instead of floating on the app shell. The demo
     viewer switch is NOT lost: each world header carries it (RoomWorld
     gets onSwitchViewer below). Every other route keeps its chrome.
     Phase 12B extends the same shell, unchanged, to Appreciations,
     Future and Reminders. */
  const isRoomWorld = room === 'memories' || room === 'letters' || room === 'quiet' || room === 'appreciations' || room === 'future' || room === 'reminders' || room === 'keepsakes' || room === 'search';

  /* Space setup, shared by both presentations below: the same create /
     join form, rendered as a normal card on other routes and as a small
     in-scene overlay panel over the cottage on the fullscreen Home (so
     a user with no space yet can still set one up without a dashboard
     section appearing below the scene). */
  const spaceSetupCard = (
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
  );

  return (
    <div className={`min-h-screen bg-cream text-cocoa${reduceMotionPref ? ' reduce-motion' : ''}${highContrast ? ' high-contrast' : ''}`}>
      {!isOnline && (
        <div role="status" className="bg-rose px-4 py-2 text-center text-sm font-bold text-cocoa ring-1 ring-inset ring-rose-deep" data-testid="offline-banner">
          You are offline — saved things on this device are still here, but nothing new can sync to your partner until you are back online.
        </div>
      )}
      {store.mode === 'demo' && !isCottageHome && !isRoomWorld && (
        <div role="status" className="bg-butter px-4 py-2 text-center text-xs leading-relaxed text-cocoa ring-1 ring-inset ring-cocoa/20">
          Demo mode — sample content, saved on this device only. Connect Supabase (see README) to sync privately across devices. You are viewing as <strong>{viewerLabel}</strong>.
          <button className="ml-2 inline-flex min-h-11 items-center px-1 underline" onClick={switchViewer}>Switch to {store.viewerId === 'demo-you' ? 'Partner' : 'You'}</button>
        </div>
      )}

      {loadError && !isCottageHome && (
        <div role="alert" className="mx-auto mt-4 max-w-3xl px-4">
          {spaceSetupCard}
        </div>
      )}
      {loadError && isCottageHome && (
        <div role="alert" className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-cocoa/40 p-4 pt-10">
          <div className="w-full max-w-3xl">{spaceSetupCard}</div>
        </div>
      )}

      {/* Animated introduction sequencing: the introduction replaces Home
          ONLY — it is never laid over another room, and it lives inside
          the main shell, after every signed-out/unknown early return, so
          sign-in is never blocked by it. Deep-link rule: a user who
          deep-links to a room (initial room is not 'home') renders that
          room normally and leaves 'our-place-intro-seen' unset, so the
          introduction appears on the next Home landing until Enter or
          Skip dismisses it. After entering, Home renders with its
          WelcomeCard still present underneath/after: the welcome card
          has its own independent dismissal and is not deleted, replaced
          or altered by the introduction in any way. */}
      {room === 'home' && (introSeen
        ? <Home store={store} go={go} onRandomReminder={pickRandom} onSwitchViewer={switchViewer} />
        : <Introduction onDismiss={dismissIntro} />)}
      {room === 'reminders' && <RemindersRoom {...roomProps} onSwitchViewer={switchViewer} viewerLabel={viewerLabel} otherViewerLabel={store.viewerId === 'demo-you' ? 'Partner' : 'You'} />}
      {room === 'memories' && <MemoriesRoom {...roomProps} onSwitchViewer={switchViewer} viewerLabel={viewerLabel} otherViewerLabel={store.viewerId === 'demo-you' ? 'Partner' : 'You'} />}
      {room === 'letters' && <LettersRoom {...roomProps} onSwitchViewer={switchViewer} viewerLabel={viewerLabel} otherViewerLabel={store.viewerId === 'demo-you' ? 'Partner' : 'You'} />}
      {room === 'quiet' && <QuietRoom {...roomProps} onSwitchViewer={switchViewer} viewerLabel={viewerLabel} otherViewerLabel={store.viewerId === 'demo-you' ? 'Partner' : 'You'} />}
      {room === 'appreciations' && <AppreciationsRoom {...roomProps} onSwitchViewer={switchViewer} viewerLabel={viewerLabel} otherViewerLabel={store.viewerId === 'demo-you' ? 'Partner' : 'You'} />}
      {room === 'future' && <FutureRoom {...roomProps} onSwitchViewer={switchViewer} viewerLabel={viewerLabel} otherViewerLabel={store.viewerId === 'demo-you' ? 'Partner' : 'You'} />}
      {room === 'arcade' && <ArcadeRoom {...roomProps} />}
      {room === 'keepsakes' && <KeepsakesRoom {...roomProps} onSwitchViewer={switchViewer} viewerLabel={viewerLabel} otherViewerLabel={store.viewerId === 'demo-you' ? 'Partner' : 'You'} />}
      {room === 'search' && <SearchRoom {...roomProps} go={go} onSwitchViewer={switchViewer} viewerLabel={viewerLabel} otherViewerLabel={store.viewerId === 'demo-you' ? 'Partner' : 'You'} />}
      {room === 'deleted' && <DeletedRoom {...roomProps} />}
      {room === 'settings' && (
        <Page identity="settings" title="Settings" subtitle="Your place, your rules. Nothing here is shared beyond your two-member space.">
          <RoomFrame room="settings">
          <div className="settings-workshop grid gap-3">
            <p className="text-sm text-cocoa-soft">Space: <span className="font-bold text-cocoa">{store.data.space.name}</span> · Mode: {store.mode === 'demo' ? 'Demo (this device only)' : store.mode === 'api' ? 'PostgreSQL (synced, server-enforced)' : 'Supabase (synced, RLS-protected)'} · Deletion is soft first (Deleted room, restorable), permanent only by a second deliberate confirmation.</p>
            <div id="desk-drawer"><DeskDrawer store={store} go={go} cottageTheme={cottageTheme} onScrollTo={scrollToId}
              reduceMotionPref={reduceMotionPref}
              onToggleReduceMotion={() => { try { localStorage.setItem('our-place-reduce-motion', reduceMotionPref ? '0' : '1'); } catch { /* private mode */ } setReduceMotionPref(!reduceMotionPref); }}
              sound={soundPrefs} onSound={setSound} textSize={textSize} onTextSize={setTextSize} highContrast={highContrast} onHighContrast={setHighContrast}
              showPasswordForm={Boolean(supabaseConfigured && store.mode === 'supabase')}
              onSignOut={apiConfigured ? () => { clearApiToken(); location.reload(); } : supabaseConfigured ? async () => { await supabase?.auth.signOut(); location.reload(); } : null} /></div>
            <ProfileCards store={store} refresh={refresh} notify={notify} onSignOut={apiConfigured ? () => { clearApiToken(); location.reload(); } : supabaseConfigured ? async () => { await supabase?.auth.signOut(); location.reload(); } : null} />
            <div id="invitation-panel"><InvitationPanel store={store} notify={notify} /></div>
            <div id="make-it-yours"><PersonalizationPanel store={store} go={go} cottageTheme={cottageTheme}
              onCottageTheme={(t) => { try { localStorage.setItem(COTTAGE_THEME_KEY, t); } catch { /* private mode */ } setCottageTheme(t); notify(t === 'day' ? 'Day cottage chosen. Go to Home to see it.' : 'Night cottage chosen. Go to Home to see it.'); }}
              reduceMotionPref={reduceMotionPref}
              onGoDrawer={() => scrollToId('desk-drawer')}
              onShowWelcome={() => { try { localStorage.removeItem('our-place-welcome-dismissed'); } catch { /* private mode */ } notify('The welcome will appear on Home again.'); }}
              onShowIntro={() => { try { localStorage.removeItem(INTRO_KEY); } catch { /* private mode */ } setIntroSeen(false); notify('The introduction will appear on Home again.'); }} /></div>
            {supabaseConfigured && store.mode === 'supabase' && (
              <Card>
                <div id="password-change" />
                <h2 className="font-serif-display text-xl">Change your password</h2>
                <p className="mt-2 text-sm leading-relaxed text-cocoa-soft">Signed in with Supabase, so this changes the password for your own account only. It does not change your partner's password, and it does not touch any letter, memory, or photo.</p>
                <div className="mt-3 space-y-2">
                  <Field label="New password"><input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className={inputCls} autoComplete="new-password" minLength={8} /></Field>
                  <Field label="New password, again"><input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className={inputCls} autoComplete="new-password" minLength={8} /></Field>
                  <Button onClick={async () => {
                    if (!supabase) return;
                    if (newPassword.length < 8) { notify('A new password needs at least 8 characters.', 'error'); return; }
                    if (newPassword !== confirmPassword) { notify('The two new passwords do not match.', 'error'); return; }
                    try {
                      const { error } = await supabase.auth.updateUser({ password: newPassword });
                      if (error) throw new Error(error.message);
                      setNewPassword(''); setConfirmPassword(''); notify('Password changed.');
                    } catch (e) { notify(e instanceof Error ? e.message : 'Could not change the password.', 'error'); }
                  }}>Save new password</Button>
                </div>
              </Card>
            )}
            <Card>
              <h2 className="font-serif-display text-xl">Install on your phone</h2>
              <p className="mt-2 text-sm leading-relaxed text-cocoa-soft">On Android: open in Chrome → menu → “Add to Home screen”. On iPhone: open in Safari → Share → “Add to Home Screen”. The app works as a standalone app after that; no app store, no account beyond your own sign-in.</p>
            </Card>
            <div id="privacy-legend"><PrivacyLegend /></div>
            <div id="activity-feed"><ActivityFeed store={store} /></div>
            <div className="flex flex-wrap gap-2">
              <Button variant="quiet" onClick={() => go('deleted')}>Open Deleted (recoverable)</Button>
              {store.mode === 'demo' && <Button variant="danger" onClick={() => { if (confirm('Clear all demo content on this device? This cannot be undone.')) { clearDemoData(); location.reload(); } }}>Clear demo content</Button>}
              {apiConfigured && <Button variant="quiet" onClick={() => { clearApiToken(); location.reload(); }}>Sign out</Button>}
              {supabaseConfigured && <Button variant="quiet" onClick={async () => { await supabase?.auth.signOut(); location.reload(); }}>Sign out</Button>}
            </div>
          </div>
          </RoomFrame>
        </Page>
      )}

      {/* Bottom navigation: icon above label, labels wrap instead of truncating —
          the old single-line bar cut "See in You" off on narrow phones.
          Suppressed on the fullscreen cottage Home only (see
          isCottageHome above); every other route keeps it intact. */}
      {!isCottageHome && !isRoomWorld && (
      <nav aria-label="Main navigation" className="bottom-nav-bar fixed inset-x-0 bottom-0 z-30 border-t border-cocoa/20 bg-cream shadow-[0_-4px_16px_rgba(81,68,61,0.10)]">
        <div className="mx-auto flex max-w-5xl items-stretch justify-between gap-1 px-2 py-1.5">
          {NAV.map((n) => (
            <button key={n.id} onClick={() => go(n.id)} aria-current={room === n.id ? 'page' : undefined}
              className={`bottom-nav-btn flex min-h-14 flex-1 flex-col items-center justify-center rounded-xl px-0.5 py-1 text-[10px] font-bold leading-tight sm:text-xs ${room === n.id ? 'bg-cocoa text-cream' : 'text-cocoa-soft hover:bg-cream-deep'}`}>
              <span aria-hidden="true" className="text-base leading-none">{n.icon}</span>
              <span>{n.label}</span>
            </button>
          ))}
          <button onClick={() => go('settings')} aria-current={room === 'settings' ? 'page' : undefined}
            className={`bottom-nav-btn flex min-h-14 flex-1 flex-col items-center justify-center rounded-xl px-0.5 py-1 text-[10px] font-bold leading-tight sm:text-xs ${room === 'settings' ? 'bg-cocoa text-cream' : 'text-cocoa-soft hover:bg-cream-deep'}`}>
            <span aria-hidden="true" className="text-base leading-none">⚙</span>
            <span>Settings</span>
          </button>
        </div>
      </nav>
      )}

      {randomNote && <Modal title="A note for today" onClose={() => setRandomNote(null)}>
        <p className="font-serif-display text-xl leading-relaxed">{randomNote}</p>
        <p className="mt-3 text-sm text-cocoa-soft">No streak, no task attached. Just a note, when you wanted one.</p>
        <div className="mt-4"><Button onClick={() => setRandomNote(null)}>Keep it with me</Button></div>
      </Modal>}

      <Toast message={toast.msg} kind={toast.kind} />
    </div>
  );
}
