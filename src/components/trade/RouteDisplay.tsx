'use client';

// The path the aggregator actually chose, hop by hop.
//
// The two feeds disagree on naming: /api/markets says "COOKIEBOX DAMM" while the router says
// "cookiebox-damm". Neither is presentable, so the router's slug is prettified here — see NOTES.md.
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  HelpCircle,
  Route as RouteIcon,
} from 'lucide-react';
import { explorerAddress, slippageLabel } from '@/lib/config';
import { formatAmount, fromRawAmount, shortAddr } from '@/lib/format';
import type { Quote, RouteSegment, Token } from '@/lib/types';
import { Pill, TokenLogo, cn } from '@/components/ui/primitives';

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

// ---------------------------------------------------------------------------------------------
// Build-time re-quote check
//
// /swap-tx re-quotes server-side before it builds, and returns the route it actually used. That
// route is the one being signed; the panel is showing the /quote answer from up to ten seconds
// earlier. Comparing them is the only way to know the two agree — and the response already carries
// everything needed, so the check costs no extra request.
// ---------------------------------------------------------------------------------------------

/** The parts of a route a build-time re-quote can move. Sorted, so leg order cannot fake a change. */
export interface RouteFacts {
  /** Raw router venue slugs — prettified only at render time. */
  venues: string[];
  pools: string[];
  netOutAmount: string;
  minOutAmount: string;
}

export type RouteCheck =
  | { kind: 'unavailable' }
  | {
      kind: 'match' | 'accepted' | 'refused';
      /** Same venues and same pools on both sides. */
      samePath: boolean;
      /**
        * How far the built route fell below the displayed one, in bps, rounded up. 0 = no worse.
        * `shortfallBps` is the max of the two and drives the refusal; the halves are kept separate
        * because a re-route can move the expected output without touching the guaranteed minimum,
        * and the sentence must cite whichever actually moved rather than asserting both did.
        */
      shortfallBps: number;
      netShortfallBps: number;
      minShortfallBps: number;
      slippageBps: number;
      quoted: RouteFacts;
      built: RouteFacts;
    };

const uniqSorted = (values: string[]): string[] => [...new Set(values.filter(Boolean))].sort();

function routeFacts(q: Quote): RouteFacts {
  return {
    venues: uniqSorted(q.segments.map((s) => s.venue)),
    pools: uniqSorted(q.segments.map((s) => s.pool)),
    netOutAmount: q.netOutAmount,
    minOutAmount: q.minOutAmount,
  };
}

/**
 * Raw base units from the aggregator as a BigInt. Guarded because a bare `BigInt()` on an
 * unexpected string throws, and an upstream oddity must not take the route panel down.
 */
const safeBigInt = (v: string): bigint => (/^\d+$/.test(v) ? BigInt(v) : 0n);

/**
 * How far `actual` falls below `displayed`, in basis points, ROUNDED UP — a shortfall is never
 * reported as smaller than it is. 0 when the actual figure is equal or better.
 */
function shortfallBps(displayed: string, actual: string): number {
  const d = safeBigInt(displayed);
  const a = safeBigInt(actual);
  if (d <= 0n || a >= d) return 0;
  const scaled = (d - a) * 10_000n;
  return Number(scaled / d + (scaled % d === 0n ? 0n : 1n));
}

/**
 * The route the transaction was built from, against the quote on screen.
 *
 * Refusing on any difference would block a genuinely better re-route and every trivial tick;
 * refusing on none was the old behaviour, which dropped the answer on the floor. The line is the
 * user's own slippage: a drop that reaches the tolerance they set is, by their own measure, not
 * immaterial. Both figures are compared, because a re-route can move either — the expected output
 * is what the user read, the minimum is what the chain will enforce.
 */
export function compareRoutes(quoted: Quote, built: Quote | null, slippageBps: number): RouteCheck {
  if (!built) return { kind: 'unavailable' };
  const q = routeFacts(quoted);
  const b = routeFacts(built);
  const samePath =
    q.venues.join('|') === b.venues.join('|') && q.pools.join('|') === b.pools.join('|');
  const netShortfallBps = shortfallBps(q.netOutAmount, b.netOutAmount);
  const minShortfallBps = shortfallBps(q.minOutAmount, b.minOutAmount);
  const drop = Math.max(netShortfallBps, minShortfallBps);
  const kind = drop >= slippageBps ? 'refused' : samePath && drop === 0 ? 'match' : 'accepted';
  return {
    kind,
    samePath,
    shortfallBps: drop,
    netShortfallBps,
    minShortfallBps,
    slippageBps,
    quoted: q,
    built: b,
  };
}

/** Output-token context for rendering raw base units as an amount the user recognises. */
export interface OutputUnit {
  symbol: string;
  decimals: number;
}

/**
 * One sentence describing the comparison, shared by the route panel and the failure the swap throws
 * when it refuses — so the two can never tell the user different stories about the same event.
 */
export function describeRouteCheck(
  check: Exclude<RouteCheck, { kind: 'unavailable' }>,
  out: OutputUnit,
): string {
  const amount = (raw: string) =>
    `${formatAmount(fromRawAmount(raw, out.decimals), Math.min(out.decimals, 6))} ${out.symbol}`;
  const venues = (f: RouteFacts) =>
    f.venues.length > 0 ? f.venues.map(prettyVenue).join(' + ') : 'an unnamed venue';
  const slip = slippageLabel(check.slippageBps);
  const move = `${venues(check.quoted)} at ${amount(check.quoted.netOutAmount)} became ${venues(
    check.built,
  )} at ${amount(check.built.netOutAmount)}`;

  if (check.kind === 'refused') {
    // Name the figure that actually fell. Attributing the whole drop to the guaranteed minimum when
    // only the expected output moved would put a false number in the sentence that blocks the trade.
    const cause =
      check.minShortfallBps >= check.netShortfallBps
        ? `Its guaranteed minimum ${amount(check.built.minOutAmount)} is ${check.minShortfallBps} bps ` +
          `below the ${amount(check.quoted.minOutAmount)} minimum you were shown`
        : `Its expected output is ${check.netShortfallBps} bps below what you were shown` +
          (check.minShortfallBps === 0
            ? ', with the guaranteed minimum unchanged'
            : `, and the guaranteed minimum fell ${check.minShortfallBps} bps`);
    return (
      `Cookiebox re-quoted while building: ${move}. ${cause}, which is past your ${slip} ` +
      `slippage — so nothing was signed.`
    );
  }
  if (check.kind === 'match') {
    return (
      `The transaction was built on the same route you were quoted — ${venues(check.built)}, ` +
      `${amount(check.built.netOutAmount)} out, ${amount(check.built.minOutAmount)} minimum.`
    );
  }
  if (check.samePath) {
    const moved =
      check.minShortfallBps > 0
        ? `The minimum moved ${check.minShortfallBps} bps to ${amount(check.built.minOutAmount)}`
        : `The expected output moved ${check.netShortfallBps} bps to ${amount(check.built.netOutAmount)}, ` +
          `with the minimum unchanged`;
    return `Same pools at build time (${venues(check.built)}). ${moved}, inside your ${slip} slippage.`;
  }
  return check.shortfallBps === 0
    ? `Re-routed while building: ${move} — no worse than you were quoted.`
    : `Re-routed while building: ${move}, ${check.shortfallBps} bps below the quote and inside your ${slip} slippage.`;
}

const CHECK_TONE = {
  match: 'border-up/40 bg-up/10',
  accepted: 'border-hairline/10 bg-surface2',
  refused: 'border-down/40 bg-down/10',
  unavailable: 'border-warn/40 bg-warn/10',
} as const;

function CheckBanner({ check, out }: { check: RouteCheck; out: OutputUnit }) {
  const heading =
    check.kind === 'unavailable'
      ? 'Built route not returned'
      : check.kind === 'refused'
        ? 'Built route was worse than your quote'
        : check.kind === 'match'
          ? 'Matches your quote'
          : check.samePath
            ? 'Built on the same pools'
            : 'Re-routed at build time';

  const Icon =
    check.kind === 'unavailable'
      ? HelpCircle
      : check.kind === 'refused'
        ? AlertTriangle
        : check.kind === 'match'
          ? CheckCircle2
          : RouteIcon;

  const iconTone =
    check.kind === 'unavailable'
      ? 'text-warn'
      : check.kind === 'refused'
        ? 'text-down'
        : check.kind === 'match'
          ? 'text-up'
          : 'text-muted';

  return (
    <div className={cn('flex items-start gap-2 rounded-xl border p-2.5', CHECK_TONE[check.kind])}>
      <Icon size={14} className={cn('mt-0.5 shrink-0', iconTone)} aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-xs font-semibold text-ink">{heading}</p>
        <p className="mt-0.5 break-words text-[11px] leading-relaxed text-ink2">
          {check.kind === 'unavailable'
            ? 'The aggregator built the transaction but returned no route with it, so it could not be checked against the quote above. The on-chain minimum still applies.'
            : describeRouteCheck(check, out)}
        </p>
      </div>
    </div>
  );
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

export function RouteDisplay({
  quote,
  byMint,
  check = null,
}: {
  quote: Quote;
  byMint: Map<string, Token>;
  /** Result of the last build-time re-quote comparison; null before a swap has been attempted. */
  check?: RouteCheck | null;
}) {
  const hops = groupByHop(quote.segments);
  // `path` is the router's own token walk; fall back to the segment mints if it ever comes back thin.
  const path =
    quote.path.length >= 2
      ? quote.path
      : quote.segments.length > 0
        ? [quote.segments[0].inputMint, quote.segments[quote.segments.length - 1].outputMint]
        : [];

  const outMint = path.length > 0 ? path[path.length - 1] : null;
  const outToken = outMint ? (byMint.get(outMint) ?? null) : null;
  // An output the registry does not know still gets honest numbers — raw base units, labelled with
  // the mint rather than a symbol we do not have.
  const out: OutputUnit = outToken
    ? { symbol: outToken.symbol, decimals: outToken.decimals }
    : { symbol: outMint ? shortAddr(outMint) : 'units', decimals: 0 };

  return (
    <div className="space-y-3">
      {check ? <CheckBanner check={check} out={out} /> : null}

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
