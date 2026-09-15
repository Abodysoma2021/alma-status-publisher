'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Smartphone,
  CalendarClock,
  History,
  Settings as SettingsIcon,
  Languages,
  Sun,
  Moon,
  MonitorSmartphone,
} from 'lucide-react';
import { useAlma } from '../providers/alma-provider';
import { AlmaLogo } from './logo';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const NAV_ITEMS = [
  { href: '/', key: 'nav.dashboard', icon: LayoutDashboard },
  { href: '/numbers', key: 'nav.numbers', icon: Smartphone },
  { href: '/scheduler', key: 'nav.scheduler', icon: CalendarClock },
  { href: '/history', key: 'nav.history', icon: History },
  { href: '/settings', key: 'nav.settings', icon: SettingsIcon },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const { t, locale, setLocale, settings, setTheme, sessions } = useAlma();
  const pathname = usePathname();
  const connected = sessions.filter((s) => s.status === 'connected').length;
  const total = sessions.length;

  return (
    <div className="flex h-screen w-screen overflow-hidden" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      {/* Sidebar — always brand-ink so the white logo reads perfectly */}
      <aside className="flex w-60 shrink-0 flex-col bg-sidebar text-sidebar-foreground">
        <div className="flex items-center gap-3 px-5 pt-6 pb-4">
          <AlmaLogo height={24} />
        </div>

        <nav className="mt-2 flex flex-1 flex-col gap-1 px-3">
          {NAV_ITEMS.map(({ href, key, icon: Icon }) => {
            const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                  active
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-[inset_2px_0_0_0_var(--sidebar-primary)]'
                    : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
                )}
              >
                <Icon className="size-4.5 shrink-0 opacity-80" />
                <span className="truncate">{t(key)}</span>
              </Link>
            );
          })}
        </nav>

        <div className="flex flex-col gap-3 px-4 pb-5">
          {/* connection summary */}
          <div className="flex items-center gap-2 rounded-lg bg-sidebar-accent/70 px-3 py-2 text-xs text-sidebar-foreground/80">
            <span className="relative flex size-2">
              {connected > 0 && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sidebar-primary opacity-60" />
              )}
              <span
                className={cn(
                  'relative inline-flex size-2 rounded-full',
                  connected > 0 ? 'bg-sidebar-primary' : 'bg-muted-foreground',
                )}
              />
            </span>
            <span>
              {connected}/{total} {t('numbers.connected')}
            </span>
          </div>

          {/* quick toggles */}
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => void setLocale(locale === 'en' ? 'ar' : 'en')}
                  className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md bg-sidebar-accent/70 text-xs text-sidebar-foreground/90 transition hover:bg-sidebar-accent"
                >
                  <Languages className="size-3.5" />
                  {locale === 'en' ? 'العربية' : 'English'}
                </button>
              </TooltipTrigger>
              <TooltipContent>{t('settings.language')}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() =>
                    void setTheme(
                      settings.theme === 'dark'
                        ? 'light'
                        : settings.theme === 'light'
                          ? 'system'
                          : 'dark',
                    )
                  }
                  className="flex h-8 items-center justify-center gap-1.5 rounded-md bg-sidebar-accent/70 px-2.5 text-sidebar-foreground/90 transition hover:bg-sidebar-accent"
                >
                  {settings.theme === 'dark' ? (
                    <Moon className="size-3.5" />
                  ) : settings.theme === 'light' ? (
                    <Sun className="size-3.5" />
                  ) : (
                    <MonitorSmartphone className="size-3.5" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent>{t('settings.appearance')}</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </aside>

      {/* Content */}
      <main className="scrollbar-subtle relative flex-1 overflow-y-auto">
        {/* draggable top bar for the frameless window */}
        <div className="drag-region pointer-events-none absolute inset-x-0 top-0 z-10 h-10" />
        {children}
      </main>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
