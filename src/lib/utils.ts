export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function todayIsoDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** Invite codes are short, unambiguous (no 0/O, 1/I) and checked server-side too. */
export function makeInviteCode(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export function isSealed(letter: { visibility: string; revealAt: string | null; authorId: string }, viewerId: string, now = new Date()): boolean {
  if (letter.visibility !== 'scheduled') return false;
  if (letter.authorId === viewerId) return false;
  if (!letter.revealAt) return false;
  return new Date(letter.revealAt).getTime() > now.getTime();
}

/** Deterministic stars so the sky does not reshuffle on every render. */
export function stars(count = 90): { left: number; top: number; size: number; delay: number; duration: number }[] {
  let seed = 42;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  return Array.from({ length: count }, () => ({
    left: rand() * 100,
    top: rand() * 62,
    size: rand() < 0.85 ? 1 + rand() * 1.6 : 2.5,
    delay: rand() * 6,
    duration: 3 + rand() * 5,
  }));
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Could not read that file.'));
    r.readAsDataURL(file);
  });
}

export function validateRequired(value: string, label: string, max = 5000): string | null {
  const v = value.trim();
  if (!v) return `${label} is needed before saving.`;
  if (v.length > max) return `${label} is too long (max ${max} characters).`;
  return null;
}
