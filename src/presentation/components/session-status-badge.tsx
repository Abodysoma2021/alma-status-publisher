'use client';

import * as React from 'react';
import type { SessionStatus } from '@/shared/view-models';
import { cn } from '@/lib/utils';
import { useAlma } from '../providers/alma-provider';

const STATUS_STYLES: Record<SessionStatus, { dot: string; ring: string }> = {
  connected: { dot: 'bg-emerald-500', ring: 'ring-emerald-500/20' },
  connecting: { dot: 'bg-amber-400 animate-pulse', ring: 'ring-amber-400/20' },
  initializing: { dot: 'bg-sky-400 animate-pulse', ring: 'ring-sky-400/20' },
  awaiting_qr: { dot: 'bg-amber-400 animate-pulse', ring: 'ring-amber-400/20' },
  disconnected: { dot: 'bg-zinc-400', ring: 'ring-zinc-400/20' },
  qr_expired: { dot: 'bg-orange-500', ring: 'ring-orange-500/20' },
  logged_out: { dot: 'bg-red-500', ring: 'ring-red-500/20' },
  error: { dot: 'bg-red-500', ring: 'ring-red-500/20' },
};

export function SessionStatusBadge({ status, className }: { status: SessionStatus; className?: string }) {
  const { t } = useAlma();
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.error;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground ring-1',
        style.ring,
        className,
      )}
    >
      <span className={cn('size-1.5 rounded-full', style.dot)} />
      {t(`session.status.${status}`)}
    </span>
  );
}
