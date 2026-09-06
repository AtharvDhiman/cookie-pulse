/** @type {import('next').NextConfig} */

// Security headers.
//
// The app shipped with none: no CSP, no frame-ancestors, no nosniff, no Referrer-Policy. On a page
// where people sign transactions, the missing frame protection is the one that actually matters —
// /trade and /send could be iframed and overlaid for clickjacking.
//
// Origins are read from the same env vars src/lib/config.ts inlines, so repointing the RPC cannot
// silently break the app's own policy.
const RPC = (process.env.NEXT_PUBLIC_RPC_URL || 'https://rpc.cookiescan.io').trim().replace(/\/+$/, '');
const WS = (process.env.NEXT_PUBLIC_WS_URL || 'wss://rpc.cookiescan.io').trim().replace(/\/+$/, '');

const dev = process.env.NODE_ENV === 'development';

const csp = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",

  // 'unsafe-inline': every route here is statically prerendered, so Next emits no per-request
  // nonce, and the RSC flight payload's hash changes on every build — neither a nonce nor a hash
  // allowlist is available without turning the whole app dynamic.
  //
  // 'unsafe-eval' in DEVELOPMENT ONLY: `next dev` runs webpack with devtool 'eval-source-map',
  // which wraps every client module in eval(). headers() applies in dev too, so omitting this
  // makes `npm run dev` render a blank page. It is never sent in production.
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,

  // sonner builds its stylesheet with createElement('style') at import time and the reveal system
  // ships style="--i:N" attributes, so inline styles are unavoidable. No third-party origin is:
  // wallet-adapter-react-ui's stylesheet is vendored with its Google Fonts @import removed, and
  // next/font self-hosts. Measured on /trade: 0 requests to fonts.googleapis.com or
  // fonts.gstatic.com, and rpc.cookiescan.io is the only external origin the app touches at all.
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",

  // Token logos and NFT art are arbitrary off-chain URLs from a third-party registry; the wallet
  // adapter's own icons are data: URIs. This is the one directive that cannot be narrowed without
  // breaking the screener.
  "img-src 'self' data: https:",

  `connect-src 'self' ${RPC} ${WS}`,
  'upgrade-insecure-requests',
].join('; ');

const nextConfig = {
  reactStrictMode: true,
  // Was advertising the framework and its version family on every response for nothing.
  poweredByHeader: false,
  images: { unoptimized: true },
  eslint: { dirs: ['src', 'scripts'] },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          // Deliberately no `preload`: that is a one-way commitment binding the apex and every
          // sibling subdomain to HTTPS, and it does nothing until the domain is submitted to
          // hstspreload.org. Add it at the moment of submission, not before.
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Redundant with frame-ancestors on purpose, for agents that predate CSP Level 2.
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // usb/hid are deliberately NOT disabled: Wallet Standard autodetection is on, and a
          // browser-side hardware-wallet adapter needs WebHID.
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=(), browsing-topics=()',
          },
          // allow-popups rather than plain same-origin: a Wallet Standard web wallet talks to its
          // popup through window.opener, which strict COOP severs.
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
        ],
      },
    ];
  },

  webpack: (config) => {
    // @solana/web3.js v1 reaches for node builtins that have no browser equivalent.
    config.resolve.fallback = { ...config.resolve.fallback, fs: false, path: false, os: false, crypto: false };
    return config;
  },
};

export default nextConfig;
