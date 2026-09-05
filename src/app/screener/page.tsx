'use client';

// /screener — the whole registry (6470 tokens) filtered, sorted and paged on the client. The
// registry is already in the React Query cache from the Overview, so this page costs no extra fetch.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { useRegistry } from '@/hooks/useMarketData';
import { formatUsd } from '@/lib/format';
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

/** One predicate for both the visible list and the "hidden by the filter" count under it. */
function matches(t: Token, q: string): boolean {
  return (
    t.symbol.toLowerCase().includes(q) ||
    t.name.toLowerCase().includes(q) ||
    t.mint.toLowerCase().includes(q)
  );
}

export default function ScreenerPage() {
  const { tokens, cookUsd, isLoading, isError } = useRegistry();

  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [showUnpriced, setShowUnpriced] = useState(false);
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const [page, setPage] = useState(1);

  // Typing 6470 rows through a filter on every keystroke is wasteful; settle first, then filter.
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
    // 6378 of 6470 tokens have no price feed — they are noise until someone asks for them.
    const base = showUnpriced
      ? tokens
      : tokens.filter((t) => t.priceUsd !== null && t.priceUsd > 0);
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter((t) => matches(t, q));
  }, [tokens, showUnpriced, query]);

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

  // The default filter drops 6378 of 6470 tokens, so an empty search result almost always means
  // "hidden", not "does not exist" — saying otherwise would be a lie. Only counted once the visible
  // result is already empty, so every match counted here is one the price filter removed.
  const hiddenMatches = useMemo(() => {
    if (showUnpriced || !searching || sorted.length > 0) return 0;
    const q = query.trim().toLowerCase();
    return tokens.reduce((n, t) => (matches(t, q) ? n + 1 : n), 0);
  }, [tokens, showUnpriced, searching, sorted, query]);

  const emptyTitle = isError
    ? 'Could not load the token registry'
    : hiddenMatches > 0
      ? `Only unpriced tokens match “${query.trim()}”`
      : searching
        ? `No token matches “${query.trim()}”`
        : showUnpriced
          ? 'The registry came back empty'
          : 'No priced tokens right now';
  const emptyHint = isError
    ? 'Cookiescan did not answer. The page retries on its own — or reload in a moment.'
    : hiddenMatches > 0
      ? `${hiddenMatches.toLocaleString('en-US')} unpriced ${
          hiddenMatches === 1 ? 'token is' : 'tokens are'
        } hidden — tick “Show unpriced” to include them.`
      : searching
        ? 'Search matches symbol, name and mint address.'
        : showUnpriced
          ? 'Cookiescan listed no tokens. The page retries on its own.'
          : 'Tick “Show unpriced” to list every token in the registry.';

  return (
    <div className="py-2">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div>
          <h1 className="font-display text-[26px] font-extrabold leading-tight tracking-tightest sm:text-[34px]">Screener</h1>
          <p className="mt-1 max-w-prose text-sm text-ink2">
            Every token Cookiescan indexes, with the liquidity and volume actually recorded against
            it on Cookie Chain.
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

          <p className="ml-auto text-xs tabular-nums text-muted" aria-live="polite">
            {isLoading
              ? 'Loading registry…'
              : tokens.length === 0
                ? // Nothing loaded: the empty state below explains why, "0 of 0" would just add noise.
                  ''
                : `${sorted.length.toLocaleString('en-US')} of ${tokens.length.toLocaleString('en-US')} tokens`}
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
              Showing {(start + 1).toLocaleString('en-US')}–
              {Math.min(start + PAGE_SIZE, sorted.length).toLocaleString('en-US')} of{' '}
              {sorted.length.toLocaleString('en-US')}
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
    </div>
  );
}
