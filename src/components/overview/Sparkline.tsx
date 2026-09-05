'use client';

// Stepped-bar sparkline, inline SVG, no chart library.
//
// The shape is dictated by the data: Cookie Chain is quiet enough that most minutes of non-vote
// activity are exactly zero (37 of the last 60 at the time of writing). A line chart across that
// reads as a broken widget, and a bar chart drops those minutes out entirely — so a zero is drawn
// as an explicit baseline tick rather than as absent ink. Emptiness is a measurement here, and it
// has to look like one.

export interface SparklineProps {
  /** Oldest first. Rendered left to right. */
  values: number[];
  /** Describes the series for screen readers; the SVG itself is one labelled image. */
  ariaLabel: string;
  /** Renders each bar's title tooltip. */
  formatValue?: (value: number, index: number) => string;
  className?: string;
  height?: number;
  tone?: 'accent' | 'up' | 'muted';
}

const TONES = {
  accent: { bar: 'fill-accent', zero: 'fill-accent/35' },
  up: { bar: 'fill-up', zero: 'fill-up/35' },
  muted: { bar: 'fill-muted', zero: 'fill-muted/40' },
} as const;

/** Bars are drawn in a 0..100 x 0..100 user space and stretched by the SVG's own box. */
const VB_W = 100;
const VB_H = 100;
/** Height a zero bucket still draws, in user units — the "we measured nothing" tick. */
const ZERO_TICK = 2.5;
/** Fraction of each column the bar occupies; the remainder is the gap. */
const BAR_FILL = 0.72;

export function Sparkline({
  values,
  ariaLabel,
  formatValue,
  className,
  height = 34,
  tone = 'accent',
}: SparklineProps) {
  if (values.length === 0) return null;

  const colors = TONES[tone];
  const peak = Math.max(...values);
  const colWidth = VB_W / values.length;
  const barWidth = Math.max(colWidth * BAR_FILL, 0.6);

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      preserveAspectRatio="none"
      style={{ height }}
      className={className}
      // Bars are drawn in a fixed user space and stretched, so the stroke-free fills stay crisp.
      shapeRendering="crispEdges"
    >
      {values.map((value, i) => {
        // Every bucket draws something. A zero gets the baseline tick, so a flat stretch reads as
        // "measured zero" rather than as missing data.
        const scaled = peak > 0 ? (value / peak) * (VB_H - ZERO_TICK) : 0;
        const barHeight = value > 0 ? Math.max(scaled, ZERO_TICK + 1) : ZERO_TICK;
        return (
          <rect
            key={i}
            x={i * colWidth + (colWidth - barWidth) / 2}
            y={VB_H - barHeight}
            width={barWidth}
            height={barHeight}
            className={value > 0 ? colors.bar : colors.zero}
          >
            <title>{formatValue ? formatValue(value, i) : String(value)}</title>
          </rect>
        );
      })}
    </svg>
  );
}
