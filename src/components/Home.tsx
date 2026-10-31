import { motion } from 'motion/react';
import type { RoomId } from '../lib/types';
import type { PlaceStore } from '../lib/store';
import { formatDate, isSealed } from '../lib/utils';
import { Card, Washi, AvatarPair } from './ui';

/** Original cottage illustration: cream walls, dusty-rose roof, sage garden,
 *  butter windows, hand-drawn flowers and a winding path. No stock imagery. */
export function Cottage() {
  return (
    <svg viewBox="0 0 340 230" className="mx-auto w-full max-w-[320px] drop-shadow-[0_14px_20px_rgba(81,68,61,0.15)]" role="img" aria-label="A small cozy cottage with a garden, flowers, and warm windows">
      <circle cx="286" cy="36" r="22" fill="#f8edc9" />
      <circle cx="286" cy="36" r="30" fill="#f8edc9" opacity="0.35" />
      {/* chimney + roof */}
      <rect x="108" y="70" width="22" height="38" rx="3" fill="#fffdf8" stroke="#51443d" strokeWidth="3" />
      <polygon points="70,138 170,58 270,138" fill="#e7c3cb" stroke="#51443d" strokeWidth="3" strokeLinejoin="round" />
      {/* body */}
      <rect x="92" y="132" width="156" height="78" fill="#fffdf8" stroke="#51443d" strokeWidth="3" />
      {/* windows + door */}
      <rect x="106" y="148" width="34" height="30" rx="3" fill="#f8edc9" stroke="#51443d" strokeWidth="2" />
      <path d="M123 148 v30 M106 163 h34" stroke="#51443d" strokeWidth="1.5" />
      <rect x="200" y="148" width="34" height="30" rx="3" fill="#f8edc9" stroke="#51443d" strokeWidth="2" />
      <path d="M217 148 v30 M200 163 h34" stroke="#51443d" strokeWidth="1.5" />
      <rect x="152" y="158" width="36" height="52" rx="4" fill="#8a6d4b" stroke="#51443d" strokeWidth="2" />
      <circle cx="180" cy="186" r="3" fill="#f8f1e7" />
      {/* garden path + flowers */}
      <path d="M170 210 L170 226" stroke="#c9d8bd" strokeWidth="4" strokeLinecap="round" />
      <path d="M20 212 Q90 200 170 212 T320 212" fill="none" stroke="#7d8a6e" strokeWidth="3" strokeLinecap="round" />
      <g>
        <circle cx="52" cy="200" r="7" fill="#f4dfe3" stroke="#a85a5a" strokeWidth="1.5" />
        <circle cx="52" cy="200" r="2.5" fill="#eedda0" />
        <circle cx="288" cy="202" r="7" fill="#eae1f1" stroke="#6b5563" strokeWidth="1.5" />
        <circle cx="288" cy="202" r="2.5" fill="#eedda0" />
        <circle cx="100" cy="206" r="5" fill="#dfeaf3" stroke="#6b5563" strokeWidth="1.5" />
      </g>
    </svg>
  );
}

const ROOMS: { id: RoomId; name: string; line: string; icon: string; bg: string; rot: string; doodle: string }[] = [
  { id: 'reminders', name: 'Reminder Room', line: 'Small notes to find on ordinary days.', icon: '✦', bg: 'bg-butter', rot: '-1deg', doodle: 'a note pinned with love' },
  { id: 'memories', name: 'Memory Wall', line: 'Photos, dates, and the stories behind them.', icon: '❦', bg: 'bg-rose', rot: '0.8deg', doodle: 'pressed flowers, kept' },
  { id: 'letters', name: 'Letters', line: 'Shared letters, private drafts, and sealed ones.', icon: '✉', bg: 'bg-powder', rot: '-0.6deg', doodle: 'sealed with a sticker' },
  { id: 'quiet', name: 'Quiet Room', line: 'Support, slow breathing, and private journals.', icon: '☾', bg: 'bg-sage', rot: '1deg', doodle: 'a quiet corner, just yours' },
  { id: 'appreciations', name: 'Things I See in You', line: 'Appreciation, achievements, encouragement.', icon: '✧', bg: 'bg-lilac', rot: '-0.8deg', doodle: 'noticed, and written down' },
  { id: 'future', name: 'Our Future', line: 'Bucket lists, date ideas, and plans to keep.', icon: '→', bg: 'bg-butter', rot: '0.6deg', doodle: 'to do, together, someday' },
];

export function Home({ store, go, onRandomReminder }: { store: PlaceStore; go: (r: RoomId) => void; onRandomReminder: () => void }) {
  const d = store.data;
  const sealed = store.visibleLetters().filter((l) => isSealed(l, store.viewerId)).length;
  const upcoming = store.shared(d.plans).filter((p) => p.status === 'planned').slice(0, 3);
  const recent = store.shared(d.memories).slice(0, 3);
  const favourites = [...store.shared(d.reminders), ...store.shared(d.memories)].filter((i) => i.isFavorite).length;
  const partnerNames = d.members.length >= 2 ? d.members.map((m) => (m.id === store.viewerId ? 'You' : m.displayName || 'Partner')) : ['You', 'Partner'];

  return (
    <motion.main initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="relative mx-auto w-full max-w-5xl px-4 pb-32 pt-6 sm:px-6">
      {/* Reference scene: the supplied night-cottage photograph, presented as a
          scrapbook plate. The cream paper card below carries the exact brand copy,
          so text stays readable against the night scene. */}
      <section aria-label="A Little Place Called Us">
        <div className="relative overflow-hidden rounded-[28px] border border-cocoa/15 shadow-[0_18px_36px_rgba(81,68,61,0.18)]">
          <img
            src="/night-cottage.jpg"
            alt="A stone cottage at night, its windows glowing warm, beneath a moonlit garden of ferns, hostas and jasmine"
            className="block aspect-[4/3] w-full object-cover object-[62%_50%] sm:aspect-[21/9] sm:object-[50%_30%]"
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/30 to-transparent" aria-hidden="true" />
        </div>
        <div className="paper-card relative z-10 mx-3 -mt-16 rounded-[28px] px-5 pb-8 pt-8 text-center shadow-[0_14px_30px_rgba(81,68,61,0.16)] sm:mx-8 sm:-mt-20 sm:pt-10">
          <Washi tone="rose" />
          <div className="flex justify-center"><AvatarPair names={partnerNames} /></div>
          <p className="mt-5 text-[11px] font-extrabold uppercase tracking-[0.28em] text-plum">YOUR SHARED DIGITAL HOME</p>
          <h1 className="font-serif-display mx-auto mt-3 max-w-2xl text-5xl leading-[1.05] text-cocoa sm:text-6xl">A Little Place Called Us.</h1>
          <p className="font-serif-display mt-4 text-xl leading-relaxed text-plum sm:text-2xl">Made with love. Filled by both of us.</p>
          <p className="mx-auto mt-4 max-w-lg text-sm leading-relaxed text-cocoa-soft sm:text-base">
            A place for the things we want to remember, the things we don't always know how to say, and the future we're still imagining.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <button onClick={onRandomReminder} className="min-h-11 rounded-full bg-cocoa px-5 py-2 text-sm font-bold text-cream hover:bg-plum">A little reminder for today</button>
            <button onClick={() => go('memories')} className="min-h-11 rounded-full border border-cocoa/30 px-5 py-2 text-sm font-bold text-cocoa hover:bg-cream-deep">＋ Add a memory</button>
            <button onClick={() => go('letters')} className="min-h-11 rounded-full border border-cocoa/30 px-5 py-2 text-sm font-bold text-cocoa hover:bg-cream-deep">✎ Write a letter</button>
          </div>
        </div>
      </section>

      {/* Scrapbook room tiles */}
      <nav aria-label="Rooms" className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ROOMS.map((r) => (
          <button key={r.id} onClick={() => go(r.id)} style={{ transform: `rotate(${r.rot})` }}
            className={`room-tile rounded-3xl border border-cocoa/15 p-5 text-left shadow-[0_10px_24px_rgba(81,68,61,0.10)] ${r.bg}`}>
            <span className="text-2xl text-cocoa" aria-hidden="true">{r.icon}</span>
            <span className="font-serif-display mt-2 block text-xl text-cocoa">{r.name}</span>
            <span className="mt-1 block text-sm leading-relaxed text-cocoa-soft">{r.line}</span>
            <span className="font-hand mt-2 block text-xl text-plum">{r.doodle}</span>
          </button>
        ))}
      </nav>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <Card><p className="text-xs font-extrabold uppercase tracking-widest text-cocoa-soft">Saved favourites</p><p className="font-serif-display mt-2 text-2xl">{favourites}</p><p className="mt-1 text-sm text-cocoa-soft">Things you marked to return to.</p></Card>
        <Card><p className="text-xs font-extrabold uppercase tracking-widest text-cocoa-soft">Sealed letters waiting</p><p className="font-serif-display mt-2 text-2xl">{sealed}</p><p className="mt-1 text-sm text-cocoa-soft">{sealed ? 'They stay sealed until their reveal time.' : 'Nothing sealed right now.'}</p></Card>
        <Card><p className="text-xs font-extrabold uppercase tracking-widest text-cocoa-soft">Plans on the horizon</p><p className="font-serif-display mt-2 text-2xl">{upcoming.length}</p><p className="mt-1 text-sm text-cocoa-soft">From Our Future, still to do.</p></Card>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Card>
          <Washi tone="sage" />
          <h2 className="font-serif-display text-xl">Recently kept</h2>
          {recent.length === 0 ? <p className="mt-2 text-sm text-cocoa-soft">No memories yet. The Memory Wall is waiting for the first one.</p> : (
            <ul className="mt-4 space-y-4">
              {recent.map((m, i) => (
                <li key={m.id}>
                  <button onClick={() => go('memories')} className="flex w-full items-center gap-3 text-left">
                    {m.mediaUrl ? <img src={m.mediaUrl} alt="" className={`h-16 w-16 shrink-0 rounded-xl border border-cocoa/15 object-cover ${i % 2 ? 'rot-r' : 'rot-l'}`} loading="lazy" /> : <span aria-hidden="true" className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-rose text-xl">❦</span>}
                    <span><span className="font-bold text-cocoa">{m.title}</span><span className="block text-sm text-cocoa-soft">{formatDate(m.happenedOn)} · {m.authorName}</span></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <Washi tone="lilac" />
          <h2 className="font-serif-display text-xl">Still to do, together</h2>
          {upcoming.length === 0 ? <p className="mt-2 text-sm text-cocoa-soft">No plans yet. Add a small one in Our Future — it does not have to be grand.</p> : (
            <ul className="mt-4 space-y-3">
              {upcoming.map((p) => (
                <li key={p.id} className="flex items-start gap-2">
                  <span aria-hidden="true" className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-cocoa/40 text-[10px]">○</span>
                  <button onClick={() => go('future')} className="text-left"><span className="font-bold text-cocoa">{p.title}</span><span className="block text-sm text-cocoa-soft">{p.category === 'bucket' ? 'Bucket list' : p.category === 'date' ? 'Date idea' : 'Plan'}</span></button>
                </li>
              ))}
            </ul>
          )}
          <p className="font-hand mt-4 text-xl text-plum">little plans, big feelings</p>
        </Card>
      </div>
    </motion.main>
  );
}
