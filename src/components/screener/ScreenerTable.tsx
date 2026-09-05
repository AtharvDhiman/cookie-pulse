'use client';

// The screener grid. Column definitions, their sort accessors and the comparator live together here
// so a new column cannot be added without also declaring how it sorts.
import Link from 'next/link';
import { ChevronDown, ChevronsUpDown, ChevronUp, ExternalLink } from 'lucide-react';
import { COOK_MINT, explorerToken } from '@/lib/config';
import { formatUsd, shortAddr } from '@/lib/format';
import type { Token } from '@/lib/types';
import { Change, CopyButton, EmptyState, Skeleton, TokenLogo, cn } from '@/components/ui/primitives';

export type SortKey =
  | 'symbol'
  | 'priceUsd'
  | 'change24h'
  | 'volume24h'
  | 'liquidityUsd'
  | 'marketCap'
  | 'holderCount';

export interface SortState {
  key: SortKey;
  dir: 'asc' | 'desc';
}

interface Column {
  key: SortKey;
  label: string;
  align: 'left' | 'right';
  width: string;
  /** First click on a column sorts this way; clicking the active column flips it. */
  defaultDir: 'asc' | 'desc';
  /** null means "this token has no such value" — those rows always sink to the bottom. */
  value: (t: Token) => number | string | null;
}

/**
 * The registry reports 0 — not null — for the ~6,380 entries with no price feed, and a mint with a
 * feed is never worth exactly $0. So 0 means "unknown" here: it renders as — and sorts last in both
 * directions, matching what the "Show unpriced" filter already calls unpriced. Only reachable once
 * that filter is on: the default view is served pre-projected to the priced rows.
 */
function priceOf(t: Token): number | null {
  return t.priceUsd !== null && t.priceUsd > 0 ? t.priceUsd : null;
}

const COLUMNS: Column[] = [
  {
    key: 'symbol',
    label: 'Token',
    align: 'left',
    width: 'w-[168px]',
    defaultDir: 'asc',
    value: (t) => t.symbol.toLowerCase(),
  },
  {
    key: 'priceUsd',
    label: 'Price',
    align: 'right',
    width: 'w-[116px]',
    defaultDir: 'desc',
    value: priceOf,
  },
  {
    key: 'change24h',
    label: '24h',
    align: 'right',
    width: 'w-[88px]',
    defaultDir: 'desc',
    value: (t) => t.change24h,
  },
  {
    key: 'volume24h',
    label: '24h Vol',
    align: 'right',
    width: 'w-[104px]',
    defaultDir: 'desc',
    value: (t) => t.volume24h,
  },
  {
    key: 'liquidityUsd',
    label: 'Liquidity',
    align: 'right',
    width: 'w-[104px]',
    defaultDir: 'desc',
    value: (t) => t.liquidityUsd,
  },
  {
    key: 'marketCap',
    label: 'Mkt cap',
    align: 'right',
    width: 'w-[104px]',
    defaultDir: 'desc',
    value: (t) => t.marketCap,
  },
  {
    key: 'holderCount',
    label: 'Holders',
    align: 'right',
    width: 'w-[92px]',
    defaultDir: 'desc',
    value: (t) => t.holderCount,
  },
];

/** Token, price, 24h, volume, liquidity, market cap, holders, mint, actions. */
const COL_COUNT = COLUMNS.length + 2;
const SKELETON_ROWS = 8;

/** Only three tokens have traded in 24h — volume desc is the ordering that puts them on screen. */
export const DEFAULT_SORT: SortState = { key: 'volume24h', dir: 'desc' };

function column(key: SortKey): Column {
  return COLUMNS.find((c) => c.key === key) ?? COLUMNS[0];
}

/** Header click: flip the active column, otherwise switch and use that column's natural direction. */
export function nextSort(prev: SortState, key: SortKey): SortState {
  if (prev.key === key) return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: column(key).defaultDir };
}

function isAbsent(v: number | string | null): boolean {
  if (v === null) return true;
  return typeof v === 'number' ? !Number.isFinite(v) : v === '';
}

/**
 * Stable sort with missing values pinned to the bottom in both directions — flipping the direction
 * on a mostly-unpriced registry should never fill the first page with dashes.
 */
export function sortTokens(tokens: Token[], sort: SortState): Token[] {
  const read = column(sort.key).value;
  const dir = sort.dir === 'asc' ? 1 : -1;
  const decorated = tokens.map((token, index) => ({ token, index, v: read(token) }));

  decorated.sort((a, b) => {
    const aAbsent = isAbsent(a.v);
    const bAbsent = isAbsent(b.v);
    if (aAbsent || bAbsent) {
      if (aAbsent && bAbsent) return a.index - b.index;
      return aAbsent ? 1 : -1;
    }
    const cmp =
      typeof a.v === 'number' && typeof b.v === 'number'
        ? a.v - b.v
        : String(a.v).localeCompare(String(b.v));
    // Index tie-break keeps equal rows (thousands of them at 0 volume) in registry order.
    return cmp === 0 ? a.index - b.index : cmp * dir;
  });

  return decorated.map((d) => d.token);
}

function tradeHref(mint: string): string {
  return mint === COOK_MINT
    ? `/trade?in=${COOK_MINT}`
    : `/trade?in=${COOK_MINT}&out=${encodeURIComponent(mint)}`;
}

function UsdCell({ value, compact }: { value: number | null; compact?: boolean }) {
  return (
    <span className={cn('tabular-nums', value ? 'text-ink2' : 'text-muted')}>
      {formatUsd(value, { compact })}
    </span>
  );
}

interface Props {
  rows: Token[];
  sort: SortState;
  onSort: (key: SortKey) => void;
  isLoading: boolean;
  emptyTitle: string;
  emptyHint?: string;
}

export function ScreenerTable({ rows, sort, onSort, isLoading, emptyTitle, emptyHint }: Props) {
  // Rendered outside the table: a colSpan cell centres itself across 1020px, which puts the message
  // off-screen at 360px until you scroll sideways to find it.
  if (!isLoading && rows.length === 0) {
    return <EmptyState title={emptyTitle} hint={emptyHint} />;
  }

  return (
    // The page must never scroll sideways: the horizontal overflow is owned by this box alone.
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1020px] border-separate border-spacing-0 text-sm">
        <caption className="sr-only">
          Cookie Chain tokens with price, 24 hour change, volume, liquidity, market cap and holders.
        </caption>
        <thead>
          <tr className="[&>th]:border-b [&>th]:border-hairline/10 [&>th]:bg-surface2 [&>th]:px-3 [&>th]:py-2.5">
            {COLUMNS.map((col) => {
              const active = sort.key === col.key;
              return (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  className={cn(
                    col.width,
                    col.align === 'right' ? 'text-right' : 'text-left',
                    col.key === 'symbol' && 'sticky left-0 z-[2]',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSort(col.key)}
                    className={cn(
                      'inline-flex items-center gap-1 whitespace-nowrap rounded text-[11px] font-semibold uppercase tracking-wider transition-colors hover:text-ink',
                      active ? 'text-ink' : 'text-muted',
                    )}
                  >
                    {col.label}
                    {active ? (
                      sort.dir === 'asc' ? (
                        <ChevronUp size={13} className="text-accent" />
                      ) : (
                        <ChevronDown size={13} className="text-accent" />
                      )
                    ) : (
                      <ChevronsUpDown size={13} className="opacity-40" />
                    )}
                  </button>
                </th>
              );
            })}
            <th
              scope="col"
              className="w-[128px] text-left text-[11px] font-semibold uppercase tracking-wider text-muted"
            >
              Mint
            </th>
            <th scope="col" className="w-[128px] text-right">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>

        <tbody>
          {isLoading
            ? Array.from({ length: SKELETON_ROWS }, (_, i) => (
                <tr key={i} className="[&>td]:border-t [&>td]:border-hairline/10 [&>td]:px-3 [&>td]:py-2.5">
                  <td className="sticky left-0 z-[1] bg-surface">
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-[26px] w-[26px] rounded-full" />
                      <div className="flex-1 space-y-1.5">
                        <Skeleton className="h-3 w-14" />
                        <Skeleton className="h-2.5 w-20" />
                      </div>
                    </div>
                  </td>
                  {Array.from({ length: COL_COUNT - 1 }, (_, c) => (
                    <td key={c}>
                      <Skeleton className="ml-auto h-3 w-16" />
                    </td>
                  ))}
                </tr>
              ))
            : null}

          {!isLoading &&
            rows.map((t) => (
              <tr
                key={t.mint}
                className="group transition-colors hover:bg-surface2 [&>td]:border-t [&>td]:border-hairline/10 [&>td]:px-3 [&>td]:py-2.5"
              >
                <td className="sticky left-0 z-[1] bg-surface group-hover:bg-surface2">
                  <div className="flex items-center gap-2">
                    <TokenLogo logo={t.logo} symbol={t.symbol} size={26} />
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 truncate text-[13px] font-semibold leading-tight text-ink">
                        <span className="truncate">{t.symbol}</span>
                        {/* Rides the token cell rather than becoming a tenth column: the table is
                            already min-w-[1020px], and a new column would push Liquidity and
                            Holders further off a phone. Neutral count, no verdict. */}
                        {t.symbolCount > 1 ? (
                          <span
                            title={`${t.symbolCount.toLocaleString('en-US')} registry entries use the symbol ${t.symbol} — check the mint`}
                            className="shrink-0 rounded-full border border-hairline/10 bg-surface2 px-1.5 py-px text-[10px] font-semibold tabular-nums text-muted"
                          >
                            ×{t.symbolCount.toLocaleString('en-US')}
                          </span>
                        ) : null}
                      </p>
                      <p className="truncate text-[11px] leading-tight text-muted" title={t.name}>
                        {t.name}
                      </p>
                    </div>
                  </div>
                </td>

                <td className="text-right">
                  <UsdCell value={priceOf(t)} />
                </td>
                <td className="text-right">
                  <Change value={t.change24h} className="text-[13px]" />
                </td>
                <td className="text-right">
                  <UsdCell value={t.volume24h} compact />
                </td>
                <td className="text-right">
                  <UsdCell value={t.liquidityUsd} compact />
                </td>
                <td className="text-right">
                  <UsdCell value={t.marketCap} compact />
                </td>
                <td className="text-right">
                  <span className={cn('tabular-nums', t.holderCount ? 'text-ink2' : 'text-muted')}>
                    {t.holderCount.toLocaleString('en-US')}
                  </span>
                </td>

                <td>
                  <CopyButton
                    value={t.mint}
                    label={shortAddr(t.mint)}
                    className="-ml-1.5 whitespace-nowrap font-mono"
                  />
                </td>

                <td>
                  <div className="flex items-center justify-end gap-1">
                    <a
                      href={explorerToken(t.mint)}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Open ${t.symbol} on Cookiescan`}
                      title="Open on Cookiescan"
                      className="rounded-md p-1.5 text-muted transition-colors hover:text-accent"
                    >
                      <ExternalLink size={14} />
                    </a>
                    <Link
                      href={tradeHref(t.mint)}
                      className="rounded-md border border-hairline/10 bg-surface2 px-2.5 py-1 text-xs font-semibold text-ink transition-colors hover:border-accent/60 hover:text-accent"
                    >
                      Trade
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
