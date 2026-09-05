// Browser-side JSON-RPC. The browser talks to the Cookie Chain RPC directly (only third-party HTTP
// APIs are proxied through /api/*), so chain reads stay live and uncached.
// Health derivation ported from cookie-mcp (MIT) `src/core/health.ts`.
import { RPC_URL } from './config';
import { num, pick } from './normalize';
import type { ChainHealth, HealthStatus, PerfWindow } from './types';

export const FINALIZATION_WARN_SLOTS = 150;
export const FINALIZATION_STALL_SLOTS = 1000;

export interface RpcCall {
  id: string;
  method: string;
  params?: unknown[];
}

export interface RpcRes {
  id: string;
  result?: unknown;
  error?: { code: number; message: string };
}

/**
 * One HTTP round trip for N methods. Cookie Chain accepts standard JSON-RPC batches, which is what
 * keeps the health strip to a single request every 15s.
 */
export async function rpcBatch(calls: RpcCall[], signal?: AbortSignal): Promise<Map<string, RpcRes>> {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      calls.map((c) => ({ jsonrpc: '2.0', id: c.id, method: c.method, params: c.params ?? [] })),
    ),
    signal,
  });
  if (!res.ok) throw new Error(`RPC batch failed (HTTP ${res.status})`);
  const json: unknown = await res.json();
  const list = Array.isArray(json) ? json : [json];
  const map = new Map<string, RpcRes>();
  for (const item of list) {
    const id = pick(item, ['id']);
    if (typeof id === 'string') map.set(id, item as RpcRes);
  }
  return map;
}

/** Single JSON-RPC call. Throws on transport failure or an RPC-level error. */
export async function rpcCall<T>(method: string, params: unknown[] = [], signal?: AbortSignal): Promise<T> {
  const map = await rpcBatch([{ id: 'a', method, params }], signal);
  const r = map.get('a');
  if (r?.error) throw new Error(`${method}: ${r.error.message}`);
  return r?.result as T;
}

/**
 * The raw `getSignatureStatuses` entry for one signature, or null if the node has never seen it.
 * `searchTransactionHistory` is what makes a late answer possible at all: without it the node only
 * replies from its recent-status cache, which a slow confirmation has already fallen out of.
 */
export async function fetchSignatureStatus(
  signature: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const res = await rpcCall<{ value?: unknown[] } | null>(
    'getSignatureStatuses',
    [[signature], { searchTransactionHistory: true }],
    signal,
  );
  const value = res?.value;
  // An array is the node answering: `value[0]` is the record, or null for "no record", and null
  // there is real evidence. Anything else means we did not understand the reply — which must throw
  // rather than collapse into that same null, because the caller treats a no-record answer as a
  // step towards telling the user their transaction never landed.
  if (!Array.isArray(value)) {
    throw new Error('getSignatureStatuses: unexpected response shape');
  }
  return value[0] ?? null;
}

/** Whether a blockhash can still be used. null when the node did not answer with a boolean. */
export async function fetchBlockhashValid(
  blockhash: string,
  signal?: AbortSignal,
): Promise<boolean | null> {
  const res = await rpcCall<{ value?: unknown } | null>(
    'isBlockhashValid',
    [blockhash, { commitment: 'processed' }],
    signal,
  );
  return typeof res?.value === 'boolean' ? res.value : null;
}

/** Minutes of performance history asked for. 60 samples measured 6.2 KB — one request, still. */
export const PERF_SAMPLE_MINUTES = 60;

export const HEALTH_CALLS: RpcCall[] = [
  { id: 'health', method: 'getHealth' },
  { id: 'epoch', method: 'getEpochInfo' },
  { id: 'processed', method: 'getSlot', params: [{ commitment: 'processed' }] },
  { id: 'confirmed', method: 'getSlot', params: [{ commitment: 'confirmed' }] },
  { id: 'finalized', method: 'getSlot', params: [{ commitment: 'finalized' }] },
  { id: 'version', method: 'getVersion' },
  // The window the sparklines and the non-vote TPS figure are derived from. Asking for 60 instead
  // of 1 costs nothing extra: it is the same call in the same batch, ~4 KB larger.
  { id: 'perf', method: 'getRecentPerformanceSamples', params: [PERF_SAMPLE_MINUTES] },
  { id: 'votes', method: 'getVoteAccounts', params: [{ commitment: 'confirmed' }] },
  // Rides the health tick so the capital map costs no round trip of its own.
  // `excludeNonCirculatingAccountsList` matters more than it looks: by default this call ships the
  // full list of non-circulating addresses — 214 of them, 10 KB, more than half the whole batch —
  // and only `value.total` is ever read. Excluding it takes the tick from 18.3 KB to ~8.3 KB.
  {
    id: 'supply',
    method: 'getSupply',
    params: [{ commitment: 'confirmed', excludeNonCirculatingAccountsList: true }],
  },
];

const slotOf = (m: Map<string, RpcRes>, id: string) => num(m.get(id)?.result);

/**
 * Pure. Folds the performance samples into the window the UI charts.
 *
 * `getRecentPerformanceSamples` answers newest-first, so the series are reversed: a sparkline that
 * reads right-to-left would silently invert every trend on the page.
 */
export function derivePerfWindow(rawSamples: unknown): PerfWindow {
  const empty: PerfWindow = {
    minutes: 0,
    slotsPerSec: [],
    nonVotePerMinute: [],
    nonVoteTps: null,
    totalTps: null,
    zeroActivityMinutes: 0,
  };
  if (!Array.isArray(rawSamples) || rawSamples.length === 0) return empty;

  const slotsPerSec: number[] = [];
  const nonVotePerMinute: number[] = [];
  let totalSeconds = 0;
  let totalTx = 0;
  let totalNonVote = 0;
  let zeroActivityMinutes = 0;

  // Oldest first.
  for (let i = rawSamples.length - 1; i >= 0; i--) {
    const s = rawSamples[i];
    const period = num(pick(s, ['samplePeriodSecs']));
    if (period === null || period <= 0) continue;

    const numSlots = num(pick(s, ['numSlots'])) ?? 0;
    const numTx = num(pick(s, ['numTransactions'])) ?? 0;
    // Absent on older node builds; treated as unknown-but-not-negative rather than as zero activity.
    const nonVote = num(pick(s, ['numNonVoteTransactions']));

    slotsPerSec.push(numSlots / period);
    nonVotePerMinute.push(nonVote ?? 0);
    if (nonVote === 0) zeroActivityMinutes += 1;

    totalSeconds += period;
    totalTx += numTx;
    totalNonVote += nonVote ?? 0;
  }

  if (totalSeconds <= 0) return empty;
  return {
    minutes: slotsPerSec.length,
    slotsPerSec,
    nonVotePerMinute,
    nonVoteTps: totalNonVote / totalSeconds,
    totalTps: totalTx / totalSeconds,
    zeroActivityMinutes,
  };
}

/** Pure: derives the health snapshot from a batch response, so it is testable without a network. */
export function deriveChainHealth(map: Map<string, RpcRes>, latencyMs: number): ChainHealth {
  const healthRes = map.get('health');
  const rpcHealthy = healthRes?.result === 'ok' && !healthRes.error;

  const slots = {
    processed: slotOf(map, 'processed'),
    confirmed: slotOf(map, 'confirmed'),
    finalized: slotOf(map, 'finalized'),
  };
  const finalizationLag =
    slots.processed !== null && slots.finalized !== null ? slots.processed - slots.finalized : null;

  const epochRes = map.get('epoch')?.result;
  const slotIndex = num(pick(epochRes, ['slotIndex']));
  const slotsInEpoch = num(pick(epochRes, ['slotsInEpoch']));
  const epochProgressPct =
    slotIndex !== null && slotsInEpoch !== null && slotsInEpoch > 0
      ? Math.round((slotIndex / slotsInEpoch) * 1000) / 10
      : null;

  const version = pick(map.get('version')?.result, ['solana-core']);
  const perf = derivePerfWindow(map.get('perf')?.result);
  // The headline rate stays the most recent minute, not the window mean: it is a "right now" figure.
  const latest = perf.slotsPerSec.length > 0 ? perf.slotsPerSec[perf.slotsPerSec.length - 1] : null;
  const slotsPerSec = latest === null ? null : Math.round(latest * 100) / 100;

  // Epoch ETA from the measured slot rate over the whole window — steadier than one minute, and
  // still only ever presented as approximate.
  const meanSlotsPerSec =
    perf.slotsPerSec.length > 0
      ? perf.slotsPerSec.reduce((a, b) => a + b, 0) / perf.slotsPerSec.length
      : null;
  const epochEtaSeconds =
    slotIndex !== null && slotsInEpoch !== null && meanSlotsPerSec !== null && meanSlotsPerSec > 0
      ? Math.max(0, Math.round((slotsInEpoch - slotIndex) / meanSlotsPerSec))
      : null;

  const votes = map.get('votes')?.result;
  const current = pick(votes, ['current']);
  const delinquent = pick(votes, ['delinquent']);
  // Only the count was read before; the same payload also carries what is actually delegated.
  const activatedStakeLamports = Array.isArray(current)
    ? current.reduce((sum: number, v: unknown) => sum + (num(pick(v, ['activatedStake'])) ?? 0), 0)
    : null;

  const supplyLamports = num(pick(map.get('supply')?.result, ['value', 'total']));

  // A finalization stall is degraded, not down: blocks are still being produced.
  let status: HealthStatus = 'operational';
  let note: string | null = null;
  if (!rpcHealthy) {
    status = 'down';
    note = 'RPC getHealth did not return ok.';
  } else if (finalizationLag !== null && finalizationLag >= FINALIZATION_STALL_SLOTS) {
    status = 'degraded';
    note = `Finalization stalled (${finalizationLag} slots behind). Confirmations may be slow.`;
  } else if (finalizationLag !== null && finalizationLag >= FINALIZATION_WARN_SLOTS) {
    status = 'degraded';
    note = `Finalization lag elevated (${finalizationLag} slots).`;
  }

  return {
    status,
    slots,
    finalizationLag,
    epoch: num(pick(epochRes, ['epoch'])),
    epochProgressPct,
    epochEtaSeconds,
    blockHeight: num(pick(epochRes, ['blockHeight'])),
    version: typeof version === 'string' ? version : null,
    slotsPerSec,
    validatorCount: Array.isArray(current) ? current.length : null,
    delinquentCount: Array.isArray(delinquent) ? delinquent.length : null,
    latencyMs: Math.round(latencyMs),
    note,
    perf,
    supplyLamports,
    activatedStakeLamports,
  };
}

export async function fetchChainHealth(signal?: AbortSignal): Promise<ChainHealth> {
  const start = performance.now();
  const map = await rpcBatch(HEALTH_CALLS, signal);
  return deriveChainHealth(map, performance.now() - start);
}
