import '@fontsource-variable/inter';
import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Icons } from '@/components/icons';

export const metadata: Metadata = {
  title: { default: 'i-jobs: remote jobs you can actually get', template: '%s · i-jobs' },
  description: 'i-jobs finds remote jobs you can actually get, matches them to your CV and applies for you, inside rules you set.',
  icons: { icon: '/favicon.png' },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#FFFFFF' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-NG">
      <body>
        <Icons />
        {children}
      </body>
    </html>
  );
}
