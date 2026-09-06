'use client';

// Chain health from ONE batched JSON-RPC request (9 methods, 1 round trip) refreshed every 15s by
// useChainHealth. Everything rendered here — metrics, both sparklines, the epoch ETA — is derived
// from that single batch. No extra network calls, and none per chart.
import { AlertTriangle, RotateCw } from 'lucide-react';
import { useChainHealth } from '@/hooks/useChainHealth';
import { Button } from '@/components/ui/Button';
import { LABEL_MUTED, Card, CardHeader, cn, Pill, Skeleton, StatusDot } from '@/components/ui/primitives';
import { readErrorDetail } from '@/lib/errors';
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
      <dt className={cn('truncate', LABEL_MUTED)}>
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
        // One cell, not two. The non-vote series that used to sit on the left is now the masthead
        // chart at the top of this same screen, with axes and a crosshair; keeping a 34px copy of
        // it here meant the landing page showed one series twice, which is the kind of redundancy
        // that reads as padding. Block rate stays, because nothing else plots it.
        <div className="grid gap-px border-t border-hairline/10 bg-rule">
          <div className={CELL}>
            <p className={cn('truncate', LABEL_MUTED)}>
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

// Mirrors BOTH blocks the loaded strip renders, not just the metrics grid. Reserving only the
// six cells left the skeleton at 68px against a resolved 177px, so the landing screen jumped 109px
// the moment health arrived — above the fold, under the hero, on first paint.
function MetricsSkeleton() {
  return (
    <>
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

      {/* The two sparkline cells. Heights match the real markup exactly: label 2.5, the 34px
          chart, then the caption. */}
      <div className="grid gap-px border-t border-hairline/10 bg-rule sm:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className={CELL}>
            <Skeleton className="h-2.5 w-40" />
            <div className="mt-1.5">
              <Skeleton className="h-[34px] w-full" />
            </div>
            <div className="mt-1">
              <Skeleton className="h-2.5 w-52" />
            </div>
          </div>
        ))}
      </div>
    </>
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
    // Solid, not glass: this Card reveals, and transforming a backdrop-filtered surface re-blurs its
    // whole backdrop every frame. The cells paint their own `bg-surface` anyway, so nothing visible
    // changes here.
    <Card as="section" variant="solid" className="overflow-hidden" reveal revealIndex={0}>
      <h2 className="sr-only">Cookie Chain health</h2>

      {/* The status IS the title here — it was previously inline with the chain name at equal
          weight, which made the one word a judge scans for compete with a constant. */}
      <CardHeader
        icon={<StatusDot status={status} />}
        title={statusLabel}
        // No titleClassName: CardHeader uppercases every title, so `capitalize` was overridden
        // and had no effect. The sentence-case problem it was written for cannot occur any more.
        
        subtitle="Cookie Chain mainnet"
        meta={
          <>
            {data?.note ? <Pill tone="warn">{data.note}</Pill> : null}
            <span className="whitespace-nowrap text-[11px] text-muted">
              {isFetching ? 'Refreshing…' : 'Refreshes every 15s'}
            </span>
          </>
        }
      />

      {/* Three sibling slots, each independently conditional. This is the shape that matters: it
          renders <Metrics> from ONE JSX position, so a failed 15s poll no longer moves it from the
          `data ?` branch into the error branch's dimmed wrapper — which unmounted and remounted all
          six cells, both sparklines and the epoch bar, and did it again on recovery. A `null` in the
          slot above does not shift the slot below, so React reconciles the same element throughout.
          Rendered output is byte-identical; only the reconciliation changed. */}
      {isError ? (
        <div className="flex flex-col items-start gap-3 px-3 py-6 sm:flex-row sm:items-center sm:px-4">
          <AlertTriangle size={18} className="shrink-0 text-down" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Cookie Chain RPC is not responding.</p>
            <p className="mt-0.5 break-words text-xs text-muted">
              {readErrorDetail(error, 'The batched health request failed.')}
            </p>
          </div>
          <Button variant="secondary" onClick={() => void refetch()} loading={isFetching}>
            <RotateCw size={14} aria-hidden="true" />
            Retry
          </Button>
        </div>
      ) : null}

      {/* Dimmed so nobody reads a cached slot height as live. The crossfade is keyed to `isError` —
          a CHANGED value — never to `isFetching`, which flips four times a minute forever. */}
      {data ? (
        <div className={cn('transition-opacity duration-300', stale && 'opacity-45')}>
          <Metrics data={data} />
        </div>
      ) : null}

      {!data && !isError ? <MetricsSkeleton /> : null}
    </Card>
  );
}
