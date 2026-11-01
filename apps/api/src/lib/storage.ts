import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { config } from '../config.js';

// DEV ONLY storage backend. The production provider is UNDECIDED (R2).
// Storage keys never contain emails, display names, or original filenames.
export interface StorageBackend {
  put(key: string, data: Buffer): Promise<void>;
  stream(key: string): Promise<Readable>;
  remove(key: string): Promise<void>;
}

class LocalStorageBackend implements StorageBackend {
  private dir: string;
  constructor(dir: string) {
    this.dir = resolve(dir);
  }
  private pathFor(key: string): string {
    if (key.includes('/') || key.includes('..') || key.includes(sep)) {
      throw new Error('Invalid storage key');
    }
    return join(this.dir, key);
  }
  async put(key: string, data: Buffer): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await new Promise<void>((resolvePromise, reject) => {
      const ws = createWriteStream(this.pathFor(key));
      ws.on('error', reject);
      ws.on('finish', () => resolvePromise());
      ws.end(data);
    });
  }
  async stream(key: string): Promise<Readable> {
    await stat(this.pathFor(key));
    return createReadStream(this.pathFor(key));
  }
  async remove(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }
}

export function storage(): StorageBackend {
  if (config.storageBackend !== 'local') throw new Error('Only the dev-only local storage backend is implemented in Phase 1A (R2 UNDECIDED)');
  return new LocalStorageBackend(config.storageDir);
}
