import type { Metadata, Viewport } from 'next';
import { Inter, Sora, JetBrains_Mono } from 'next/font/google';
import { Toaster } from 'sonner';
import { CookieWalletProvider } from '@/providers/WalletProvider';
import { QueryProvider } from '@/providers/QueryProvider';
import { ThemeProvider } from '@/providers/ThemeProvider';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { ZeroCookBanner } from '@/components/ZeroCookBanner';
import { GateScript } from '@/components/motion/GateScript';
import './globals.css';

// Self-hosted by next/font, so there is no render-blocking request to fonts.googleapis.com and no
// layout shift. Sora carries the display headings, Inter the UI, JetBrains Mono the addresses.
const sans = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const display = Sora({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  variable: '--font-display',
  display: 'swap',
});
const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

const TITLE = 'Cookie Pulse — watch the chain, trade the chain';
const DESCRIPTION =
  'Analytics and trade terminal for Cookie Chain: live chain health, a 6,000-token screener, portfolio, and swaps routed through the Cookiebox aggregator.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  applicationName: 'Cookie Pulse',
  openGraph: { title: TITLE, description: DESCRIPTION, type: 'website', siteName: 'Cookie Pulse' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

export const viewport: Viewport = {
  themeColor: '#08090c',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${sans.variable} ${display.variable} ${mono.variable}`}
    >
      {/* `isolate` gives the ambient layer a stacking context to sit behind without escaping. */}
      <body className="isolate flex min-h-screen flex-col bg-ground text-ink antialiased">
        {/* First child, and blocking on purpose: it adds `.js` before anything paints, which is
            what lets every hidden pre-animation state be gated on that class. Also applies the
            stored theme pre-paint, removing the light-theme flash. */}
        <GateScript />
        <div className="ambient" aria-hidden="true" />
        <ThemeProvider>
          <QueryProvider>
            <CookieWalletProvider>
              <a
                href="#main"
                className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-xl focus:bg-accent focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-accent-ink"
              >
                Skip to content
              </a>
              <Header />
              <ZeroCookBanner />
              <main
                id="main"
                className="mx-auto w-full max-w-[1280px] flex-1 px-3 pb-20 pt-4 sm:px-6"
              >
                {children}
              </main>
              <Footer />
              <Toaster
                position="bottom-right"
                closeButton
                toastOptions={{
                  className: 'font-sans',
                  style: {
                    background: 'rgb(var(--surface))',
                    color: 'rgb(var(--ink))',
                    border: '1px solid rgb(var(--hairline) / var(--hairline-alpha))',
                    boxShadow: 'var(--shadow-lift)',
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
