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
    ? 'RPC unreachable'
    : isLoading || !data
      ? 'Checking chain…'
      : `${data.status}${data.latencyMs ? ` · ${data.latencyMs}ms` : ''}`;

  return (
    <span
      title={data?.note ?? label}
      className="hidden items-center gap-1.5 rounded-full border border-rule bg-surface2 px-2.5 py-1 text-[11px] font-medium capitalize text-ink2 md:inline-flex"
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
      className="rounded-lg border border-rule bg-surface2 p-2 text-ink2 transition-colors hover:text-ink"
    >
      {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  );
}

export function Header() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 border-b border-rule bg-ground/85 backdrop-blur">
      <div className="mx-auto w-full max-w-[1240px] px-3 sm:px-5">
        <div className="flex h-14 items-center justify-between gap-2">
          <Link href="/" className="flex shrink-0 items-center gap-2">
            <span aria-hidden="true" className="text-lg">
              🍪
            </span>
            <span className="text-[15px] font-extrabold tracking-tight">
              Cookie<span className="text-accent">Pulse</span>
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
          className="-mx-3 flex gap-1 overflow-x-auto px-3 pb-2 sm:mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]{display:none}"
        >
          {NAV.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors',
                  active ? 'bg-surface2 text-ink' : 'text-muted hover:bg-surface2/60 hover:text-ink2',
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
