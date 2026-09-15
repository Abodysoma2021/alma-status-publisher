import * as path from 'node:path';
import { app } from 'electron';

import type { EventBus } from '../src/core/application/ports/infrastructure';
import type { ScheduleRepository } from '../src/core/application/ports/repositories';
import {
  JsonLogRepository,
  JsonMediaRepository,
  JsonScheduleRepository,
  JsonSessionRepository,
  JsonSettingsRepository,
} from '../src/infrastructure/persistence/json-repositories';
import { OpenWaGateway } from '../src/infrastructure/whatsapp/open-wa-gateway';
import { StaticServer } from './static-server';
import {
  buildStoragePaths,
  CryptoIdGenerator,
  InProcessEventBus,
  MediaFileStore,
  SystemClock,
} from '../src/infrastructure/system/system-infrastructure';
import {
  CancelLinking,
  ConfirmSession,
  ListSessions,
  RelinkSession,
  RemoveSession,
  RenameSession,
  RestoreSessions,
  SetDefaultSession,
  StartLinking,
  UnlinkSession,
  type SessionUseCaseDeps,
} from '../src/core/application/use-cases/session-use-cases';
import { HandleGatewayEvent, bindGatewayToApplication } from '../src/core/application/use-cases/handle-gateway-event';
import {
  CreateSchedule,
  DeleteSchedule,
  ListSchedules,
  RunScheduleNow,
  ScheduleUseCaseDeps,
  ToggleSchedule,
  UpdateSchedule,
} from '../src/core/application/use-cases/schedule-use-cases';
import { PublishSchedule, type PublishPipelineDeps } from '../src/core/application/use-cases/publish-schedule';
import { SchedulerDriver, SchedulerTick } from '../src/core/application/use-cases/scheduler-tick';
import { DeleteMedia, ImportMedia } from '../src/core/application/use-cases/media-use-cases';
import { ClearLogs, ListLogs } from '../src/core/application/use-cases/log-use-cases';
import { GetDashboard, GetSettings, UpdateSettings } from '../src/core/application/use-cases/query-use-cases';

/**
 * The composition root. This is the ONLY place that knows how concrete
 * infrastructure implementations are wired into the application layer
 * (Clean Architecture: dependencies point inward; composition happens here).
 */
export class AppContainer {
  readonly paths = buildStoragePaths(app.getPath('userData'));
  readonly staticServer: StaticServer;

  constructor(options: { rendererRootDir: string }) {
    this.staticServer = new StaticServer({
      rootDir: options.rendererRootDir,
      mediaResolver: (id) => this.resolveMedia(id),
    });
  }

  // Infrastructure
  readonly clock = new SystemClock();
  readonly ids = new CryptoIdGenerator();
  readonly events: EventBus = new InProcessEventBus();

  readonly sessions = new JsonSessionRepository(path.join(this.paths.dataDir, 'sessions.json'));
  readonly schedules: ScheduleRepository = new JsonScheduleRepository(
    path.join(this.paths.dataDir, 'schedules.json'),
    this.clock,
  );
  readonly logs = new JsonLogRepository(path.join(this.paths.dataDir, 'logs.json'));
  readonly media = new JsonMediaRepository(path.join(this.paths.dataDir, 'media.json'));
  readonly settings = new JsonSettingsRepository(path.join(this.paths.dataDir, 'settings.json'));

  readonly mediaStore = new MediaFileStore(this.paths.mediaDir, this.media);
  readonly gateway = new OpenWaGateway(this.paths.waSessionsDir);

  // Application
  private readonly sessionDeps: SessionUseCaseDeps = {
    sessions: this.sessions,
    gateway: this.gateway,
    ids: this.ids,
    events: this.events,
  };

  private readonly scheduleDeps: ScheduleUseCaseDeps = {
    schedules: this.schedules,
    logs: this.logs,
    clock: this.clock,
    ids: this.ids,
    events: this.events,
  };

  private readonly publishDeps: PublishPipelineDeps = {
    sessions: this.sessions,
    schedules: this.schedules,
    logs: this.logs,
    media: this.media,
    mediaReader: this.mediaStore,
    gateway: this.gateway,
    clock: this.clock,
    ids: this.ids,
    events: this.events,
  };

  private readonly publishSchedule = new PublishSchedule(this.publishDeps);
  private readonly schedulerTick = new SchedulerTick({
    schedules: this.schedules,
    clock: this.clock,
    events: this.events,
    run: (id) => this.publishSchedule.execute(id),
  });
  readonly scheduler = new SchedulerDriver(() => this.schedulerTick.execute());

  // Use cases (commands & queries exposed to IPC)
  readonly useCases = {
    listSessions: new ListSessions(this.sessionDeps),
    startLinking: new StartLinking(this.sessionDeps),
    cancelLinking: new CancelLinking(this.sessionDeps),
    confirmSession: new ConfirmSession(this.sessionDeps),
    renameSession: new RenameSession(this.sessionDeps),
    relinkSession: new RelinkSession(this.sessionDeps),
    unlinkSession: new UnlinkSession(this.sessionDeps),
    removeSession: new RemoveSession(this.sessionDeps),
    setDefaultSession: new SetDefaultSession(this.sessionDeps),
    restoreSessions: new RestoreSessions(this.sessionDeps),

    listSchedules: new ListSchedules(this.scheduleDeps),
    createSchedule: new CreateSchedule(this.scheduleDeps),
    updateSchedule: new UpdateSchedule(this.scheduleDeps),
    deleteSchedule: new DeleteSchedule(this.scheduleDeps),
    toggleSchedule: new ToggleSchedule(this.scheduleDeps),
    runScheduleNow: new RunScheduleNow(this.scheduleDeps, (id) => this.publishSchedule.execute(id)),

    importMedia: new ImportMedia({ media: this.media, ids: this.ids, clock: this.clock, importer: this.mediaStore }),
    deleteMedia: new DeleteMedia({ media: this.media, events: this.events }),

    listLogs: new ListLogs(this.logs),
    clearLogs: new ClearLogs({ logs: this.logs, events: this.events }),
    retryLog: { execute: (id: string) => this.publishSchedule.retryLog(id) },

    getDashboard: new GetDashboard({ sessions: this.sessions, schedules: this.schedules, logs: this.logs, clock: this.clock }),
    getSettings: new GetSettings(this.settings),
    updateSettings: new UpdateSettings({ settings: this.settings, events: this.events }),
  };

  /** Resolve a managed media file for preview streaming. */
  async resolveMedia(id: string): Promise<{ filePath: string; mimeType: string } | null> {
    const asset = await this.media.get(id);
    if (!asset) return null;
    const stored = path.join(this.paths.mediaDir, `${id}`);
    // stored file name is `${id}${ext}` — probe known extensions via metadata
    const ext = extensionForMime(asset.mimeType);
    return { filePath: `${stored}${ext}`, mimeType: asset.mimeType };
  }

  async startBackgroundWork(): Promise<void> {
    bindGatewayToApplication(this.gateway, new HandleGatewayEvent({ sessions: this.sessions, gateway: this.gateway, events: this.events }));
    await this.useCases.restoreSessions.execute();
    this.scheduler.start();
    // Flush JSON stores periodically as a safety net (writes are also debounced).
    setInterval(() => void flushAllStores(this), 60_000).unref();
  }

  async shutdown(): Promise<void> {
    this.scheduler.stop();
    await this.gateway.closeAll().catch(() => undefined);
    await flushAllStores(this).catch(() => undefined);
  }
}

async function flushAllStores(container: AppContainer): Promise<void> {
  const flushables = [
    container.sessions,
    container.schedules,
    container.logs,
    container.media,
    container.settings,
  ] as unknown as { flush?: () => Promise<void> }[];
  for (const repo of flushables) {
    await repo.flush?.().catch(() => undefined);
  }
}

function extensionForMime(mime: string): string {
  switch (mime) {
    case 'image/jpeg': return '.jpg';
    case 'image/png': return '.png';
    case 'image/webp': return '.webp';
    case 'video/mp4': return '.mp4';
    case 'video/quicktime': return '.mov';
    case 'video/webm': return '.webm';
    default: return '';
  }
}

export let container: AppContainer;

export function initContainer(options: { rendererRootDir: string }): AppContainer {
  container = new AppContainer(options);
  return container;
}
