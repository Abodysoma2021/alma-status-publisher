import type { ContentType, DeliveryState } from '@/shared/view-models';

export interface PostLog {
  id: string;
  scheduleId: string;
  sessionId: string;
  contentType: ContentType;
  state: DeliveryState;
  attempts: number;
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

export function isLogRetryable(log: PostLog): boolean {
  return log.state === 'failed';
}
