import type { MediaAsset } from '../../domain/entities/media-asset';
import type { PostLog } from '../../domain/entities/post-log';
import type { ScheduledPost } from '../../domain/entities/scheduled-post';
import type { AppSettings } from '../../domain/entities/app-settings';
import type { WhatsAppSession } from '../../domain/entities/whatsapp-session';

/**
 * Persistence ports. The application layer defines WHAT it needs to store;
 * infrastructure decides HOW (here: JSON files in the user-data folder).
 */

export interface SessionRepository {
  list(): Promise<WhatsAppSession[]>;
  get(id: string): Promise<WhatsAppSession | undefined>;
  save(session: WhatsAppSession): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface ScheduleRepository {
  list(): Promise<ScheduledPost[]>;
  get(id: string): Promise<ScheduledPost | undefined>;
  save(post: ScheduledPost): Promise<void>;
  delete(id: string): Promise<void>;
  /** Schedules that are enabled and due at `now` (exclusive of already running). */
  findDue(now: Date): Promise<ScheduledPost[]>;
  findMissed(now: Date): Promise<ScheduledPost[]>;
  findStale(now: Date): Promise<ScheduledPost[]>;
}

export interface LogRepository {
  list(filter?: { state?: PostLog['state'] }): Promise<PostLog[]>;
  get(id: string): Promise<PostLog | undefined>;
  save(log: PostLog): Promise<void>;
  delete(id: string): Promise<void>;
  deleteBySchedule(scheduleId: string): Promise<void>;
  /** Hard cap to keep the file small; oldest-first eviction. */
  prune(keepCount: number): Promise<void>;
}

export interface MediaRepository {
  list(): Promise<MediaAsset[]>;
  get(id: string): Promise<MediaAsset | undefined>;
  save(asset: MediaAsset): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface SettingsRepository {
  load(): Promise<AppSettings>;
  save(settings: AppSettings): Promise<void>;
}
