"use client";

// The one place the app is allowed to be a landing page. Everything in it is still live data —
// the stat chips read from the same registry/markets queries the cards below use, so the hero
// cannot drift out of sync with the dashboard.
//
// MOTION: this section is above the fold, so its five children enter on a self-completing CSS
// `animation` that begins during HTML parse (`[data-enter]`), never on an IntersectionObserver —
// an observer here would leave a blank hero until hydration on a slow connection.
import type { CSSProperties, ReactNode } from "react";
import { ArrowRight, Zap } from "lucide-react";
import { ButtonLink } from "@/components/ui/Button";
import { useMarkets, useRegistry } from "@/hooks/useMarketData";
import { useChainHealth } from "@/hooks/useChainHealth";
import { COOK_SYMBOL } from "@/lib/config";
import { compact, formatUsd } from "@/lib/format";
import { CountUp } from "@/components/motion/CountUp";
import { OrbitSystem } from "./OrbitSystem";
import { LABEL, LABEL_MUTED, cn, Skeleton, StatusDot } from '@/components/ui/primitives';

// Module-scoped, as useCountUp requires: an inline arrow is a fresh prop identity on every render,
// which defeats the memo and restarts the roll every time a poll re-renders this tree.
const fmtInt = (n: number) => Math.round(n).toLocaleString("en-US");
const fmtCompactUsd = (n: number) => `$${compact(n)}`;

/** Position on the 60ms page-enter ladder. Bare number — units make the `min()` in the delay 0ms. */
const step = (i: number) => ({ "--i": i }) as CSSProperties;

function Stat({
  label,
  value,
  loading,
}: {
  label: string;
  value: ReactNode;
  loading: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className={LABEL_MUTED}>
        {label}
      </dt>
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
    // `isolate` is a bug fix, not styling: <body> is already isolated and `.ambient`'s base layer is
    // an OPAQUE gradient at z-index -1, so the glow below — a bare `-z-10` with no stacking context
    // between it and the body — has never actually rendered. This clamps it inside the section.
    <section className="relative isolate overflow-hidden rounded-2xl border border-hairline/10 px-5 py-10 sm:px-8 sm:py-14">
      {/* Local glow, stronger than the page ambient, anchored behind the headline. The vertical
          overscan is what the scroll-linked drift (`.hero-glow`, ~64px of travel) moves within, so
          the layer can never expose an unpainted edge at either end of the section. */}
      <div
        aria-hidden="true"
        className="hero-glow pointer-events-none absolute inset-x-0 -inset-y-12 -z-10"
        style={{
          background:
            "radial-gradient(40rem 22rem at 22% 0%, rgb(var(--glow-a) / 0.30), transparent 62%), radial-gradient(32rem 18rem at 92% 110%, rgb(var(--glow-b) / 0.20), transparent 60%), linear-gradient(160deg, rgb(var(--surface) / 0.9), rgb(var(--ground) / 0.4))",
        }}
      />

      {/* Two columns on desktop, stacked on mobile. The orbit follows the copy in DOM order, so a
          screen reader and a keyboard both reach the headline first. */}
      <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:gap-8">
        <div className="min-w-0">
          <div className="max-w-3xl">
            <p
              data-enter
              style={step(0)}
              className={cn(
                "inline-flex items-center gap-2 rounded-full border border-hairline/10 bg-surface2/50 px-3 py-1 backdrop-blur",
                LABEL,
                "text-ink2",
              )}
            >
              <StatusDot status={health?.status ?? "unknown"} />
              Cookie Chain mainnet
            </p>

            {/* Deliberately NOT split into per-word or per-character spans: that adds ~14 nodes, breaks
            text selection, find-in-page and the `text-balance` set here, and drags the accent
            gradient across a moving box. The whole line rises as one. */}
            <h1
              data-enter
              style={step(1)}
              className="mt-5 font-display text-[clamp(2rem,6.2vw,3.5rem)] font-extrabold leading-[1.03] tracking-tightest text-balance"
            >
              Watch the chain,{" "}
              <span className="accent-text">trade the chain.</span>
            </h1>

            <p
              data-enter
              style={step(2)}
              className="mt-4 max-w-xl text-[15px] leading-relaxed text-ink2"
            >
              Every token, pool and swap on Cookie Chain in one terminal. Swaps
              route through Cookiebox and resolve to a definite outcome &mdash;
              landed, failed, or never seen &mdash; never &ldquo;it may have
              worked.&rdquo;
            </p>

            {/* The row is one enter target, not two, so the buttons arrive as a pair. */}
            <div
              data-enter
              style={step(3)}
              className="mt-7 flex flex-wrap items-center gap-2.5"
            >
              {/* Both were hand-rolled, with a heavier glow and a slower curve than every other
              primary in the app. They now wear the same treatment as the swap button. */}
              <ButtonLink href="/trade">
                <Zap size={15} aria-hidden="true" /> Start trading
              </ButtonLink>
              <ButtonLink href="/screener" variant="secondary" className="group">
                Explore the screener
                <ArrowRight
                  size={15}
                  aria-hidden="true"
                  className="transition-transform duration-200 motion-safe:group-hover:translate-x-0.5"
                />
              </ButtonLink>
            </div>
          </div>

          {/* One enter target: four live figures arriving on their own ladder would read as four
          separate loads. It also must never parallax with the glow — this is data, not decoration. */}
          <dl
            data-enter
            style={step(4)}
            className="mt-10 grid max-w-2xl grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4"
          >
            {/* No count-up on the price: formatUsd switches formatting branch by magnitude and Cookie
            Chain prices reach 7.2e-9, so interpolating from 0 walks the sub-cent branch and jitters
            a 12-character decimal whose digit count changes every frame. It snaps. */}
            <Stat
              label={`${COOK_SYMBOL} price`}
              value={formatUsd(cookUsd)}
              loading={registryLoading}
            />
            {/* Was "Tokens tracked", which read as 6,475 comparable assets. Most of the registry
            is one-of-one NFT editions — the price card 350px below and /screener both say so, and
            this chip sat above two surfaces that disagreed with it. */}
            <Stat
              label="Registry entries"
              value={<CountUp value={count} format={fmtInt} />}
              loading={registryLoading}
            />
            {/* Compact TVL only — `compact()` holds its digit count steady ($8.10K), unlike formatUsd. */}
            <Stat
              label="Total value locked"
              value={
                <CountUp
                  value={markets ? markets.tvlUsd : null}
                  format={fmtCompactUsd}
                />
              }
              loading={marketsLoading}
            />
            <Stat
              label="Live pools"
              value={
                <CountUp
                  value={markets ? markets.poolCount : null}
                  format={fmtInt}
                />
              }
              loading={marketsLoading}
            />
          </dl>
        </div>

        {/* The orbit. Real venues, real pools, real validators — the diagram is the dataset, which
            is the only reason a terminal can justify one at all. */}
        {/* Desktop only. At 390x844 the hero measured 893px — taller than the viewport — and the
            orbit was cut in half by the fold, pushing the first real data ~200px below it. On a
            phone the four live stats above are the better use of that screen. */}
        <div data-enter style={step(4)} className="hidden min-w-0 lg:block">
          <OrbitSystem />
        </div>
      </div>
    </section>
  );
}
