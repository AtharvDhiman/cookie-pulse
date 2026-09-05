'use client';

// Last 25 transactions across the DEX program ids, polled every 8s through one batched JSON-RPC
// request (see useActivity). No WebSocket: logsSubscribe was left out rather than shipped
// half-tested — see NOTES.md.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { useActivity, type ActivityRow } from '@/hooks/useActivity';
import { useFreshOnMount } from '@/hooks/useDelta';
import { explorerTx } from '@/lib/config';
import { shortAddr, timeAgo } from '@/lib/format';
import { Card, CardHeader, EmptyState, Pill, Skeleton, cn } from '@/components/ui/primitives';

/** Only the first six rows are above the fold when this card reveals; 7+ would stagger unseen. */
const STAGGERED_ROWS = 6;

interface StaggerProps {
  'data-stagger'?: 'fade';
  style?: CSSProperties;
}

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

/**
 * The delta wash is the only poll-adjacent motion on this route, and it is deliberately NOT a
 * translate: a row sliding in from the top pushes down the rows the user is reading. It is a wash
 * that fades out over a row which genuinely arrived after the first load.
 *
 * `armed` is frozen at mount by useFreshOnMount, so the initial 25 rows never flash and a row that
 * persists across polls never re-flashes. Nothing here may be derived on every render: `useNow`
 * re-renders all 25 rows once a second for the lifetime of the tab, so a render-derived flag would
 * flip true on every row one second after load. Everything below is CSS keyed off a DOM attribute —
 * no per-row observer, no motion values, no JS in the row at all.
 */
function Row({
  row,
  now,
  index,
  armed,
}: {
  row: ActivityRow;
  now: number | null;
  index: number;
  armed: boolean;
}) {
  const fresh = useFreshOnMount(armed);

  const stagger: StaggerProps =
    index < STAGGERED_ROWS
      ? { 'data-stagger': 'fade', style: { '--i': index } as CSSProperties }
      : {};

  return (
    <li {...stagger} className="relative isolate flex items-center gap-3 px-3 py-2.5 sm:px-4">
      {/* `isolate` + a negative z-index keeps the wash behind the row's own text rather than
          tinting it. One shot, `forwards`, so an idle tab goes completely quiet. */}
      {fresh ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 animate-row-arrive bg-accent/[0.14]"
        />
      ) : null}

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

  // Set in an effect, so the render that first paints 25 rows still reads `false` and none of them
  // washes. Every row that mounts after that one is genuinely new.
  const hasLoaded = useRef(false);
  useEffect(() => {
    if (rows.length > 0) hasLoaded.current = true;
  }, [rows.length]);

  // React Query keeps the last good `data` when a refetch fails. At an 8s interval, letting
  // `isError` win would blank 25 rows on one transient blip and restore them a tick later, so the
  // cached list stays on screen and the header says we are reconnecting instead.
  const stale = isError && rows.length > 0;

  return (
    // Solid because it reveals; the reveal lands on the CARD and nothing inside it moves as a block.
    <Card as="section" variant="solid" className="overflow-hidden" reveal revealIndex={0}>
      <CardHeader
        title="Activity"
        subtitle="Latest transactions across the Cookiebox, Cookieswap and MomoSwap programs"
        meta={
          <span
            className={cn(
              'whitespace-nowrap text-[11px]',
              stale ? 'font-medium text-warn' : 'text-muted',
            )}
          >
            {stale ? 'Reconnecting…' : isFetching ? 'Refreshing…' : 'Refreshes every 8s'}
          </span>
        }
      />

      {isLoading ? (
        <RowsSkeleton />
      ) : isError && rows.length === 0 ? (
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
          {/* Keys stay `row.signature`. An index key here would re-key every row on the 8s churn
              and remount the whole list, which would re-arm the wash on all 25 every 8 seconds. */}
          {rows.map((row, i) => (
            <Row key={row.signature} row={row} now={now} index={i} armed={hasLoaded.current} />
          ))}
        </ul>
      )}
    </Card>
  );
}
