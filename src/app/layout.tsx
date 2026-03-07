import { Inter, Space_Grotesk, Space_Mono, Plus_Jakarta_Sans } from 'next/font/google';

import { GlobalSettingsButton } from '@/components/global-settings-button';
import { ThemeInitScript } from '@/components/theme-init';
import { Toaster } from '@/components/ui/toaster';
import { UpdateBanner } from '@/components/update-banner';

import type { Metadata } from 'next';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-space-grotesk',
});

const spaceMono = Space_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  display: 'swap',
  variable: '--font-space-mono',
});

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-plus-jakarta',
});

export const metadata: Metadata = {
  title: 'Beads',
  description: 'Kanban interface for beads - git-backed distributed issue tracker',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`dark ${inter.variable} ${spaceGrotesk.variable} ${spaceMono.variable} ${plusJakartaSans.variable}`} suppressHydrationWarning>
      <head>
        <ThemeInitScript />
      </head>
      <body className="flex min-h-screen flex-col bg-background antialiased transition-colors duration-300">
        <div className="flex-1">{children}</div>
        <GlobalSettingsButton />
        <UpdateBanner />
        <Toaster />
      </body>
    </html>
  );
}
