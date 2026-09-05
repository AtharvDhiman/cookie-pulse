// Browser-side JSON-RPC. The browser talks to the Cookie Chain RPC directly (only third-party HTTP
// APIs are proxied through /api/*), so chain reads stay live and uncached.
// Health derivation ported from cookie-mcp (MIT) `src/core/health.ts`.
import { RPC_URL } from './config';
import { num, pick } from './normalize';
import type { ChainHealth, HealthStatus } from './types';

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

export const HEALTH_CALLS: RpcCall[] = [
  { id: 'health', method: 'getHealth' },
  { id: 'epoch', method: 'getEpochInfo' },
  { id: 'processed', method: 'getSlot', params: [{ commitment: 'processed' }] },
  { id: 'confirmed', method: 'getSlot', params: [{ commitment: 'confirmed' }] },
  { id: 'finalized', method: 'getSlot', params: [{ commitment: 'finalized' }] },
  { id: 'version', method: 'getVersion' },
  { id: 'perf', method: 'getRecentPerformanceSamples', params: [1] },
  { id: 'votes', method: 'getVoteAccounts', params: [{ commitment: 'confirmed' }] },
];

const slotOf = (m: Map<string, RpcRes>, id: string) => num(m.get(id)?.result);

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
  const perf = Array.isArray(map.get('perf')?.result)
    ? (map.get('perf')!.result as unknown[])[0]
    : undefined;
  const numSlots = num(pick(perf, ['numSlots']));
  const samplePeriodSecs = num(pick(perf, ['samplePeriodSecs']));
  const slotsPerSec =
    numSlots !== null && samplePeriodSecs !== null && samplePeriodSecs > 0
      ? Math.round((numSlots / samplePeriodSecs) * 100) / 100
      : null;

  const votes = map.get('votes')?.result;
  const current = pick(votes, ['current']);
  const delinquent = pick(votes, ['delinquent']);

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
    blockHeight: num(pick(epochRes, ['blockHeight'])),
    version: typeof version === 'string' ? version : null,
    slotsPerSec,
    validatorCount: Array.isArray(current) ? current.length : null,
    delinquentCount: Array.isArray(delinquent) ? delinquent.length : null,
    latencyMs: Math.round(latencyMs),
    note,
  };
}

export async function fetchChainHealth(signal?: AbortSignal): Promise<ChainHealth> {
  const start = performance.now();
  const map = await rpcBatch(HEALTH_CALLS, signal);
  return deriveChainHealth(map, performance.now() - start);
}
