'use client';

// Wallet-scoped page: holdings, NFTs and history. Every query underneath is keyed on the address and
// disabled until one exists, so nothing is fetched while disconnected.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { ExternalLink, RefreshCw, Wallet } from 'lucide-react';
import { COOK_DECIMALS, COOK_SYMBOL, explorerAddress } from '@/lib/config';
import { formatAmount, formatUsd, shortAddr } from '@/lib/format';
import { isNftLike } from '@/lib/normalize';
import { useCookBalance, useRefreshBalances, useTokenBalances } from '@/hooks/useBalances';
import { useRegistry } from '@/hooks/useMarketData';
import { WALLET_TX_LIMIT } from '@/hooks/useWalletTransactions';
import { Button } from '@/components/ui/Button';
import { CountUp } from '@/components/motion/CountUp';
import { LABEL_MUTED, Card, cn, CopyButton, Skeleton } from '@/components/ui/primitives';
import { HoldingsTable } from '@/components/portfolio/HoldingsTable';
import { NftGrid } from '@/components/portfolio/NftGrid';
import { TxHistory } from '@/components/portfolio/TxHistory';

/** Query families the Refresh button drives; used to tell a user-initiated refresh from a poll. */
const WALLET_QUERIES = new Set([
  'cook-balance',
  'token-balances',
  'wallet-transactions',
  'wallet-nfts',
]);

/** Module-scoped: an inline formatter would re-run <CountUp>'s effect on every parent render. */
const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');

/** A warm-cache refresh resolves in two frames; hold the indicator this long so it reads as an event. */
const REFRESH_FLOOR_MS = 450;

function Stat({
  label,
  value,
  valueNode,
  sub,
  loading,
  index,
}: {
  label: string;
  value: string;
  /** Overrides the plain string — used for the one count-up on this page. */
  valueNode?: ReactNode;
  sub?: string;
  loading: boolean;
  index: number;
}) {
  return (
    <div data-enter style={{ '--i': index } as CSSProperties} className="px-4 py-3">
      <p className={LABEL_MUTED}>{label}</p>
      {loading ? (
        // Sized to the box it is standing in for: the resolved value is text-xl on mt-1, a 28px
        // line. The old h-6/mt-2 skeleton shifted the card by ~8px the moment data landed.
        <Skeleton className="mt-1 h-7 w-24" />
      ) : (
        <p
          className="mt-1 animate-fade-in truncate text-xl font-extrabold tabular-nums tracking-tight"
          title={value}
        >
          {valueNode ?? value}
        </p>
      )}
      {/* Permanently reserved. This line used to exist only when there was something to say, so it
          appeared and vanished with the data and moved the card's height on a poll. A non-breaking
          space holds the box without inventing a value. */}
      <p className="truncate text-xs text-muted">{loading || !sub ? ' ' : sub}</p>
    </div>
  );
}

function ConnectPrompt({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="mx-auto max-w-lg py-10">
      {/* useWallet returns a null publicKey on the server, so this card is the SSR first paint for
          every visitor. Its entrance is therefore a self-completing CSS animation and never the
          IntersectionObserver — an observer here would show a blank card until hydration. The Card
          itself only fades: it is `.glass`, and transforming a backdrop-filtered element re-samples
          and re-blurs its whole backdrop. The ladder lives on the children instead.
          No exit animation: if the adapter autoConnects, this card unmounts 300-800ms later and an
          exit would sit in front of the real content. */}
      <Card className="enter-fade flex flex-col items-center px-5 py-10 text-center">
        <span
          data-enter
          style={{ '--i': 0 } as CSSProperties}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-surface2 text-accent ring-1 ring-hairline/10"
        >
          <Wallet size={22} />
        </span>
        <h1
          data-enter
          style={{ '--i': 1 } as CSSProperties}
          className="mt-4 font-display text-xl font-extrabold tracking-tightest"
        >
          Connect a wallet
        </h1>
        <p
          data-enter
          style={{ '--i': 2 } as CSSProperties}
          className="mt-2 max-w-sm text-sm text-ink2"
        >
          Your portfolio is read straight from Cookie Chain. Connect Nightly to see your COOK, SPL and
          Token-2022 balances, your NFTs, and your last {WALLET_TX_LIMIT} transactions.
        </p>
        <div data-enter style={{ '--i': 3 } as CSSProperties} className="mt-5">
          <Button onClick={onConnect}>
            <Wallet size={15} /> Connect wallet
          </Button>
        </div>
        <span data-enter style={{ '--i': 4 } as CSSProperties} className="mt-4">
          <Link href="/bridge" className="text-xs font-semibold text-accent hover:underline">
            No COOK yet? Here is how to get some
          </Link>
        </span>
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

  // `busy` alone is true on every 20s and 30s background poll, so binding the spinner straight to
  // it made the icon turn four times a minute with nobody touching it — which reads as a request
  // that never finished. Only a click arms the indicator, and it is held to a visible floor.
  const [refreshing, setRefreshing] = useState(false);
  const floorUntil = useRef(0);

  const onRefresh = useCallback(() => {
    refreshBalances();
    // useRefreshBalances covers balances and history; NFTs are this page's own query.
    void queryClient.invalidateQueries({ queryKey: ['wallet-nfts'] });
    floorUntil.current = Date.now() + REFRESH_FLOOR_MS;
    setRefreshing(true);
  }, [refreshBalances, queryClient]);

  useEffect(() => {
    if (!refreshing || busy) return;
    // Falling edge of a click-driven refresh: disarm once the queries are quiet, but never before
    // the floor, so a cache hit is still legible as a refresh.
    const id = setTimeout(
      () => setRefreshing(false),
      Math.max(0, floorUntil.current - Date.now()),
    );
    return () => clearTimeout(id);
  }, [refreshing, busy]);

  const owner = publicKey?.toBase58() ?? null;
  const balances = tokensQuery.data;
  const cookAmount = cookQuery.data ?? null;
  const loading = cookQuery.isLoading || tokensQuery.isLoading;

  const cookValueUsd = cookAmount !== null && cookUsd !== null ? cookAmount * cookUsd : null;
  const tokenValueUsd = (balances ?? []).reduce((sum, b) => sum + (b.valueUsd ?? 0), 0);
  // Null rather than $0.00 when nothing on the books has a price at all.
  const totalUsd =
    cookValueUsd === null && tokenValueUsd === 0 ? null : (cookValueUsd ?? 0) + tokenValueUsd;
  const pricedCount = (balances ?? []).filter((b) => b.valueUsd !== null).length;
  // Anything the registry cannot price contributes nothing to the total — including COOK itself if
  // its feed is down. Name how many were left out rather than presenting a confident figure that
  // quietly omits them — the overwhelming majority of registry mints carry no price at all.
  // NFTs are token accounts too, and they have their own grid below. Counting them here would tell
  // a wallet holding five collectibles that the total "excludes 5 unpriced holdings", which reads as
  // missing money rather than as art.
  const unpricedFungibles = (balances ?? []).filter(
    (b) => b.valueUsd === null && !(b.token && isNftLike(b.token)),
  ).length;
  const unpricedCount =
    unpricedFungibles + (cookValueUsd === null && (cookAmount ?? 0) > 0 ? 1 : 0);
  const totalNote =
    totalUsd !== null && unpricedCount > 0
      ? `excludes ${unpricedCount} unpriced holding${unpricedCount === 1 ? '' : 's'}`
      : undefined;
  // A failed RPC read is "unknown", not zero — the stats and the holdings list must both say so.
  const balancesError = cookQuery.isError || tokensQuery.isError;

  if (!owner) return <ConnectPrompt onConnect={() => setVisible(true)} />;

  return (
    <div className="space-y-4 py-2">
      {/* Above the fold on every viewport, so the ladder is a CSS animation, not an observer.
          12px of travel deliberately: the h1 is a large Sora ExtraBold run and translating display
          glyphs further shimmers their subpixel AA on some Windows/Chrome configurations. */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1
            data-enter
            style={{ '--i': 0 } as CSSProperties}
            className="font-display text-[26px] font-extrabold leading-tight tracking-tightest sm:text-[34px]"
          >
            Portfolio
          </h1>
          <div
            data-enter
            style={{ '--i': 1 } as CSSProperties}
            className="mt-1 flex items-center gap-1"
          >
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

        <div data-enter style={{ '--i': 2 } as CSSProperties}>
          <Button variant="secondary" onClick={onRefresh} className="px-3 py-2 text-xs">
            <RefreshCw size={14} className={cn(refreshing && 'animate-spin')} />
            {/* The label changes because the reduced-motion reset freezes the spinner at 0deg and
                this control, unlike /send's submit, has no other state text. Both labels share one
                grid cell so the swap cannot resize the button and shove the header cluster. */}
            <span className="grid place-items-center">
              <span className={cn('col-start-1 row-start-1', refreshing && 'invisible')}>
                Refresh
              </span>
              <span className={cn('col-start-1 row-start-1', !refreshing && 'invisible')}>
                Refreshing…
              </span>
            </span>
          </Button>
        </div>
      </header>

      {/* Stays `.glass`, so the panel itself only fades; the three cells carry the travel. */}
      <Card
        as="section"
        className="enter-fade grid grid-cols-1 divide-y divide-hairline/10 sm:grid-cols-3 sm:divide-x sm:divide-y-0"
      >
        <Stat
          index={2}
          label="Total value"
          value={formatUsd(totalUsd)}
          sub={totalNote}
          loading={loading}
        />
        <Stat
          index={3}
          label={`${COOK_SYMBOL} balance`}
          value={cookAmount === null ? '—' : `${formatAmount(cookAmount, COOK_DECIMALS)} ${COOK_SYMBOL}`}
          sub={formatUsd(cookValueUsd)}
          loading={cookQuery.isLoading}
        />
        {/* The only count-up on this route. Total value and COOK balance are currency and are
            banned from it: a partially counted balance is a wrong number displayed as fact. */}
        <Stat
          index={4}
          label="Token accounts"
          value={balances ? String(balances.length) : '—'}
          valueNode={balances ? <CountUp value={balances.length} format={fmtInt} /> : undefined}
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
