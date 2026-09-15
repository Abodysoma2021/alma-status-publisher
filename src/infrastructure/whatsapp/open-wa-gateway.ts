import * as path from 'node:path';
import * as fsp from 'node:fs/promises';
import { create, ev, type Client, type DataURL } from '@open-wa/wa-automate';
import type {
  GatewayEvent,
  GatewayEventListener,
  WhatsAppGateway,
} from '../../core/application/ports/whatsapp-gateway';
import { AppError } from '../../core/domain/errors';

type RuntimeState = 'idle' | 'starting' | 'awaiting_scan' | 'connected' | 'closing';

interface SessionRuntime {
  client?: Client;
  state: RuntimeState;
  starting: boolean;
  cancelRequested: boolean;
}

/**
 * open-wa (wa-automate) adapter. One Puppeteer browser per linked number.
 *
 * Event routing: open-wa exposes a global emitter (`ev`) where every event is
 * namespaced `namespace.sessionId`; we subscribe with the `**.**` wildcard once
 * and demultiplex, then translate raw library events into GatewayEvents.
 */
export class OpenWaGateway implements WhatsAppGateway {
  private runtimes = new Map<string, SessionRuntime>();
  private listeners = new Set<GatewayEventListener>();
  private globalListenerBound = false;

  constructor(private readonly waSessionsDir: string) {}

  onEvent(listener: GatewayEventListener): () => void {
    this.listeners.add(listener);
    this.bindGlobalListener();
    return () => this.listeners.delete(listener);
  }

  isConnected(sessionId: string): boolean {
    return this.runtimes.get(sessionId)?.state === 'connected' && !!this.runtimes.get(sessionId)?.client;
  }

  async startSession(sessionId: string, pairingPhone?: string): Promise<void> {
    this.bindGlobalListener();

    const existing = this.runtimes.get(sessionId);
    if (existing?.starting) return;
    if (existing?.client) {
      // Stale browser from a previous lifecycle — kill before relinking.
      await this.killQuietly(sessionId);
    }

    const runtime: SessionRuntime = { state: 'starting', starting: true, cancelRequested: false };
    this.runtimes.set(sessionId, runtime);
    this.dispatch({ sessionId, type: 'starting' });

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
        this.runtimes.delete(sessionId);
        return;
      }

      runtime.client = client;
      runtime.state = 'connected';
      runtime.starting = false;

      // Reliable client-level lifecycle hooks (complement the ev wildcard).
      void client.onLogout(() => {
        if (this.runtimes.get(sessionId)?.state === 'connected') {
          runtime.state = 'idle';
          this.dispatch({ sessionId, type: 'logged_out' });
        }
      });
      void client.onStateChanged((state) => {
        const s = String(state || '').toUpperCase();
        const wasConnected = runtime.state === 'connected';
        if (['DISCONNECTED', 'CONFLICT', 'UNLAUNCHED', 'TIMEOUT'].includes(s) && wasConnected) {
          runtime.state = 'starting'; // not postable while down; may self-recover
          this.dispatch({ sessionId, type: 'disconnected' });
        } else if (['CONNECTED', 'SYNCING'].includes(s) && !wasConnected && runtime.client) {
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
      runtime.starting = false;
      this.runtimes.delete(sessionId);
      this.dispatch({ sessionId, type: mapCreateError(err), payload: errorMessage(err) });
    }
  }

  async cancelSession(sessionId: string): Promise<void> {
    const runtime = this.runtimes.get(sessionId);
    if (!runtime) return;
    runtime.cancelRequested = true;
    await this.killQuietly(sessionId);
    if (!runtime.starting) this.runtimes.delete(sessionId);
  }

  async closeSession(sessionId: string): Promise<void> {
    const runtime = this.runtimes.get(sessionId);
    if (!runtime?.client) {
      this.runtimes.delete(sessionId);
      return;
    }
    runtime.state = 'closing';
    try {
      // kill() tears down the browser; open-wa persists session data on disk.
      await Promise.race([runtime.client.kill(), delay(5000)]);
    } catch {
      /* ignore */
    }
    await this.killQuietly(sessionId);
    this.runtimes.delete(sessionId);
  }

  async wipeSessionData(sessionId: string): Promise<void> {
    const dataFile = path.join(this.waSessionsDir, `${sessionId}.data.json`);
    const dataFileAlt = path.join(this.waSessionsDir, `session.data.json`);
    for (const file of [dataFile, dataFileAlt]) {
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
    const result = await client.postImageStatus(imageDataUrl as unknown as DataURL, caption ?? '');
    assertPosted(result, 'image');
  }

  async sendVideoStatus(sessionId: string, videoDataUrl: string, caption?: string): Promise<void> {
    const client = this.requireClient(sessionId);
    const result = await client.postVideoStatus(videoDataUrl as unknown as DataURL, caption ?? '');
    assertPosted(result, 'video');
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.runtimes.keys()].map((id) => this.closeSession(id)));
  }

  // ---- internals ----

  private requireClient(sessionId: string): Client {
    const runtime = this.runtimes.get(sessionId);
    if (!runtime?.client || runtime.state !== 'connected') {
      throw new AppError('SESSION_NOT_CONNECTED', `Session ${sessionId} is not connected`);
    }
    return runtime.client;
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

  private dispatch(event: GatewayEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* listener isolation */
      }
    }
  }

  private bindGlobalListener(): void {
    if (this.globalListenerBound) return;
    this.globalListenerBound = true;

    ev.on('**.**', (data: unknown, sessionId?: string, namespace?: string) => {
      if (!sessionId || !namespace) return;
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
          // First authentication chunk received — QR was scanned / linked.
          if (runtime.state !== 'connected') this.dispatch({ sessionId, type: 'connecting' });
          break;
        case 'STARTUP': {
          const message = typeof data === 'string' ? data : undefined;
          if (message === 'qrTimeout') this.dispatch({ sessionId, type: 'qr_expired' });
          else if (message === 'successfulScan') this.dispatch({ sessionId, type: 'connecting' });
          else if (message === 'appOffline') this.dispatch({ sessionId, type: 'error', payload: 'NO_INTERNET' });
          else if (message === 'authTimeout') this.dispatch({ sessionId, type: 'error', payload: 'GATEWAY_TIMEOUT' });
          break;
        }
        case 'stateChange': {
          // live connection-state updates while connected
          const state = typeof data === 'string' ? data.toUpperCase() : '';
          if (state === 'DISCONNECTED' || state === 'CONFLICT' || state === 'UNLAUNCHED') {
            if (runtime.state === 'connected') this.dispatch({ sessionId, type: 'disconnected' });
          }
          break;
        }
        default:
          break;
      }
    });
  }
}

function mapCreateError(err: unknown): GatewayEvent['type'] {
  const message = errorMessage(err).toLowerCase();
  if (message.includes('qr timeout') || message.includes('qrtimeout')) return 'qr_expired';
  if (message.includes('logged out') || message.includes('authenticat') || message.includes('deactivated')) return 'logged_out';
  if (message.includes('timeout') || message.includes('timed out')) return 'error';
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
