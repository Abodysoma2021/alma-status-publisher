import type { ContentType, RecurrenceKind, TextStatusOptions } from '@/shared/view-models';

export type { ContentType, RecurrenceKind, TextStatusOptions };

export interface Recurrence {
  kind: RecurrenceKind;
  daysOfWeek?: number[];
}

export interface StatusContent {
  type: ContentType;
  text?: string;
  textOptions?: TextStatusOptions;
  mediaId?: string;
  caption?: string;
}

export interface ScheduledPost {
  id: string;
  title: string;
  content: StatusContent;
  recurrence: Recurrence;
  runAt?: number;
  timeOfDay: string;
  targets: 'all' | string[];
  enabled: boolean;
  running: boolean;
  lastRunAt?: number;
  nextRunAt?: number;
  createdAt: number;
  updatedAt: number;
}

export const MAX_TEXT_LENGTH = 4000;
export const MAX_CAPTION_LENGTH = 1000;

export class ScheduledPostValidator {
  static validate(post: Pick<ScheduledPost, 'title' | 'content' | 'recurrence' | 'runAt' | 'timeOfDay' | 'targets'>): string[] {
    const errors: string[] = [];
    if (!post.title.trim()) errors.push('TITLE_REQUIRED');
    if (post.title.length > 80) errors.push('TITLE_TOO_LONG');

    const { content } = post;
    if (content.type === 'text') {
      if (!content.text?.trim()) errors.push('TEXT_REQUIRED');
      if ((content.text?.length ?? 0) > MAX_TEXT_LENGTH) errors.push('TEXT_TOO_LONG');
    } else {
      if (!content.mediaId) errors.push('MEDIA_REQUIRED');
      if ((content.caption?.length ?? 0) > MAX_CAPTION_LENGTH) errors.push('CAPTION_TOO_LONG');
    }

    if (post.recurrence.kind === 'weekly') {
      const days = post.recurrence.daysOfWeek ?? [];
      if (days.length === 0) errors.push('WEEKDAY_REQUIRED');
      if (days.some((d) => d < 0 || d > 6)) errors.push('WEEKDAY_INVALID');
    }

    if (post.recurrence.kind === 'once' && !post.runAt) errors.push('RUN_AT_REQUIRED');

    if (!/^\d{2}:\d{2}$/.test(post.timeOfDay)) errors.push('TIME_INVALID');
    else {
      const [h, m] = post.timeOfDay.split(':').map(Number);
      if (h > 23 || m > 59) errors.push('TIME_INVALID');
    }

    if (Array.isArray(post.targets) && post.targets.length === 0) errors.push('TARGETS_REQUIRED');
    return errors;
  }
}
