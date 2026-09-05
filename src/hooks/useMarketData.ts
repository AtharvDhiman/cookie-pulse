'use client';

// Shared read-only market data. The registry is fetched once per view under a stable query key and
// reused; React Query dedupes across components. Two views exist because the registry is 2.7 MB and
// 92 rows of it carry a price — see `/api/tokens` and NOTES.md.
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getMarkets, getRegistry } from '@/lib/api';
import { COOK_DECIMALS, COOK_MINT, COOK_SYMBOL } from '@/lib/config';
import type { RegistryView, Token } from '@/lib/types';

/** The registry lists native COOK as "Wrapped COOK"/wCOOK with no logo; present it as COOK. */
export function displayToken(t: Token): Token {
  return t.mint === COOK_MINT ? { ...t, symbol: COOK_SYMBOL, name: 'Cookie', decimals: COOK_DECIMALS } : t;
}

function useRegistryView(view: RegistryView, enabled: boolean) {
  const query = useQuery({
    queryKey: ['registry', view],
    queryFn: ({ signal }) => getRegistry(view, signal),
    enabled,
    // The full view is 2.7 MB of rows that carry no price and therefore never move; polling it on
    // the priced view's 30s cadence would spend that repeatedly for no new information.
    staleTime: view === 'full' ? 300_000 : 20_000,
    refetchInterval: view === 'full' ? false : 30_000,
  });

  const tokens = useMemo(() => (query.data?.tokens ?? []).map(displayToken), [query.data]);

  const byMint = useMemo(() => {
    const m = new Map<string, Token>();
    for (const t of tokens) m.set(t.mint, t);
    return m;
  }, [tokens]);

  return {
    ...query,
    tokens,
    byMint,
    cookUsd: query.data?.cookUsd ?? null,
    // Straight from the envelope. A denominator derived from `tokens.length` would report the
    // projection instead of the registry — the one thing this projection must never cause.
    count: query.data?.count ?? 0,
    fungibleCount: query.data?.fungibleCount ?? 0,
  };
}

/**
 * The registry as every surface reads it: the priced mints only, ~35 KB. That is every mint with
 * liquidity on Cookie Chain, so nothing rankable, routable or valuable is missing — see NOTES.md
 * for the surfaces that would want the unpriced remainder.
 */
export function useRegistry() {
  return useRegistryView('priced', true);
}

/**
 * The screener's source. It always holds the cheap priced view and additionally pulls the full
 * registry once `showAll` is on. Registry-wide counts describe the whole registry rather than the
 * projection in hand, so both envelopes carry the same values and either may answer for them.
 */
export function useScreenerRegistry(showAll: boolean) {
  const priced = useRegistryView('priced', true);
  const full = useRegistryView('full', showAll);
  const active = showAll ? full : priced;
  const envelope = active.data ?? priced.data ?? null;

  return {
    tokens: active.tokens,
    cookUsd: envelope?.cookUsd ?? null,
    registryCount: envelope?.count ?? 0,
    fungibleCount: envelope?.fungibleCount ?? 0,
    nftLikeCount: envelope?.nftLikeCount ?? 0,
    isLoading: active.isLoading,
    isError: active.isError,
  };
}

export function useMarkets() {
  return useQuery({
    queryKey: ['markets'],
    queryFn: ({ signal }) => getMarkets(signal),
    staleTime: 20_000,
    refetchInterval: 30_000,
  });
}

/** Tokens the movers tiles and screener can meaningfully rank: priced, and not COOK itself. */
export function rankableTokens(tokens: Token[]): Token[] {
  return tokens.filter((t) => t.priceUsd !== null && t.priceUsd > 0 && t.mint !== COOK_MINT);
}
