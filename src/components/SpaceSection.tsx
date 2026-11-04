/* Phase 16 — Two People, One Little Home: space/partner view,
 * invitation surface, personalization surface, privacy legend, and
 * the gentle shared activity feed. Frontend only, on the existing
 * store abstraction. No new backend, model, or Supabase call is made
 * here; store.createInvitation / store.updateProfile are the existing
 * paths, and everything else reads existing saved content.
 *
 * Demo honesty: in demo mode the two profiles are switchable test
 * profiles on this device, not two real signed-in people. Every demo
 * label in this file says so; nothing here presents demo activity as
 * a real partner's actions. */

import { useEffect, useState } from 'react';
import type { PlaceStore } from '../lib/store';
import type { RoomId } from '../lib/types';
import { AVATAR_OPTIONS, avatarSymbol, Button, Card, Field, inputCls } from './ui';
import { deriveGarden } from '../lib/garden';
import { loadGameData } from '../lib/games';
import {
  ACTIVITY_TYPE_LABEL, DEVICE_COLOURS, deriveActivity,
  readActivityPrefs, readDeviceProfileExtras, saveActivityPrefs, saveDeviceProfileExtras,
  type ActivityEvent, type ActivityPrefs, type ActivityType,
} from '../lib/activity';
import { formatDate } from '../lib/utils';

export type GoFn = (r: RoomId) => void;

function AvatarBadge({ name, avatar, size = 'h-14 w-14 text-2xl' }: { name: string; avatar?: string; size?: string }) {
  return (
    <span aria-hidden="true" className={`flex ${size} shrink-0 items-center justify-center rounded-full border-2 border-cocoa/30 bg-paper shadow`}>
      {avatarSymbol(avatar) || (name || '?').trim().charAt(0).toUpperCase()}
    </span>
  );
}

/* ---------------- 1. Two illustrated profile cards ---------------- */

export function ProfileCards({ store, refresh, notify, onSignOut }: {
  store: PlaceStore; refresh: () => void; notify: (msg: string, kind?: 'ok' | 'error') => void;
  onSignOut: (() => void | Promise<void>) | null;
}) {
  const viewer = store.data.members.find((m) => m.id === store.viewerId);
  const partner = store.data.members.find((m) => m.id !== store.viewerId);
  const [name, setName] = useState(viewer?.displayName ?? '');
  const [avatar, setAvatar] = useState<string | undefined>(viewer?.avatar);
  const extras = viewer ? readDeviceProfileExtras(viewer.id) : { description: '', colour: '' };
  const [description, setDescription] = useState(extras.description);
  const [colour, setColour] = useState(extras.colour);

  if (!viewer) {
    return (
      <Card>
        <h2 className="font-serif-display text-xl">The two people in this home</h2>
        <p className="mt-2 text-sm leading-relaxed text-cocoa-soft">No members are loaded yet. Create or join a space first — the space setup form appears above when you are signed in without one.</p>
      </Card>
    );
  }
  const colourHex = DEVICE_COLOURS.find((c) => c.key === colour)?.hex;

  return (
    <Card>
      <h2 className="font-serif-display text-xl">The two people in this home</h2>
      {store.mode === 'demo' && (
        <p role="note" className="mt-2 rounded-xl bg-butter px-3 py-2 text-sm leading-relaxed text-cocoa ring-1 ring-inset ring-cocoa/20">
          Demo profiles: these are two switchable test profiles saved on this device only — not two real signed-in people.
          Use the demo banner&apos;s viewer switch (or the door menu on Home) to view as the other test profile.
        </p>
      )}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {/* Your card — editable through the existing profile-update path only. */}
        <article className="rounded-2xl border border-cocoa/25 bg-cream p-4" style={colourHex ? { borderTopWidth: 6, borderTopColor: colourHex } : undefined}>
          <div className="flex items-center gap-3">
            <AvatarBadge name={name || viewer.displayName} avatar={avatar} />
            <div>
              <p className="font-serif-display text-lg leading-tight">{viewer.displayName}</p>
              <p className="text-xs font-bold uppercase tracking-widest text-plum">You · this is your card</p>
            </div>
          </div>
          {description && <p className="mt-3 text-sm leading-relaxed text-cocoa-soft">{description}</p>}
          {colourHex && <p className="mt-2 text-xs text-cocoa-soft"><span aria-hidden="true" className="mr-1 inline-block h-3 w-3 rounded-full align-middle" style={{ backgroundColor: colourHex }} />Favourite colour (this device only)</p>}
          <div className="mt-3 space-y-2">
            <Field label="Display name — your partner sees this"><input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} maxLength={100} /></Field>
            <div>
              <span className="field-label mb-1.5 block text-sm font-bold text-cocoa">Avatar — your partner sees this too</span>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Choose an avatar">
                {AVATAR_OPTIONS.map((a) => (
                  <button key={a.key} type="button" onClick={() => setAvatar(a.key === 'initial' ? undefined : a.key)}
                    aria-pressed={(avatar ?? 'initial') === a.key} aria-label={a.label} title={a.label}
                    className={`flex h-11 w-11 items-center justify-center rounded-full border-2 text-lg shadow ${avatar === a.key || (!avatar && a.key === 'initial') ? 'border-cocoa bg-butter' : 'border-cocoa/25 bg-paper'}`}>
                    {a.symbol || (name || '?').trim().charAt(0).toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            <Field label="A line about you — visible on this device only, not shared with your partner" hint="The profile model has no description field, so this stays on this device. Your partner cannot see it.">
              <input value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} maxLength={200} placeholder="e.g. Tea first, then everything else" />
            </Field>
            <div>
              <span className="field-label mb-1.5 block text-sm font-bold text-cocoa">Favourite colour — visible on this device only, not shared</span>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Choose a favourite colour">
                <button type="button" onClick={() => setColour('')} aria-pressed={colour === ''} className={`rounded-full border-2 px-3 py-1.5 text-sm font-bold ${colour === '' ? 'border-cocoa bg-butter' : 'border-cocoa/25 bg-paper'}`}>None</button>
                {DEVICE_COLOURS.map((c) => (
                  <button key={c.key} type="button" onClick={() => setColour(c.key)} aria-pressed={colour === c.key} aria-label={c.label}
                    className={`flex items-center gap-1.5 rounded-full border-2 px-3 py-1.5 text-sm font-bold ${colour === c.key ? 'border-cocoa bg-butter' : 'border-cocoa/25 bg-paper'}`}>
                    <span aria-hidden="true" className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: c.hex }} />{c.label}
                  </button>
                ))}
              </div>
            </div>
            <Button onClick={async () => {
              try {
                await store.updateProfile(name, avatar);
                saveDeviceProfileExtras(viewer.id, { description: description.trim().slice(0, 200), colour });
                refresh(); notify('Profile saved. Name and avatar are shared with your partner; the line and colour above stay on this device.');
              } catch (e) { notify(e instanceof Error ? e.message : 'Could not save that profile.', 'error'); }
            }}>Save my profile</Button>
          </div>
        </article>
        {/* Partner card — never editable from your sign-in. */}
        <article className="rounded-2xl border border-cocoa/25 bg-cream p-4">
          {partner ? (
            <>
              <div className="flex items-center gap-3">
                <AvatarBadge name={partner.displayName} avatar={partner.avatar} />
                <div>
                  <p className="font-serif-display text-lg leading-tight">{partner.displayName}</p>
                  <p className="text-xs font-bold uppercase tracking-widest text-plum">Your partner</p>
                </div>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-cocoa-soft">
                Only your partner can change their own name and avatar, from their own sign-in.
                {store.mode === 'demo' && ' In demo, switch the viewer (banner or Home door menu) to edit the other test profile — that is a testing device, not a second account.'}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-cocoa-soft">Their email, password, and sign-in details are never shown here and never shared with you — names and avatars are the only account-adjacent things a partner sees.</p>
            </>
          ) : (
            <>
              <p className="font-serif-display text-lg leading-tight">Waiting for your partner</p>
              <p className="mt-3 text-sm leading-relaxed text-cocoa-soft">This card fills in when a second person joins your space with your invite code. Until then, the space holds one member — you.</p>
            </>
          )}
        </article>
      </div>
      <div className="mt-4 border-t border-cocoa/20 pt-3">
        <h3 className="font-serif-display text-lg">Your account</h3>
        {store.mode === 'demo' ? (
          <p className="mt-1 text-sm leading-relaxed text-cocoa-soft">Demo mode has no account to sign out of — there is no sign-in, no password, and nothing synced. Use “Clear demo content” below to wipe this device&apos;s demo data.</p>
        ) : (
          <>
            <p className="mt-1 text-sm leading-relaxed text-cocoa-soft">
              {store.mode === 'supabase'
                ? 'Account recovery: use “Forgot your password?” on the sign-in screen — it sends a reset link to your email. The message is the same whether or not an account exists, so no one can probe for addresses.'
                : 'Account recovery: the PostgreSQL API mode has no password-reset endpoint — that is a gap, stated plainly, not a flow. There is no reset link to send in this mode.'}
              {' '}Your email address itself is never displayed in this app and never shown to your partner.
            </p>
            {onSignOut && <div className="mt-2"><Button variant="quiet" onClick={() => void onSignOut()}>Sign out</Button></div>}
          </>
        )}
      </div>
    </Card>
  );
}

/* ---------------- 2. Partner invitation and pairing ---------------- */

export function InvitationPanel({ store, notify }: { store: PlaceStore; notify: (msg: string, kind?: 'ok' | 'error') => void }) {
  const [inviteResult, setInviteResult] = useState<{ code: string; expiresAt: string | null } | null>(null);
  const count = store.data.members.length;
  const status = count >= 2 ? 'Paired — your space is full (2 of 2 members). No new invite can be used.' : count === 1 ? 'Waiting for your partner (1 of 2 members).' : 'No members loaded yet.';
  return (
    <Card>
      <h2 className="font-serif-display text-xl">Invite your partner</h2>
      <p className="mt-2 text-sm leading-relaxed text-cocoa-soft" role="status">Partner status: <strong>{status}</strong></p>
      {store.mode === 'demo' ? (
        <p className="mt-2 text-sm leading-relaxed text-cocoa-soft">
          Demo sample code: <span className="font-bold text-cocoa">{store.data.space.inviteCode || '—'}</span> — this code does not pair a real account.
          Real pairing needs a signed-in space; in demo there is no second account to join, so the join flow is not available here.
          The code format itself is the existing one: 6 characters, no 0/O or 1/I, upper-case.
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm leading-relaxed text-cocoa-soft">
            Permanent code: <span className="font-bold text-cocoa">{store.data.space.inviteCode || '—'}</span> — this code never expires. Share it privately, never publicly.
            Your partner enters it in the space setup form when they sign in without a space.
          </p>
          <p className="mt-1 text-sm leading-relaxed text-cocoa-soft">For a safer share, create a single-use code instead — it works for 7 days, then stops working, even if it is forwarded. Creating one for a full space is refused.</p>
          <div className="mt-3 space-y-2">
            <Button variant="quiet" onClick={async () => { try { const r = await store.createInvitation(); setInviteResult(r); notify('Invite code created. Share it privately.'); } catch (e) { notify(e instanceof Error ? e.message : 'Could not create an invite code.', 'error'); } }}>Create a 7-day invite</Button>
            {inviteResult && (
              <p className="text-sm text-cocoa-soft">Code: <span className="font-bold text-cocoa">{inviteResult.code}</span>{inviteResult.expiresAt ? <> · expires {new Date(inviteResult.expiresAt).toLocaleString()}</> : ' · valid for 7 days, single use'}</p>
            )}
          </div>
        </>
      )}
      <h3 className="font-serif-display mt-4 text-lg">If joining does not work</h3>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm leading-relaxed text-cocoa-soft">
        <li>Expired or already-used single-use code: the server finds no unexpired invitation and falls back to the permanent code, so you see <em>“No space was found with that invite code.”</em> There is no distinct “expired” message — that is a backend gap, reported, not invented around. Ask your partner for a fresh code.</li>
        <li>Already in a space: <em>“You already belong to a space.”</em> A person holds exactly one space.</li>
        <li>Space already full: <em>“This space already has two members.”</em></li>
        <li>Not a member, trying to create an invite: <em>“You do not belong to that space.”</em></li>
      </ul>
      <p className="mt-2 text-sm leading-relaxed text-cocoa-soft">Leak check: the invite and join screens show no other person&apos;s email, name, or content before pairing is confirmed — the join form asks only for a code, and the error messages above name no one. Joining itself stays in the existing space setup form (shown when signed in without a space); it is not duplicated here.</p>
    </Card>
  );
}

/* ---------------- 3. Personalization, gathered ---------------- */

export function PersonalizationPanel({ store, go, cottageTheme, onCottageTheme, reduceMotionPref, onShowWelcome, onShowIntro, onGoDrawer }: {
  store: PlaceStore; go: GoFn; cottageTheme: 'day' | 'night';
  onCottageTheme: (t: 'day' | 'night') => void; reduceMotionPref: boolean;
  onShowWelcome: () => void; onShowIntro: () => void; onGoDrawer: () => void;
}) {
  const garden = deriveGarden(store);
  return (
    <Card>
      <h2 className="font-serif-display text-xl">Make it yours</h2>
      <p className="mt-2 text-sm leading-relaxed text-cocoa-soft">Everything here changes how your home looks or feels. Nothing here buys, places, or unlocks anything — and nothing here changes a shared letter, memory, or photo.</p>
      <h3 className="font-serif-display mt-4 text-lg">Names and avatars</h3>
      <p className="mt-1 text-sm leading-relaxed text-cocoa-soft">Edit your display name and avatar in “The two people in this home” above — the same existing profile path, not a second editor.</p>
      <h3 className="font-serif-display mt-4 text-lg">Cottage picture</h3>
      <p className="mt-1 text-sm leading-relaxed text-cocoa-soft">A preference on this device only — it changes no shared photo, letter, or memory.</p>
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Choose a cottage picture">
        <Button variant={cottageTheme === 'day' ? 'primary' : 'quiet'} onClick={() => onCottageTheme('day')}>Day cottage — pastel garden</Button>
        <Button variant={cottageTheme === 'night' ? 'primary' : 'quiet'} onClick={() => onCottageTheme('night')}>Night cottage — moonlit garden</Button>
      </div>
      <h3 className="font-serif-display mt-4 text-lg">Motion and welcome</h3>
      <p className="mt-1 text-sm leading-relaxed text-cocoa-soft">Animation: {reduceMotionPref ? 'reduced' : 'full, following your device setting'} — the single reduced-motion control now lives in the desk drawer at the top of Settings, so it is not duplicated here.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="quiet" onClick={onGoDrawer}>Change animation in the desk drawer</Button>
        <Button variant="quiet" onClick={onShowWelcome}>Show the welcome again</Button>
        <Button variant="quiet" onClick={onShowIntro}>Show the introduction again</Button>
      </div>
      <h3 className="font-serif-display mt-4 text-lg">Your cottage reflects your shared content</h3>
      <p className="mt-1 text-sm leading-relaxed text-cocoa-soft">
        The living garden on Home is derived purely from saved content — it is not a shop and nothing here is placeable or purchasable.
        Right now it draws on {garden.ornaments.length} garden ornament{garden.ornaments.length === 1 ? '' : 's'} (completed plans, favourited notes and appreciations) and {garden.milestones.length} milestone{garden.milestones.length === 1 ? '' : 's'} (first shared memory, adventures completed).
        Add or favourite shared content and the cottage changes on its own; delete or unfavourite it and the element goes away.
      </p>
      <h3 className="font-serif-display mt-4 text-lg">Game tokens and hero look</h3>
      <p className="mt-1 text-sm leading-relaxed text-cocoa-soft">Board player tokens and the hero&apos;s look are edited in the Arcade, where those games live — they are linked from here, not duplicated. Board tokens are game-only names and tokens for two players on one device, not account profiles.</p>
      <div className="mt-2"><Button variant="quiet" onClick={() => go('arcade')}>Open the Game Arcade</Button></div>
      <h3 className="font-serif-display mt-4 text-lg">Sound</h3>
      <p className="mt-1 text-sm leading-relaxed text-cocoa-soft">The only sound in the app is the Quiet Room&apos;s rain sound: generated in your browser, off by default, never autoplay, and only for that visit — it stops when you close it or leave. Its on/off switch and volume now live in the desk drawer at the top of Settings (this device only); with sound off there, the rain control will not start.</p>
      <div className="mt-2 flex flex-wrap gap-2"><Button variant="quiet" onClick={onGoDrawer}>Sound in the desk drawer</Button><Button variant="quiet" onClick={() => go('quiet')}>Open the Quiet Room</Button></div>
      <p className="mt-3 text-sm leading-relaxed text-cocoa-soft">Notifications: this home sends no push or email notifications, by design — no reminders that nag, no streaks, no alerts. The activity feed below is an in-app list only, and its toggles control that list, not any notification channel.</p>
    </Card>
  );
}

/* ---------------- 4. Shared versus private, made understandable ---------------- */

export function PrivacyLegend() {
  const rows: { kind: string; partnerCan: string; partnerCannot: string }[] = [
    { kind: 'Shared memory', partnerCan: 'See the title, caption, story, and photo on the Memory Wall.', partnerCannot: 'Delete it permanently without the same two-step confirmation you get; unshare it (memories have no private variant — delete or keep).' },
    { kind: 'Shared letter', partnerCan: 'Read it in Letters once it is shared and unsealed.', partnerCannot: 'Read it before you share it, or edit your private drafts.' },
    { kind: 'Private draft', partnerCan: 'See nothing of it — no title, no preview, no count, in no list, search, or Deleted view.', partnerCannot: 'Find it in any way until you choose to share it.' },
    { kind: 'Private journal', partnerCan: 'See nothing of it — journals are author-only in the app and under server rules.', partnerCannot: 'Read it, search it, or see its title, including in Deleted.' },
    { kind: 'Sealed / scheduled letter', partnerCan: 'See only its envelope in Letters: title and the date it opens.', partnerCannot: 'Read its words, search its body, or see it in the activity feed before it opens.' },
    { kind: 'Personal account information', partnerCan: 'See your display name and avatar — nothing else.', partnerCannot: 'See your email, password, sign-in token, or any account detail. Those are never rendered anywhere in this app.' },
  ];
  return (
    <Card>
      <h2 className="font-serif-display text-xl">Who can see what</h2>
      <p className="mt-2 text-sm leading-relaxed text-cocoa-soft">Plain words, matching the real rules: drafts and journals are author-only, sealed bodies stay hidden until authorised opening, scheduled bodies stay hidden until reveal, and account details are never shared.</p>
      <ul className="mt-3 space-y-3">
        {rows.map((r) => (
          <li key={r.kind} className="rounded-xl border border-cocoa/20 bg-cream px-3 py-2">
            <p className="font-bold">{r.kind}</p>
            <p className="mt-1 text-sm leading-relaxed text-cocoa-soft"><span className="font-bold text-cocoa">Your partner can: </span>{r.partnerCan}</p>
            <p className="text-sm leading-relaxed text-cocoa-soft"><span className="font-bold text-cocoa">Your partner cannot: </span>{r.partnerCannot}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ---------------- 5. Gentle shared activity feed ---------------- */

const ALL_TYPES: ActivityType[] = ['memory', 'letter', 'plan', 'appreciation', 'game'];

export function ActivityFeed({ store }: { store: PlaceStore }) {
  const [prefs, setPrefs] = useState<ActivityPrefs>(() => readActivityPrefs());
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  useEffect(() => {
    let live = true;
    loadGameData(store).then((d) => { if (live) setEvents(deriveActivity(store, d.progress)); }).catch(() => { if (live) setEvents(deriveActivity(store, [])); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.version]);
  const update = (next: ActivityPrefs) => { setPrefs(next); saveActivityPrefs(next); };
  const visible = prefs.enabled ? events.filter((e) => prefs.types[e.type]) : [];
  return (
    <Card>
      <h2 className="font-serif-display text-xl">What&apos;s new in your home</h2>
      <p className="mt-2 text-sm leading-relaxed text-cocoa-soft">
        A quiet list of shareable moments, newest first — titles only, never the words inside.
        Private journals, private drafts, sealed letters, and account details never appear here, in any view.
        There are no push or email notifications in this phase: the controls below switch feed entries on and off in this list only.
        {store.mode === 'demo' && ' In demo, “Partner” entries are demo test data on this device, not a real partner’s actions.'}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant={prefs.enabled ? 'primary' : 'quiet'} onClick={() => update({ ...prefs, enabled: !prefs.enabled })}>
          {prefs.enabled ? 'Activity feed: on (tap to hide it)' : 'Activity feed: off (tap to show it)'}
        </Button>
        {ALL_TYPES.map((t) => (
          <button key={t} type="button" onClick={() => update({ ...prefs, types: { ...prefs.types, [t]: !prefs.types[t] } })}
            aria-pressed={prefs.types[t]} className={`rounded-full border-2 px-3 py-1.5 text-sm font-bold ${prefs.types[t] ? 'border-cocoa bg-butter' : 'border-cocoa/25 bg-paper'}`}>
            {ACTIVITY_TYPE_LABEL[t]}: {prefs.types[t] ? 'shown' : 'hidden'}
          </button>
        ))}
      </div>
      {!prefs.enabled ? (
        <p className="mt-3 text-sm text-cocoa-soft">The feed is switched off on this device. Switch it back on above to see shared moments again — nothing was deleted.</p>
      ) : visible.length === 0 ? (
        <p className="mt-3 text-sm text-cocoa-soft">{events.length === 0 ? 'Nothing shared yet. When a shared memory, letter, completed plan, note, or finished game appears, it will land here.' : 'Everything is filtered out right now. Switch a type back on above to see its moments.'}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {visible.map((e) => (
            <li key={e.key} className="rounded-xl border border-cocoa/20 bg-cream px-3 py-2">
              <p className="text-sm"><span className="font-bold">{ACTIVITY_TYPE_LABEL[e.type]}</span> · {e.title}</p>
              <p className="mt-0.5 text-xs text-cocoa-soft">{e.authorLabel} · {e.detail} · {formatDate(e.at)}</p>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs leading-relaxed text-cocoa-soft">Feed preferences are stored on this device only (activity feed on/off and per-type toggles); they are not a notification subscription and they change nothing your partner sees.</p>
    </Card>
  );
}
