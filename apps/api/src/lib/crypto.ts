import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
export function randomToken(bytes = 32): string {
  // 256-bit token (well above the spec's 128-bit minimum for invitations).
  return randomBytes(bytes).toString('hex');
}
export function hashEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// Passwords: Argon2id is the PROPOSED default (spec §4.1). If the
// native argon2 module cannot load in an environment, the documented
// fallback is bcrypt cost 12 — recorded, not silent, via the
// PASSWORD_HASHER env note in the API README.
let argon2: typeof import('argon2') | null = null;
let argon2Tried = false;
async function loadArgon2() {
  if (argon2Tried) return argon2;
  argon2Tried = true;
  try {
    argon2 = await import('argon2');
  } catch {
    argon2 = null;
  }
  return argon2;
}
export async function passwordHasherName(): Promise<'argon2id' | 'bcrypt'> {
  return (await loadArgon2()) ? 'argon2id' : 'bcrypt';
}
export async function hashPassword(password: string): Promise<string> {
  const a = await loadArgon2();
  if (a) return a.hash(password, { type: a.argon2id });
  const bcrypt = (await import('bcryptjs')).default;
  return bcrypt.hash(password, 12);
}
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  if (hash.startsWith('$argon2')) {
    const a = await loadArgon2();
    if (!a) return false;
    try {
      return await a.verify(hash, password);
    } catch {
      return false;
    }
  }
  const bcrypt = (await import('bcryptjs')).default;
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}
