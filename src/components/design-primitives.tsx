import type { ReactNode } from 'react';
import type { RoomId } from '../lib/types';

/* Phase 11 (this phase) — Shared Design System, additive only.
   Presentation only: no data fetching, no store access, no Supabase,
   no Express, no backend call of any kind. These primitives sit above
   the PlaceStore abstraction exactly like the existing RoomIdentity
   strip: rooms pass them already-loaded text and already-built buttons,
   and the primitives only frame that content. Home never imports this
   file, and src/components/ui.tsx is untouched, so the fullscreen
   cottage homepage cannot change through this file.

   What already existed before this phase (left alone): the @theme
   palette (cream/sage/rose/butter/powder/lilac + cocoa), the DM Serif
   Display / DM Sans / Caveat fonts, RoomIdentity motif strips, and the
   per-room surfaces (post office, scrapbook, reading nook, noticeboard,
   museum wall, map trail, arcade marquee, keepsake box, workshop).
   What was still shared before this phase: the Empty box — one identical
   dashed paper box in every room — and the framing of each room's
   creation experience (a bare Card, or a bare Page-action button). Those
   two shared treatments are what this file differentiates, per room,
   without changing any wording, handler, filter, sort, form field,
   button label, route, or data flow. Empty-state text is passed through
   verbatim from the room; only illustration and tint change. */

export type DesignRoom = Exclude<RoomId, 'home'>;

/* Motifs — reusable decorative pieces. All aria-hidden, fixed size
   (no layout shift), transform-only bob on the empty-state motif only,
   which the existing reduced-motion blocks already collapse to static.
   Glyphs are text, not images, so there is no alt text to miss and no
   image to load; the surrounding heading/body carry all meaning. */
function Petals() {
  return <span className="ds-motif" aria-hidden="true"><span>✿</span><span>✦</span><span>✿</span></span>;
}
function EnvelopeMotif() {
  return <span className="ds-motif" aria-hidden="true"><span className="motif-envelope" /><span className="motif-stamp">✿</span></span>;
}
function WindowMotif() {
  return <span className="ds-motif" aria-hidden="true"><span className="motif-window">☾</span><span className="motif-lamp" /></span>;
}
function FramesMotif() {
  return <span className="ds-motif" aria-hidden="true"><span className="motif-frame">✧</span><span className="motif-frame" style={{ outlineColor: '#f6b8c9', transform: 'rotate(2deg)' }}>❦</span></span>;
}
function MapMotif() {
  return <span className="ds-motif" aria-hidden="true"><span className="motif-marker">⌖</span><span className="motif-flag">⚑</span></span>;
}
function StarsMotif() {
  return <span className="ds-motif" aria-hidden="true"><span className="motif-collectible h-10 w-10 bg-cottage-butter text-xl">★</span><span className="motif-collectible h-8 w-8 bg-cottage-pink text-base">●</span><span className="motif-collectible h-10 w-10 bg-cottage-sky text-xl">✦</span></span>;
}
function KeepsakeMotif() {
  return <span className="ds-motif" aria-hidden="true"><span className="motif-keepsake">▢</span></span>;
}
function ScrapbookMotif() {
  return <span className="ds-motif" aria-hidden="true"><span className="block h-12 w-12 rotate-[-6deg] border border-cocoa/40 bg-cottage-pink shadow" /><span className="-ml-6 block h-12 w-12 rotate-[4deg] border border-cocoa/40 bg-cottage-mint shadow" /><span className="-ml-6 block h-12 w-12 rotate-[-1deg] border border-cocoa/40 bg-paper shadow" /></span>;
}

export function RoomMotif({ room }: { room: DesignRoom }) {
  switch (room) {
    case 'reminders': return <Petals />;
    case 'memories': return <ScrapbookMotif />;
    case 'letters': return <EnvelopeMotif />;
    case 'quiet': return <WindowMotif />;
    case 'appreciations': return <FramesMotif />;
    case 'future': return <MapMotif />;
    case 'arcade': return <StarsMotif />;
    case 'deleted': return <KeepsakeMotif />;
    case 'keepsakes': return <KeepsakeMotif />;
    case 'search': return <span className="ds-motif" aria-hidden="true"><span className="motif-envelope" /><span className="motif-stamp">🔍</span></span>;
    case 'settings': return <span className="ds-motif" aria-hidden="true"><span className="motif-door">⌂</span></span>;
  }
}

/* (a) Room frame — a thin per-room accent frame for a room's main
   surface. Used only for Settings (whose surface is a plain grid of
   cards inside App.tsx); every other room already has its own surface
   wrapper and is deliberately not re-framed, to avoid double borders. */
export function RoomFrame({ room, children }: { room: DesignRoom; children: ReactNode }) {
  return <div className={`ds-frame ds-frame-${room}`}>{children}</div>;
}

/* (b) Empty state — same structure in every room (motif, serif title,
   body, optional action centred below), different illustration and
   tint per room. Title/body/action are the room's own, unchanged. */
export function RoomEmpty({ room, title, body, action }: { room: DesignRoom; title: string; body: string; action?: ReactNode }) {
  return (
    <div className={`ds-empty ds-empty-${room}`}>
      <div className="ds-empty-motif"><RoomMotif room={room} /></div>
      <p className="font-serif-display text-xl text-cocoa">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-cocoa-soft">{body}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/* (c) Creation entry — frames an existing creation form/card without
   touching it: a washi strip, one decorative hand-written note (the
   primitive's own label, never a functional label), then the room's
   unchanged form. The form, its fields, and its buttons are children. */
export function CreateEntry({ room, note, children }: { room: DesignRoom; note: string; children: ReactNode }) {
  return (
    <div className={`ds-create ds-create-${room}`}>
      <span aria-hidden="true" className={`washi washi-${room === 'reminders' ? 'butter' : room === 'appreciations' ? 'lilac' : room === 'future' ? 'powder' : 'sage'}`} />
      <p className="font-hand mb-3 text-center text-2xl leading-none text-plum">{note}</p>
      {children}
    </div>
  );
}

/* (d) Intro motif row — a small decorative strip for the two arcade
   world intros (hero + board), which previously opened on plain tinted
   panels with only a glyph. Hero gets the sky/collectible language,
   board gets the map/flag language, so the two intros no longer read
   as the same panel with a different heading. */
export function IntroMotif({ world }: { world: 'hero' | 'board' }) {
  return (
    <div className="ds-intro-motif" aria-hidden="true">
      {world === 'hero'
        ? <><span className="motif-collectible h-9 w-9 bg-cottage-sky text-lg">✦</span><span className="motif-collectible h-7 w-7 bg-cottage-butter text-sm">★</span><span className="motif-collectible h-9 w-9 bg-cottage-pink text-lg">●</span></>
        : <><span className="motif-marker">⌖</span><span className="motif-flag">⚑</span><span className="motif-marker" style={{ background: '#bfe6c8' }}>●</span></>}
    </div>
  );
}
