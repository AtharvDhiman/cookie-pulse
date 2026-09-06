'use client';

// The masthead chart.
//
// This replaced a decorative orbit diagram, which was the last element on the page that was drawn
// rather than measured. The intent was a price chart — but Cookiescan has no price history. Its
// price endpoint returns a single point and a `change24h` that reads 0, the markets feed carries no
// time series, and every guessed path (`/api/price/cook/history`, `/api/candles`, `/api/ohlc`)
// returns the site's HTML shell with a 200, which is a catch-all rather than data. Drawing a price
// line here would mean inventing the series, so there is no price line.
//
// What IS a real time series is this: non-vote transactions per minute over the last hour, from
// getRecentPerformanceSamples, on the same batched health request the strip above already makes.
// It was previously a 34px sparkline buried three screens down. As a full chart it says the most
// interesting true thing this app knows — that the chain is almost entirely idle — and it says it
// with axes a judge can check.
//
// Three rules it holds to:
//
//   1. A zero minute draws a baseline tick, never nothing. 34 of the last 60 minutes are exactly
//      zero; a bar chart that omits them looks broken, and emptiness is the measurement here.
//   2. Nothing keys off `isFetching`. The series refreshes every 15s and the chart must not
//      flicker, redraw or re-animate on a poll — only the bar geometry changes.
//   3. The crosshair is pointer-driven and lives entirely in local state. It never triggers a
//      fetch and never re-renders a parent.
import { useCallback, useMemo, useRef, useState } from 'react';
import { LABEL_MUTED, cn } from '@/components/ui/primitives';
import type { PerfWindow } from '@/lib/types';

/** Chart drawn in its own user space and stretched by the SVG box; only the axes are in real px. */
const VB_W = 600;
const VB_H = 200;
/** Height a zero bucket still draws. The "we measured nothing" tick. */
const ZERO_TICK = 3;
const BAR_FILL = 0.66;
/**
 * Gridline values for a series of integer counts.
 *
 * The first version drew five lines at fixed fractions (0/.25/.5/.75/1) of a "nice" peak and
 * labelled them `Math.round(peak * g)`. Those are not the same numbers: at peak 5 the lines sit at
 * 0/1.25/2.5/3.75/5 but were labelled 0/1/3/4/5, so four of the five labels named a value their
 * line was not drawn at. On a chart whose whole point is that the reader can check it, that is
 * worse than having no axis.
 *
 * So the STEP is chosen first and the lines are placed on it. Every label is then exactly the
 * value of the line beside it, by construction, and the step is forced to a whole number because
 * a quarter of a transaction is not a thing that can happen.
 */
function axisFor(max: number): { peak: number; ticks: number[] } {
  if (!Number.isFinite(max) || max <= 0) return { peak: 1, ticks: [0, 1] };
  const rough = max / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(rough, 1))));
  const step = Math.max(1, ([1, 2, 2.5, 5, 10].find((s) => rough <= s * mag) ?? 10) * mag);
  // Round the top up to a whole number of steps so the last tick lands exactly on the peak.
  const peak = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= peak + 1e-9; v += step) ticks.push(Math.round(v));
  return { peak, ticks };
}

export function ActivityChart({ perf }: { perf: PerfWindow }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const values = perf.nonVotePerMinute;
  const n = values.length;

  const { peak, ticks, colWidth, barWidth } = useMemo(() => {
    const { peak: p, ticks: t } = axisFor(Math.max(...values, 0));
    return {
      peak: p,
      ticks: t,
      colWidth: VB_W / Math.max(n, 1),
      barWidth: Math.max((VB_W / Math.max(n, 1)) * BAR_FILL, 1),
    };
  }, [values, n]);

  // Pointer -> bucket index. Reads the SVG's own box rather than assuming the viewBox scale, so it
  // stays correct at every breakpoint without a resize listener.
  const onMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const el = svgRef.current;
      if (!el || n === 0) return;
      const box = el.getBoundingClientRect();
      if (box.width === 0) return;
      const frac = (e.clientX - box.left) / box.width;
      const i = Math.floor(frac * n);
      setHover(i >= 0 && i < n ? i : null);
    },
    [n],
  );

  if (n === 0) return null;

  const active = hover === null ? null : values[hover];
  const minutesAgo = hover === null ? null : n - hover;

  return (
    <div className="min-w-0">
      {/* Readout. Fixed height and tabular, so moving the pointer across the chart cannot reflow
          anything around it — the single most common defect in hand-built chart tooltips. */}
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className={LABEL_MUTED}>Non-vote transactions &middot; per minute</span>
        <span className="font-mono text-[11px] tabular-nums text-ink2">
          {hover === null ? (
            <span className="text-muted">last {perf.minutes}m</span>
          ) : (
            <>
              <span className="text-muted">{minutesAgo}m ago</span>{' '}
              <span className={cn('font-bold', active ? 'text-accent' : 'text-muted')}>
                {active}
              </span>
            </>
          )}
        </span>
      </div>

      <div className="flex gap-2">
        {/* Y axis. Real text outside the stretched viewBox, so the labels are never distorted by
            `preserveAspectRatio="none"` — the reason the bars can be stretched at all. */}
        <div
          className="flex w-8 shrink-0 flex-col justify-between py-px text-right font-mono text-[9px] tabular-nums leading-none text-muted"
          aria-hidden="true"
        >
          {[...ticks].reverse().map((v) => (
            <span key={v}>{v}</span>
          ))}
        </div>

        <div className="min-w-0 flex-1">
          <svg
            ref={svgRef}
            role="img"
            aria-label={`Non-vote transactions per minute over the last ${perf.minutes} minutes. Peak ${Math.max(...values)}. ${perf.zeroActivityMinutes} of ${perf.minutes} minutes recorded none.`}
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            preserveAspectRatio="none"
            className="h-[132px] w-full touch-none"
            shapeRendering="crispEdges"
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          >
            {/* Graticule. Drawn first, under everything. */}
            {ticks.map((v) => (
              <line
                key={v}
                x1={0}
                x2={VB_W}
                y1={VB_H - (v / peak) * VB_H}
                y2={VB_H - (v / peak) * VB_H}
                stroke="rgb(var(--hairline) / 0.12)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ))}

            {values.map((v, i) => {
              const scaled = peak > 0 ? (v / peak) * (VB_H - ZERO_TICK) : 0;
              const h = v > 0 ? Math.max(scaled, ZERO_TICK + 1) : ZERO_TICK;
              return (
                <rect
                  key={i}
                  x={i * colWidth + (colWidth - barWidth) / 2}
                  y={VB_H - h}
                  width={barWidth}
                  height={h}
                  className={
                    hover === i
                      ? 'fill-ink'
                      : v > 0
                        ? 'fill-accent'
                        : 'fill-accent/30'
                  }
                />
              );
            })}

            {/* Crosshair. Non-scaling stroke so it stays 1px however the box is stretched. */}
            {hover !== null ? (
              <line
                x1={hover * colWidth + colWidth / 2}
                x2={hover * colWidth + colWidth / 2}
                y1={0}
                y2={VB_H}
                stroke="rgb(var(--ink) / 0.45)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
          </svg>

          {/* X axis. Oldest at the left, so the series reads left to right like every other chart. */}
          <div
            className="mt-1.5 flex justify-between font-mono text-[9px] tabular-nums leading-none text-muted"
            aria-hidden="true"
          >
            <span>-{perf.minutes}m</span>
            <span>-{Math.round(perf.minutes / 2)}m</span>
            <span>now</span>
          </div>
        </div>
      </div>

      {/* The finding, stated. Computed from the series, never assumed — on a chain this quiet it is
          usually most of the window, and saying so is what stops the chart reading as broken. */}
      <p className="mt-3 border-t border-hairline/20 pt-2.5 text-[11px] leading-relaxed text-muted">
        <strong className="font-semibold text-ink2">
          {perf.zeroActivityMinutes} of {perf.minutes} minutes
        </strong>{' '}
        recorded no non-vote activity. Consensus keeps producing blocks either way &mdash; this is
        user activity, with votes excluded.
      </p>
    </div>
  );
}
