import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { applyMotionPreference, ApiRequestError, getMe, getPreferences, getSpace, setCsrf, type Me, type Space } from './lib/api.js';
import { LoadingState } from './components/ui.js';
import {
  AppreciationsPage, ArcadePage, AuthPage, DeletedPage, FavouritesPage, FuturePage,
  HomePage, LettersPage, MemoriesPage, NotFoundPage, QuietPage, RemindersPage, SettingsPage, SpacePage, WelcomePage,
} from './routes/pages.js';

const DESTINATIONS = [
  { to: '/memories', label: 'Memory Wall' },
  { to: '/letters', label: 'Letters' },
  { to: '/quiet', label: 'Quiet Room' },
  { to: '/appreciations', label: 'Things I See in You' },
  { to: '/future', label: 'Our Future' },
  { to: '/reminders', label: 'Reminder Room' },
  { to: '/arcade', label: 'Secret Arcade' },
];

function Nav({ me, space }: { me: Me | null; space: Space | null }) {
  if (!me) return null;
  return (
    <nav className="site-nav" aria-label="Main destinations">
      <NavLink to="/" end className="brand serif">A Little Place Called Us</NavLink>
      {DESTINATIONS.map((d) => (
        <NavLink key={d.to} to={d.to} end={d.to === '/appreciations'} className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
          {d.label}
        </NavLink>
      ))}
      <span className="nav-meta">
        {space ? <span>{space.name} · </span> : null}
        <NavLink to="/deleted" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>Deleted</NavLink>
        <NavLink to="/settings" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>Settings</NavLink>
      </span>
    </nav>
  );
}

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [space, setSpace] = useState<Space | null>(null);
  const [checked, setChecked] = useState(false);
  // Transient session-check failure (429/5xx): the session was never
  // revoked, so this is "unknown", not "signed out" — the user is
  // offered a retry instead of being bounced to /login.
  const [sessionUnknown, setSessionUnknown] = useState(false);

  const refresh = async () => {
    try {
      const m = await getMe();
      setMe(m);
      setSessionUnknown(false);
      // Apply the account motion preference after sign-in (and on
      // refresh): only 'reduce' adds the class; 'system' is left to
      // the OS media query and 'full' never adds it.
      try {
        const prefs = await getPreferences();
        applyMotionPreference(prefs.motion);
      } catch {
        // Preferences are optional here: a failed read must not
        // block sign-in, and the OS media query still applies.
      }
      try {
        const s = await getSpace();
        setSpace(s);
      } catch {
        setSpace(null);
      }
    } catch (err) {
      // Genuine 401 (or any other non-transient failure) still means
      // signed out, exactly as before. Only 429/5xx keep the previous
      // session state and surface a retry instead of a login bounce.
      if (err instanceof ApiRequestError && (err.status === 429 || err.status >= 500)) {
        setSessionUnknown(true);
      } else {
        setMe(null);
        setSpace(null);
        setSessionUnknown(false);
      }
    } finally {
      setChecked(true);
    }
  };

  useEffect(() => { void refresh(); }, []);

  if (!checked) return <div className="page"><LoadingState /></div>;

  // No signed-in user yet and the session check itself failed
  // transiently: retry, do not redirect to /login.
  if (sessionUnknown && !me) {
    return (
      <div className="page">
        <h1 className="page-title">Couldn&apos;t reach your little place</h1>
        <p>Your session was not signed out — the server was just too busy or briefly unavailable. Try again in a moment.</p>
        <button className="btn" type="button" onClick={() => { setChecked(false); void refresh(); }}>Try again</button>
      </div>
    );
  }

  const signedIn = !!me;
  const signedOut = <Navigate to="/login" replace />;

  return (
    <BrowserRouter>
      <Nav me={me} space={space} />
      {sessionUnknown && me && (
        <div className="notice" role="status" style={{ margin: '0.75rem auto', maxWidth: 900 }}>
          The last session check was briefly unavailable — you are still signed in.{' '}
          <button className="btn quiet" type="button" onClick={() => void refresh()}>Check again</button>
        </div>
      )}
      <Routes>
        <Route path="/login" element={signedIn ? <Navigate to="/" replace /> : <AuthPage mode="login" onSignedIn={refresh} />} />
        <Route path="/register" element={signedIn ? <Navigate to="/welcome" replace /> : <AuthPage mode="register" onSignedIn={refresh} />} />
        <Route path="/welcome" element={signedIn ? <WelcomePage me={me} space={space} onSpaceChange={refresh} /> : signedOut} />
        <Route path="/" element={signedIn ? <HomePage me={me} space={space} onSpaceChange={refresh} /> : signedOut} />
        <Route path="/space" element={signedIn ? <SpacePage me={me} onSpaceChange={refresh} /> : signedOut} />
        <Route path="/memories" element={signedIn && space ? <MemoriesPage me={me} space={space} /> : signedIn ? <Navigate to="/space" replace /> : signedOut} />
        <Route path="/letters" element={signedIn && space ? <LettersPage me={me} space={space} /> : signedIn ? <Navigate to="/space" replace /> : signedOut} />
        <Route path="/quiet" element={signedIn && space ? <QuietPage me={me} space={space} /> : signedIn ? <Navigate to="/space" replace /> : signedOut} />
        <Route path="/appreciations" element={signedIn && space ? <AppreciationsPage me={me} space={space} /> : signedIn ? <Navigate to="/space" replace /> : signedOut} />
        <Route path="/appreciations/favourites" element={signedIn && space ? <FavouritesPage me={me} space={space} /> : signedIn ? <Navigate to="/space" replace /> : signedOut} />
        <Route path="/future" element={signedIn && space ? <FuturePage me={me} space={space} /> : signedIn ? <Navigate to="/space" replace /> : signedOut} />
        <Route path="/reminders" element={signedIn && space ? <RemindersPage me={me} space={space} /> : signedIn ? <Navigate to="/space" replace /> : signedOut} />
        <Route path="/arcade" element={signedIn && space ? <ArcadePage me={me} space={space} /> : signedIn ? <Navigate to="/space" replace /> : signedOut} />
        <Route path="/deleted" element={signedIn && space ? <DeletedPage me={me} space={space} /> : signedIn ? <Navigate to="/space" replace /> : signedOut} />
        <Route path="/settings" element={signedIn ? <SettingsPage me={me} space={space} onSignedOut={() => { setMe(null); setSpace(null); setCsrf(null); setSessionUnknown(false); }} /> : signedOut} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      <footer style={{ textAlign: 'center', padding: '1rem', color: '#6b5646' }}>
        <small>This little world grows when we both add to it.</small>
      </footer>
    </BrowserRouter>
  );
}
