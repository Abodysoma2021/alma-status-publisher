'use client';

import * as React from 'react';
import { History as HistoryIcon, Trash2, RotateCcw } from 'lucide-react';
import { AppShell, PageHeader } from '@/presentation/components/app-shell';
import { EmptyState } from '@/presentation/components/empty-state';
import { useAlma } from '@/presentation/providers/alma-provider';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { formatDateTime } from '@/presentation/lib/format';
import type { DeliveryState } from '@/shared/view-models';
import { cn } from '@/lib/utils';

const FILTERS: (DeliveryState | 'all')[] = ['all', 'sent', 'failed', 'pending', 'skipped'];

export default function HistoryPage() {
  const { t, locale, logs, ready, actions } = useAlma();
  const [filter, setFilter] = React.useState<DeliveryState | 'all'>('all');
  const [clearOpen, setClearOpen] = React.useState(false);

  const filtered = React.useMemo(
    () => (filter === 'all' ? logs : logs.filter((l) => l.state === filter)),
    [logs, filter],
  );

  const stateStyle: Record<DeliveryState, string> = {
    sent: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    failed: 'bg-red-500/10 text-red-600 dark:text-red-400',
    pending: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 animate-pulse',
    skipped: 'bg-muted text-muted-foreground',
  };

  return (
    <AppShell>
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-8 py-10">
        <PageHeader
          title={t('history.title')}
          subtitle={t('history.subtitle')}
          actions={
            <Tabs value={filter} onValueChange={(v) => setFilter(v as DeliveryState | 'all')}>
              <TabsList>
                {FILTERS.map((f) => (
                  <TabsTrigger key={f} value={f}>
                    {t(`history.filter.${f}`)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          }
        />

        {!ready ? (
          <Skeleton className="h-64 rounded-2xl" />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<HistoryIcon className="size-6" />}
            title={t('history.empty.title')}
            body={t('history.empty.body')}
          />
        ) : (
          <>
            <div className="overflow-hidden rounded-2xl border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>{t('scheduler.dialog.title-label')}</TableHead>
                    <TableHead>{t('numbers.title')}</TableHead>
                    <TableHead>{t('common.status')}</TableHead>
                    <TableHead className="text-end">{t('common.time')}</TableHead>
                    <TableHead className="w-20 text-end" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="max-w-48">
                        <p className="truncate font-medium">{log.scheduleTitle}</p>
                        <p className="text-xs text-muted-foreground">
                          {log.contentType === 'text' ? '📝' : log.contentType === 'image' ? '🖼️' : '🎬'}
                        </p>
                      </TableCell>
                      <TableCell className="max-w-40">
                        <p className="truncate text-sm">{log.sessionName}</p>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <span
                            className={cn(
                              'w-fit rounded-full px-2.5 py-0.5 text-xs font-medium',
                              stateStyle[log.state],
                            )}
                          >
                            {t(`history.state.${log.state}`)}
                          </span>
                          {log.error && (
                            <span className="text-xs text-muted-foreground">
                              {t(`history.errors.${log.error}`) !== `history.errors.${log.error}`
                                ? t(`history.errors.${log.error}`)
                                : t('history.errors.UNKNOWN')}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-end text-xs tabular-nums text-muted-foreground">
                        {formatDateTime(log.finishedAt ?? log.startedAt, locale)}
                        <p className="text-[11px] opacity-70">
                          {t('history.attempts', { count: log.attempts })}
                        </p>
                      </TableCell>
                      <TableCell className="text-end">
                        {log.state === 'failed' && (
                          <Button variant="ghost" size="icon" className="size-7" onClick={() => void actions.retryLog(log.id)}>
                            <RotateCcw className="size-3.5" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex justify-end">
              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setClearOpen(true)}>
                <Trash2 className="size-4" />
                {t('history.clear')}
              </Button>
            </div>
          </>
        )}
      </div>

      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('history.clear-dialog.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('history.clear-dialog.body')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                void actions.clearLogs();
                setClearOpen(false);
              }}
            >
              {t('common.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
