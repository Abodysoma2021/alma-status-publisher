'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import type { AlmaBridge, AlmaBridgeError } from '@/shared/bridge';
import type {
  AppEvent,
  DashboardStats,
  LogView,
  MediaAssetView,
  ScheduleView,
  SessionView,
  SettingsView,
} from '@/shared/view-models';
import { translate, type Locale } from '../i18n/dictionaries';
import { toast } from 'sonner';

declare global {
  interface Window {
    alma?: AlmaBridge;
  }
}

export function getBridge(): AlmaBridge {
  if (typeof window === 'undefined' || !window.alma) {
    throw new Error('Alma bridge unavailable — the app must run inside Electron.');
  }
  return window.alma;
}

export const bridgeAvailable = (): boolean =>
  typeof window !== 'undefined' && !!window.alma;

export interface AppInfo {
  version: string;
  platform: string;
  dataPath: string;
  mediaBaseUrl: string;
}

interface AlmaContextValue {
  // data
  sessions: SessionView[];
  schedules: ScheduleView[];
  logs: LogView[];
  dashboard: DashboardStats | null;
  settings: SettingsView;
  appInfo: AppInfo | null;
  ready: boolean;
  // i18n + theme
  locale: Locale;
  dir: 'rtl' | 'ltr';
  t: (key: string, params?: Record<string, string | number>) => string;
  setLocale: (locale: Locale) => Promise<void>;
  setTheme: (theme: SettingsView['theme']) => Promise<void>;
  // actions (all toast errors automatically)
  registerMenuListener: (action: string, cb: () => void) => () => void;
  takePendingAction: (action?: string) => string | null;
  actions: {
    startLinking: (name: string, pairingPhone?: string) => Promise<SessionView | null>;
    cancelLinking: (id: string) => Promise<void>;
    renameSession: (id: string, name: string) => Promise<boolean>;
    relinkSession: (id: string) => Promise<void>;
    unlinkSession: (id: string) => Promise<void>;
    removeSession: (id: string) => Promise<void>;
    setDefaultSession: (id: string) => Promise<void>;
    createSchedule: (input: Parameters<AlmaBridge['commands']['createSchedule']>[0]) => Promise<ScheduleView | null>;
    updateSchedule: (id: string, patch: Parameters<AlmaBridge['commands']['updateSchedule']>[1]) => Promise<ScheduleView | null>;
    deleteSchedule: (id: string) => Promise<void>;
    toggleSchedule: (id: string, enabled: boolean) => Promise<void>;
    runScheduleNow: (id: string) => Promise<void>;
    pickMedia: (kind: 'image' | 'video') => Promise<MediaAssetView | null>;
    importDroppedFile: (path: string, kind: 'image' | 'video') => Promise<MediaAssetView | null>;
    deleteMedia: (id: string) => Promise<void>;
    retryLog: (id: string) => Promise<void>;
    clearLogs: () => Promise<void>;
    openDataFolder: () => Promise<void>;
  };
  refreshAll: () => Promise<void>;
}

const AlmaContext = React.createContext<AlmaContextValue | null>(null);

const DEFAULT_SETTINGS: SettingsView = { theme: 'system', locale: 'en' };

export function AlmaProvider({ children }: { children: React.ReactNode }) {
  const [sessions, setSessions] = React.useState<SessionView[]>([]);
  const [schedules, setSchedules] = React.useState<ScheduleView[]>([]);
  const [logs, setLogs] = React.useState<LogView[]>([]);
  const [dashboard, setDashboard] = React.useState<DashboardStats | null>(null);
  const [settings, setSettings] = React.useState<SettingsView>(DEFAULT_SETTINGS);
  const [appInfo, setAppInfo] = React.useState<AppInfo | null>(null);
  const [ready, setReady] = React.useState(false);

  const locale = settings.locale;
  const dir: 'rtl' | 'ltr' = locale === 'ar' ? 'rtl' : 'ltr';

  const t = React.useCallback(
    (key: string, params?: Record<string, string | number>) => translate(locale, key, params),
    [locale],
  );

  // ---- initial load ----
  React.useEffect(() => {
    if (!bridgeAvailable()) return;
    let disposed = false;

    void (async () => {
      try {
        const bridge = getBridge();
        const [s, sch, l, d, set, info] = await Promise.all([
          bridge.commands.listSessions(),
          bridge.commands.listSchedules(),
          bridge.commands.listLogs(),
          bridge.commands.getDashboard(),
          bridge.commands.getSettings(),
          bridge.commands.getAppInfo(),
        ]);
        if (disposed) return;
        setSessions(s);
        setSchedules(sch);
        setLogs(l);
        setDashboard(d);
        setSettings(set);
        setAppInfo(info);
      } catch (err) {
        reportError(err);
      } finally {
        if (!disposed) setReady(true);
      }
    })();

    return () => {
      disposed = true;
    };
  }, []);

  // ---- apply document-level locale + theme ----
  React.useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
  }, [locale, dir]);

  React.useEffect(() => {
    const apply = () => {
      const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const dark = settings.theme === 'dark' || (settings.theme === 'system' && systemDark);
      document.documentElement.classList.toggle('dark', dark);
    };
    apply();
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [settings.theme]);

  // ---- live events from main ----
  React.useEffect(() => {
    if (!bridgeAvailable()) return;
    const bridge = getBridge();
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleRefresh = () => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => void refreshData(), 120);
    };

    const refreshData = async () => {
      if (!bridgeAvailable()) return;
      try {
        const [s, sch, l, d] = await Promise.all([
          bridge.commands.listSessions(),
          bridge.commands.listSchedules(),
          bridge.commands.listLogs(),
          bridge.commands.getDashboard(),
        ]);
        setSessions(s);
        setSchedules(sch);
        setLogs(l);
        setDashboard(d);
      } catch {
        /* transient — next event retries */
      }
    };

    const unsubscribe = bridge.onEvent((event: AppEvent) => {
      switch (event.type) {
        case 'session:updated':
        case 'schedule:updated':
        case 'log:updated':
        case 'schedule:removed':
        case 'session:removed':
          scheduleRefresh();
          break;
        case 'app:notice': {
          const notice = event.payload as { level: string; messageKey: string; params?: Record<string, string> };
          const message = t(notice.messageKey, notice.params);
          if (notice.level === 'error') toast.error(message);
          else if (notice.level === 'success') toast.success(message);
          else if (notice.level === 'warning') toast.warning(message);
          else toast.info(message);
          scheduleRefresh();
          break;
        }
        case 'app:error':
          scheduleRefresh();
          break;
        default:
          break;
      }
    });

    return () => {
      unsubscribe();
      clearTimeout(refreshTimer);
    };
  }, [t]);


  // ---- native menu actions (application menu / dock menu) ----
  const router = useRouter();
  const pendingActionRef = React.useRef<string | null>(null);
  const menuListenersRef = React.useRef(new Map<string, Set<() => void>>());

  const notifyMenuListeners = React.useCallback((action: string) => {
    for (const cb of menuListenersRef.current.get(action) ?? []) {
      try {
        cb();
      } catch {
        /* listener isolation */
      }
    }
  }, []);

  const registerMenuListener = React.useCallback((action: string, cb: () => void) => {
    const set = menuListenersRef.current.get(action) ?? new Set();
    set.add(cb);
    menuListenersRef.current.set(action, set);
    return () => {
      set.delete(cb);
    };
  }, []);

  const takePendingAction = React.useCallback((action?: string) => {
    const pending = pendingActionRef.current;
    if (pending && (!action || pending === action)) {
      pendingActionRef.current = null;
      return pending;
    }
    return null;
  }, []);


  // ---- actions ----
  const runCommand = React.useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | null> => {
      try {
        return await fn();
      } catch (err) {
        reportError(err);
        return null;
      }
    },
    [],
  );

  const refreshAll = React.useCallback(async () => {
    if (!bridgeAvailable()) return;
    const bridge = getBridge();
    const [s, sch, l, d] = await Promise.all([
      bridge.commands.listSessions(),
      bridge.commands.listSchedules(),
      bridge.commands.listLogs(),
      bridge.commands.getDashboard(),
    ]);
    setSessions(s);
    setSchedules(sch);
    setLogs(l);
    setDashboard(d);
  }, []);

  const actions = React.useMemo<AlmaContextValue['actions']>(
    () => ({
      startLinking: (name, pairingPhone) =>
        runCommand(() => getBridge().commands.startLinking({ name, pairingPhone })),
      cancelLinking: (id) => runCommand(() => getBridge().commands.cancelLinking(id)).then(() => undefined),
      renameSession: async (id, name) => {
        const result = await runCommand(() => getBridge().commands.renameSession(id, name));
        return result !== null;
      },
      relinkSession: (id) => runCommand(() => getBridge().commands.relinkSession(id)).then(() => undefined),
      unlinkSession: (id) => runCommand(() => getBridge().commands.unlinkSession(id)).then(() => undefined),
      removeSession: (id) => runCommand(() => getBridge().commands.removeSession(id)).then(() => undefined),
      setDefaultSession: (id) => runCommand(() => getBridge().commands.setDefaultSession(id)).then(() => undefined),

      createSchedule: async (input) => {
        const result = await runCommand(() => getBridge().commands.createSchedule(input));
        if (result) toast.success(t('scheduler.dialog.created'));
        return result;
      },
      updateSchedule: async (id, patch) => {
        const result = await runCommand(() => getBridge().commands.updateSchedule(id, patch));
        if (result) toast.success(t('scheduler.dialog.updated'));
        return result;
      },
      deleteSchedule: (id) => runCommand(() => getBridge().commands.deleteSchedule(id)).then(() => undefined),
      toggleSchedule: (id, enabled) => runCommand(() => getBridge().commands.toggleSchedule(id, enabled)).then(() => undefined),
      runScheduleNow: (id) => runCommand(() => getBridge().commands.runScheduleNow(id)).then(() => undefined),

      pickMedia: (kind) => runCommand(() => getBridge().commands.pickMedia(kind)),
      importDroppedFile: (path, kind) => runCommand(() => getBridge().commands.importDroppedFile(path, kind)),
      deleteMedia: (id) => runCommand(() => getBridge().commands.deleteMedia(id)).then(() => undefined),

      retryLog: (id) => runCommand(() => getBridge().commands.retryLog(id)).then(() => undefined),
      clearLogs: () => runCommand(() => getBridge().commands.clearLogs()).then(() => undefined),
      openDataFolder: () => runCommand(() => getBridge().commands.openDataFolder()).then(() => undefined),
    }),
    [runCommand, t],
  );

  const setLocale = React.useCallback(
    async (next: Locale) => {
      const updated = await runCommand(() => getBridge().commands.updateSettings({ locale: next }));
      if (updated) setSettings(updated);
    },
    [runCommand],
  );

  const setTheme = React.useCallback(
    async (next: SettingsView['theme']) => {
      const updated = await runCommand(() => getBridge().commands.updateSettings({ theme: next }));
      if (updated) setSettings(updated);
    },
    [runCommand],
  );

  React.useEffect(() => {
    if (!bridgeAvailable()) return;
    return getBridge().onMenu((action) => {
      switch (action) {
        case 'theme:toggle': {
          const { theme } = settings;
          const next = theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark';
          void setTheme(next);
          break;
        }
        case 'locale:toggle':
          void setLocale(settings.locale === 'en' ? 'ar' : 'en');
          break;
        case 'nav:dashboard':
          router.push('/');
          break;
        case 'nav:numbers':
          router.push('/numbers');
          break;
        case 'nav:scheduler':
          router.push('/scheduler');
          break;
        case 'nav:history':
          router.push('/history');
          break;
        case 'nav:settings':
          router.push('/settings');
          break;
        case 'schedule:new':
          pendingActionRef.current = action;
          router.push('/scheduler');
          notifyMenuListeners(action);
          break;
        case 'numbers:link':
          pendingActionRef.current = action;
          router.push('/numbers');
          notifyMenuListeners(action);
          break;
        default:
          break;
      }
    });
  }, [router, notifyMenuListeners, settings, setTheme, setLocale]);

  // macOS Dock badge: number of connected accounts.
  React.useEffect(() => {
    if (!bridgeAvailable()) return;
    const connected = sessions.filter((s) => s.status === 'connected').length;
    void getBridge().setDockBadge(connected).catch(() => undefined);
  }, [sessions]);

  const value = React.useMemo<AlmaContextValue>(
    () => ({
      sessions,
      schedules,
      logs,
      dashboard,
      settings,
      appInfo,
      ready,
      locale,
      dir,
      t,
      setLocale,
      setTheme,
      registerMenuListener,
      takePendingAction,
      actions,
      refreshAll,
    }),
    [sessions, schedules, logs, dashboard, settings, appInfo, ready, locale, dir, t, setLocale, setTheme, registerMenuListener, takePendingAction, actions, refreshAll],
  );

  return <AlmaContext.Provider value={value}>{children}</AlmaContext.Provider>;
}

export function useAlma(): AlmaContextValue {
  const ctx = React.useContext(AlmaContext);
  if (!ctx) throw new Error('useAlma must be used within AlmaProvider');
  return ctx;
}

// Module-level locale mirror so toasts raised anywhere render in the active language.
const currentLocaleRef: { value: Locale } = { value: 'en' };
export function setReportLocale(locale: Locale): void {
  currentLocaleRef.value = locale;
}

export function reportError(err: unknown): void {
  const error = err as AlmaBridgeError;
  const key = error?.messageKey ? `error.${error.messageKey}` : 'error.UNKNOWN';
  toast.error(translate(currentLocaleRef.value, key));
}
