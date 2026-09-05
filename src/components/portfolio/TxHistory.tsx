'use client';

// Last 20 signatures for the connected wallet. Ages are computed from a `now` held in state and
// refreshed on a timer — calling Date.now() during render would produce a different string on the
// server and the client and desync hydration.
import { useEffect, useState, type CSSProperties } from 'react';
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
    // `solid`, not `glass`: the panel reveals, and a transform on a backdrop-filtered surface makes
    // the compositor re-blur its whole backdrop every frame. No revealIndex — this block owns a
    // sibling stagger of its own, and a block delay on top of it would read as lag.
    <Card as="section" variant="solid" reveal className="overflow-hidden">
      <header className="flex items-center justify-between gap-2 border-b border-hairline/10 px-4 py-3">
        <h2 className="text-sm font-bold tracking-tight">Recent activity</h2>
        <span className="text-xs text-muted">Last {WALLET_TX_LIMIT}</span>
      </header>

      {isLoading ? (
        <div>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-3 border-b border-hairline/10 px-4 py-3 last:border-0">
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
          {/* A short stagger is right here where it is banned in HoldingsTable, and the reason is
              structural: these rows are keyed on the immutable signature and the list is
              chronological newest-first with no price-driven re-sort, so a row never remounts under
              a poll. 8px of travel, not 14 — a dense text row needs less distance or the block
              reads as sliding. The attribute mechanism, never useInView: these 20 rows already
              re-render on a 15s clock, and the CSS costs zero renders. */}
          {data.map((tx, i) => (
            <li
              key={tx.signature}
              data-stagger
              style={{ '--i': Math.min(i, 7) } as CSSProperties}
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-hairline/10 px-4 py-3 last:border-0"
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
              {/* Deliberately not faded. Twenty timestamps crossfading on a 15s clock is a strobe
                  carrying no information — the string is telling you nothing changed. */}
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
