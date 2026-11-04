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

/** Upload validation, mirrored by the server (multer type filter + 25 MB cap).
 *  A file input's accept attribute is only a hint — this check is the gate. */
export function validateImageFile(file: File): string | null {
  if (!file.type.startsWith('image/')) return 'That file is not an image. Please choose a photo.';
  if (file.size > 25 * 1024 * 1024) return 'That photo is over 25 MB. Please choose a smaller one.';
  return null;
}

/** File-signature (magic-byte) check, by extension. This is defense-in-depth for the
 *  UI upload path only: a browser check can always be bypassed by calling Storage or
 *  the API directly, so it never replaces the server/policy checks (Storage extension
 *  policy in migration 0009, API server signature check in server/index.js). What it
 *  does catch, in the normal path, is a spoofed file — e.g. HTML renamed to .png with
 *  an image/png MIME type — whose first bytes are not a real image/audio signature.
 *  Returns an error string, or null when the signature matches the extension. */
export async function validateMediaSignature(file: File, ext: string): Promise<string | null> {
  let buf: ArrayBuffer;
  try { buf = await file.slice(0, 12).arrayBuffer(); } catch { return 'That file could not be read. Please try again.'; }
  const b = new Uint8Array(buf);
  const ascii = (at: number, len: number) => String.fromCharCode(...b.slice(at, at + len));
  const sigMismatch = 'That file does not match its extension. Please choose a real photo or audio file.';
  if (b.length < 4) return sigMismatch;
  switch (ext) {
    case 'png': return (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) ? null : sigMismatch;
    case 'jpg': case 'jpeg': return (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) ? null : sigMismatch;
    case 'gif': return ascii(0, 4) === 'GIF8' ? null : sigMismatch;
    case 'webp': return (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') ? null : sigMismatch;
    case 'avif': return (ascii(4, 4) === 'ftyp' && ['avif', 'avis', 'av01'].includes(ascii(8, 4))) ? null : sigMismatch;
    case 'mp3': return (ascii(0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) ? null : sigMismatch;
    case 'wav': return (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE') ? null : sigMismatch;
    case 'ogg': return ascii(0, 4) === 'OggS' ? null : sigMismatch;
    case 'm4a': return ascii(4, 4) === 'ftyp' ? null : sigMismatch;
    case 'webm': return (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) ? null : sigMismatch;
    default: return sigMismatch;
  }
}

export function parseTags(input: string): string[] {
  return input.split(',').map((t) => t.trim().slice(0, 50)).filter(Boolean).slice(0, 10);
}

export function validateRequired(value: string, label: string, max = 5000): string | null {
  const v = value.trim();
  if (!v) return `${label} is needed before saving.`;
  if (v.length > max) return `${label} is too long (max ${max} characters).`;
  return null;
}
