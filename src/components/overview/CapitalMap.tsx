'use client';

// Where COOK actually sits.
//
// This card exists because the honest answer to "why does this analytics page look sparse" is that
// the DEX pools everyone measures are far from the biggest pile of COOK on the chain — the
// liquid-staking pool alone holds several times their combined value. That is a real finding, but
// it is also the card most able to say something the data does not support, so four rules are
// enforced here rather than left to copy review:
//
//   1. The stake pool's undelegated reserve is named as reserve. Only the validator row, which is
//      ~1.4M COOK, may be described as stake that is actually working.
//   2. The buckets are never presented as summing to supply — they account for a minority of it,
//      and the footer states that share explicitly. The remainder is drawn but left unlabelled,
//      because this app does not know what is in it.
//   3. A bucket whose source failed renders as "unavailable", never as zero. Zero is a claim.
//   4. No ratio is written in prose. The subtitle's comparison is DERIVED from the same two
//      buckets the table renders, so a copy line can never survive the data moving out from
//      under it. The earlier hard-coded "fifteen times" was measured by comparing 125M COOK
//      against $8K of USD; like for like it was 3.5x, and it had gone stale in four places.
//
// Presentational only: it takes a snapshot and renders it. No fetching, no instruction building.
import { LABEL_MUTED, Card, CardHeader, cn, Skeleton } from '@/components/ui/primitives';
import { COOK_SYMBOL } from '@/lib/config';
import { compact, formatUsd } from '@/lib/format';
import type { CapitalSnapshot, CapitalBucket } from '@/lib/types';

/** Bar segment colours, in the order the buckets are declared. */
const SEGMENT_TONE: Record<string, string> = {
  stakePool: 'bg-accent',
  bridge: 'bg-accent2',
  validators: 'bg-up',
  dex: 'bg-warn',
};

function cookAmount(lamports: number | null): string {
  if (lamports === null) return 'unavailable';
  return `${compact(lamports / 1e9)} ${COOK_SYMBOL}`;
}

function sharePct(lamports: number | null, supply: number | null): string {
  if (lamports === null || supply === null || supply <= 0) return '—';
  const pct = (lamports / supply) * 100;
  // Buckets span four orders of magnitude; 0.14% must not round to 0.0%.
  return `${pct < 0.1 ? pct.toFixed(2) : pct.toFixed(2)}%`;
}

function BucketRow({
  bucket,
  supplyLamports,
  cookUsd,
}: {
  bucket: CapitalBucket;
  supplyLamports: number | null;
  cookUsd: number | null;
}) {
  const available = bucket.lamports !== null;
  const usd = available && cookUsd !== null ? (bucket.lamports! / 1e9) * cookUsd : null;

  return (
    <tr className="border-t border-hairline/10">
      <th scope="row" className="py-2 pr-3 text-left align-top font-normal">
        <span className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={cn('h-2 w-2 shrink-0 rounded-sm', SEGMENT_TONE[bucket.key] ?? 'bg-muted')}
          />
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold text-ink">{bucket.label}</span>
            <span className="block text-[11px] leading-snug text-muted">{bucket.detail}</span>
          </span>
        </span>
      </th>
      <td className="py-2 pr-3 text-right align-top text-[13px] font-semibold tabular-nums">
        {available ? (
          cookAmount(bucket.lamports)
        ) : (
          <span className="font-normal text-muted">unavailable</span>
        )}
      </td>
      <td className="py-2 pr-3 text-right align-top text-[13px] tabular-nums text-ink2">
        {usd === null ? '—' : formatUsd(usd, { compact: true })}
      </td>
      <td className="py-2 text-right align-top text-[13px] tabular-nums text-muted">
        {sharePct(bucket.lamports, supplyLamports)}
      </td>
    </tr>
  );
}

function Loading() {
  return (
    <div className="space-y-3 p-4 sm:p-5">
      <Skeleton className="h-3 w-40" />
      <Skeleton className="h-2.5 w-full rounded-full" />
      <div className="space-y-2 pt-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-7 w-full" />
        ))}
      </div>
    </div>
  );
}

export function CapitalMap({
  snapshot,
  isLoading,
}: {
  snapshot: CapitalSnapshot | null;
  isLoading: boolean;
}) {
  if (isLoading || !snapshot) {
    return (
      <Card as="section" variant="solid" className="overflow-hidden" reveal revealIndex={0}>
        <Loading />
      </Card>
    );
  }

  const { supplyLamports, buckets, cookUsd, dexTvlUsd } = snapshot;

  // Only buckets that actually resolved contribute to the accounted-for share; an unavailable
  // source must not silently shrink the number and make coverage look worse than it is measured.
  const accountedLamports = buckets.reduce((sum, b) => sum + (b.lamports ?? 0), 0);
  const accountedPct =
    supplyLamports && supplyLamports > 0 ? (accountedLamports / supplyLamports) * 100 : null;
  const anyUnavailable = buckets.some((b) => b.lamports === null);

  // Derived, never written down. Both sides are COOK lamports off the same table, so the comparison
  // is like for like and moves with the chain instead of with a copy edit.
  const stakeLamports = buckets.find((b) => b.key === 'stakePool')?.lamports ?? null;
  const dexLamports = buckets.find((b) => b.key === 'dex')?.lamports ?? null;
  const stakeOverDex =
    stakeLamports !== null && dexLamports !== null && dexLamports > 0
      ? stakeLamports / dexLamports
      : null;

  return (
    <Card as="section" variant="solid" className="overflow-hidden" reveal revealIndex={0}>
      <CardHeader
        eyebrow="Capital map"
        title={`Where ${COOK_SYMBOL} sits`}
        subtitle={
          <>
            Read live from the chain, not from a price feed.{' '}
            {stakeOverDex !== null ? (
              <>
                The liquid-staking pool alone holds{' '}
                <strong className="font-semibold text-ink2">
                  {stakeOverDex.toFixed(1)}×
                </strong>{' '}
                what every DEX pool on the chain holds together.
              </>
            ) : (
              <>Each row below names the account it was read from.</>
            )}
          </>
        }
      />

      <div className="px-4 py-4 sm:px-5">
        {/* Cross-section of supply. The trailing flex-1 track is the unaccounted remainder — drawn,
            deliberately unlabelled, because nothing here measured what is in it. */}
        <div
          className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface2"
          role="img"
          aria-label={
            accountedPct === null
              ? 'Capital distribution across supply'
              : `Measured buckets account for ${accountedPct.toFixed(1)}% of total supply`
          }
        >
          {buckets.map((b) => {
            const pct =
              b.lamports !== null && supplyLamports && supplyLamports > 0
                ? (b.lamports / supplyLamports) * 100
                : 0;
            if (pct <= 0) return null;
            return (
              <span
                key={b.key}
                // A real-but-tiny bucket (validators sit at 0.14%) still has to be visible.
                style={{ width: `${Math.max(pct, 0.35)}%` }}
                className={cn('h-full', SEGMENT_TONE[b.key] ?? 'bg-muted')}
                title={`${b.label} — ${sharePct(b.lamports, supplyLamports)} of supply`}
              />
            );
          })}
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <caption className="sr-only">
              COOK capital by location, with each figure&apos;s on-chain source
            </caption>
            <thead>
              <tr className={LABEL_MUTED}>
                <th scope="col" className="pb-1 pr-3 text-left font-semibold">
                  Bucket
                </th>
                <th scope="col" className="pb-1 pr-3 text-right font-semibold">
                  Amount
                </th>
                <th scope="col" className="pb-1 pr-3 text-right font-semibold">
                  Value
                </th>
                <th scope="col" className="pb-1 text-right font-semibold">
                  Share
                </th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((b) => (
                <BucketRow
                  key={b.key}
                  bucket={b}
                  supplyLamports={supplyLamports}
                  cookUsd={cookUsd}
                />
              ))}
              <tr className="border-t border-hairline/10">
                <th scope="row" className="py-2 pr-3 text-left align-top font-normal">
                  <span className="block text-[13px] font-semibold text-ink">Total supply</span>
                  <span className="block text-[11px] text-muted">getSupply</span>
                </th>
                <td className="py-2 pr-3 text-right align-top text-[13px] font-semibold tabular-nums">
                  {cookAmount(supplyLamports)}
                </td>
                <td className="py-2 pr-3 text-right align-top text-[13px] tabular-nums text-ink2">
                  {supplyLamports !== null && cookUsd !== null
                    ? formatUsd((supplyLamports / 1e9) * cookUsd, { compact: true })
                    : '—'}
                </td>
                <td className="py-2 text-right align-top text-[13px] tabular-nums text-muted">
                  100%
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="mt-3 border-t border-hairline/10 pt-3 text-[11px] leading-relaxed text-muted">
          {accountedPct === null ? (
            <>Supply unavailable, so these buckets cannot be expressed as a share of it.</>
          ) : (
            <>
              Accounted for:{' '}
              <strong className="font-semibold text-ink2">~{accountedPct.toFixed(1)}%</strong> of
              supply. The rest is not classified here — these are the locations this app can read
              directly, not a partition of the whole.
            </>
          )}
          {anyUnavailable ? ' One or more sources did not respond; those rows are omitted, not zeroed.' : ''}
          {dexTvlUsd !== null ? (
            <>
              {' '}
              Every row is native {COOK_SYMBOL}, valued at the registry&apos;s {COOK_SYMBOL} price.
              The DEX row counts only the {COOK_SYMBOL} side of each pool, so it is smaller than the
              markets feed&apos;s headline TVL of {formatUsd(dexTvlUsd)}, which values both sides.
            </>
          ) : null}
        </p>
      </div>
    </Card>
  );
}
