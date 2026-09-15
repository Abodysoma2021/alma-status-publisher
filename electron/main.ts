import { app, BrowserWindow, shell } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { initContainer } from './bootstrap';
import { registerIpcHandlers, pushEventToWindow } from './ipc';
import { installNativeMenu, installContextMenu, updateDockBadge } from './menus';
import { initDebugLog, debugLog } from './debug-log';
import type { AppContainer } from './bootstrap';

const IS_DEV = process.env.ALMA_DEV === '1';
const DEV_SERVER_URL = process.env.ALMA_DEV_URL ?? 'http://127.0.0.1:3000';

let mainWindow: BrowserWindow | null = null;
let container: AppContainer | null = null;

// Singleton lock — one instance only (WhatsApp sessions must not multiply).
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

/**
 * Resolve the exported renderer directory across launch modes:
 *  - repo layout:  <root>/dist-electron/main.cjs + <root>/out
 *  - packaged:     <asar>/dist-electron/main.cjs + <asar>/out
 */
function rendererRootDir(): string {
  const candidates = [path.join(__dirname, '..', 'out'), path.join(app.getAppPath(), 'out')];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'index.html'))) return candidate;
  }
  return candidates[0];
}

function createWindow(): Promise<void> {
  if (!container) return Promise.resolve();
  const settingsPromise = container.useCases.getSettings.execute();

  return settingsPromise.then((settings) => {
    mainWindow = new BrowserWindow({
      width: 1280,
      height: 820,
      minWidth: 980,
      minHeight: 640,
      show: false,
      backgroundColor: settings.theme === 'light' ? '#F7F8FA' : '#0B1220',
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : undefined,
      trafficLightPosition: process.platform === 'darwin' ? { x: 16, y: 18 } : undefined,
      autoHideMenuBar: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        spellcheck: false,
      },
    });

    // Open external links in the system browser, never in-app.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://') || url.startsWith('mailto:')) void shell.openExternal(url);
      return { action: 'deny' };
    });

    installContextMenu(() => mainWindow);
    mainWindow.once('ready-to-show', () => mainWindow?.show());
    mainWindow.on('closed', () => {
      mainWindow = null;
    });

    // Push application events to the renderer.
    container!.events.subscribeAll((type, payload) => {
      pushEventToWindow(mainWindow, 'alma:event', { type: mapEventType(type), payload });
    });

    // Resilient renderer loading: if the first navigation fails (dev server
    // still booting, slow machine), retry with backoff instead of leaving the
    // user on Chromium's "This page couldn't load" error page.
    rendererRetries = 0;
    rendererHealthy = false;

    mainWindow.webContents.on('did-finish-load', () => {
      rendererHealthy = true;
      rendererRetries = 0;
      if (IS_DEV) void runDoctor();
    });

    mainWindow.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
      if (!isMainFrame) return;
      if (code === -3) return; // ERR_ABORTED — superseded navigation
      if (rendererHealthy) return;

      debugLog('renderer', `did-fail-load code=${code} desc=${description} url=${url} attempt=${rendererRetries + 1}/${RENDERER_MAX_RETRIES}`);
      if (rendererRetries >= RENDERER_MAX_RETRIES) {
        logCrash('renderer-load', new Error(`gave up after ${rendererRetries} retries: ${code} ${description} ${url}`));
        debugLog('renderer', 'retries exhausted — restarting retry cycle in 10s');
        setTimeout(() => {
          rendererRetries = 0;
          if (mainWindow && !mainWindow.isDestroyed()) void loadRenderer();
        }, 10_000);
        return;
      }
      rendererRetries += 1;
      const backoff = Math.min(500 * 2 ** (rendererRetries - 1), 5000);
      logCrash('renderer-load', new Error(`attempt ${rendererRetries} failed (${code} ${description}) — retrying in ${backoff}ms`));
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) void loadRenderer();
      }, backoff);
    });

    return loadRenderer();
  });
}

const RENDERER_MAX_RETRIES = 12;
let rendererRetries = 0;
let rendererHealthy = false;

/** Navigates the window to the renderer, swallowing load errors (retry handles them). */
function loadRenderer(): Promise<void> {
  if (!mainWindow) return Promise.resolve();
  const target = IS_DEV ? DEV_SERVER_URL : `${container!.staticServer.baseUrl}/`;
  debugLog('renderer', `loading ${target}`);
  return mainWindow
    .loadURL(target)
    .then(() => debugLog('renderer', `loaded ${target}`))
    .catch((err) => {
      logCrash('loadURL', err);
      debugLog('renderer', `loadURL rejected: ${err instanceof Error ? err.message : String(err)}`);
    });
}

/**
 * Dev-only self-test: waits for hydration, reports bridge/react state, then
 * simulates a real click on the theme toggle to prove the full IPC loop.
 */
async function runDoctor(): Promise<void> {
  if (!mainWindow) return;
  await new Promise((r) => setTimeout(r, 4000));
  try {
    const diag = (await mainWindow.webContents.executeJavaScript(
      `({ alma: typeof window.alma,
         buttons: document.querySelectorAll('button').length,
         readyState: document.readyState,
         hydrated: !!document.querySelector('[data-alma-hydrated]') })`,
    )) as { alma: string; buttons: number; readyState: string; hydrated: boolean };
    debugLog('doctor', `state: ${JSON.stringify(diag)}`);

    await mainWindow.webContents.executeJavaScript(
      `const b = document.querySelector('button[aria-label="Toggle appearance"]');
       if (b) { b.click(); 'clicked'; } else { 'toggle-button-not-found'; }`,
    );
    debugLog('doctor', 'simulated click on theme toggle — expect an alma:ipc line next');
  } catch (err) {
    debugLog('doctor', `failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (process.env.ALMA_DOCTOR_LINK === '1' && container) {
    await linkingSelfTest(container);
  }
}

/**
 * Dev-only: drives a real linking session end-to-end (browser launch → WA
 * Web → QR event → gateway → session state) WITHOUT scanning, then cleans up.
 * Proves the QR pipeline independent of the UI.
 */
async function linkingSelfTest(container: AppContainer): Promise<void> {
  debugLog('doctor', '=== LINKING SELF-TEST START ===');
  let session;
  try {
    session = await container.useCases.startLinking.execute({ name: `Doctor ${Date.now()}` });
  } catch (err) {
    debugLog('doctor', `startLinking threw: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  const deadline = Date.now() + 150_000;
  let last = '';
  try {
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 3000));
      const s = await container.sessions.get(session.id);
      if (!s) {
        debugLog('doctor', 'session vanished (removed)');
        return;
      }
      const state = `${s.status} qr:${s.qrCode ? s.qrCode.length : 0}ch pair:${s.pairingCode ?? '-'} err:${s.lastError ?? '-'}`;
      if (state !== last) {
        last = state;
        debugLog('doctor', `link state → ${state}`);
      }
      if (s.status === 'awaiting_qr' && s.qrCode) {
        debugLog('doctor', '✅ QR RECEIVED — full pipeline (browser → WA → ev → gateway → repo) works');
        break;
      }
      if (s.status === 'connected') {
        debugLog('doctor', '✅ SESSION CONNECTED (unexpected without scan, even better)');
        break;
      }
      if (['qr_expired', 'logged_out', 'error'].includes(s.status)) {
        debugLog('doctor', `❌ linking failed with status=${s.status}`);
        break;
      }
    }
  } finally {
    await container.useCases.cancelLinking.execute(session.id).catch(() => undefined);
    debugLog('doctor', '=== LINKING SELF-TEST DONE (session cleaned up) ===');
  }
}

function mapEventType(type: string): string {
  const mapping: Record<string, string> = {
    'session-updated': 'session:updated',
    'session-removed': 'session:removed',
    'schedule-updated': 'schedule:updated',
    'schedule-removed': 'schedule:removed',
    'log-updated': 'log:updated',
    'media-removed': 'media:removed',
    'settings-updated': 'settings:updated',
    notice: 'app:notice',
    'run-finished': 'schedule:updated',
  };
  return mapping[type] ?? 'app:notice';
}

// ---- Process-level resilience: never die silently. ----
process.on('uncaughtException', (err) => logCrash('uncaughtException', err));
process.on('unhandledRejection', (reason) => logCrash('unhandledRejection', reason));

function logCrash(kind: string, err: unknown): void {
  console.error(`[${new Date().toISOString()}] ${kind}:`, err);
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  try {
    initDebugLog(app.getPath('userData'));
    debugLog('boot', `mode: ${IS_DEV ? 'dev' : 'production'} | electron ${process.versions.electron}`);
    container = initContainer({ rendererRootDir: rendererRootDir() });
    debugLog('boot', `renderer root: ${rendererRootDir()}`);
    container.gateway.dispatchDebug = (message) => debugLog('wa', message);

    // Always start the internal server: serves /media/* previews in dev,
    // and the exported renderer bundle in production.
    const port = await container.staticServer.start();
    debugLog('boot', `static server listening on 127.0.0.1:${port}`);

    registerIpcHandlers(
      container,
      () => mainWindow,
      { version: app.getVersion(), platform: process.platform },
    );

    installNativeMenu({
      getWindow: () => mainWindow,
      sendAction: (action) => pushEventToWindow(mainWindow, 'alma:menu', action),
      dataDir: container.paths.dataDir,
    });

    await createWindow();
    await container.startBackgroundWork();

    // Reflect connected numbers on the Dock icon as they change.
    container.events.subscribeAll((type) => {
      if (type === 'session-updated') {
        void container!.sessions.list().then((sessions) => {
          updateDockBadge(sessions.filter((s) => s.status === 'connected').length);
        }).catch(() => undefined);
      }
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow();
    });
  } catch (err) {
    logCrash('boot', err);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

let shuttingDown = false;
app.on('before-quit', (event) => {
  if (shuttingDown || !container) return;
  event.preventDefault();
  shuttingDown = true;
  void container
    .shutdown()
    .catch((err) => logCrash('shutdown', err))
    .finally(() => app.exit(0));
});
