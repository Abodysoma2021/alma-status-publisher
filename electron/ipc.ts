import { ipcMain, dialog, nativeTheme, BrowserWindow } from 'electron';
import * as path from 'node:path';
import type { AppContainer } from './bootstrap';
import { AppError } from '../src/core/domain/errors';
import type {
  CreateScheduleInput,
  UpdateScheduleInput,
} from '../src/shared/bridge';
import type {
  LogView,
  ScheduleView,
  SessionView,
  MediaAssetView,
} from '../src/shared/view-models';
import type { ScheduledPost } from '../src/core/domain/entities/scheduled-post';
import type { WhatsAppSession } from '../src/core/domain/entities/whatsapp-session';
import type { PostLog } from '../src/core/domain/entities/post-log';
import type { MediaAsset } from '../src/core/domain/entities/media-asset';

/**
 * IPC controller layer: thin adapters that translate renderer commands into
 * use-case calls and normalize every failure into { code, message, messageKey }.
 */
export function registerIpcHandlers(
  container: AppContainer,
  getMainWindow: () => BrowserWindow | null,
  runtimeInfo: { version: string; platform: string },
): void {
  const fail = (err: unknown): never => {
    const appErr = AppError.from(err);
    // Electron flattens thrown values; a marked envelope survives transport.
    throw new Error(`${ERROR_ENVELOPE}${JSON.stringify(appErr.toJSON())}`);
  };
  const guard = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      return fail(err);
    }
  };

  const toSessionView = (session: WhatsAppSession): SessionView => ({ ...session });
  const toScheduleView = (post: ScheduledPost): ScheduleView => ({ ...post });
  const toLogView = (log: PostLog, ctx: { schedules: Map<string, ScheduledPost | undefined>; sessions: Map<string, WhatsAppSession | undefined> }): LogView => ({
    ...log,
    scheduleTitle: ctx.schedules.get(log.scheduleId)?.title ?? '—',
    sessionName: ctx.sessions.get(log.sessionId)?.name ?? '—',
  });
  const toMediaView = (asset: MediaAsset): MediaAssetView => ({
    id: asset.id,
    fileName: asset.fileName,
    type: asset.type,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    previewUrl: `${container.staticServer.baseUrl}/media/${asset.id}`,
    createdAt: asset.createdAt,
  });

  // ---- Sessions ----
  ipcMain.handle('alma:sessions:list', () =>
    guard(async () => {
      const sessions = await container.useCases.listSessions.execute();
      return sessions.map(toSessionView);
    }),
  );

  ipcMain.handle('alma:sessions:start-linking', (_e, input: { name: string; pairingPhone?: string }) =>
    guard(async () => {
      const session = await container.useCases.startLinking.execute(input);
      return toSessionView(session);
    }),
  );

  ipcMain.handle('alma:sessions:cancel-linking', (_e, sessionId: string) =>
    guard(() => container.useCases.cancelLinking.execute(sessionId)),
  );

  ipcMain.handle('alma:sessions:confirm', (_e, sessionId: string, name: string) =>
    guard(async () => {
      const session = await container.useCases.confirmSession.execute(sessionId, name);
      return toSessionView(session);
    }),
  );

  ipcMain.handle('alma:sessions:rename', (_e, sessionId: string, name: string) =>
    guard(() => container.useCases.renameSession.execute(sessionId, name)),
  );

  ipcMain.handle('alma:sessions:relink', (_e, sessionId: string) =>
    guard(() => container.useCases.relinkSession.execute(sessionId)),
  );

  ipcMain.handle('alma:sessions:unlink', (_e, sessionId: string) =>
    guard(() => container.useCases.unlinkSession.execute(sessionId)),
  );

  ipcMain.handle('alma:sessions:remove', (_e, sessionId: string) =>
    guard(() => container.useCases.removeSession.execute(sessionId)),
  );

  ipcMain.handle('alma:sessions:set-default', (_e, sessionId: string) =>
    guard(() => container.useCases.setDefaultSession.execute(sessionId)),
  );

  // ---- Schedules ----
  ipcMain.handle('alma:schedules:list', () =>
    guard(async () => {
      const schedules = await container.useCases.listSchedules.execute();
      return schedules.map(toScheduleView);
    }),
  );

  ipcMain.handle('alma:schedules:create', (_e, input: CreateScheduleInput) =>
    guard(async () => {
      const post = await container.useCases.createSchedule.execute({
        title: input.title,
        content: {
          type: input.contentType,
          text: input.text,
          textOptions: input.textOptions,
          mediaId: input.mediaId,
          caption: input.caption,
        },
        recurrence: input.recurrence,
        runAt: input.runAt,
        timeOfDay: input.timeOfDay,
        targets: input.targets,
        enabled: input.enabled,
      });
      container.scheduler.kick();
      return toScheduleView(post);
    }),
  );

  ipcMain.handle('alma:schedules:update', (_e, id: string, patch: UpdateScheduleInput) =>
    guard(async () => {
      const post = await container.useCases.updateSchedule.execute(id, {
        title: patch.title,
        content:
          patch.contentType || patch.text !== undefined || patch.textOptions || patch.mediaId !== undefined || patch.caption !== undefined
            ? {
                type: patch.contentType ?? 'text',
                text: patch.text,
                textOptions: patch.textOptions,
                mediaId: patch.mediaId,
                caption: patch.caption,
              }
            : undefined,
        recurrence: patch.recurrence,
        runAt: patch.runAt,
        timeOfDay: patch.timeOfDay,
        targets: patch.targets,
        enabled: patch.enabled,
      });
      container.scheduler.kick();
      return toScheduleView(post);
    }),
  );

  ipcMain.handle('alma:schedules:delete', (_e, id: string) =>
    guard(() => container.useCases.deleteSchedule.execute(id)),
  );

  ipcMain.handle('alma:schedules:toggle', (_e, id: string, enabled: boolean) =>
    guard(() => container.useCases.toggleSchedule.execute(id, enabled)),
  );

  ipcMain.handle('alma:schedules:run-now', (_e, id: string) =>
    guard(() => container.useCases.runScheduleNow.execute(id)),
  );

  // ---- Media ----
  const pickFile = async (kind: 'image' | 'video'): Promise<string | null> => {
    const win = getMainWindow();
    if (!win) return null;
    const filters =
      kind === 'image'
        ? [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }]
        : [{ name: 'Videos', extensions: ['mp4', 'mov', 'webm'] }];
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters,
    });
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
  };

  ipcMain.handle('alma:media:pick', (_e, kind: 'image' | 'video') =>
    guard(async () => {
      const filePath = await pickFile(kind);
      if (!filePath) return null;
      const asset = await container.useCases.importMedia.execute(filePath);
      return toMediaView(asset);
    }),
  );

  ipcMain.handle('alma:media:import-dropped', (_e, filePath: string) =>
    guard(async () => {
      if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
        throw new AppError('FILE_NOT_FOUND', 'Invalid file path');
      }
      const asset = await container.useCases.importMedia.execute(filePath);
      return toMediaView(asset);
    }),
  );

  ipcMain.handle('alma:media:delete', (_e, mediaId: string) =>
    guard(async () => {
      await container.mediaStore.deleteStored(mediaId);
      await container.useCases.deleteMedia.execute(mediaId);
    }),
  );

  // ---- Logs ----
  ipcMain.handle('alma:logs:list', (_e, filter?: { state?: string }) =>
    guard(async () => {
      const [logs, schedules, sessions] = await Promise.all([
        container.useCases.listLogs.execute(filter?.state ? { state: filter.state as PostLog['state'] } : undefined),
        container.schedules.list(),
        container.sessions.list(),
      ]);
      const ctx = {
        schedules: new Map(schedules.map((s) => [s.id, s])),
        sessions: new Map(sessions.map((s) => [s.id, s])),
      };
      return logs.map((log) => toLogView(log, ctx));
    }),
  );

  ipcMain.handle('alma:logs:retry', (_e, logId: string) =>
    guard(() => container.useCases.retryLog.execute(logId)),
  );

  ipcMain.handle('alma:logs:clear', () =>
    guard(() => container.useCases.clearLogs.execute()),
  );

  // ---- Dashboard / settings / misc ----
  ipcMain.handle('alma:dashboard:get', () =>
    guard(async () => {
      const snapshot = await container.useCases.getDashboard.execute();
      return { ...snapshot, upcoming: snapshot.upcoming.map(toScheduleView) };
    }),
  );

  ipcMain.handle('alma:settings:get', () =>
    guard(() => container.useCases.getSettings.execute()),
  );

  ipcMain.handle('alma:settings:update', (_e, patch: { theme?: 'light' | 'dark' | 'system'; locale?: 'en' | 'ar' }) =>
    guard(async () => {
      // Keep native chrome (scrollbars, dialogs) in sync with the app theme.
      if (patch.theme) nativeTheme.themeSource = patch.theme;
      return container.useCases.updateSettings.execute(patch);
    }),
  );

  ipcMain.handle('alma:app:dock-badge', (_e, count: number) =>
    guard(async () => {
      const { updateDockBadge } = await import('./menus');
      updateDockBadge(Number(count) || 0);
    }),
  );

  ipcMain.handle('alma:app:info', () =>
    guard(async () => ({
      version: runtimeInfo.version,
      platform: runtimeInfo.platform,
      dataPath: container.paths.dataDir,
      mediaBaseUrl: container.staticServer.baseUrl,
    })),
  );

  ipcMain.handle('alma:app:open-data-folder', () =>
    guard(async () => {
      await import('electron').then(({ shell }) => shell.openPath(container.paths.dataDir));
    }),
  );
}

/** Push an application event to the renderer (fire-and-forget). */
export function pushEventToWindow(win: BrowserWindow | null, channel: string, payload: unknown): void {
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload);
  }
}

export const ERROR_ENVELOPE = '__ALMA_ERROR__:';

export function normalizeIpcError(err: unknown): { code: string; message: string } {
  const appErr = AppError.from(err);
  return appErr.toJSON();
}
