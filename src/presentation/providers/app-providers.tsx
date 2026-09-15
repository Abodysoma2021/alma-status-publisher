'use client';

import * as React from 'react';
import { AlmaProvider, useAlma, setReportLocale } from './alma-provider';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';

/**
 * Keeps the module-level toast reporter in sync with the active locale.
 */
function LocaleSync() {
  const { locale } = useAlma();
  React.useEffect(() => {
    setReportLocale(locale);
  }, [locale]);
  return null;
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <AlmaProvider>
      <TooltipProvider delayDuration={200}>
        <LocaleSync />
        {children}
        <Toaster position="top-center" richColors closeButton />
      </TooltipProvider>
    </AlmaProvider>
  );
}
