import { useEffect, useState } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom';
import { getMe, getSpace, setCsrf, type Me, type Space } from './lib/api.js';
import {
  AppreciationsPage, ArcadePage, AuthPage, DeletedPage, FavouritesPage, FuturePage,
  HomePage, LettersPage, MemoriesPage, QuietPage, SettingsPage, SpacePage,
} from './routes/pages.js';

function Nav({ me, space }: { me: Me | null; space: Space | null }) {
  if (!me) return null;
  return (
    <nav style={{ background: '#fffdf6', borderBottom: '1px solid #e8dcc8', padding: '0.75rem 1rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
      <Link to="/" style={{ fontWeight: 700, textDecoration: 'none', color: 'inherit' }} className="serif">A Little Place Called Us</Link>
      <Link to="/memories">Memory Wall</Link>
      <Link to="/letters">Letters</Link>
      <Link to="/quiet">Quiet Room</Link>
      <Link to="/appreciations">Things I See in You</Link>
      <Link to="/future">Our Future</Link>
      <Link to="/arcade">Secret Arcade</Link>
      <span style={{ marginLeft: 'auto' }}>
        {space ? <span>{space.name} · </span> : null}
        <Link to="/settings">Settings</Link>
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

  if (!checked) return <p style={{ padding: '2rem' }}>Loading your little place…</p>;

  const signedIn = !!me;
  const signedOut = <Navigate to="/login" replace />;

  return (
    <BrowserRouter>
      <Nav me={me} space={space} />
      <Routes>
        <Route path="/login" element={signedIn ? <Navigate to="/" replace /> : <AuthPage mode="login" onSignedIn={refresh} />} />
        <Route path="/register" element={signedIn ? <Navigate to="/" replace /> : <AuthPage mode="register" onSignedIn={refresh} />} />
        <Route path="/" element={signedIn ? <HomePage me={me} space={space} onSpaceChange={refresh} /> : signedOut} />
        <Route path="/space" element={signedIn ? <SpacePage me={me} onSpaceChange={refresh} /> : signedOut} />
        <Route path="/memories" element={signedIn && space ? <MemoriesPage me={me} space={space} /> : signedIn ? <Navigate to="/space" replace /> : signedOut} />
        <Route path="/letters" element={signedIn && space ? <LettersPage me={me} space={space} /> : signedIn ? <Navigate to="/space" replace /> : signedOut} />
        <Route path="/quiet" element={signedIn && space ? <QuietPage me={me} space={space} /> : signedIn ? <Navigate to="/space" replace /> : signedOut} />
        <Route path="/appreciations" element={signedIn && space ? <AppreciationsPage me={me} space={space} /> : signedIn ? <Navigate to="/space" replace /> : signedOut} />
        <Route path="/appreciations/favourites" element={signedIn && space ? <FavouritesPage me={me} space={space} /> : signedIn ? <Navigate to="/space" replace /> : signedOut} />
        <Route path="/future" element={signedIn && space ? <FuturePage me={me} space={space} /> : signedIn ? <Navigate to="/space" replace /> : signedOut} />
        <Route path="/arcade" element={signedIn ? <ArcadePage /> : signedOut} />
        <Route path="/deleted" element={signedIn && space ? <DeletedPage me={me} space={space} /> : signedIn ? <Navigate to="/space" replace /> : signedOut} />
        <Route path="/settings" element={signedIn ? <SettingsPage me={me} space={space} onSignedOut={() => { setMe(null); setSpace(null); setCsrf(null); }} /> : signedOut} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <footer style={{ textAlign: 'center', padding: '1rem', color: '#6b5646' }}>
        <small>This little world grows when we both add to it.</small>
      </footer>
    </BrowserRouter>
  );
}
