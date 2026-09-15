'use client';

import * as React from 'react';
import {
  Smartphone,
  Plus,
  MoreHorizontal,
  Star,
  Pencil,
  Unplug,
  Trash2,
  RefreshCw,
  QrCode,
} from 'lucide-react';
import { AppShell, PageHeader } from '@/presentation/components/app-shell';
import { EmptyState } from '@/presentation/components/empty-state';
import { LinkNumberDialog } from '@/presentation/components/link-number-dialog';
import { SessionStatusBadge } from '@/presentation/components/session-status-badge';
import { useAlma } from '@/presentation/providers/alma-provider';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
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
import type { SessionView } from '@/shared/view-models';
import { useMenuAction } from '@/presentation/hooks/use-menu-action';

type ConfirmAction = 'remove' | 'unlink' | null;

export default function NumbersPage() {
  const { t, sessions, ready, actions } = useAlma();
  const [linkOpen, setLinkOpen] = React.useState(false);
  const [qrSession, setQrSession] = React.useState<SessionView | null>(null);
  const [qrOpen, setQrOpen] = React.useState(false);
  const [renaming, setRenaming] = React.useState<SessionView | null>(null);
  const [renameValue, setRenameValue] = React.useState('');
  const [confirmTarget, setConfirmTarget] = React.useState<{ session: SessionView; action: ConfirmAction } | null>(null);

  // Native menu: File → Link a Number… (⌘L) / Dock menu.
  useMenuAction('numbers:link', () => setLinkOpen(true));

  const showQr = (session: SessionView) => {
    setQrSession(session);
    setQrOpen(true);
  };
  useMenuAction('numbers:show-qr', () => {
    const target = sessions.find((s) => ['initializing', 'awaiting_qr', 'connecting', 'qr_expired', 'disconnected', 'error', 'logged_out'].includes(s.status));
    if (target) showQr(target);
  });

  const openRename = (session: SessionView) => {
    setRenaming(session);
    setRenameValue(session.name);
  };

  const submitRename = async () => {
    if (renaming && renameValue.trim()) {
      await actions.renameSession(renaming.id, renameValue);
    }
    setRenaming(null);
  };

  return (
    <AppShell>
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-8 py-10">
        <PageHeader
          title={t('numbers.title')}
          subtitle={t('numbers.subtitle')}
          actions={
            <Button onClick={() => setLinkOpen(true)}>
              <Plus className="size-4" />
              {t('numbers.link-new')}
            </Button>
          }
        />

        {!ready ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-28 rounded-2xl" />
            <Skeleton className="h-28 rounded-2xl" />
          </div>
        ) : sessions.length === 0 ? (
          <EmptyState
            icon={<Smartphone className="size-6" />}
            title={t('numbers.empty.title')}
            body={t('numbers.empty.body')}
            action={
              <Button onClick={() => setLinkOpen(true)}>
                <Plus className="size-4" />
                {t('numbers.link-new')}
              </Button>
            }
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {sessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                onShowQr={() => showQr(session)}
                onRename={() => openRename(session)}
                onRelink={() => void actions.relinkSession(session.id)}
                onUnlink={() => setConfirmTarget({ session, action: 'unlink' })}
                onRemove={() => setConfirmTarget({ session, action: 'remove' })}
                onSetDefault={() => void actions.setDefaultSession(session.id)}
              />
            ))}
          </div>
        )}
      </div>

      <LinkNumberDialog open={linkOpen} onOpenChange={setLinkOpen} />
      {qrOpen && qrSession && (
        <LinkNumberDialog open session={qrSession} onOpenChange={(next) => { if (!next) setQrSession(null); setQrOpen(next); }} />
      )}

      {/* rename dialog */}
      <AlertDialog open={!!renaming} onOpenChange={(open) => !open && setRenaming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('common.rename')}</AlertDialogTitle>
          </AlertDialogHeader>
          <Input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void submitRename()}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void submitRename()}>{t('common.save')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* remove / unlink confirm */}
      <AlertDialog
        open={!!confirmTarget}
        onOpenChange={(open) => !open && setConfirmTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmTarget?.action === 'remove'
                ? t('numbers.remove-dialog.title')
                : t('numbers.unlink-dialog.title')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmTarget?.action === 'remove'
                ? t('numbers.remove-dialog.body', { name: confirmTarget.session.name })
                : t('numbers.unlink-dialog.body')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className={confirmTarget?.action === 'remove' ? 'bg-destructive text-white hover:bg-destructive/90' : ''}
              onClick={() => {
                if (!confirmTarget) return;
                if (confirmTarget.action === 'remove') void actions.removeSession(confirmTarget.session.id);
                else void actions.unlinkSession(confirmTarget.session.id);
                setConfirmTarget(null);
              }}
            >
              {confirmTarget?.action === 'remove' ? t('common.remove') : t('common.unlink')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

function SessionCard({
  session,
  onShowQr,
  onRename,
  onRelink,
  onUnlink,
  onRemove,
  onSetDefault,
}: {
  session: SessionView;
  onShowQr: () => void;
  onRename: () => void;
  onRelink: () => void;
  onUnlink: () => void;
  onRemove: () => void;
  onSetDefault: () => void;
}) {
  const { t } = useAlma();
  const linked = session.status === 'connected';
  const linking = ['initializing', 'awaiting_qr', 'connecting'].includes(session.status);

  return (
    <Card className="group relative overflow-hidden shadow-none transition hover:border-primary/40">
      <CardContent className="flex items-start justify-between gap-3 p-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 font-semibold text-primary">
            {session.name.slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="truncate font-semibold">{session.name}</p>
              {session.isDefault && (
                <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-400" />
              )}
            </div>
            {session.phoneNumber && (
              <p dir="ltr" className="font-mono text-xs text-muted-foreground">
                {session.phoneNumber}
              </p>
            )}
            <div className="mt-2 flex items-center gap-2">
              <SessionStatusBadge status={session.status} />
              {['initializing', 'awaiting_qr', 'connecting'].includes(session.status) && (
                <Button size="sm" variant="secondary" className="h-7 rounded-full px-3 text-xs" onClick={onShowQr}>
                  <QrCode className="size-3.5" />
                  {t('numbers.show-qr')}
                </Button>
              )}
              {['qr_expired', 'disconnected', 'logged_out', 'error'].includes(session.status) && (
                <Button size="sm" variant="secondary" className="h-7 rounded-full px-3 text-xs" onClick={onRelink}>
                  <RefreshCw className="size-3.5" />
                  {t('numbers.relink')}
                </Button>
              )}
            </div>
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8 shrink-0">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={onRename}>
              <Pencil className="size-4" />
              {t('common.rename')}
            </DropdownMenuItem>
            {!session.isDefault && linked && (
              <DropdownMenuItem onClick={onSetDefault}>
                <Star className="size-4" />
                {t('common.setDefault')}
              </DropdownMenuItem>
            )}
            {(session.status === 'qr_expired' || session.status === 'logged_out' || session.status === 'error') && (
              <DropdownMenuItem onClick={onRelink}>
                <RefreshCw className="size-4" />
                {t('nav.numbers')} — {t('common.retry')}
              </DropdownMenuItem>
            )}
            {linked && (
              <DropdownMenuItem onClick={onUnlink}>
                <Unplug className="size-4" />
                {t('common.unlink')}
              </DropdownMenuItem>
            )}
            {!linked && !linking && (
              <DropdownMenuItem onClick={onRelink}>
                <QrCode className="size-4" />
                {t('numbers.show-qr')}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onRemove}>
              <Trash2 className="size-4" />
              {t('common.remove')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardContent>
    </Card>
  );
}
