'use client';

// One batched on-chain read of every priced mint, cached for the life of the tab.
//
// Mint authorities and transfer fees change on the order of never, so this uses the same effectively
// infinite staleTime as `useMemoProgram` rather than riding the registry's 30s tick — otherwise a
// page that idles for an hour would re-read 92 accounts 120 times for an answer that did not move.
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { rpcBatch } from '@/lib/rpc';
import { pick } from '@/lib/normalize';
import {
  chunkMints,
  parseMintAccount,
  type MintAudit,
  type MintFacts,
} from '@/lib/mintSafety';
import { useRegistry } from './useMarketData';

async function fetchMintAudit(mints: string[], signal?: AbortSignal): Promise<MintAudit> {
  const chunks = chunkMints(mints);
  // Every chunk goes in ONE JSON-RPC batch, so 92 mints is a single HTTP request, not 92.
  const map = await rpcBatch(
    chunks.map((c, i) => ({
      id: `m${i}`,
      method: 'getMultipleAccounts',
      params: [c, { encoding: 'jsonParsed' }],
    })),
    signal,
  );

  const byMint = new Map<string, MintFacts>();
  const missing: string[] = [];

  chunks.forEach((chunk, i) => {
    const res = map.get(`m${i}`);
    // An RPC-level error is information about the RPC, not about the mints — those stay unaudited
    // rather than being reported as having no account, which would be a claim about the chain.
    if (!res || res.error) return;
    const values = pick(res.result, ['value']);
    if (!Array.isArray(values)) return;
    chunk.forEach((mint, j) => {
      const facts = parseMintAccount(mint, values[j]);
      if (facts) byMint.set(mint, facts);
      else missing.push(mint);
    });
  });

  return { byMint, missing, disagreements: [], checked: byMint.size + missing.length };
}

/**
 * The audit, plus the registry cross-check.
 *
 * The cross-check is worth surfacing on its own: it is the evidence that the registry's metadata and
 * the chain agree, which is what makes the rest of the app's numbers trustworthy. When they disagree
 * the chain wins and the disagreement is reported, never quietly resolved.
 */
export function useMintAudit() {
  const { tokens } = useRegistry();

  const mints = useMemo(() => tokens.map((t) => t.mint).sort(), [tokens]);

  const query = useQuery({
    queryKey: ['mint-audit', mints.length],
    enabled: mints.length > 0,
    queryFn: ({ signal }) => fetchMintAudit(mints, signal),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
  });

  return useMemo(() => {
    const audit = query.data ?? null;
    if (!audit) return { audit: null, isLoading: query.isLoading };

    const disagreements: MintAudit['disagreements'] = [];
    for (const t of tokens) {
      const facts = audit.byMint.get(t.mint);
      if (!facts) continue;
      if (facts.decimals !== null && facts.decimals !== t.decimals) {
        disagreements.push({
          mint: t.mint,
          field: 'decimals',
          chain: String(facts.decimals),
          registry: String(t.decimals),
        });
      }
    }
    return { audit: { ...audit, disagreements }, isLoading: false };
  }, [query.data, query.isLoading, tokens]);
}
