import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
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
// layout shift. Inter carries prose; JetBrains Mono carries everything else.
//
// The terminal redesign made mono the display face for essentially all chrome — every h1, card
// title, LABEL, Pill, Button and nav link — but the family was still being loaded at 400/500 only.
// Roughly 30 elements per route asked for 600, 700 or 800 and got a browser-synthesised smear
// instead of a real cut. These are the weights the design actually uses; Google's JetBrains Mono
// axis tops out at 800, so 800 is the highest that can be requested here.
//
// Sora is gone. It was the old display face and, after the redesign, rendered on exactly zero
// elements — its @font-face declarations were dead weight in the CSS.
const sans = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  // Serves BOTH custom properties: tailwind.config.ts aliases `display` to the mono stack, and
  // pointing --font-display here keeps any remaining `font-display` class resolving to a real face.
  variable: '--font-mono',
  display: 'swap',
});

const TITLE = 'Cookie Pulse — watch the chain, trade the chain';
const DESCRIPTION =
  'Analytics and trade terminal for Cookie Chain: live chain health, a 6,000-token screener, portfolio, and swaps routed through the Cookiebox aggregator.';

/**
 * Absolute base for og:image and twitter:image.
 *
 * Without this Next falls back to http://localhost:3000, which is what it was emitting: the card
 * pointed at a host no crawler can reach, so every shared link would have rendered blank. VERCEL_URL
 * is injected per-deployment, so previews and production each advertise their own image without any
 * dashboard configuration; NEXT_PUBLIC_SITE_URL overrides it once there is a custom domain.
 */
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: 'Cookie Pulse',
  openGraph: { title: TITLE, description: DESCRIPTION, type: 'website', siteName: 'Cookie Pulse' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

export const viewport: Viewport = {
  // Matches --ground in the dark theme (10 11 13). It was #08090c, the pre-terminal ground, so
  // mobile browser chrome painted a hair darker than the page it framed.
  themeColor: '#0a0b0d',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${sans.variable} ${mono.variable}`}
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
