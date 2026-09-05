'use client';

// The path the aggregator actually chose, hop by hop.
//
// The two feeds disagree on naming: /api/markets says "COOKIEBOX DAMM" while the router says
// "cookiebox-damm". Neither is presentable, so the router's slug is prettified here — see NOTES.md.
import { ArrowRight, ExternalLink } from 'lucide-react';
import { explorerAddress } from '@/lib/config';
import { shortAddr } from '@/lib/format';
import type { Quote, RouteSegment, Token } from '@/lib/types';
import { Pill, TokenLogo } from '@/components/ui/primitives';

/** Venue words that are acronyms and must stay uppercase rather than becoming "Damm". */
const ACRONYMS = new Set(['damm', 'clmm', 'bamm', 'cpamm', 'samm', 'amm', 'cpmm', 'dlmm', 'lp']);
/** Brand spellings the generic capitaliser would get wrong. */
const BRANDS: Record<string, string> = {
  cookiebox: 'Cookiebox',
  cookieswap: 'Cookieswap',
  momoswap: 'MomoSwap',
  meteora: 'Meteora',
  xybn: 'xYBN',
};

export function prettyVenue(venue: string): string {
  const words = venue.trim().split(/[\s_-]+/).filter(Boolean);
  if (words.length === 0) return 'Unknown venue';
  return words
    .map((w) => {
      const lower = w.toLowerCase();
      if (BRANDS[lower]) return BRANDS[lower];
      if (ACRONYMS.has(lower)) return lower.toUpperCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

function groupByHop(segments: RouteSegment[]): { hopIndex: number; legs: RouteSegment[] }[] {
  const hops = new Map<number, RouteSegment[]>();
  for (const s of segments) {
    const legs = hops.get(s.hopIndex);
    if (legs) legs.push(s);
    else hops.set(s.hopIndex, [s]);
  }
  return [...hops.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([hopIndex, legs]) => ({ hopIndex, legs }));
}

function PathChip({ mint, byMint }: { mint: string; byMint: Map<string, Token> }) {
  const token = byMint.get(mint) ?? null;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-hairline/10 bg-surface2 py-1 pl-1 pr-2.5">
      <TokenLogo logo={token?.logo ?? null} symbol={token?.symbol ?? mint} size={18} />
      <span className="truncate text-xs font-semibold" title={token?.name ?? mint}>
        {token?.symbol ?? shortAddr(mint)}
      </span>
    </span>
  );
}

export function RouteDisplay({ quote, byMint }: { quote: Quote; byMint: Map<string, Token> }) {
  const hops = groupByHop(quote.segments);
  // `path` is the router's own token walk; fall back to the segment mints if it ever comes back thin.
  const path =
    quote.path.length >= 2
      ? quote.path
      : quote.segments.length > 0
        ? [quote.segments[0].inputMint, quote.segments[quote.segments.length - 1].outputMint]
        : [];

  return (
    <div className="space-y-3">
      {path.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {path.map((mint, i) => (
            <span key={`${mint}-${i}`} className="flex min-w-0 items-center gap-1.5">
              {i > 0 ? <ArrowRight size={13} className="shrink-0 text-muted" aria-hidden="true" /> : null}
              <PathChip mint={mint} byMint={byMint} />
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-1.5">
        {quote.isMultiHop ? <Pill>{hops.length} hops</Pill> : <Pill>Direct</Pill>}
        {quote.isSplit ? <Pill tone="accent">Split across {quote.segments.length} pools</Pill> : null}
      </div>

      <ol className="space-y-2">
        {hops.map(({ hopIndex, legs }) => (
          <li key={hopIndex}>
            {hops.length > 1 ? (
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
                Hop {hopIndex + 1} ·{' '}
                {byMint.get(legs[0].inputMint)?.symbol ?? shortAddr(legs[0].inputMint)} →{' '}
                {byMint.get(legs[0].outputMint)?.symbol ?? shortAddr(legs[0].outputMint)}
              </p>
            ) : null}

            <ul className="space-y-1.5">
              {legs.map((leg) => (
                <li
                  key={`${leg.hopIndex}-${leg.pool}-${leg.inAmount}`}
                  className="flex items-center justify-between gap-2 rounded-xl border border-hairline/10 bg-surface2 px-2.5 py-2"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-xs font-semibold">{prettyVenue(leg.venue)}</span>
                    {quote.isSplit && leg.percentage !== null ? (
                      <span className="shrink-0 rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-accent">
                        {leg.percentage}%
                      </span>
                    ) : null}
                  </div>

                  {leg.pool ? (
                    <a
                      href={explorerAddress(leg.pool)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={leg.pool}
                      className="inline-flex shrink-0 items-center gap-1 font-mono text-[11px] text-muted transition-colors hover:text-accent"
                    >
                      {shortAddr(leg.pool)}
                      <ExternalLink size={11} aria-hidden="true" />
                    </a>
                  ) : (
                    <span className="shrink-0 text-[11px] text-muted">pool unknown</span>
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}
