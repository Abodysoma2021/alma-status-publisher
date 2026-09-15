import type {
  LogRepository,
  MediaRepository,
  ScheduleRepository,
  SessionRepository,
  SettingsRepository,
} from '../../core/application/ports/repositories';
import type { PostLog } from '../../core/domain/entities/post-log';
import type { ScheduledPost } from '../../core/domain/entities/scheduled-post';
import { ScheduleCalculator } from '../../core/domain/services/schedule-calculator';
import type { MediaAsset } from '../../core/domain/entities/media-asset';
import { DEFAULT_SETTINGS, type AppSettings } from '../../core/domain/entities/app-settings';
import type { WhatsAppSession } from '../../core/domain/entities/whatsapp-session';
import type { Clock } from '../../core/application/ports/infrastructure';
import { JsonStore } from './json-store';

interface ListDoc<T> {
  items: T[];
}

const emptyList = (): ListDoc<never> => ({ items: [] });

/**
 * JSON-file backed repositories. Entities are cloned on read/write so callers
 * can never mutate repository state in place.
 */
function clone<T>(value: T): T {
  return structuredClone(value);
}

export class JsonSessionRepository implements SessionRepository {
  private store: JsonStore<ListDoc<WhatsAppSession>>;

  constructor(filePath: string) {
    this.store = new JsonStore<ListDoc<WhatsAppSession>>(filePath, emptyList);
  }

  async list(): Promise<WhatsAppSession[]> {
    return clone((await this.store.load()).items);
  }

  async get(id: string): Promise<WhatsAppSession | undefined> {
    const found = (await this.store.load()).items.find((s) => s.id === id);
    return found ? clone(found) : undefined;
  }

  async save(session: WhatsAppSession): Promise<void> {
    const doc = await this.store.load();
    // qrCode/pairingCode persist too: the renderer polls listSessions to
    // display the live QR while linking.
    const idx = doc.items.findIndex((s) => s.id === session.id);
    if (idx >= 0) doc.items[idx] = session;
    else doc.items.push(session);
    this.store.set(doc);
  }

  async delete(id: string): Promise<void> {
    const doc = await this.store.load();
    doc.items = doc.items.filter((s) => s.id !== id);
    this.store.set(doc);
  }

  async flush(): Promise<void> {
    await this.store.flush().catch(() => undefined);
  }
}

export class JsonScheduleRepository implements ScheduleRepository {
  private store: JsonStore<ListDoc<ScheduledPost>>;

  constructor(
    filePath: string,
    private clock: Clock,
  ) {
    this.store = new JsonStore<ListDoc<ScheduledPost>>(filePath, emptyList);
  }

  async list(): Promise<ScheduledPost[]> {
    return clone((await this.store.load()).items);
  }

  async get(id: string): Promise<ScheduledPost | undefined> {
    const found = (await this.store.load()).items.find((s) => s.id === id);
    return found ? clone(found) : undefined;
  }

  async save(post: ScheduledPost): Promise<void> {
    const doc = await this.store.load();
    const idx = doc.items.findIndex((s) => s.id === post.id);
    if (idx >= 0) doc.items[idx] = post;
    else doc.items.push(post);
    this.store.set(doc);
  }

  async delete(id: string): Promise<void> {
    const doc = await this.store.load();
    doc.items = doc.items.filter((s) => s.id !== id);
    this.store.set(doc);
  }

  private async filter(pred: (p: ScheduledPost, now: Date) => boolean): Promise<ScheduledPost[]> {
    const now = this.clock.now();
    return (await this.list()).filter((p) => pred(p, now));
  }

  findDue(now: Date): Promise<ScheduledPost[]> {
    return this.filter((p) => ScheduleCalculator.isDue(p, now));
  }

  findMissed(now: Date): Promise<ScheduledPost[]> {
    return this.filter((p) => ScheduleCalculator.isMissedRun(p, now));
  }

  findStale(now: Date): Promise<ScheduledPost[]> {
    return this.filter((p) => ScheduleCalculator.isStaleRun(p, now));
  }

  async flush(): Promise<void> {
    await this.store.flush().catch(() => undefined);
  }
}

export class JsonLogRepository implements LogRepository {
  private store: JsonStore<ListDoc<PostLog>>;

  constructor(
    filePath: string,
    private readonly maxEntries = 2000,
  ) {
    this.store = new JsonStore<ListDoc<PostLog>>(filePath, emptyList);
  }

  async list(filter?: { state?: PostLog['state'] }): Promise<PostLog[]> {
    const items = (await this.store.load()).items;
    const filtered = filter?.state ? items.filter((l) => l.state === filter.state) : items;
    return clone([...filtered].sort((a, b) => b.startedAt - a.startedAt));
  }

  async get(id: string): Promise<PostLog | undefined> {
    const found = (await this.store.load()).items.find((l) => l.id === id);
    return found ? clone(found) : undefined;
  }

  async save(log: PostLog): Promise<void> {
    const doc = await this.store.load();
    const idx = doc.items.findIndex((l) => l.id === log.id);
    if (idx >= 0) doc.items[idx] = log;
    else doc.items.push(log);
    this.store.set(doc);
  }

  async delete(id: string): Promise<void> {
    const doc = await this.store.load();
    doc.items = doc.items.filter((l) => l.id !== id);
    this.store.set(doc);
  }

  async deleteBySchedule(scheduleId: string): Promise<void> {
    const doc = await this.store.load();
    doc.items = doc.items.filter((l) => l.scheduleId !== scheduleId);
    this.store.set(doc);
  }

  async prune(keepCount: number): Promise<void> {
    const doc = await this.store.load();
    if (doc.items.length <= Math.min(keepCount, this.maxEntries)) return;
    doc.items.sort((a, b) => b.startedAt - a.startedAt);
    doc.items = doc.items.slice(0, Math.min(keepCount, this.maxEntries));
    this.store.set(doc);
  }

  async flush(): Promise<void> {
    await this.store.flush().catch(() => undefined);
  }
}

export class JsonMediaRepository implements MediaRepository {
  private store: JsonStore<ListDoc<MediaAsset>>;

  constructor(filePath: string) {
    this.store = new JsonStore<ListDoc<MediaAsset>>(filePath, emptyList);
  }

  async list(): Promise<MediaAsset[]> {
    return clone((await this.store.load()).items);
  }

  async get(id: string): Promise<MediaAsset | undefined> {
    const found = (await this.store.load()).items.find((m) => m.id === id);
    return found ? clone(found) : undefined;
  }

  async save(asset: MediaAsset): Promise<void> {
    const doc = await this.store.load();
    const idx = doc.items.findIndex((m) => m.id === asset.id);
    if (idx >= 0) doc.items[idx] = asset;
    else doc.items.push(asset);
    this.store.set(doc);
  }

  async delete(id: string): Promise<void> {
    const doc = await this.store.load();
    doc.items = doc.items.filter((m) => m.id !== id);
    this.store.set(doc);
  }

  async flush(): Promise<void> {
    await this.store.flush().catch(() => undefined);
  }
}

export class JsonSettingsRepository implements SettingsRepository {
  private store: JsonStore<AppSettings>;

  constructor(filePath: string) {
    this.store = new JsonStore<AppSettings>(filePath, () => ({ ...DEFAULT_SETTINGS }));
  }

  async load(): Promise<AppSettings> {
    const loaded = await this.store.load();
    return { ...DEFAULT_SETTINGS, ...loaded };
  }

  async save(settings: AppSettings): Promise<void> {
    this.store.set({ ...settings });
  }
}

