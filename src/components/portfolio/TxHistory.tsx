'use client';

// Last 20 signatures for the connected wallet. Ages are computed from a `now` held in state and
// refreshed on a timer — calling Date.now() during render would produce a different string on the
// server and the client and desync hydration.
import { useEffect, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { COOK_SYMBOL, explorerTx } from '@/lib/config';
import { formatAmount, shortAddr, timeAgo } from '@/lib/format';
import { useWalletTransactions, WALLET_TX_LIMIT } from '@/hooks/useWalletTransactions';
import { Card, EmptyState, Pill, Skeleton } from '@/components/ui/primitives';

export function TxHistory() {
  const { data, isLoading, isError } = useWalletTransactions();
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  return (
    <Card as="section" className="overflow-hidden">
      <header className="flex items-center justify-between gap-2 border-b border-hairline/10 px-4 py-3">
        <h2 className="text-sm font-bold tracking-tight">Recent activity</h2>
        <span className="text-xs text-muted">Last {WALLET_TX_LIMIT}</span>
      </header>

      {isLoading ? (
        <div>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-3 border-b border-hairline/10/60 px-4 py-3 last:border-0">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-3 w-32" />
              <Skeleton className="ml-auto h-3 w-14" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <EmptyState
          title="Could not load transactions"
          hint="The Cookie Chain RPC did not answer. It will retry on the next refresh."
        />
      ) : !data || data.length === 0 ? (
        <EmptyState
          title="No transactions yet"
          hint="Sends and swaps made from this wallet show up here within a few seconds."
        />
      ) : (
        <ul>
          {data.map((tx) => (
            <li
              key={tx.signature}
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-hairline/10/60 px-4 py-3 last:border-0"
            >
              <Pill tone={tx.err ? 'down' : 'up'}>{tx.err ? 'Failed' : 'Success'}</Pill>

              <a
                href={explorerTx(tx.signature)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-mono text-xs text-ink2 transition-colors hover:text-accent"
                title={tx.signature}
              >
                {shortAddr(tx.signature, 6, 6)}
                <ArrowUpRight size={12} />
              </a>

              {tx.label ? <Pill>{tx.label}</Pill> : null}

              <span className="ml-auto whitespace-nowrap text-xs tabular-nums text-muted">
                {tx.feeCook !== null ? `${formatAmount(tx.feeCook, 6)} ${COOK_SYMBOL}` : '—'}
              </span>
              <span className="w-16 whitespace-nowrap text-right text-xs tabular-nums text-muted">
                {now === null ? '—' : timeAgo(tx.blockTime, now)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
