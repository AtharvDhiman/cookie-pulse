// Cookiescan REST client (server-side only) + normalization into `Token` / `Market`.
// Ported from cookie-mcp (MIT) `src/core/cookiescan.ts`, with unit handling corrected — see NOTES.md.
import 'server-only';
import { serverConfig } from './config';
import { fetchJson } from './http';
import { num, num0, str, unwrap, pick } from './normalize';
import type { Market, MarketsSnapshot, Token, TokenRegistry } from './types';

function toToken(raw: unknown): Token | null {
  const mint = str(pick(raw, ['mint']));
  if (!mint) return null;
  const decimals = num(pick(raw, ['metadata', 'decimals']));
  return {
    mint,
    name: str(pick(raw, ['metadata', 'name'])) ?? 'Unknown token',
    symbol: str(pick(raw, ['metadata', 'symbol'])) ?? mint.slice(0, 4),
    logo: str(pick(raw, ['metadata', 'logo'])),
    // A wrong decimals value would misprice every amount, so only fall back when it is out of range.
    decimals: decimals !== null && decimals >= 0 && decimals <= 18 ? decimals : 9,
    description: str(pick(raw, ['metadata', 'description'])),
    // `price.usd` arrives as a string for ~1% of the registry — `num` coerces both forms.
    priceUsd: num(pick(raw, ['price', 'usd'])),
    priceNative: num(pick(raw, ['price', 'native'])),
    change24h: num(pick(raw, ['price', 'change24h'])),
    volume24h: num0(pick(raw, ['marketData', 'volume24h'])),
    liquidityUsd: num0(pick(raw, ['marketData', 'liquidity'])),
    marketCap: num0(pick(raw, ['marketData', 'marketCap'])),
    supply: num0(pick(raw, ['marketData', 'supply'])),
    holderCount: num0(pick(raw, ['marketData', 'holderCount'])),
  };
}

export async function fetchRegistry(): Promise<TokenRegistry> {
  const json = await fetchJson<unknown>(`${serverConfig.cookiescan()}/api/tokens`, {
    timeoutMs: 20_000,
  });
  const tokens = unwrap<unknown>(json, ['data', 'tokens'])
    .map(toToken)
    .filter((t): t is Token => t !== null);
  return {
    tokens,
    // The registry response carries COOK USD at the top level — one fewer round trip.
    cookUsd: num(pick(json, ['cookUsd'])),
    count: num(pick(json, ['count'])) ?? tokens.length,
  };
}

function toMarket(raw: unknown): Market | null {
  const marketId = str(pick(raw, ['marketId']));
  if (!marketId) return null;
  const side = (k: 'baseToken' | 'quoteToken') => ({
    mint: str(pick(raw, [k, 'mint'])) ?? '',
    symbol: str(pick(raw, [k, 'symbol'])),
    amount: num(pick(raw, [k, 'amount'])),
    priceUsd: num(pick(raw, [k, 'priceUsd'])),
  });
  return {
    marketId,
    venue: str(pick(raw, ['type'])) ?? 'Unknown venue',
    base: side('baseToken'),
    quote: side('quoteToken'),
    liquidityUsd: num0(pick(raw, ['liquidityUsd'])),
    liquidityDisplay: str(pick(raw, ['liquidityDisplay'])),
  };
}

export async function fetchMarkets(): Promise<MarketsSnapshot> {
  const json = await fetchJson<unknown>(`${serverConfig.cookiescan()}/api/markets`);
  const markets = unwrap<unknown>(json, ['data', 'markets'])
    .map(toMarket)
    .filter((m): m is Market => m !== null);

  const byVenue = new Map<string, { poolCount: number; tvlUsd: number }>();
  let tvlUsd = 0;
  for (const m of markets) {
    tvlUsd += m.liquidityUsd;
    const cur = byVenue.get(m.venue) ?? { poolCount: 0, tvlUsd: 0 };
    cur.poolCount += 1;
    cur.tvlUsd += m.liquidityUsd;
    byVenue.set(m.venue, cur);
  }
  return {
    markets,
    tvlUsd,
    poolCount: markets.length,
    venues: [...byVenue.entries()]
      .map(([venue, v]) => ({ venue, ...v }))
      .sort((a, b) => b.tvlUsd - a.tvlUsd),
  };
}

export async function fetchCookPrice(): Promise<{ usd: number | null; change24h: number | null }> {
  const json = await fetchJson<unknown>(`${serverConfig.cookiescan()}/api/price/cook`);
  return {
    usd: num(pick(json, ['data', 'price', 'usd'])),
    change24h: num(pick(json, ['data', 'price', 'change24h'])),
  };
}
