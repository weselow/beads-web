import { DevTools } from '@/components/dev-tools';
import { GlobalSettingsButton } from '@/components/global-settings-button';
import { ThemeInitScript } from '@/components/theme-init';
import { Toaster } from '@/components/ui/toaster';
import { UpdateBanner } from '@/components/update-banner';

import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Beads',
  description: 'Kanban interface for beads - git-backed distributed issue tracker',
  icons: [{ rel: 'icon', url: '/favicon.svg', type: 'image/svg+xml' }],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <ThemeInitScript />
      </head>
      <body className="flex min-h-screen flex-col bg-background antialiased transition-colors duration-300">
        <div className="flex-1">{children}</div>
        <GlobalSettingsButton />
        <UpdateBanner />
        <DevTools />
        <Toaster />
      </body>
    </html>
  );
}
