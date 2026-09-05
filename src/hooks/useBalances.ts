'use client';

// Wallet balances read straight from the RPC. Token accounts are fetched for BOTH token programs —
// Cookie Chain has live Token-2022 mints, and querying only the classic program silently hides them.
import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PublicKey } from '@solana/web3.js';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { COOK_DECIMALS, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@/lib/config';
import { num, pick } from '@/lib/normalize';
import type { TokenBalance } from '@/lib/types';
import { useTokenDirectory } from './useMarketData';

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

/** The RPC half: which mints, in what quantity. Identity and pricing are joined on separately. */
function useRawTokenBalances() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const address = publicKey?.toBase58() ?? null;

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
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

export function useTokenBalances() {
  const raw = useRawTokenBalances();

  // Identity is resolved from the mints the wallet actually holds, not from the priced projection:
  // a holding with no price still has a name and a logo, and rendering it as a truncated address
  // was the regression the projection introduced on the first page a connected user sees.
  const mints = useMemo(() => (raw.data ?? []).map((b) => b.mint), [raw.data]);
  const directory = useTokenDirectory(mints);

  // Joined here rather than in `queryFn`, so a registry refresh or a late-arriving directory
  // reprices and relabels the table without re-hitting the RPC or reflashing the skeletons.
  const data = useMemo((): TokenBalance[] | undefined => {
    if (!raw.data) return undefined;
    return raw.data
      .map((b) => {
        const token = directory.get(b.mint) ?? null;
        const priceUsd = token?.priceUsd ?? null;
        return { ...b, token, valueUsd: priceUsd !== null ? b.amount * priceUsd : null };
      })
      // Unpriced holdings sort last rather than ranking alongside a genuine zero-value position.
      .sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1));
  }, [raw.data, directory]);

  // The spread would otherwise widen `data` through UseQueryResult's discriminated union, so the
  // shape callers rely on is stated explicitly.
  return { ...raw, data } as Omit<typeof raw, 'data'> & { data: TokenBalance[] | undefined };
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
