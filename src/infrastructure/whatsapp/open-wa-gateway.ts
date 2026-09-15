import * as path from 'node:path';
import * as fsp from 'node:fs/promises';
import { create, ev, type Client } from '@open-wa/wa-automate';
import type {
  GatewayEvent,
  GatewayEventListener,
  WhatsAppGateway,
} from '../../core/application/ports/whatsapp-gateway';
import { AppError } from '../../core/domain/errors';

type RuntimeState = 'starting' | 'awaiting_scan' | 'connected' | 'closing';

interface SessionRuntime {
  client?: Client;
  state: RuntimeState;
  starting: boolean;
  cancelRequested: boolean;
  launchAttempts: number;
  /** Exact-name listeners registered for this session (for cleanup). */
  detachListeners?: () => void;
  watchdog?: NodeJS.Timeout;
}

/**
 * open-wa (wa-automate) adapter. One Puppeteer browser per linked number.
 *
 * Event routing: open-wa emits on a global emitter with namespaced event
 * names `namespace.sessionId` (e.g. `qr.session-1`). We attach EXACT-name
 * listeners per session — never wildcard patterns, which are unreliable
 * across eventemitter2 versions — so args are always (data, sessionId, ns).
 */
export class OpenWaGateway implements WhatsAppGateway {
  private runtimes = new Map<string, SessionRuntime>();
  private listeners = new Set<GatewayEventListener>();

  /** Watchdog: how long a launch may take (incl. first-run Chromium download). */
  private static LAUNCH_TIMEOUT_MS = 300_000;
  /** Transient browser failures get one automatic relaunch. */
  private static MAX_LAUNCH_ATTEMPTS = 2;

  constructor(private readonly waSessionsDir: string) {}

  onEvent(listener: GatewayEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  isConnected(sessionId: string): boolean {
    const runtime = this.runtimes.get(sessionId);
    return runtime?.state === 'connected' && !!runtime?.client;
  }

  async startSession(sessionId: string, pairingPhone?: string): Promise<void> {
    const existing = this.runtimes.get(sessionId);
    if (existing?.starting) return;

    if (existing) {
      // Stale runtime from a previous lifecycle — tear it down first.
      await this.killQuietly(sessionId);
      this.teardownRuntime(sessionId);
    }

    const runtime: SessionRuntime = {
      state: 'starting',
      starting: true,
      cancelRequested: false,
      launchAttempts: (existing?.launchAttempts ?? 0),
    };
    this.runtimes.set(sessionId, runtime);
    this.attachSessionListeners(sessionId);
    this.dispatch({ sessionId, type: 'starting' });
    this.armWatchdog(sessionId);

    try {
      await fsp.mkdir(this.waSessionsDir, { recursive: true });

      const client = await create({
        sessionId,
        sessionDataPath: this.waSessionsDir,
        multiDevice: true,
        headless: true,
        useChrome: false,
        authTimeout: 0,
        qrTimeout: 180,
        qrLogSkip: true,
        skipUpdateCheck: true,
        blockCrashLogs: true,
        throwErrorOnTosBlock: false,
        resizable: false,
        linkCode: pairingPhone || undefined,
        chromiumArgs: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      });

      if (runtime.cancelRequested) {
        await this.killQuietly(sessionId, client);
        this.teardownRuntime(sessionId);
        return;
      }

      this.clearWatchdog(runtime);
      runtime.client = client;
      runtime.state = 'connected';
      runtime.starting = false;

      // Reliable client-level lifecycle hooks (complement the ev listeners).
      void client.onLogout(() => {
        if (this.runtimes.get(sessionId)?.state === 'connected') {
          runtime.state = 'starting'; // not postable anymore
          this.dispatch({ sessionId, type: 'logged_out' });
        }
      });
      void client.onStateChanged((state) => {
        const s = String(state || '').toUpperCase();
        if (['DISCONNECTED', 'CONFLICT', 'UNLAUNCHED', 'TIMEOUT'].includes(s) && runtime.state === 'connected') {
          runtime.state = 'starting'; // down; WA may self-recover
          this.dispatch({ sessionId, type: 'disconnected' });
        } else if (['CONNECTED', 'SYNCING'].includes(s) && runtime.state !== 'connected' && runtime.client) {
          runtime.state = 'connected'; // WA auto-reconnected
          this.dispatch({ sessionId, type: 'connected' });
        }
      });

      // Best-effort phone number detection for display.
      let phone: string | undefined;
      try {
        const me = (await client.getMe()) as { user?: string; pushname?: string } | undefined;
        if (me?.user) phone = `+${me.user.replace(/\D/g, '')}`;
      } catch {
        /* non-fatal */
      }

      this.dispatch({ sessionId, type: 'connected', payload: phone });
    } catch (err) {
      this.clearWatchdog(runtime);
      runtime.starting = false;

      if (runtime.cancelRequested) {
        this.teardownRuntime(sessionId);
        return;
      }

      const appErr = AppError.from(err);
      const mapped: GatewayEvent['type'] = mapCreateError(err);

      // One automatic relaunch for transient browser failures (download
      // hiccups, crashed first launch, …). QR/credential failures never retry.
      const transient =
        mapped === 'error' && runtime.launchAttempts + 1 < OpenWaGateway.MAX_LAUNCH_ATTEMPTS;

      if (transient) {
        runtime.launchAttempts += 1;
        await delay(3000);
        if (runtime.cancelRequested) {
          this.teardownRuntime(sessionId);
          return;
        }
        this.dispatch({ sessionId, type: 'starting' });
        return this.startSession(sessionId, pairingPhone);
      }

      this.teardownRuntime(sessionId);
      this.dispatch({ sessionId, type: mapped, payload: appErr.code ?? errorMessage(err) });
    }
  }

  async cancelSession(sessionId: string): Promise<void> {
    const runtime = this.runtimes.get(sessionId);
    if (!runtime) return;
    runtime.cancelRequested = true;
    this.clearWatchdog(runtime);
    await this.killQuietly(sessionId);
    this.teardownRuntime(sessionId);
  }

  async closeSession(sessionId: string): Promise<void> {
    const runtime = this.runtimes.get(sessionId);
    if (!runtime) return;
    if (!runtime.client) {
      this.teardownRuntime(sessionId);
      return;
    }
    runtime.state = 'closing';
    try {
      // kill() tears down the browser; open-wa persists session data on disk.
      await Promise.race([runtime.client.kill(), delay(5000)]);
    } catch {
      /* ignore */
    }
    this.teardownRuntime(sessionId);
  }

  async wipeSessionData(sessionId: string): Promise<void> {
    const candidates = [
      path.join(this.waSessionsDir, `${sessionId}.data.json`),
      path.join(this.waSessionsDir, 'session.data.json'),
    ];
    for (const file of candidates) {
      await fsp.rm(file, { force: true }).catch(() => undefined);
    }
  }

  async sendTextStatus(sessionId: string, text: string, options: { backgroundColor: string; textColor: string; fontIndex: number }): Promise<void> {
    const client = this.requireClient(sessionId);
    const result = await client.postTextStatus(text, options.textColor, options.backgroundColor, options.fontIndex);
    assertPosted(result, 'text');
  }

  async sendImageStatus(sessionId: string, imageDataUrl: string, caption?: string): Promise<void> {
    const client = this.requireClient(sessionId);
    const result = await client.postImageStatus(imageDataUrl as never, caption ?? '');
    assertPosted(result, 'image');
  }

  async sendVideoStatus(sessionId: string, videoDataUrl: string, caption?: string): Promise<void> {
    const client = this.requireClient(sessionId);
    const result = await client.postVideoStatus(videoDataUrl as never, caption ?? '');
    assertPosted(result, 'video');
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.runtimes.keys()].map((id) => this.closeSession(id)));
  }

  // ---- internals ----

  /**
   * Exact-name listeners for this session only. Verified against
   * eventemitter2: exact names always fire with (data, sessionId, namespace);
   * the documented '**.**' wildcard does NOT fire for two-segment events.
   */
  private attachSessionListeners(sessionId: string): void {
    const runtime = this.runtimes.get(sessionId);
    if (!runtime || runtime.detachListeners) return;

    const handlers: [string, Parameters<typeof ev.on>[1]][] = [
      [`qr.${sessionId}`, (data: unknown) => this.handleLibraryEvent(sessionId, 'qr', data)],
      [`sessionData.${sessionId}`, (data: unknown) => this.handleLibraryEvent(sessionId, 'sessionData', data)],
      [`sessionDataBase64.${sessionId}`, (data: unknown) => this.handleLibraryEvent(sessionId, 'sessionData', data)],
      [`STARTUP.${sessionId}`, (data: unknown) => this.handleLibraryEvent(sessionId, 'STARTUP', data)],
    ];

    for (const [event, handler] of handlers) ev.on(event, handler);
    runtime.detachListeners = () => {
      for (const [event, handler] of handlers) ev.off(event, handler);
    };
  }

  private handleLibraryEvent(sessionId: string, namespace: string, data: unknown): void {
    const runtime = this.runtimes.get(sessionId);
    if (!runtime) return;

    switch (namespace) {
      case 'qr': {
        const value = typeof data === 'string' ? data : String(data ?? '');
        if (!value) return;
        if (value.length === 9) this.dispatch({ sessionId, type: 'pairing_code', payload: value });
        else this.dispatch({ sessionId, type: 'qr', payload: value });
        break;
      }
      case 'sessionData':
        // First authentication payload — the QR was scanned / number linked.
        if (runtime.state === 'starting') {
          runtime.state = 'awaiting_scan';
          this.dispatch({ sessionId, type: 'connecting' });
        }
        break;
      case 'STARTUP': {
        const message = typeof data === 'string' ? data : undefined;
        if (message === 'qrTimeout') this.dispatch({ sessionId, type: 'qr_expired' });
        else if (message === 'successfulScan') {
          if (runtime.state === 'starting') {
            runtime.state = 'awaiting_scan';
            this.dispatch({ sessionId, type: 'connecting' });
          }
        } else if (message === 'appOffline') this.dispatch({ sessionId, type: 'error', payload: 'NO_INTERNET' });
        else if (message === 'authTimeout') this.dispatch({ sessionId, type: 'error', payload: 'GATEWAY_TIMEOUT' });
        break;
      }
      default:
        break;
    }
  }

  /** Guards against a launch that never resolves (e.g. stuck download). */
  private armWatchdog(sessionId: string): void {
    const runtime = this.runtimes.get(sessionId);
    if (!runtime) return;
    this.clearWatchdog(runtime);
    runtime.watchdog = setTimeout(() => {
      if (runtime.starting && this.runtimes.get(sessionId) === runtime) {
        void this.killQuietly(sessionId);
        this.teardownRuntime(sessionId);
        this.dispatch({ sessionId, type: 'error', payload: 'BROWSER_ERROR' });
      }
    }, OpenWaGateway.LAUNCH_TIMEOUT_MS);
    runtime.watchdog.unref?.();
  }

  private clearWatchdog(runtime: SessionRuntime): void {
    if (runtime.watchdog) clearTimeout(runtime.watchdog);
    runtime.watchdog = undefined;
  }

  private teardownRuntime(sessionId: string): void {
    const runtime = this.runtimes.get(sessionId);
    if (!runtime) return;
    this.clearWatchdog(runtime);
    runtime.detachListeners?.();
    this.runtimes.delete(sessionId);
  }

  private async killQuietly(sessionId: string, client?: Client): Promise<void> {
    const target = client ?? this.runtimes.get(sessionId)?.client;
    if (!target) return;
    try {
      await Promise.race([target.kill(), delay(4000)]);
    } catch {
      /* ignore */
    }
    const runtime = this.runtimes.get(sessionId);
    if (runtime && runtime.client === target) runtime.client = undefined;
  }

  private requireClient(sessionId: string): Client {
    const runtime = this.runtimes.get(sessionId);
    if (!runtime?.client || runtime.state !== 'connected') {
      throw new AppError('SESSION_NOT_CONNECTED', `Session ${sessionId} is not connected`);
    }
    return runtime.client;
  }

  private dispatch(event: GatewayEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* listener isolation */
      }
    }
  }
}

function mapCreateError(err: unknown): GatewayEvent['type'] {
  const message = errorMessage(err).toLowerCase();
  if (message.includes('qr timeout') || message.includes('qrtimeout')) return 'qr_expired';
  if (message.includes('logged out') || message.includes('authenticat') || message.includes('deactivated')) return 'logged_out';
  if (message.includes('offline') || message.includes('internet') || message.includes('network')) return 'error';
  return 'error';
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err ?? 'Unknown error');
}

function assertPosted(result: unknown, kind: string): void {
  if (result === false || result === undefined || result === null) {
    throw new AppError('WHATSAPP_ERROR', `WhatsApp rejected the ${kind} status`);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
