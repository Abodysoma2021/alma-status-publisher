/**
 * Wire-level view models exchanged between the Electron main process and the
 * renderer. These are plain JSON serializable DTOs — the renderer never imports
 * domain/infrastructure code, only this contract.
 */

export type SessionStatus =
  | 'initializing'
  | 'awaiting_qr'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'qr_expired'
  | 'logged_out'
  | 'error';

export interface SessionView {
  id: string;
  name: string;
  phoneNumber?: string;
  pushName?: string;
  status: SessionStatus;
  isDefault: boolean;
  qrCode?: string;
  pairingCode?: string;
  lastError?: string;
  linkedAt?: number;
  lastConnectedAt?: number;
  createdAt: number;
}

export type ContentType = 'text' | 'image' | 'video';

export interface MediaAssetView {
  id: string;
  fileName: string;
  type: 'image' | 'video';
  mimeType: string;
  sizeBytes: number;
  previewUrl: string;
  createdAt: number;
}

export type RecurrenceKind = 'once' | 'daily' | 'weekly';

export interface RecurrenceView {
  kind: RecurrenceKind;
  /** 0 (Sunday) .. 6 (Saturday) — required when kind === 'weekly' */
  daysOfWeek?: number[];
}

export interface ScheduleView {
  id: string;
  title: string;
  content: {
    type: ContentType;
    text?: string;
    textOptions?: TextStatusOptions;
    mediaId?: string;
    caption?: string;
  };
  recurrence: RecurrenceView;
  /** Epoch ms — set for kind === 'once' */
  runAt?: number;
  /** 'HH:mm' local machine time — for daily/weekly */
  timeOfDay: string;
  /** 'all' or explicit session ids */
  targets: 'all' | string[];
  enabled: boolean;
  running: boolean;
  nextRunAt?: number;
  lastRunAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface TextStatusOptions {
  backgroundColor: string;
  textColor: string;
  fontIndex: number;
}

export type DeliveryState = 'pending' | 'sent' | 'failed' | 'skipped';

export interface LogView {
  id: string;
  scheduleId: string;
  scheduleTitle: string;
  sessionId: string;
  sessionName: string;
  contentType: ContentType;
  state: DeliveryState;
  attempts: number;
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

export interface DashboardStats {
  totalSessions: number;
  connectedSessions: number;
  activeSchedules: number;
  sentToday: number;
  failedToday: number;
  upcoming: ScheduleView[];
}

export interface SettingsView {
  theme: 'light' | 'dark' | 'system';
  locale: 'en' | 'ar';
}

export type AppEventType =
  | 'session:updated'
  | 'session:removed'
  | 'schedule:updated'
  | 'schedule:removed'
  | 'log:updated'
  | 'media:removed'
  | 'settings:updated'
  | 'app:error'
  | 'app:notice';

export interface AppEvent {
  type: AppEventType;
  payload: unknown;
}

export interface NoticePayload {
  level: 'info' | 'success' | 'warning' | 'error';
  messageKey: string;
  params?: Record<string, string>;
  detail?: string;
}
