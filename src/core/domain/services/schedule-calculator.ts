import type { Recurrence } from '../entities/scheduled-post';

/**
 * Pure functions that decide WHEN a schedule should run next.
 * All math uses the machine's local timezone — the same timezone the user
 * picked times in. No external date libraries: deterministic and testable.
 */
export class ScheduleCalculator {
  /** Next epoch-ms run time for a schedule, or undefined when finished. */
  static nextRunAt(input: {
    recurrence: Recurrence;
    runAt?: number;
    timeOfDay: string;
    lastRunAt?: number;
    enabled: boolean;
    hasEverRun?: boolean;
  }, from: Date): number | undefined {
    if (!input.enabled) return undefined;
    const { kind } = input.recurrence;

    if (kind === 'once') {
      if (input.hasEverRun) return undefined;
      return input.runAt;
    }

    const [h, m] = input.timeOfDay.split(':').map(Number);
    const base = new Date(from);

    if (kind === 'daily') {
      const candidate = ScheduleCalculator.at(base, h, m);
      return candidate.getTime() > from.getTime() ? candidate.getTime() : ScheduleCalculator.addDays(candidate, 1).getTime();
    }

    // weekly
    const days = [...new Set(input.recurrence.daysOfWeek ?? [])].sort((a, b) => a - b);
    if (days.length === 0) return undefined;

    for (let i = 0; i < 8; i++) {
      const candidate = ScheduleCalculator.addDays(ScheduleCalculator.at(base, h, m), i);
      if (candidate.getTime() <= from.getTime()) continue;
      if (days.includes(candidate.getDay())) return candidate.getTime();
    }
    return undefined;
  }

  /** Whether a schedule is due at `now`. */
  static isDue(post: { nextRunAt?: number; enabled: boolean; running: boolean }, now: Date): boolean {
    return post.enabled && !post.running && post.nextRunAt !== undefined && post.nextRunAt <= now.getTime();
  }

  /**
   * Grace window for a missed 'once' run (e.g. the machine was asleep or the
   * app was closed). Within the window we still fire; beyond it the run is
   * considered stale.
   */
  static readonly MISSED_RUN_GRACE_MS = 15 * 60 * 1000;

  static isMissedRun(post: { nextRunAt?: number; enabled: boolean; running: boolean; recurrence: Recurrence; hasEverRun?: boolean }, now: Date): boolean {
    if (!post.enabled || post.running || post.recurrence.kind !== 'once' || post.hasEverRun) return false;
    const runAt = post.nextRunAt;
    if (runAt === undefined) return false;
    const lateBy = now.getTime() - runAt;
    return lateBy > 0 && lateBy <= ScheduleCalculator.MISSED_RUN_GRACE_MS;
  }

  static isStaleRun(post: { nextRunAt?: number; enabled: boolean; running: boolean; recurrence: Recurrence; hasEverRun?: boolean }, now: Date): boolean {
    if (!post.enabled || post.running || post.recurrence.kind !== 'once' || post.hasEverRun) return false;
    const runAt = post.nextRunAt;
    if (runAt === undefined) return false;
    return now.getTime() - runAt > ScheduleCalculator.MISSED_RUN_GRACE_MS;
  }

  private static at(base: Date, hours: number, minutes: number): Date {
    const d = new Date(base);
    d.setHours(hours, minutes, 0, 0);
    return d;
  }

  private static addDays(d: Date, days: number): Date {
    const c = new Date(d);
    c.setDate(c.getDate() + days);
    return c;
  }
}
