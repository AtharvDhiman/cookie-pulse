// Chain constants + endpoint config. Every value has a working default, so the app runs with no .env.
// Ported in part from cookie-mcp (MIT) `src/core/config.ts` — see README credits.

/** Browser-facing. Must be inlined at build time, hence the literal `process.env.X` reads. */
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL?.trim() || 'https://rpc.cookiescan.io';
export const WS_URL = process.env.NEXT_PUBLIC_WS_URL?.trim() || 'wss://wss.cookiescan.io';
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

/** Keep ~0.001 COOK unspent so a follow-up transaction can still pay its fee. */
export const FEE_RESERVE_COOK = 0.001;
export const LAMPORTS_PER_COOK = 1_000_000_000;

export const SLIPPAGE_PRESETS = [50, 100, 300] as const;
export const DEFAULT_SLIPPAGE_BPS = 100;
export const MAX_SLIPPAGE_BPS = 500;

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
