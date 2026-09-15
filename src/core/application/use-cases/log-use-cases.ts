import { AppError } from '../../domain/errors';
import type { PostLog } from '../../domain/entities/post-log';
import type { LogRepository } from '../ports/repositories';

export class ListLogs {
  constructor(private logs: LogRepository) {}
  async execute(filter?: { state?: PostLog['state'] }): Promise<PostLog[]> {
    return this.logs.list(filter);
  }
}

export class ClearLogs {
  constructor(
    private deps: { logs: LogRepository; events: import('../ports/infrastructure').EventBus },
  ) {}
  async execute(): Promise<void> {
    const all = await this.deps.logs.list();
    for (const log of all) await this.deps.logs.delete(log.id);
    for (const log of all) this.deps.events.publish('log-updated', { logId: log.id });
  }
}

export async function requireLog(repo: LogRepository, id: string): Promise<PostLog> {
  const log = await repo.get(id);
  if (!log) throw new AppError('NOT_FOUND', 'Log not found');
  return log;
}
