import { app, Menu, clipboard, dialog, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';

export interface NativeMenuHooks {
  getWindow: () => BrowserWindow | null;
  /** Forward a menu action to the renderer (it owns navigation/dialogs). */
  sendAction: (action: string) => void;
  dataDir: string;
}

/**
 * Replaces Electron's default menu with a proper, Alma-specific one:
 * - App menu with native About panel + Settings (Cmd+,)
 * - File: New Scheduled Status (⌘N) / Link a Number (⌘L)
 * - Edit: standard roles (undo/copy/paste — required for text inputs)
 * - View: per-page navigation (⌘1..5), theme/language toggles, zoom
 * - Window + Help, context menus, and a Dock menu on macOS.
 */
export function installNativeMenu(hooks: NativeMenuHooks): void {
  const isMac = process.platform === 'darwin';

  app.setAboutPanelOptions({
    applicationName: 'Alma Status Publisher',
    applicationVersion: app.getVersion(),
    version: '',
    copyright: '© 2026 Alma — Schedule WhatsApp statuses across every linked number.',
  });

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              {
                label: 'Settings…',
                accelerator: 'CmdOrCtrl+,',
                click: () => hooks.sendAction('nav:settings'),
              },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          } as MenuItemConstructorOptions,
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Scheduled Status',
          accelerator: 'CmdOrCtrl+N',
          click: () => hooks.sendAction('schedule:new'),
        },
        {
          label: 'Link a Number…',
          accelerator: 'CmdOrCtrl+L',
          click: () => hooks.sendAction('numbers:link'),
        },
        { type: 'separator' },
        ...(isMac ? [{ role: 'close' as const }] : [{ role: 'quit' as const }]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Dashboard', accelerator: 'CmdOrCtrl+1', click: () => hooks.sendAction('nav:dashboard') },
        { label: 'Numbers', accelerator: 'CmdOrCtrl+2', click: () => hooks.sendAction('nav:numbers') },
        { label: 'Scheduler', accelerator: 'CmdOrCtrl+3', click: () => hooks.sendAction('nav:scheduler') },
        { label: 'History', accelerator: 'CmdOrCtrl+4', click: () => hooks.sendAction('nav:history') },
        { label: 'Settings', accelerator: 'CmdOrCtrl+5', click: () => hooks.sendAction('nav:settings') },
        { type: 'separator' },
        { label: 'Toggle Theme', accelerator: 'CmdOrCtrl+Shift+T', click: () => hooks.sendAction('theme:toggle') },
        { label: 'Toggle Language', accelerator: 'CmdOrCtrl+Shift+L', click: () => hooks.sendAction('locale:toggle') },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        ...(app.isPackaged
          ? []
          : ([{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }] as MenuItemConstructorOptions[])),
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'Open Data Folder',
          click: async () => {
            await shell.openPath(hooks.dataDir);
          },
        },
        {
          label: 'Alma on GitHub',
          click: () => void shell.openExternal('https://github.com/Abodysoma2021/alma-status-publisher'),
        },
        ...(isMac
          ? []
          : [
              {
                label: 'About Alma Status Publisher',
                click: () =>
                  void dialog.showMessageBox({
                    type: 'info',
                    title: 'About',
                    message: 'Alma Status Publisher',
                    detail: `Version ${app.getVersion()}\n\nSchedule WhatsApp statuses across every linked number.`,
                  }),
              },
            ]),
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  // macOS Dock menu — right-click the app icon for quick actions.
  if (isMac && app.dock) {
    app.dock.setMenu(
      Menu.buildFromTemplate([
        {
          label: 'New Scheduled Status',
          click: () => {
            hooks.getWindow()?.show();
            hooks.sendAction('schedule:new');
          },
        },
        {
          label: 'Link a Number',
          click: () => {
            hooks.getWindow()?.show();
            hooks.sendAction('numbers:link');
          },
        },
      ]),
    );
  }
}

/** Native right-click menu inside the renderer window. */
export function installContextMenu(getWindow: () => BrowserWindow | null): void {
  const win = getWindow();
  if (!win) return;

  win.webContents.on('context-menu', (_event, props) => {
    const items: MenuItemConstructorOptions[] = [];

    if (props.isEditable) {
      items.push(
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      );
    } else if (props.mediaType === 'image' && props.srcURL) {
      items.push(
        {
          label: 'Copy Image',
          click: () => win.webContents.copyImageAt(props.x, props.y),
        },
        {
          label: 'Save Image As…',
          click: () => win.webContents.downloadURL(props.srcURL),
        },
      );
    } else if (props.selectionText && props.linkURL) {
      items.push(
        { role: 'copy' },
        {
          label: 'Copy Link',
          click: () => clipboard.writeText(props.linkURL),
        },
      );
    } else if (props.selectionText) {
      items.push({ role: 'copy' });
    } else if (props.linkURL) {
      items.push(
        {
          label: 'Copy Link',
          click: () => clipboard.writeText(props.linkURL),
        },
        {
          label: 'Open Link',
          click: () => void shell.openExternal(props.linkURL),
        },
      );
    } else {
      items.push({ role: 'copy' });
    }

    if (items.length > 0) {
      Menu.buildFromTemplate(items).popup({ window: win });
    }
  });
}

/** Connected-numbers badge on the macOS Dock icon. */
export function updateDockBadge(connected: number): void {
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setBadge(connected > 0 ? String(connected) : '');
  }
}
