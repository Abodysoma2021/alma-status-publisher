import { app, BrowserWindow, shell } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { initContainer } from './bootstrap';
import { registerIpcHandlers, pushEventToWindow } from './ipc';
import type { AppContainer } from './bootstrap';

const IS_DEV = process.env.ALMA_DEV === '1';
const DEV_SERVER_URL = process.env.ALMA_DEV_URL ?? 'http://localhost:3000';

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
      autoHideMenuBar: true,
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

    mainWindow.once('ready-to-show', () => mainWindow?.show());
    mainWindow.on('closed', () => {
      mainWindow = null;
    });

    // Push application events to the renderer.
    container!.events.subscribeAll((type, payload) => {
      pushEventToWindow(mainWindow, 'alma:event', { type: mapEventType(type), payload });
    });

    if (IS_DEV) {
      return mainWindow.loadURL(DEV_SERVER_URL).then(() => {
        mainWindow?.webContents.openDevTools({ mode: 'detach' });
      });
    }
    return mainWindow.loadURL(`${container!.staticServer.baseUrl}/`);
  });
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
    container = initContainer({ rendererRootDir: rendererRootDir() });

    // Always start the internal server: serves /media/* previews in dev,
    // and the exported renderer bundle in production.
    await container.staticServer.start();

    registerIpcHandlers(
      container,
      () => mainWindow,
      { version: app.getVersion(), platform: process.platform },
    );

    await createWindow();
    await container.startBackgroundWork();

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
