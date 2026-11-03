import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';

/* Animated introduction (design-system phase): a first-visit screen,
   shown in place of Home only — never a modal dialog (no role="dialog",
   no aria-modal, no backdrop, no focus trap), never a forced sequence,
   never a task list. It carries exactly the supplied lines: the title,
   the supporting line, an "Enter our world" button, and a "Skip intro"
   control. Nothing else is claimed here — no slogans, no feature lists.

   Dismissal: BOTH Enter and Skip set 'our-place-intro-seen' (via the
   App-level onDismiss) and reveal Home. The key is deliberately
   distinct from the welcome card's 'our-place-welcome-dismissed' key,
   so each dismissal is independent: entering past the introduction
   never hides the WelcomeCard, which keeps its own dismissal.

   Reduced motion: the system preference comes from useReducedMotion
   (the same pattern as Home and Page — the CSS reduced-motion blocks
   cannot stop Motion's JS-driven animation, so the entrance is skipped
   entirely instead). The Settings "Reduce animation" preference is read
   directly from localStorage here, because App only refreshes its own
   copy of that preference while the Settings room is open; reading the
   key covers a first Home landing before Settings has ever been visited.
   The App shell also adds the .reduce-motion class, which collapses any
   CSS transition on this screen as a third layer. When reduced, every
   element below renders statically (initial={false}) — same markup,
   no animation. */

export const INTRO_KEY = 'our-place-intro-seen';

export function Introduction({ onDismiss }: { onDismiss: () => void }) {
  const systemReduced = useReducedMotion();
  const [prefReduced] = useState(() => {
    try { return localStorage.getItem('our-place-reduce-motion') === '1'; } catch { return false; }
  });
  const reduced = systemReduced || prefReduced;

  // The Enter button is autofocused on mount, so keyboard users land on
  // the primary action immediately. Both buttons are native <button>
  // elements with no outline:none anywhere, so the global :focus-visible
  // rule in index.css draws their focus ring.
  const enterRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { enterRef.current?.focus(); }, []);

  // Escape dismisses exactly like Skip — the screen is always escapable.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onDismiss(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  // Gentle fade/rise only: 700ms (the --duration-slow token) on the
  // --ease-soft curve, staggered title → line → motif strip → actions.
  // The whole screen is compact by design — title, line, one motif
  // strip, two buttons and one short hint — so Skip stays visible
  // without scrolling on desktop and at 390px widths, with room for
  // the fixed bottom navigation (pb-28) underneath.
  const rise = (delay: number) => ({
    initial: reduced ? false : { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.7, delay: reduced ? 0 : delay, ease: [0.22, 0.61, 0.36, 1] as const },
  });

  return (
    <section aria-label="Introduction to your little world" className="mx-auto flex min-h-[100svh] w-full max-w-5xl flex-col justify-center px-4 pb-28 pt-6 sm:px-6">
      <div className="paper-card rounded-plate px-5 py-8 text-center shadow-plate sm:px-8">
        <span aria-hidden="true" className="washi washi-rose" />
        <motion.h1 {...rise(0)} className="font-serif-display text-4xl leading-[1.05] text-cocoa sm:text-5xl">
          A Little Place Called Us
        </motion.h1>
        <motion.p {...rise(0.15)} className="font-serif-display mt-4 text-xl leading-relaxed text-plum sm:text-2xl">
          Made with love. Filled by both of us.
        </motion.p>
        {/* Garden-path motif strip, decorative only (aria-hidden): a
            dashed path with flowers and stars, built from the shared
            motif classes — no new shapes, no controls, no data. */}
        <motion.div {...rise(0.3)} aria-hidden="true" className="mx-auto mt-6 flex w-full max-w-xs items-end gap-2">
          <span className="motif-collectible mb-2 h-9 w-9 bg-cottage-butter text-lg">★</span>
          <span className="motif-path">
            <span className="motif-dot" style={{ left: '12%', background: '#f6b8c9' }}>✿</span>
            <span className="motif-dot" style={{ left: '48%', background: '#fdf0b8' }}>✦</span>
            <span className="motif-dot" style={{ left: '82%', background: '#d8c6ee' }}>✿</span>
          </span>
          <span className="motif-collectible mb-2 h-9 w-9 bg-cottage-pink text-lg">✿</span>
        </motion.div>
        <motion.div {...rise(0.45)} className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <button ref={enterRef} type="button" onClick={onDismiss}
            className="min-h-11 rounded-chip bg-cocoa px-6 py-2 text-sm font-bold text-cream shadow-chip hover:bg-[#42382f]">
            Enter our world
          </button>
          <button type="button" onClick={onDismiss}
            className="min-h-11 rounded-chip border border-cocoa/30 bg-paper px-6 py-2 text-sm font-bold text-cocoa hover:bg-cream-deep">
            Skip intro
          </button>
        </motion.div>
        <p className="mt-3 text-xs text-cocoa-soft">Skip any time — bring it back from Settings.</p>
      </div>
    </section>
  );
}
