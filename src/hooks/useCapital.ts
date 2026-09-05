'use client';

// Reads where COOK actually sits. Three RPC reads beyond the health tick (stake-pool account,
// stake-pool reserve balance, bridge collateral balance) batched into ONE request; total supply and
// validator stake ride the existing 15s health batch, so this hook adds one POST, not four.
//
// Read-only by construction: nothing here builds an instruction, and the only methods used are
// getAccountInfo and getBalance.
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BRIDGE_COLLATERAL_PDA,
  STAKE_POOL_ACCOUNT,
  STAKE_POOL_RESERVE,
} from '@/lib/config';
import { num, pick } from '@/lib/normalize';
import { rpcBatch } from '@/lib/rpc';
import type { CapitalBucket, CapitalSnapshot } from '@/lib/types';
import { useChainHealth } from './useChainHealth';
import { useMarkets, useRegistry } from './useMarketData';

/**
 * SPL stake-pool layout (see vendor/cookie-mcp/src/core/stake.ts): byte 0 is the account-type tag,
 * where 1 = StakePool. `totalLamports` is a u64 LE at 258 and `poolTokenSupply` at 266, so the
 * buffer must reach 274 bytes for both to be readable.
 */
const STAKE_POOL_TAG = 1;
const STAKE_POOL_MIN_LEN = 274;
const OFFSET_TOTAL_LAMPORTS = 258;

export interface StakePoolState {
  totalLamports: number;
  reserveLamports: number | null;
}

/**
 * Decodes the stake pool, or returns null. Deliberately strict: a bucket that renders as zero when
 * the layout has shifted would be a false claim about the chain, so a failed assertion omits the
 * row instead. Exported for direct testing without a network.
 */
export function decodeStakePool(base64: string | null | undefined): number | null {
  if (!base64) return null;
  let buf: Uint8Array;
  try {
    buf = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
  if (buf.length < STAKE_POOL_MIN_LEN) return null;
  if (buf[0] !== STAKE_POOL_TAG) return null;

  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const total = view.getBigUint64(OFFSET_TOTAL_LAMPORTS, true);
  // ~1.25e17 lamports exceeds Number.MAX_SAFE_INTEGER (9.0e15), so this conversion is lossy by up
  // to a few tens of lamports — about 1e-8 COOK once divided out. Acceptable because this figure is
  // only ever displayed. Nothing derived from it is signed, and no transaction reads it.
  const asNumber = Number(total);
  return Number.isFinite(asNumber) && asNumber > 0 ? asNumber : null;
}

/** The base64 payload out of a getAccountInfo result, or null when the account does not exist. */
function accountData(result: unknown): string | null {
  const data = pick(result, ['value', 'data']);
  if (Array.isArray(data) && typeof data[0] === 'string') return data[0];
  return null;
}

async function fetchCapitalAccounts(signal?: AbortSignal) {
  const map = await rpcBatch(
    [
      { id: 'pool', method: 'getAccountInfo', params: [STAKE_POOL_ACCOUNT, { encoding: 'base64' }] },
      { id: 'reserve', method: 'getBalance', params: [STAKE_POOL_RESERVE, { commitment: 'confirmed' }] },
      { id: 'bridge', method: 'getBalance', params: [BRIDGE_COLLATERAL_PDA, { commitment: 'confirmed' }] },
    ],
    signal,
  );

  const poolRes = map.get('pool');
  const reserveRes = map.get('reserve');
  const bridgeRes = map.get('bridge');

  return {
    // An RPC-level error on any one source leaves that bucket null, so the card omits it rather
    // than reporting zero COOK in the pool.
    stakePoolLamports: poolRes?.error ? null : decodeStakePool(accountData(poolRes?.result)),
    reserveLamports: reserveRes?.error ? null : num(pick(reserveRes?.result, ['value'])),
    bridgeLamports: bridgeRes?.error ? null : num(pick(bridgeRes?.result, ['value'])),
  };
}

export function useCapital(): { snapshot: CapitalSnapshot | null; isLoading: boolean } {
  const accounts = useQuery({
    queryKey: ['capital-accounts'],
    queryFn: ({ signal }) => fetchCapitalAccounts(signal),
    // The stake pool moves on epoch boundaries, not on the 15s health tick.
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: 1,
  });

  const { data: health } = useChainHealth();
  const { data: markets } = useMarkets();
  const { cookUsd } = useRegistry();

  const snapshot = useMemo<CapitalSnapshot | null>(() => {
    if (!accounts.data) return null;
    const { stakePoolLamports, reserveLamports, bridgeLamports } = accounts.data;
    const supplyLamports = health?.supplyLamports ?? null;
    const validatorLamports = health?.activatedStakeLamports ?? null;
    const dexTvlUsd = markets?.tvlUsd ?? null;

    // The DEX bucket is the only one denominated in USD upstream, so it is converted INTO COOK for
    // the bar — and the card names that conversion rather than quietly mixing units.
    const dexLamports =
      dexTvlUsd !== null && cookUsd !== null && cookUsd > 0
        ? (dexTvlUsd / cookUsd) * 1e9
        : null;

    const reserveText =
      reserveLamports !== null
        ? `${(reserveLamports / 1e9).toLocaleString('en-US', { maximumFractionDigits: 0 })} COOK of it undelegated reserve`
        : 'undelegated reserve unavailable';

    const buckets: CapitalBucket[] = [
      {
        key: 'stakePool',
        label: 'bCOOK stake pool',
        // Never "staked with validators" — most of this is sitting in the reserve, not working.
        detail: `Stake pool account · ${reserveText}`,
        lamports: stakePoolLamports,
      },
      {
        key: 'bridge',
        label: 'Hyperlane bridge collateral',
        detail: 'Locked in the warp-route PDA against COOK minted on Solana',
        lamports: bridgeLamports,
      },
      {
        key: 'validators',
        label: 'Activated with validators',
        detail: 'getVoteAccounts · stake actually delegated and voting',
        lamports: validatorLamports,
      },
      {
        key: 'dex',
        label: 'DEX pools',
        detail: 'Markets feed TVL, converted at the registry COOK price',
        lamports: dexLamports,
      },
    ];

    return { supplyLamports, buckets, cookUsd, dexTvlUsd };
  }, [accounts.data, health, markets, cookUsd]);

  return { snapshot, isLoading: accounts.isLoading };
}
