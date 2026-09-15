import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Tiny durable JSON file store.
 * - debounced atomic writes (tmp file + rename) to survive crashes
 * - corruption recovery: falls back to `.bak`, then empty
 * - per-file write queue to avoid interleaved saves
 */
export class JsonStore<T> {
  private data: T | undefined;
  private loaded = false;
  private writeTimer?: NodeJS.Timeout;
  private queue: Promise<void> = Promise.resolve();
  private pendingFlush?: Promise<void>;

  constructor(
    private readonly filePath: string,
    private readonly empty: () => T,
  ) {}

  async load(): Promise<T> {
    if (this.loaded) return this.data as T;
    this.data = await this.readFromDisk();
    this.loaded = true;
    return this.data;
  }

  /** Immediate cached read (after first load). */
  get(): T {
    if (!this.loaded) throw new Error(`JsonStore not loaded yet: ${this.filePath}`);
    return this.data as T;
  }

  set(next: T): void {
    this.data = next;
    this.loaded = true;
    this.scheduleWrite();
  }

  /** Debounced persist (400ms). */
  private scheduleWrite(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => this.flush(), 400);
    this.writeTimer.unref?.();
  }

  flush(): Promise<void> {
    this.pendingFlush ??= new Promise<void>((resolve) => {
      this.queue = this.queue.then(async () => {
        try {
          if (this.writeTimer) clearTimeout(this.writeTimer);
          this.writeTimer = undefined;
          if (this.data !== undefined) await this.writeToDisk(this.data);
        } finally {
          this.pendingFlush = undefined;
          resolve();
        }
      });
    });
    return this.pendingFlush;
  }

  private async readFromDisk(): Promise<T> {
    const empty = this.empty();
    try {
      const raw = await fsp.readFile(this.filePath, 'utf8');
      return JSON.parse(raw) as T;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return empty;
      // Corrupted file — try the backup before giving up.
      try {
        const backup = await fsp.readFile(`${this.filePath}.bak`, 'utf8');
        return JSON.parse(backup) as T;
      } catch {
        return empty;
      }
    }
  }

  private async writeToDisk(data: T): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fsp.mkdir(dir, { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    const serialized = JSON.stringify(data, null, 2);

    // Keep the last good version as backup.
    try {
      await fsp.copyFile(this.filePath, `${this.filePath}.bak`);
    } catch {
      /* first write — no backup yet */
    }

    await fsp.writeFile(tmp, serialized, 'utf8');
    await fsp.rename(tmp, this.filePath);
  }

  static exists(p: string): boolean {
    return fs.existsSync(p);
  }
}
