'use client';

// Aggregator quotes for the trade panel.
//
// Two timings matter and they are deliberately different:
//   • the typed amount is debounced 400ms BEFORE it reaches the query key, so a user typing
//     "1000" fires one request instead of four;
//   • an idle quote is refetched every 10s, because the router's numbers go stale as pools move.
//
// `getQuote` resolves to null when the aggregator answers 404 — that is "no pool path", a valid
// answer, not a failure. It is surfaced as `noRoute` so the UI can say so plainly instead of
// throwing an error toast at the user.
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getQuote } from '@/lib/api';
import { toRawAmount } from '@/lib/format';
import type { Quote } from '@/lib/types';

export const QUOTE_DEBOUNCE_MS = 400;
export const QUOTE_REFETCH_MS = 10_000;

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

export interface UseQuoteArgs {
  inputMint: string | null;
  outputMint: string | null;
  /** The decimal string exactly as typed — conversion to base units happens here. */
  amount: string;
  /** Null until the registry has resolved the input token. */
  inputDecimals: number | null;
  slippageBps: number;
  /** The router prices some venues per-owner; harmless when disconnected. */
  owner: string | null;
}

export interface UseQuoteResult {
  quote: Quote | null;
  /** The aggregator answered, and there is no pool path for this pair. Not an error. */
  noRoute: boolean;
  /** No usable quote on screen yet: still debouncing, or the first fetch is in flight. */
  isQuoting: boolean;
  /** A background 10s refresh over a quote that is already displayed. */
  isRefreshing: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useQuote({
  inputMint,
  outputMint,
  amount,
  inputDecimals,
  slippageBps,
  owner,
}: UseQuoteArgs): UseQuoteResult {
  const debouncedAmount = useDebouncedValue(amount, QUOTE_DEBOUNCE_MS);

  // null = malformed or more decimal places than the token has; either way there is nothing to ask.
  const rawAmount = inputDecimals === null ? null : toRawAmount(debouncedAmount, inputDecimals);
  const enabled =
    Boolean(inputMint) &&
    Boolean(outputMint) &&
    inputMint !== outputMint &&
    rawAmount !== null &&
    rawAmount !== '0';

  const query = useQuery({
    queryKey: ['quote', inputMint, outputMint, rawAmount, slippageBps, owner],
    enabled,
    queryFn: ({ signal }) =>
      getQuote(
        {
          inputMint: inputMint as string,
          outputMint: outputMint as string,
          amount: rawAmount as string,
          slippageBps,
          owner,
        },
        signal,
      ),
    refetchInterval: QUOTE_REFETCH_MS,
    staleTime: QUOTE_REFETCH_MS / 2,
    gcTime: 30_000,
    retry: 1,
  });

  const settling = amount !== debouncedAmount;

  return {
    quote: query.data ?? null,
    noRoute: enabled && query.isSuccess && query.data === null,
    // `settling` is deliberately outside the `enabled` gate: typing the first character of an
    // empty field leaves the debounced value at '' for 400ms, so `enabled` is still false while a
    // request is plainly imminent. Gating on it there would flash "no route" mid-keystroke.
    isQuoting: settling || (enabled && query.isFetching && !query.data),
    isRefreshing: query.isFetching && Boolean(query.data),
    error: query.error,
    refetch: () => void query.refetch(),
  };
}
