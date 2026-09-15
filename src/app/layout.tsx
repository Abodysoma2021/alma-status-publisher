import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AppProviders } from '@/presentation/providers/app-providers';

export const metadata: Metadata = {
  title: 'Alma Status Publisher',
  description: 'Schedule WhatsApp statuses across every linked number.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0b1220',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <body className="antialiased">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
