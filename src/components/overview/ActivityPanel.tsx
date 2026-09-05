'use client';

// Last 25 transactions across the DEX program ids, polled every 8s through one batched JSON-RPC
// request (see useActivity). No WebSocket: logsSubscribe was left out rather than shipped
// half-tested — see NOTES.md.
import { useEffect, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { useActivity, type ActivityRow } from '@/hooks/useActivity';
import { explorerTx } from '@/lib/config';
import { shortAddr, timeAgo } from '@/lib/format';
import { Card, EmptyState, Pill, Skeleton } from '@/components/ui/primitives';

/**
 * Ticking clock for relative timestamps. Date.now() must never be read during render — the server
 * and the client would disagree and React would throw a hydration mismatch — so it is seeded inside
 * the effect and `null` means "not hydrated yet".
 */
function useNow(): number | null {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  return now;
}

function Row({ row, now }: { row: ActivityRow; now: number | null }) {
  return (
    <li className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
      <div className="min-w-0 flex-1">
        <a
          href={explorerTx(row.signature)}
          target="_blank"
          rel="noopener noreferrer"
          title={row.signature}
          className="inline-flex items-center gap-1 font-mono text-[13px] font-medium text-ink transition-colors hover:text-accent"
        >
          {shortAddr(row.signature, 6, 6)}
          <ArrowUpRight size={12} className="text-muted" aria-hidden="true" />
        </a>
        <p className="truncate text-[11px] text-muted">{row.venue}</p>
      </div>

      <span className="shrink-0 whitespace-nowrap text-[11px] tabular-nums text-muted">
        {now === null ? '—' : timeAgo(row.blockTime, now)}
      </span>

      <Pill tone={row.err ? 'down' : 'up'}>{row.err ? 'Failed' : 'Success'}</Pill>
    </li>
  );
}

function RowsSkeleton() {
  return (
    <ul className="divide-y divide-hairline/10">
      {Array.from({ length: 6 }, (_, i) => (
        <li key={i} className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-2 w-20" />
          </div>
          <Skeleton className="h-2.5 w-10" />
          <Skeleton className="h-4 w-16 rounded-full" />
        </li>
      ))}
    </ul>
  );
}

export function ActivityPanel() {
  const { data, isLoading, isError, error, isFetching } = useActivity();
  const now = useNow();
  const rows = data ?? [];

  return (
    <Card as="section" className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-hairline/10 px-3 py-2.5 sm:px-4">
        <div className="min-w-0">
          <h2 className="text-[13px] font-bold">Activity</h2>
          <p className="truncate text-[11px] text-muted">
            Latest swaps across the Cookiebox, Cookieswap and MomoSwap programs
          </p>
        </div>
        <span className="whitespace-nowrap text-[11px] text-muted">
          {isFetching ? 'Refreshing…' : 'Refreshes every 8s'}
        </span>
      </div>

      {isLoading ? (
        <RowsSkeleton />
      ) : isError ? (
        <EmptyState
          title="Could not load activity"
          hint={
            error instanceof Error
              ? error.message
              : 'The Cookie Chain RPC did not answer the signature batch.'
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No recent DEX activity"
          hint="Nothing has touched the tracked programs yet. This feed refreshes every 8 seconds."
        />
      ) : (
        <ul className="divide-y divide-hairline/10">
          {rows.map((row) => (
            <Row key={row.signature} row={row} now={now} />
          ))}
        </ul>
      )}
    </Card>
  );
}
