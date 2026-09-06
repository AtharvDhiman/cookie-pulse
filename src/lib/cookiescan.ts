// Cookiescan REST client (server-side only) + normalization into `Token` / `Market`.
// Ported from cookie-mcp (MIT) `src/core/cookiescan.ts`, with unit handling corrected — see NOTES.md.
import 'server-only';
import { serverConfig } from './config';
import { fetchJson } from './http';
import { isNftLike, num, num0, str, unwrap, pick } from './normalize';
import type { Market, MarketsSnapshot, RegistryView, Token, TokenRegistry } from './types';

function toToken(raw: unknown): Token | null {
  const mint = str(pick(raw, ['mint']));
  if (!mint) return null;
  const decimals = num(pick(raw, ['metadata', 'decimals']));

  // Cookiescan emits `change24h: 0` for BOTH "did not move" and "no 24h window indexed", and on
  // 5 Sep 2026 only 3 of 6470 tokens had a non-zero value — so an exact 0 is the indexer's default,
  // not a measurement. Surfaced as null so the UI renders a dash instead of a fabricated +0.00%.
  // `volume24h` gets no such treatment: 0 there genuinely means no trades.
  const change = num(pick(raw, ['price', 'change24h']));
  const usd = num(pick(raw, ['price', 'usd']));
  const native = num(pick(raw, ['price', 'native']));
  const supply = num0(pick(raw, ['marketData', 'supply']));
  const indexed = supply > 0;
  return {
    mint,
    name: str(pick(raw, ['metadata', 'name'])) ?? 'Unknown token',
    symbol: str(pick(raw, ['metadata', 'symbol'])) ?? mint.slice(0, 4),
    logo: str(pick(raw, ['metadata', 'logo'])),
    // A wrong decimals value would misprice every amount, so only fall back when it is out of range.
    decimals: decimals !== null && decimals >= 0 && decimals <= 18 ? decimals : 9,
    description: str(pick(raw, ['metadata', 'description'])),
    // `price.usd` arrives as a string for ~1% of the registry — `num` coerces both forms.
    //
    // A price of exactly 0 is the indexer's "not priced", not a measurement: the registry's own
    // `isPriced` filter is `> 0`. Passing the 0 through made an unpriced token's USD line render a
    // confident "$0.00" on /trade instead of nothing.
    priceUsd: usd !== null && usd > 0 ? usd : null,
    priceNative: native !== null && native > 0 ? native : null,
    change24h: change === 0 ? null : change,
    // The same sentinel, one level up. When the indexer has not populated a token's block at all
    // it returns an all-zero marketData, and `num0` turned that into three measured-looking zeros
    // — so COOK's own screener row claimed $0.00 liquidity and $0.00 market cap while the overview
    // above it reported $7.88K of TVL. `supply > 0` is the tell that the block was populated.
    volume24h: indexed ? num0(pick(raw, ['marketData', 'volume24h'])) : null,
    liquidityUsd: indexed ? num0(pick(raw, ['marketData', 'liquidity'])) : null,
    marketCap: indexed ? num0(pick(raw, ['marketData', 'marketCap'])) : null,
    supply,
    holderCount: num0(pick(raw, ['marketData', 'holderCount'])),
    // Placeholder: the real figure needs every row, so `withSymbolCounts` fills it below.
    symbolCount: 0,
  };
}

/**
 * Stamps each token with how many registry entries share its symbol, counted across ALL rows.
 *
 * This has to happen server-side. The client holds a 92-row projection, and SESA alone appears on
 * 4,452 rows — a collision count computed from what the browser has would be wrong by two orders of
 * magnitude, and the picker's whole purpose is telling the user that a symbol is not unique.
 */
function withSymbolCounts(all: Token[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of all) {
    const key = t.symbol.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

const stampSymbolCount = (counts: Map<string, number>) => (t: Token): Token => ({
  ...t,
  symbolCount: counts.get(t.symbol.toLowerCase()) ?? 1,
});

/**
 * A priced row is the only kind any surface can rank, route through or value a holding against.
 * Measured 5 Sep 2026: all 72 mints reporting liquidity are priced, and the only 4 pool mints that
 * are not priced sit in pools holding $0.00 — so the priced view drops no tradeable token.
 */
function isPriced(t: Token): boolean {
  return t.priceUsd !== null && t.priceUsd > 0;
}

/**
 * `metadata.description` is 717 KB of the 2.7 MB registry and is rendered by nothing. It stays in
 * the full view — the "everything upstream has" escape hatch is the one place it could ever be
 * surfaced — and is stripped from the view on the critical path.
 */
function withoutDescription(t: Token): Token {
  return t.description === null ? t : { ...t, description: null };
}

/**
 * The upstream body, memoised for the same 20 s the CDN header already promises. Upstream is 3.9 MB
 * and 3–12 s cold, and it is fetched whole whichever view is asked for — the projection saves the
 * browser's download, not this one. The memo means the screener's show-all toggle reuses the body
 * the priced view already paid for, and it makes the two views provably the same snapshot, so their
 * priced subsets cannot drift apart between two calls.
 */
const REGISTRY_TTL_MS = 20_000;
let cachedBody: { at: number; body: unknown } | null = null;
let inflight: Promise<unknown> | null = null;

async function registryBody(): Promise<unknown> {
  if (cachedBody && Date.now() - cachedBody.at < REGISTRY_TTL_MS) return cachedBody.body;
  // Two views racing a cold memo would otherwise pull 3.9 MB twice; the second joins the first.
  const pending =
    inflight ??
    fetchJson<unknown>(`${serverConfig.cookiescan()}/api/tokens`, { timeoutMs: 20_000 })
      .then((body) => {
        cachedBody = { at: Date.now(), body };
        return body;
      })
      .finally(() => {
        inflight = null;
      });
  inflight = pending;
  return pending;
}

/**
 * Identity for a named set of mints, whatever their price.
 *
 * The priced projection is the right default for every ranking surface, but it is a price feed, not
 * a directory — and a wallet can hold, or a deep link can name, a mint that has no price. Those
 * surfaces need a symbol, a name and a logo, and the alternative to this is shipping the 2.7 MB full
 * view to a phone to look up a handful of rows. Upstream is already memoised server-side, so this
 * costs a filter and returns a few hundred bytes.
 *
 * The envelope's registry-wide counts are unchanged, because they describe the registry rather than
 * whatever subset was asked for.
 */
export async function fetchTokensByMint(mints: string[]): Promise<TokenRegistry> {
  const json = await registryBody();
  const wanted = new Set(mints);
  const all = unwrap<unknown>(json, ['data', 'tokens'])
    .map(toToken)
    .filter((t): t is Token => t !== null);

  let nftLikeCount = 0;
  for (const t of all) if (isNftLike(t)) nftLikeCount++;

  const counts = withSymbolCounts(all);
  return {
    tokens: all.filter((t) => wanted.has(t.mint)).map(withoutDescription).map(stampSymbolCount(counts)),
    cookUsd: num(pick(json, ['cookUsd'])),
    count: num(pick(json, ['count'])) ?? all.length,
    fungibleCount: all.length - nftLikeCount,
    nftLikeCount,
    view: 'priced',
  };
}

/**
 * Upstream ignores `limit`, `offset`, `page`, `sort`, `minLiquidity`, `priced` and `hasPrice`
 * (verified 5 Sep 2026), so the projection has to happen here. What it saves is the browser's
 * share: 2.7 MB down to ~35 KB.
 */
export async function fetchRegistry(view: RegistryView = 'priced'): Promise<TokenRegistry> {
  const json = await registryBody();
  const all = unwrap<unknown>(json, ['data', 'tokens'])
    .map(toToken)
    .filter((t): t is Token => t !== null);

  let nftLikeCount = 0;
  for (const t of all) if (isNftLike(t)) nftLikeCount++;

  const counts = withSymbolCounts(all);
  return {
    tokens: (view === 'full' ? all : all.filter(isPriced).map(withoutDescription)).map(
      stampSymbolCount(counts),
    ),
    // The registry response carries COOK USD at the top level — one fewer round trip.
    cookUsd: num(pick(json, ['cookUsd'])),
    // Counts describe the registry, never the projection: reading them off `tokens` would make the
    // app understate the very thing it is projecting. `all.length` is the fallback only when
    // upstream omits its own count, and it is still the unprojected length.
    count: num(pick(json, ['count'])) ?? all.length,
    fungibleCount: all.length - nftLikeCount,
    nftLikeCount,
    view,
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
