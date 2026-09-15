'use client';

import * as React from 'react';
import { Sun, Moon, MonitorSmartphone, FolderOpen, Languages, Info } from 'lucide-react';
import { AppShell, PageHeader } from '@/presentation/components/app-shell';
import { useAlma } from '@/presentation/providers/alma-provider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export default function SettingsPage() {
  const { t, settings, setTheme, setLocale, appInfo, actions } = useAlma();

  const themeOptions = [
    { value: 'light', icon: Sun, label: t('settings.theme.light') },
    { value: 'dark', icon: Moon, label: t('settings.theme.dark') },
    { value: 'system', icon: MonitorSmartphone, label: t('settings.theme.system') },
  ] as const;

  return (
    <AppShell>
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-8 py-10">
        <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />

        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-base">{t('settings.appearance')}</CardTitle>
          </CardHeader>
          <CardContent>
            <RadioGroup
              value={settings.theme}
              onValueChange={(v) => void setTheme(v as 'light' | 'dark' | 'system')}
              className="grid grid-cols-3 gap-3"
            >
              {themeOptions.map(({ value, icon: Icon, label }) => (
                <Label
                  key={value}
                  className={cn(
                    'flex cursor-pointer flex-col items-center gap-2 rounded-xl border p-4 font-medium transition',
                    settings.theme === value && 'border-primary bg-primary/5',
                  )}
                >
                  <RadioGroupItem value={value} className="sr-only" />
                  <Icon className="size-5 text-primary" />
                  {label}
                </Label>
              ))}
            </RadioGroup>
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Languages className="size-4 text-primary" />
              {t('settings.language')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <RadioGroup
              value={settings.locale}
              onValueChange={(v) => void setLocale(v as 'en' | 'ar')}
              className="grid grid-cols-2 gap-3"
            >
              <Label
                className={cn(
                  'flex cursor-pointer flex-col items-center gap-1 rounded-xl border p-4 font-medium transition',
                  settings.locale === 'en' && 'border-primary bg-primary/5',
                )}
              >
                <RadioGroupItem value="en" className="sr-only" />
                <span className="text-lg font-bold">English</span>
                <span className="text-xs text-muted-foreground" dir="ltr">
                  English
                </span>
              </Label>
              <Label
                className={cn(
                  'flex cursor-pointer flex-col items-center gap-1 rounded-xl border p-4 font-medium transition',
                  settings.locale === 'ar' && 'border-primary bg-primary/5',
                )}
              >
                <RadioGroupItem value="ar" className="sr-only" />
                <span className="text-lg font-bold">العربية</span>
                <span className="text-xs text-muted-foreground">Arabic — RTL</span>
              </Label>
            </RadioGroup>
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-base">{t('settings.data')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div>
              <p className="text-sm font-medium">{t('settings.data-path')}</p>
              <p dir="ltr" className="mt-1 truncate rounded-lg bg-muted px-3 py-2 font-mono text-xs text-muted-foreground">
                {appInfo?.dataPath ?? '…'}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">{t('settings.data-note')}</p>
            </div>
            <Button variant="outline" size="sm" className="w-fit" onClick={() => void actions.openDataFolder()}>
              <FolderOpen className="size-4" />
              {t('settings.open-data')}
            </Button>
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Info className="size-4 text-primary" />
              {t('settings.about')}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm text-muted-foreground">
            <p>
              {t('settings.version')}: <span className="font-mono">{appInfo?.version ?? '—'}</span>
            </p>
            <p>
              {t('settings.platform')}: <span className="font-mono">{appInfo?.platform ?? '—'}</span>
            </p>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
