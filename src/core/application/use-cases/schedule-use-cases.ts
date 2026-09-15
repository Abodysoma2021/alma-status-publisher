import { AppError } from '../../domain/errors';
import { ScheduledPostValidator } from '../../domain/entities/scheduled-post';
import type { Recurrence, ScheduledPost, StatusContent } from '../../domain/entities/scheduled-post';
import { ScheduleCalculator } from '../../domain/services/schedule-calculator';
import type { EventBus, Clock, IdGenerator } from '../ports/infrastructure';
import type { LogRepository, ScheduleRepository } from '../ports/repositories';

export interface ScheduleUseCaseDeps {
  schedules: ScheduleRepository;
  logs: LogRepository;
  clock: Clock;
  ids: IdGenerator;
  events: EventBus;
}

function normalizeRecurrence(recurrence: Recurrence): Recurrence {
  if (recurrence.kind === 'weekly') {
    const days = [...new Set(recurrence.daysOfWeek ?? [])].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
    return { kind: 'weekly', daysOfWeek: days };
  }
  return { kind: recurrence.kind };
}

export class CreateSchedule {
  constructor(private deps: ScheduleUseCaseDeps) {}

  async execute(input: {
    title: string;
    content: StatusContent;
    recurrence: Recurrence;
    runAt?: number;
    timeOfDay: string;
    targets: 'all' | string[];
    enabled: boolean;
  }): Promise<ScheduledPost> {
    const now = this.deps.clock.now();
    const post: ScheduledPost = {
      id: this.deps.ids.next(),
      title: input.title.trim(),
      content: input.content,
      recurrence: normalizeRecurrence(input.recurrence),
      runAt: input.recurrence.kind === 'once' ? input.runAt : undefined,
      timeOfDay: input.recurrence.kind === 'once' ? '00:00' : input.timeOfDay,
      targets: input.targets,
      enabled: input.enabled,
      running: false,
      createdAt: now.getTime(),
      updatedAt: now.getTime(),
    };
    post.nextRunAt = ScheduleCalculator.nextRunAt({ ...post, hasEverRun: false }, now);

    const errors = ScheduledPostValidator.validate(post);
    if (errors.length > 0) throw new AppError(errors[0].toUpperCase() as AppError['code']);

    await this.deps.schedules.save(post);
    this.deps.events.publish('schedule-updated', { scheduleId: post.id });
    return post;
  }
}

export class UpdateSchedule {
  constructor(private deps: ScheduleUseCaseDeps) {}

  async execute(id: string, patch: Partial<Parameters<CreateSchedule['execute']>[0]>): Promise<ScheduledPost> {
    const existing = await requireSchedule(this.deps.schedules, id);
    if (existing.running) throw new AppError('CONFLICT', 'Cannot edit while publishing');

    const merged: ScheduledPost = {
      ...existing,
      ...patch,
      title: (patch.title ?? existing.title).trim(),
      content: patch.content ?? existing.content,
      recurrence: patch.recurrence ? normalizeRecurrence(patch.recurrence) : existing.recurrence,
      runAt: patch.runAt !== undefined ? patch.runAt : patch.recurrence ? undefined : existing.runAt,
      timeOfDay: patch.timeOfDay ?? existing.timeOfDay,
      targets: patch.targets ?? existing.targets,
      enabled: patch.enabled ?? existing.enabled,
      updatedAt: this.deps.clock.now().getTime(),
    };
    if (merged.recurrence.kind !== 'once') merged.runAt = undefined;
    merged.nextRunAt = ScheduleCalculator.nextRunAt({ ...merged, hasEverRun: existing.lastRunAt !== undefined }, this.deps.clock.now());

    const errors = ScheduledPostValidator.validate(merged);
    if (errors.length > 0) throw new AppError(errors[0].toUpperCase() as AppError['code']);

    await this.deps.schedules.save(merged);
    this.deps.events.publish('schedule-updated', { scheduleId: merged.id });
    return merged;
  }
}

export class DeleteSchedule {
  constructor(private deps: ScheduleUseCaseDeps) {}
  async execute(id: string): Promise<void> {
    await this.deps.schedules.delete(id);
    await this.deps.logs.deleteBySchedule(id);
    this.deps.events.publish('schedule-removed', { scheduleId: id });
  }
}

export class ToggleSchedule {
  constructor(private deps: ScheduleUseCaseDeps) {}
  async execute(id: string, enabled: boolean): Promise<void> {
    const existing = await requireSchedule(this.deps.schedules, id);
    if (existing.running) throw new AppError('CONFLICT', 'Cannot toggle while publishing');
    const next: ScheduledPost = {
      ...existing,
      enabled,
      updatedAt: this.deps.clock.now().getTime(),
    };
    next.nextRunAt = ScheduleCalculator.nextRunAt({ ...next, hasEverRun: next.lastRunAt !== undefined }, this.deps.clock.now());
    await this.deps.schedules.save(next);
    this.deps.events.publish('schedule-updated', { scheduleId: id });
  }
}

export class ListSchedules {
  constructor(private deps: ScheduleUseCaseDeps) {}
  async execute(): Promise<ScheduledPost[]> {
    return this.deps.schedules.list();
  }
}

export class RunScheduleNow {
  constructor(
    private deps: ScheduleUseCaseDeps,
    private trigger: (scheduleId: string) => Promise<void>,
  ) {}

  async execute(id: string): Promise<void> {
    const post = await requireSchedule(this.deps.schedules, id);
    if (post.running) throw new AppError('CONFLICT', 'Already running');
    await this.trigger(id);
  }
}

export async function requireSchedule(repo: ScheduleRepository, id: string): Promise<ScheduledPost> {
  const post = await repo.get(id);
  if (!post) throw new AppError('NOT_FOUND', `Schedule ${id} not found`);
  return post;
}
