'use client';

// Overview. Four reads, all shared through React Query: chain health (batched RPC, 15s), the token
// registry (which carries cookUsd at the top level, so no separate price call), the markets snapshot
// and the activity feed.
import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Droplets } from 'lucide-react';
import { useMarkets, useRegistry } from '@/hooks/useMarketData';
import { COOK_MINT, COOK_SYMBOL } from '@/lib/config';
import { compact, formatUsd } from '@/lib/format';
import { ActivityPanel } from '@/components/overview/ActivityPanel';
import { HealthStrip } from '@/components/overview/HealthStrip';
import { Hero } from '@/components/overview/Hero';
import { MoversTiles } from '@/components/overview/MoversTiles';
import { Card, Change, EmptyState, Skeleton } from '@/components/ui/primitives';

function CardLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="group flex h-full flex-col p-4 transition-colors hover:bg-surface2/40 sm:p-5"
    >
      {children}
    </Link>
  );
}

function CardHeading({ title, cta }: { title: string; cta: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</h2>
      <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-semibold text-muted transition-colors group-hover:text-accent">
        {cta}
        <ArrowUpRight size={12} aria-hidden="true" />
      </span>
    </div>
  );
}

function CookPriceCard() {
  const { cookUsd, byMint, count, isLoading, isError } = useRegistry();

  // `toToken` already maps the indexer's default 0 to null, so this renders an em dash rather than
  // a fabricated +0.00% whenever Cookiescan has no 24h window for COOK.
  const change24h = byMint.get(COOK_MINT)?.change24h ?? null;

  return (
    <Card as="section" className="overflow-hidden">
      <CardLink href="/screener">
        <CardHeading title={`${COOK_SYMBOL} price`} cta="Screener" />

        {isLoading ? (
          <div className="mt-3 space-y-2">
            <Skeleton className="h-8 w-36" />
            <Skeleton className="h-3 w-24" />
          </div>
        ) : isError || cookUsd === null ? (
          <div className="mt-3">
            <p className="text-2xl font-extrabold tabular-nums text-muted">—</p>
            <p className="mt-1 text-xs text-muted">Cookiescan price feed unavailable.</p>
          </div>
        ) : (
          <>
            <p className="mt-3 text-2xl font-extrabold tabular-nums sm:text-3xl">
              {formatUsd(cookUsd)}
            </p>
            <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-xs text-muted">
              <Change value={change24h} className="text-[13px] font-semibold" />
              <span>24h</span>
            </p>
          </>
        )}

        <p className="mt-auto pt-4 text-[11px] text-muted">
          Native {COOK_SYMBOL} ·{' '}
          {isLoading ? '…' : isError ? '—' : count.toLocaleString('en-US')} tokens tracked
        </p>
      </CardLink>
    </Card>
  );
}

function VenueBar({ share }: { share: number }) {
  return (
    <span className="block h-1 w-full overflow-hidden rounded-full bg-surface2" aria-hidden="true">
      <span
        className="block h-full rounded-full bg-accent/70"
        style={{ width: `${Math.min(100, Math.max(2, share))}%` }}
      />
    </span>
  );
}

function TvlCard() {
  const { data, isLoading, isError } = useMarkets();
  const total = data?.tvlUsd ?? 0;

  return (
    <Card as="section" className="overflow-hidden lg:col-span-2">
      <CardLink href="/screener">
        <CardHeading title="Total value locked" cta="Screener" />

        {isLoading ? (
          <div className="mt-3 space-y-2">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-3 w-28" />
            <div className="space-y-2 pt-3">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-6 w-full" />
              ))}
            </div>
          </div>
        ) : isError || !data ? (
          <EmptyState
            title="Markets feed unavailable"
            hint="Cookiescan did not return the pool list. It retries every 30 seconds."
          />
        ) : (
          <>
            <p className="mt-3 text-2xl font-extrabold tabular-nums sm:text-3xl">
              {formatUsd(data.tvlUsd)}
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
              <Droplets size={13} aria-hidden="true" />
              across {data.poolCount.toLocaleString('en-US')} pools
            </p>

            {data.venues.length === 0 ? (
              <p className="mt-4 text-xs text-muted">No pools reported by the markets feed.</p>
            ) : (
              <ul className="mt-4 space-y-2.5">
                {data.venues.map((v) => (
                  <li key={v.venue}>
                    <div className="flex items-baseline justify-between gap-2 text-xs">
                      <span className="min-w-0 truncate font-medium capitalize text-ink2">
                        {v.venue.toLowerCase()}
                      </span>
                      <span className="shrink-0 tabular-nums text-muted">
                        {v.poolCount} {v.poolCount === 1 ? 'pool' : 'pools'} ·{' '}
                        <span className="font-semibold text-ink2">${compact(v.tvlUsd)}</span>
                      </span>
                    </div>
                    <div className="mt-1">
                      <VenueBar share={total > 0 ? (v.tvlUsd / total) * 100 : 0} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </CardLink>
    </Card>
  );
}

export default function OverviewPage() {
  return (
    // The <h1> lives in <Hero>, so there is exactly one on the page.
    <div className="space-y-4 py-1 sm:space-y-5">
      <Hero />

      <section className="space-y-4 sm:space-y-5">
        <h2 className="sr-only">Chain and market data</h2>

        <HealthStrip />

        <div className="grid gap-4 lg:grid-cols-3">
          <CookPriceCard />
          <div className="lg:col-span-2">
            <TvlCard />
          </div>
        </div>

        <MoversTiles />

        <ActivityPanel />
      </section>
    </div>
  );
}
