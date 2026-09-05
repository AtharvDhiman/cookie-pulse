'use client';

// Overview. Four reads, all shared through React Query: chain health (batched RPC, 15s), the token
// registry (which carries cookUsd at the top level, so no separate price call), the markets snapshot
// and the activity feed.
import type { CSSProperties, ReactNode } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Droplets } from 'lucide-react';
import { useMarkets, useRegistry } from '@/hooks/useMarketData';
import { COOK_MINT, COOK_SYMBOL } from '@/lib/config';
import { compact, formatUsd } from '@/lib/format';
import { useCapital } from '@/hooks/useCapital';
import { ActivityPanel } from '@/components/overview/ActivityPanel';
import { CapitalMap } from '@/components/overview/CapitalMap';
import { HealthStrip } from '@/components/overview/HealthStrip';
import { Hero } from '@/components/overview/Hero';
import { MoversTiles } from '@/components/overview/MoversTiles';
import { LABEL_MUTED, Card, Change, EmptyState, Skeleton } from '@/components/ui/primitives';

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
      <h2 className={LABEL_MUTED}>{title}</h2>
      <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-semibold text-muted transition-colors group-hover:text-accent">
        {cta}
        {/* The arrow moves, the card does not. These are panels the user hovers in order to READ a
            live number; an unbounded hover transform on the panel itself would re-composite the
            whole surface for as long as the pointer rests there. */}
        <ArrowUpRight
          size={12}
          aria-hidden="true"
          className="transition-transform duration-200 motion-safe:group-hover:translate-x-0.5 motion-safe:group-hover:-translate-y-0.5"
        />
      </span>
    </div>
  );
}

function CookPriceCard() {
  const { cookUsd, byMint, count, fungibleCount, isLoading, isError } = useRegistry();

  // `toToken` already maps the indexer's default 0 to null, so this renders an em dash rather than
  // a fabricated +0.00% whenever Cookiescan has no 24h window for COOK.
  const change24h = byMint.get(COOK_MINT)?.change24h ?? null;

  return (
    // `variant="solid"` is required by the reveal, not a style choice: the reveal transforms this
    // element, and transforming a backdrop-filtered surface forces the compositor to re-sample and
    // re-blur its entire backdrop every frame — and visibly shifts its tint while it does.
    <Card as="section" variant="solid" className="overflow-hidden" reveal revealIndex={0}>
      <CardLink href="/screener">
        <CardHeading title={`${COOK_SYMBOL} price`} cta="Screener" />

        {isLoading ? (
          <div className="mt-3 space-y-2">
            <Skeleton className="h-8 w-36" />
            <Skeleton className="h-3 w-24" />
          </div>
        ) : isError || cookUsd === null ? (
          // No fade on the failure branch: `isError` flips on a 30s poll, and ceremony on an error
          // that appears and disappears four times a minute is exactly the flicker the system bans.
          <div className="mt-3">
            <p className="text-2xl font-extrabold tabular-nums text-muted">—</p>
            <p className="mt-1 text-xs text-muted">Cookiescan price feed unavailable.</p>
          </div>
        ) : (
          // The resolved block crossfades in over the skeleton. Its contents do not stagger — the
          // price is the reason the card exists and it arrives whole.
          <div className="enter-fade">
            <p className="mt-3 text-2xl font-extrabold tabular-nums sm:text-3xl">
              {formatUsd(cookUsd)}
            </p>
            <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-xs text-muted">
              <Change value={change24h} className="text-[13px] font-semibold" />
              <span>24h</span>
            </p>
          </div>
        )}

        {/* "6,473 tokens" would read as 6,473 comparable assets; three quarters of the registry is
            one-of-one NFT editions. Both numbers come from the response envelope, not from the
            projected row array. */}
        <p className="mt-auto pt-4 text-[11px] text-muted">
          Native {COOK_SYMBOL} ·{' '}
          {isLoading || isError
            ? '—'
            : `${fungibleCount.toLocaleString('en-US')} fungible mints of ${count.toLocaleString(
                'en-US',
              )} registry entries`}
        </p>
      </CardLink>
    </Card>
  );
}

function VenueBar({ share }: { share: number }) {
  return (
    <span className="block h-1 w-full overflow-hidden rounded-full bg-surface2" aria-hidden="true">
      {/* `venue-bar-fill` draws the bar once, on the card's first reveal, with scaleX. The inline
          width below still carries the true value — a transition on `width` would redraw all five
          bars on every 30s markets poll, forever. */}
      <span
        className="venue-bar-fill block h-full rounded-full bg-accent/70"
        // The 2% floor keeps a tiny-but-real share visible; a true zero draws nothing.
        style={{ width: `${share > 0 ? Math.min(100, Math.max(2, share)) : 0}%` }}
      />
    </span>
  );
}

function TvlCard() {
  const { data, isLoading, isError } = useMarkets();
  const total = data?.tvlUsd ?? 0;

  return (
    // revealIndex 1 puts this one 90ms behind the price card, so the grid row reads left to right.
    // On mobile they stack and cross the fold separately, where the delay is invisible.
    <Card
      as="section"
      variant="solid"
      className="overflow-hidden lg:col-span-2"
      reveal
      revealIndex={1}
    >
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
          <div className="enter-fade">
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
                {/* Keys stay `v.venue`, so a 30s poll that returns the same venues reconciles in
                    place and nothing here replays. `--i` only ever runs on the first reveal. */}
                {data.venues.map((v, i) => (
                  <li key={v.venue} data-stagger="" style={{ '--i': i } as CSSProperties}>
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
          </div>
        )}
      </CardLink>
    </Card>
  );
}

function CapitalMapSection() {
  const { snapshot, isLoading } = useCapital();
  return <CapitalMap snapshot={snapshot} isLoading={isLoading} />;
}

export default function OverviewPage() {
  return (
    // The <h1> lives in <Hero>, so there is exactly one on the page.
    //
    // NEITHER wrapper below carries a reveal. Putting one on the ~2,000px <section> would treat the
    // whole page as a single target: with the armed fold it crosses the threshold at load, and every
    // card inside it would already be revealed before the user scrolled a pixel. The reveal targets
    // are the individual Cards, which is also why there are no wrapper divs — TvlCard declares its
    // own `lg:col-span-2` and a wrapper would become the grid item and swallow the span.
    <div className="space-y-4 py-1 sm:space-y-5">
      <Hero />

      <section className="space-y-4 sm:space-y-5">
        <h2 className="sr-only">Chain and market data</h2>

        <HealthStrip />

        {/* Above the price/TVL row, not below it. The hero already states the price and the TVL,
            so that row restates the first screen; the capital map is the thing no other submission
            has, and it was sitting 1.4 screens down. */}
        <CapitalMapSection />

        <div className="grid gap-4 lg:grid-cols-3">
          <CookPriceCard />
          {/* TvlCard declares its own lg:col-span-2, so it must be a direct grid child. */}
          <TvlCard />
        </div>

        <MoversTiles />

        <ActivityPanel />
      </section>
    </div>
  );
}
