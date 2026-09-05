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
import { AlertTriangle, ArrowDownUp, ArrowUpRight, Loader2, PauseCircle, RotateCw } from 'lucide-react';
import { postSwapTx } from '@/lib/api';
import {
  COOK_DECIMALS,
  COOK_MINT,
  COOK_SYMBOL,
  DEFAULT_SLIPPAGE_BPS,
  FEE_RESERVE_COOK,
  LAMPORTS_PER_COOK,
  MAX_SLIPPAGE_BPS,
  SLIPPAGE_PRESETS,
  TOKEN_ACCOUNT_RENT_LAMPORTS,
  explorerTx,
  slippageLabel,
} from '@/lib/config';
import { formatAmount, formatUsd, fromRawAmount, shortAddr, toRawAmount } from '@/lib/format';
import { PresentableError, type FriendlyError } from '@/lib/errors';
import { rankableTokens, useMarkets, useRegistry, useTokenDirectory } from '@/hooks/useMarketData';
import { useMintAudit } from '@/hooks/useMintAudit';
import { assessImpostor } from '@/lib/impostor';
import { describeMintFacts } from '@/lib/mintSafety';
import type { Quote } from '@/lib/types';
import { useCookBalance, useRefreshBalances, useTokenBalances } from '@/hooks/useBalances';
import { useTransaction, type TxState } from '@/hooks/useTransaction';
import { useQuote } from '@/hooks/useQuote';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState, Skeleton, cn } from '@/components/ui/primitives';
import { RouteDisplay, compareRoutes, describeRouteCheck, type RouteCheck } from './RouteDisplay';
import { TokenPicker } from './TokenPicker';

/**
 * The same five in-flight strings /send already uses. Two signature surfaces naming the same states
 * differently is the clearest incoherence in the product, so this table is deliberately identical
 * to SendForm's — only the verb differs.
 */
const BUTTON_TEXT: Record<TxState, string> = {
  idle: 'Swap',
  building: 'Building…',
  'awaiting-signature': 'Approve in Nightly…',
  simulating: 'Simulating…',
  sending: 'Sending…',
  confirming: 'Confirming…',
  confirmed: 'Swap',
  failed: 'Swap',
};

/** Above this the impact is amber; above HIGH_IMPACT_PCT it is red and warned about explicitly. */
const WARN_IMPACT_PCT = 1;
const HIGH_IMPACT_PCT = 5;
const RAISED_SLIPPAGE_BPS = 300;

/** The COOK fee reserve in lamports, so the MAX button and the sufficiency check stay exact. */
const FEE_RESERVE_RAW = BigInt(Math.round(FEE_RESERVE_COOK * LAMPORTS_PER_COOK));

/** A wallet's holding of one mint: every account it has for that mint, summed exactly. */
interface Holding {
  raw: bigint;
  decimals: number;
}

/**
 * Raw base units from the RPC (`tokenAmount.amount`) as a BigInt. Guarded because a bare `BigInt()`
 * on an unexpected string throws, and that would take the whole panel down rather than one row.
 */
const safeBigInt = (v: string): bigint => (/^\d+$/.test(v) ? BigInt(v) : 0n);

/** Raw base units -> an exact decimal string. Used for MAX so the field matches the account exactly. */
function rawToDecimalString(raw: string, decimals: number): string {
  const digits = raw.replace(/[^\d]/g, '') || '0';
  const padded = digits.padStart(decimals + 1, '0');
  const whole = padded.slice(0, padded.length - decimals).replace(/^0+(?=\d)/, '');
  const frac = padded.slice(padded.length - decimals).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
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

  /**
   * What the last confirmed swap actually was. Not a status — `tx.state` and `tx.signature` remain
   * the only sources for that — just the human-readable record, so the block can still name the
   * trade after `onConfirmed` has cleared the amount field. Dropped the moment the user changes the
   * amount or the pair, so it can never describe a different trade than the one on screen.
   */
  const [receipt, setReceipt] = useState<{ signature: string; summary: string } | null>(null);

  // Only 3 tokens have any 24h volume (NOTES.md), so this reliably lands on the one live pair.
  const defaultOutMint = useMemo(() => {
    const ranked = [...rankableTokens(tokens)].sort(
      (a, b) => b.volume24h - a.volume24h || b.liquidityUsd - a.liquidityUsd,
    );
    return ranked[0]?.mint ?? null;
  }, [tokens]);

  // A deep link can name a mint the priced projection does not carry — the screener's own Trade
  // button emits exactly those links for unpriced rows. Resolve them by mint rather than silently
  // substituting a different token: changing what the user is about to trade, without saying so, is
  // the worst possible way to handle a link that was perfectly valid.
  const linkedMints = useMemo(
    () => [initialInMint, initialOutMint].filter((m): m is string => Boolean(m)),
    [initialInMint, initialOutMint],
  );
  const directory = useTokenDirectory(linkedMints);

  // Resolve the pair once the registry lands. A mint neither the registry nor the directory knows
  // has no decimals and cannot be quoted, so it still falls back — but now it says so.
  const registryReady = tokens.length > 0;
  const [unresolvedMint, setUnresolvedMint] = useState<string | null>(null);
  useEffect(() => {
    if (!registryReady) return;
    // Wait for an in-flight lookup before judging a linked mint unknown.
    const pendingLookup = linkedMints.some((m) => !directory.has(m));
    setInputMint((cur) => (cur && directory.has(cur) ? cur : pendingLookup ? cur : COOK_MINT));
    setOutputMint((cur) => (cur && directory.has(cur) ? cur : pendingLookup ? cur : defaultOutMint));
    setUnresolvedMint(
      pendingLookup ? null : (linkedMints.find((m) => !directory.has(m)) ?? null),
    );
  }, [registryReady, directory, defaultOutMint, linkedMints]);

  const inputToken = inputMint ? (directory.get(inputMint) ?? null) : null;
  const outputToken = outputMint ? (directory.get(outputMint) ?? null) : null;

  // One exact holding per mint, summed in raw base units across every account the wallet has for
  // it. The Balance line, the MAX button and the sufficiency check all read this one number: they
  // used to disagree, because the display summed the accounts while MAX filled from the largest.
  const holdings = useMemo(() => {
    const m = new Map<string, Holding>();
    for (const b of tokenBalances ?? []) {
      const prev = m.get(b.mint);
      // Decimals belong to the mint, so two of its accounts cannot honestly disagree about them.
      // If one does, it is skipped rather than added as though it were the same unit.
      if (prev && prev.decimals !== b.decimals) continue;
      m.set(b.mint, { raw: (prev?.raw ?? 0n) + safeBigInt(b.rawAmount), decimals: b.decimals });
    }
    // Native COOK wins over any wrapped account carrying the same mint.
    if (typeof cookBalance === 'number') {
      m.set(COOK_MINT, {
        raw: BigInt(Math.round(cookBalance * LAMPORTS_PER_COOK)),
        decimals: COOK_DECIMALS,
      });
    }
    return m;
  }, [tokenBalances, cookBalance]);

  /** The picker only sorts and labels rows, so a float is enough there. */
  const balances = useMemo(() => {
    const m = new Map<string, number>();
    for (const [mint, h] of holdings) m.set(mint, fromRawAmount(h.raw.toString(), h.decimals));
    return m;
  }, [holdings]);

  // An in-flight balance query is "unknown", not zero — see `exceedsBalance`, which must not
  // claim the wallet is short while the RPC is still answering.
  const balancesLoading = connected && (cookLoading || tokensLoading);

  // The typed amount is parsed with the registry's decimals, so a holding recorded under different
  // ones cannot be compared with it. Both describe the same mint; this only fires if Cookiescan's
  // metadata has drifted from the chain.
  const inputHolding = useMemo<Holding | null>(() => {
    if (!inputToken) return null;
    const h = holdings.get(inputToken.mint);
    return h && h.decimals === inputToken.decimals ? h : null;
  }, [holdings, inputToken]);

  const inputBalanceRaw = inputHolding?.raw ?? 0n;
  const inputBalance = inputHolding
    ? fromRawAmount(inputBalanceRaw.toString(), inputHolding.decimals)
    : 0;
  const outputBalance = outputToken ? (balances.get(outputToken.mint) ?? 0) : 0;

  // COOK pays for this very transaction and for the token accounts the router may open on the way
  // through, so the reserve is never spendable. Held in raw units so the figure MAX fills is the
  // same figure this check compares against, to the last base unit.
  const spendableRaw =
    inputToken?.mint === COOK_MINT
      ? inputBalanceRaw > FEE_RESERVE_RAW
        ? inputBalanceRaw - FEE_RESERVE_RAW
        : 0n
      : inputBalanceRaw;
  const spendable = inputHolding
    ? fromRawAmount(spendableRaw.toString(), inputHolding.decimals)
    : 0;

  /** What MAX fills: exact to the token's full precision, never a rounded float. */
  const maxAmountText =
    inputHolding && spendableRaw > 0n
      ? rawToDecimalString(spendableRaw.toString(), inputHolding.decimals)
      : '';
  /** The same quantity the Balance line shows, unrounded — the line displays it as a tooltip. */
  const exactBalanceText = inputHolding
    ? rawToDecimalString(inputBalanceRaw.toString(), inputHolding.decimals)
    : '';

  const rawAmount = inputToken ? toRawAmount(amount, inputToken.decimals) : null;
  const typed = amount.trim() !== '';
  const hasAmount = rawAmount !== null && rawAmount !== '0';
  const tooPrecise = typed && inputToken !== null && rawAmount === null;
  const amountNum = Number(amount);
  // Compared in raw base units, so "Not enough" can never contradict the MAX button beside it.
  const exceedsBalance =
    connected &&
    !balancesLoading &&
    rawAmount !== null &&
    rawAmount !== '0' &&
    safeBigInt(rawAmount) > spendableRaw;
  const samePair = inputMint !== null && inputMint === outputMint;

  const { quote, noRoute, isQuoting, isRefreshing, isPaused, error: quoteError, refetch } =
    useQuote({
      inputMint,
      outputMint,
      amount,
      inputDecimals: inputToken?.decimals ?? null,
      slippageBps,
      owner: address,
      // "You receive" must not move while Nightly is open: the quote the user approves has to be
      // the one they read. The 10s refresh resumes the moment the run reaches confirmed or failed.
      paused: tx.pending,
    });

  // Result of the last build-time re-quote, tagged with the quote it was computed against. Read
  // back only for that same quote, so a "matches your quote" confirmation can never outlive the
  // quote it was about — no effect needed to expire it.
  const [lastCheck, setLastCheck] = useState<{ quote: Quote; check: RouteCheck } | null>(null);
  const routeCheck = lastCheck && lastCheck.quote === quote ? lastCheck.check : null;

  const { audit } = useMintAudit();
  const { data: marketsSnapshot } = useMarkets();

  /** Pools per mint, from the markets cache — evidence for "which token wearing this symbol is used". */
  const poolCountByMint = useMemo(() => {
    const m = new Map<string, number>();
    for (const mk of marketsSnapshot?.markets ?? []) {
      for (const mint of [mk.base.mint, mk.quote.mint]) {
        if (mint) m.set(mint, (m.get(mint) ?? 0) + 1);
      }
    }
    return m;
  }, [marketsSnapshot]);

  /**
   * What the chain says about the token being received, stated as facts. Never a verdict: an open
   * mint authority is normal for a liquid-staking token, and this panel has no way to know intent.
   */
  const outputNotes = useMemo(() => {
    if (!outputToken) return [];
    const facts = audit?.byMint.get(outputToken.mint) ?? null;
    // Only claim "no account on chain" once the audit has actually answered for the others.
    const mintAccountExists = audit ? !audit.missing.includes(outputToken.mint) : true;
    const sameSymbol = tokens.filter(
      (t) => t.symbol.toLowerCase() === outputToken.symbol.toLowerCase(),
    );
    const signal = assessImpostor({ token: outputToken, sameSymbol, poolCountByMint, mintAccountExists });
    return [...(facts ? describeMintFacts(facts) : []), ...signal.notes];
  }, [outputToken, audit, tokens, poolCountByMint]);

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
    setReceipt(null);
    if (mint === outputMint) setOutputMint(inputMint);
    setInputMint(mint);
  }

  function selectOutput(mint: string) {
    setReceipt(null);
    if (mint === inputMint) setInputMint(outputMint);
    setOutputMint(mint);
  }

  function flip() {
    // Before the registry resolves, one side can still be null. Swapping then leaves the resolve
    // effect to backfill COOK into both sides, which deadlocks the quote at input === output.
    if (!inputMint || !outputMint) return;
    setReceipt(null);
    setInputMint(outputMint);
    setOutputMint(inputMint);
  }

  function onAmountChange(value: string) {
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      setReceipt(null);
      setAmount(value);
    }
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
    if (!inputToken || !outputToken || !rawAmount || !address || !quote) return;
    const owner = address;
    const amountRaw = rawAmount;
    // The quote as it stands at the click — the trade the user is agreeing to. It is frozen for the
    // rest of the run, so this is also exactly what stays on screen behind the wallet.
    const displayed = quote;
    const out = { symbol: outputToken.symbol, decimals: outputToken.decimals };
    setLastCheck(null);

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

        // That re-quote can land on different pools at a different price, and the response says
        // which — so the transaction about to be signed is checked against the quote on screen
        // before it reaches the wallet. No extra request: `res.route` is already in this response.
        const check = compareRoutes(displayed, res.route, slippageBps);
        setLastCheck({ quote: displayed, check });
        if (check.kind === 'refused') {
          throw new PresentableError({
            title: 'The route Cookiebox built is worse than the quote you saw.',
            detail: describeRouteCheck(check, out),
            logs: null,
            // No Retry: the on-screen quote is now known to be stale, and it refreshes by itself as
            // soon as this run settles. A retry against the old numbers would only be blocked again.
            action: null,
          });
        }

        return {
          transaction: VersionedTransaction.deserialize(
            Buffer.from(res.transactionBase64, 'base64'),
          ),
          blockhash: res.blockhash,
          lastValidBlockHeight: res.lastValidBlockHeight,
        };
      },
      onConfirmed: (signature) => {
        // Captured from this closure, which still holds the amounts as submitted — the fields are
        // cleared on the next line, and the toast that carries this only lives 12 seconds.
        const paid = inputToken ? `${amount} ${inputToken.symbol}` : amount;
        const received =
          outAmount !== null && outputToken
            ? `${formatAmount(outAmount, Math.min(outputToken.decimals, 6))} ${outputToken.symbol}`
            : (outputToken?.symbol ?? '');
        setReceipt({ signature, summary: received ? `${paid} → ${received}` : paid });
        refreshBalances();
        setAmount('');
      },
    });
  }

  const action = ((): { label: string; disabled: boolean; loading: boolean } => {
    if (!connected) return { label: 'Connect wallet', disabled: false, loading: false };
    if (tx.pending) return { label: BUTTON_TEXT[tx.state], disabled: true, loading: true };
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
                {/* Shown exactly whenever it fits — this is the same quantity MAX fills, less the
                    COOK fee reserve. Past 12 characters it would push the Max button off a 360px
                    row, so it falls back to a rounded figure with the exact one on the title. */}
                <span className="tabular-nums" title={exactBalanceText || undefined}>
                  Balance{' '}
                  {balancesLoading
                    ? '—'
                    : exactBalanceText.length > 0 && exactBalanceText.length <= 12
                      ? exactBalanceText
                      : formatAmount(inputBalance, 4)}{' '}
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
                // Every other control freezes while a run is in flight; these two did not, and
                // changing slippage re-keys the quote — so the numbers the user is looking at could
                // change out from under the transaction they have already sent to Nightly.
                disabled={tx.pending}
                aria-pressed={slippageBps === bps && customSlippage === ''}
                className={cn(
                  'rounded-md border px-2 py-1 text-xs font-semibold tabular-nums transition-colors',
                  'disabled:cursor-not-allowed disabled:opacity-50',
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
              disabled={tx.pending}
              onBlur={() => {
                if (customSlippage !== '') setCustomSlippage(String(slippageBps / 100));
              }}
              placeholder="Custom"
              aria-label={`Custom slippage in percent, maximum ${slippageLabel(MAX_SLIPPAGE_BPS)}`}
              className="w-16 bg-transparent text-xs font-semibold tabular-nums text-ink outline-none placeholder:font-normal placeholder:text-muted disabled:opacity-50"
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

          {/* What the chain holds about the token being received. Facts with their source, never a
              verdict — the words "unsafe", "scam" and "rug" appear nowhere in this app's copy. */}
          {outputNotes.length > 0 && outputToken ? (
            <div className="rounded-xl border border-hairline/10 bg-surface2/60 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                About {outputToken.symbol}
              </p>
              <ul className="mt-1.5 space-y-1">
                {outputNotes.map((note) => (
                  <li key={note} className="flex gap-1.5 text-xs leading-relaxed text-ink2">
                    <span aria-hidden="true" className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted" />
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 truncate font-mono text-[10px] text-muted" title={outputToken.mint}>
                {outputToken.mint}
              </p>
            </div>
          ) : null}

          {/* Survives the toast. `tx.state` is the status source; the receipt only supplies the
              wording of the trade it describes, and is dropped as soon as the panel changes. */}
          {tx.state === 'confirmed' && receipt ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-up/40 bg-up/10 p-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-up">Swap confirmed</p>
                <p className="truncate text-xs text-ink2">{receipt.summary}</p>
              </div>
              <a
                href={explorerTx(receipt.signature)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex shrink-0 items-center gap-1 font-mono text-xs text-ink2 transition-colors hover:text-accent hover:underline"
              >
                {shortAddr(receipt.signature, 6, 6)}
                <ArrowUpRight size={13} aria-hidden="true" />
              </a>
            </div>
          ) : null}

          {/* A link named a mint that neither the registry nor a by-mint lookup could resolve, so
              the pair had to fall back. Say which one, rather than quietly trading something else. */}
          {unresolvedMint ? (
            <div className="flex items-start gap-2 rounded-xl border border-warn/40 bg-warn/10 p-3">
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warn" aria-hidden="true" />
              <p className="text-xs text-ink2">
                <strong className="text-ink">This link named a token we could not resolve.</strong>{' '}
                <span className="font-mono">{shortAddr(unresolvedMint, 6, 6)}</span> is not in the
                Cookie Chain registry, so the pair below is the default, not what the link asked for.
              </p>
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
                ? `Keep at least ${FEE_RESERVE_COOK} ${COOK_SYMBOL} back — the fee, plus rent for the ` +
                  `two token accounts the router opens (${TOKEN_ACCOUNT_RENT_LAMPORTS.toLocaleString('en-US')} ` +
                  `lamports each). Spendable ${formatAmount(spendable, 6)}.`
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

        <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-[11px] text-muted">
          {isPaused ? (
            <PauseCircle size={11} aria-hidden="true" />
          ) : isRefreshing ? (
            <Loader2 size={11} className="animate-spin" aria-hidden="true" />
          ) : (
            <RotateCw size={11} aria-hidden="true" />
          )}
          {isPaused
            ? 'Quote held while this transaction is in flight'
            : 'Quotes refresh every 10s · routed by Cookiebox'}
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
            <RouteDisplay quote={quote} byMint={byMint} check={routeCheck} />
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
