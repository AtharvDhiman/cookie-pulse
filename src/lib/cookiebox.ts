// Cookiebox aggregator client (server-side only) — the same router behind cookiebox.app.
// Ported from cookie-mcp (MIT) `src/core/cookiebox.ts`.
import 'server-only';
import { serverConfig } from './config';
import { fetchJson, UpstreamError } from './http';
import { num, str, pick } from './normalize';
import type { Quote, RouteSegment, SwapTxResponse } from './types';

/**
 * /swap-tx re-quotes, builds AND simulates server-side, and may lazily extend the router address
 * lookup table inside the same call. 60s of headroom, matching cookie-mcp.
 */
const SWAP_TX_TIMEOUT_MS = 60_000;

function toSegment(raw: unknown): RouteSegment {
  return {
    pool: str(pick(raw, ['pool'])) ?? '',
    venue: str(pick(raw, ['venue'])) ?? 'unknown',
    inputMint: str(pick(raw, ['inputMint'])) ?? '',
    outputMint: str(pick(raw, ['outputMint'])) ?? '',
    inAmount: String(pick(raw, ['inAmount']) ?? '0'),
    outAmount: String(pick(raw, ['outAmount']) ?? '0'),
    percentage: num(pick(raw, ['percentage'])),
    hopIndex: num(pick(raw, ['hopIndex'])) ?? 0,
  };
}

export function toQuote(raw: unknown): Quote | null {
  if (!raw || typeof raw !== 'object') return null;
  const outAmount = String(pick(raw, ['outAmount']) ?? '');
  if (!outAmount || outAmount === 'undefined') return null;
  const rawSegments = pick(raw, ['segments']);
  const segments = Array.isArray(rawSegments) ? rawSegments.map(toSegment) : [];

  // Fill `percentage` when the router omits it: this leg input as a share of its hop total.
  const hopTotals = new Map<number, number>();
  for (const s of segments) {
    hopTotals.set(s.hopIndex, (hopTotals.get(s.hopIndex) ?? 0) + Number(s.inAmount || 0));
  }
  for (const s of segments) {
    if (s.percentage === null) {
      const total = hopTotals.get(s.hopIndex) ?? 0;
      s.percentage = total > 0 ? Math.round((Number(s.inAmount || 0) / total) * 100) : null;
    }
  }

  const path = pick(raw, ['path']);
  return {
    inAmount: String(pick(raw, ['inAmount']) ?? '0'),
    outAmount,
    netOutAmount: String(pick(raw, ['netOutAmount']) ?? outAmount),
    minOutAmount: String(pick(raw, ['minOutAmount']) ?? '0'),
    feePct: num(pick(raw, ['feePct'])) ?? 0,
    feeAmount: String(pick(raw, ['feeAmount']) ?? '0'),
    // null = the router could not measure impact. Kept null so the UI shows a dash, not a false 0.
    priceImpactPct: num(pick(raw, ['priceImpactPct'])),
    path: Array.isArray(path) ? path.map(String) : [],
    isSplit: pick(raw, ['isSplit']) === true,
    isMultiHop: pick(raw, ['isMultiHop']) === true,
    segments,
  };
}

/** Returns null for "no route" (the aggregator answers 404); throws for anything else. */
export async function fetchQuote(params: {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps: number;
  owner?: string | null;
}): Promise<Quote | null> {
  const qs = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.amount,
    slippageBps: String(params.slippageBps),
    ...(params.owner ? { owner: params.owner } : {}),
  });
  try {
    const body = await fetchJson<unknown>(`${serverConfig.cookiebox()}/quote?${qs}`, {
      timeoutMs: 15_000,
    });
    return toQuote(pick(body, ['route']) ?? body);
  } catch (e) {
    if (e instanceof UpstreamError && e.status === 404) return null;
    throw e;
  }
}

/** Unsigned v0 transaction with feePayer = owner. The browser signs it; no key ever reaches us. */
export async function buildSwapTx(params: {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps: number;
  owner: string;
}): Promise<SwapTxResponse> {
  const body = await fetchJson<unknown>(`${serverConfig.cookiebox()}/swap-tx`, {
    method: 'POST',
    body: JSON.stringify(params),
    timeoutMs: SWAP_TX_TIMEOUT_MS,
  });
  const transactionBase64 = str(pick(body, ['transactionBase64']));
  if (!transactionBase64) throw new UpstreamError('aggregator returned no transaction', 502);
  return {
    transactionBase64,
    blockhash: str(pick(body, ['blockhash'])) ?? '',
    lastValidBlockHeight: num(pick(body, ['lastValidBlockHeight'])) ?? 0,
    route: toQuote(pick(body, ['route'])),
  };
}
