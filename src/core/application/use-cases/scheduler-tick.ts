import { ScheduleCalculator } from '../../domain/services/schedule-calculator';
import type { ScheduledPost } from '../../domain/entities/scheduled-post';
import type { Clock, EventBus } from '../ports/infrastructure';
import type { ScheduleRepository } from '../ports/repositories';

/**
 * The heartbeat of the scheduler. Invoked periodically (every 30s), on app
 * start, and after any schedule mutation — it decides what should run now.
 *
 * - due recurring/one-shot schedules fire immediately
 * - one-shot schedules missed within the grace window (sleep/offline) fire late
 * - one-shot schedules missed beyond the grace window are marked stale and
 *   disabled so the user can reschedule them consciously
 */
export class SchedulerTick {
  constructor(
    private deps: {
      schedules: ScheduleRepository;
      clock: Clock;
      events: EventBus;
      run: (scheduleId: string) => Promise<void>;
    },
  ) {}

  async execute(): Promise<void> {
    const now = this.deps.clock.now();
    const [due, missed, stale] = await Promise.all([
      this.deps.schedules.findDue(now),
      this.deps.schedules.findMissed(now),
      this.deps.schedules.findStale(now),
    ]);

    for (const post of stale) {
      await this.disableStale(post);
    }

    const toRun: ScheduledPost[] = [...missed, ...due];
    for (const post of toRun) {
      // Sequential on purpose: status posts are rate-sensitive.
      void this.deps.run(post.id).catch(() => undefined);
    }
  }

  private async disableStale(post: ScheduledPost): Promise<void> {
    const fresh = await this.deps.schedules.get(post.id);
    if (!fresh) return;
    await this.deps.schedules.save({
      ...fresh,
      enabled: false,
      nextRunAt: undefined,
      updatedAt: this.deps.clock.now().getTime(),
    });
    this.deps.events.publish('schedule-updated', { scheduleId: fresh.id });
    this.deps.events.publish('notice', {
      level: 'warning',
      messageKey: 'notice.schedule-missed',
      params: { title: fresh.title },
    });
  }
}

/** Interval driver owned by the composition root (main process). */
export class SchedulerDriver {
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;

  constructor(
    private readonly tick: () => Promise<void>,
    private readonly intervalMs = 30_000,
  ) {}

  start(): void {
    if (this.timer) return;
    void this.safeTick();
    this.timer = setInterval(() => void this.safeTick(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Force an immediate tick (e.g. after creating/updating a schedule). */
  kick(): void {
    void this.safeTick();
  }

  private async safeTick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.tick();
    } catch {
      // Ticks must never crash the app; failures resurface on the next tick.
    } finally {
      this.busy = false;
    }
  }
}

export { ScheduleCalculator };
