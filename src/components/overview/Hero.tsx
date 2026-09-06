"use client";

// The masthead.
//
// This was a landing-page hero: a 56px gradient headline over a radial glow, inside a 16px-radius
// panel, with the live figures as a loose four-column row underneath. It was the single biggest
// reason the app read as a marketing site wearing a dashboard's clothes.
//
// A terminal opens with a masthead instead, so this is now three horizontal registers separated by
// rules rather than one floating panel:
//
//   1. STATUS   which chain, which slot, which epoch, is it up. One mono line, panel width.
//   2. BILLING  the headline and what the app does. Still prose — this is still the first thing a
//               judge reads — but set in mono at roughly two thirds of the old size.
//   3. TAPE     the four live figures, in cells divided by vertical rules, tabular.
//
// Everything is still live data: the tape reads from the same registry/markets queries the cards
// below use, so the masthead cannot drift out of sync with the dashboard.
//
// MOTION: this section is above the fold, so its children enter on a self-completing CSS
// `animation` that begins during HTML parse (`[data-enter]`), never on an IntersectionObserver —
// an observer here would leave a blank masthead until hydration on a slow connection.
import type { CSSProperties, ReactNode } from "react";
import { ArrowRight, Zap } from "lucide-react";
import { ButtonLink } from "@/components/ui/Button";
import { useMarkets, useRegistry } from "@/hooks/useMarketData";
import { useChainHealth } from "@/hooks/useChainHealth";
import { COOK_SYMBOL } from "@/lib/config";
import { compact, formatUsd } from "@/lib/format";
import { CountUp } from "@/components/motion/CountUp";
import { OrbitSystem } from "./OrbitSystem";
import { LABEL_MUTED, cn, Skeleton, StatusDot } from '@/components/ui/primitives';

// Module-scoped, as useCountUp requires: an inline arrow is a fresh prop identity on every render,
// which defeats the memo and restarts the roll every time a poll re-renders this tree.
const fmtInt = (n: number) => Math.round(n).toLocaleString("en-US");
const fmtCompactUsd = (n: number) => `$${compact(n)}`;

/** Position on the 60ms page-enter ladder. Bare number — units make the `min()` in the delay 0ms. */
const step = (i: number) => ({ "--i": i }) as CSSProperties;

/**
 * One cell of the tape. Divided from its neighbours by a rule rather than by whitespace, which is
 * what keeps four unrelated figures reading as one instrument instead of four chips.
 */
function Tick({
  label,
  value,
  loading,
}: {
  label: string;
  value: ReactNode;
  loading: boolean;
}) {
  return (
    <div className="min-w-0 bg-surface px-3 py-2.5 sm:px-4">
      <dt className={LABEL_MUTED}>{label}</dt>
      <dd className="mt-1.5 font-mono text-lg font-bold tabular-nums tracking-tight text-ink sm:text-xl">
        {loading ? <Skeleton className="h-6 w-24" /> : value}
      </dd>
    </div>
  );
}

export function Hero() {
  const {
    cookUsd,
    count,
    isLoading: registryLoading,
    isError: registryError,
  } = useRegistry();
  const { data: markets, isLoading: marketsLoading } = useMarkets();
  const { data: health } = useChainHealth();

  return (
    <section className="glass-solid overflow-hidden">
      {/* ── 1. status ─────────────────────────────────────────────────────────────────────── */}
      <div
        data-enter
        style={step(0)}
        className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-hairline/20 bg-surface2/60 px-3 py-2 sm:px-4"
      >
        <span className={cn(LABEL_MUTED, "flex items-center gap-2 text-ink2")}>
          <StatusDot status={health?.status ?? "unknown"} />
          Cookie Chain mainnet
        </span>
        {health?.slots.processed ? (
          <span className={cn(LABEL_MUTED, "tabular-nums")}>
            slot {health.slots.processed.toLocaleString("en-US")}
          </span>
        ) : null}
        {health?.epoch !== undefined && health?.epoch !== null ? (
          <span className={cn(LABEL_MUTED, "tabular-nums")}>epoch {health.epoch}</span>
        ) : null}
      </div>

      {/* ── 2. billing ────────────────────────────────────────────────────────────────────── */}
      <div className="grid items-center gap-6 px-3 py-6 sm:px-5 sm:py-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] lg:gap-8">
        <div className="min-w-0 max-w-2xl">
          {/* Mono, uppercase, at roughly two thirds of the old size. It still reads as the
              headline because nothing else on the page is this large — it no longer needs a
              gradient and 56px to say so. */}
          <h1
            data-enter
            style={step(1)}
            className="font-mono text-[clamp(1.5rem,4vw,2.375rem)] font-bold uppercase leading-[1.12] tracking-[-0.02em] text-balance"
          >
            Watch the chain,
            <br />
            <span className="accent-text">trade the chain.</span>
          </h1>

          <p
            data-enter
            style={step(2)}
            className="mt-5 max-w-xl text-[14px] leading-relaxed text-ink2"
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
            className="mt-7 flex flex-wrap items-center gap-2"
          >
            <ButtonLink href="/trade">
              <Zap size={14} aria-hidden="true" /> Start trading
            </ButtonLink>
            <ButtonLink href="/screener" variant="secondary" className="group">
              Screener
              <ArrowRight
                size={14}
                aria-hidden="true"
                className="transition-transform duration-200 motion-safe:group-hover:translate-x-0.5"
              />
            </ButtonLink>
          </div>
        </div>

        {/* The scope. Desktop only: at 390x844 the masthead measured 893px — taller than the
            viewport — with the diagram cut in half by the fold, pushing the first real data below
            it. On a phone the tape underneath is the better use of that screen. */}
        <div data-enter style={step(4)} className="hidden min-w-0 lg:block">
          <OrbitSystem />
        </div>
      </div>

      {/* ── 3. tape ───────────────────────────────────────────────────────────────────────── */}
      {/* `gap-px` over a `bg-rule` parent is what draws the dividing rules: the gaps are the
          background showing through, so there is one rule between every pair of cells and none at
          the ends, at any breakpoint, with no border bookkeeping. */}
      <dl
        data-enter
        style={step(4)}
        className="grid grid-cols-2 gap-px border-t border-hairline/20 bg-rule sm:grid-cols-4"
      >
        {/* No count-up on the price: formatUsd switches formatting branch by magnitude and Cookie
            Chain prices reach 7.2e-9, so interpolating from 0 walks the sub-cent branch and jitters
            a 12-character decimal whose digit count changes every frame. It snaps. */}
        <Tick
          label={`${COOK_SYMBOL}/USD`}
          value={formatUsd(cookUsd)}
          loading={registryLoading}
        />
        <Tick
          label="Registry entries"
          // `count` falls back to 0 in the hook, which is load-bearing there but reads as a
          // measurement here: a failed read printed "0" beside three siblings showing an em dash.
          value={<CountUp value={registryError ? null : count} format={fmtInt} />}
          loading={registryLoading}
        />
        {/* Compact TVL only — `compact()` holds its digit count steady ($8.10K), unlike formatUsd. */}
        <Tick
          label="Total value locked"
          value={
            <CountUp
              value={markets ? markets.tvlUsd : null}
              format={fmtCompactUsd}
            />
          }
          loading={marketsLoading}
        />
        <Tick
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
    </section>
  );
}
