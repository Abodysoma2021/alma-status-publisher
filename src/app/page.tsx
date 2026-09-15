'use client';

import * as React from 'react';
import { Smartphone, CalendarClock, CheckCircle2, XCircle, Plus, Link2 } from 'lucide-react';
import { AppShell, PageHeader } from '@/presentation/components/app-shell';
import { EmptyState } from '@/presentation/components/empty-state';
import { LinkNumberDialog } from '@/presentation/components/link-number-dialog';
import { ScheduleDialog } from '@/presentation/components/schedule-dialog';
import { useAlma } from '@/presentation/providers/alma-provider';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatRelative } from '@/presentation/lib/format';
import { useMenuAction } from '@/presentation/hooks/use-menu-action';

function greetingKey(hour: number): string {
  if (hour < 12) return 'dashboard.greeting.morning';
  if (hour < 18) return 'dashboard.greeting.afternoon';
  return 'dashboard.greeting.evening';
}

export default function DashboardPage() {
  const { t, locale, dashboard, sessions, ready } = useAlma();
  const [linkOpen, setLinkOpen] = React.useState(false);
  const [scheduleOpen, setScheduleOpen] = React.useState(false);

  useMenuAction('schedule:new', () => setScheduleOpen(true));
  useMenuAction('numbers:link', () => setLinkOpen(true));

  const stats = [
    {
      key: 'dashboard.stat.numbers',
      value: dashboard ? `${dashboard.totalSessions}` : '—',
      icon: Smartphone,
      tone: 'text-sky-500 bg-sky-500/10',
    },
    {
      key: 'dashboard.stat.connected',
      value: dashboard ? `${dashboard.connectedSessions}` : '—',
      icon: Link2,
      tone: 'text-emerald-500 bg-emerald-500/10',
    },
    {
      key: 'dashboard.stat.active',
      value: dashboard ? `${dashboard.activeSchedules}` : '—',
      icon: CalendarClock,
      tone: 'text-indigo-500 bg-indigo-500/10',
    },
    {
      key: 'dashboard.stat.sent-today',
      value: dashboard ? `${dashboard.sentToday}` : '—',
      icon: CheckCircle2,
      tone: 'text-teal-500 bg-teal-500/10',
    },
    {
      key: 'dashboard.stat.failed-today',
      value: dashboard ? `${dashboard.failedToday}` : '—',
      icon: XCircle,
      tone: 'text-red-500 bg-red-500/10',
    },
  ];

  return (
    <AppShell>
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-8 py-10">
        <PageHeader
          title={`${t(greetingKey(new Date().getHours()))} 👋`}
          subtitle={t('app.tagline')}
          actions={
            <>
              <Button variant="secondary" onClick={() => setLinkOpen(true)}>
                <Plus className="size-4" />
                {t('dashboard.quick.link')}
              </Button>
              <Button onClick={() => setScheduleOpen(true)} disabled={sessions.length === 0}>
                <Plus className="size-4" />
                {t('dashboard.quick.schedule')}
              </Button>
            </>
          }
        />

        {/* stats */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {stats.map(({ key, value, icon: Icon, tone }) => (
            <Card key={key} className="border-border/70 shadow-none">
              <CardContent className="flex flex-col gap-2 p-4">
                <span className={`flex size-8 items-center justify-center rounded-lg ${tone}`}>
                  <Icon className="size-4" />
                </span>
                <span className="text-2xl font-bold tabular-nums">{value}</span>
                <span className="text-xs text-muted-foreground">{t(key)}</span>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* first-run CTA */}
        {ready && sessions.length === 0 && (
          <EmptyState
            icon={<Smartphone className="size-6" />}
            title={t('dashboard.cta.no-numbers.title')}
            body={t('dashboard.cta.no-numbers.body')}
            action={
              <Button onClick={() => setLinkOpen(true)}>
                <Plus className="size-4" />
                {t('numbers.link-new')}
              </Button>
            }
          />
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          {/* upcoming */}
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-muted-foreground">{t('dashboard.upcoming')}</h2>
            {!ready ? (
              <Skeleton className="h-36 rounded-2xl" />
            ) : dashboard && dashboard.upcoming.length > 0 ? (
              <div className="flex flex-col gap-2">
                {dashboard.upcoming.map((schedule) => (
                  <Card key={schedule.id} className="shadow-none">
                    <CardContent className="flex items-center justify-between gap-3 p-4">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{schedule.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {t(`scheduler.dialog.${schedule.recurrence.kind === 'once' ? 'once' : schedule.recurrence.kind === 'daily' ? 'daily' : 'weekly'}`)}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                        {formatRelative(schedule.nextRunAt, locale)}
                      </span>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<CalendarClock className="size-6" />}
                title={t('dashboard.upcoming.empty')}
                className="py-10"
                action={
                  sessions.length > 0 ? (
                    <Button size="sm" variant="outline" onClick={() => setScheduleOpen(true)}>
                      <Plus className="size-4" />
                      {t('scheduler.new')}
                    </Button>
                  ) : undefined
                }
              />
            )}
          </section>

          {/* recent activity */}
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-muted-foreground">{t('dashboard.recent')}</h2>
            {!ready ? (
              <Skeleton className="h-36 rounded-2xl" />
            ) : (
              <RecentActivity />
            )}
          </section>
        </div>
      </div>

      <LinkNumberDialog open={linkOpen} onOpenChange={setLinkOpen} />
      {scheduleOpen && <ScheduleDialog onOpenChange={setScheduleOpen} />}
    </AppShell>
  );
}

function RecentActivity() {
  const { logs, t, locale } = useAlma();
  const recent = logs.slice(0, 6);

  if (recent.length === 0) {
    return <EmptyState title={t('dashboard.recent.empty')} className="py-10" />;
  }

  return (
    <div className="flex flex-col gap-2">
      {recent.map((log) => (
        <div
          key={log.id}
          className="flex items-center justify-between gap-3 rounded-xl border px-4 py-3"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{log.scheduleTitle}</p>
            <p className="truncate text-xs text-muted-foreground">
              {log.sessionName} · {formatRelative(log.startedAt, locale)}
            </p>
          </div>
          <span
            className={
              log.state === 'sent'
                ? 'rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400'
                : log.state === 'failed'
                  ? 'rounded-full bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-600 dark:text-red-400'
                  : 'rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground'
            }
          >
            {t(`history.state.${log.state}`)}
          </span>
        </div>
      ))}
    </div>
  );
}
