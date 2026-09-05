'use client';

// Wallet balances read straight from the RPC. Token accounts are fetched for BOTH token programs —
// Cookie Chain has live Token-2022 mints, and querying only the classic program silently hides them.
import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PublicKey } from '@solana/web3.js';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { COOK_DECIMALS, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@/lib/config';
import { num, pick } from '@/lib/normalize';
import type { TokenBalance } from '@/lib/types';
import { useRegistry } from './useMarketData';

/** Native COOK, in whole COOK. */
export function useCookBalance() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const address = publicKey?.toBase58() ?? null;

  return useQuery({
    queryKey: ['cook-balance', address],
    enabled: Boolean(address),
    queryFn: async () => {
      const lamports = await connection.getBalance(new PublicKey(address!), 'confirmed');
      return lamports / 10 ** COOK_DECIMALS;
    },
    refetchInterval: 20_000,
    staleTime: 10_000,
  });
}

interface ParsedAccount {
  account: { data: unknown };
}

/** What the RPC alone knows. Registry-derived fields are attached at read time, not cached here. */
type RawBalance = Omit<TokenBalance, 'token' | 'valueUsd'>;

function toBalances(accounts: ParsedAccount[], programId: string): RawBalance[] {
  const out: RawBalance[] = [];
  for (const a of accounts) {
    const info = pick(a.account.data, ['parsed', 'info']);
    const mint = pick(info, ['mint']);
    const amountRaw = pick(info, ['tokenAmount', 'amount']);
    const decimals = num(pick(info, ['tokenAmount', 'decimals']));
    if (typeof mint !== 'string' || decimals === null) continue;

    const raw = String(amountRaw ?? '0');
    const amount = Number(raw) / 10 ** decimals;
    if (!Number.isFinite(amount) || amount <= 0) continue;

    out.push({ mint, amount, rawAmount: raw, decimals, programId });
  }
  return out;
}

export function useTokenBalances() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const { byMint } = useRegistry();
  const address = publicKey?.toBase58() ?? null;

  // Pricing happens in `select`, not in `queryFn`. Baking it in at fetch time would freeze the
  // holdings at whatever the registry said when the RPC answered, and keying the query on the
  // registry's readiness instead would mint a second cache entry and reflash the skeletons every
  // time the registry settles. React Query re-runs `select` when this callback changes identity,
  // so a 30s registry refresh reprices the table without touching the RPC.
  const withPrices = useCallback(
    (raw: RawBalance[]): TokenBalance[] =>
      raw
        .map((b) => {
          const token = byMint.get(b.mint) ?? null;
          const priceUsd = token?.priceUsd ?? null;
          return { ...b, token, valueUsd: priceUsd !== null ? b.amount * priceUsd : null };
        })
        // Unpriced holdings sort last rather than ranking alongside a genuine zero-value position.
        .sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1)),
    [byMint],
  );

  return useQuery({
    queryKey: ['token-balances', address],
    enabled: Boolean(address),
    queryFn: async (): Promise<RawBalance[]> => {
      const owner = new PublicKey(address!);
      const [classic, token2022] = await Promise.all([
        connection.getParsedTokenAccountsByOwner(owner, { programId: new PublicKey(TOKEN_PROGRAM_ID) }),
        connection
          .getParsedTokenAccountsByOwner(owner, { programId: new PublicKey(TOKEN_2022_PROGRAM_ID) })
          // Token-2022 may not be deployed on every RPC build; an empty list beats a failed page.
          .catch(() => ({ value: [] as ParsedAccount[] })),
      ]);
      return [
        ...toBalances(classic.value as ParsedAccount[], TOKEN_PROGRAM_ID),
        ...toBalances(token2022.value as ParsedAccount[], TOKEN_2022_PROGRAM_ID),
      ];
    },
    select: withPrices,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

/** Called after one of our own transactions confirms, so the UI reflects it without a manual reload. */
export function useRefreshBalances() {
  const qc = useQueryClient();
  return useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['cook-balance'] });
    void qc.invalidateQueries({ queryKey: ['token-balances'] });
    void qc.invalidateQueries({ queryKey: ['wallet-transactions'] });
  }, [qc]);
}
