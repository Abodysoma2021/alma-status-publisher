import type { AppSettings } from '../../domain/entities/app-settings';
import type { ScheduledPost } from '../../domain/entities/scheduled-post';
import type { Clock, EventBus } from '../ports/infrastructure';
import type { LogRepository, ScheduleRepository, SessionRepository, SettingsRepository } from '../ports/repositories';

export class GetSettings {
  constructor(private settings: SettingsRepository) {}
  async execute(): Promise<AppSettings> {
    return this.settings.load();
  }
}

export class UpdateSettings {
  constructor(
    private deps: { settings: SettingsRepository; events: EventBus },
  ) {}
  async execute(patch: Partial<AppSettings>): Promise<AppSettings> {
    const current = await this.deps.settings.load();
    const next: AppSettings = {
      theme: patch.theme ?? current.theme,
      locale: patch.locale ?? current.locale,
    };
    await this.deps.settings.save(next);
    this.deps.events.publish('settings-updated', {});
    return next;
  }
}

export interface DashboardSnapshot {
  totalSessions: number;
  connectedSessions: number;
  activeSchedules: number;
  sentToday: number;
  failedToday: number;
  upcoming: ScheduledPost[];
}

export class GetDashboard {
  constructor(
    private deps: {
      sessions: SessionRepository;
      schedules: ScheduleRepository;
      logs: LogRepository;
      clock: Clock;
    },
  ) {}

  async execute(): Promise<DashboardSnapshot> {
    const now = this.deps.clock.now();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);

    const [sessions, schedules, logs] = await Promise.all([
      this.deps.sessions.list(),
      this.deps.schedules.list(),
      this.deps.logs.list(),
    ]);

    const todaysLogs = logs.filter((l) => l.startedAt >= startOfDay.getTime());
    const upcoming = schedules
      .filter((s) => s.enabled && !s.running && s.nextRunAt !== undefined)
      .sort((a, b) => (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity))
      .slice(0, 5);

    return {
      totalSessions: sessions.length,
      connectedSessions: sessions.filter((s) => s.status === 'connected').length,
      activeSchedules: schedules.filter((s) => s.enabled && s.nextRunAt !== undefined).length,
      sentToday: todaysLogs.filter((l) => l.state === 'sent').length,
      failedToday: todaysLogs.filter((l) => l.state === 'failed').length,
      upcoming,
    };
  }
}
