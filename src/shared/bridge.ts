import type {
  AppEvent,
  DashboardStats,
  LogView,
  MediaAssetView,
  ScheduleView,
  SessionView,
  SettingsView,
  ContentType,
  TextStatusOptions,
  RecurrenceView,
} from './view-models';

/**
 * Commands the renderer can invoke on the main process.
 * Every method resolves with a result or rejects with { code, message }.
 */
export interface AlmaBridgeCommands {
  // Sessions
  listSessions(): Promise<SessionView[]>;
  startLinking(input: { name: string; pairingPhone?: string }): Promise<SessionView>;
  cancelLinking(sessionId: string): Promise<void>;
  confirmSession(sessionId: string, name: string): Promise<SessionView>;
  renameSession(sessionId: string, name: string): Promise<void>;
  relinkSession(sessionId: string): Promise<void>;
  unlinkSession(sessionId: string): Promise<void>;
  removeSession(sessionId: string): Promise<void>;
  setDefaultSession(sessionId: string): Promise<void>;

  // Schedules
  listSchedules(): Promise<ScheduleView[]>;
  createSchedule(input: CreateScheduleInput): Promise<ScheduleView>;
  updateSchedule(id: string, patch: UpdateScheduleInput): Promise<ScheduleView>;
  deleteSchedule(id: string): Promise<void>;
  toggleSchedule(id: string, enabled: boolean): Promise<void>;
  runScheduleNow(id: string): Promise<void>;

  // Media
  pickMedia(kind: 'image' | 'video'): Promise<MediaAssetView | null>;
  importDroppedFile(path: string, kind: 'image' | 'video'): Promise<MediaAssetView>;
  deleteMedia(mediaId: string): Promise<void>;

  // History
  listLogs(filter?: { state?: string }): Promise<LogView[]>;
  retryLog(logId: string): Promise<void>;
  clearLogs(): Promise<void>;

  // Dashboard & settings
  getDashboard(): Promise<DashboardStats>;
  getSettings(): Promise<SettingsView>;
  updateSettings(patch: Partial<SettingsView>): Promise<SettingsView>;
  openDataFolder(): Promise<void>;
  getAppInfo(): Promise<{ version: string; platform: string; dataPath: string; mediaBaseUrl: string }>;
  setDockBadge(count: number): Promise<void>;
}

export interface CreateScheduleInput {
  title: string;
  contentType: ContentType;
  text?: string;
  textOptions?: TextStatusOptions;
  mediaId?: string;
  caption?: string;
  recurrence: RecurrenceView;
  runAt?: number;
  timeOfDay: string;
  targets: 'all' | string[];
  enabled: boolean;
}

export type UpdateScheduleInput = Partial<CreateScheduleInput>;

export interface AlmaBridge {
  commands: AlmaBridgeCommands;
  onEvent(listener: (event: AppEvent) => void): () => void;
  /** Native application-menu / dock-menu actions forwarded from main. */
  onMenu(listener: (action: string) => void): () => void;
  /** macOS Dock icon badge with the connected-numbers count. */
  setDockBadge(count: number): Promise<void>;
  getPathForFile(file: File): string | null;
}

/** Thrown by every bridge command on failure. */
export interface AlmaBridgeError extends Error {
  code?: string;
  messageKey?: string;
  alma?: boolean;
}

export function toBridgeError(err: unknown): AlmaBridgeError {
  const error = err as AlmaBridgeError;
  return {
    ...(error instanceof Error ? { message: error.message } : { message: String(err) }),
    code: error?.code ?? 'UNKNOWN',
    messageKey: error?.messageKey ?? 'unknown',
    alma: error?.alma ?? false,
  } as AlmaBridgeError;
}
