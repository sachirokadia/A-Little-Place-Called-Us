import { useState, type ReactNode } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import type { RoomId } from '../lib/types';
import { RoomIdentity } from './RoomIdentity';

/* Shared scrapbook components (Phase 1 visual foundation). All room logic
   stays untouched — only the surfaces change: paper cards, washi tape,
   warm-brown controls, DM Serif Display titles, DM Sans interface text. */

export function Washi({ tone = 'sage' }: { tone?: 'sage' | 'rose' | 'butter' | 'powder' | 'lilac' }) {
  return <span aria-hidden="true" className={`washi washi-${tone}`} />;
}

export function Page({ title, subtitle, intro, homeLabel, homeAriaLabel, children, actions, identity }: { title: string; subtitle?: string; intro?: string; homeLabel?: string; homeAriaLabel?: string; children: ReactNode; actions?: ReactNode; identity?: RoomId }) {
  // Phase 8 audit fix: the CSS reduced-motion block cannot stop Motion's
  // JS-driven fade, so skip the entrance animation entirely when the
  // user prefers reduced motion. No visual change otherwise.
  const reduceMotion = useReducedMotion();
  return (
    <motion.main initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}
      className="mx-auto w-full max-w-5xl px-4 pb-32 pt-6 sm:px-6 sm:pt-8">
      {/* Shared room template (Phase 2): every room page offers the same
          working way back. Hash routing keeps this in sync with the
          browser back button, so a direct visit still lands on Home. */}
      <div className="mb-4">
        {/* STORYBOOK WORLDS: Arcade and Search pass a cottage return label
            so going home reads as returning to the cottage, not as a
            generic browser back step. Every other Page keeps its
            existing label; the destination (home) is unchanged. */}
        <Button variant="quiet" onClick={() => { location.hash = 'home'; }} ariaLabel={homeAriaLabel ?? 'Back to home'}>{homeLabel ?? '← Back to Home'}</Button>
      </div>
      {/* Phase 11: each room opens with its own decorative identity strip,
          so rooms no longer share an identical top. Decorative only. */}
      {identity && identity !== 'home' && <RoomIdentity room={identity} />}
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif-display text-3xl leading-tight text-cocoa sm:text-4xl">{title}</h1>
          {intro && <p className="page-intro" data-testid="world-intro">{intro}</p>}
          {subtitle && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-cocoa-soft sm:text-base">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </header>
      {children}
    </motion.main>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  // Parchment card on the cream page ground; text is warm brown throughout.
  return <section className={`paper-card rounded-card p-4 text-cocoa sm:p-5 ${className}`}>{children}</section>;
}

export function Empty({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="rounded-card border border-dashed border-cocoa/30 bg-paper px-5 py-10 text-center">
      <p className="font-serif-display text-xl text-cocoa">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-cocoa-soft">{body}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function Button({ children, onClick, variant = 'primary', type = 'button', disabled = false, ariaLabel }: {
  children: ReactNode; onClick?: () => void; variant?: 'primary' | 'quiet' | 'danger' | 'gold-outline';
  type?: 'button' | 'submit'; disabled?: boolean; ariaLabel?: string;
}) {
  const styles = {
    // Phase 1 primary: solid warm brown, cream text, soft shadow only.
    primary: 'bg-cocoa text-cream shadow-chip hover:bg-[#42382f]',
    // Parchment chip for secondary actions, on cream or on paper cards.
    quiet: 'border border-cocoa/30 bg-paper text-cocoa hover:bg-cream-deep',
    danger: 'bg-[#a85a5a] text-cream hover:bg-[#965050]',
    'gold-outline': 'border border-[#8a6d4b] text-[#8a6d4b] hover:bg-butter',
  }[variant];
  return (
    <button type={type} onClick={onClick} disabled={disabled} aria-label={ariaLabel}
      className={`btn-motion min-h-11 rounded-full px-4 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${styles}`}>
      {children}
    </button>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="field-label mb-1.5 block text-sm font-bold text-cocoa">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-cocoa-soft">{hint}</span>}
    </label>
  );
}

export const inputCls = 'w-full rounded-note border border-cocoa/25 bg-paper px-3 py-2.5 text-sm text-cocoa placeholder:text-cocoa/40 focus:border-plum focus:outline-none';

export function Toast({ message, kind }: { message: string; kind: 'ok' | 'error' }) {
  if (!message) return null;
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} aria-live="polite"
      className={`fixed bottom-28 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-note px-4 py-3 text-center text-sm font-semibold shadow-xl ring-1 ${kind === 'error' ? 'bg-rose text-cocoa ring-rose-deep' : 'bg-paper text-cocoa ring-cocoa/20'}`}>
      {message}
    </div>
  );
}

export function ConfirmDelete({ onConfirm, label = 'Delete', note, confirmLabel }: { onConfirm: () => void; label?: string; note?: string; confirmLabel?: string }) {
  const [armed, setArmed] = useState(false);
  if (!armed) return <Button variant="quiet" onClick={() => setArmed(true)}>{label}</Button>;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="text-xs text-cocoa-soft">{note ?? 'This moves it to Deleted, where it can be restored. Continue?'}</span>
      <Button variant="danger" onClick={onConfirm}>{confirmLabel ?? 'Yes, move to Deleted'}</Button>
      <Button variant="quiet" onClick={() => setArmed(false)}>Keep it</Button>
    </span>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <AnimatePresence>
      <motion.div className="fixed inset-0 z-40 flex items-end justify-center bg-cocoa/50 p-0 sm:items-center sm:p-6"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} role="presentation">
        <motion.div role="dialog" aria-modal="true" aria-label={title}
          className="paper-card max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-card p-5 sm:rounded-card"
          initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 24, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}>
          <div className="mb-4 flex items-start justify-between gap-3">
            <h2 className="font-serif-display text-2xl text-cocoa">{title}</h2>
            <button onClick={onClose} aria-label="Close" className="rounded-full border border-cocoa/25 px-3 py-1 text-sm font-bold">Close</button>
          </div>
          {children}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export function FavoriteButton({ active, onToggle, label }: { active: boolean; onToggle: () => void; label: string }) {
  return (
    <button onClick={onToggle} aria-label={label} aria-pressed={active} title={label}
      className={`rounded-chip border px-3 py-1 text-sm font-bold transition ${active ? 'border-[#a85a5a] bg-rose text-cocoa' : 'border-cocoa/25 text-cocoa-soft hover:bg-cream-deep'}`}>
      {active ? '♥ Saved' : '♡ Save'}
    </button>
  );
}

/* Phase 11 avatar choices: preset stickers only, taken from the cottage
   picture's animals and garden (bunny, fox, cat, hedgehog, frog, duck).
   The stored value is always one of these keys — never a file path the
   client invents — and it is written to the existing avatar_path column
   in both databases. 'initial' is the previous behaviour: a letter. */
export const AVATAR_OPTIONS = [
  { key: 'initial', label: 'Initial letter', symbol: '' },
  { key: 'bunny', label: 'Bunny', symbol: '🐰' },
  { key: 'fox', label: 'Fox', symbol: '🦊' },
  { key: 'cat', label: 'Cat', symbol: '🐱' },
  { key: 'hedgehog', label: 'Hedgehog', symbol: '🦔' },
  { key: 'frog', label: 'Frog', symbol: '🐸' },
  { key: 'duck', label: 'Duck', symbol: '🦆' },
  { key: 'flower', label: 'Flower', symbol: '🌸' },
  { key: 'star', label: 'Star', symbol: '⭐' },
] as const;
export type AvatarKey = (typeof AVATAR_OPTIONS)[number]['key'];
export function avatarSymbol(key?: string): string {
  return AVATAR_OPTIONS.find((a) => a.key === key)?.symbol ?? '';
}

/** Two partner avatars: initials, or the chosen sticker, in pastel circles, overlapping like a scrapbook sticker. */
export function AvatarPair({ names, avatars }: { names: string[]; avatars?: (string | undefined)[] }) {
  const tones = ['bg-sage', 'bg-rose'];
  return (
    <div className="flex items-center" aria-label={`Partners: ${names.join(' and ')}`}>
      {names.slice(0, 2).map((n, i) => {
        const symbol = avatarSymbol(avatars?.[i]);
        return (
          <span key={i} aria-hidden="true"
            className={`flex h-10 w-10 items-center justify-center rounded-chip border-2 border-cream text-sm font-extrabold text-cocoa shadow ${tones[i]} ${i === 1 ? '-ml-3' : ''}`}>
            {symbol || (n || '?').trim().charAt(0).toUpperCase()}
          </span>
        );
      })}
      <span className="ml-2 text-sm font-bold text-cocoa">{names.join(' & ')}</span>
    </div>
  );
}
