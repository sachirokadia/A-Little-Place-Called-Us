/* Phase 17 — The little desk drawer: Settings, extended, not rebuilt.
 *
 * This is ONE more card at the top of the existing Settings room — a
 * wooden desk drawer (stationery, keys, little notes), never a generic
 * admin dashboard. It does not duplicate the panels below: where a
 * control already lives (cottage picture, profile colour, invitation,
 * privacy legend, activity feed, password form), this drawer LINKS to
 * it by scrolling, and says so. Where a control is new, it lives here
 * and only here, so there is exactly one control per setting:
 *  - sound on/off + volume (new; device-local our-place-sound-v1)
 *  - text size S/M/L/XL (new; device-local our-place-text-size-v1)
 *  - high contrast (new; device-local our-place-contrast-v1)
 *  - reduced animation (MOVED here from "Make it yours" — the old
 *    button there is now a link here, so the two controls that did
 *    the same thing are merged into one)
 * Everything states where it persists. Nothing here is shared: every
 * new preference is localStorage on this device, because the profile
 * model has no field for any of them.
 *
 * Deliberately NOT here, with the reason stated in the UI (not silently
 * omitted): an app-wide dark mode (no dark theme exists anywhere in
 * the app — the page, tokens and rooms are pastel by design, and a
 * toggle re-tinting one panel would be fake); seasonal decoration (no
 * seasonal asset/theme system exists — not implemented); data export
 * (the old app has no export path at all — verified by grep; the new
 * stack's export is a different app and is not claimed here); account
 * deletion (no endpoint or in-app path exists — no delete button is
 * shown, because a button that pretends to delete an account would be
 * dangerous; the existing per-item Deleted/purge route and the demo
 * "Clear demo content" route are named instead). */

import type { PlaceStore } from '../lib/store';
import type { RoomId } from '../lib/types';
import { Button, Card } from './ui';
import { DEVICE_COLOURS, readDeviceProfileExtras } from '../lib/activity';
import type { SoundPrefs, TextSize } from '../lib/preferences';

type Props = {
  store: PlaceStore;
  go: (r: RoomId) => void;
  cottageTheme: 'day' | 'night';
  onScrollTo: (id: string) => void;
  reduceMotionPref: boolean;
  onToggleReduceMotion: () => void;
  sound: SoundPrefs;
  onSound: (p: SoundPrefs) => void;
  textSize: TextSize;
  onTextSize: (s: TextSize) => void;
  highContrast: boolean;
  onHighContrast: (on: boolean) => void;
  showPasswordForm: boolean;
  onSignOut: (() => void | Promise<void>) | null;
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 border-t border-cocoa/20 pt-4 first:mt-0 first:border-t-0 first:pt-0">
      <h3 className="font-serif-display text-lg">{title}</h3>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-cocoa-soft">{children}</div>
    </section>
  );
}

export function DeskDrawer({ store, go, cottageTheme, onScrollTo, reduceMotionPref, onToggleReduceMotion, sound, onSound, textSize, onTextSize, highContrast, onHighContrast, showPasswordForm, onSignOut }: Props) {
  const viewer = store.data.members.find((m) => m.id === store.viewerId);
  const extras = viewer ? readDeviceProfileExtras(viewer.id) : { description: '', colour: '' };
  const colourHex = DEVICE_COLOURS.find((c) => c.key === extras.colour)?.hex;
  const modeLabel = store.mode === 'demo' ? 'Demo (this device only, no account)' : store.mode === 'api' ? 'PostgreSQL API (synced)' : 'Supabase (synced)';
  return (
    <Card>
      <div style={colourHex ? { borderTop: `6px solid ${colourHex}`, marginTop: -4, paddingTop: 8 } : undefined}>
        <h2 className="font-serif-display text-xl">🗄️ The little desk drawer</h2>
        <p className="mt-2 text-sm leading-relaxed text-cocoa-soft">
          The small things that make this place yours to use — how it looks, how it sounds, how big its words are.
          Every control here says where it lives: “this device only” means localStorage on this device, never shared with your partner.
          {colourHex ? ' Your favourite colour (this device only) trims the top of this drawer, and your own profile card below — nowhere else.' : ''}
        </p>
      </div>

      <Section title="Appearance — the cottage, as it already is">
        <p>Cottage picture: <strong className="text-cocoa">{cottageTheme === 'day' ? 'Day cottage — pastel garden' : 'Night cottage — moonlit garden'}</strong> (this device only, key <code>our-place-cottage-theme</code> — the existing mechanism, unchanged). Change it in “Make it yours” below.</p>
        <div><Button variant="quiet" onClick={() => onScrollTo('make-it-yours')}>Go to “Make it yours”</Button></div>
        <p>Favourite colour: <strong className="text-cocoa">{extras.colour ? (DEVICE_COLOURS.find((c) => c.key === extras.colour)?.label ?? extras.colour) : 'None chosen'}</strong> — this device only (<code>our-place-device-profile-v1</code>). It trims your profile card and this drawer; it is not an app-wide accent and is never shared. Change it on your profile card below.</p>
        <p><strong className="text-cocoa">Dark mode: not available.</strong> There is no app-wide dark theme in this app — page, tokens and rooms are pastel by design — so there is no dark toggle here. A toggle that re-tinted one panel would be fake, and is not offered.</p>
        <p><strong className="text-cocoa">Seasonal decoration: not implemented.</strong> There is no seasonal theme system to toggle, so no blossom/leaf switch is offered. The cottage picture (day/night) above is the only scene choice.</p>
      </Section>

      <Section title="Sound and motion — one of each, doing what they say">
        <p>Sound in this app is exactly one thing: the Quiet Room&apos;s rain sound (generated in your browser, never autoplay). This switch gates it: with sound off, the rain control in the Quiet Room will not start.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant={sound.enabled ? 'primary' : 'quiet'} onClick={() => onSound({ ...sound, enabled: !sound.enabled })} aria-pressed={sound.enabled}>
            {sound.enabled ? 'Sound: on (tap to mute all app sound)' : 'Sound: off (tap to allow the rain sound)'}
          </Button>
        </div>
        <p>
          <label className="block">
            <span className="mb-1.5 block text-sm font-bold text-cocoa">Rain volume: {sound.volume}%{!sound.enabled ? ' (muted by the switch above)' : ''}</span>
            <input type="range" min={0} max={100} value={sound.volume} disabled={!sound.enabled}
              onChange={(e) => onSound({ ...sound, volume: Number(e.target.value) })}
              aria-label="Rain volume" className="w-full accent-[#51443d]" />
          </label>
          This device only (<code>our-place-sound-v1</code>). It drives the rain sound&apos;s WebAudio gain (volume 60 = the old fixed level), and applies when rain next starts — rain stops when you leave the Quiet Room, so there is no playing sound to retune live.
        </p>
        <p>Animation: <strong className="text-cocoa">{reduceMotionPref ? 'reduced' : 'full, following your device setting'}</strong> (this device only, key <code>our-place-reduce-motion</code>). This is the ONE reduced-motion control — the button that used to sit in “Make it yours” now points here instead of duplicating it. It collapses animations app-wide (CSS blocks) and the Quiet Room reads your system setting live as well.</p>
        <div><Button variant={reduceMotionPref ? 'primary' : 'quiet'} onClick={onToggleReduceMotion}>{reduceMotionPref ? 'Animation: reduced (tap to restore)' : 'Reduce animation'}</Button></div>
      </Section>

      <Section title="Notifications — in-app feed entries only">
        <p>There are no push or email notifications in this app, by design — no permission is ever requested, and no browser notification is ever shown. “Notifications” here mean entries in the in-app activity feed below (“What&apos;s new in your home”), and only that. Its on/off switch and per-type toggles live there, not duplicated here.</p>
        <div><Button variant="quiet" onClick={() => onScrollTo('activity-feed')}>Go to the activity feed + its toggles</Button></div>
        <p>Feed entries are titles/labels only, never bodies — and private journals, private drafts, sealed/scheduled letters and deleted items never appear there, in any view.</p>
      </Section>

      <Section title="Privacy, session and your account">
        <p>Who can see what: the full plain-words list lives below — this drawer links to it rather than restating it differently.</p>
        <div><Button variant="quiet" onClick={() => onScrollTo('privacy-legend')}>Go to “Who can see what”</Button></div>
        <p>Your current session, as the app actually knows it (nothing invented — there is no session list, device list, or “revoke other sessions” control, because no backend endpoint for one exists):</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Mode: <strong className="text-cocoa">{modeLabel}</strong></li>
          <li>Viewing as: <strong className="text-cocoa">{viewer?.displayName ?? '—'}</strong>{store.mode === 'demo' ? ' (a demo test profile on this device, not a signed-in account)' : ''}</li>
          <li>Space: <strong className="text-cocoa">{store.data.space.name || '—'}</strong> · Members: <strong className="text-cocoa">{store.data.members.length} of 2</strong></li>
          <li>Email, password and sign-in token: never displayed anywhere in this app, and never shown to your partner.</li>
        </ul>
        <p>Partner and invitation: the panel below (“Invite your partner”) is the one place for codes — permanent code plus 7-day single-use codes, and the two-member cap. This drawer does not duplicate it.</p>
        <div><Button variant="quiet" onClick={() => onScrollTo('invitation-panel')}>Go to “Invite your partner”</Button></div>
        {showPasswordForm ? (
          <><p>Password change: available below, for your own Supabase account only — it does not change your partner&apos;s password or touch any content.</p>
          <div><Button variant="quiet" onClick={() => onScrollTo('password-change')}>Go to “Change your password”</Button></div></>
        ) : store.mode === 'api' ? (
          <p><strong className="text-cocoa">Password change: not available in PostgreSQL API mode</strong> — there is no password-reset or password-change endpoint in that mode (a stated backend gap, not a hidden flow). In Supabase mode the change form appears below.</p>
        ) : (
          <p>Password change: demo mode has no account and no password, so there is nothing to change.</p>
        )}
        {onSignOut && <div><Button variant="quiet" onClick={() => void onSignOut()}>Sign out</Button></div>}
        <p><strong className="text-cocoa">Data export: not available in this app.</strong> No export path exists in the old app (verified by searching the code — there is no export file, button, or endpoint to surface). Nothing here downloads a file that pretends to be your data.</p>
        <p><strong className="text-cocoa">Account deletion: not available in this app.</strong> No account-deletion endpoint or in-app path exists, so no delete button is shown — a button that pretended to delete an account would be dangerous. What does exist: per-item deletion (every delete goes to the Deleted room first, and only a second deliberate confirmation there deletes forever), and, in demo mode only, “Clear demo content” at the foot of Settings, which wipes this device&apos;s demo data — not an account, because demo has none.</p>
      </Section>

      <Section title="Accessibility — words you can read, controls you can reach">
        <p>Text size — real scale, this device only (<code>our-place-text-size-v1</code>), applied as the page&apos;s base font size so it scales text across routes, and it survives reload:</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Choose a text size">
          {(['S', 'M', 'L', 'XL'] as const).map((s) => (
            <button key={s} type="button" onClick={() => onTextSize(s)} aria-pressed={textSize === s}
              className={`min-h-11 rounded-full border-2 px-4 py-2 text-sm font-bold ${textSize === s ? 'border-cocoa bg-butter' : 'border-cocoa/25 bg-paper'}`}>
              {s === 'S' ? 'S — smaller' : s === 'M' ? 'M — standard' : s === 'L' ? 'L — larger' : 'XL — largest'}
            </button>
          ))}
        </div>
        <p>High contrast — darker text, white paper cards, stronger borders on key surfaces (this device only, <code>our-place-contrast-v1</code>). It improves contrast where it applies; it does not re-theme every pastel tint, and the pastel identity is kept.</p>
        <div><Button variant={highContrast ? 'primary' : 'quiet'} onClick={() => onHighContrast(!highContrast)} aria-pressed={highContrast}>{highContrast ? 'High contrast: on (tap to turn off)' : 'High contrast: off (tap to turn on)'}</Button></div>
        <p>Keyboard: every route is checked for tab order, visible focus and labelled controls (see the Phase 17 report&apos;s per-route matrix). Reduced motion is the control above, in “Sound and motion”.</p>
        <p>Find something we kept: cross-room search lives in its own view — from the front-door rooms menu on Home, or here:</p>
        <div><Button variant="quiet" onClick={() => go('search')}>Open search</Button></div>
      </Section>
    </Card>
  );
}
