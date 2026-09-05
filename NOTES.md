# NOTES — assumptions, verifications, and things that differ from the brief

Everything below was checked live against the real endpoints. Where a finding contradicts the
build brief, the finding wins and the reason is recorded here.

## Phase 0 — endpoint verification (5 Sep 2026, ~02:00 IST)

All endpoints were reachable. Nothing had to be coded blind.

| Endpoint | Result |
| --- | --- |
| `GET api.cookiescan.io/api/tokens` | HTTP 200, 3.9 MB, 4.3 s, **6470 tokens** |
| `GET api.cookiescan.io/api/markets` | HTTP 200, 72 KB, 1.2 s, **160 pools** |
| `GET api.cookiescan.io/api/price/cook` | HTTP 200, `data.price.usd = 0.00011920694650499066` |
| `GET agg.cookiebox.app/quote` | HTTP 200, 0.73 s, route returned |
| `POST agg.cookiebox.app/swap-tx` | HTTP 422 for an unfunded owner (expected) |
| `POST api.cookiescan.io` (DAS `getAssetsByOwner`) | HTTP 200, valid `{total, limit, page, items}` |
| `POST rpc.cookiescan.io` (batched) | HTTP 200, `solana-core 4.1.2`, slot ~23,251,756 |

### Actual response shapes (not quite what the brief documented)

`/api/tokens` is **not** a bare array and **not** `{data:[…]}` alone — it is:

```jsonc
{ "success": true, "cookUsd": 0.000119…, "count": 6470, "data": [ … ] }
```

`/api/markets` is `{ success, cookUsd, marketCount, markets: [ … ] }`.

Both still go through the defensive `unwrap(json, ['data','tokens'])` /
`unwrap(json, ['data','markets'])` from cookie-mcp, so either shape keeps working.

**`cookUsd` is carried at the top level of both responses.** `/api/price/cook` is still proxied and
still used, but the Overview reads COOK's price from the registry response it already has, saving a
round trip.

## ❗ Correction: the WebSocket host is `rpc.cookiescan.io`, not `wss.cookiescan.io`

BRIEF section 1 states `wss://wss.cookiescan.io` as fact (and section 6 tells the user to type it
into Nightly). **That host does not serve a WebSocket.** It presents a TLS certificate issued for an
unrelated domain and then answers with a redirect rather than a protocol upgrade:

```
Hostname/IP does not match certificate's altnames:
Host: wss.cookiescan.io. is not in the cert's altnames: DNS:bakedbazaar.art
```

Measured through this repo's own `@solana/web3.js` (1.98.4), a `Connection` on `rpc.cookiescan.io`
with each candidate as `wsEndpoint`, counting `onSlotChange` callbacks over a 10 s window:

| `wsEndpoint` | Events in 10 s | First event | TLS altname errors |
| --- | --- | --- | --- |
| `wss://wss.cookiescan.io` | **0** | — | 7 (one per reconnect attempt) |
| `wss://rpc.cookiescan.io` | **18 / 26** (two runs) | ~0.9–1.1 s | **0** |

### Why this was the highest-severity defect in the app

`WalletProvider` passes `WS_URL` straight into `ConnectionProvider` as `wsEndpoint`, so a dead socket
is not merely a missing live feed — it breaks confirmation. In
`node_modules/@solana/web3.js/lib/index.cjs.js`, `getTransactionConfirmationPromise` (≈ line 6553)
opens the signature subscription and then gates its safety net behind it:

```js
await subscriptionSetupPromise;   // resolves only on state === 'subscribed'
const response = await this.getSignatureStatus(signature);
```

On a socket that never upgrades, `subscriptionSetupPromise` never resolves, so the one-shot
`getSignatureStatus` fallback never runs. The only remaining exit is the block-height expiry race
(≈ line 6664) — roughly 69 s later. Net effect: **every successful mainnet transaction would have
been reported to the user as a probable failure**, after a minute of spinning.

**Decision:** `WS_URL` defaults to `wss://rpc.cookiescan.io`; the RPC host serves both. The
`NEXT_PUBLIC_WS_URL` override is untouched, and `/bridge`, `.env.example` and the README all read
the corrected value. The broken host is named nowhere in the app — only here, as the record.

## ❗ Correction: `marketData.liquidity` is USD, not COOK

The brief says liquidity is denominated in COOK and instructs `liquidity × COOK price`. **It is
already USD.** cookie-mcp's own comment in `src/core/cookiescan.ts` makes the same claim, so the
error is inherited, not invented by the brief.

Measured: registry `marketData.liquidity` ≈ the sum of `liquidityUsd` over every pool holding that
token in `/api/markets`.

| Token | registry `liquidity` | Σ pool `liquidityUsd` | `liquidity × cookUsd` |
| --- | --- | --- | --- |
| bCOOK | 3861.16 | 3863.45 | 0.46 |
| COOKHOUSE | 1126.91 | 1127.61 | 0.13 |
| GORBAGE | 592.10 | 592.10 | 0.07 |
| MON | 202.26 | 202.50 | 0.02 |

Multiplying by COOK's price would have understated liquidity by ~8,400×, rendering every row on the
Screener as `$0.00`. **Decision: `liquidityUsd` is read directly from `marketData.liquidity`.**
(`TRASHCOIN` reads 1206.38 against a pool sum of 862.49 — the registry appears to include pools that
the markets feed does not list. Directionally consistent; still USD.)

## ❗ The chain is far quieter than the brief assumes

Of 6470 registry tokens, on 5 Sep 2026:

- **92** have a non-zero USD price
- **3** have non-zero 24h volume (MON, COOKHOUSE, bCOOK)
- **3** have a non-zero 24h change

### `change24h: 0` means "no data", not "flat"

Cookiescan returns `price.change24h = 0` both for a token that genuinely did not move and for one it
has no 24h window for. With 6,467 of 6,470 sitting at exactly `0.000000` and only three carrying a
real value, an exact zero is plainly the indexer's default rather than a measurement.

Rendering it literally would have printed a confident **`+0.00%`** on 89 of the 92 priced rows in the
screener — a fabricated number on nearly every line. So `toToken()` maps an exact `0` to `null`, and
the UI shows an em dash. Verified after the change: 3 tokens carry a value (bCOOK −1.15%,
COOKHOUSE −14.40%, MON −7.95%), 6,467 are null, and no row reports a zero.

`volume24h` gets no such treatment — `0` there genuinely means no trades.

Consequences, all handled in the UI rather than papered over:

1. **Top gainers / losers tiles** can only ever show ~3 rows. They render whatever exists and show a
   real empty state instead of padding with zero-change tokens.
2. **The Screener hides unpriced tokens by default** (as the brief specifies), which takes 6470 rows
   down to ~92. The "show all" toggle restores the full registry, which is why pagination stays.
3. Total TVL across all 160 pools is roughly **$8,478**. That is the real number; it is displayed
   as-is.

## Other verified facts

- **The Memo program exists on Cookie Chain.** `getAccountInfo` on
  `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr` returns a BPF ELF executable, so the memo field on
  `/send` is kept. It is still probed once at runtime and hidden if the probe fails.
- **`price.usd` is sometimes a JSON string** — 69 of 6470 entries (e.g. `"0.000000384857530589"`).
  Every numeric field goes through `num()`, which coerces strings and rejects `NaN`/`Infinity`/`""`.
- **1500 of 6470 tokens have `metadata.logo = null`**, hence the initials fallback avatar.
- **`getVoteAccounts` and `getClusterNodes` both work**: 4 validators, 0 delinquent.
- **`getRecentPerformanceSamples`** reports ~134 slots / 60 s ≈ **2.23 slots/sec**.
- **`getSignaturesForAddress` works on the DEX program ids** and returns `blockTime`, `err`,
  `confirmationStatus` — enough for the Activity panel without a WebSocket.
- **Native COOK appears in the registry as `wCOOK` / "Wrapped COOK"** at mint
  `So111…112`, with `logo: null`. The UI relabels it to **COOK** for display
  (`displayToken()` in `src/hooks/useMarketData.ts`).
- **The aggregator returns its real reason in an `error` field on non-2xx.** An unfunded owner gives
  `{"error":"Swap simulation failed.\nAccountNotFound"}` with HTTP 422 — mapped to "Not enough COOK
  to pay fees." with a link to `/bridge`.
- **Venue naming differs between feeds**: `/api/markets` uses `"COOKIEBOX DAMM"`, the aggregator
  uses `"cookiebox-damm"`. Route display normalizes the aggregator's form for readability.
- Live venues on the markets feed: COOKIESWAP CPAMM (96), COOKIEBOX DAMM (28), COOKIESWAP SAMM (23),
  COOKIEBOX CLMM (11), METEORA DAMM (2). Note **CPAMM/SAMM** appear, which the brief's program-id
  list does not name, and **BAMM/xYBN own no pools in the markets feed**. They are still polled for
  the Activity panel and do produce transactions — xYBN signatures showed up during testing — so the
  two feeds disagree because they measure different things (pools vs. program activity), not because
  either is wrong.

## Deliberate choices

- **React 18.3 rather than 19.** `@solana/wallet-adapter-react-ui` still declares React 18 peers;
  18.3 avoids `--legacy-peer-deps` on a Vercel install, which is a needless deploy-day risk.
- **A custom wallet button instead of `WalletMultiButton`.** The brief requires the truncated
  address, a copy control, an explorer link and the COOK balance in the header; the stock button
  renders none of that.
- **Transactions are always built as `VersionedTransaction`,** including the plain COOK transfer, so
  `useTransaction` has exactly one sign → simulate → send → confirm path.
- **Simulation runs on the signed transaction with `sigVerify: false`,** which catches program
  errors before broadcast without the simulator rejecting an unsigned message.
- **Route handlers are `force-dynamic`** and set `s-maxage=20, stale-while-revalidate=60`
  themselves, so Vercel's CDN does the caching and a redeploy never serves a stale registry.
- **`server-only`** is imported by `lib/http.ts`, `lib/cookiescan.ts` and `lib/cookiebox.ts`, so a
  stray client import of an upstream URL fails the build rather than shipping to the browser.

## Not verified / open

- **No wallet flow has been executed.** Every signature path is written to be correct by
  construction and typechecked, but Send and Trade have not been run against a funded wallet — that
  is the wallet-test checklist at the end of the README.
- **Rate limits on `rpc.cookiescan.io` / `api.cookiescan.io` are undocumented.** React Query keeps
  the registry at a 20 s `staleTime` / 30 s refetch, health at 15 s, activity at 8 s.
- **The Candy Shop fallback aggregator (`swap.cookiescan.io/api`) is not wired.** Cookiebox answered
  every request during Phase 0, and the brief says to wire the fallback only if Cookiebox is
  unreachable. A clear error is shown instead.
- **`logsSubscribe` over WebSocket is not used.** Polling `getSignaturesForAddress` every 8 s is
  verified working; the WS path was left out rather than shipped half-tested.

## Visual design

The look follows a reference the user supplied (Barly Design's "Nexus — Web3 — Homepage" on
Dribbble): near-black ground, a warm orange radial glow, translucent glass cards, and large display
type with an inline gradient accent phrase.

One deliberate departure. That reference is a **marketing homepage**; five of these six routes are
dense data surfaces, and "analytics, charts, dashboards" is a judged criterion. A hero treatment
applied wholesale would have cost legibility on exactly the screens being judged. So the *visual
language* is applied everywhere — tokens, glass, gradient accent, type scale, radii, themed
scrollbars — while the hero band exists only on `/`, above the dashboard rather than in place of it.
Its four stat chips read from the same React Query caches as the cards below, so it cannot drift out
of sync.

Implementation notes:

- Both palettes are defined explicitly on `:root` and `.light`. No colour is defined only inside a
  media query, so the toggle wins in both directions.
- The ambient glow is a fixed, `pointer-events: none`, negative-z-index layer, with the body marked
  `isolate` so it cannot escape its stacking context.
- `Card` has two variants: `glass` (translucent, blurred) for chrome, and `solid` for dense tables
  where a blurred backdrop hurts readability.
- Fonts are self-hosted through `next/font` (Sora display, Inter UI, JetBrains Mono), so there is no
  render-blocking request to `fonts.googleapis.com` and no layout shift.

## Verification performed

- **19/19 API smoke checks** green against live services (`npm run smoke`).
- **`tsc --noEmit`, `eslint`, `next build`** all clean; all six routes return HTTP 200.
- **Rendered and inspected in-browser** at 400px and 880px, in dark and light: no horizontal page
  scroll (`maxScrollX === 0` at a native 400px viewport), screener reports "92 of 6,470 tokens",
  bCOOK liquidity renders `$3.74K` (it would have been `$0.46` under the brief's COOK assumption),
  and the activity feed lists real signatures from Cookiebox DAMM and Cookieswap xYBN.
- **Not verified:** anything requiring a signature. See the wallet test checklist in the README.
