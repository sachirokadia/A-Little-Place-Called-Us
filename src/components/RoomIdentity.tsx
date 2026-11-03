import type { RoomId } from '../lib/types';

/* Phase 11 shared visual universe: one small, purely decorative identity
   strip per room, rendered above the shared Page header. It is aria-hidden
   and contains no controls, no data and no text a screen reader needs —
   the room title below it is the real heading. The point is that the
   shared Page template no longer makes every room look identical at the
   top: each room opens with its own motif and its own accent colour,
   while every form, list and game below stays exactly as it was.

   Motifs, all from the shared picture language:
   - reminders: a garden trail (dashed path, flowers, stars)
   - memories: layered scrapbook (tilted paper squares, washi)
   - letters: an envelope with a stamp
   - quiet: a lit cottage window (motif-window) with a moon
   - appreciations: a tiny museum (framed pictures on a shelf)
   - future: a hand-drawn map (dashed trail, motif-marker pin)
   - arcade: a game world (motif-collectible stars and coins)
   - deleted: a keepsake box (motif-keepsake), kept closed
   - settings: a cottage door (motif-door, with knob)
   - home: not used — Home already has the cottage photograph. */

export function RoomIdentity({ room }: { room: RoomId }) {
  const note: Record<RoomId, string> = {
    home: '',
    reminders: 'a garden trail, left for ordinary days',
    memories: 'layered pages, kept like a scrapbook',
    letters: 'envelopes, stamps, and paper',
    quiet: 'a quiet reading nook',
    appreciations: 'a tiny personal museum',
    future: 'a hand-drawn adventure map',
    arcade: 'a playful little game world',
    deleted: 'a keepsake box, kept safe',
    settings: 'the cottage door',
    keepsakes: 'a keepsake box, open only to what you chose',
    search: 'a little drawer of labelled envelopes, to find things by',
  };
  return (
    <div className="identity-strip" aria-hidden="true">
      {room === 'reminders' && (
        <span className="motif-path"><span className="motif-dot" style={{ left: '10%', background: '#f6b8c9' }}>✿</span><span className="motif-dot" style={{ left: '45%', background: '#fdf0b8' }}>✦</span><span className="motif-dot" style={{ left: '80%', background: '#d8c6ee' }}>✿</span></span>
      )}
      {room === 'memories' && (
        <>
          <span className="block h-14 w-14 rotate-[-6deg] border border-cocoa/40 bg-cottage-pink shadow" />
          <span className="-ml-8 block h-14 w-14 rotate-[4deg] border border-cocoa/40 bg-cottage-mint shadow" />
          <span className="-ml-8 block h-14 w-14 rotate-[-1deg] border border-cocoa/40 bg-paper shadow" />
          <span className="washi washi-rose" style={{ margin: '-20px 0 20px -70px', width: 56 }} />
        </>
      )}
      {room === 'letters' && (
        <>
          <span className="motif-envelope" />
          <span className="motif-stamp">✿</span>
          <span className="motif-postmark" />
        </>
      )}
      {room === 'quiet' && (
        <>
          <span className="motif-window">☾</span>
          <span className="motif-lamp" />
        </>
      )}
      {room === 'appreciations' && (
        <>
          <span className="motif-frame">✧</span>
          <span className="motif-frame" style={{ outlineColor: '#f6b8c9', transform: 'rotate(2deg)' }}>❦</span>
          <span className="motif-frame" style={{ outlineColor: '#bfe6c8', transform: 'rotate(-2deg)' }}>✿</span>
        </>
      )}
      {room === 'future' && (
        <>
          <span className="motif-path"><span className="motif-dot" style={{ left: '20%', background: '#fdf0b8' }}>✦</span><span className="motif-dot" style={{ left: '55%', background: '#f6b8c9' }}>●</span></span>
          <span className="motif-marker">⌖</span>
          <span className="motif-flag">⚑</span>
        </>
      )}
      {room === 'arcade' && (
        <>
          <span className="motif-collectible mb-4 h-10 w-10 bg-cottage-butter text-xl">★</span>
          <span className="motif-collectible mb-6 h-8 w-8 bg-cottage-pink text-base">●</span>
          <span className="motif-collectible mb-3 h-10 w-10 bg-cottage-sky text-xl">✦</span>
        </>
      )}
      {room === 'deleted' && (
        <span className="motif-keepsake mb-2">▢</span>
      )}
      {room === 'settings' && (
        <span className="motif-door">⌂</span>
      )}
      {room === 'keepsakes' && (
        <span className="motif-keepsake mb-2">▢</span>
      )}
      {note[room] && <span className="font-hand mb-1 text-2xl leading-none text-plum">{note[room]}</span>}
    </div>
  );
}
