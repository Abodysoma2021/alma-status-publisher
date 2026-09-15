'use client';

import * as React from 'react';
import { CalendarClock, Plus, MoreHorizontal, Pencil, Trash2, Play, Copy } from 'lucide-react';
import { AppShell, PageHeader } from '@/presentation/components/app-shell';
import { EmptyState } from '@/presentation/components/empty-state';
import { ScheduleDialog } from '@/presentation/components/schedule-dialog';
import { useAlma } from '@/presentation/providers/alma-provider';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { formatDateTime, formatRelative } from '@/presentation/lib/format';
import { useMenuAction } from '@/presentation/hooks/use-menu-action';
import type { ScheduleView, ContentType } from '@/shared/view-models';

const CONTENT_ICON: Record<ContentType, string> = {
  text: '📝',
  image: '🖼️',
  video: '🎬',
};

export default function SchedulerPage() {
  const { t, schedules, sessions, ready, actions } = useAlma();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<ScheduleView | undefined>(undefined);
  const [deleting, setDeleting] = React.useState<ScheduleView | null>(null);

  const openCreate = () => {
    setEditing(undefined);
    setDialogOpen(true);
  };

  // Native menu: File → New Scheduled Status (⌘N) / Dock menu.
  useMenuAction('schedule:new', openCreate);

  const openEdit = (schedule: ScheduleView) => {
    setEditing(schedule);
    setDialogOpen(true);
  };

  return (
    <AppShell>
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-8 py-10">
        <PageHeader
          title={t('scheduler.title')}
          subtitle={t('scheduler.subtitle')}
          actions={
            <Button onClick={openCreate} disabled={sessions.length === 0}>
              <Plus className="size-4" />
              {t('scheduler.new')}
            </Button>
          }
        />

        {!ready ? (
          <Skeleton className="h-48 rounded-2xl" />
        ) : schedules.length === 0 ? (
          <EmptyState
            icon={<CalendarClock className="size-6" />}
            title={t('scheduler.empty.title')}
            body={t('scheduler.empty.body')}
            action={
              sessions.length > 0 ? (
                <Button onClick={openCreate}>
                  <Plus className="size-4" />
                  {t('scheduler.new')}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="flex flex-col gap-2">
            {schedules.map((schedule) => (
              <ScheduleRow
                key={schedule.id}
                schedule={schedule}
                onToggle={(enabled) => void actions.toggleSchedule(schedule.id, enabled)}
                onEdit={() => openEdit(schedule)}
                onDelete={() => setDeleting(schedule)}
                onRunNow={() => void actions.runScheduleNow(schedule.id)}
                onDuplicate={() =>
                  void actions.createSchedule({
                    title: `${schedule.title} (2)`,
                    contentType: schedule.content.type,
                    text: schedule.content.text,
                    textOptions: schedule.content.textOptions,
                    mediaId: schedule.content.mediaId,
                    caption: schedule.content.caption,
                    recurrence: schedule.recurrence,
                    runAt: schedule.runAt ? schedule.runAt + 24 * 3600 * 1000 : undefined,
                    timeOfDay: schedule.timeOfDay,
                    targets: schedule.targets,
                    enabled: false,
                  })
                }
              />
            ))}
          </div>
        )}
      </div>

      {dialogOpen && <ScheduleDialog onOpenChange={setDialogOpen} editing={editing} />}

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('scheduler.dialog.delete-title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting && t('scheduler.dialog.delete-body', { title: deleting.title })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                if (deleting) void actions.deleteSchedule(deleting.id);
                setDeleting(null);
              }}
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

function ScheduleRow({
  schedule,
  onToggle,
  onEdit,
  onDelete,
  onRunNow,
  onDuplicate,
}: {
  schedule: ScheduleView;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  onRunNow: () => void;
  onDuplicate: () => void;
}) {
  const { t, locale } = useAlma();

  const recurrenceLabel =
    schedule.recurrence.kind === 'weekly'
      ? (schedule.recurrence.daysOfWeek ?? [])
          .map((d) => t(`day.${['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][d]}`))
          .slice(0, 3)
          .join(' · ') + ((schedule.recurrence.daysOfWeek?.length ?? 0) > 3 ? '…' : '')
      : t(`scheduler.dialog.${schedule.recurrence.kind}`);

  return (
    <div
      className={`flex flex-wrap items-center gap-3 rounded-2xl border p-4 transition ${
        schedule.enabled ? 'bg-card' : 'bg-muted/40'
      }`}
    >
      <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-lg">
        {CONTENT_ICON[schedule.content.type]}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className={`truncate text-sm font-semibold ${schedule.enabled ? '' : 'text-muted-foreground'}`}>
            {schedule.title}
          </p>
          {schedule.running && (
            <Badge className="animate-pulse" variant="default">
              {t('scheduler.running')}
            </Badge>
          )}
          {!schedule.enabled && schedule.recurrence.kind === 'once' && schedule.lastRunAt && (
            <Badge variant="secondary">{t('scheduler.finished')}</Badge>
          )}
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {recurrenceLabel}
          {schedule.recurrence.kind !== 'once' && ` · ${schedule.timeOfDay}`}
        </p>
      </div>

      <div className="text-end">
        <p className="text-xs text-muted-foreground">{t('scheduler.next-run')}</p>
        <p className="text-xs font-medium tabular-nums">
          {schedule.running
            ? '…'
            : schedule.nextRunAt
              ? `${formatRelative(schedule.nextRunAt, locale)} · ${formatDateTime(schedule.nextRunAt, locale)}`
              : '—'}
        </p>
      </div>

      <Switch checked={schedule.enabled} onCheckedChange={onToggle} disabled={schedule.running} />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8">
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onClick={onRunNow} disabled={schedule.running}>
            <Play className="size-4" />
            {t('common.runNow')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onEdit} disabled={schedule.running}>
            <Pencil className="size-4" />
            {t('common.edit')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onDuplicate}>
            <Copy className="size-4" />
            {t('scheduler.new')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            <Trash2 className="size-4" />
            {t('common.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
