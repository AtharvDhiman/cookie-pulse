// Chain constants + endpoint config. Every value has a working default, so the app runs with no .env.
// Ported in part from cookie-mcp (MIT) `src/core/config.ts` — see README credits.

/** Browser-facing. Must be inlined at build time, hence the literal `process.env.X` reads. */
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL?.trim() || 'https://rpc.cookiescan.io';
/**
 * The RPC host serves the WebSocket too. The dedicated `wss.` subdomain the brief names presents a
 * certificate for an unrelated domain and never upgrades, which silently costs confirmTransaction
 * its status fallback — measured 0 events against 18-26 in 10 s. See NOTES.md.
 */
export const WS_URL = process.env.NEXT_PUBLIC_WS_URL?.trim() || 'wss://rpc.cookiescan.io';
export const EXPLORER_URL =
  process.env.NEXT_PUBLIC_EXPLORER_URL?.trim().replace(/\/$/, '') || 'https://cookiescan.io';

/**
 * Native COOK. On Solana this exact string is wSOL — on Cookie Chain it is COOK, so never resolve
 * token metadata from the mint alone.
 */
export const COOK_MINT = 'So11111111111111111111111111111111111111112';
export const COOK_DECIMALS = 9;
export const COOK_SYMBOL = 'COOK';

/** COOK on Solana mainnet is a separate Token-2022 mint with 6 decimals (bridge display only). */
export const COOK_SOLANA_MINT = '36ZrtQoab5MhhySaP1YSTwUahSk6GRVUTtZ6cuVfm9e1';
export const COOK_SOLANA_DECIMALS = 6;
export const BRIDGE_URL = 'https://hyperlane.cookiescan.io';
export const HYPERLANE_DOMAINS = { cookie: 420042004, solana: 1399811149 } as const;

/**
 * Accounts the capital map reads, all read-only.
 *
 * `STAKE_POOL_ACCOUNT` is the bCOOK SPL stake pool; most of its balance sits in
 * `STAKE_POOL_RESERVE` undelegated, which is why the two are surfaced separately rather than as one
 * "staked" figure. `BRIDGE_COLLATERAL_PDA` is the Hyperlane warp-route account holding the COOK
 * backing every bridged token on Solana (derivation published in hyperlane-cookies; also used by
 * vendor/cookie-mcp).
 */
export const STAKE_POOL_ACCOUNT = 'GxbNKNYdtNXQkhDkpHdLDAMX64GxaECgANqdfp6cUGH4';
export const STAKE_POOL_RESERVE = 'GAw1vRQ8R3ohDsSgGZV58dc32W7jYhHtc8DzuiVdvm8F';
export const BRIDGE_COLLATERAL_PDA = 'CL2JoQ5jdTpRNKshWhaTihuooT4qrKdLUiPsqKj3yAKz';

export const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const MEMO_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';

/** DEX + launchpad programs, used for venue labels and the Activity feed. */
export const PROGRAMS = [
  { id: 'DAMMjDCEFTDkt7ywazZS8GoaLtjb3HaJo3pLbf64xrPY', label: 'Cookiebox DAMM' },
  { id: 'CLMMmWqTtyNSomqXP3kETJy2SGKPdr31USsm4GfbLyKs', label: 'Cookiebox CLMM' },
  { id: 'WTzkPUoprVx7PDc1tfKA5sS7k1ynCgU89WtwZhksHX5', label: 'Cookieswap BAMM' },
  { id: 'xYBN2zddsqSy41tg1yD9nJScCmqquZnHUyzXBfLEqC8', label: 'Cookieswap xYBN' },
  { id: 'momoL7wu4TrXjnXMLCLzGsbx8Pm7XGgoYo7FVqDoqcw', label: 'MomoSwap' },
] as const;

export const LAMPORTS_PER_COOK = 1_000_000_000;

/**
 * Rent-exempt minimum for a 165-byte token account, read live from Cookie Chain:
 * `getMinimumBalanceForRentExemption(165)` → 2,039,280 lamports.
 */
export const TOKEN_ACCOUNT_RENT_LAMPORTS = 2_039_280;

/**
 * Kept unspent by every MAX button, so a MAX swap cannot clear every client-side check and then die
 * for rent once it is already signed.
 *
 * A Cookiebox swap transaction carries TWO `createIdempotent` associated-token-account instructions
 * — visible in the router's own simulation log (5 Sep 2026) — and each one must be funded to the
 * rent-exempt minimum above even when it turns out to be a no-op. 2 × 2,039,280 + one 5,000 lamport
 * signature fee = 4,083,560 lamports; rounded up so the wallet can still pay for the transaction
 * after this one. 0.001 was the old value and covered the fee alone, which is why a MAX COOK swap
 * could pass here and fail on-chain.
 */
export const FEE_RESERVE_COOK = 0.0051;

export const SLIPPAGE_PRESETS = [50, 100, 300] as const;
export const DEFAULT_SLIPPAGE_BPS = 100;
export const MAX_SLIPPAGE_BPS = 500;

/**
 * Slippage arriving from an untrusted query string or JSON body, for /api/quote and /api/swap-tx
 * alike — the two must never disagree about the same field.
 *
 * Absent, empty and unparseable all mean "the caller did not choose", which is the app's default of
 * 1%. That has to be spelled out because `Number(null)` and `Number('')` are both `0`, which passes
 * `Number.isFinite` and then clamps to the 1 bps floor: /api/quote used to quote a missing field at
 * 0.01% slippage (its `: 100` fallback was unreachable) while /api/swap-tx, where the same absent
 * field reads `Number(undefined)` = NaN, built the transaction at 1%.
 */
export function parseSlippageBps(raw: unknown): number {
  if (raw === null || raw === undefined) return DEFAULT_SLIPPAGE_BPS;
  const text = String(raw).trim();
  if (text === '') return DEFAULT_SLIPPAGE_BPS;
  const n = Number(text);
  if (!Number.isFinite(n)) return DEFAULT_SLIPPAGE_BPS;
  return Math.min(Math.max(Math.round(n), 1), MAX_SLIPPAGE_BPS);
}

/** Basis points as a percentage, without a trailing ".0" on the round ones. */
export const slippageLabel = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;

export const explorerTx = (sig: string) => `${EXPLORER_URL}/tx/${sig}`;
export const explorerAddress = (addr: string) => `${EXPLORER_URL}/address/${addr}`;
export const explorerToken = (mint: string) => `${EXPLORER_URL}/token/${mint}`;

export function venueLabel(programId: string): string {
  return PROGRAMS.find((p) => p.id === programId)?.label ?? 'Unknown';
}

/** Server-only endpoints — read inside route handlers, never shipped to the browser. */
export const serverConfig = {
  cookiescan: () =>
    process.env.COOKIESCAN_API_URL?.trim().replace(/\/$/, '') || 'https://api.cookiescan.io',
  cookiebox: () =>
    process.env.COOKIEBOX_AGG_URL?.trim().replace(/\/$/, '') || 'https://agg.cookiebox.app',
  candyshop: () =>
    process.env.CANDYSHOP_API_URL?.trim().replace(/\/$/, '') || 'https://swap.cookiescan.io/api',
};
