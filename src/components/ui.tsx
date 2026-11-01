import { useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';

/* Shared scrapbook components. All room logic stays untouched — only the
   surfaces change: paper cards, washi tape, warm-brown controls, serif titles. */

export function Washi({ tone = 'sage' }: { tone?: 'sage' | 'rose' | 'butter' | 'powder' | 'lilac' }) {
  return <span aria-hidden="true" className={`washi washi-${tone}`} />;
}

export function HandNote({ children }: { children: ReactNode }) {
  return <p className="font-hand text-2xl leading-snug text-plum">{children}</p>;
}

export function Page({ title, subtitle, children, actions }: { title: string; subtitle?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <motion.main initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}
      className="mx-auto w-full max-w-5xl px-4 pb-32 pt-6 sm:px-6 sm:pt-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif-display text-3xl leading-tight text-[#f8f1e7] drop-shadow-[0_2px_10px_rgba(0,0,0,0.45)] sm:text-4xl">{title}</h1>
          {subtitle && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#d8d2c4] sm:text-base">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </header>
      {children}
    </motion.main>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  // Parchment dialog over the night world: the card sets its own dark text
  // so room content never inherits the night body's cream text color.
  return <section className={`paper-card rounded-3xl p-4 text-cocoa sm:p-5 ${className}`}>{children}</section>;
}

export function Empty({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="rounded-3xl border border-dashed border-cocoa/30 bg-paper px-5 py-10 text-center">
      <p className="font-serif-display text-xl text-cocoa">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-cocoa-soft">{body}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function Button({ children, onClick, variant = 'primary', type = 'button', disabled = false, ariaLabel }: {
  children: ReactNode; onClick?: () => void; variant?: 'primary' | 'quiet' | 'danger' | 'gold-outline' | 'night-quiet';
  type?: 'button' | 'submit'; disabled?: boolean; ariaLabel?: string;
}) {
  const styles = {
    // Game gold: warm window-light button, dark text — the primary action everywhere.
    primary: 'bg-[#e8c87a] text-[#241d12] shadow-[0_4px_14px_rgba(232,200,122,0.35)] hover:bg-[#f2d894]',
    // Parchment chip: readable on BOTH the night background (page headers,
    // settings) and paper cards (room content) — quiet buttons live in both.
    quiet: 'border border-[#e8c87a]/60 bg-[#fffdf8] text-cocoa hover:bg-cream-deep',
    danger: 'bg-[#a85a5a] text-cream hover:bg-[#965050]',
    'gold-outline': 'border border-[#8a6d4b] text-[#8a6d4b] hover:bg-butter',
    // For buttons sitting directly on the night background (auth forms): light text.
    'night-quiet': 'border border-white/30 bg-transparent text-[#f8f1e7] hover:bg-white/10',
  }[variant];
  return (
    <button type={type} onClick={onClick} disabled={disabled} aria-label={ariaLabel}
      className={`min-h-11 rounded-full px-4 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${styles}`}>
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

export const inputCls = 'w-full rounded-2xl border border-cocoa/25 bg-paper px-3 py-2.5 text-sm text-cocoa placeholder:text-cocoa/40 focus:border-plum focus:outline-none';

export function Toast({ message, kind }: { message: string; kind: 'ok' | 'error' }) {
  if (!message) return null;
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} aria-live="polite"
      className={`fixed bottom-28 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-2xl px-4 py-3 text-center text-sm font-semibold shadow-xl ring-1 ${kind === 'error' ? 'bg-[#3a2027] text-[#f8f1e7] ring-[#a85a5a]' : 'bg-[#1d2a4a] text-[#f8f1e7] ring-[#e8c87a]/60'}`}>
      {message}
    </div>
  );
}

export function ConfirmDelete({ onConfirm, label = 'Delete' }: { onConfirm: () => void; label?: string }) {
  const [armed, setArmed] = useState(false);
  if (!armed) return <Button variant="quiet" onClick={() => setArmed(true)}>{label}</Button>;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="text-xs text-cocoa-soft">This moves it to Deleted, where it can be restored. Continue?</span>
      <Button variant="danger" onClick={onConfirm}>Yes, move to Deleted</Button>
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
          className="paper-card max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-3xl p-5 sm:rounded-3xl"
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
      className={`rounded-full border px-3 py-1 text-sm font-bold transition ${active ? 'border-[#a85a5a] bg-rose text-cocoa' : 'border-cocoa/25 text-cocoa-soft hover:bg-cream-deep'}`}>
      {active ? '♥ Saved' : '♡ Save'}
    </button>
  );
}

/** Two partner avatars: initials in pastel circles, overlapping like a scrapbook sticker. */
export function AvatarPair({ names }: { names: string[] }) {
  const tones = ['bg-sage', 'bg-rose'];
  return (
    <div className="flex items-center" aria-label={`Partners: ${names.join(' and ')}`}>
      {names.slice(0, 2).map((n, i) => (
        <span key={i} aria-hidden="true"
          className={`flex h-10 w-10 items-center justify-center rounded-full border-2 border-cream text-sm font-extrabold text-cocoa shadow ${tones[i]} ${i === 1 ? '-ml-3' : ''}`}>
          {(n || '?').trim().charAt(0).toUpperCase()}
        </span>
      ))}
      <span className="ml-2 text-sm font-bold text-cocoa">{names.join(' & ')}</span>
    </div>
  );
}
