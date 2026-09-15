'use client';

import * as React from 'react';
import QRCode from 'qrcode';
import { Loader2, QrCode, ScanLine, CheckCircle2, RefreshCw, CloudAlert, Trash2, Copy, Unplug } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useAlma } from '../providers/alma-provider';
import { toast } from 'sonner';
import type { SessionView } from '@/shared/view-models';

type Step = 'name' | 'qr' | 'linking' | 'done' | 'expired' | 'failed';

/**
 * The linking dialog covers EVERY scenario:
 *  - new number: name → live QR (or pairing code) → connected
 *  - existing number mid-linking: live QR / connecting
 *  - existing number in a bad state (expired, logged out, error): reason + retry
 *  - already connected: success + phone
 */
export function LinkNumberDialog({
  open,
  onOpenChange,
  session: providedSession,
  onLinked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Existing session to follow (Show QR / Relink flows). */
  session?: SessionView | null;
  onLinked?: () => void;
}) {
  const { t, sessions, actions } = useAlma();
  const [name, setName] = React.useState('');
  const [pairingPhone, setPairingPhone] = React.useState('');
  const [usePairing, setUsePairing] = React.useState(false);
  const [createdSession, setCreatedSession] = React.useState<SessionView | null>(null);
  const [generatedQr, setGeneratedQr] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [restarting, setRestarting] = React.useState(false);
  const [elapsed, setElapsed] = React.useState(0);

  const isExisting = !!providedSession;
  const activeSession = providedSession ?? createdSession;
  const liveSession = activeSession ? sessions.find((s) => s.id === activeSession.id) : undefined;

  // Derive the visible step from the live session lifecycle — no sync effects.
  const step: Step = React.useMemo(() => {
    if (!activeSession) return 'name';
    switch (liveSession?.status) {
      case 'connected':
        return 'done';
      case 'qr_expired':
        return 'expired';
      case 'connecting':
        return 'linking';
      case 'awaiting_qr':
      case 'initializing':
        return 'qr';
      default:
        // error / logged_out / disconnected / not yet seen → visible failure
        return 'failed';
    }
  }, [activeSession, liveSession?.status]);

  const qrDataUrl = liveSession?.qrCode ? generatedQr : null;

  // Render the QR string into a data URL (async external system).
  React.useEffect(() => {
    const qr = liveSession?.qrCode;
    if (!qr) return;
    let cancelled = false;
    void QRCode.toDataURL(qr, {
      width: 260,
      margin: 1,
      color: { dark: '#0b1220', light: '#ffffff' },
    }).then((url) => {
      if (!cancelled) setGeneratedQr(url);
    });
    return () => {
      cancelled = true;
    };
  }, [liveSession?.qrCode]);

  // Elapsed timer so the wait is visibly alive, never frozen.
  const sessionId = activeSession?.id ?? null;
  React.useEffect(() => {
    if (!sessionId || step === 'name' || step === 'done') return;
    const startedAt = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 500);
    return () => clearInterval(timer);
  }, [sessionId, step]);

  const mmss = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;

  const reset = React.useCallback(() => {
    // A freshly-created session that is abandoned mid-linking gets cleaned up;
    // an existing session passed via props is never touched on close.
    if (!isExisting && createdSession && step !== 'done') void actions.cancelLinking(createdSession.id);
    setCreatedSession(null);
    setName('');
    setPairingPhone('');
    setUsePairing(false);
    setGeneratedQr(null);
    setSubmitting(false);
    setRestarting(false);
  }, [actions, isExisting, createdSession, step]);

  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const submit = async () => {
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    const created = await actions.startLinking(name, usePairing && pairingPhone ? pairingPhone : undefined);
    if (created) setCreatedSession(created);
    else setSubmitting(false);
  };

  const restartQr = async () => {
    if (!activeSession) return;
    setRestarting(true);
    setGeneratedQr(null);
    await actions.relinkSession(activeSession.id);
    setRestarting(false);
  };

  const removeAndClose = async () => {
    if (!activeSession) return;
    if (isExisting) await actions.removeSession(activeSession.id);
    else await actions.cancelLinking(activeSession.id);
    setCreatedSession(null);
    setName('');
    setGeneratedQr(null);
    setSubmitting(false);
    onOpenChange(false);
  };

  const copyPairing = () => {
    if (liveSession?.pairingCode) {
      void navigator.clipboard.writeText(liveSession.pairingCode);
      toast.success(t('common.copy') === 'common.copy' ? 'Copied' : t('common.copied'));
    }
  };

  const preparing = step === 'qr' && !qrDataUrl && elapsed < 20;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md" onInteractOutside={(e) => step !== 'name' && step !== 'done' && e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>
            {activeSession ? `${t('numbers.link-dialog.title')} — ${activeSession.name}` : t('numbers.link-dialog.title')}
          </DialogTitle>
          <DialogDescription>
            {step === 'name'
              ? t('numbers.link-dialog.step-name')
              : step === 'failed'
                ? t('numbers.link-dialog.step-failed')
                : step === 'done'
                  ? t('numbers.link-dialog.connected')
                  : t('numbers.link-dialog.step-qr')}
          </DialogDescription>
        </DialogHeader>

        {step === 'name' && (
          <div className="flex flex-col gap-4">
            <div className="grid gap-2">
              <Label htmlFor="session-name">{t('common.name')}</Label>
              <Input
                id="session-name"
                autoFocus
                value={name}
                placeholder={t('numbers.link-dialog.name-placeholder')}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void submit()}
              />
            </div>

            <Separator />

            <div className="grid gap-2">
              <button
                type="button"
                onClick={() => setUsePairing((v) => !v)}
                className="text-start text-sm text-muted-foreground underline-offset-2 hover:underline"
              >
                {usePairing ? '− ' : '+ '}
                {t('numbers.link-dialog.or-pair')}
              </button>
              {usePairing && (
                <Input
                  dir="ltr"
                  value={pairingPhone}
                  placeholder={t('numbers.link-dialog.phone-placeholder')}
                  onChange={(e) => setPairingPhone(e.target.value)}
                />
              )}
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={() => handleClose(false)}>
                {t('common.cancel')}
              </Button>
              <Button onClick={() => void submit()} disabled={!name.trim() || submitting}>
                {submitting && <Loader2 className="size-4 animate-spin" />}
                {t('common.confirm')}
              </Button>
            </DialogFooter>
          </div>
        )}

        {(step === 'qr' || step === 'expired') && liveSession && (
          <div className="flex flex-col items-center gap-4 py-2">
            {step === 'expired' ? (
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="flex size-14 items-center justify-center rounded-full bg-orange-500/10 text-orange-500">
                  <RefreshCw className="size-6" />
                </div>
                <p className="text-sm text-muted-foreground">{t('error.QR_EXPIRED')}</p>
                <Button variant="outline" size="sm" onClick={() => void restartQr()} disabled={restarting}>
                  {restarting ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                  {t('common.retry')}
                </Button>
              </div>
            ) : qrDataUrl ? (
              <div className="relative rounded-2xl bg-white p-3 shadow-sm ring-1 ring-border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrDataUrl} alt="WhatsApp QR" width={236} height={236} className="rounded-lg" />
                <ScanLine className="absolute end-3 top-3 size-5 text-primary/40" />
              </div>
            ) : (
              <div className="flex size-[260px] items-center justify-center rounded-2xl border border-dashed">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              </div>
            )}

            {liveSession.pairingCode && (
              <div className="rounded-xl bg-primary/10 px-4 py-2 text-center">
                <p className="text-xs text-muted-foreground">{t('numbers.link-dialog.pairing-code')}</p>
                <button
                  type="button"
                  dir="ltr"
                  onClick={copyPairing}
                  className="flex items-center gap-2 font-mono text-2xl font-bold tracking-[0.35em] text-primary"
                  aria-label="copy pairing code"
                >
                  {liveSession.pairingCode}
                  <Copy className="size-4" />
                </button>
              </div>
            )}

            <div className="text-center text-xs text-muted-foreground">
              <p>{t('numbers.link-dialog.hint')}</p>
              <p className="mt-1 tabular-nums">
                {preparing
                  ? t('numbers.link-dialog.preparing')
                  : step === 'qr' && !qrDataUrl
                    ? t('numbers.link-dialog.waiting')
                    : mmss}
              </p>
            </div>
          </div>
        )}

        {step === 'linking' && (
          <div className="flex flex-col items-center gap-4 py-10 text-center">
            <Loader2 className="size-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">{t('numbers.link-dialog.linking')}</p>
            <p className="font-mono text-xs text-muted-foreground tabular-nums">{mmss}</p>
          </div>
        )}

        {step === 'failed' && liveSession && (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <div className="flex size-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <CloudAlert className="size-7" />
            </div>
            <div>
              <p className="font-semibold">{t('numbers.link-dialog.failed-title')}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t(`error.${liveSession.lastError ?? 'UNKNOWN'}`) === `error.${liveSession.lastError ?? 'UNKNOWN'}`
                  ? t('error.UNKNOWN')
                  : t(`error.${liveSession.lastError ?? 'UNKNOWN'}`)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={() => void restartQr()} disabled={restarting}>
                {restarting ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                {t('common.retry')}
              </Button>
              <Button variant="ghost" onClick={() => void removeAndClose()}>
                <Trash2 className="size-4" />
                {t('common.remove')}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t('numbers.link-dialog.failed-hint')}</p>
          </div>
        )}

        {step === 'done' && liveSession && (
          <div className="flex flex-col items-center gap-4 py-8 text-center">
            <CheckCircle2 className="size-12 text-emerald-500" />
            <p className="font-semibold">{t('numbers.link-dialog.connected')}</p>
            {liveSession.phoneNumber && (
              <p dir="ltr" className="font-mono text-sm text-muted-foreground">
                {liveSession.phoneNumber}
              </p>
            )}
            <div className="flex items-center gap-2">
              {isExisting && (
                <Button
                  variant="outline"
                  onClick={() => {
                    void actions.unlinkSession(liveSession.id);
                    onOpenChange(false);
                  }}
                >
                  <Unplug className="size-4" />
                  {t('common.unlink')}
                </Button>
              )}
              <Button
                onClick={() => {
                  onLinked?.();
                  setCreatedSession(null);
                  setName('');
                  setGeneratedQr(null);
                  setSubmitting(false);
                  onOpenChange(false);
                }}
              >
                <QrCode className="size-4" />
                {isExisting ? t('common.close') : t('numbers.link-new')}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
