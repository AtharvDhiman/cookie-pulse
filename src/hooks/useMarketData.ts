'use client';

// Shared read-only market data. Every page reads the registry, so it is fetched once under a stable
// query key and reused; React Query dedupes across components.
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getMarkets, getRegistry } from '@/lib/api';
import { COOK_DECIMALS, COOK_MINT, COOK_SYMBOL } from '@/lib/config';
import type { Token } from '@/lib/types';

/** The registry lists native COOK as "Wrapped COOK"/wCOOK with no logo; present it as COOK. */
export function displayToken(t: Token): Token {
  return t.mint === COOK_MINT ? { ...t, symbol: COOK_SYMBOL, name: 'Cookie', decimals: COOK_DECIMALS } : t;
}

export function useRegistry() {
  const query = useQuery({
    queryKey: ['registry'],
    queryFn: ({ signal }) => getRegistry(signal),
    staleTime: 20_000,
    refetchInterval: 30_000,
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
    count: query.data?.count ?? 0,
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
