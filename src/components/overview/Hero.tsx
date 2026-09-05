'use client';

// The one place the app is allowed to be a landing page. Everything in it is still live data —
// the stat chips read from the same registry/markets queries the cards below use, so the hero
// cannot drift out of sync with the dashboard.
import Link from 'next/link';
import { ArrowRight, Zap } from 'lucide-react';
import { useMarkets, useRegistry } from '@/hooks/useMarketData';
import { useChainHealth } from '@/hooks/useChainHealth';
import { COOK_SYMBOL } from '@/lib/config';
import { compact, formatUsd } from '@/lib/format';
import { Skeleton, StatusDot } from '@/components/ui/primitives';

function Stat({ label, value, loading }: { label: string; value: string; loading: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">{label}</dt>
      <dd className="mt-1 font-display text-lg font-bold tabular-nums tracking-tight sm:text-xl">
        {loading ? <Skeleton className="h-6 w-20" /> : value}
      </dd>
    </div>
  );
}

export function Hero() {
  const { cookUsd, count, isLoading: registryLoading } = useRegistry();
  const { data: markets, isLoading: marketsLoading } = useMarkets();
  const { data: health } = useChainHealth();

  return (
    <section className="relative overflow-hidden rounded-2xl border border-hairline/10 px-5 py-10 sm:px-8 sm:py-14">
      {/* Local glow, stronger than the page ambient, anchored behind the headline. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(40rem 22rem at 22% 0%, rgb(var(--glow-a) / 0.30), transparent 62%), radial-gradient(32rem 18rem at 92% 110%, rgb(var(--glow-b) / 0.20), transparent 60%), linear-gradient(160deg, rgb(var(--surface) / 0.9), rgb(var(--ground) / 0.4))',
        }}
      />

      <div className="max-w-3xl">
        <p className="inline-flex items-center gap-2 rounded-full border border-hairline/10 bg-surface2/50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink2 backdrop-blur">
          <StatusDot status={health?.status ?? 'unknown'} />
          Cookie Chain mainnet
        </p>

        <h1 className="mt-5 font-display text-[clamp(2rem,6.2vw,3.5rem)] font-extrabold leading-[1.03] tracking-tightest text-balance">
          Watch the chain,{' '}
          <span className="accent-text">trade the chain.</span>
        </h1>

        <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ink2">
          Every token, pool and swap on Cookie Chain in one terminal. Live chain health, a full
          screener, your portfolio, and routed swaps you sign in Nightly — nothing custodial.
        </p>

        <div className="mt-7 flex flex-wrap items-center gap-2.5">
          <Link
            href="/trade"
            className="accent-gradient inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-accent-ink shadow-[0_10px_28px_-10px_rgb(var(--accent-glow)/0.75)] transition-all hover:brightness-110"
          >
            <Zap size={15} /> Start trading
          </Link>
          <Link
            href="/screener"
            className="inline-flex items-center gap-1.5 rounded-xl border border-hairline/10 bg-surface2/60 px-4 py-2.5 text-sm font-semibold backdrop-blur transition-colors hover:border-accent/40"
          >
            Explore the screener <ArrowRight size={15} />
          </Link>
        </div>
      </div>

      <dl className="mt-10 grid max-w-2xl grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
        <Stat
          label={`${COOK_SYMBOL} price`}
          value={formatUsd(cookUsd)}
          loading={registryLoading}
        />
        <Stat
          label="Tokens tracked"
          value={count.toLocaleString('en-US')}
          loading={registryLoading}
        />
        <Stat
          label="Total value locked"
          value={markets ? `$${compact(markets.tvlUsd)}` : '—'}
          loading={marketsLoading}
        />
        <Stat
          label="Live pools"
          value={markets ? markets.poolCount.toLocaleString('en-US') : '—'}
          loading={marketsLoading}
        />
      </dl>
    </section>
  );
}
