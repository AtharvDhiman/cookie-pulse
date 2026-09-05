import type { Metadata, Viewport } from 'next';
import { Toaster } from 'sonner';
import { CookieWalletProvider } from '@/providers/WalletProvider';
import { QueryProvider } from '@/providers/QueryProvider';
import { ThemeProvider } from '@/providers/ThemeProvider';
import { Header } from '@/components/Header';
import { ZeroCookBanner } from '@/components/ZeroCookBanner';
import './globals.css';

export const metadata: Metadata = {
  title: 'Cookie Pulse — watch the chain, trade the chain',
  description:
    'Analytics and trade terminal for Cookie Chain: token screener, portfolio, swaps via Cookiebox, and a live activity feed.',
};

export const viewport: Viewport = {
  themeColor: '#0e1015',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-ground text-ink antialiased">
        <ThemeProvider>
          <QueryProvider>
            <CookieWalletProvider>
              <a
                href="#main"
                className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-accent-ink"
              >
                Skip to content
              </a>
              <Header />
              <ZeroCookBanner />
              <main id="main" className="mx-auto w-full max-w-[1240px] px-3 pb-16 pt-4 sm:px-5">
                {children}
              </main>
              <Toaster
                position="bottom-right"
                closeButton
                toastOptions={{
                  className: 'font-sans',
                  style: {
                    background: 'rgb(var(--surface))',
                    color: 'rgb(var(--ink))',
                    border: '1px solid rgb(var(--rule))',
                  },
                }}
              />
            </CookieWalletProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
