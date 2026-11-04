import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { RoomId } from '../lib/types';
import { RoomIdentity } from './RoomIdentity';
import { attemptLeave } from '../lib/dirtyGuard';

/* Phase 12A — Full-screen room worlds, for Memories, Letters and Quiet
   ONLY. Phase 12B extends the same shell, unchanged in shape, to
   Appreciations, Future and Reminders. Phase 13 extends it, unchanged
   in shape, to the Keepsake Box. This replaces Page for those
   six rooms: the world element is exactly 100vw x 100dvh and scrolls
   INSIDE itself, its own background fills the viewport, and App.tsx
   suppresses the bottom nav and demo banner while a world is open
   (see isRoomWorld in App.tsx). The way back is a sticky header
   control, always visible while scrolling, and in demo mode the
   viewer switch is re-homed here so partner-privacy testing is not
   lost when the banner goes. Other rooms keep Page and their existing
   chrome untouched. Home.tsx is untouched by this file.
   No data fetching, no store access, no backend call of any kind — the
   room passes already-loaded content, and this file only frames it.
   Decorations are aria-hidden CSS/SVG-style glyphs from the Phase 11
   palette, never photographs and never sample content presented as
   real.

   STORYBOOK WORLDS — one shared transition system, per-room variation
   (see .world-enter in index.css): every world fades in on entry, but
   each moves a little differently — Memories rises like a garden
   growing up, Letters settles like an envelope, Quiet only fades
   (slower, gentler), Our Future slides in from the side like a map
   unfolding, Appreciations and Keepsakes settle with a soft scale,
   Reminders rises a touch less. The animation is CSS-only and never
   gates content: if the CSS, the timer, or the JS state below all
   fail, the world is still fully rendered and usable — the enter
   state is display-only (data-enter-state goes entering → entered
   on a plain timeout, never on animationend, which a browser may
   drop). Reduced motion: the global reduced-motion block plus an
   explicit .world-enter kill-switch make entry instant and static.

   Return home: the header button ("Back to our cottage") is unchanged
   in label and always visible (sticky header), and a second identical
   control now closes each world at its foot ("The cottage door is
   always open") for long scrolls. Leaving plays a brief 180ms exit
   fade and then navigates — but navigation is timer-driven with a
   450ms watchdog, never animationend-driven, so a dropped animation
   can delay leaving by at most ~450ms, never strand the user; and if
   the unsaved-changes guard cancels the move, a 700ms cleanup timer
   clears the exit state so the world is never left faded. Browser
   back/forward bypasses the exit fade entirely and still navigates
   (App.tsx hashchange), which is the graceful fallback.

   Scroll restoration: the world element scrolls inside itself, so
   window scroll is useless here. This component saves its own
   scrollTop to sessionStorage (per room, numbers only — no content,
   no titles, nothing private can leak through it) on scroll and on
   unmount, and restores it on mount. If the restored position no
   longer exists (e.g. the scrolled-to item was deleted), the browser
   clamps to the new maximum — a graceful landing, never a faked one.
   Game states are not restored by this mechanism (see report). */

export type WorldRoom = 'memories' | 'letters' | 'quiet' | 'appreciations' | 'future' | 'reminders' | 'keepsakes' | 'search';

function scrollKey(room: WorldRoom) {
  return `our-place-scroll-world-${room}`;
}

export function RoomWorld({ room, title, handNote, intro, subtitle, actions, decor, children, isDemo, viewerLabel, otherViewerLabel, onSwitchViewer }: {
  room: WorldRoom;
  title: string;
  handNote: string;
  /* Story-like introductory line in the world's own voice. Generic and
     welcoming only — never a personal memory or relationship detail. */
  intro?: string;
  subtitle?: string;
  actions?: ReactNode;
  decor?: ReactNode;
  children: ReactNode;
  isDemo: boolean;
  viewerLabel: string;
  otherViewerLabel: string;
  onSwitchViewer?: () => void;
}) {
  const worldRef = useRef<HTMLDivElement | null>(null);
  const [enterState, setEnterState] = useState<'entering' | 'entered'>('entering');
  const [exiting, setExiting] = useState(false);
  const exitTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  /* Enter state: display-only. Content is rendered from the first
     paint regardless of this state; the CSS animation runs on its
     own. If this timer never fires, nothing is hidden or blocked. */
  useEffect(() => {
    const t = setTimeout(() => setEnterState('entered'), 600);
    return () => clearTimeout(t);
  }, []);

  /* Scroll restoration: restore once mounted (content in demo mode is
     synchronous, so one rAF is enough; the clamp handles deleted
     items). Save on scroll (rAF-throttled) and on unmount. */
  useEffect(() => {
    const el = worldRef.current;
    if (!el) return;
    let saved = 0;
    try { saved = Number(sessionStorage.getItem(scrollKey(room))) || 0; } catch { saved = 0; }
    if (saved > 0) {
      /* Do NOT cancel this rAF in cleanup: under React StrictMode
         (dev) the effect mounts, unmounts, and remounts, and a
         cancelled restore plus a cleanup that saved scrollTop 0
         would erase the saved position before it was ever restored.
         Setting scrollTop on a detached node is harmless, so the
         rAF is left to fire. Cleanup below only persists a real
         (non-zero) position, for the same reason. */
      requestAnimationFrame(() => { el.scrollTop = saved; });
      const cleanup = () => {
        if (el.scrollTop > 0) { try { sessionStorage.setItem(scrollKey(room), String(el.scrollTop)); } catch { /* private mode */ } }
      };
      let queued = false;
      const onScroll = () => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
          queued = false;
          try { sessionStorage.setItem(scrollKey(room), String(el.scrollTop)); } catch { /* private mode */ }
        });
      };
      el.addEventListener('scroll', onScroll, { passive: true });
      return () => { el.removeEventListener('scroll', onScroll); cleanup(); };
    }
    let queued = false;
    const onScroll = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        try { sessionStorage.setItem(scrollKey(room), String(el.scrollTop)); } catch { /* private mode */ }
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (el.scrollTop > 0) { try { sessionStorage.setItem(scrollKey(room), String(el.scrollTop)); } catch { /* private mode */ } }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room]);

  useEffect(() => () => { exitTimers.current.forEach(clearTimeout); }, []);

  const goHome = () => {
    /* Unsaved-changes guard first: if the user cancels, never enter
       the exit state at all — the world must not be left faded. */
    if (!attemptLeave()) return;
    if (exiting) return;
    setExiting(true);
    exitTimers.current.push(setTimeout(() => { location.hash = 'home'; }, 180));
    /* Watchdog: navigation must happen even if the first timer is
       somehow lost. Cleanup: if the App hashchange guard cancelled
       the move (hash restored to this room), the component stays
       mounted — clear the exit state so it is never left faded. */
    exitTimers.current.push(setTimeout(() => { location.hash = 'home'; }, 450));
    exitTimers.current.push(setTimeout(() => { setExiting(false); }, 700));
  };

  return (
    <div ref={worldRef} data-testid="room-world" data-room={room} data-enter-state={enterState}
      className={`room-world room-world-${room} world-enter world-enter-${room}${exiting ? ` world-exiting world-exiting-${room}` : ''}`}>
      <header className={`room-world-header room-world-header-${room}`}>
        <div className="room-world-bar">
          <button type="button" onClick={goHome} data-testid="return-cottage" className="room-world-back" aria-label="Back to our cottage">
            <span aria-hidden="true">⌂</span> Back to our cottage
          </button>
          {isDemo && onSwitchViewer && (
            <button type="button" onClick={onSwitchViewer} className="room-world-switch">
              Viewing as {viewerLabel} · Switch to {otherViewerLabel}
            </button>
          )}
        </div>
      </header>
      <div className="room-world-inner">
        <RoomIdentity room={room as RoomId} />
        {decor}
        <div className="room-world-heading">
          <h1>{title}</h1>
          <p className="room-world-hand" aria-hidden="true">{handNote}</p>
          {intro && <p className="room-world-intro" data-testid="world-intro">{intro}</p>}
          {subtitle && <p className="room-world-sub">{subtitle}</p>}
        </div>
        {actions && <div className="room-world-actions">{actions}</div>}
        {children}
        <footer className="room-world-footer">
          <button type="button" onClick={goHome} data-testid="return-cottage-footer" className="room-world-back" aria-label="Back to our cottage">
            <span aria-hidden="true">⌂</span> Back to our cottage
          </button>
          <p>The cottage door is always open.</p>
        </footer>
      </div>
    </div>
  );
}
