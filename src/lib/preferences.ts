/* Phase 17 — Device-local settings preferences.
 *
 * Every preference here is THIS-DEVICE-ONLY localStorage, never a
 * shared profile field: the profile model (id, displayName, shortName,
 * avatar preset) has no field for any of these, and no backend call is
 * made. Each key is named in Settings next to its control, so what
 * persists where is visible, not implied. Reload-persistence is tested
 * for every one (see the Phase 17 report); a preference that did not
 * survive reload would be removed, not shipped.
 *
 * Sound: the ONLY sound in the app is the Quiet Room rain sound, built
 * with WebAudio (filtered noise + a GainNode). The volume slider drives
 * that GainNode: gain = volume / 100 * 0.2, so the previous fixed gain
 * of 0.12 is exactly volume 60, the default. The slider does nothing
 * anywhere else, and it applies when rain next starts (rain stops on
 * leaving the Quiet Room, so there is no live room to retune).
 * Text size: applied as the <html> font-size (S 14 / M 16 / L 18 /
 * XL 20px). Tailwind text/spacing utilities are rem-based, so the
 * scale is real across routes, not a single-panel tint.
 * High contrast: a .high-contrast class on the app root. It darkens
 * body text, whitens paper cards and strengthens borders on the
 * surfaces it touches; it deliberately does NOT re-theme every pastel
 * tint, so the pastel identity survives. It is a contrast improvement
 * on key surfaces, not a claim of WCAG AAA everywhere. */

export interface SoundPrefs { enabled: boolean; volume: number; }
export const SOUND_PREFS_KEY = 'our-place-sound-v1';
export const DEFAULT_SOUND_PREFS: SoundPrefs = { enabled: true, volume: 60 };
/** Gain for the rain GainNode at a given volume (0–100). */
export function rainGain(volume: number): number {
  const v = Math.min(100, Math.max(0, volume));
  return (v / 100) * 0.2;
}
export function readSoundPrefs(): SoundPrefs {
  try {
    const raw = localStorage.getItem(SOUND_PREFS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<SoundPrefs>;
      if (p && typeof p.enabled === 'boolean' && typeof p.volume === 'number') {
        return { enabled: p.enabled, volume: Math.min(100, Math.max(0, Math.round(p.volume))) };
      }
    }
  } catch { /* defaults */ }
  return { ...DEFAULT_SOUND_PREFS };
}
export function saveSoundPrefs(p: SoundPrefs): void {
  try { localStorage.setItem(SOUND_PREFS_KEY, JSON.stringify(p)); } catch { /* private mode */ }
}

export type TextSize = 'S' | 'M' | 'L' | 'XL';
export const TEXT_SIZE_KEY = 'our-place-text-size-v1';
export const TEXT_SIZE_PX: Record<TextSize, number> = { S: 14, M: 16, L: 18, XL: 20 };
export function readTextSize(): TextSize {
  try {
    const v = localStorage.getItem(TEXT_SIZE_KEY);
    if (v === 'S' || v === 'M' || v === 'L' || v === 'XL') return v;
  } catch { /* default */ }
  return 'M';
}
export function saveTextSize(s: TextSize): void {
  try { localStorage.setItem(TEXT_SIZE_KEY, s); } catch { /* private mode */ }
}
/** Applies the scale to <html>; call on boot and on every change. */
export function applyTextSize(s: TextSize): void {
  try { document.documentElement.style.fontSize = `${TEXT_SIZE_PX[s]}px`; } catch { /* non-DOM */ }
}

export const CONTRAST_KEY = 'our-place-contrast-v1';
export function readHighContrast(): boolean {
  try { return localStorage.getItem(CONTRAST_KEY) === '1'; } catch { return false; }
}
export function saveHighContrast(on: boolean): void {
  try { localStorage.setItem(CONTRAST_KEY, on ? '1' : '0'); } catch { /* private mode */ }
}

/* Recent searches: device-local only, because a query itself can
 * contain private words. Never shared, never synced, one-tap clear.
 * Stored only for submitted (Enter / Search button) queries, not for
 * every keystroke, and capped at 8, newest first. */
export const RECENT_SEARCHES_KEY = 'our-place-search-recent-v1';
export function readRecentSearches(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_SEARCHES_KEY);
    if (raw) {
      const arr = JSON.parse(raw) as unknown;
      if (Array.isArray(arr)) return arr.filter((x): x is string => typeof x === 'string').slice(0, 8);
    }
  } catch { /* empty */ }
  return [];
}
export function saveRecentSearches(list: string[]): void {
  try { localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(list.slice(0, 8))); } catch { /* private mode */ }
}
export function pushRecentSearch(query: string): string[] {
  const q = query.trim().slice(0, 200);
  if (!q) return readRecentSearches();
  const next = [q, ...readRecentSearches().filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 8);
  saveRecentSearches(next);
  return next;
}
export function clearRecentSearches(): void {
  try { localStorage.removeItem(RECENT_SEARCHES_KEY); } catch { /* private mode */ }
}
