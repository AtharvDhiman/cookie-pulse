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
/** Base58, 32-44 chars: the shape getMultipleAccounts will accept without rejecting the batch. */
const BASE58_PUBKEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function useMintAudit(extraMints: string[] = []) {
  const { tokens } = useRegistry();

  // The priced projection is 92 of 6,476 registry mints, so a token reached by deep link is
  // usually outside it and had NO safety facts at all -- silently, which reads as "nothing to
  // report" rather than "not checked". `chunkMints` already batches 100 per getMultipleAccounts,
  // so carrying the one or two mints actually on screen costs no extra request.
  // `extraMints` arrives from ?in= / ?out= on /trade, which is to say from a stranger's URL.
  // getMultipleAccounts rejects the ENTIRE batch with -32602 if any single element is not a valid
  // base58 pubkey, so one junk character in a shared link deleted the mint- and freeze-authority
  // facts for all 92 priced tokens at once -- silently, since a missing fact renders as no warning
  // rather than as an error. Anything that is not plausibly a pubkey is dropped before it can do
  // that; the deep-link handling in SwapPanel already reports an unresolvable mint separately.
  const extraKey = extraMints.filter((m) => BASE58_PUBKEY.test(m)).join(',');
  const mints = useMemo(
    () => [...new Set([...tokens.map((t) => t.mint), ...extraKey.split(',').filter(Boolean)])].sort(),
    [tokens, extraKey],
  );

  const query = useQuery({
    // Keyed on the identities, not the cardinality. `mints.length` did not say WHICH mints, and
    // with staleTime/gcTime Infinity the first result for a 92-element set was reused for every
    // later 92-element set for the life of the tab -- so a token that entered the priced set
    // showed another token's authorities. The array is sorted above precisely so this key is
    // stable across re-renders that reorder the same set.
    queryKey: ['mint-audit', mints.join(',')],
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
