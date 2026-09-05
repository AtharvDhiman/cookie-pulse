'use client';

// The swap panel. Every number on screen comes from the aggregator's own quote — nothing is
// re-derived locally — and the transaction itself is built server-side by Cookiebox, deserialized
// here, then handed straight to `useTransaction`, which owns sign → simulate → send → confirm and
// all of the toasts.
import { Buffer } from 'buffer';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { VersionedTransaction } from '@solana/web3.js';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { AlertTriangle, ArrowDownUp, Loader2, RotateCw } from 'lucide-react';
import { postSwapTx } from '@/lib/api';
import {
  COOK_MINT,
  COOK_SYMBOL,
  DEFAULT_SLIPPAGE_BPS,
  FEE_RESERVE_COOK,
  MAX_SLIPPAGE_BPS,
  SLIPPAGE_PRESETS,
} from '@/lib/config';
import { formatAmount, formatUsd, fromRawAmount, toRawAmount } from '@/lib/format';
import type { FriendlyError } from '@/lib/errors';
import { rankableTokens, useRegistry } from '@/hooks/useMarketData';
import type { TokenBalance } from '@/lib/types';
import { useCookBalance, useRefreshBalances, useTokenBalances } from '@/hooks/useBalances';
import { useTransaction } from '@/hooks/useTransaction';
import { useQuote } from '@/hooks/useQuote';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState, Skeleton, cn } from '@/components/ui/primitives';
import { RouteDisplay } from './RouteDisplay';
import { TokenPicker } from './TokenPicker';

/** Above this the impact is amber; above HIGH_IMPACT_PCT it is red and warned about explicitly. */
const WARN_IMPACT_PCT = 1;
const HIGH_IMPACT_PCT = 5;
const RAISED_SLIPPAGE_BPS = 300;

const slippageLabel = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;

/** Raw base units -> an exact decimal string. Used for MAX so the field matches the account exactly. */
function rawToDecimalString(raw: string, decimals: number): string {
  const digits = raw.replace(/[^\d]/g, '') || '0';
  const padded = digits.padStart(decimals + 1, '0');
  const whole = padded.slice(0, padded.length - decimals).replace(/^0+(?=\d)/, '');
  const frac = padded.slice(padded.length - decimals).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}

function trimDecimals(v: number, decimals: number): string {
  if (!Number.isFinite(v) || v <= 0) return '';
  const fixed = v.toFixed(Math.min(decimals, 9));
  return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
}

function DetailRow({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="shrink-0 text-xs text-muted" title={hint}>
        {label}
      </span>
      <span className="min-w-0 truncate text-right text-xs font-medium text-ink2">{children}</span>
    </div>
  );
}

/** null impact means the router could not measure it — an em dash, never a fake 0. */
function ImpactValue({ pct }: { pct: number | null }) {
  if (pct === null) {
    return (
      <span className="text-muted" title="The router could not measure impact for this route">
        —
      </span>
    );
  }
  return (
    <span
      className={cn(
        'tabular-nums',
        pct > HIGH_IMPACT_PCT ? 'text-down' : pct > WARN_IMPACT_PCT ? 'text-warn' : 'text-ink2',
      )}
    >
      {pct >= 0.1 ? pct.toFixed(2) : pct.toFixed(3)}%
    </span>
  );
}

function TxErrorPanel({
  error,
  onRetry,
  onRaiseSlippage,
  onDismiss,
}: {
  error: FriendlyError;
  onRetry: () => void;
  onRaiseSlippage: () => void;
  onDismiss: () => void;
}) {
  const actionClass =
    'rounded-md border border-hairline/10 bg-surface2 px-2.5 py-1.5 text-xs font-semibold text-ink transition-colors hover:border-accent/60';

  return (
    <div className="rounded-xl border border-down/40 bg-down/10 p-3">
      <div className="flex items-start gap-2">
        <AlertTriangle size={15} className="mt-0.5 shrink-0 text-down" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">{error.title}</p>
          {error.detail ? (
            <p className="mt-0.5 break-words text-xs text-ink2">{error.detail}</p>
          ) : null}

          {error.logs && error.logs.length > 0 ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-semibold text-accent">
                Simulation logs ({error.logs.length})
              </summary>
              <pre className="mt-2 max-h-52 overflow-auto rounded-md border border-hairline/10 bg-surface p-2 font-mono text-[10px] leading-relaxed text-ink2">
                {error.logs.join('\n')}
              </pre>
            </details>
          ) : null}

          <div className="mt-2.5 flex flex-wrap gap-2">
            {error.action === 'bridge' ? (
              <Link href="/bridge" className={actionClass}>
                How to get COOK
              </Link>
            ) : null}
            {error.action === 'retry' ? (
              <button type="button" onClick={onRetry} className={actionClass}>
                Retry
              </button>
            ) : null}
            {error.action === 'raise-slippage' ? (
              <button type="button" onClick={onRaiseSlippage} className={actionClass}>
                Use {slippageLabel(RAISED_SLIPPAGE_BPS)} slippage
              </button>
            ) : null}
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-md px-2.5 py-1.5 text-xs font-semibold text-muted transition-colors hover:text-ink"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SwapPanel({
  initialInMint,
  initialOutMint,
}: {
  initialInMint: string | null;
  initialOutMint: string | null;
}) {
  const { tokens, byMint, isLoading: registryLoading, isError: registryError } = useRegistry();
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const { data: cookBalance, isLoading: cookLoading } = useCookBalance();
  const { data: tokenBalances, isLoading: tokensLoading } = useTokenBalances();
  const refreshBalances = useRefreshBalances();
  const tx = useTransaction();

  const address = publicKey?.toBase58() ?? null;
  const connected = address !== null;

  const [inputMint, setInputMint] = useState<string | null>(() => initialInMint ?? COOK_MINT);
  const [outputMint, setOutputMint] = useState<string | null>(() =>
    initialOutMint && initialOutMint !== (initialInMint ?? COOK_MINT) ? initialOutMint : null,
  );
  const [amount, setAmount] = useState('');
  const [slippageBps, setSlippageBps] = useState<number>(DEFAULT_SLIPPAGE_BPS);
  const [customSlippage, setCustomSlippage] = useState('');

  // Only 3 tokens have any 24h volume (NOTES.md), so this reliably lands on the one live pair.
  const defaultOutMint = useMemo(() => {
    const ranked = [...rankableTokens(tokens)].sort(
      (a, b) => b.volume24h - a.volume24h || b.liquidityUsd - a.liquidityUsd,
    );
    return ranked[0]?.mint ?? null;
  }, [tokens]);

  // Resolve the pair once the registry lands: a mint from ?in=/?out= that the registry does not
  // know has no decimals, so it cannot be quoted — fall back rather than showing a broken field.
  const registryReady = tokens.length > 0;
  useEffect(() => {
    if (!registryReady) return;
    setInputMint((cur) => (cur && byMint.has(cur) ? cur : COOK_MINT));
    setOutputMint((cur) => (cur && byMint.has(cur) ? cur : defaultOutMint));
  }, [registryReady, byMint, defaultOutMint]);

  const inputToken = inputMint ? (byMint.get(inputMint) ?? null) : null;
  const outputToken = outputMint ? (byMint.get(outputMint) ?? null) : null;

  const balances = useMemo(() => {
    const m = new Map<string, number>();
    // A wallet can hold more than one account for the same mint, so these are summed rather than
    // last-wins — otherwise the displayed balance and MAX could disagree about the same token.
    for (const b of tokenBalances ?? []) m.set(b.mint, (m.get(b.mint) ?? 0) + b.amount);
    // Native COOK wins over any wrapped account carrying the same mint.
    if (typeof cookBalance === 'number') m.set(COOK_MINT, cookBalance);
    return m;
  }, [tokenBalances, cookBalance]);

  // An in-flight balance query is "unknown", not zero — see `exceedsBalance`, which must not
  // claim the wallet is short while the RPC is still answering.
  const balancesLoading = connected && (cookLoading || tokensLoading);
  const inputBalance = inputToken ? (balances.get(inputToken.mint) ?? 0) : 0;
  const outputBalance = outputToken ? (balances.get(outputToken.mint) ?? 0) : 0;
  // COOK pays the fee for this very transaction, so the last 0.001 is never spendable.
  const spendable =
    inputToken?.mint === COOK_MINT ? Math.max(0, inputBalance - FEE_RESERVE_COOK) : inputBalance;

  const maxAmountText = useMemo(() => {
    if (!inputToken) return '';
    if (inputToken.mint !== COOK_MINT) {
      // The largest account, chosen deterministically — `find` would take an arbitrary one when
      // the wallet holds several for this mint.
      const account = (tokenBalances ?? [])
        .filter((b) => b.mint === inputToken.mint)
        .reduce<TokenBalance | null>((best, b) => (!best || b.amount > best.amount ? b : best), null);
      // Exact when the account agrees with the registry; otherwise fall back to the float path.
      if (account && account.decimals === inputToken.decimals) {
        return rawToDecimalString(account.rawAmount, account.decimals);
      }
    }
    return trimDecimals(spendable, inputToken.decimals);
  }, [inputToken, tokenBalances, spendable]);

  const rawAmount = inputToken ? toRawAmount(amount, inputToken.decimals) : null;
  const typed = amount.trim() !== '';
  const hasAmount = rawAmount !== null && rawAmount !== '0';
  const tooPrecise = typed && inputToken !== null && rawAmount === null;
  const amountNum = Number(amount);
  const exceedsBalance =
    connected &&
    !balancesLoading &&
    hasAmount &&
    Number.isFinite(amountNum) &&
    amountNum > spendable + 1e-12;
  const samePair = inputMint !== null && inputMint === outputMint;

  const { quote, noRoute, isQuoting, isRefreshing, error: quoteError, refetch } = useQuote({
    inputMint,
    outputMint,
    amount,
    inputDecimals: inputToken?.decimals ?? null,
    slippageBps,
    owner: address,
  });

  const outAmount = quote && outputToken ? fromRawAmount(quote.netOutAmount, outputToken.decimals) : null;
  const minOut = quote && outputToken ? fromRawAmount(quote.minOutAmount, outputToken.decimals) : null;
  const feeOut = quote && outputToken ? fromRawAmount(quote.feeAmount, outputToken.decimals) : null;
  const inQuoted = quote && inputToken ? fromRawAmount(quote.inAmount, inputToken.decimals) : null;
  const rate = outAmount !== null && inQuoted !== null && inQuoted > 0 ? outAmount / inQuoted : null;
  const impact = quote?.priceImpactPct ?? null;
  const highImpact = impact !== null && impact > HIGH_IMPACT_PCT;

  const inputUsd =
    inputToken?.priceUsd != null && Number.isFinite(amountNum) && typed
      ? amountNum * inputToken.priceUsd
      : null;
  const outputUsd =
    outputToken?.priceUsd != null && outAmount !== null ? outAmount * outputToken.priceUsd : null;

  function selectInput(mint: string) {
    if (mint === outputMint) setOutputMint(inputMint);
    setInputMint(mint);
  }

  function selectOutput(mint: string) {
    if (mint === inputMint) setInputMint(outputMint);
    setOutputMint(mint);
  }

  function flip() {
    // Before the registry resolves, one side can still be null. Swapping then leaves the resolve
    // effect to backfill COOK into both sides, which deadlocks the quote at input === output.
    if (!inputMint || !outputMint) return;
    setInputMint(outputMint);
    setOutputMint(inputMint);
  }

  function onAmountChange(value: string) {
    if (value === '' || /^\d*\.?\d*$/.test(value)) setAmount(value);
  }

  function applyPreset(bps: number) {
    setSlippageBps(bps);
    setCustomSlippage('');
  }

  function onCustomSlippage(value: string) {
    if (value !== '' && !/^\d*\.?\d*$/.test(value)) return;
    setCustomSlippage(value);
    const pct = Number(value);
    if (value === '' || !Number.isFinite(pct) || pct <= 0) return;
    setSlippageBps(Math.min(Math.max(Math.round(pct * 100), 1), MAX_SLIPPAGE_BPS));
  }

  function swap() {
    if (!connected) {
      setVisible(true);
      return;
    }
    if (!inputToken || !outputToken || !rawAmount || !address) return;
    const owner = address;
    const amountRaw = rawAmount;

    void tx.run({
      label: 'Swap',
      // Cookiebox re-quotes, builds and simulates server-side and returns an unsigned v0
      // transaction with feePayer = owner. Signing, simulating, sending and confirming all
      // belong to useTransaction — this only produces the transaction.
      build: async () => {
        const res = await postSwapTx({
          inputMint: inputToken.mint,
          outputMint: outputToken.mint,
          amount: amountRaw,
          slippageBps,
          owner,
        });
        return {
          transaction: VersionedTransaction.deserialize(
            Buffer.from(res.transactionBase64, 'base64'),
          ),
          blockhash: res.blockhash,
          lastValidBlockHeight: res.lastValidBlockHeight,
        };
      },
      onConfirmed: () => {
        refreshBalances();
        setAmount('');
      },
    });
  }

  const action = ((): { label: string; disabled: boolean; loading: boolean } => {
    if (!connected) return { label: 'Connect wallet', disabled: false, loading: false };
    if (tx.pending) return { label: 'Swapping…', disabled: true, loading: true };
    if (!inputToken || !outputToken) return { label: 'Select tokens', disabled: true, loading: false };
    if (samePair) return { label: 'Select two different tokens', disabled: true, loading: false };
    if (tooPrecise)
      return {
        label: `Max ${inputToken.decimals} decimal places`,
        disabled: true,
        loading: false,
      };
    if (!hasAmount) return { label: 'Enter an amount', disabled: true, loading: false };
    if (exceedsBalance)
      return { label: `Not enough ${inputToken.symbol}`, disabled: true, loading: false };
    if (isQuoting) return { label: 'Fetching quote…', disabled: true, loading: true };
    if (noRoute) return { label: 'No route for this pair', disabled: true, loading: false };
    if (!quote) return { label: 'Quote unavailable', disabled: true, loading: false };
    return { label: `Swap ${inputToken.symbol} for ${outputToken.symbol}`, disabled: false, loading: false };
  })();

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:items-start">
      <Card className="min-w-0 p-3 sm:p-4">
        {/* ---------------- you pay ---------------- */}
        <div className="rounded-xl border border-hairline/10 bg-surface2/60 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
              You pay
            </span>
            {connected && inputToken ? (
              <div className="flex items-center gap-1.5 text-[11px] text-muted">
                <span className="tabular-nums">
                  Balance {balancesLoading ? '—' : formatAmount(inputBalance, 4)}{' '}
                  {inputToken.symbol}
                </span>
                <button
                  type="button"
                  onClick={() => setAmount(maxAmountText)}
                  disabled={!maxAmountText || tx.pending}
                  className="rounded-md border border-hairline/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent transition-colors hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Max
                </button>
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={amount}
              onChange={(e) => onAmountChange(e.target.value)}
              disabled={tx.pending}
              placeholder="0.00"
              aria-label="Amount to swap"
              className="min-w-0 flex-1 bg-transparent text-2xl font-semibold tabular-nums text-ink outline-none placeholder:text-muted disabled:opacity-60"
            />
            <TokenPicker
              label="pay with"
              token={inputToken}
              tokens={tokens}
              balances={balances}
              loading={registryLoading}
              disabled={tx.pending}
              onSelect={selectInput}
            />
          </div>

          <p className="mt-1 h-4 text-[11px] tabular-nums text-muted">
            {inputUsd !== null ? formatUsd(inputUsd) : ''}
          </p>
        </div>

        {/* ---------------- flip ---------------- */}
        <div className="relative z-10 -my-2.5 flex justify-center">
          <button
            type="button"
            onClick={flip}
            disabled={tx.pending}
            aria-label="Swap the input and output tokens"
            className="rounded-xl border border-hairline/10 bg-surface p-2 text-ink2 transition-colors hover:border-accent/60 hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ArrowDownUp size={15} />
          </button>
        </div>

        {/* ---------------- you receive ---------------- */}
        <div className="rounded-xl border border-hairline/10 bg-surface2/60 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
              You receive
            </span>
            {connected && outputToken ? (
              <span className="text-[11px] tabular-nums text-muted">
                Balance {balancesLoading ? '—' : formatAmount(outputBalance, 4)}{' '}
                {outputToken.symbol}
              </span>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              {isQuoting ? (
                <Skeleton className="h-8 w-32" />
              ) : (
                <output
                  className={cn(
                    'block truncate text-2xl font-semibold tabular-nums',
                    outAmount !== null ? 'text-ink' : 'text-muted',
                  )}
                >
                  {/* Unknown is not zero: once an amount is typed and no quote came back, this
                      renders a dash rather than a confident 0.00. */}
                  {outAmount !== null && outputToken
                    ? formatAmount(outAmount, Math.min(outputToken.decimals, 6))
                    : amount.trim() !== ''
                      ? '—'
                      : '0.00'}
                </output>
              )}
            </div>
            <TokenPicker
              label="receive"
              token={outputToken}
              tokens={tokens}
              balances={balances}
              loading={registryLoading}
              disabled={tx.pending}
              onSelect={selectOutput}
            />
          </div>

          <p className="mt-1 h-4 text-[11px] tabular-nums text-muted">
            {outputUsd !== null ? formatUsd(outputUsd) : ''}
          </p>
        </div>

        {/* ---------------- slippage ---------------- */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">Slippage</span>
          <div className="flex gap-1.5">
            {SLIPPAGE_PRESETS.map((bps) => (
              <button
                key={bps}
                type="button"
                onClick={() => applyPreset(bps)}
                aria-pressed={slippageBps === bps && customSlippage === ''}
                className={cn(
                  'rounded-md border px-2 py-1 text-xs font-semibold tabular-nums transition-colors',
                  slippageBps === bps && customSlippage === ''
                    ? 'border-accent/60 bg-accent/15 text-accent'
                    : 'border-hairline/10 bg-surface2 text-ink2 hover:border-accent/40',
                )}
              >
                {slippageLabel(bps)}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 rounded-md border border-hairline/10 bg-surface2 px-2 py-1">
            <input
              type="text"
              inputMode="decimal"
              value={customSlippage}
              onChange={(e) => onCustomSlippage(e.target.value)}
              onBlur={() => {
                if (customSlippage !== '') setCustomSlippage(String(slippageBps / 100));
              }}
              placeholder="Custom"
              aria-label={`Custom slippage in percent, maximum ${slippageLabel(MAX_SLIPPAGE_BPS)}`}
              className="w-16 bg-transparent text-xs font-semibold tabular-nums text-ink outline-none placeholder:font-normal placeholder:text-muted"
            />
            <span className="text-xs text-muted">%</span>
          </div>
          {customSlippage !== '' && Number(customSlippage) * 100 > MAX_SLIPPAGE_BPS ? (
            <span className="text-[11px] font-medium text-warn">
              Capped at {slippageLabel(MAX_SLIPPAGE_BPS)}
            </span>
          ) : null}
        </div>

        {/* ---------------- quote detail ---------------- */}
        {noRoute ? null : (
          <div className="mt-3 border-t border-hairline/10 pt-2">
            {quote && inputToken && outputToken ? (
              <>
                <DetailRow label="Rate">
                  {rate !== null
                    ? `1 ${inputToken.symbol} ≈ ${formatAmount(rate, 6)} ${outputToken.symbol}`
                    : '—'}
                </DetailRow>
                <DetailRow
                  label={`Minimum received (${slippageLabel(slippageBps)})`}
                  hint="The swap reverts on-chain if it would deliver less than this."
                >
                  {minOut !== null
                    ? `${formatAmount(minOut, Math.min(outputToken.decimals, 6))} ${outputToken.symbol}`
                    : '—'}
                </DetailRow>
                <DetailRow label="Aggregator fee">
                  {quote.feePct > 0
                    ? `${quote.feePct.toFixed(2)}% · ${formatAmount(feeOut ?? 0, 6)} ${outputToken.symbol}`
                    : 'None'}
                </DetailRow>
                <DetailRow label="Price impact">
                  <ImpactValue pct={impact} />
                </DetailRow>
              </>
            ) : (
              <p className="py-1 text-xs text-muted">
                {isQuoting
                  ? 'Asking the Cookiebox router…'
                  : 'Enter an amount to see the rate, minimum received and fee.'}
              </p>
            )}
          </div>
        )}

        {/* ---------------- inline warnings ---------------- */}
        <div className="mt-3 space-y-2">
          {noRoute ? (
            <div className="rounded-xl border border-hairline/10 bg-surface2 p-3 text-xs text-ink2">
              <p className="font-semibold text-ink">No route for this pair.</p>
              <p className="mt-0.5 text-muted">
                Cookiebox has no pool path from {inputToken?.symbol ?? 'this token'} to{' '}
                {outputToken?.symbol ?? 'that token'}. Routing through {COOK_SYMBOL} usually works.
              </p>
            </div>
          ) : null}

          {quoteError ? (
            <div className="flex items-start gap-2 rounded-xl border border-warn/40 bg-warn/10 p-3">
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warn" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-ink">Could not reach the router.</p>
                <p className="mt-0.5 break-words text-[11px] text-ink2">{quoteError.message}</p>
              </div>
              <button
                type="button"
                onClick={refetch}
                className="shrink-0 rounded-md border border-hairline/10 bg-surface2 px-2 py-1 text-[11px] font-semibold transition-colors hover:border-accent/60"
              >
                Retry
              </button>
            </div>
          ) : null}

          {highImpact ? (
            <div className="flex items-start gap-2 rounded-xl border border-down/40 bg-down/10 p-3">
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-down" aria-hidden="true" />
              <p className="text-xs text-ink2">
                <strong className="text-ink">
                  Price impact is {impact !== null ? impact.toFixed(2) : '—'}%.
                </strong>{' '}
                This trade is large relative to the pool and you will lose most of that value. Try a
                smaller amount.
              </p>
            </div>
          ) : null}

          {exceedsBalance && inputToken ? (
            <p className="text-xs text-warn">
              {inputToken.mint === COOK_MINT
                ? `Keep at least ${FEE_RESERVE_COOK} ${COOK_SYMBOL} for network fees — spendable ${formatAmount(spendable, 6)}.`
                : `You hold ${formatAmount(inputBalance, 6)} ${inputToken.symbol}.`}
            </p>
          ) : null}

          {tx.error ? (
            <TxErrorPanel
              error={tx.error}
              onRetry={swap}
              onRaiseSlippage={() => {
                applyPreset(RAISED_SLIPPAGE_BPS);
                tx.reset();
              }}
              onDismiss={tx.reset}
            />
          ) : null}
        </div>

        <Button
          onClick={swap}
          disabled={action.disabled}
          loading={action.loading}
          className="mt-3 w-full"
        >
          {action.label}
        </Button>

        <p className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-muted">
          {isRefreshing ? (
            <Loader2 size={11} className="animate-spin" aria-hidden="true" />
          ) : (
            <RotateCw size={11} aria-hidden="true" />
          )}
          Quotes refresh every 10s · routed by Cookiebox
        </p>
      </Card>

      {/* ---------------- route ---------------- */}
      <Card className="min-w-0 p-3 sm:p-4">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Route</h2>
        <div className="mt-3">
          {registryError ? (
            <EmptyState
              title="Token registry unavailable"
              hint="Cookiescan did not answer. Quotes need it to resolve decimals and symbols."
            />
          ) : quote ? (
            <RouteDisplay quote={quote} byMint={byMint} />
          ) : isQuoting ? (
            <div className="space-y-2">
              <Skeleton className="h-7 w-48" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : noRoute ? (
            <EmptyState
              title="No route for this pair"
              hint="The aggregator found no pool path between these two tokens. Most pairs route through COOK."
            />
          ) : (
            <EmptyState
              title="No quote yet"
              hint="Pick a pair and enter an amount. The venues, pools and split percentages appear here."
            />
          )}
        </div>
      </Card>
    </div>
  );
}
