'use client';

// Wallet-scoped page: holdings, NFTs and history. Every query underneath is keyed on the address and
// disabled until one exists, so nothing is fetched while disconnected.
import { useCallback } from 'react';
import Link from 'next/link';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { ExternalLink, RefreshCw, Wallet } from 'lucide-react';
import { COOK_DECIMALS, COOK_SYMBOL, explorerAddress } from '@/lib/config';
import { formatAmount, formatUsd, shortAddr } from '@/lib/format';
import { useCookBalance, useRefreshBalances, useTokenBalances } from '@/hooks/useBalances';
import { useRegistry } from '@/hooks/useMarketData';
import { WALLET_TX_LIMIT } from '@/hooks/useWalletTransactions';
import { Button } from '@/components/ui/Button';
import { Card, CopyButton, Skeleton, cn } from '@/components/ui/primitives';
import { HoldingsTable } from '@/components/portfolio/HoldingsTable';
import { NftGrid } from '@/components/portfolio/NftGrid';
import { TxHistory } from '@/components/portfolio/TxHistory';

/** Query families the Refresh button drives; used to spin the icon while any of them is in flight. */
const WALLET_QUERIES = new Set([
  'cook-balance',
  'token-balances',
  'wallet-transactions',
  'wallet-nfts',
]);

function Stat({ label, value, sub, loading }: { label: string; value: string; sub?: string; loading: boolean }) {
  return (
    <div className="px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</p>
      {loading ? (
        <Skeleton className="mt-2 h-6 w-24" />
      ) : (
        <p className="mt-1 truncate text-xl font-extrabold tabular-nums tracking-tight" title={value}>
          {value}
        </p>
      )}
      {sub && !loading ? <p className="truncate text-xs text-muted">{sub}</p> : null}
    </div>
  );
}

function ConnectPrompt({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="mx-auto max-w-lg py-10">
      <Card className="flex flex-col items-center px-5 py-10 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface2 text-accent ring-1 ring-hairline/10">
          <Wallet size={22} />
        </span>
        <h1 className="mt-4 font-display text-xl font-extrabold tracking-tightest">Connect a wallet</h1>
        <p className="mt-2 max-w-sm text-sm text-ink2">
          Your portfolio is read straight from Cookie Chain. Connect Nightly to see your COOK, SPL and
          Token-2022 balances, your NFTs, and your last {WALLET_TX_LIMIT} transactions.
        </p>
        <Button onClick={onConnect} className="mt-5">
          <Wallet size={15} /> Connect wallet
        </Button>
        <Link href="/bridge" className="mt-4 text-xs font-semibold text-accent hover:underline">
          No COOK yet? Here is how to get some
        </Link>
      </Card>
    </div>
  );
}

export default function PortfolioPage() {
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const { cookUsd } = useRegistry();
  const cookQuery = useCookBalance();
  const tokensQuery = useTokenBalances();
  const refreshBalances = useRefreshBalances();
  const queryClient = useQueryClient();

  const busy =
    useIsFetching({ predicate: (q) => WALLET_QUERIES.has(String(q.queryKey[0])) }) > 0;

  const onRefresh = useCallback(() => {
    refreshBalances();
    // useRefreshBalances covers balances and history; NFTs are this page's own query.
    void queryClient.invalidateQueries({ queryKey: ['wallet-nfts'] });
  }, [refreshBalances, queryClient]);

  const owner = publicKey?.toBase58() ?? null;
  const balances = tokensQuery.data;
  const cookAmount = cookQuery.data ?? null;
  const loading = cookQuery.isLoading || tokensQuery.isLoading;

  const cookValueUsd = cookAmount !== null && cookUsd !== null ? cookAmount * cookUsd : null;
  const tokenValueUsd = (balances ?? []).reduce((sum, b) => sum + (b.valueUsd ?? 0), 0);
  // Null rather than $0.00 when nothing on the books has a price at all.
  const totalUsd =
    cookValueUsd === null && tokenValueUsd === 0 ? null : (cookValueUsd ?? 0) + tokenValueUsd;
  // Holding COOK the registry cannot price means the total is real but incomplete. Say so, rather
  // than presenting a confident figure that quietly omits the largest position.
  const totalExcludesCook = cookValueUsd === null && (cookAmount ?? 0) > 0 && totalUsd !== null;
  const pricedCount = (balances ?? []).filter((b) => b.valueUsd !== null).length;
  // A failed RPC read is "unknown", not zero — the stats and the holdings list must both say so.
  const balancesError = cookQuery.isError || tokensQuery.isError;

  if (!owner) return <ConnectPrompt onConnect={() => setVisible(true)} />;

  return (
    <div className="space-y-4 py-2">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-[26px] font-extrabold leading-tight tracking-tightest sm:text-[34px]">Portfolio</h1>
          <div className="mt-1 flex items-center gap-1">
            <span className="truncate font-mono text-xs text-muted" title={owner}>
              {shortAddr(owner, 6, 6)}
            </span>
            <CopyButton value={owner} label="address" />
            <a
              href={explorerAddress(owner)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="View wallet on Cookiescan"
              className="rounded-md p-1 text-muted transition-colors hover:bg-surface2 hover:text-ink"
            >
              <ExternalLink size={13} />
            </a>
          </div>
        </div>

        <Button variant="secondary" onClick={onRefresh} className="px-3 py-2 text-xs">
          <RefreshCw size={14} className={cn(busy && 'animate-spin')} />
          Refresh
        </Button>
      </header>

      <Card as="section" className="grid grid-cols-1 divide-y divide-hairline/10 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Stat
          label="Total value"
          value={formatUsd(totalUsd)}
          sub={totalExcludesCook ? `excludes ${COOK_SYMBOL} — no price feed` : undefined}
          loading={loading}
        />
        <Stat
          label={`${COOK_SYMBOL} balance`}
          value={cookAmount === null ? '—' : `${formatAmount(cookAmount, COOK_DECIMALS)} ${COOK_SYMBOL}`}
          sub={formatUsd(cookValueUsd)}
          loading={cookQuery.isLoading}
        />
        <Stat
          label="Token accounts"
          value={balances ? String(balances.length) : '—'}
          sub={balances ? `${pricedCount} priced by the registry` : undefined}
          loading={tokensQuery.isLoading}
        />
      </Card>

      <HoldingsTable
        cookAmount={cookAmount}
        cookUsd={cookUsd}
        balances={balances}
        isLoading={loading}
        isError={balancesError}
      />

      <NftGrid owner={owner} />

      <TxHistory />
    </div>
  );
}
