'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Moon, Sun } from 'lucide-react';
import { useChainHealth } from '@/hooks/useChainHealth';
import { useTheme } from '@/providers/ThemeProvider';
import { WalletButton } from './WalletButton';
import { StatusDot, cn } from './ui/primitives';

const NAV = [
  { href: '/', label: 'Overview' },
  { href: '/screener', label: 'Screener' },
  { href: '/trade', label: 'Trade' },
  { href: '/send', label: 'Send' },
  { href: '/portfolio', label: 'Portfolio' },
  { href: '/bridge', label: 'Get COOK' },
];

function ChainStatus() {
  const { data, isLoading, isError } = useChainHealth();
  const status = isError ? 'down' : isLoading || !data ? 'unknown' : data.status;
  const label = isError
    ? 'RPC down'
    : isLoading || !data
      ? 'Checking'
      : `${data.status}${data.latencyMs ? ` · ${data.latencyMs}ms` : ''}`;

  return (
    <span
      title={data?.note ?? label}
      className="hidden items-center gap-2 rounded-full border border-hairline/10 bg-surface2/60 px-3 py-1.5 text-[11px] font-medium capitalize text-ink2 backdrop-blur md:inline-flex"
    >
      <StatusDot status={status} />
      {label}
    </span>
  );
}

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      className="rounded-xl border border-hairline/10 bg-surface2/60 p-2 text-ink2 backdrop-blur transition-colors hover:text-ink"
    >
      {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  );
}

export function Header() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 border-b border-hairline/10 bg-ground/70 backdrop-blur-xl">
      <div className="mx-auto w-full max-w-[1280px] px-3 sm:px-6">
        <div className="flex h-16 items-center justify-between gap-2">
          <Link href="/" className="group flex shrink-0 items-center gap-2.5">
            <span className="accent-gradient flex h-8 w-8 items-center justify-center rounded-xl text-base shadow-[0_6px_18px_-8px_rgb(var(--accent-glow)/0.8)]">
              🍪
            </span>
            <span className="font-display text-[17px] font-extrabold tracking-tightest">
              Cookie<span className="accent-text">Pulse</span>
            </span>
          </Link>

          <div className="flex items-center gap-2">
            <ChainStatus />
            <ThemeToggle />
            <WalletButton />
          </div>
        </div>

        {/* Scrollable on narrow screens so all six routes stay reachable at 360px. */}
        <nav
          aria-label="Primary"
          className="-mx-3 flex gap-1 overflow-x-auto px-3 pb-2.5 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden"
        >
          {NAV.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative whitespace-nowrap rounded-xl px-3.5 py-1.5 text-[13px] font-medium transition-colors',
                  active
                    ? 'bg-surface2 text-ink shadow-[inset_0_1px_0_0_rgb(255_255_255/0.06)]'
                    : 'text-muted hover:bg-surface2/50 hover:text-ink2',
                )}
              >
                {item.label}
                {active ? (
                  <span className="accent-gradient absolute inset-x-3.5 -bottom-px h-px rounded-full" />
                ) : null}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
