import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { applyMotionPreference, getMe, getPreferences, getSpace, setCsrf, type Me, type Space } from './lib/api.js';
import { LoadingState } from './components/ui.js';
import {
  AppreciationsPage, ArcadePage, AuthPage, DeletedPage, FavouritesPage, FuturePage,
  HomePage, LettersPage, MemoriesPage, NotFoundPage, QuietPage, SettingsPage, SpacePage, WelcomePage,
} from './routes/pages.js';

const DESTINATIONS = [
  { to: '/memories', label: 'Memory Wall' },
  { to: '/letters', label: 'Letters' },
  { to: '/quiet', label: 'Quiet Room' },
  { to: '/appreciations', label: 'Things I See in You' },
  { to: '/future', label: 'Our Future' },
  { to: '/arcade', label: 'Secret Arcade' },
];

function Nav({ me, space }: { me: Me | null; space: Space | null }) {
  if (!me) return null;
  return (
    <nav className="site-nav" aria-label="Main destinations">
      <NavLink to="/" end className="brand serif">A Little Place Called Us</NavLink>
      {DESTINATIONS.map((d) => (
        <NavLink key={d.to} to={d.to} className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
          {d.label}
        </NavLink>
      ))}
      <span className="nav-meta">
        {space ? <span>{space.name} · </span> : null}
        <NavLink to="/settings" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>Settings</NavLink>
      </span>
    </nav>
  );
}

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [space, setSpace] = useState<Space | null>(null);
  const [checked, setChecked] = useState(false);

  const refresh = async () => {
    try {
      const m = await getMe();
      setMe(m);
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
    } catch {
      setMe(null);
      setSpace(null);
    } finally {
      setChecked(true);
    }
  };

  useEffect(() => { void refresh(); }, []);

  if (!checked) return <div className="page"><LoadingState /></div>;

  const signedIn = !!me;
  const signedOut = <Navigate to="/login" replace />;

  return (
    <BrowserRouter>
      <Nav me={me} space={space} />
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
        <Route path="/arcade" element={signedIn && space ? <ArcadePage me={me} space={space} /> : signedIn ? <Navigate to="/space" replace /> : signedOut} />
        <Route path="/deleted" element={signedIn && space ? <DeletedPage me={me} space={space} /> : signedIn ? <Navigate to="/space" replace /> : signedOut} />
        <Route path="/settings" element={signedIn ? <SettingsPage me={me} space={space} onSignedOut={() => { setMe(null); setSpace(null); setCsrf(null); }} /> : signedOut} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      <footer style={{ textAlign: 'center', padding: '1rem', color: '#6b5646' }}>
        <small>This little world grows when we both add to it.</small>
      </footer>
    </BrowserRouter>
  );
}
