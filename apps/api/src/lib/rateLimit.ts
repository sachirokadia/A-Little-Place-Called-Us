import { createHash } from 'node:crypto';
import { prisma } from '../db.js';
import { rateLimited } from '../errors.js';

// PROPOSED, UNDECIDED (R11). Numbers are env-configurable in spirit
// via the constants below; they are NOT decided product rules.
export const RATE_LIMITS = {
  loginPerIp: { limit: 5, windowMs: 15 * 60 * 1000 },
  loginPerAccount: { limit: 5, windowMs: 15 * 60 * 1000 },
  registerPerIp: { limit: 10, windowMs: 60 * 60 * 1000 },
  joinPerIp: { limit: 10, windowMs: 60 * 60 * 1000 },
  generalPerUser: { limit: 300, windowMs: 60 * 1000 },
  uploadPerUser: { limit: 20, windowMs: 60 * 60 * 1000 },
} as const;

function ipHash(ip: string | undefined): string {
  return createHash('sha256').update(ip ?? 'unknown').digest('hex').slice(0, 16);
}

export async function checkRateLimit(key: string, limit: number, windowMs: number): Promise<void> {
  const now = new Date();
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const row = await prisma.rateLimitBucket.upsert({
    where: { key_windowStart: { key, windowStart } },
    update: { count: { increment: 1 } },
    create: { key, windowStart, count: 1 },
  });
  if (row.count > limit) throw rateLimited();
}

export async function getRateLimitCount(key: string, windowMs: number): Promise<number> {
  const now = new Date();
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const row = await prisma.rateLimitBucket.findUnique({ where: { key_windowStart: { key, windowStart } } });
  return row?.count ?? 0;
}

export async function incrementRateLimit(key: string, windowMs: number): Promise<void> {
  const now = new Date();
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  await prisma.rateLimitBucket.upsert({
    where: { key_windowStart: { key, windowStart } },
    update: { count: { increment: 1 } },
    create: { key, windowStart, count: 1 },
  });
}

export function loginIpKey(ip: string | undefined): string {
  return `login:ip:${ipHash(ip)}`;
}
export function loginAccountKey(emailLower: string): string {
  return `login:account:${emailLower}`;
}
export function registerIpKey(ip: string | undefined): string {
  return `register:ip:${ipHash(ip)}`;
}
export function joinIpKey(ip: string | undefined): string {
  return `join:ip:${ipHash(ip)}`;
}
export function userKey(userId: string): string {
  return `general:user:${userId}`;
}
export function uploadUserKey(userId: string): string {
  return `upload:user:${userId}`;
}
