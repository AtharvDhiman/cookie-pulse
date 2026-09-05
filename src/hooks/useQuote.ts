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
//
// The 10s refresh stops entirely while `paused` is set. A quote that changes under an open Nightly
// window would mean the "You receive" figure the user is looking at is not the one they are
// approving, which is the single thing this panel must never do.
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
  /**
   * True while a transaction is in flight. Freezes the displayed quote — no interval, no
   * focus/reconnect refetch, no manual `refetch()` — until the run reaches confirmed or failed.
   */
  paused?: boolean;
}

export interface UseQuoteResult {
  quote: Quote | null;
  /** The aggregator answered, and there is no pool path for this pair. Not an error. */
  noRoute: boolean;
  /** No usable quote on screen yet: still debouncing, or the first fetch is in flight. */
  isQuoting: boolean;
  /** A background 10s refresh over a quote that is already displayed. */
  isRefreshing: boolean;
  /** The quote on screen is frozen: no request will be issued until the caller unpauses. */
  isPaused: boolean;
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
  paused = false,
}: UseQuoteArgs): UseQuoteResult {
  const debouncedAmount = useDebouncedValue(amount, QUOTE_DEBOUNCE_MS);

  // null = malformed or more decimal places than the token has; either way there is nothing to ask.
  const rawAmount = inputDecimals === null ? null : toRawAmount(debouncedAmount, inputDecimals);
  // "There is something to quote", which is not the same as "ask for it now" — the returned flags
  // describe the pair, while `enabled` also has to obey the pause.
  const quotable =
    Boolean(inputMint) &&
    Boolean(outputMint) &&
    inputMint !== outputMint &&
    rawAmount !== null &&
    rawAmount !== '0';

  const query = useQuery({
    queryKey: ['quote', inputMint, outputMint, rawAmount, slippageBps, owner],
    // Disabling the query, rather than only clearing the interval, is what also stops the
    // window-focus and reconnect refetches. Cached data survives, so the panel keeps showing the
    // quote the user is signing.
    enabled: quotable && !paused,
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
    refetchInterval: paused ? false : QUOTE_REFETCH_MS,
    staleTime: QUOTE_REFETCH_MS / 2,
    gcTime: 30_000,
    retry: 1,
  });

  const settling = amount !== debouncedAmount;

  return {
    quote: query.data ?? null,
    noRoute: quotable && query.isSuccess && query.data === null,
    // `settling` is deliberately outside the `quotable` gate: typing the first character of an
    // empty field leaves the debounced value at '' for 400ms, so `quotable` is still false while a
    // request is plainly imminent. Gating on it there would flash "no route" mid-keystroke.
    isQuoting: !paused && (settling || (quotable && query.isFetching && !query.data)),
    isRefreshing: query.isFetching && Boolean(query.data),
    isPaused: paused,
    error: query.error,
    // `refetch()` ignores `enabled`, so the pause has to be honoured here too — otherwise the
    // router-error Retry button could still move the numbers mid-signature.
    refetch: () => {
      if (!paused) void query.refetch();
    },
  };
}
