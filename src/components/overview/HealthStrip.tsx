'use client';

// Chain health from ONE batched JSON-RPC request (9 methods, 1 round trip) refreshed every 15s by
// useChainHealth. Everything rendered here — metrics, both sparklines, the epoch ETA — is derived
// from that single batch. No extra network calls, and none per chart.
import { AlertTriangle, RotateCw } from 'lucide-react';
import { useChainHealth } from '@/hooks/useChainHealth';
import { Button } from '@/components/ui/Button';
import { Card, Pill, Skeleton, StatusDot, cn } from '@/components/ui/primitives';
import { Sparkline } from './Sparkline';
import type { ChainHealth } from '@/lib/types';

type Tone = 'up' | 'warn' | 'down';

/** `gap-px` over a rule-coloured grid draws the separators, so they reflow with the breakpoints. */
const CELL = 'min-w-0 bg-surface px-3 py-2.5 sm:px-4';

function Metric({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: Tone;
}) {
  return (
    <div className={CELL}>
      <dt className="truncate text-[10px] font-semibold uppercase tracking-wider text-muted">
        {label}
      </dt>
      <dd
        className={cn(
          'mt-0.5 truncate text-[15px] font-bold tabular-nums',
          tone === 'up' && 'text-up',
          tone === 'warn' && 'text-warn',
          tone === 'down' && 'text-down',
        )}
      >
        {value}
      </dd>
      {sub ? <p className="truncate text-[11px] text-muted">{sub}</p> : null}
    </div>
  );
}

function int(v: number | null): string {
  return v === null ? '—' : v.toLocaleString('en-US');
}

/** Matches the thresholds deriveChainHealth uses for the status pill. */
function lagTone(lag: number | null): Tone | undefined {
  if (lag === null) return undefined;
  if (lag >= 1000) return 'down';
  if (lag >= 150) return 'warn';
  return 'up';
}

function latencyTone(ms: number): Tone | undefined {
  if (ms < 400) return 'up';
  return ms < 1200 ? undefined : 'warn';
}

/** Seconds -> "2d 1h" / "18h 40m" / "44m". Approximate by nature, so never shows seconds. */
function duration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return '—';
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3_600);
  const m = Math.floor((seconds % 3_600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Non-vote throughput is the honest activity number on a chain that is almost entirely votes. */
function tps(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return value >= 1 ? value.toFixed(2) : value.toFixed(3);
}

function Metrics({ data }: { data: ChainHealth }) {
  const progress = data.epochProgressPct;
  const { perf } = data;
  const hasWindow = perf.minutes > 0;

  return (
    <>
      <dl className="grid grid-cols-2 gap-px bg-rule sm:grid-cols-3 lg:grid-cols-6">
        <Metric
          label="Slots / sec"
          value={data.slotsPerSec === null ? '—' : data.slotsPerSec.toFixed(2)}
          sub={data.slots.processed === null ? undefined : `slot ${int(data.slots.processed)}`}
        />
        <Metric
          label="Non-vote TPS"
          value={tps(perf.nonVoteTps)}
          sub={hasWindow ? `${tps(perf.totalTps)} total, incl. votes` : 'no samples'}
        />
        <Metric
          label="Finalization lag"
          value={data.finalizationLag === null ? '—' : `${int(data.finalizationLag)} slots`}
          sub="processed − finalized"
          tone={lagTone(data.finalizationLag)}
        />
        <Metric
          label="Validators"
          value={int(data.validatorCount)}
          sub={
            data.delinquentCount === null
              ? undefined
              : data.delinquentCount === 0
                ? 'none delinquent'
                : `${data.delinquentCount} delinquent`
          }
          tone={data.delinquentCount ? 'warn' : undefined}
        />
        <Metric
          label="RPC latency"
          value={`${int(data.latencyMs)} ms`}
          sub="one batched request"
          tone={latencyTone(data.latencyMs)}
        />
        <Metric
          label="Epoch"
          value={int(data.epoch)}
          sub={
            data.epochEtaSeconds === null
              ? data.version
                ? `core ${data.version}`
                : undefined
              : `~${duration(data.epochEtaSeconds)} left${progress === null ? '' : ` · ${progress.toFixed(1)}%`}`
          }
        />
      </dl>

      {progress === null ? null : (
        <div
          className="h-1 w-full bg-surface2"
          role="progressbar"
          aria-label="Epoch progress"
          aria-valuenow={Math.round(progress)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full bg-accent transition-[width] duration-500"
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
      )}

      {hasWindow ? (
        <div className="grid gap-px border-t border-hairline/10 bg-rule sm:grid-cols-2">
          <div className={CELL}>
            <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-muted">
              Non-vote transactions · last {perf.minutes}m
            </p>
            <div className="mt-1.5">
              <Sparkline
                values={perf.nonVotePerMinute}
                ariaLabel={`Non-vote transactions per minute over the last ${perf.minutes} minutes`}
                formatValue={(v, i) =>
                  `${perf.minutes - i}m ago: ${v} non-vote ${v === 1 ? 'transaction' : 'transactions'}`
                }
                tone="accent"
              />
            </div>
            {/* The count is computed from the series, never assumed — on a chain this quiet it is
                usually most of the window, and stating it is what stops the chart reading as broken. */}
            <p className="mt-1 truncate text-[11px] text-muted">
              {perf.zeroActivityMinutes} of the last {perf.minutes} minutes had no non-vote activity
            </p>
          </div>

          <div className={CELL}>
            <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-muted">
              Block rate · last {perf.minutes}m
            </p>
            <div className="mt-1.5">
              <Sparkline
                values={perf.slotsPerSec}
                ariaLabel={`Slots per second over the last ${perf.minutes} minutes`}
                formatValue={(v, i) => `${perf.minutes - i}m ago: ${v.toFixed(2)} slots/sec`}
                tone="muted"
              />
            </div>
            <p className="mt-1 truncate text-[11px] text-muted">
              Consensus keeps producing blocks even when nothing is being traded
            </p>
          </div>
        </div>
      ) : null}
    </>
  );
}

function MetricsSkeleton() {
  return (
    <dl className="grid grid-cols-2 gap-px bg-rule sm:grid-cols-3 lg:grid-cols-6">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className={CELL}>
          <dt>
            <Skeleton className="h-2.5 w-16" />
          </dt>
          <dd className="mt-2">
            <Skeleton className="h-4 w-20" />
          </dd>
          <div className="mt-1.5">
            <Skeleton className="h-2 w-12" />
          </div>
        </div>
      ))}
    </dl>
  );
}

export function HealthStrip() {
  const { data, isError, error, isFetching, refetch } = useChainHealth();

  // A failed refetch leaves the previous snapshot in `data`. Showing the last known metrics greyed
  // as "reconnecting" beats blanking all six every time one 15s poll misses — but the status pill
  // still reads "down", because that IS the current truth about the RPC.
  const stale = isError && Boolean(data);
  const status = isError ? 'down' : !data ? 'unknown' : data.status;
  const statusLabel = isError
    ? stale
      ? 'RPC not responding — showing last known'
      : 'RPC not responding'
    : !data
      ? 'Checking chain…'
      : data.status;

  return (
    <Card as="section" className="overflow-hidden">
      <h2 className="sr-only">Cookie Chain health</h2>

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-hairline/10 px-3 py-2.5 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex items-center gap-1.5 text-sm font-bold capitalize">
            <StatusDot status={status} />
            {statusLabel}
          </span>
          <span className="truncate text-xs text-muted">Cookie Chain mainnet</span>
        </div>

        <div className="flex min-w-0 items-center gap-2">
          {data?.note ? <Pill tone="warn">{data.note}</Pill> : null}
          <span className="whitespace-nowrap text-[11px] text-muted">
            {isFetching ? 'Refreshing…' : 'Refreshes every 15s'}
          </span>
        </div>
      </div>

      {isError ? (
        <>
          <div className="flex flex-col items-start gap-3 px-3 py-6 sm:flex-row sm:items-center sm:px-4">
            <AlertTriangle size={18} className="shrink-0 text-down" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Cookie Chain RPC is not responding.</p>
              <p className="mt-0.5 break-words text-xs text-muted">
                {error instanceof Error ? error.message : 'The batched health request failed.'}
              </p>
            </div>
            <Button variant="secondary" onClick={() => void refetch()} loading={isFetching}>
              <RotateCw size={14} aria-hidden="true" />
              Retry
            </Button>
          </div>
          {/* Dimmed so nobody reads a cached slot height as live. */}
          {data ? (
            <div className="opacity-45">
              <Metrics data={data} />
            </div>
          ) : null}
        </>
      ) : data ? (
        <Metrics data={data} />
      ) : (
        <MetricsSkeleton />
      )}
    </Card>
  );
}
