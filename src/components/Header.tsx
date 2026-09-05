'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useChainHealth } from '@/hooks/useChainHealth';
import { useChanged } from '@/hooks/useDelta';
import { useTheme } from '@/providers/ThemeProvider';
import { ScrollProgress } from '@/components/motion/ScrollProgress';
import { WalletButton } from './WalletButton';
import { Logo } from './ui/Logo';
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
  // A STRING, never the query object: `useRegistry` and friends hand back a fresh object every
  // poll, so identity comparison would fire this on every tick for no reason.
  const statusChanged = useChanged(status);

  const label = isError ? 'RPC down' : isLoading || !data ? 'Checking' : data.status;
  // Only the raw status VALUE arrives lowercase from the feed. 'RPC down' and 'Checking' are
  // already cased correctly, and title-casing them produced "RPC Down".
  const casesLabel = !isError && !isLoading && !!data;

  return (
    <span
      title={data?.note ?? label}
      className={cn(
        // No `capitalize` here: it applies per-WORD, so "RPC down" rendered as "RPC Down". Only
        // the status value needs casing, and it is wrapped for that at the call site below.
        'hidden items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-medium text-ink2 backdrop-blur transition-colors duration-[900ms] md:inline-flex',
        statusChanged
          ? 'border-warn/40 bg-warn/15 duration-0'
          : 'border-hairline/10 bg-surface2/60',
      )}
    >
      <StatusDot status={status} pinged={statusChanged} />
      <span className={casesLabel ? 'capitalize' : undefined}>{label}</span>
      {/* Fixed width and tabular figures: '12ms' → '104ms' used to widen this pill and shove the
          theme toggle and wallet button left every 15 seconds. The text itself never transitions —
          a fade on a number that is telling you nothing changed reads as a rendering bug. */}
      {data?.latencyMs ? (
        // No `normal-case` needed any more: the pill no longer capitalizes wholesale, so this
        // stopped rendering as "205 Ms" on its own.
        <span className="inline-block min-w-[3.25rem] text-right tabular-nums text-muted">
          {data.latencyMs} ms
        </span>
      ) : null}
    </span>
  );
}

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  // Without this gate, GateScript's synchronous `.light` correction spins the icon on first paint
  // for every light-theme user — animating a correction, not a state change.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <button
      type="button"
      onClick={toggle}
      data-mounted={mounted ? '' : undefined}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      className="theme-toggle press press-sm grid h-[33px] w-[33px] place-items-center rounded-xl border border-hairline/10 bg-surface2/60 text-ink2 backdrop-blur transition-colors hover:text-ink"
    >
      <Sun
        size={15}
        aria-hidden="true"
        className="theme-icon"
        data-active={theme === 'dark' ? '' : undefined}
      />
      <Moon
        size={15}
        aria-hidden="true"
        className="theme-icon"
        data-active={theme === 'light' ? '' : undefined}
      />
    </button>
  );
}

export function Header() {
  const pathname = usePathname();
  const headerRef = useRef<HTMLElement>(null);

  // `--header-h` is consumed by the screener's sticky filter bar and every scroll-margin that has
  // to clear this header. Measured in an effect, never during render — an offsetHeight read at
  // render time is a hydration mismatch waiting to happen.
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const write = () =>
      document.documentElement.style.setProperty('--header-h', `${el.offsetHeight}px`);
    write();
    const ro = new ResizeObserver(write);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <header
      ref={headerRef}
      // No transform, no height change, ever: either would destroy `position: sticky` and
      // `backdrop-blur` in one move, and a height change reflows every row below it.
      className="site-header sticky top-0 z-30 border-b border-hairline/10 bg-ground/70 backdrop-blur-xl"
    >
      <div className="mx-auto w-full max-w-[1280px] px-3 sm:px-6">
        <div className="flex h-16 items-center justify-between gap-2">
          <Link href="/" className="group flex shrink-0 items-center gap-2.5">
            {/* The tile no longer rotates. A logo that spins on hover is a decoration a designer
                would have cut — it says nothing about the product and it is the first thing on the
                page. What is left is a 2% scale, which reads as "this is a link". */}
            <span className="accent-gradient flex h-8 w-8 items-center justify-center rounded-xl text-accent-ink shadow-[0_6px_18px_-8px_rgb(var(--accent-glow)/0.8)] transition-transform duration-[220ms] ease-[cubic-bezier(.2,.7,.3,1)] group-hover:scale-[1.02] group-active:scale-[.98]">
              <Logo size={19} />
            </span>
            {/* The wordmark gets nothing: a travelling sheen on background-clip:text repaints every
                frame, inside a sticky backdrop-filtered bar, permanently, in peripheral vision. */}
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

        {/* Scrollable at 360px. Masked rather than guillotined, and the mask is static — an
            animated one would repaint the whole row. No reveal and no stagger: navigation must be
            complete and clickable in the first painted frame. */}
        <nav
          aria-label="Primary"
          className="-mx-3 flex gap-1 overflow-x-auto px-3 pb-2.5 [mask-image:linear-gradient(90deg,#000_0,#000_calc(100%-24px),transparent)] [scrollbar-width:none] sm:mx-0 sm:px-0 sm:[mask-image:none] [&::-webkit-scrollbar]:hidden"
        >
          {NAV.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative whitespace-nowrap rounded-xl px-3.5 py-1.5 text-[13px] font-medium',
                  'transition-[color,background-color] duration-[160ms] ease-[cubic-bezier(.2,.7,.3,1)]',
                  active
                    ? 'bg-surface2 text-ink shadow-[inset_0_1px_0_0_rgb(255_255_255/0.06)]'
                    : 'text-muted hover:bg-surface2/50 hover:text-ink2',
                )}
              >
                {item.label}
                {active ? (
                  <span className="nav-underline accent-gradient absolute inset-x-3.5 -bottom-px h-px rounded-full" />
                ) : null}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* The single mount point for useScrollShell — this one line is what drives the scrim, the
          haste governor and the ambient parallax for the entire application. */}
      <ScrollProgress />
    </header>
  );
}
