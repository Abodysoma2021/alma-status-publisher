import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  AlmaBridgeCommands,
  CreateScheduleInput,
  UpdateScheduleInput,
} from '../src/shared/bridge';

const ERROR_ENVELOPE = '__ALMA_ERROR__:';

/**
 * Revives the marked error envelope sent through IPC into a structured
 * BridgeError, so the renderer can translate codes instead of parsing strings.
 */
function reviveError(err: unknown): Error & { code?: string; messageKey?: string; alma?: boolean } {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.startsWith(ERROR_ENVELOPE)) {
    try {
      const parsed = JSON.parse(raw.slice(ERROR_ENVELOPE.length)) as { code: string; message: string; messageKey?: string };
      const revived = new Error(parsed.message) as Error & { code?: string; messageKey?: string; alma?: boolean };
      revived.code = parsed.code;
      revived.messageKey = parsed.messageKey ?? parsed.code.toLowerCase();
      revived.alma = true;
      return revived;
    } catch {
      /* fall through */
    }
  }
  const fallback = new Error(raw) as Error & { code?: string; messageKey?: string; alma?: boolean };
  fallback.code = 'UNKNOWN';
  fallback.messageKey = 'unknown';
  fallback.alma = false;
  return fallback;
}

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  console.log(`[alma:ipc-call] ${channel}`);
  return ipcRenderer
    .invoke(channel, ...args)
    .catch((err) => {
      console.error(`[alma:ipc-call] ${channel} rejected`, err);
      throw reviveError(err);
    });
}

const commands: AlmaBridgeCommands = {
  // Sessions
  listSessions: () => invoke('alma:sessions:list'),
  startLinking: (input) => invoke('alma:sessions:start-linking', input),
  cancelLinking: (sessionId) => invoke('alma:sessions:cancel-linking', sessionId),
  confirmSession: (sessionId, name) => invoke('alma:sessions:confirm', sessionId, name),
  renameSession: (sessionId, name) => invoke('alma:sessions:rename', sessionId, name),
  relinkSession: (sessionId) => invoke('alma:sessions:relink', sessionId),
  unlinkSession: (sessionId) => invoke('alma:sessions:unlink', sessionId),
  removeSession: (sessionId) => invoke('alma:sessions:remove', sessionId),
  setDefaultSession: (sessionId) => invoke('alma:sessions:set-default', sessionId),

  // Schedules
  listSchedules: () => invoke('alma:schedules:list'),
  createSchedule: (input: CreateScheduleInput) => invoke('alma:schedules:create', input),
  updateSchedule: (id: string, patch: UpdateScheduleInput) => invoke('alma:schedules:update', id, patch),
  deleteSchedule: (id: string) => invoke('alma:schedules:delete', id),
  toggleSchedule: (id: string, enabled: boolean) => invoke('alma:schedules:toggle', id, enabled),
  runScheduleNow: (id: string) => invoke('alma:schedules:run-now', id),

  // Media
  pickMedia: (kind) => invoke('alma:media:pick', kind),
  importDroppedFile: (filePath, kind) => invoke('alma:media:import-dropped', filePath, kind),
  deleteMedia: (mediaId) => invoke('alma:media:delete', mediaId),

  // Logs
  listLogs: (filter) => invoke('alma:logs:list', filter),
  retryLog: (logId) => invoke('alma:logs:retry', logId),
  clearLogs: () => invoke('alma:logs:clear'),

  // Dashboard & settings
  getDashboard: () => invoke('alma:dashboard:get'),
  getSettings: () => invoke('alma:settings:get'),
  updateSettings: (patch) => invoke('alma:settings:update', patch),
  openDataFolder: () => invoke('alma:app:open-data-folder'),
  getAppInfo: () => invoke('alma:app:info'),
  setDockBadge: (count: number) => invoke('alma:app:dock-badge', count),
};

try {
  contextBridge.exposeInMainWorld('alma', {
  commands,
  onEvent: (listener: (event: unknown) => void) => {
    const wrapped = (_event: unknown, payload: unknown) => listener(payload as never);
    ipcRenderer.on('alma:event', wrapped);
    return () => ipcRenderer.removeListener('alma:event', wrapped);
  },
  onMenu: (listener: (action: string) => void) => {
    const wrapped = (_event: unknown, action: string) => listener(action);
    ipcRenderer.on('alma:menu', wrapped);
    return () => ipcRenderer.removeListener('alma:menu', wrapped);
  },
  getPathForFile: (file: File) => {
    try {
      return webUtils.getPathForFile(file) || null;
    } catch {
      return null;
    }
  },
});
  console.log('[alma:preload] bridge exposed with', Object.keys(commands).length, 'commands');
} catch (err) {
  console.error('[alma:preload] FAILED to expose bridge:', err);
}
