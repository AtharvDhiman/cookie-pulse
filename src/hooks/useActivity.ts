'use client';

// Live DEX activity. Every program is queried in ONE JSON-RPC batch (5 methods, 1 round trip), so
// polling at 8s costs the same as a single request. Verified 5 Sep 2026: getSignaturesForAddress
// works on the Cookie Chain program ids and returns blockTime, err and confirmationStatus.
import { useQuery } from '@tanstack/react-query';
import { PROGRAMS } from '@/lib/config';
import { num, pick, str } from '@/lib/normalize';
import { rpcBatch, type RpcCall } from '@/lib/rpc';

export interface ActivityRow {
  signature: string;
  /** Human venue label, resolved from the batch id rather than re-scanning the tx. */
  venue: string;
  blockTime: number | null;
  slot: number | null;
  err: boolean;
}

/** 8 per program × 5 programs = 40 candidates, trimmed to the newest 25. */
const PER_PROGRAM = 8;
const MAX_ROWS = 25;

const CALLS: RpcCall[] = PROGRAMS.map((p, i) => ({
  id: `sig${i}`,
  method: 'getSignaturesForAddress',
  params: [p.id, { limit: PER_PROGRAM }],
}));

export async function fetchActivity(signal?: AbortSignal): Promise<ActivityRow[]> {
  const map = await rpcBatch(CALLS, signal);
  const rows: ActivityRow[] = [];
  const seen = new Set<string>();
  let answered = 0;

  PROGRAMS.forEach((program, i) => {
    const res = map.get(`sig${i}`);
    // A program with no signatures, or one whose call returned an RPC-level error, must not blank
    // the whole feed — skip it and keep the venues that did answer.
    if (!res || res.error || !Array.isArray(res.result)) return;
    answered += 1;

    for (const item of res.result as unknown[]) {
      const signature = str(pick(item, ['signature']));
      if (!signature || seen.has(signature)) continue;
      seen.add(signature);
      rows.push({
        signature,
        venue: program.label,
        blockTime: num(pick(item, ['blockTime'])),
        slot: num(pick(item, ['slot'])),
        // `err` is null on success and an object describing the failure otherwise.
        err: pick(item, ['err']) != null,
      });
    }
  });

  // Not one program answering is an RPC failure, not an idle chain (a batch the node rejects
  // outright yields an empty map, and JSON-RPC errors arrive with HTTP 200). Throw so the panel
  // shows the error instead of claiming "no recent DEX activity".
  if (answered === 0) {
    const failure = CALLS.map((c) => map.get(c.id)?.error?.message).find(Boolean);
    throw new Error(failure ?? 'The Cookie Chain RPC returned no signatures for any tracked program.');
  }

  // Newest first. Signatures still missing a blockTime sink to the bottom rather than jumping.
  rows.sort((a, b) => (b.blockTime ?? 0) - (a.blockTime ?? 0));
  return rows.slice(0, MAX_ROWS);
}

export function useActivity() {
  return useQuery({
    queryKey: ['activity'],
    queryFn: ({ signal }) => fetchActivity(signal),
    refetchInterval: 8_000,
    staleTime: 5_000,
    retry: 1,
  });
}
