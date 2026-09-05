/**
 * Smoke test for every /api/* route handler, run against a live dev server.
 *
 *   npm run dev          # in one terminal
 *   npm run smoke        # in another
 *
 * Optional: BASE_URL=https://your-deploy.vercel.app npm run smoke
 *
 * It asserts shapes, not exact values — the chain moves. Exits non-zero if any check fails.
 */

const BASE = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const COOK_MINT = 'So11111111111111111111111111111111111111112';

let passed = 0;
let failed = 0;

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

function check(label: string, ok: boolean, detail: string): void {
  if (ok) {
    passed++;
    console.log(`  ${GREEN}PASS${RESET} ${label} ${DIM}${detail}${RESET}`);
  } else {
    failed++;
    console.log(`  ${RED}FAIL${RESET} ${label} ${DIM}${detail}${RESET}`);
  }
}

async function getJson(
  path: string,
): Promise<{ status: number; body: unknown; ms: number; bytes: number }> {
  const started = Date.now();
  const res = await fetch(`${BASE}${path}`);
  // Read as text first: the uncompressed payload size is itself something this script asserts.
  const text = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    body = null;
  }
  return { status: res.status, body, ms: Date.now() - started, bytes: Buffer.byteLength(text) };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** The mints in a registry payload that carry a real USD price, sorted so two views can be compared. */
function pricedMints(body: unknown): string[] {
  const rows = isRecord(body) && Array.isArray(body.tokens) ? body.tokens : [];
  return rows
    .filter((t) => isRecord(t) && typeof t.priceUsd === 'number' && t.priceUsd > 0)
    .map((t) => String((t as Record<string, unknown>).mint))
    .sort();
}

function envelopeCount(body: unknown, key: string): number | null {
  const v = isRecord(body) ? body[key] : null;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

async function main(): Promise<void> {
  console.log(`\nCookie Pulse smoke test → ${BASE}\n`);

  // --- /api/tokens ------------------------------------------------------------------------------
  console.log('GET /api/tokens');
  const tokens = await getJson('/api/tokens');
  check('responds 200', tokens.status === 200, `${tokens.status} in ${tokens.ms}ms`);
  const tokenList = isRecord(tokens.body) && Array.isArray(tokens.body.tokens) ? tokens.body.tokens : [];
  check('token count > 0', tokenList.length > 0, `${tokenList.length} tokens`);
  const cookUsd = isRecord(tokens.body) ? tokens.body.cookUsd : null;
  check(
    'cookUsd is a positive number',
    typeof cookUsd === 'number' && Number.isFinite(cookUsd) && cookUsd > 0,
    String(cookUsd),
  );

  const first = tokenList[0];
  check(
    'token has normalized fields',
    isRecord(first) &&
      typeof first.mint === 'string' &&
      typeof first.symbol === 'string' &&
      typeof first.decimals === 'number' &&
      typeof first.liquidityUsd === 'number',
    isRecord(first) ? `${String(first.symbol)} · ${String(first.mint).slice(0, 8)}…` : 'no tokens',
  );
  check(
    'every priceUsd is a number or null (no raw strings)',
    tokenList.every((t) => !isRecord(t) || t.priceUsd === null || typeof t.priceUsd === 'number'),
    'string prices coerced by num()',
  );

  // --- registry projection ------------------------------------------------------------------------
  // The default response is a projection: priced rows only, no `metadata.description`. Everything
  // here guards the one way that can go wrong — the app reporting the projection as if it were the
  // registry. The denominator every surface renders comes from `count`, so `count` must stay equal
  // to the true upstream size in BOTH views, and must never be the length of the row array.
  console.log('\nGET /api/tokens  (projection)');
  const defaultCount = envelopeCount(tokens.body, 'count');
  const fungible = envelopeCount(tokens.body, 'fungibleCount');
  const nftLike = envelopeCount(tokens.body, 'nftLikeCount');

  // Nothing caps the row count — capping would drop priced mints from the screener. 120 is headroom
  // over the ~92 mints that carry a price today; if this trips, the chain grew and the budget needs
  // a second look, not a slice.
  check(
    'default view is projected and within budget',
    tokenList.length <= 120 && tokens.bytes < 60_000,
    `${tokenList.length} rows (budget 120), ${(tokens.bytes / 1024).toFixed(1)} KB uncompressed (budget 60)`,
  );
  check(
    'default view drops metadata.description',
    tokenList.every((t) => !isRecord(t) || t.description === null),
    'every projected row has description: null',
  );
  check(
    'envelope count exceeds the rows returned',
    defaultCount !== null && defaultCount > tokenList.length,
    `count=${defaultCount} vs ${tokenList.length} rows — a denominator taken from tokens.length would understate the registry by ${
      defaultCount === null ? '?' : defaultCount - tokenList.length
    }`,
  );
  check(
    'composition counts sum to the envelope count',
    fungible !== null && nftLike !== null && defaultCount !== null && fungible + nftLike === defaultCount,
    `${fungible} fungible + ${nftLike} NFT editions = ${defaultCount}`,
  );

  console.log('\nGET /api/tokens?view=full  (the show-all path)');
  const full = await getJson('/api/tokens?view=full');
  check('responds 200', full.status === 200, `${full.status} in ${full.ms}ms, ${(full.bytes / 1024 / 1024).toFixed(2)} MB`);
  const fullList = isRecord(full.body) && Array.isArray(full.body.tokens) ? full.body.tokens : [];
  const fullCount = envelopeCount(full.body, 'count');
  check(
    'full view returns every registry entry',
    fullCount !== null && fullList.length === fullCount,
    `${fullList.length} rows = count ${fullCount} — no unpriced token silently dropped`,
  );
  check(
    'both views report the same envelope count',
    defaultCount !== null && defaultCount === fullCount,
    `default ${defaultCount} · full ${fullCount}`,
  );
  check(
    'both views agree on the composition split',
    fungible === envelopeCount(full.body, 'fungibleCount') &&
      nftLike === envelopeCount(full.body, 'nftLikeCount'),
    `${fungible} fungible · ${nftLike} NFT editions`,
  );

  // The two paths derive their rows from the same upstream body but through different code; if they
  // ever disagree on which mints are priced, the screener shows one set and ranks against another.
  const defaultPriced = pricedMints(tokens.body);
  const fullPriced = pricedMints(full.body);
  check(
    'priced subset is identical in both views',
    defaultPriced.length === fullPriced.length &&
      defaultPriced.every((mint, i) => mint === fullPriced[i]),
    `${defaultPriced.length} priced mints in the default view · ${fullPriced.length} in the full view`,
  );
  check(
    'the default view is exactly the priced subset',
    defaultPriced.length === tokenList.length,
    `${tokenList.length} rows, all priced`,
  );

  console.log(
    `  ${DIM}note  ${defaultPriced.length} priced · ${fungible} fungible mints · ${nftLike} NFT editions · ${defaultCount} entries${RESET}`,
  );

  // --- /api/markets -----------------------------------------------------------------------------
  console.log('\nGET /api/markets');
  const markets = await getJson('/api/markets');
  check('responds 200', markets.status === 200, `${markets.status} in ${markets.ms}ms`);
  const marketList = isRecord(markets.body) && Array.isArray(markets.body.markets) ? markets.body.markets : [];
  check('markets count > 0', marketList.length > 0, `${marketList.length} pools`);
  const tvl = isRecord(markets.body) ? markets.body.tvlUsd : null;
  check('tvlUsd is a number', typeof tvl === 'number' && Number.isFinite(tvl), `$${Number(tvl).toFixed(2)}`);
  const venues = isRecord(markets.body) && Array.isArray(markets.body.venues) ? markets.body.venues : [];
  check('venue breakdown present', venues.length > 0, venues.map((v) => (isRecord(v) ? v.venue : '?')).join(', '));

  // --- /api/price/cook --------------------------------------------------------------------------
  console.log('\nGET /api/price/cook');
  const price = await getJson('/api/price/cook');
  check('responds 200', price.status === 200, `${price.status} in ${price.ms}ms`);
  const usd = isRecord(price.body) ? price.body.usd : null;
  check('COOK price is a number', typeof usd === 'number' && Number.isFinite(usd) && usd > 0, `$${usd}`);

  // --- /api/quote -------------------------------------------------------------------------------
  // COOK -> the highest 24h-volume non-COOK token, which is the pair most likely to have a route.
  const topVolume = tokenList
    .filter((t): t is Record<string, unknown> => isRecord(t) && t.mint !== COOK_MINT)
    .filter((t) => typeof t.volume24h === 'number' && t.volume24h > 0)
    .sort((a, b) => Number(b.volume24h) - Number(a.volume24h))[0];

  console.log('\nGET /api/quote  (COOK → top-volume token, 0.1 COOK)');
  if (!topVolume) {
    check('a top-volume token exists to quote against', false, 'no token has 24h volume right now');
  } else {
    const out = String(topVolume.mint);
    const qs = `inputMint=${COOK_MINT}&outputMint=${out}&amount=100000000&slippageBps=100`;
    const quote = await getJson(`/api/quote?${qs}`);
    check('responds 200', quote.status === 200, `${quote.status} in ${quote.ms}ms → ${String(topVolume.symbol)}`);
    const route = isRecord(quote.body) ? quote.body.route : null;
    check('returns a route', isRecord(route), route === null ? 'null (no route)' : 'route present');
    if (isRecord(route)) {
      check(
        'route has amounts and segments',
        typeof route.outAmount === 'string' &&
          typeof route.minOutAmount === 'string' &&
          Array.isArray(route.segments) &&
          route.segments.length > 0,
        `out=${String(route.outAmount)} min=${String(route.minOutAmount)} hops=${
          Array.isArray(route.segments) ? route.segments.length : 0
        }`,
      );
    }
  }

  // --- /api/quote validation --------------------------------------------------------------------
  console.log('\nGET /api/quote  (validation)');
  const badQuote = await getJson('/api/quote?inputMint=abc');
  check('rejects a missing amount with 400', badQuote.status === 400, `${badQuote.status}`);

  // --- /api/swap-tx validation ------------------------------------------------------------------
  // Never built for real here: it needs a funded owner, and this script must not require a wallet.
  console.log('\nPOST /api/swap-tx  (validation only — a real build needs a funded wallet)');
  const badSwap = await fetch(`${BASE}/api/swap-tx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputMint: COOK_MINT, outputMint: COOK_MINT, amount: '1', owner: 'not-an-address' }),
  });
  check('rejects an invalid owner with 400', badSwap.status === 400, `${badSwap.status}`);

  // --- /api/das ---------------------------------------------------------------------------------
  console.log('\nGET /api/das');
  const das = await getJson('/api/das?owner=B8AB9R9J98yggrwdnZhoHuGJBc8RzTpHsqDnRkTnMuV');
  check('responds 200', das.status === 200, `${das.status} in ${das.ms}ms`);
  check(
    'returns an nfts array',
    isRecord(das.body) && Array.isArray(das.body.nfts),
    isRecord(das.body) && Array.isArray(das.body.nfts) ? `${das.body.nfts.length} assets` : 'missing',
  );
  const badDas = await getJson('/api/das?owner=nope');
  check('rejects an invalid owner with 400', badDas.status === 400, `${badDas.status}`);

  // --- summary ----------------------------------------------------------------------------------
  console.log(`\n${failed === 0 ? GREEN : RED}${passed} passed, ${failed} failed${RESET}\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e: unknown) => {
  console.error(`\n${RED}Smoke test could not run${RESET}`);
  console.error(e instanceof Error ? e.message : e);
  console.error(`\nIs the dev server up at ${BASE}?  Run: npm run dev\n`);
  process.exit(1);
});
