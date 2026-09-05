// Normalized shapes. Everything the UI touches is already coerced — no strings-that-are-numbers,
// no optional chains three levels deep.

export interface Token {
  mint: string;
  name: string;
  symbol: string;
  logo: string | null;
  decimals: number;
  description: string | null;
  priceUsd: number | null;
  priceNative: number | null;
  change24h: number | null;
  volume24h: number;
  /** USD. Verified 4 Sep 2026 against the markets feed — see NOTES.md. */
  liquidityUsd: number;
  marketCap: number;
  supply: number;
  holderCount: number;
}

/**
 * How `/api/tokens` projected the rows it returned. `priced` is the default: the mints that carry a
 * USD price, which is every mint with liquidity on this chain. `full` is the whole registry, ~2.7 MB.
 */
export type RegistryView = 'priced' | 'full';

export interface TokenRegistry {
  /** Projected per `view` — never the denominator for anything. */
  tokens: Token[];
  cookUsd: number | null;
  /** Every entry upstream lists, including the rows this view projected away. Both views agree. */
  count: number;
  /** Of the whole registry, the mints that are not single-edition NFTs. Both views agree. */
  fungibleCount: number;
  /** Of the whole registry, the single-edition NFTs. Both views agree. */
  nftLikeCount: number;
  view: RegistryView;
}

export interface Market {
  marketId: string;
  venue: string;
  base: { mint: string; symbol: string | null; amount: number | null; priceUsd: number | null };
  quote: { mint: string; symbol: string | null; amount: number | null; priceUsd: number | null };
  liquidityUsd: number;
  liquidityDisplay: string | null;
}

export interface MarketsSnapshot {
  markets: Market[];
  tvlUsd: number;
  poolCount: number;
  venues: { venue: string; poolCount: number; tvlUsd: number }[];
}

export interface RouteSegment {
  pool: string;
  venue: string;
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  percentage: number | null;
  hopIndex: number;
}

export interface Quote {
  inAmount: string;
  outAmount: string;
  netOutAmount: string;
  minOutAmount: string;
  feePct: number;
  feeAmount: string;
  /** null when the router could not measure it — render "—", never a lying 0. */
  priceImpactPct: number | null;
  path: string[];
  isSplit: boolean;
  isMultiHop: boolean;
  segments: RouteSegment[];
}

export interface SwapTxResponse {
  transactionBase64: string;
  blockhash: string;
  lastValidBlockHeight: number;
  route: Quote | null;
}

export type HealthStatus = 'operational' | 'degraded' | 'down';

export interface ChainHealth {
  status: HealthStatus;
  slots: { processed: number | null; confirmed: number | null; finalized: number | null };
  finalizationLag: number | null;
  epoch: number | null;
  epochProgressPct: number | null;
  /** Seconds until the epoch ends, from the measured slot rate. Approximate by construction. */
  epochEtaSeconds: number | null;
  blockHeight: number | null;
  version: string | null;
  slotsPerSec: number | null;
  validatorCount: number | null;
  delinquentCount: number | null;
  latencyMs: number;
  note: string | null;
  /** The rolling performance window, oldest first, one entry per sample minute. */
  perf: PerfWindow;
  /** From getSupply, which rides the same batched health request. */
  supplyLamports: number | null;
  /** Summed getVoteAccounts activatedStake — stake actually delegated, not stake-pool reserve. */
  activatedStakeLamports: number | null;
}

/**
 * Derived from getRecentPerformanceSamples. Non-vote throughput is separated from total because
 * this chain is overwhelmingly consensus votes: total TPS reads ~8.9 while actual user activity is
 * two orders of magnitude below it, and reporting only the total would flatter the chain.
 */
export interface PerfWindow {
  /** Minutes covered — the node caps the window, so this is not assumed to be 60. */
  minutes: number;
  slotsPerSec: number[];
  nonVotePerMinute: number[];
  /** Mean over the window, transactions per second. */
  nonVoteTps: number | null;
  totalTps: number | null;
  /** Minutes in the window with exactly zero non-vote transactions. Computed, never assumed. */
  zeroActivityMinutes: number;
}

/** One location COOK sits, for the capital map. `lamports` null = the source did not answer. */
export interface CapitalBucket {
  key: string;
  label: string;
  /** Names the on-chain source, and any caveat the label itself must not overstate. */
  detail: string;
  lamports: number | null;
}

export interface CapitalSnapshot {
  supplyLamports: number | null;
  buckets: CapitalBucket[];
  cookUsd: number | null;
  dexTvlUsd: number | null;
}

export interface TokenBalance {
  mint: string;
  amount: number;
  rawAmount: string;
  decimals: number;
  programId: string;
  token: Token | null;
  valueUsd: number | null;
}

export interface WalletNft {
  id: string;
  name: string;
  image: string | null;
  collection: string | null;
}

export interface TxRow {
  signature: string;
  blockTime: number | null;
  slot: number;
  err: boolean;
  feeCook: number | null;
  label: string | null;
}
