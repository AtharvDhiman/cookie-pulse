// Browser-side fetchers for our own /api/* route handlers. Every third-party HTTP API is proxied
// there (CORS + caching + one place for fallbacks); only the RPC is called directly.
import type { MarketsSnapshot, Quote, SwapTxResponse, TokenRegistry, WalletNft } from './types';

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed (HTTP ${res.status})`);
  }
  return (await res.json()) as T;
}

export const getRegistry = (signal?: AbortSignal) => getJson<TokenRegistry>('/api/tokens', signal);

export const getMarkets = (signal?: AbortSignal) => getJson<MarketsSnapshot>('/api/markets', signal);

export const getCookPrice = (signal?: AbortSignal) =>
  getJson<{ usd: number | null; change24h: number | null }>('/api/price/cook', signal);

/** Resolves to null when the aggregator has no route for the pair. */
export async function getQuote(
  params: { inputMint: string; outputMint: string; amount: string; slippageBps: number; owner?: string | null },
  signal?: AbortSignal,
): Promise<Quote | null> {
  const qs = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.amount,
    slippageBps: String(params.slippageBps),
    ...(params.owner ? { owner: params.owner } : {}),
  });
  const body = await getJson<{ route: Quote | null }>(`/api/quote?${qs}`, signal);
  return body.route;
}

export async function postSwapTx(params: {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps: number;
  owner: string;
}): Promise<SwapTxResponse> {
  const res = await fetch('/api/swap-tx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Could not build the swap (HTTP ${res.status})`);
  }
  return (await res.json()) as SwapTxResponse;
}

/** Best-effort: DAS is not guaranteed to index every wallet, so callers treat failure as "no NFTs". */
export const getNfts = (owner: string, signal?: AbortSignal) =>
  getJson<{ nfts: WalletNft[] }>(`/api/das?owner=${encodeURIComponent(owner)}`, signal);
