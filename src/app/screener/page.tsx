'use client';

// /screener — Cookiescan's fungible mints, filtered, sorted and paged on the client. The default
// fetch is the projected priced view (~35 KB, already warm from the Overview); the full 2.7 MB
// registry is pulled only when "Show unpriced" is ticked.
//
// Motion note: every moving part on this route lives in the FRAME — the page-enter ladder, the
// filter bar's stuck shadow, the sort/page sweep, the sort chevron and the two per-row links. The
// table itself is inert by contract: no reveal, no stagger, no transform on any <tr>/<td>, and no
// flash on a poll. See docs/handoff/motion/_CONTRACT.md.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
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
/** Only used before the header has been measured once; the real value is always read from the DOM. */
const HEADER_H_FALLBACK = 106;

const n = (v: number) => v.toLocaleString('en-US');

/** Bare number, never a unit — `min()` inside the delay `calc()` silently yields 0ms if it carries one. */
const enter = (i: number) => ({ '--i': i }) as CSSProperties;

/**
 * The sticky header's live height. Measured from the element rather than assumed, because the nav
 * row wraps at narrow widths and `--header-h` is written by the header's own effect, whose ordering
 * against this one is not something this page should depend on.
 */
function headerHeight(): number {
  const el = typeof document === 'undefined' ? null : document.querySelector('.site-header');
  return el ? Math.round(el.getBoundingClientRect().height) : HEADER_H_FALLBACK;
}

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

  // The sentinel doubles as the Card's top edge for the page-change scroll: it is the Card's first
  // child and Card carries no top padding, so its box top is the panel's box top.
  const sentinelRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const pageLabelRef = useRef<HTMLSpanElement>(null);
  const focusPageLabel = useRef(false);

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

  /**
   * The one two-way IntersectionObserver in the application, and the only deliberate exception to
   * the once-and-unobserve rule. It watches a 1px sentinel above the filter bar and toggles
   * `data-stuck`, which is colour and shadow only — no transform, no height change, nothing that
   * could reflow a row the user is mid-read of. It fires at most twice per direction change and
   * never on a poll: the sentinel sits above the table, so pagination and filtering cannot move it.
   *
   * Below `md` the bar is not sticky (at 360px it wraps to three rows and would eat a third of the
   * viewport on top of the header), so the attribute is never set there — a stuck shadow under a
   * bar that is not stuck is a lie.
   */
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const bar = barRef.current;
    if (!sentinel || !bar || typeof IntersectionObserver === 'undefined') return;

    const wide = window.matchMedia('(min-width: 768px)');
    const headerEl = document.querySelector('.site-header');
    let io: IntersectionObserver | null = null;

    const build = () => {
      io?.disconnect();
      io = null;
      bar.removeAttribute('data-stuck');
      if (!wide.matches) return;

      const h = headerHeight();
      io = new IntersectionObserver(
        ([entry]) => {
          // `isIntersecting` alone cannot tell "scrolled under the header" from "still below the
          // fold"; the sign of the sentinel's own top does.
          bar.toggleAttribute(
            'data-stuck',
            !entry.isIntersecting && entry.boundingClientRect.top <= h,
          );
        },
        { threshold: 0, rootMargin: `-${h + 1}px 0px 0px 0px` },
      );
      io.observe(sentinel);
    };

    build();

    // The header height changes when its nav row wraps; rebuilding on that is what keeps the
    // rootMargin honest without this page owning a scroll or resize listener.
    const ro = new ResizeObserver(build);
    if (headerEl) ro.observe(headerEl);
    wide.addEventListener('change', build);

    return () => {
      io?.disconnect();
      ro.disconnect();
      wide.removeEventListener('change', build);
    };
  }, []);

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

  /**
   * Paging swaps 50 rows under the cursor; without this the user is left staring at row 43 of the
   * page they just left. The reduced-motion read is taken HERE, at click time, and never during
   * render — and `scroll-behavior: auto !important` in the reduced block does not govern the JS
   * API, so this branch is the only thing that honours the setting.
   */
  const goToPage = useCallback(
    (next: number) => {
      setPage(next);
      // Next/Prev is about to disable itself at either end, which drops focus to <body>. Hand it to
      // the page label instead so the keyboard user keeps their place.
      if (next <= 1 || next >= totalPages) focusPageLabel.current = true;

      const el = sentinelRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY - headerHeight() - 12;
      if (window.scrollY > top) {
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        window.scrollTo({ top, behavior: reduce ? 'auto' : 'smooth' });
      }
    },
    [totalPages],
  );

  // After commit, so the button has already taken its `disabled` attribute and given up focus.
  useEffect(() => {
    if (!focusPageLabel.current) return;
    focusPageLabel.current = false;
    pageLabelRef.current?.focus();
  }, [safePage]);

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
      {/* Above the fold on every viewport, so this is a self-completing CSS animation that starts
          during HTML parse — an IntersectionObserver reveal here would be a blank heading until
          hydration. There is exactly one section on this route; nothing to scroll-stagger. */}
      <header className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div>
          <h1
            data-enter
            style={enter(0)}
            className="font-display text-[26px] font-extrabold leading-tight tracking-tightest sm:text-[34px]"
          >
            Screener
          </h1>
          <p data-enter style={enter(1)} className="mt-1 max-w-prose text-sm text-ink2">
            Every fungible mint Cookiescan indexes, with the liquidity and volume actually recorded
            against it on Cookie Chain.
          </p>
        </div>
        {cookUsd !== null ? (
          // Fades in the once, when the price first resolves. Never a count-up and never re-run on
          // the 30s refetch: React Query holds the previous envelope, so this never unmounts.
          <p className="animate-fade-in text-xs text-muted">
            COOK <span className="tabular-nums text-ink2">{formatUsd(cookUsd)}</span>
          </p>
        ) : null}
      </header>

      <div data-enter style={enter(2)}>
        {/* Solid, not glass: the sticky token column paints an opaque bg-surface to occlude the
            columns scrolling under it, which only lines up on an opaque panel.
            `card-clip` rather than `overflow-hidden`: because `overflow-x-auto` on the table wrapper
            forces the other axis to `auto`, an overflow-hidden panel is a scroll container in both
            axes and silently kills `position: sticky` for every descendant. `overflow: clip` clips
            identically and is explicitly not a scroll container. */}
        <Card variant="solid" className="card-clip">
          {/* 1px, zero-height sentinel. The filter bar cannot observe itself — a sticky element is
              always intersecting once it has stuck. */}
          <div ref={sentinelRef} className="h-px -mb-px" aria-hidden="true" />

          <div
            ref={barRef}
            className="filterbar relative z-[4] flex flex-wrap items-center gap-3 border-b border-hairline/10 bg-surface p-3 md:sticky md:top-[var(--header-h,106px)]"
          >
            <div className="group relative min-w-[180px] flex-1">
              <Search
                size={15}
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted transition-colors duration-[160ms] group-focus-within:text-accent"
              />
              {/* Colour only. A search box that grows on focus reflows the flex-wrap bar and, once
                  the bar is sticky, reflows it over the table the user is reading. */}
              <input
                type="search"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Search symbol, name, or mint"
                aria-label="Search tokens"
                className="w-full rounded-xl border border-hairline/10 bg-surface2 py-2 pl-9 pr-9 text-sm text-ink transition-[border-color] duration-[160ms] placeholder:text-muted focus:border-accent/40 [&::-webkit-search-cancel-button]:appearance-none"
              />
              {input ? (
                // Centred with `inset-y-0 my-auto`, NOT `top-1/2 -translate-y-1/2`: `.press:active`
                // sets `transform: scale(...)` outright, which would drop a centring translate and
                // make the button jump half its own height on every press.
                <button
                  type="button"
                  onClick={() => setInput('')}
                  aria-label="Clear search"
                  className="press press-sm absolute inset-y-0 right-2 my-auto grid h-[26px] w-[26px] animate-fade-in place-items-center rounded-md text-muted transition-colors hover:text-ink"
                >
                  <X size={14} />
                </button>
              ) : null}
            </div>

            {/* No motion on the native checkbox — its internals are not animatable cross-browser and
                replacing it would cost free keyboard and screen-reader behaviour — and absolutely
                none on the multi-thousand-pixel table-height change it causes. The sweep hairline
                and the count text are the acknowledgement. */}
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

            {/* Acknowledges a re-sort or a page change with one 420ms hairline. Keyed on sort and
                page ONLY: keying it on `query` would restart it on every debounce tick, and keying
                it on anything query-derived (rows.length, the data identity) would fire it forever
                on the 30s refetch. It is a childless 1px element, which is the only reason
                remounting it is safe where remounting a <tbody> would not be. */}
            <span
              key={`${sort.key}-${sort.dir}-${safePage}`}
              // `opacity-0` and `origin-left` are the RESTING state and are carried here, not in
              // the shared sheet, so this degrades to invisible rather than to a permanent orange
              // hairline: the `sweep` keyframes end at opacity 0 with a `backwards` fill, so the
              // element reverts to its own base style once the 420ms is over — and with no JS, with
              // reduced motion, or before the shared rule lands, it simply never shows.
              className="sweep accent-gradient absolute inset-x-0 bottom-0 h-px origin-left opacity-0"
              aria-hidden="true"
            />
          </div>

          {/* Not motion, a layout fix: each 200ms debounce tick can swing this box between ~2,350px,
              ~140px and the empty state, and with a sticky bar above it the browser's scroll clamp
              yanks the page out from under the person typing. A height transition is banned and
              would still be mid-flight when the next character lands. */}
          <div className="min-h-[220px]">
            <ScreenerTable
              rows={rows}
              sort={sort}
              onSort={handleSort}
              isLoading={isLoading}
              emptyTitle={emptyTitle}
              emptyHint={emptyHint}
            />
          </div>

          {!isLoading && sorted.length > 0 ? (
            <div className="flex animate-fade-in flex-wrap items-center justify-between gap-3 border-t border-hairline/10 p-3">
              <p className="text-xs tabular-nums text-muted">
                Showing {n(start + 1)}–{n(Math.min(start + PAGE_SIZE, sorted.length))} of{' '}
                {n(sorted.length)}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  onClick={() => goToPage(safePage - 1)}
                  disabled={safePage <= 1}
                >
                  <ChevronLeft size={15} />
                  Prev
                </Button>
                {/* Focus target for the click that disables the button under the cursor. No live
                    region: moving focus here already announces it, and a second one would double
                    every page change. */}
                <span
                  ref={pageLabelRef}
                  tabIndex={-1}
                  className="rounded text-xs tabular-nums text-ink2"
                >
                  Page {safePage} of {totalPages}
                </span>
                <Button
                  variant="secondary"
                  onClick={() => goToPage(safePage + 1)}
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
