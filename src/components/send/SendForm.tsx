'use client';

// Send COOK or any held token. Two build paths — SystemProgram.transfer for native COOK, an
// idempotent ATA create + transferChecked for SPL / Token-2022 — compiled into one v0 transaction so
// `useTransaction` has a single sign → simulate → send → confirm path.
//
// Buffer is imported explicitly: the memo instruction needs it and the browser has no global.
import { Buffer } from 'buffer';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { AlertTriangle, ArrowRight, Check, ChevronDown, ExternalLink, Wallet } from 'lucide-react';
import {
  COOK_DECIMALS,
  COOK_MINT,
  COOK_SYMBOL,
  FEE_RESERVE_COOK,
  LAMPORTS_PER_COOK,
  MEMO_PROGRAM_ID,
  explorerTx,
} from '@/lib/config';
import { formatAmount, formatUsd, shortAddr, toRawAmount } from '@/lib/format';
import { useCookBalance, useRefreshBalances, useTokenBalances } from '@/hooks/useBalances';
import { useRegistry } from '@/hooks/useMarketData';
import { useMemoProgram } from '@/hooks/useMemoProgram';
import { useTransaction, type BuiltTx, type TxState } from '@/hooks/useTransaction';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState, Skeleton, TokenLogo, cn } from '@/components/ui/primitives';

/** Reserve, in lamports. Kept unspent so the wallet can still pay for a follow-up signature. */
const FEE_RESERVE_RAW = BigInt(Math.round(FEE_RESERVE_COOK * LAMPORTS_PER_COOK));
/** Comfortably inside the 1232-byte transaction limit even with 4-byte characters. */
const MEMO_MAX_CHARS = 180;

interface AssetBase {
  key: string;
  mint: string;
  symbol: string;
  name: string;
  logo: string | null;
  decimals: number;
  /** Whole units, for display only. */
  balance: number;
  /** Base units — the value every comparison is made against. */
  rawBalance: bigint;
  priceUsd: number | null;
}

/** Discriminated so `kind === 'spl'` narrows `programId` to a string at the build site. */
type Asset =
  | (AssetBase & { kind: 'native'; programId: null })
  | (AssetBase & { kind: 'spl'; programId: string });

const BUTTON_TEXT: Record<TxState, string> = {
  idle: 'Send',
  building: 'Building…',
  'awaiting-signature': 'Approve in Nightly…',
  simulating: 'Simulating…',
  sending: 'Sending…',
  confirming: 'Confirming…',
  confirmed: 'Send',
  failed: 'Send',
};

/** Base units -> decimal string, exactly. `fromRawAmount` returns a float and is display-only. */
function rawToDecimalString(raw: bigint, decimals: number): string {
  const digits = raw.toString().padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const frac = digits.slice(digits.length - decimals).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}

/** RPC amounts are strings; never let a malformed one throw during render. */
function safeBigInt(value: string): bigint {
  return /^\d+$/.test(value) ? BigInt(value) : 0n;
}

function AssetRow({ asset }: { asset: Asset }) {
  return (
    <>
      <TokenLogo logo={asset.logo} symbol={asset.symbol} size={26} />
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm font-semibold">{asset.symbol}</span>
        <span className="block truncate text-[11px] text-muted">{asset.name}</span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-sm font-semibold tabular-nums">
          {formatAmount(asset.balance, asset.decimals)}
        </span>
        {asset.priceUsd !== null ? (
          <span className="block text-[11px] tabular-nums text-muted">
            {formatUsd(asset.balance * asset.priceUsd)}
          </span>
        ) : null}
      </span>
    </>
  );
}

function AssetPicker({
  assets,
  selected,
  onSelect,
  disabled,
}: {
  assets: Asset[];
  selected: Asset;
  onSelect: (key: string) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`Asset to send: ${selected.symbol}`}
        className="flex w-full items-center gap-2.5 rounded-xl border border-hairline/10 bg-surface2 px-3 py-2.5 transition-colors hover:border-accent/50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <AssetRow asset={selected} />
        <ChevronDown
          size={15}
          className={cn('shrink-0 text-muted transition-transform', open && 'rotate-180')}
        />
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label="Asset to send"
          className="absolute left-0 right-0 z-30 mt-1 max-h-72 animate-fade-in overflow-y-auto rounded-xl border border-hairline/10 bg-surface p-1 shadow-xl"
        >
          {assets.map((a) => (
            <button
              key={a.key}
              type="button"
              role="option"
              aria-selected={a.key === selected.key}
              onClick={() => {
                onSelect(a.key);
                setOpen(false);
              }}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 transition-colors hover:bg-surface2',
                a.key === selected.key && 'bg-surface2',
              )}
            >
              <AssetRow asset={a} />
              {a.key === selected.key ? (
                <Check size={14} className="shrink-0 text-accent" />
              ) : (
                <span className="w-[14px] shrink-0" />
              )}
            </button>
          ))}
          {assets.length === 1 ? (
            <p className="px-2.5 py-2 text-[11px] text-muted">
              No other tokens in this wallet yet.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function FieldNote({ tone, children }: { tone: 'error' | 'warn'; children: React.ReactNode }) {
  return (
    <p
      className={cn(
        'mt-1.5 flex items-start gap-1.5 text-xs',
        tone === 'error' ? 'text-down' : 'text-warn',
      )}
    >
      <AlertTriangle size={13} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

export function SendForm() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const { byMint } = useRegistry();
  const { data: cookBalance, isLoading: cookLoading } = useCookBalance();
  const { data: tokenBalances, isLoading: tokensLoading } = useTokenBalances();
  const memoAvailable = useMemoProgram();
  const refreshBalances = useRefreshBalances();
  const tx = useTransaction();

  const [assetKey, setAssetKey] = useState('native');
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');

  const balancesLoading = Boolean(publicKey) && (cookLoading || tokensLoading);

  const assets = useMemo<Asset[]>(() => {
    const cookToken = byMint.get(COOK_MINT) ?? null;
    const cook = cookBalance ?? 0;
    const native: Asset = {
      kind: 'native',
      programId: null,
      key: 'native',
      mint: COOK_MINT,
      symbol: COOK_SYMBOL,
      name: 'Native COOK',
      logo: cookToken?.logo ?? null,
      decimals: COOK_DECIMALS,
      balance: cook,
      rawBalance: BigInt(Math.round(cook * LAMPORTS_PER_COOK)),
      priceUsd: cookToken?.priceUsd ?? null,
    };

    const held = (tokenBalances ?? []).map<Asset>((b) => {
      // A token account on the native mint is *wrapped* COOK — a different asset from the balance
      // above, so it never inherits the "COOK" label the registry display name gives it.
      const wrapped = b.mint === COOK_MINT;
      return {
        kind: 'spl',
        programId: b.programId,
        key: `${b.programId}:${b.mint}`,
        mint: b.mint,
        symbol: wrapped ? 'wCOOK' : (b.token?.symbol ?? shortAddr(b.mint, 4, 4)),
        name: wrapped ? 'Wrapped COOK' : (b.token?.name ?? 'Unknown token'),
        logo: b.token?.logo ?? null,
        decimals: b.decimals,
        balance: b.amount,
        rawBalance: safeBigInt(b.rawAmount),
        priceUsd: b.token?.priceUsd ?? null,
      };
    });

    return [native, ...held];
  }, [byMint, cookBalance, tokenBalances]);

  // Never index off the end: the wallet can drop a token between renders.
  const asset = assets.find((a) => a.key === assetKey) ?? assets[0];

  const recipientPk = useMemo(() => {
    const value = recipient.trim();
    if (!value) return null;
    try {
      return new PublicKey(value);
    } catch {
      return null;
    }
  }, [recipient]);

  const recipientError = recipient.trim() !== '' && !recipientPk ? 'Not a valid address.' : null;
  const sendingToSelf = Boolean(recipientPk && publicKey && recipientPk.equals(publicKey));

  const trimmedAmount = amount.trim();
  const amountRaw = trimmedAmount === '' ? null : toRawAmount(trimmedAmount, asset.decimals);
  const fracDigits = trimmedAmount.split('.')[1]?.length ?? 0;

  const amountError = useMemo(() => {
    if (trimmedAmount === '') return null;
    if (!/^\d*\.?\d*$/.test(trimmedAmount)) return 'Numbers only.';
    if (fracDigits > asset.decimals) {
      return `${asset.symbol} has ${asset.decimals} decimal places.`;
    }
    if (amountRaw === null) return 'Enter a valid amount.';
    if (safeBigInt(amountRaw) === 0n) return 'Enter an amount above zero.';
    if (safeBigInt(amountRaw) > asset.rawBalance) {
      return `More than your ${asset.symbol} balance.`;
    }
    return null;
  }, [amountRaw, asset.decimals, asset.rawBalance, asset.symbol, fracDigits, trimmedAmount]);

  const maxRaw =
    asset.kind === 'native'
      ? asset.rawBalance > FEE_RESERVE_RAW
        ? asset.rawBalance - FEE_RESERVE_RAW
        : 0n
      : asset.rawBalance;

  // Not an error: the transfer is valid, it just leaves nothing behind for the next signature.
  const leavesNoFee =
    asset.kind === 'native' &&
    amountRaw !== null &&
    !amountError &&
    safeBigInt(amountRaw) > maxRaw;

  const amountUsd =
    asset.priceUsd !== null && amountRaw !== null && !amountError
      ? Number(rawToDecimalString(safeBigInt(amountRaw), asset.decimals)) * asset.priceUsd
      : null;

  const ready = Boolean(publicKey && recipientPk && !recipientError && amountRaw && !amountError);

  const build = useCallback(async (): Promise<BuiltTx> => {
    if (!publicKey || !recipientPk || !amountRaw) throw new Error('Form is incomplete.');
    const raw = BigInt(amountRaw);

    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash('confirmed');

    const instructions: TransactionInstruction[] = [];

    if (asset.kind === 'native') {
      instructions.push(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: recipientPk,
          lamports: raw,
        }),
      );
    } else {
      const tokenProgram = new PublicKey(asset.programId);
      const mint = new PublicKey(asset.mint);
      // getAssociatedTokenAddressSync(mint, owner, allowOwnerOffCurve, programId, ataProgramId)
      const source = getAssociatedTokenAddressSync(
        mint,
        publicKey,
        false,
        tokenProgram,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      );
      // The recipient may legitimately be a PDA, so off-curve owners are allowed here.
      const destination = getAssociatedTokenAddressSync(
        mint,
        recipientPk,
        true,
        tokenProgram,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      );
      instructions.push(
        // (payer, associatedToken, owner, mint, programId, associatedTokenProgramId)
        createAssociatedTokenAccountIdempotentInstruction(
          publicKey,
          destination,
          recipientPk,
          mint,
          tokenProgram,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        ),
        // (source, mint, destination, owner, amount, decimals, multiSigners, programId)
        createTransferCheckedInstruction(
          source,
          mint,
          destination,
          publicKey,
          raw,
          asset.decimals,
          [],
          tokenProgram,
        ),
      );
    }

    const note = memo.trim();
    if (memoAvailable && note) {
      instructions.push(
        new TransactionInstruction({
          keys: [],
          programId: new PublicKey(MEMO_PROGRAM_ID),
          data: Buffer.from(note, 'utf8'),
        }),
      );
    }

    const message = new TransactionMessage({
      payerKey: publicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();

    return { transaction: new VersionedTransaction(message), blockhash, lastValidBlockHeight };
  }, [amountRaw, asset, connection, memo, memoAvailable, publicKey, recipientPk]);

  const submit = useCallback(() => {
    if (!ready || tx.pending) return;
    void tx.run({
      label: 'Send',
      build,
      onConfirmed: () => {
        refreshBalances();
        setAmount('');
      },
    });
  }, [build, ready, refreshBalances, tx]);

  if (!publicKey) {
    return (
      <Card className="p-6">
        <EmptyState
          title="Connect a wallet to send"
          hint="Cookie Pulse never holds your keys — Nightly signs every transfer in your browser."
        />
        <div className="flex justify-center">
          <Button onClick={() => setVisible(true)}>
            <Wallet size={15} /> Connect wallet
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-4"
    >
      <Card className="space-y-4 p-4 sm:p-5">
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">Asset</p>
          {balancesLoading ? (
            <Skeleton className="h-[54px] w-full" />
          ) : (
            <AssetPicker
              assets={assets}
              selected={asset}
              onSelect={setAssetKey}
              disabled={tx.pending}
            />
          )}
        </div>

        <div>
          <label
            htmlFor="send-recipient"
            className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted"
          >
            Recipient
          </label>
          <input
            id="send-recipient"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            disabled={tx.pending}
            spellCheck={false}
            autoComplete="off"
            placeholder="Cookie Chain address"
            aria-invalid={recipientError !== null}
            className={cn(
              'w-full rounded-xl border bg-surface2 px-3 py-2.5 font-mono text-sm outline-none transition-colors placeholder:font-sans placeholder:text-muted disabled:opacity-50',
              recipientError ? 'border-down/60' : 'border-hairline/10 focus:border-accent/60',
            )}
          />
          {recipientError ? <FieldNote tone="error">{recipientError}</FieldNote> : null}
          {sendingToSelf ? (
            <FieldNote tone="warn">
              This is your own address. The transfer will work, but it only costs you the fee.
            </FieldNote>
          ) : null}
        </div>

        <div>
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <label
              htmlFor="send-amount"
              className="text-xs font-semibold uppercase tracking-wider text-muted"
            >
              Amount
            </label>
            {balancesLoading ? (
              <Skeleton className="h-3 w-24" />
            ) : (
              <span className="text-xs tabular-nums text-muted">
                Balance {formatAmount(asset.balance, asset.decimals)} {asset.symbol}
              </span>
            )}
          </div>

          <div
            className={cn(
              'flex items-center gap-2 rounded-xl border bg-surface2 px-3 py-2 transition-colors',
              amountError ? 'border-down/60' : 'border-hairline/10 focus-within:border-accent/60',
            )}
          >
            <input
              id="send-amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={tx.pending}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.0"
              aria-invalid={amountError !== null}
              className="min-w-0 flex-1 bg-transparent text-lg font-semibold tabular-nums outline-none placeholder:font-normal placeholder:text-muted disabled:opacity-50"
            />
            <span className="shrink-0 text-sm font-semibold text-ink2">{asset.symbol}</span>
            <button
              type="button"
              onClick={() => setAmount(rawToDecimalString(maxRaw, asset.decimals))}
              disabled={tx.pending || maxRaw === 0n}
              className="shrink-0 rounded-md border border-hairline/10 bg-surface px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-accent transition-colors hover:border-accent/50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Max
            </button>
          </div>

          {amountError ? <FieldNote tone="error">{amountError}</FieldNote> : null}
          {leavesNoFee ? (
            <FieldNote tone="warn">
              This leaves under {FEE_RESERVE_COOK} {COOK_SYMBOL} for fees. Max keeps the reserve
              back.
            </FieldNote>
          ) : null}
          {amountUsd !== null && !amountError ? (
            <p className="mt-1.5 text-xs tabular-nums text-muted">≈ {formatUsd(amountUsd)}</p>
          ) : null}
        </div>

        {memoAvailable ? (
          <div>
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <label
                htmlFor="send-memo"
                className="text-xs font-semibold uppercase tracking-wider text-muted"
              >
                Memo <span className="font-normal normal-case tracking-normal">(optional)</span>
              </label>
              <span className="text-xs tabular-nums text-muted">
                {memo.length}/{MEMO_MAX_CHARS}
              </span>
            </div>
            <input
              id="send-memo"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              disabled={tx.pending}
              maxLength={MEMO_MAX_CHARS}
              autoComplete="off"
              placeholder="Attached on-chain, publicly visible"
              className="w-full rounded-xl border border-hairline/10 bg-surface2 px-3 py-2.5 text-sm outline-none transition-colors placeholder:text-muted focus:border-accent/60 disabled:opacity-50"
            />
          </div>
        ) : null}

        <Button type="submit" loading={tx.pending} disabled={!ready} className="w-full">
          {BUTTON_TEXT[tx.state]}
          {tx.pending ? null : <ArrowRight size={15} />}
        </Button>
      </Card>

      {tx.error ? (
        <Card className="border-down/40 bg-down/5 p-4">
          <p className="text-sm font-semibold text-down">{tx.error.title}</p>
          {tx.error.detail ? <p className="mt-1 text-xs text-ink2">{tx.error.detail}</p> : null}

          {tx.error.logs ? (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-semibold text-ink2 hover:text-ink">
                Simulation logs
              </summary>
              <pre className="mt-2 max-h-56 overflow-auto rounded-xl border border-hairline/10 bg-surface2 p-2.5 font-mono text-[11px] leading-relaxed text-ink2">
                {tx.error.logs.join('\n')}
              </pre>
            </details>
          ) : null}

          {tx.error.action === 'bridge' ? (
            <Link
              href="/bridge"
              className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline"
            >
              How to get COOK <ArrowRight size={14} />
            </Link>
          ) : null}

          {tx.error.action === 'retry' ? (
            <Button
              type="button"
              variant="secondary"
              onClick={submit}
              disabled={!ready}
              className="mt-3"
            >
              Retry
            </Button>
          ) : null}
        </Card>
      ) : null}

      {tx.state === 'confirmed' && tx.signature ? (
        <Card className="flex flex-wrap items-center justify-between gap-2 border-up/40 bg-up/5 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-up">
            <Check size={15} /> Sent
          </p>
          <a
            href={explorerTx(tx.signature)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-mono text-xs text-ink2 hover:text-accent hover:underline"
          >
            {shortAddr(tx.signature, 8, 8)} <ExternalLink size={13} />
          </a>
        </Card>
      ) : null}
    </form>
  );
}
