/** Time, identity, and event infrastructure ports. */

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(): string;
}

export type AppEventType =
  | 'session-updated'
  | 'session-removed'
  | 'schedule-updated'
  | 'schedule-removed'
  | 'log-updated'
  | 'media-removed'
  | 'settings-updated'
  | 'notice'
  | 'run-finished';

export interface AppEventPayloads {
  'session-updated': { sessionId: string };
  'session-removed': { sessionId: string };
  'schedule-updated': { scheduleId: string };
  'schedule-removed': { scheduleId: string };
  'log-updated': { logId: string };
  'media-removed': { mediaId: string };
  'settings-updated': Record<string, never>;
  notice: import('@/shared/view-models').NoticePayload;
  'run-finished': { scheduleId: string };
}

export interface EventBus {
  publish<K extends AppEventType>(type: K, payload: AppEventPayloads[K]): void;
  subscribe<K extends AppEventType>(type: K, handler: (payload: AppEventPayloads[K]) => void): () => void;
  subscribeAll(handler: (type: AppEventType, payload: unknown) => void): () => void;
}

/** Filesystem layout the app persists into (provided by infrastructure). */
export interface StoragePaths {
  dataDir: string;
  mediaDir: string;
  waSessionsDir: string;
  logsDir: string;
}
