# Cookie Pulse — build brief

You are building **Cookie Pulse**, an analytics + trade terminal web app for **Cookie Chain** (a Solana-compatible SVM L1). It is my submission for a Superteam Earn bounty with a hard 4-day build window. The bounty is judged on: Nightly wallet support, real on-chain transactions with clear status feedback, analytics/dashboards, and use of the Cookie ecosystem (Cookiebox, Cookiescan API, cookie-mcp).

Work autonomously through every phase below **without stopping to ask questions**. When something is ambiguous, make the most reasonable choice, write it down in `NOTES.md`, and keep going. Commit after each phase. I will test wallet flows myself with a real Nightly wallet, so your job is to make everything that does not need a signature verifiably correct, and everything that does need a signature obviously correct by construction.

---

## 1. Chain facts (verified 4 Sep 2026)

- RPC `https://rpc.cookiescan.io` · WebSocket `wss://wss.cookiescan.io`
- Explorer `https://cookiescan.io` — tx `/tx/<sig>`, address `/address/<addr>`, token `/token/<mint>`
- Native token **COOK**, 9 decimals. Native/wrapped mint id is `So11111111111111111111111111111111111111112` — the SAME string as wSOL on Solana. On Cookie Chain it is COOK; never resolve metadata by mint alone.
- Fees ≈ 0.000005 COOK per signature. **Mainnet only.** No devnet, no faucet. Every test is a real (tiny) transaction from the user's wallet.
- Bridge Solana ⇄ Cookie: `https://hyperlane.cookiescan.io`. COOK on Solana is a Token-2022 mint `36ZrtQoab5MhhySaP1YSTwUahSk6GRVUTtZ6cuVfm9e1` (6 decimals).
- Standard Solana tooling works unchanged (`@solana/web3.js` v1, `@solana/spl-token`, wallet-adapter). **Nightly** is the required wallet: it supports Wallet Standard (auto-detected) and also has `@solana/wallet-adapter-nightly`.
- Hyperlane domain ids: Cookie `420042004`, Solana `1399811149` (display only).

## 2. Public APIs (no auth)

**Cookiescan REST**
- `GET https://api.cookiescan.io/api/tokens` → token registry (~6k). Each item: `{ mint, metadata{name,symbol,logo,decimals,description}, price{usd,native,change24h}, marketData{volume24h,volumeChange24h,liquidity,marketCap,supply,holderCount}, lastUpdated }`. May be a bare array or wrapped as `{data:[...]}` / `{tokens:[...]}` — unwrap defensively. `marketData.liquidity` is in **COOK, not USD**.
- `GET https://api.cookiescan.io/api/markets` → pools. Each: `{ marketId, type (venue label e.g. "COOKIEBOX DAMM"), baseToken{mint,symbol,amount,priceUsd}, quoteToken{...}, liquidityUsd, liquidityDisplay }`. Same unwrap rule (`data` / `markets`).
- `GET https://api.cookiescan.io/api/price/cook` → `{ data: { price: { usd } } }`.

**DAS JSON-RPC** (Metaplex DAS spec): `POST https://api.cookiescan.io` with `getAssetsByOwner`, `getAsset`, `searchAssets`.

**Cookiebox swap aggregator** (same router as cookiebox.app):
- `GET https://agg.cookiebox.app/quote?inputMint=&outputMint=&amount=<raw base units>&slippageBps=&owner=` → `{ route: { inAmount, outAmount, feePct, feeAmount, netOutAmount, minOutAmount, priceImpactPct|null, path[], isSplit, isMultiHop, segments[{pool,venue,inputMint,outputMint,inAmount,outAmount,percentage?,hopIndex}] } }`. HTTP 404 = no route.
- `POST https://agg.cookiebox.app/swap-tx` body `{inputMint,outputMint,amount,slippageBps,owner}` → `{ transactionBase64, blockhash, lastValidBlockHeight, route }`. `transactionBase64` is an **unsigned v0 transaction with feePayer = owner**. Use a 60s timeout.
- Fallback aggregator (Candy Shop): base `https://swap.cookiescan.io/api` — only wire it if the Cookiebox agg is unreachable; otherwise just show a clear error.

**Program ids** (labels + activity feed):
- Cookiebox DAMM `DAMMjDCEFTDkt7ywazZS8GoaLtjb3HaJo3pLbf64xrPY`
- Cookiebox CLMM `CLMMmWqTtyNSomqXP3kETJy2SGKPdr31USsm4GfbLyKs`
- Cookieswap BAMM `WTzkPUoprVx7PDc1tfKA5sS7k1ynCgU89WtwZhksHX5`
- Cookieswap xYBN `xYBN2zddsqSy41tg1yD9nJScCmqquZnHUyzXBfLEqC8`
- MomoSwap launchpad `momoL7wu4TrXjnXMLCLzGsbx8Pm7XGgoYo7FVqDoqcw`
- SPL Token `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` · Token-2022 `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`
- Memo `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr` — **may not exist on Cookie Chain.** Check with `getAccountInfo` once at startup (cache it); hide the memo field if it is missing.

**Reference implementation (MIT):** `./vendor/cookie-mcp` is a read-only clone of https://github.com/cookiechain/cookie-mcp. Before writing any API client, read `src/core/config.ts`, `cookiebox.ts`, `cookiescan.ts`, `balances.ts`, `pools.ts`, `health.ts`, `confirm.ts` and port that logic (unwrap rules, unit handling, timeouts). Credit cookie-mcp in the README. If `./vendor/cookie-mcp` is missing, clone it there first.

## 3. Stack (do not deviate)

- Next.js 15 (App Router) · TypeScript strict · Tailwind · `@solana/web3.js@1` · `@solana/spl-token` · `@solana/wallet-adapter-react`, `-react-ui`, `-base`, `-nightly` · `@tanstack/react-query` · `sonner` for toasts · `lucide-react` icons. No chart library unless a chart is actually rendered; if you add one, use `recharts`.
- Deploy target: Vercel. Node 20+.
- **All third-party HTTP calls go through Next.js route handlers under `/api/*`** (avoids CORS, adds caching, one place for fallbacks). Route handlers set `Cache-Control: s-maxage=20, stale-while-revalidate=60` for registry/markets/price and no cache for quotes. The browser talks to the RPC and WebSocket directly.
- No private keys anywhere, ever. The wallet signs in the browser.
- Env vars (with `.env.example`): `NEXT_PUBLIC_RPC_URL`, `NEXT_PUBLIC_WS_URL`, `COOKIESCAN_API_URL`, `COOKIEBOX_AGG_URL`, `CANDYSHOP_API_URL`, `NEXT_PUBLIC_EXPLORER_URL`. Defaults = the values above.

## 4. Scope — exactly this, nothing more

Six routes. Every one must work on the deployed URL.

1. **`/` Overview** — chain health strip from ONE batched JSON-RPC request (`getHealth`, `getEpochInfo`, `getSlot` at processed/confirmed/finalized, `getVersion`, `getRecentPerformanceSamples[1]`, `getVoteAccounts`) → status pill operational / degraded / down, slots per second, finalization lag (processed − finalized), validator count (+ delinquent), RPC latency ms; auto-refresh every 15s. COOK price with 24h change. Three tiles: top gainers, top losers, top volume (from the registry; ignore tokens with no price). Total TVL (sum of `liquidityUsd` across markets) and pool count. Link cards to the Screener.
2. **`/screener`** — table of all tokens with price, 24h %, 24h volume, liquidity USD (`liquidity × COOK price`), market cap, holders; logo with fallback initials; search by name / symbol / mint; sortable columns; click-to-copy mint; Cookiescan link; "Trade" button that opens `/trade?in=<COOK>&out=<mint>`. Virtualize or paginate (50 per page) — the registry is ~6k rows. Hide tokens with no price by default with a toggle to show all.
3. **`/portfolio`** (wallet required; shows a connect prompt otherwise) — COOK balance, all SPL **and** Token-2022 balances (`getParsedTokenAccountsByOwner` for both program ids), each priced via the registry, total USD; NFTs via DAS `getAssetsByOwner` (grid of image + name; skip silently if the call fails); last 20 transactions via `getSignaturesForAddress` + `getParsedTransactions` showing time, status, fee, and explorer link. Refresh button + auto-refresh after any of our own transactions confirms.
4. **`/send`** — send COOK (`SystemProgram.transfer`) or any token the wallet holds (`createAssociatedTokenAccountIdempotentInstruction` for the recipient using the correct token program id, then `createTransferCheckedInstruction`) to an address, with optional memo. Validate address, amount ≤ balance, reserve 0.001 COOK for fees. Uses the shared transaction hook.
5. **`/trade`** — swap panel: token pickers (search the registry, COOK pinned at top), amount with MAX, slippage chips 0.5 / 1 / 3 % (default 1%, hard cap 5%), debounced quote (400ms) refreshed every 10s while idle, route display (venues, hops, split %), price impact, min received, fee. Swap: `POST /api/swap-tx` → `VersionedTransaction.deserialize(Buffer.from(base64,'base64'))` → `wallet.signTransaction` → `connection.simulateTransaction(tx, {sigVerify:false})` and surface `err`/logs → `sendRawTransaction(serialized, {skipPreflight:true, maxRetries:3})` → `confirmTransaction({signature, blockhash, lastValidBlockHeight}, 'confirmed')` → refresh balances. Pre-fill from `?in=&out=`.
6. **`/bridge`** — "How to get COOK" guide in 4 steps (buy SOL → swap SOL to COOK on jup.ag using the Solana mint above → bridge at hyperlane.cookiescan.io → add Cookie Chain RPC in Nightly: RPC `https://rpc.cookiescan.io`, WS `wss://wss.cookiescan.io`), with a copy button on each value. Whenever a connected wallet has 0 COOK, show a banner on every page linking here.

Plus one lightweight **Activity** panel on `/` (not a separate route): last 25 transactions across the DEX program ids via `getSignaturesForAddress` polled every 8s, showing venue label, signature link, age, and success/fail. If you can add `logsSubscribe` over the WS with a clean fallback to polling in under an hour, do it; otherwise polling only.

**Explicitly out of scope:** token detail pages, charts with history, .cook name resolution, MCP server, NFT trading, launchpad, liquidity management, i18n, auth, analytics scripts. Do not build them.

## 5. Transaction UX (non-negotiable)

One `useTransaction` hook used by Send and Trade. States: `idle → building → awaiting-signature → sending → confirming → confirmed | failed`. One toast that updates through the states (sonner `toast.loading` → `toast.success` / `toast.error`); the success toast shows the truncated signature and a **View on Cookiescan** link. Map errors to plain language:

- user rejected in wallet → "Transaction cancelled in Nightly."
- insufficient COOK for fees / rent → "Not enough COOK to pay fees." + link to `/bridge`
- slippage / `0x1771` style custom errors from the aggregator → "Price moved more than your slippage. Try 3%."
- blockhash expired / `TransactionExpiredBlockheightExceededError` → "Took too long to confirm. Try again." + retry button
- simulation failure → "Simulation failed." with a collapsible log panel
- network / fetch errors → "Cookie Chain RPC is not responding. Retrying in 5s."

Buttons disabled and showing the state while pending. Header always shows: wallet button (Nightly listed first in the modal), truncated address with copy + explorer link, COOK balance, and a green/amber/red chain-status dot.

## 6. Quality bar

- Responsive down to 360px; dark theme by default with a light toggle; skeleton loaders; empty states; error boundaries per route; keyboard focus visible.
- Small components, no `any`, no dead code, no lorem ipsum. Use real token data everywhere.
- Robust parsing: every API response goes through a small `zod`-free normalizer (`unwrap(json, ['data','tokens'])` etc.) that tolerates shape changes; numbers coerced with `Number()` and `Number.isFinite` guards.
- Rate limits: React Query `staleTime` 15–30s for registry/markets/price, 10s for quotes; batch RPC where possible; one WS subscription max.

## 7. Files to produce besides the app

- `README.md`: one-liner + live URL placeholder, screenshots placeholders (`docs/screenshots/*.png`), features table mapping each bounty requirement to a route, architecture diagram (ASCII is fine), run locally, **Add Cookie Chain to Nightly** steps, **Get COOK** steps, addresses (program ids, API endpoints), credits (cookie-mcp MIT, Cookiescan, Cookiebox), MIT license.
- `LICENSE` (MIT), `.env.example`, `NOTES.md` (assumptions + anything you could not verify), `docs/ARCHITECTURE.md` (short).
- `scripts/smoke.ts`: hits every `/api/*` route against a running dev server and prints shape checks (token count > 0, markets count, COOK price is a number, a COOK→top-volume-token quote returns a route). I will run it.

## 8. Phases — run them all back to back

**Phase 0 — verify before coding (15 min).** `curl` the three Cookiescan endpoints and one `/quote` (COOK → the highest-volume non-COOK token, amount `100000000`, slippageBps `100`), and `getAccountInfo` for the Memo program via the RPC. Record the actual response shapes in `NOTES.md` and adapt the normalizers to what you saw. If an endpoint is down, code against the documented shape and note it.

**Phase 1 — skeleton.** Scaffold, Tailwind theme, layout with header/nav, wallet provider (Nightly first, Wallet Standard autodetect on), header address + balance + status dot, `/api/*` route handlers, `/bridge` page, 0-COOK banner. `npm run build` must pass. Commit.

**Phase 2 — read-only data.** `/` Overview (health strip, price, tiles, TVL, Activity panel) and `/screener`. Commit.

**Phase 3 — transactions.** `useTransaction` hook, `/send`, `/portfolio`. Commit.

**Phase 4 — trade.** `/trade` with quote + swap flow. Commit.

**Phase 5 — finish.** README, LICENSE, NOTES, ARCHITECTURE, smoke script, `.env.example`, `vercel.json` if needed, responsive pass, dark/light pass, `npm run lint && npm run build` clean. Commit and print a final checklist of what I must test with the wallet.

Start now. First print the file tree you will create (one screen), then execute Phase 0.
