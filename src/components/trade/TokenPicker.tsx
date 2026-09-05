'use client';

// Searchable token selector over the whole registry. Two constraints shape it:
//   • the registry is ~6470 entries, so only the first 60 matches are ever rendered — the search
//     box is the scrolling mechanism, not a 6000-row list;
//   • 1500 tokens have no logo and only 92 have a price, so rows lead with symbol + name and fall
//     back to the initials avatar rather than pretending every token has market data.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search, X } from 'lucide-react';
import { COOK_MINT } from '@/lib/config';
import { formatAmount, formatUsd, shortAddr } from '@/lib/format';
import type { Token } from '@/lib/types';
import { Pill, Skeleton, TokenLogo, cn } from '@/components/ui/primitives';

/** Hard cap on rendered rows. Refine-your-search beats a 6000-node list. */
const MAX_ROWS = 60;

/** Lower is better; -1 means "does not match". */
function rankMatch(t: Token, q: string): number {
  const sym = t.symbol.toLowerCase();
  const name = t.name.toLowerCase();
  const mint = t.mint.toLowerCase();
  if (mint === q) return 0;
  if (sym === q) return 1;
  if (sym.startsWith(q)) return 2;
  if (name.startsWith(q)) return 3;
  if (sym.includes(q)) return 4;
  if (name.includes(q)) return 5;
  if (mint.includes(q)) return 6;
  return -1;
}

interface Props {
  /** Used for the dialog's accessible name, e.g. "you pay". */
  label: string;
  token: Token | null;
  tokens: Token[];
  /** mint -> wallet balance, so held tokens surface first and show what you have. */
  balances: Map<string, number>;
  loading: boolean;
  disabled?: boolean;
  onSelect: (mint: string) => void;
}

export function TokenPicker({ label, token, tokens, balances, loading, disabled, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const { rows, total } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched: { t: Token; rank: number }[] = [];

    for (const t of tokens) {
      if (t.mint === COOK_MINT) continue; // pinned separately, never duplicated in the list
      const rank = q ? rankMatch(t, q) : 0;
      if (rank < 0) continue;
      matched.push({ t, rank });
    }

    matched.sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      // Balances are in different tokens, so only "holds any" is comparable across rows.
      const heldA = (balances.get(a.t.mint) ?? 0) > 0 ? 0 : 1;
      const heldB = (balances.get(b.t.mint) ?? 0) > 0 ? 0 : 1;
      if (heldA !== heldB) return heldA - heldB;
      if (b.t.liquidityUsd !== a.t.liquidityUsd) return b.t.liquidityUsd - a.t.liquidityUsd;
      return b.t.volume24h - a.t.volume24h;
    });

    const cook = tokens.find((t) => t.mint === COOK_MINT);
    const pinned = cook && (!q || rankMatch(cook, q) >= 0) ? [cook] : [];
    return {
      rows: [...pinned, ...matched.slice(0, MAX_ROWS).map((m) => m.t)],
      total: matched.length + pinned.length,
    };
  }, [tokens, query, balances]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setActive(0);
  }, []);

  const choose = useCallback(
    (mint: string) => {
      onSelect(mint);
      close();
    },
    [onSelect, close],
  );

  // Escape closes from anywhere inside the dialog, and the body must not scroll behind it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    inputRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, close]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({
      block: 'nearest',
    });
  }, [active, rows]);

  const onSearchKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, rows.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = rows[active];
      if (hit) choose(hit.mint);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-haspopup="dialog"
        // Two tokens can share a symbol (there are two "MON"s), so the name carries the mint too.
        aria-label={
          token
            ? `Token to ${label}: ${token.symbol}, ${shortAddr(token.mint)}. Change token`
            : `Select token to ${label}`
        }
        className={cn(
          'flex shrink-0 items-center gap-1.5 rounded-full border border-hairline/10 bg-surface2 py-1.5 pl-1.5 pr-2.5',
          'text-sm font-semibold transition-colors hover:border-accent/50 disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        {token ? (
          <>
            <TokenLogo logo={token.logo} symbol={token.symbol} size={24} />
            <span className="max-w-[88px] truncate">{token.symbol}</span>
          </>
        ) : (
          <span className="py-0.5 pl-1.5 text-ink2">{loading ? 'Loading…' : 'Select'}</span>
        )}
        <ChevronDown size={14} className="text-muted" aria-hidden="true" />
      </button>

      {/* Portalled to <body>: the swap Card is a `.glass` panel, and a non-none backdrop-filter
          makes that card the containing block for fixed descendants — rendered in place, the
          overlay would size itself to the card instead of the viewport. */}
      {open ? createPortal(
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center sm:p-4"
          onMouseDown={close}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Select token to ${label}`}
            onMouseDown={(e) => e.stopPropagation()}
            className="flex h-[86vh] w-full max-w-md animate-fade-in flex-col overflow-hidden rounded-t-2xl border border-hairline/10 bg-surface shadow-2xl sm:h-[34rem] sm:rounded-2xl"
          >
            <div className="flex items-center gap-2 border-b border-hairline/10 px-3 py-3">
              <div className="relative flex-1">
                <Search
                  size={15}
                  aria-hidden="true"
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
                />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onSearchKeyDown}
                  placeholder="Search symbol, name or mint"
                  aria-label="Search tokens"
                  className="w-full rounded-xl border border-hairline/10 bg-surface2 py-2 pl-8 pr-2 text-sm text-ink placeholder:text-muted focus:border-accent/60 focus:outline-none"
                />
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Close token list"
                className="rounded-xl p-2 text-muted transition-colors hover:bg-surface2 hover:text-ink"
              >
                <X size={16} />
              </button>
            </div>

            <ul ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-1.5">
              {loading && rows.length === 0
                ? Array.from({ length: 8 }, (_, i) => (
                    <li key={i} className="flex items-center gap-3 px-2.5 py-2">
                      <Skeleton className="h-[30px] w-[30px] rounded-full" />
                      <div className="flex-1 space-y-1.5">
                        <Skeleton className="h-3 w-20" />
                        <Skeleton className="h-2.5 w-32" />
                      </div>
                    </li>
                  ))
                : null}

              {!loading && rows.length === 0 ? (
                <li className="px-4 py-10 text-center">
                  <p className="text-sm font-medium text-ink2">No token matches “{query.trim()}”</p>
                  <p className="mt-1 text-xs text-muted">
                    Try a symbol, a full name, or paste the mint address.
                  </p>
                </li>
              ) : null}

              {rows.map((t, i) => {
                const held = balances.get(t.mint) ?? 0;
                return (
                  <li key={t.mint}>
                    <button
                      type="button"
                      data-index={i}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => choose(t.mint)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors',
                        i === active ? 'bg-surface2' : 'hover:bg-surface2',
                      )}
                    >
                      <TokenLogo logo={t.logo} symbol={t.symbol} size={30} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-semibold">{t.symbol}</span>
                          {t.mint === COOK_MINT ? <Pill tone="accent">Native</Pill> : null}
                        </span>
                        <span className="block truncate text-xs text-muted">{t.name}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        {held > 0 ? (
                          <span className="block text-sm font-medium tabular-nums">
                            {formatAmount(held, 4)}
                          </span>
                        ) : t.priceUsd !== null ? (
                          <span className="block text-xs tabular-nums text-ink2">
                            {formatUsd(t.priceUsd)}
                          </span>
                        ) : null}
                        <span className="block font-mono text-[10px] text-muted">
                          {shortAddr(t.mint)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="border-t border-hairline/10 px-3 py-2 text-[11px] text-muted">
              {total > rows.length
                ? `Showing ${rows.length} of ${total} matches — refine your search`
                : `${total} token${total === 1 ? '' : 's'}`}
              <span className="hidden sm:inline"> · ↑↓ to move, Enter to select</span>
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
