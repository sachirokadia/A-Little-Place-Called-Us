import { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import type { RoomId } from '../lib/types';
import type { PlaceStore } from '../lib/store';
import { formatDate, isSealed } from '../lib/utils';
import { Card, Washi, AvatarPair, Button } from './ui';
import { RoomCard } from './RoomCard';

const ROOMS: { id: RoomId; name: string; line: string; icon: string; bg: string; rot: string; doodle: string }[] = [
  { id: 'reminders', name: 'Reminder Room', line: 'Small notes to find on ordinary days.', icon: '✦', bg: 'bg-butter', rot: '-1deg', doodle: 'a note pinned with love' },
  { id: 'memories', name: 'Memory Wall', line: 'Photos, dates, and the stories behind them.', icon: '❦', bg: 'bg-rose', rot: '0.8deg', doodle: 'pressed flowers, kept' },
  { id: 'letters', name: 'Letters', line: 'Shared letters, private drafts, and sealed ones.', icon: '✉', bg: 'bg-powder', rot: '-0.6deg', doodle: 'sealed with a sticker' },
  { id: 'quiet', name: 'Quiet Room', line: 'Support, slow breathing, and private journals.', icon: '☾', bg: 'bg-sage', rot: '1deg', doodle: 'a quiet corner, just yours' },
  { id: 'appreciations', name: 'Things I See in You', line: 'Appreciation, achievements, encouragement.', icon: '✧', bg: 'bg-lilac', rot: '-0.8deg', doodle: 'noticed, and written down' },
  { id: 'future', name: 'Our Future', line: 'Bucket lists, date ideas, and plans to keep.', icon: '→', bg: 'bg-butter', rot: '0.6deg', doodle: 'to do, together, someday' },
  { id: 'arcade', name: 'Game Arcade', line: 'Seven games to play together, from Memory Match to Our Little World.', icon: '◎', bg: 'bg-powder', rot: '-0.4deg', doodle: 'games, coming soon' },
];

export const WELCOME_KEY = 'our-place-welcome-dismissed';

function WelcomeCard({ store, go }: { store: PlaceStore; go: (r: RoomId) => void }) {
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(WELCOME_KEY) === '1'; } catch { return false; }
  });
  if (dismissed) return null;
  const dismiss = () => {
    try { localStorage.setItem(WELCOME_KEY, '1'); } catch { /* private mode: dismissal lasts for this session */ }
    setDismissed(true);
  };
  const d = store.data;
  // Real names only: in demo mode the members are literally "You" and "Partner",
  // so naming them would read as a template, not as two people. In a real space,
  // the members' display names are theirs, set in Settings.
  const realNames = store.mode !== 'demo' && d.members.length >= 2
    ? d.members.map((m) => m.displayName).filter(Boolean) : [];
  // Real notes only: demo samples are explicitly labelled samples elsewhere, but
  // showing one here as "A note for you" would present invented content as if a
  // partner wrote it. In demo mode the welcome always shows the invitation, and
  // in a real space it shows the latest real appreciation or shared letter.
  const latestAppreciation = store.mode === 'demo' ? undefined : store.shared(d.appreciations)[0];
  const latestLetter = store.mode === 'demo' ? undefined : store.visibleLetters().filter((l) => l.visibility === 'shared' && !isSealed(l, store.viewerId))[0];
  return (
    <section aria-label="Welcome home" className="mt-8">
      <Card>
        <Washi tone="sage" />
        <h2 className="font-serif-display text-2xl text-cocoa">
          {realNames.length >= 2 ? `Welcome home, ${realNames[0]} and ${realNames[1]}.` : 'Welcome home.'}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-cocoa-soft">
          This is your shared home — made for the two of you, filled by both of you.
          Take your time looking around. Nothing here needs a reply, a score, or a finish.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="quiet" onClick={() => go('memories')}>＋ Add a memory</Button>
          <Button variant="quiet" onClick={() => go('letters')}>✎ Write a letter</Button>
          <Button variant="quiet" onClick={() => go('appreciations')}>✧ Leave an appreciation</Button>
          <Button variant="quiet" onClick={() => go('future')}>→ Add a small plan</Button>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-cocoa-soft">
          The Arcade has seven small games — Memory Match, a quiz, a board game and more.
          They are for fun, not for proving anything: every final message can be read without winning,
          and nothing you write here depends on a score.
        </p>
        <div className="mt-4 rounded-2xl border border-cocoa/15 bg-paper p-4">
          <p className="text-xs font-extrabold uppercase tracking-widest text-cocoa-soft">A note for you</p>
          {latestAppreciation ? (
            <><p className="font-serif-display mt-2 text-xl leading-relaxed text-cocoa">“{latestAppreciation.text}”</p>
            <p className="mt-2 text-sm text-cocoa-soft">— {latestAppreciation.authorName}, in Things I See in You</p></>
          ) : latestLetter ? (
            <><p className="font-serif-display mt-2 text-xl leading-relaxed text-cocoa">{latestLetter.title}</p>
            <p className="mt-2 text-sm text-cocoa-soft">— {latestLetter.authorName}, in Letters. Open it there when you want to read it in full.</p></>
          ) : (
            <p className="mt-2 text-sm leading-relaxed text-cocoa-soft">
              A note from each other will live here. When you are ready — no rush, no occasion needed —
              write one in Letters or leave an appreciation in Things I See in You.
            </p>
          )}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="quiet" onClick={dismiss}>Hide this welcome</Button>
          <span className="text-xs text-cocoa-soft">You can bring it back any time from Settings.</span>
        </div>
      </Card>
    </section>
  );
}

export function Home({ store, go, onRandomReminder }: { store: PlaceStore; go: (r: RoomId) => void; onRandomReminder: () => void }) {
  const d = store.data;
  const sealed = store.visibleLetters().filter((l) => isSealed(l, store.viewerId)).length;
  const upcoming = store.shared(d.plans).filter((p) => p.status === 'planned').slice(0, 3);
  const recent = store.shared(d.memories).slice(0, 3);
  const favourites = [...store.shared(d.reminders), ...store.shared(d.memories)].filter((i) => i.isFavorite).length;
  const partnerNames = d.members.length >= 2 ? d.members.map((m) => (m.id === store.viewerId ? 'You' : m.displayName || 'Partner')) : ['You', 'Partner'];

  // Hotspots: each room is a quiet paper chip pinned on the photograph.
  // The scene keeps one fixed aspect ratio, so these positions stay on
  // their features on every screen size. Rooms are also reachable from
  // the quick-travel row and the bottom navigation — no room depends
  // on spotting its hotspot.
  const HOTSPOTS: { id: RoomId; icon: string; x: number; y: number }[] = [
    { id: 'future', icon: '✦', x: 85, y: 14 },
    { id: 'quiet', icon: '☾', x: 60, y: 46 },
    { id: 'appreciations', icon: '✧', x: 32, y: 60 },
    { id: 'memories', icon: '❦', x: 77, y: 66 },
    { id: 'letters', icon: '✉', x: 19, y: 72 },
    { id: 'reminders', icon: '✦', x: 47, y: 78 },
  ];
  const hotspotName = (id: RoomId) => ROOMS.find((r) => r.id === id)?.name ?? id;
  const hotspotShort: Record<RoomId, string> = { home: 'Home', reminders: 'Reminders', memories: 'Memories', letters: 'Letters', quiet: 'Quiet Room', appreciations: 'See in You', future: 'Future', arcade: 'Arcade', deleted: 'Deleted', settings: 'Settings' };

  const reduceMotion = useReducedMotion();
  return (
    <motion.main initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} className="relative mx-auto w-full max-w-5xl px-4 pb-32 pt-6 sm:px-6">
      {/* The supplied reference photograph, presented plainly as a rounded
          scrapbook plate. No CSS stars, fireflies, glows, gradients or
          glass pills are layered over it — the photo is the artwork.
          The parchment card below carries the exact brand copy. */}
      <section aria-label="A Little Place Called Us">
        <div className="relative overflow-hidden rounded-[28px] border border-cocoa/20 shadow-[0_16px_32px_rgba(81,68,61,0.18)]">
          <img
            src="/night-cottage.jpg"
            alt="A stone cottage at night, its windows glowing warm, beneath a moonlit garden of ferns, hostas and jasmine"
            className="block aspect-[16/10] w-full object-cover object-[50%_42%]"
          />
          <nav aria-label="Places in your home">
            {HOTSPOTS.map((h) => (
              <button key={h.id} onClick={() => go(h.id)} className="hotspot" style={{ left: `${h.x}%`, top: `${h.y}%` }}
                aria-label={`Enter ${hotspotName(h.id)}`}>
                <span className="hotspot-dot" aria-hidden="true">{h.icon}</span>
                <span className="hotspot-label"><span className="sm:hidden">{hotspotShort[h.id]}</span><span className="hidden sm:inline">{hotspotName(h.id)}</span></span>
              </button>
            ))}
          </nav>
        </div>
        <div className="paper-card relative z-10 mx-3 -mt-6 rounded-[28px] px-5 pb-8 pt-8 text-center sm:mx-8 sm:-mt-20 sm:pt-10">
          <Washi tone="rose" />
          <div className="flex justify-center"><AvatarPair names={partnerNames} /></div>
          <p className="mt-5 text-[11px] font-extrabold uppercase tracking-[0.28em] text-plum">YOUR SHARED DIGITAL HOME</p>
          <h1 className="font-serif-display mx-auto mt-3 max-w-2xl text-5xl leading-[1.05] text-cocoa sm:text-6xl">A Little Place Called Us.</h1>
          <p className="font-serif-display mt-4 text-xl leading-relaxed text-plum sm:text-2xl">Made with love. Filled by both of us.</p>
          <p className="mx-auto mt-4 max-w-lg text-sm leading-relaxed text-cocoa-soft sm:text-base">
            A place for the things we want to remember, the things we don't always know how to say, and the future we're still imagining.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <button onClick={onRandomReminder} className="min-h-11 rounded-full bg-cocoa px-5 py-2 text-sm font-bold text-cream hover:bg-[#42382f]">A little reminder for today</button>
            <button onClick={() => go('memories')} className="min-h-11 rounded-full border border-cocoa/30 bg-paper px-5 py-2 text-sm font-bold text-cocoa hover:bg-cream-deep">＋ Add a memory</button>
            <button onClick={() => go('letters')} className="min-h-11 rounded-full border border-cocoa/30 bg-paper px-5 py-2 text-sm font-bold text-cocoa hover:bg-cream-deep">✎ Write a letter</button>
          </div>
        </div>
      </section>

      {/* First-visit welcome (personalization phase): a gentle, dismissible
          card — never a modal, never a forced sequence, never a task list.
          It appears only until dismissed (localStorage, per device, so one
          partner dismissing it does not hide it for the other), and can be
          brought back any time from Settings. The personal message below
          is real content when it exists (the latest shared appreciation,
          else the latest shared, unsealed letter) and an honest invitation
          when it does not — never an invented letter, quote, or memory. */}
      <WelcomeCard store={store} go={go} />

      {/* Room cards (Phase 2): the seven destinations as scrapbook cards,
          replacing the duplicate quick-travel chip row. No room depends
          on spotting its photo hotspot — every card navigates for real. */}
      <section aria-label="Rooms in your home" className="mt-8">
        <h2 className="font-serif-display text-2xl text-cocoa">Rooms in your home</h2>
        <p className="mt-1 text-sm leading-relaxed text-cocoa-soft">Tap a card to enter that room.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ROOMS.map((r) => (
            <RoomCard key={r.id} id={r.id} name={r.name} line={r.line} icon={r.icon} bg={r.bg} rot={r.rot} doodle={r.doodle} onOpen={() => go(r.id)} />
          ))}
        </div>
      </section>

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
