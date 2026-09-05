'use client';

// Top gainers / losers / volume. Verified 5 Sep 2026: of 6470 registry tokens only 92 carry a USD
// price and only 3 have any 24h movement, so these tiles are built to look right with 1-3 rows and
// to say so plainly when there are none — never padded with flat rows to fill the space.
import { useMemo, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Flame, TrendingDown, TrendingUp, type LucideIcon } from 'lucide-react';
import { rankableTokens, useRegistry } from '@/hooks/useMarketData';
import { COOK_MINT } from '@/lib/config';
import { formatUsd } from '@/lib/format';
import type { Token } from '@/lib/types';
import { Card, Change, EmptyState, Skeleton, TokenLogo } from '@/components/ui/primitives';

const ROWS = 5;

// The ROW gets an opacity-only stagger and nothing else — no translate, no logo scale, no chevron.
// Three tiles of five rows with transforms would be fifteen moving elements inside three panels;
// and moving a 40px row sideways while the user is comparing two prices down a tabular-nums column
// is a straight legibility cost for no information.
function TokenRow({ token, metric, index }: { token: Token; metric: ReactNode; index: number }) {
  return (
    <li data-stagger="fade" style={{ '--i': index } as CSSProperties}>
      <Link
        href={`/trade?in=${COOK_MINT}&out=${token.mint}`}
        className="flex items-center gap-2.5 px-3 py-2 transition-colors hover:bg-surface2 sm:px-4"
      >
        <TokenLogo logo={token.logo} symbol={token.symbol} size={26} />

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold">{token.symbol}</span>
          <span className="block truncate text-[11px] text-muted">{token.name}</span>
        </span>

        <span className="shrink-0 text-right">
          <span className="block text-[13px] font-semibold tabular-nums">
            {formatUsd(token.priceUsd)}
          </span>
          <span className="block text-[11px] font-medium tabular-nums">{metric}</span>
        </span>
      </Link>
    </li>
  );
}

function RowsSkeleton() {
  return (
    <ul>
      {Array.from({ length: 3 }, (_, i) => (
        <li key={i} className="flex items-center gap-2.5 px-3 py-2 sm:px-4">
          <Skeleton className="h-[26px] w-[26px] rounded-full" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-2 w-24" />
          </div>
          <div className="shrink-0 space-y-1.5">
            <Skeleton className="ml-auto h-3 w-14" />
            <Skeleton className="ml-auto h-2 w-10" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Tile({
  title,
  icon: Icon,
  iconClass,
  tokens,
  metric,
  isLoading,
  isError,
  empty,
  revealIndex,
}: {
  title: string;
  icon: LucideIcon;
  iconClass: string;
  tokens: Token[];
  metric: (t: Token) => ReactNode;
  isLoading: boolean;
  isError: boolean;
  empty: { title: string; hint: string };
  /** Each Tile reveals on its own beat. Never the grid: at lg it is one wide short row with no
   *  cascade possible, and at md/sm it is a ~700px block whose top arms while its last tile is
   *  still a full screen below the fold. */
  revealIndex: number;
}) {
  return (
    // Solid because it reveals — a transform on a backdrop-filtered panel re-blurs its whole
    // backdrop every frame, and there are three of them side by side.
    <Card
      as="section"
      variant="solid"
      className="flex flex-col overflow-hidden"
      reveal
      revealIndex={revealIndex}
    >
      <div className="flex items-center justify-between gap-2 border-b border-hairline/10 px-3 py-2.5 sm:px-4">
        <h2 className="flex items-center gap-1.5 text-[13px] font-bold">
          <Icon size={14} className={iconClass} aria-hidden="true" />
          {title}
        </h2>
        <Link
          href="/screener"
          className="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-semibold text-muted transition-colors hover:text-accent"
        >
          Screener
          <ArrowUpRight size={12} aria-hidden="true" />
        </Link>
      </div>

      {isLoading ? (
        <RowsSkeleton />
      ) : isError ? (
        <EmptyState title="Token registry unavailable" hint="Cookiescan did not answer. Retrying shortly." />
      ) : tokens.length === 0 ? (
        <EmptyState title={empty.title} hint={empty.hint} />
      ) : (
        <ul className="divide-y divide-hairline/10">
          {/* Keys stay `t.mint`. The 30s poll re-ranks these in place — instantly, with no FLIP and
              no highlight — and a stable key is what stops the re-rank replaying the stagger. */}
          {tokens.map((t, i) => (
            <TokenRow key={t.mint} token={t} metric={metric(t)} index={i} />
          ))}
        </ul>
      )}
    </Card>
  );
}

export function MoversTiles() {
  const { tokens, isLoading, isError } = useRegistry();

  const { gainers, losers, byVolume } = useMemo(() => {
    const ranked = rankableTokens(tokens);
    return {
      gainers: ranked
        .filter((t) => (t.change24h ?? 0) > 0)
        .sort((a, b) => (b.change24h ?? 0) - (a.change24h ?? 0))
        .slice(0, ROWS),
      losers: ranked
        .filter((t) => (t.change24h ?? 0) < 0)
        .sort((a, b) => (a.change24h ?? 0) - (b.change24h ?? 0))
        .slice(0, ROWS),
      byVolume: ranked
        .filter((t) => t.volume24h > 0)
        .sort((a, b) => b.volume24h - a.volume24h)
        .slice(0, ROWS),
    };
  }, [tokens]);

  const common = { isLoading, isError };

  return (
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
      <Tile
        {...common}
        revealIndex={0}
        title="Top gainers"
        icon={TrendingUp}
        iconClass="text-up"
        tokens={gainers}
        metric={(t) => <Change value={t.change24h} />}
        empty={{
          title: 'Nothing gained in the last 24h',
          hint: 'Cookie Chain is quiet today — no priced token closed up.',
        }}
      />
      <Tile
        {...common}
        revealIndex={1}
        title="Top losers"
        icon={TrendingDown}
        iconClass="text-down"
        tokens={losers}
        metric={(t) => <Change value={t.change24h} />}
        empty={{
          title: 'Nothing lost in the last 24h',
          hint: 'Cookie Chain is quiet today — no priced token closed down.',
        }}
      />
      <Tile
        {...common}
        revealIndex={2}
        title="Top volume"
        icon={Flame}
        iconClass="text-accent"
        tokens={byVolume}
        metric={(t) => (
          <span className="text-ink2">{formatUsd(t.volume24h, { compact: true })}</span>
        )}
        empty={{
          title: 'No 24h volume yet',
          hint: 'No pool has traded in the last 24 hours.',
        }}
      />
    </div>
  );
}
