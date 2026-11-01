import 'dotenv/config';

function intEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  port: intEnv('PORT', 4000),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  databaseUrl: process.env.DATABASE_URL ?? '',
  frontendOrigins: (process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173')
    .split(',').map((s) => s.trim()).filter(Boolean),
  storageBackend: process.env.STORAGE_BACKEND ?? 'local',
  storageDir: process.env.STORAGE_DIR ?? './storage-dev',
  // PROPOSED, UNDECIDED (see README / spec §9): R12, R7, R4, R13.
  sessionAbsoluteDays: intEnv('SESSION_ABSOLUTE_DAYS', 30),
  sessionIdleDays: intEnv('SESSION_IDLE_DAYS', 7),
  restoreWindowDays: intEnv('RESTORE_WINDOW_DAYS', 30),
  inviteExpiryDays: intEnv('INVITE_EXPIRY_DAYS', 7),
  photoMaxMb: intEnv('PHOTO_MAX_MB', 10),
  voiceMaxMb: intEnv('VOICE_MAX_MB', 25),
};

export function requireConfig(): void {
  if (!config.databaseUrl) throw new Error('DATABASE_URL is required (see apps/api/.env.example)');
  if (config.storageBackend !== 'local') {
    // Production provider is UNDECIDED (R2). Fail fast rather than
    // silently falling back to an unapproved backend.
    throw new Error(`STORAGE_BACKEND=${config.storageBackend} is not implemented in Phase 1A; production storage provider is UNDECIDED (R2)`);
  }
}
