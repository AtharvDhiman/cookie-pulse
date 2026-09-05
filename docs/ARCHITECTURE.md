# Architecture

Cookie Pulse is a single Next.js 15 App Router app. There is no database, no backend service and no
server-side key material. It reads Cookie Chain and lets the user's own wallet sign.

## The one structural rule

**Third-party HTTP goes through `/api/*`. The chain is talked to directly from the browser.**

```
                 ┌──────────────────────── browser ────────────────────────┐
                 │                                                          │
   Nightly ◄─────┤  wallet-adapter        React Query        pages/         │
   (signs)       │       │                     │              components    │
                 │       │                     │                            │
                 └───────┼─────────────────────┼────────────────────────────┘
                         │                     │
        signed tx        │                     │  fetch('/api/...')
        + reads          │                     ▼
                         │        ┌──────────────────────────┐
                         │        │  Next.js route handlers  │
                         │        │  /api/tokens             │  s-maxage=20
                         │        │  /api/markets            │  swr=60
                         │        │  /api/price/cook         │
                         │        │  /api/quote              │  no-store
                         │        │  /api/swap-tx            │  no-store
                         │        │  /api/das                │
                         │        └───────────┬──────────────┘
                         │                    │
                         ▼                    ▼
              rpc.cookiescan.io      api.cookiescan.io   agg.cookiebox.app
              (JSON-RPC, batched)    (REST + DAS)        (quote, swap-tx)
```

**Why the split.** The Cookiescan REST API and the Cookiebox aggregator do not send permissive CORS
headers and have no caching story of their own, so proxying them gives us CORS immunity, one place
for shared caching, and one place a fallback aggregator could later be wired in. The RPC *is*
browser-callable, and routing chain reads through our own server would only add latency to data that
must be live — so the browser calls it directly, batched.

## Layers

| Path | Role |
| --- | --- |
| `src/lib/config.ts` | Chain constants, program ids, explorer URLs, env-backed endpoints |
| `src/lib/normalize.ts` | `unwrap` / `num` / `str` / `pick` — nothing trusts an upstream shape |
| `src/lib/types.ts` | The normalized shapes the UI is allowed to see |
| `src/lib/http.ts` | Server fetch: timeout, retry-once for GET only, uniform error body |
| `src/lib/cookiescan.ts` | Registry + markets + COOK price → `Token` / `Market` (server only) |
| `src/lib/cookiebox.ts` | Aggregator quote + swap-tx → `Quote` (server only) |
| `src/lib/rpc.ts` | Browser JSON-RPC batching + pure `deriveChainHealth` |
| `src/lib/api.ts` | Browser fetchers for our own `/api/*` |
| `src/lib/format.ts` | Display formatting and exact decimal ⇄ raw conversion |
| `src/lib/errors.ts` | Every failure → one `FriendlyError` the UI can render |
| `src/hooks/*` | React Query wrappers + the transaction state machine |
| `src/components/*` | Presentational, per feature |
| `src/app/*` | Routes and route handlers |

`lib/http.ts`, `lib/cookiescan.ts` and `lib/cookiebox.ts` import `server-only`, so accidentally
importing an upstream URL into a client component fails the build instead of shipping to browsers.

## The transaction path

Both `/send` and `/trade` funnel through `useTransaction`, so error mapping, toasts and disabled
states are written once.

```
  build()                    caller-supplied — the ONLY part that differs
    │                        send:  SystemProgram.transfer / SPL transferChecked (+ memo)
    │                        trade: POST /api/swap-tx → deserialize the unsigned v0 tx
    ▼
  awaiting-signature         wallet.signTransaction        (Nightly)
    ▼
  simulating                 connection.simulateTransaction(signed, {sigVerify:false})
    │                          ↳ err ⇒ throw with .logs attached
    ▼
  sending                    sendRawTransaction(skipPreflight:true, maxRetries:3)
    ▼
  confirming                 confirmTransaction({signature, blockhash, lastValidBlockHeight})
    ▼
  confirmed | failed         one sonner toast, updated in place, + Cookiescan link
```

Three deliberate choices:

1. **Everything is a `VersionedTransaction`,** including the plain COOK transfer. The aggregator
   returns a v0 transaction, so making Send match means one signing path instead of two.
2. **Simulation runs on the *signed* transaction with `sigVerify: false`.** Simulating before
   signing means the simulator rejects the message; simulating after signing with verification off
   surfaces real program errors and their logs while still costing nothing.
3. **A confirm timeout is not reported as failure.** `TransactionExpiredBlockheightExceededError`
   maps to "Took too long to confirm — it may still land", with the signature still linked. Cookie
   Chain finalization stalls are a documented behaviour of this fork; telling a user a transfer
   failed when it is merely slow invites them to send it twice.

## Caching and rate limits

| Data | Where | Freshness |
| --- | --- | --- |
| Token registry (~6.5k, 3.9 MB) | `/api/tokens` | CDN `s-maxage=20`, React Query `staleTime` 20s / refetch 30s |
| Markets | `/api/markets` | same |
| COOK price | carried on the registry response; `/api/price/cook` also proxied | same |
| Chain health | direct RPC, one batch of 8 methods | 15s |
| Activity feed | direct RPC, one batch of 5 `getSignaturesForAddress` | 8s |
| Quotes | `/api/quote`, `no-store` | 400ms debounce, 10s refresh while idle |

Batching is what keeps this cheap: the health strip is one HTTP request for eight RPC methods, and
the activity feed is one request for five programs.

## What is deliberately not here

No charts with history (no historical endpoint exists), no token detail pages, no `.cook` name
resolution, no NFT trading, no liquidity management, no MCP server — all explicitly out of scope.
The Candy Shop fallback aggregator is not wired: Cookiebox answered every Phase 0 request, and a
half-tested fallback is worse than a clear error.
