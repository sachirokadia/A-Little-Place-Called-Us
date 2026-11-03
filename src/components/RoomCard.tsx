import type { RoomId } from '../lib/types';

/**
 * Shared room card (Phase 2). One template for every destination on Home:
 * a pastel scrapbook card with a clear title, a short description, a
 * distinct icon and a handwritten annotation. It is a real button — it
 * always navigates to its room, never a dead control.
 */
export function RoomCard({ id, name, line, icon, bg, rot, doodle, onOpen }: {
  id: RoomId;
  name: string;
  line: string;
  icon: string;
  bg: string;
  rot: string;
  doodle: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${name}`}
      data-room={id}
      style={{ transform: `rotate(${rot})` }}
      className={`room-tile w-full rounded-card border border-cocoa/20 p-5 text-left shadow-card ${bg}`}
    >
      <span aria-hidden="true" className="flex h-11 w-11 items-center justify-center rounded-chip border border-cocoa/25 bg-paper text-xl text-cocoa">
        {icon}
      </span>
      <span className="font-serif-display mt-3 block text-2xl leading-snug text-cocoa">{name}</span>
      <span className="mt-1 block text-sm leading-relaxed text-cocoa-soft">{line}</span>
      <span className="font-hand mt-3 block text-xl leading-snug text-plum">{doodle}</span>
    </button>
  );
}
