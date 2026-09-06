'use client';

// The orbit hero.
//
// On most sites this shape is decoration — a glowing core with rings because rings look like
// "web3". Here every ring carries something the chain actually reports: COOK at the core with its
// live price, the DEX venues on the inner ring sized by their share of TVL, and the validators on
// the outer one. If the markets feed is empty the rings are empty, because there is nothing
// orbiting.
//
// Three rules it holds to, all of which the rest of this app is already bound by:
//
//   1. It is the ONLY looping motion added to the app, and it stops when it is not on screen.
//      A page a trader leaves open must go quiet, so the rotation is paused by an
//      IntersectionObserver rather than spinning forever in a background tab.
//   2. Nothing here keys off a poll. Node positions come from the data's *shape* (how many venues,
//      how many validators), not from any fetch state, so a 30s refresh never restarts the motion.
//   3. Under reduced motion the rings render fully and simply do not turn. The diagram is the
//      information; the rotation is not.
import { useEffect, useRef } from 'react';
import { useChainHealth } from '@/hooks/useChainHealth';
import { useMarkets, useRegistry } from '@/hooks/useMarketData';
import { COOK_SYMBOL } from '@/lib/config';
import { compact, formatUsd } from '@/lib/format';

/** Ring geometry in the SVG's own 0..320 user space. */
const CX = 160;
const CY = 160;
// Direction alternates in CSS via :nth-of-type(odd), so it is not carried here — one source.
const RINGS = [
  { r: 62, tilt: 0.42, dur: '38s' },
  { r: 96, tilt: 0.42, dur: '58s' },
  { r: 132, tilt: 0.42, dur: '86s' },
] as const;

interface OrbitNode {
  key: string;
  label: string;
  /** 0..1 — drives the node's radius, so a bigger venue reads as a bigger body. */
  weight: number;
}

/** Places `n` nodes evenly around a ring, starting at the top. */
function place(index: number, total: number): number {
  return (index / Math.max(total, 1)) * Math.PI * 2 - Math.PI / 2;
}

function Ring({
  ring,
  nodes,
  ariaLabel,
  rev = false,
}: {
  ring: (typeof RINGS)[number];
  nodes: OrbitNode[];
  ariaLabel: string;
  /** Reverse this ring's direction. Explicit, because the nodes are no longer the nth-of-type
      child that the old `:nth-of-type(odd)` CSS rule was counting. */
  rev?: boolean;
}) {
  const { r, tilt, dur } = ring;

  return (
    <g>
      {/* STATIC. The ellipse used to rotate with its nodes, and three tilted ellipses turning at
          different speeds in alternating directions swept through each other into a scribble —
          it read as a scrawl rather than an instrument. A real readout holds its reference rings
          fixed and moves only the contacts on them, which is also the only reading that means
          anything here: the ring is the venue class, the dots are what is in it. */}
      <ellipse
        cx={CX}
        cy={CY}
        rx={r}
        ry={r * tilt}
        className="orbit__path"
        role="presentation"
      />
      <g className="orbit__ring" style={{ ['--dur' as string]: dur }} data-rev={rev ? '' : undefined} aria-label={ariaLabel}>
        {nodes.map((n, i) => {
          const a = place(i, nodes.length);
          const x = CX + Math.cos(a) * r;
          const y = CY + Math.sin(a) * r * tilt;
          // 2.2 → 4.6px. Big enough to read as distinct bodies, small enough that twelve of them
          // never crowd the core.
          const size = 2.2 + n.weight * 2.4;
          return (
            <g key={n.key} className="orbit__node">
              <circle cx={x} cy={y} r={size + 2.6} className="orbit__halo" />
              <circle cx={x} cy={y} r={size} className="orbit__dot" />
              <title>{n.label}</title>
            </g>
          );
        })}
      </g>
    </g>
  );
}

export function OrbitSystem() {
  const { data: markets } = useMarkets();
  const { data: health } = useChainHealth();
  const { cookUsd } = useRegistry();
  const rootRef = useRef<SVGSVGElement>(null);

  // Rotation runs only while the diagram is on screen. This is the whole reason the app can afford
  // a loop at all: scroll past it, or background the tab, and it stops.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      ([entry]) => {
        el.toggleAttribute('data-spinning', entry.isIntersecting);
      },
      { threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const venues = markets?.venues ?? [];
  const topTvl = venues.reduce((m, v) => Math.max(m, v.tvlUsd), 0);

  const venueNodes: OrbitNode[] = venues.slice(0, 6).map((v) => ({
    key: v.venue,
    label: `${v.venue.toLowerCase()} — ${v.poolCount} ${v.poolCount === 1 ? 'pool' : 'pools'}, $${compact(v.tvlUsd)}`,
    weight: topTvl > 0 ? v.tvlUsd / topTvl : 0,
  }));

  const validatorNodes: OrbitNode[] = Array.from(
    { length: Math.min(health?.validatorCount ?? 0, 12) },
    (_, i) => ({ key: `v${i}`, label: `Validator ${i + 1} of ${health?.validatorCount ?? 0}`, weight: 0.45 }),
  );

  // The middle ring is the pools themselves, sampled — 160 dots would be mush, 8 reads as a system.
  const poolNodes: OrbitNode[] = Array.from(
    { length: markets ? Math.min(8, markets.poolCount) : 0 },
    (_, i) => ({ key: `p${i}`, label: `${markets?.poolCount ?? 0} live pools`, weight: 0.3 }),
  );

  return (
    <div className="orbit" aria-hidden={false}>
      <svg
        ref={rootRef}
        viewBox="0 0 320 320"
        className="orbit__svg"
        role="img"
        aria-label={
          markets && health
            ? `${COOK_SYMBOL} at the centre of ${markets.poolCount} pools across ${venues.length} venues, secured by ${health.validatorCount ?? 0} validators`
            : `${COOK_SYMBOL} orbit diagram, loading`
        }
      >
        {/* The graticule. Static, behind everything, and the reason this reads as an instrument
            face rather than a logo: an orrery has no crosshair. */}
        <g className="orbit__grat" aria-hidden="true">
          <line x1={CX - 150} y1={CY} x2={CX - 46} y2={CY} />
          <line x1={CX + 46} y1={CY} x2={CX + 150} y2={CY} />
          <line x1={CX} y1={CY - 150} x2={CX} y2={CY - 46} />
          <line x1={CX} y1={CY + 46} x2={CX} y2={CY + 150} />
        </g>

        <Ring ring={RINGS[0]} nodes={venueNodes} ariaLabel="Trading venues" />
        <Ring ring={RINGS[1]} nodes={poolNodes} ariaLabel="Liquidity pools" rev />
        <Ring ring={RINGS[2]} nodes={validatorNodes} ariaLabel="Validators" />

        {/* The core is COOK. Static: the one thing on screen that must never appear to wobble.
            r=34, not 26: at 26 the disc rendered 62.4px across while "$0.0001118" at 11px/700
            renders 67.05px, so the price was wider than the thing it was written on. 34 gives a
            40.8px radius against a 33.5px half-string. */}
        {/* Flat amber. r=34, not 26: at 26 the disc rendered 62.4px across while "$0.0001118"
            at 11px/700 renders 67.05px, so the price was wider than the thing it was written on. */}
        <circle cx={CX} cy={CY} r={34} fill="rgb(var(--accent-fill))" className="orbit__core" />
        <circle cx={CX} cy={CY} r={34} className="orbit__core-ring" />
      </svg>

      <div className="orbit__readout">
        <span className="orbit__symbol">{COOK_SYMBOL}</span>
        <span className="orbit__price">{formatUsd(cookUsd)}</span>
      </div>
    </div>
  );
}
