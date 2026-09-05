import Link from 'next/link';
import { Reveal } from '@/components/motion/Reveal';
import { EXPLORER_URL, RPC_URL } from '@/lib/config';

const LINKS = [
  { href: 'https://cookiescan.io', label: 'Cookiescan' },
  { href: 'https://cookiebox.app', label: 'Cookiebox' },
  { href: 'https://github.com/cookiechain/cookie-mcp', label: 'cookie-mcp' },
  { href: 'https://nightly.app', label: 'Nightly' },
];

export function Footer() {
  return (
    <footer className="border-t border-hairline/10">
      <Reveal index={0} className="mx-auto flex w-full max-w-[1280px] flex-col gap-3 px-3 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="min-w-0">
          <p className="font-display text-[13px] font-bold tracking-tight">
            Cookie<span className="accent-text">Pulse</span>
          </p>
          <p className="mt-0.5 truncate text-[11px] text-muted">
            Live data from {RPC_URL.replace('https://', '')} · non-custodial, the wallet signs in
            your browser
          </p>
        </div>

        <nav aria-label="External resources" className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {LINKS.map((l, i) => (
            <a
              key={l.href}
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              data-stagger="fade"
              style={{ '--i': i } as React.CSSProperties}
              className="link-wipe relative text-[11px] font-medium text-muted transition-colors duration-[160ms] hover:text-accent after:absolute after:inset-x-0 after:-bottom-0.5 after:h-px after:bg-accent after:content-['']"
            >
              {l.label}
            </a>
          ))}
          <a
            href={EXPLORER_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] font-medium text-muted transition-colors hover:text-accent"
          >
            Explorer
          </a>
          <Link
            href="/bridge"
            className="text-[11px] font-medium text-muted transition-colors hover:text-accent"
          >
            Get COOK
          </Link>
        </nav>
      </Reveal>
    </footer>
  );
}
