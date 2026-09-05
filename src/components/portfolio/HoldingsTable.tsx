'use client';

// Native COOK plus every SPL and Token-2022 balance the wallet holds, priced from the registry.
// Native COOK is synthesised as the first row: it lives in the account itself, not in a token
// account, so `useTokenBalances()` never returns it.
import Link from 'next/link';
import { COOK_DECIMALS, COOK_MINT, COOK_SYMBOL, TOKEN_2022_PROGRAM_ID, explorerToken } from '@/lib/config';
import { formatAmount, formatUsd, shortAddr } from '@/lib/format';
import type { TokenBalance } from '@/lib/types';
import { LABEL_MUTED, Card, CardHeader, cn, EmptyState, Pill, Skeleton, TokenLogo } from '@/components/ui/primitives';

interface Row {
  key: string;
  mint: string;
  symbol: string;
  name: string;
  logo: string | null;
  amount: number;
  decimals: number;
  priceUsd: number | null;
  valueUsd: number | null;
  native: boolean;
  token2022: boolean;
}

function buildRows(
  cookAmount: number | null,
  cookUsd: number | null,
  balances: TokenBalance[] | undefined,
): Row[] {
  const rows: Row[] = [];

  if (cookAmount !== null && cookAmount > 0) {
    rows.push({
      key: 'native-cook',
      mint: COOK_MINT,
      symbol: COOK_SYMBOL,
      name: 'Cookie (native)',
      logo: null,
      amount: cookAmount,
      decimals: COOK_DECIMALS,
      priceUsd: cookUsd,
      valueUsd: cookUsd !== null ? cookAmount * cookUsd : null,
      native: true,
      token2022: false,
    });
  }

  balances?.forEach((b, i) => {
    rows.push({
      // Two accounts can hold the same mint, so the index keeps React keys unique.
      key: `${b.programId}:${b.mint}:${i}`,
      mint: b.mint,
      symbol: b.token?.symbol ?? shortAddr(b.mint, 4, 4),
      name: b.token?.name ?? 'Unlisted token',
      logo: b.token?.logo ?? null,
      amount: b.amount,
      decimals: b.decimals,
      priceUsd: b.token?.priceUsd ?? null,
      valueUsd: b.valueUsd,
      native: false,
      token2022: b.programId === TOKEN_2022_PROGRAM_ID,
    });
  });

  return rows;
}

function LoadingRows() {
  return (
    <div>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-3 border-b border-hairline/10 px-4 py-3 last:border-0">
          <Skeleton className="h-8 w-8" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-2.5 w-28" />
          </div>
          <Skeleton className="h-3 w-14" />
        </div>
      ))}
    </div>
  );
}

export function HoldingsTable({
  cookAmount,
  cookUsd,
  balances,
  isLoading,
  isError,
}: {
  cookAmount: number | null;
  cookUsd: number | null;
  balances: TokenBalance[] | undefined;
  isLoading: boolean;
  isError: boolean;
}) {
  const rows = buildRows(cookAmount, cookUsd, balances);

  // Keyed on the STATE, never on rows.length: the balances array is re-sorted by value on the 30s
  // poll and its length moves whenever a dust account appears, so a length-derived key would
  // re-fade this slot several times a minute for no reason.
  const slotState: 'error' | 'count' | 'none' = isError
    ? 'error'
    : !isLoading && rows.length > 0
      ? 'count'
      : 'none';

  return (
    // `solid`, not `glass`: this panel reveals, and transforming a backdrop-filtered element makes
    // the compositor re-sample and re-blur its entire backdrop every frame — with the ambient layer
    // drifting underneath it. The reveal attributes go on the Card itself rather than on a wrapper,
    // which would place a transform ancestor over the overflow-x-auto scroller below.
    <Card as="section" variant="solid" reveal revealIndex={0} className="overflow-hidden">
      <CardHeader
        title="Holdings"
        meta={
          /* A failed read must never read as "you own nothing", so say the list is incomplete. */
          <span key={slotState} className="animate-fade-in">
            {slotState === 'error' ? (
              <Pill tone="warn">Incomplete</Pill>
            ) : slotState === 'count' ? (
              <span className="text-xs text-muted">
                {rows.length} asset{rows.length === 1 ? '' : 's'}
              </span>
            ) : null}
          </span>
        }
      />

      {isLoading ? (
        <LoadingRows />
      ) : rows.length === 0 ? (
        isError ? (
          <EmptyState
            title="Could not load holdings"
            hint="The Cookie Chain RPC did not answer. Refresh to try again."
          />
        ) : (
          <div className="pb-6">
            <EmptyState
              title="Nothing here yet"
              hint="This wallet holds no COOK and no token accounts on Cookie Chain."
            />
            <div className="flex justify-center">
              {/* inline-flex is load-bearing: an <a> is display:inline by default and a transform
                  on an inline box is silently ignored, so the lift would do nothing. */}
              <Link
                href="/bridge"
                className="inline-flex items-center rounded-xl border border-hairline/10 bg-surface2 px-3 py-2 text-xs font-semibold transition-[transform,border-color] duration-[160ms] ease-[cubic-bezier(.2,.7,.3,1)] hover:-translate-y-px hover:border-accent/50"
              >
                How to get COOK
              </Link>
            </div>
          </div>
        )
      ) : (
        // Opacity only, at the skeleton -> content swap. The ~228px -> ~700px height jump under it
        // is accepted: animating it would mean animating height, and a crossfade only makes the
        // difference more noticeable. Nothing below this line moves — no transform reaches a
        // <tr> or a <td>, on this route or any other.
        <div className="animate-fade-in overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className={cn('border-b border-hairline/10 text-left', LABEL_MUTED)}>
                <th scope="col" className="px-4 py-2 font-semibold">
                  Token
                </th>
                <th scope="col" className="px-2 py-2 text-right font-semibold">
                  Amount
                </th>
                <th scope="col" className="hidden px-2 py-2 text-right font-semibold sm:table-cell">
                  Price
                </th>
                <th scope="col" className="px-4 py-2 text-right font-semibold">
                  Value
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.key}
                  className="border-b border-hairline/10 transition-colors last:border-0 hover:bg-surface2/60"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <TokenLogo logo={r.logo} symbol={r.symbol} size={30} />
                      <div className="min-w-0 max-w-[9.5rem] sm:max-w-none">
                        <div className="flex items-center gap-1.5">
                          <a
                            href={explorerToken(r.mint)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="truncate font-semibold transition-colors hover:text-accent"
                            title={r.mint}
                          >
                            {r.symbol}
                          </a>
                          {r.native ? <Pill tone="accent">Native</Pill> : null}
                          {r.token2022 ? <Pill>Token-2022</Pill> : null}
                        </div>
                        <p className="truncate text-xs text-muted">{r.name}</p>
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-2 py-3 text-right tabular-nums text-ink2">
                    {formatAmount(r.amount, r.decimals)}
                  </td>
                  <td className="hidden whitespace-nowrap px-2 py-3 text-right tabular-nums text-ink2 sm:table-cell">
                    {formatUsd(r.priceUsd)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums">
                    {formatUsd(r.valueUsd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
