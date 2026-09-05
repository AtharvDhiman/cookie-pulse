'use client';

// Last N transactions for the connected wallet.
//
// Two round trips, never more: `getSignaturesForAddress` for the list, then ONE
// `getParsedTransactions` for the fees and program ids. The latter is a web3.js Connection helper
// that issues a single *batched* JSON-RPC request (one `getTransaction`/jsonParsed entry per
// signature) — there is no `getParsedTransactions` JSON-RPC method to call directly.
//
// Pruned or unavailable transactions come back as `null` in that array, so every field derived from
// it is optional and the row still renders from the signature listing alone.
import { useQuery } from '@tanstack/react-query';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import type { Connection, ParsedTransactionWithMeta } from '@solana/web3.js';
import { LAMPORTS_PER_COOK, PROGRAMS } from '@/lib/config';
import { num, pick } from '@/lib/normalize';
import { rpcCall } from '@/lib/rpc';
import type { TxRow } from '@/lib/types';

export const WALLET_TX_LIMIT = 20;

const PROGRAM_LABELS = new Map<string, string>(PROGRAMS.map((p) => [p.id, p.label]));

interface SignatureRow {
  signature: string;
  slot: number;
  blockTime: number | null;
  err: boolean;
}

function toSignatureRow(v: unknown): SignatureRow | null {
  const signature = pick(v, ['signature']);
  if (typeof signature !== 'string' || signature.length === 0) return null;
  const err = pick(v, ['err']);
  return {
    signature,
    slot: num(pick(v, ['slot'])) ?? 0,
    blockTime: num(pick(v, ['blockTime'])),
    err: err !== null && err !== undefined,
  };
}

/** Accepts a base58 string or anything PublicKey-shaped, so shape drift cannot throw. */
function base58(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && typeof (v as { toBase58?: unknown }).toBase58 === 'function') {
    return (v as { toBase58: () => string }).toBase58();
  }
  return null;
}

/** Static keys plus any address-lookup-table keys a v0 transaction loaded. */
function accountKeys(tx: ParsedTransactionWithMeta): string[] {
  const keys: string[] = [];
  const staticKeys = pick(tx, ['transaction', 'message', 'accountKeys']);
  if (Array.isArray(staticKeys)) {
    for (const k of staticKeys) {
      const s = base58(pick(k, ['pubkey']) ?? k);
      if (s) keys.push(s);
    }
  }
  const loaded = tx.meta?.loadedAddresses;
  if (loaded) {
    for (const k of [...(loaded.writable ?? []), ...(loaded.readonly ?? [])]) {
      const s = base58(k);
      if (s) keys.push(s);
    }
  }
  return keys;
}

/** Venue label when the transaction touched a known DEX/launchpad program; null otherwise. */
function venueOf(tx: ParsedTransactionWithMeta | null): string | null {
  if (!tx) return null;
  for (const key of accountKeys(tx)) {
    const label = PROGRAM_LABELS.get(key);
    if (label) return label;
  }
  return null;
}

async function fetchWalletTransactions(
  connection: Connection,
  owner: string,
  signal?: AbortSignal,
): Promise<TxRow[]> {
  const raw = await rpcCall<unknown>(
    'getSignaturesForAddress',
    [owner, { limit: WALLET_TX_LIMIT }],
    signal,
  );
  const signatures = (Array.isArray(raw) ? raw : [])
    .map(toSignatureRow)
    .filter((s): s is SignatureRow => s !== null);
  if (signatures.length === 0) return [];

  // Fees and venue labels are enrichment: if this fails the history still lists every signature.
  const parsed = await connection
    .getParsedTransactions(
      signatures.map((s) => s.signature),
      { maxSupportedTransactionVersion: 0, commitment: 'confirmed' },
    )
    .catch((): (ParsedTransactionWithMeta | null)[] => []);

  return signatures.map((s, i) => {
    const tx = parsed[i] ?? null;
    const fee = num(tx?.meta?.fee);
    const metaErr = tx?.meta?.err;
    return {
      signature: s.signature,
      blockTime: s.blockTime ?? num(tx?.blockTime),
      slot: s.slot || (num(tx?.slot) ?? 0),
      err: s.err || (metaErr !== null && metaErr !== undefined),
      feeCook: fee !== null ? fee / LAMPORTS_PER_COOK : null,
      label: venueOf(tx),
    };
  });
}

/**
 * Keyed on `wallet-transactions` so `useRefreshBalances()` invalidates it after one of our own
 * transactions confirms.
 */
export function useWalletTransactions() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const address = publicKey?.toBase58() ?? null;

  return useQuery({
    queryKey: ['wallet-transactions', address],
    enabled: Boolean(address),
    queryFn: ({ signal }) => fetchWalletTransactions(connection, address!, signal),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}
