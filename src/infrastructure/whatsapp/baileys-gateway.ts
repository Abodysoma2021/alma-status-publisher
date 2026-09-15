import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState as loadAuthState,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import type {
  GatewayEvent,
  GatewayEventListener,
  WhatsAppGateway,
} from '../../core/application/ports/whatsapp-gateway';
import { AppError } from '../../core/domain/errors';

type WASocket = ReturnType<typeof makeWASocket>;

interface SessionRuntime {
  socket?: WASocket;
  connected: boolean;
  cancelRequested: boolean;
  reconnectAttempt: number;
  reconnectTimer?: NodeJS.Timeout;
  pairingRequested: boolean;
  pairingPhone?: string;
  lastQr?: string;
  detachCreds?: () => void;
}

const silentLogger = pino({ level: 'silent' });
let cachedVersion: [number, number, number] | undefined;
let versionFetch: Promise<[number, number, number] | undefined> | undefined;

/** WA protocol version, fetched once per app run; falls back to library default. */
async function protocolVersion(): Promise<[number, number, number] | undefined> {
  if (cachedVersion) return cachedVersion;
  versionFetch ??= fetchLatestBaileysVersion()
    .then((r) => r.version as [number, number, number])
    .catch(() => undefined);
  cachedVersion = await versionFetch;
  return cachedVersion;
}

/**
 * WhatsApp gateway built directly on Baileys — the multi-device WebSocket
 * protocol. No browser, no scraping: QR and pairing codes come from the
 * protocol handshake itself, and one session costs a fraction of the RAM a
 * Chromium instance would.
 */
export class BaileysGateway implements WhatsAppGateway {
  private runtimes = new Map<string, SessionRuntime>();
  private listeners = new Set<GatewayEventListener>();

  /** Optional sink for progress notes (wired by the main process in dev). */
  dispatchDebug: ((message: string) => void) | null = null;

  constructor(private readonly waSessionsDir: string) {}

  onEvent(listener: GatewayEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  isConnected(sessionId: string): boolean {
    return this.runtimes.get(sessionId)?.connected === true;
  }

  async startSession(sessionId: string, pairingPhone?: string): Promise<void> {
    const existing = this.runtimes.get(sessionId);
    if (existing?.connected || existing?.reconnectTimer) return;

    if (existing) await this.teardownRuntime(sessionId);

    const runtime: SessionRuntime = {
      connected: false,
      cancelRequested: false,
      reconnectAttempt: existing?.reconnectAttempt ?? 0,
      pairingRequested: false,
      pairingPhone: pairingPhone?.replace(/\D/g, ''),
    };
    this.runtimes.set(sessionId, runtime);
    this.dispatch({ sessionId, type: 'starting' });
    this.dispatchDebug?.(`[${sessionId.slice(0, 8)}] starting WhatsApp session…`);

    try {
      await fsp.mkdir(this.waSessionsDir, { recursive: true });
      const authDir = path.join(this.waSessionsDir, sessionId);
      const { state, saveCreds } = await loadAuthState(authDir);
      const version = await protocolVersion();

      const socket = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, silentLogger),
        },
        browser: this.browserId(),
        logger: silentLogger,
        printQRInTerminal: false,
        markOnlineOnConnect: false,
        syncFullHistory: false,
        generateHighQualityLinkPreview: false,
      });

      runtime.socket = socket;

      const onCreds = () => void saveCreds().catch(() => undefined);
      socket.ev.on('creds.update', onCreds);
      runtime.detachCreds = () => {
        socket.ev.off('creds.update', onCreds);
      };

      socket.ev.on('connection.update', (update) => {
        try {
          this.handleConnectionUpdate(sessionId, socket, update);
        } catch {
          /* event isolation */
        }
      });
    } catch (err) {
      this.dispatchDebug?.(`[${sessionId.slice(0, 8)}] start failed: ${errorMessage(err)}`);
      await this.teardownRuntime(sessionId);
      this.dispatch({ sessionId, type: 'error', payload: AppError.from(err).code });
    }
  }

  async cancelSession(sessionId: string): Promise<void> {
    const runtime = this.runtimes.get(sessionId);
    if (!runtime) return;
    runtime.cancelRequested = true;
    await this.teardownRuntime(sessionId);
  }

  async closeSession(sessionId: string): Promise<void> {
    const runtime = this.runtimes.get(sessionId);
    if (!runtime) return;
    // Unlink: close the socket but KEEP credentials on disk for relink.
    await this.teardownRuntime(sessionId);
  }

  async wipeSessionData(sessionId: string): Promise<void> {
    await fsp.rm(path.join(this.waSessionsDir, sessionId), { recursive: true, force: true }).catch(() => undefined);
  }

  async sendTextStatus(sessionId: string, text: string, options: { backgroundColor: string; textColor: string; fontIndex: number }): Promise<void> {
    const socket = this.requireSocket(sessionId);
    await socket.sendMessage(
      STATUS_JID,
      { text },
      {
        broadcast: true,
        backgroundColor: options.backgroundColor,
        font: Math.max(0, Math.min(options.fontIndex, 5)),
      },
    );
  }

  async sendImageStatus(sessionId: string, imageDataUrl: string, caption?: string): Promise<void> {
    const socket = this.requireSocket(sessionId);
    await socket.sendMessage(
      STATUS_JID,
      { image: toBuffer(imageDataUrl), caption: caption || undefined },
      { broadcast: true },
    );
  }

  async sendVideoStatus(sessionId: string, videoDataUrl: string, caption?: string): Promise<void> {
    const socket = this.requireSocket(sessionId);
    await socket.sendMessage(
      STATUS_JID,
      { video: toBuffer(videoDataUrl), caption: caption || undefined },
      { broadcast: true },
    );
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.runtimes.keys()].map((id) => this.closeSession(id)));
  }

  // ---- internals ----

  private browserId(): [string, string, string] {
    const name = 'Alma Status Publisher';
    if (process.platform === 'darwin') return Browsers.macOS(name);
    if (process.platform === 'win32') return Browsers.windows(name);
    return Browsers.ubuntu(name);
  }

  private requireSocket(sessionId: string): WASocket {
    const runtime = this.runtimes.get(sessionId);
    if (!runtime?.connected || !runtime.socket) {
      throw new AppError('SESSION_NOT_CONNECTED', `Session ${sessionId} is not connected`);
    }
    return runtime.socket;
  }

  private handleConnectionUpdate(
    sessionId: string,
    socket: WASocket,
    update: {
      connection?: string;
      lastDisconnect?: { error?: { output?: { statusCode?: number }; message?: string } };
      qr?: string;
    },
  ): void {
    const runtime = this.runtimes.get(sessionId);
    if (!runtime) return;

    // QR from the protocol handshake — fresh strings arrive periodically.
    if (update.qr) {
      if (update.qr !== runtime.lastQr) {
        runtime.lastQr = update.qr;
        this.dispatch({ sessionId, type: 'qr', payload: update.qr });

        // Pairing code, requested once during the linking phase.
        if (runtime.pairingPhone && !runtime.pairingRequested) {
          runtime.pairingRequested = true;
          void socket
            .requestPairingCode(runtime.pairingPhone)
            .then((code) => {
              if (code) this.dispatch({ sessionId, type: 'pairing_code', payload: code });
            })
            .catch(() => undefined);
        }
      }
      return;
    }

    if (update.connection === 'connecting') {
      this.dispatch({ sessionId, type: 'connecting' });
      return;
    }

    if (update.connection === 'open') {
      runtime.connected = true;
      runtime.reconnectAttempt = 0;
      let phone: string | undefined;
      const raw = (socket.user as { id?: string } | undefined)?.id;
      if (raw) phone = `+${raw.split(':')[0].split('@')[0].replace(/\D/g, '')}`;
      this.dispatch({ sessionId, type: 'connected', payload: phone });
      return;
    }

    if (update.connection === 'close') {
      runtime.connected = false;
      const code = update.lastDisconnect?.error?.output?.statusCode;

      if (code === DisconnectReason.loggedOut) {
        // Credentials rejected — wipe so the next relink starts clean.
        void this.wipeSessionData(sessionId);
        void this.teardownRuntime(sessionId);
        this.dispatch({ sessionId, type: 'logged_out' });
        return;
      }

      if (runtime.cancelRequested) {
        void this.teardownRuntime(sessionId);
        return;
      }

      // Transient disconnect — auto-recover with capped exponential backoff.
      const attempt = runtime.reconnectAttempt + 1;
      runtime.reconnectAttempt = attempt;
      const backoff = Math.min(1000 * 2 ** Math.min(attempt, 5), 30_000);
      this.dispatch({ sessionId, type: 'disconnected' });
      this.dispatchDebug?.(`[${sessionId.slice(0, 8)}] disconnected (code ${code ?? '?'}) — reconnect ${attempt} in ${backoff / 1000}s`);
      runtime.reconnectTimer = setTimeout(() => {
        runtime.reconnectTimer = undefined;
        if (!runtime.cancelRequested && this.runtimes.get(sessionId) === runtime) {
          void this.startSession(sessionId);
        }
      }, backoff);
      runtime.reconnectTimer.unref?.();
    }
  }

  private async teardownRuntime(sessionId: string): Promise<void> {
    const runtime = this.runtimes.get(sessionId);
    if (!runtime) return;
    if (runtime.reconnectTimer) clearTimeout(runtime.reconnectTimer);
    runtime.cancelRequested = true;
    runtime.detachCreds?.();
    try {
      await Promise.race([runtime.socket?.end(undefined), delay(3000)]);
    } catch {
      /* ignore */
    }
    this.runtimes.delete(sessionId);
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

const STATUS_JID = 'status@broadcast';

function toBuffer(dataUrl: string): Buffer {
  const base64 = dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : dataUrl;
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length === 0) throw new AppError('FILE_EMPTY', 'Media payload is empty');
  return buffer;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err ?? 'Unknown error');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
