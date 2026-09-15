import { AppError } from '../../domain/errors';
import type { PostLog } from '../../domain/entities/post-log';
import type { ScheduledPost } from '../../domain/entities/scheduled-post';
import type { WhatsAppSession } from '../../domain/entities/whatsapp-session';
import { isSessionUsable } from '../../domain/entities/whatsapp-session';
import { ScheduleCalculator } from '../../domain/services/schedule-calculator';
import type { Clock, EventBus, IdGenerator } from '../ports/infrastructure';
import type { LogRepository, MediaRepository, ScheduleRepository, SessionRepository } from '../ports/repositories';
import type { WhatsAppGateway } from '../ports/whatsapp-gateway';

/** Reads stored media back as a base64 data URL for the WhatsApp gateway. */
export interface MediaContentReader {
  readAsDataUrl(mediaId: string): Promise<string>;
}

export interface PublishPipelineDeps {
  sessions: SessionRepository;
  schedules: ScheduleRepository;
  logs: LogRepository;
  media: MediaRepository;
  mediaReader: MediaContentReader;
  gateway: WhatsAppGateway;
  clock: Clock;
  ids: IdGenerator;
  events: EventBus;
  /** Delay provider so timers stay testable; defaults to global setTimeout. */
  delay?: (ms: number) => Promise<void>;
}

export const RETRY_BACKOFF_MS = [0, 30_000, 120_000] as const;
export const MAX_ATTEMPTS = RETRY_BACKOFF_MS.length;

/**
 * Publishes one schedule to its targets:
 *  1. resolve target sessions (connected ones only)
 *  2. create a pending log per target
 *  3. post with bounded retries (30s, 2m backoff)
 *  4. finalize logs, recompute next run, notify the UI after every change
 */
export class PublishSchedule {
  constructor(private deps: PublishPipelineDeps) {}

  async execute(scheduleId: string): Promise<void> {
    const post = await this.deps.schedules.get(scheduleId);
    if (!post) return;
    if (post.running) return;

    const allSessions = await this.deps.sessions.list();
    await this.markRunning(post, true);

    try {
      const targets = this.resolveTargets(post, allSessions);
      await Promise.all(targets.map(({ session, skippedReason }) => this.publishToSession(post, session, skippedReason)));
    } finally {
      await this.finalizeRun(post.id);
    }
  }

  /** Retry one failed delivery row. */
  async retryLog(logId: string): Promise<void> {
    const log = await this.deps.logs.get(logId);
    if (!log) throw new AppError('NOT_FOUND', 'Log not found');
    if (log.state !== 'failed') throw new AppError('CONFLICT', 'Log is not retryable');

    const post = await this.deps.schedules.get(log.scheduleId);
    const session = await this.deps.sessions.get(log.sessionId);
    if (!session) {
      await this.saveLog({ ...log, state: 'skipped', error: 'NOT_FOUND', finishedAt: Date.now() });
      return;
    }
    if (!isSessionUsable(session)) throw new AppError('SESSION_NOT_CONNECTED', `Session "${session.name}" is not connected`);

    const effective: ScheduledPost = post ?? {
      id: log.scheduleId,
      title: '(deleted schedule)',
      content: { type: log.contentType },
      recurrence: { kind: 'once' },
      timeOfDay: '00:00',
      targets: 'all',
      enabled: false,
      running: false,
      createdAt: log.startedAt,
      updatedAt: log.startedAt,
    };
    await this.deliver(effective, session, log);
  }

  private resolveTargets(post: ScheduledPost, sessions: WhatsAppSession[]): { session?: WhatsAppSession; skippedReason?: string }[] {
    const selected =
      post.targets === 'all' ? sessions : sessions.filter((s) => post.targets.includes(s.id));

    return selected.map((session) =>
      isSessionUsable(session) ? { session } : { session, skippedReason: 'SESSION_NOT_CONNECTED' },
    );
  }

  private async publishToSession(post: ScheduledPost, session?: WhatsAppSession, skippedReason?: string): Promise<void> {
    const now = this.deps.clock.now().getTime();
    const log: PostLog = {
      id: this.deps.ids.next(),
      scheduleId: post.id,
      sessionId: session?.id ?? 'unknown',
      contentType: post.content.type,
      state: 'pending',
      attempts: 0,
      startedAt: now,
    };
    await this.deps.logs.save(log);
    this.deps.events.publish('log-updated', { logId: log.id });

    if (!session || skippedReason) {
      await this.saveLog({ ...log, state: 'skipped', error: skippedReason ?? 'SESSION_NOT_FOUND', finishedAt: Date.now() });
      return;
    }
    if (!isSessionUsable(session)) {
      await this.saveLog({ ...log, state: 'skipped', error: 'SESSION_NOT_CONNECTED', finishedAt: Date.now() });
      return;
    }

    await this.deliver(post, session, log);
  }

  /** Sends with bounded backoff, mutating the same log row. */
  private async deliver(post: ScheduledPost, session: WhatsAppSession, log: PostLog): Promise<void> {
    let lastError: AppError | undefined;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      await this.saveLog({ ...log, state: 'pending', attempts: attempt, error: undefined });

      try {
        await this.sendOnce(post, session);
        await this.saveLog({ ...log, state: 'sent', attempts: attempt, error: undefined, finishedAt: Date.now() });
        return;
      } catch (err) {
        lastError = AppError.from(err);
        const unrecoverable = ['LOGGED_OUT', 'QR_EXPIRED', 'UNSUPPORTED_TYPE', 'FILE_TOO_LARGE', 'FILE_EMPTY', 'FILE_NOT_FOUND'].includes(lastError.code);
        if (unrecoverable || attempt === MAX_ATTEMPTS) break;

        const backoff = RETRY_BACKOFF_MS[attempt] ?? 0;
        await (this.deps.delay ?? defaultDelay)(backoff);

        // Session may have died while waiting — re-check.
        const fresh = await this.deps.sessions.get(session.id);
        if (!fresh || !isSessionUsable(fresh)) break;
      }
    }

    await this.saveLog({
      ...log,
      state: 'failed',
      attempts: Math.max(log.attempts, 1),
      error: lastError?.code ?? 'UNKNOWN',
      finishedAt: Date.now(),
    });
  }

  private async sendOnce(post: ScheduledPost, session: WhatsAppSession): Promise<void> {
    const { content } = post;

    if (content.type === 'text') {
      const text = content.text ?? '';
      const options = content.textOptions ?? { backgroundColor: '#0E7490', textColor: '#FFFFFF', fontIndex: 0 };
      await this.deps.gateway.sendTextStatus(session.id, text, options);
      return;
    }

    if (!content.mediaId) throw new AppError('MEDIA_REQUIRED');
    const asset = await this.deps.media.get(content.mediaId);
    if (!asset) throw new AppError('FILE_NOT_FOUND', 'Media was deleted');
    const dataUrl = await this.deps.mediaReader.readAsDataUrl(content.mediaId);
    const caption = content.caption || undefined;

    if (content.type === 'image') {
      await this.deps.gateway.sendImageStatus(session.id, dataUrl, caption);
    } else {
      await this.deps.gateway.sendVideoStatus(session.id, dataUrl, caption);
    }
  }

  private async markRunning(post: ScheduledPost, running: boolean): Promise<void> {
    const fresh = await this.deps.schedules.get(post.id);
    if (!fresh) return;
    await this.deps.schedules.save({ ...fresh, running });
    this.deps.events.publish('schedule-updated', { scheduleId: post.id });
  }

  private async finalizeRun(scheduleId: string): Promise<void> {
    const fresh = await this.deps.schedules.get(scheduleId);
    if (!fresh) return;
    const now = this.deps.clock.now();
    const next: ScheduledPost = {
      ...fresh,
      running: false,
      lastRunAt: now.getTime(),
    };
    next.nextRunAt = ScheduleCalculator.nextRunAt(
      { ...next, hasEverRun: true },
      new Date(now.getTime() + 1000),
    );
    await this.deps.schedules.save(next);
    this.deps.events.publish('schedule-updated', { scheduleId });
    this.deps.events.publish('run-finished', { scheduleId });
  }

  private async saveLog(log: PostLog): Promise<void> {
    await this.deps.logs.save(log);
    this.deps.events.publish('log-updated', { logId: log.id });
  }
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
