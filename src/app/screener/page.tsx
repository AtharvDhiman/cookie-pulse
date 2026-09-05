'use client';

// /screener — Cookiescan's fungible mints, filtered, sorted and paged on the client. The default
// fetch is the projected priced view (~35 KB, already warm from the Overview); the full 2.7 MB
// registry is pulled only when "Show unpriced" is ticked.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { useScreenerRegistry } from '@/hooks/useMarketData';
import { formatUsd } from '@/lib/format';
import { isNftLike } from '@/lib/normalize';
import type { Token } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/primitives';
import {
  DEFAULT_SORT,
  ScreenerTable,
  nextSort,
  sortTokens,
  type SortKey,
  type SortState,
} from '@/components/screener/ScreenerTable';

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 200;

const n = (v: number) => v.toLocaleString('en-US');

/** Search predicate: symbol, name and mint, all lower-cased by the caller. */
function matches(t: Token, q: string): boolean {
  return (
    t.symbol.toLowerCase().includes(q) ||
    t.name.toLowerCase().includes(q) ||
    t.mint.toLowerCase().includes(q)
  );
}

/**
 * Why the screener's denominator is smaller than the registry. Three quarters of what Cookiescan
 * lists is one-of-one NFT editions; ranking them beside fungible mints was the app's least
 * defensible number. Stated as a count and its method — deliberately not a browsable collection.
 */
function CompositionNote({
  registryCount,
  fungibleCount,
  nftLikeCount,
}: {
  registryCount: number;
  fungibleCount: number;
  nftLikeCount: number;
}) {
  return (
    <p className="mt-3 max-w-prose text-[11px] leading-relaxed text-muted">
      Cookiescan lists {n(registryCount)} entries: {n(fungibleCount)} fungible mints and{' '}
      {n(nftLikeCount)} individual NFT editions (0 decimals, supply 1). The editions are left out of
      the screener — none carries a price, liquidity or a second holder. The split is computed from
      each entry&rsquo;s own decimals and supply, and matches Cookiescan&rsquo;s DAS index, which
      labels the same mints <code className="font-mono text-ink2">V1_NFT</code>.
    </p>
  );
}

export default function ScreenerPage() {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [showUnpriced, setShowUnpriced] = useState(false);
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const [page, setPage] = useState(1);

  const { tokens, cookUsd, registryCount, fungibleCount, nftLikeCount, isLoading, isError } =
    useScreenerRegistry(showUnpriced);

  // Typing 6473 rows through a filter on every keystroke is wasteful; settle first, then filter.
  useEffect(() => {
    const id = setTimeout(() => {
      setQuery(input);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [input]);

  const handleToggleUnpriced = useCallback((checked: boolean) => {
    setShowUnpriced(checked);
    setPage(1);
  }, []);

  const handleSort = useCallback((key: SortKey) => {
    setSort((prev) => nextSort(prev, key));
    setPage(1);
  }, []);

  const filtered = useMemo(() => {
    // 4,852 of the 6,473 registry entries are single NFT editions, not mints anyone can screen —
    // they carry no price, liquidity or second holder. Excluded from both views, counted in the
    // footnote. The priced view has none of them anyway; this keeps the show-all view honest.
    const base = tokens.filter((t) => !isNftLike(t));
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter((t) => matches(t, q));
  }, [tokens, query]);

  const sorted = useMemo(() => sortTokens(filtered, sort), [filtered, sort]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  // A refetch can shrink the list under the current page; clamp rather than showing a blank table.
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * PAGE_SIZE;

  const rows = useMemo(
    () => sorted.slice(start, start + PAGE_SIZE),
    [sorted, start],
  );

  const searching = query.trim().length > 0;

  // The default view holds only the priced mints, so a search that comes back empty here cannot say
  // how many unpriced mints would have matched without pulling the full registry. It offers the
  // toggle and the size of the set behind it rather than inventing a count.
  const emptyTitle = isError
    ? 'Could not load the token registry'
    : searching
      ? `No ${showUnpriced ? 'mint' : 'priced mint'} matches “${query.trim()}”`
      : showUnpriced
        ? 'The registry came back empty'
        : 'No priced mints right now';
  const emptyHint = isError
    ? 'Cookiescan did not answer. The page retries on its own — or reload in a moment.'
    : searching && !showUnpriced
      ? `Only priced mints are searched by default. Tick “Show unpriced” to search all ${n(
          fungibleCount,
        )} fungible mints.`
      : searching
        ? 'Search matches symbol, name and mint address. NFT editions are not listed.'
        : showUnpriced
          ? 'Cookiescan listed no tokens. The page retries on its own.'
          : 'Tick “Show unpriced” to list every fungible mint in the registry.';

  return (
    <div className="py-2">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div>
          <h1 className="font-display text-[26px] font-extrabold leading-tight tracking-tightest sm:text-[34px]">Screener</h1>
          <p className="mt-1 max-w-prose text-sm text-ink2">
            Every fungible mint Cookiescan indexes, with the liquidity and volume actually recorded
            against it on Cookie Chain.
          </p>
        </div>
        {cookUsd !== null ? (
          <p className="text-xs text-muted">
            COOK <span className="tabular-nums text-ink2">{formatUsd(cookUsd)}</span>
          </p>
        ) : null}
      </header>

      {/* Solid, not glass: the sticky token column paints an opaque bg-surface to occlude the
          columns scrolling under it, which only lines up on an opaque panel. */}
      <Card variant="solid" className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-hairline/10 p-3">
          <div className="relative min-w-[180px] flex-1">
            <Search
              size={15}
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              type="search"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Search symbol, name, or mint"
              aria-label="Search tokens"
              className="w-full rounded-xl border border-hairline/10 bg-surface2 py-2 pl-9 pr-9 text-sm text-ink placeholder:text-muted [&::-webkit-search-cancel-button]:appearance-none"
            />
            {input ? (
              <button
                type="button"
                onClick={() => setInput('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted transition-colors hover:text-ink"
              >
                <X size={14} />
              </button>
            ) : null}
          </div>

          <label className="flex cursor-pointer select-none items-center gap-2 text-xs font-medium text-ink2">
            <input
              type="checkbox"
              checked={showUnpriced}
              onChange={(e) => handleToggleUnpriced(e.target.checked)}
              className="h-4 w-4 shrink-0 cursor-pointer rounded border-hairline/10 bg-surface2 accent-accent"
            />
            Show unpriced
          </label>

          {/* The denominator is the registry's own fungible-mint count from the response envelope,
              never the length of the projected array — the projection must not shrink the number
              the app reports about itself. */}
          <p className="ml-auto text-xs tabular-nums text-muted" aria-live="polite">
            {isLoading
              ? showUnpriced
                ? `Loading all ${n(registryCount)} registry entries…`
                : 'Loading registry…'
              : fungibleCount === 0
                ? // Nothing loaded: the empty state below explains why, "0 of 0" would just add noise.
                  ''
                : `${n(sorted.length)} of ${n(fungibleCount)} fungible mints`}
          </p>
        </div>

        <ScreenerTable
          rows={rows}
          sort={sort}
          onSort={handleSort}
          isLoading={isLoading}
          emptyTitle={emptyTitle}
          emptyHint={emptyHint}
        />

        {!isLoading && sorted.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline/10 p-3">
            <p className="text-xs tabular-nums text-muted">
              Showing {n(start + 1)}–{n(Math.min(start + PAGE_SIZE, sorted.length))} of{' '}
              {n(sorted.length)}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                onClick={() => setPage(safePage - 1)}
                disabled={safePage <= 1}
              >
                <ChevronLeft size={15} />
                Prev
              </Button>
              <span className="text-xs tabular-nums text-ink2">
                Page {safePage} of {totalPages}
              </span>
              <Button
                variant="secondary"
                onClick={() => setPage(safePage + 1)}
                disabled={safePage >= totalPages}
              >
                Next
                <ChevronRight size={15} />
              </Button>
            </div>
          </div>
        ) : null}
      </Card>

      {nftLikeCount > 0 ? (
        <CompositionNote
          registryCount={registryCount}
          fungibleCount={fungibleCount}
          nftLikeCount={nftLikeCount}
        />
      ) : null}
    </div>
  );
}
