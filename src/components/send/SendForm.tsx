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
import { useQuery } from '@tanstack/react-query';
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
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  explorerTx,
} from '@/lib/config';
import { formatAmount, formatUsd, shortAddr, toRawAmount } from '@/lib/format';
import { useCookBalance, useRefreshBalances, useTokenBalances } from '@/hooks/useBalances';
import { useRegistry } from '@/hooks/useMarketData';
import { useMemoProgram } from '@/hooks/useMemoProgram';
import { useTransaction, type BuiltTx, type TxState } from '@/hooks/useTransaction';
import { Button } from '@/components/ui/Button';
import { LABEL_MUTED, MICRO_ACTION, Card, cn, EmptyState, Skeleton, TokenLogo } from '@/components/ui/primitives';

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
        // The shared press model, in its full-width form. No hover lift: a w-full control that
        // rises is a 300px-wide element moving 1px, which reads as a wobble rather than as weight.
        className="press press-wide flex w-full items-center gap-2.5 rounded-xl border border-hairline/10 bg-surface2 px-3 py-2.5 transition-colors hover:border-accent/50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <AssetRow asset={selected} />
        <ChevronDown
          size={15}
          className={cn(
            'shrink-0 text-muted transition-transform duration-200 ease-[cubic-bezier(.2,.7,.3,1)]',
            open && 'rotate-180',
          )}
        />
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label="Asset to send"
          // The same house gesture as the wallet menu, re-origined for a full-width panel that
          // hangs below its trigger. Enter only, deliberately: the common dismissal changes the
          // selection underneath, so a fading panel would be showing a stale list. Note this is
          // z-30, the same as the Header — it wins on source order alone.
          style={{ transformOrigin: 'top' }}
          className="menu-in absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-xl border border-hairline/10 bg-surface p-1 shadow-xl"
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
              // No per-option stagger: this is a list you are scanning, not a block you are
              // reading. Hover is tightened to 100ms so a cursor crossing five rows does not leave
              // a trail of half-lit ones behind it.
              className={cn(
                'flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 transition-colors duration-100 hover:bg-surface2',
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

/**
 * Scrolls its own box into view once, on mount. The reduced-motion read is taken here rather than
 * left to CSS: `scroll-behavior: auto !important` governs CSS-initiated scrolls, not the JS
 * `behavior` option, so a reduced-motion user would otherwise still get a smooth ride.
 */
function ScrollOnMount({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  }, []);
  return <div ref={ref}>{children}</div>;
}

function FieldNote({ tone, children }: { tone: 'error' | 'warn'; children: React.ReactNode }) {
  return (
    <p
      className={cn(
        // Fade only — no slide, no height growth, and no reserved min-h slot (that would trade a
        // rare shift for a permanent 22px one). Appearance is debounced upstream, so this plays
        // once per address rather than once per keystroke.
        'mt-1.5 flex animate-[fade-in_140ms_var(--ease-lead)_both] items-start gap-1.5 text-xs',
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

  /**
   * Can this recipient actually own tokens?
   *
   * `new PublicKey(value)` only proves the string is 32 well-formed bytes. It says nothing about
   * what lives at that address, and the SPL path derives the destination ATA with
   * `allowOwnerOffCurve = true`, so a pasted TOKEN ACCOUNT, PDA or program id was accepted and the
   * transfer built against it. Tokens sent to an address that cannot sign are unrecoverable.
   *
   * One `getAccountInfo` answers it: an executable account is a program, and an account owned by
   * either token program is itself a token account.
   */
  const { data: recipientAccount, isFetched: recipientFetched } = useQuery({
    queryKey: ['recipient-account', recipientPk?.toBase58() ?? null],
    enabled: Boolean(recipientPk),
    queryFn: () => connection.getAccountInfo(recipientPk as PublicKey, 'confirmed'),
    staleTime: 30_000,
    retry: 1,
  });

  const recipientOwner = recipientAccount?.owner.toBase58();
  const recipientUnusable = Boolean(
    recipientAccount &&
      (recipientAccount.executable ||
        recipientOwner === TOKEN_PROGRAM_ID ||
        recipientOwner === TOKEN_2022_PROGRAM_ID),
  );
  // The probe must have ANSWERED before the form is armed. react-query leaves `data` undefined
  // while pending, so without this a paste-then-immediately-click sends before the check returns
  // -- which is exactly the case the check exists for.
  const recipientChecked = !recipientPk || recipientFetched;

  const recipientInvalid = recipient.trim() !== '' && !recipientPk;
  const sendingToSelf = Boolean(recipientPk && publicKey && recipientPk.equals(publicKey));

  // `new PublicKey()` runs on every keystroke, so "Not a valid address." is TRUE for almost the
  // whole of a 44-character base58 entry: typing one address used to make the note appear and
  // disappear a dozen times, shifting the layout under the cursor each time. Announce it only once
  // typing has settled, or on blur. The DISAPPEARANCE is never debounced — the keystroke that
  // completes a valid address clears the note in the same frame.
  const [recipientSettled, setRecipientSettled] = useState(false);
  useEffect(() => {
    if (recipient.trim() === '') {
      setRecipientSettled(false);
      return;
    }
    const id = setTimeout(() => setRecipientSettled(true), 350);
    return () => clearTimeout(id);
  }, [recipient]);

  const showRecipientError = recipientInvalid && recipientSettled;
  const showSelfNote = sendingToSelf && recipientSettled;

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

  // Readiness reads the parsed key, never the debounced note: what is displayed may lag by 350ms,
  // what is signed never does.
  const ready = Boolean(
    publicKey && recipientPk && amountRaw && !amountError && recipientChecked && !recipientUnusable,
  );

  const build = useCallback(async (): Promise<BuiltTx> => {
    if (!publicKey || !recipientPk || !amountRaw) throw new Error('Form is incomplete.');
    // Re-checked here rather than trusted from render state: this is the last point before a
    // transaction is built, and the consequence of being wrong is unrecoverable.
    if (recipientUnusable) {
      throw new Error('That address cannot own tokens, so anything sent there is unrecoverable.');
    }
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
  }, [amountRaw, asset, connection, memo, memoAvailable, publicKey, recipientPk, recipientUnusable]);

  const amountRef = useRef<HTMLInputElement>(null);

  const onMax = useCallback(() => {
    setAmount(rawToDecimalString(maxRaw, asset.decimals));
    const el = amountRef.current;
    if (!el || typeof el.animate !== 'function') return;
    // The eye is on the button, not on the field, so the field says it changed. Driven straight
    // through WAAPI rather than by re-keying the input (which would destroy the caret) or by
    // toggling a class across a rAF. Deliberately NOT matchMedia-gated: it is colour only, colour
    // is preserved by the reduced-motion contract, and gating it would remove this interaction's
    // only feedback. Values are read computed so the flash is correct in both themes.
    const styles = getComputedStyle(el);
    const accent = styles.getPropertyValue('--accent').trim();
    if (!accent) return;
    el.animate(
      [
        { color: `rgb(${accent})` },
        { color: `rgb(${accent})`, offset: 0.4 },
        { color: styles.color },
      ],
      { duration: 320, easing: 'cubic-bezier(.2,.7,.3,1)' },
    );
  }, [asset.decimals, maxRaw]);

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
      // Deliberately the same two ladder positions as /portfolio's ConnectPrompt, so the app's two
      // disconnected states read as one system. The Card itself only fades — it is `.glass`, and a
      // transform on a backdrop-filtered element re-blurs its whole backdrop.
      <Card className="enter-fade p-6">
        <div data-enter style={{ '--i': 0 } as React.CSSProperties}>
          <EmptyState
            title="Connect a wallet to send"
            hint="Cookie Pulse never holds your keys — Nightly signs every transfer in your browser."
          />
        </div>
        <div
          data-enter
          style={{ '--i': 1 } as React.CSSProperties}
          className="flex justify-center"
        >
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
      {/* The Card stays `.glass` and only fades; the four field groups carry the travel on the
          above-the-fold ladder. Every one of these is a self-completing CSS animation rather than
          an observer reveal — /send's form is above the fold at every viewport, and an observer
          here would show an empty card until hydration. */}
      <Card className="enter-fade space-y-4 p-4 sm:p-5">
        <div data-enter style={{ '--i': 0 } as React.CSSProperties}>
          <p className={cn('mb-1.5', LABEL_MUTED)}>Asset</p>
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

        <div data-enter style={{ '--i': 1 } as React.CSSProperties}>
          <label
            htmlFor="send-recipient"
            className={cn('mb-1.5 block', LABEL_MUTED)}
          >
            Recipient
          </label>
          <input
            id="send-recipient"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            onBlur={() => {
              // Leaving the field is a stronger settle signal than any timer.
              if (recipient.trim() !== '') setRecipientSettled(true);
            }}
            disabled={tx.pending}
            spellCheck={false}
            autoComplete="off"
            placeholder="Cookie Chain address"
            aria-invalid={showRecipientError}
            className={cn(
              'w-full rounded-xl border bg-surface2 px-3 py-2.5 font-mono text-sm outline-none transition-colors placeholder:font-sans placeholder:text-muted disabled:opacity-50',
              showRecipientError ? 'border-down/60' : 'border-hairline/10 focus:border-accent/60',
            )}
          />
          {showRecipientError ? <FieldNote tone="error">Not a valid address.</FieldNote> : null}
          {/* Stated plainly, because the consequence is permanent. A valid-looking address that
              cannot sign will accept the transfer and nobody can ever move it again. */}
          {recipientUnusable ? (
            <FieldNote tone="error">
              {recipientAccount?.executable
                ? 'That address is a program, not a wallet. Tokens sent there cannot be recovered.'
                : 'That address is a token account, not a wallet. Tokens sent there cannot be recovered.'}
            </FieldNote>
          ) : null}
          {showSelfNote ? (
            <FieldNote tone="warn">
              This is your own address. The transfer will work, but it only costs you the fee.
            </FieldNote>
          ) : null}
        </div>

        <div data-enter style={{ '--i': 2 } as React.CSSProperties}>
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <label
              htmlFor="send-amount"
              className={LABEL_MUTED}
            >
              Amount
            </label>
            {balancesLoading ? (
              // h-4, not h-3: the resolved line is text-xs in an items-baseline row, and the 4px
              // difference moved the label's baseline the moment the balance landed.
              <Skeleton className="h-4 w-24" />
            ) : (
              <span className="text-xs tabular-nums text-muted">
                Balance {formatAmount(asset.balance, asset.decimals)} {asset.symbol}
              </span>
            )}
          </div>

          {/* The focus ring is a pre-painted ::after whose OPACITY animates. Animating a box-shadow
              directly would repaint a large-radius shadow every frame on the row a user is typing
              into. */}
          <div
            className={cn(
              'relative flex items-center gap-2 rounded-xl border bg-surface2 px-3 py-2 transition-colors',
              "after:pointer-events-none after:absolute after:-inset-px after:rounded-xl after:opacity-0 after:transition-opacity after:duration-[160ms] after:content-[''] after:[box-shadow:0_0_0_3px_rgb(var(--accent)/0.10)] focus-within:after:opacity-100",
              amountError ? 'border-down/60' : 'border-hairline/10 focus-within:border-accent/60',
            )}
          >
            <input
              ref={amountRef}
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
              onClick={onMax}
              disabled={tx.pending || maxRaw === 0n}
              className={MICRO_ACTION}
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
          {/* Reserved for the life of the field whenever the asset has a price. This line used to
              appear on the first valid digit and vanish on a backspace, shoving the memo group and
              the submit button by 22px while the user typed. */}
          {asset.priceUsd !== null ? (
            <p className="mt-1.5 text-xs tabular-nums text-muted">
              ≈ {amountUsd !== null && !amountError ? formatUsd(amountUsd) : '—'}
            </p>
          ) : null}
        </div>

        {/* Outside the ladder on purpose: useMemoProgram resolves roughly a second late, so a
            group carrying --i 3 would play a lone entrance a full beat after everything else had
            settled. A plain fade, no translate, no delay. */}
        {memoAvailable ? (
          <div className="enter-fade">
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <label
                htmlFor="send-memo"
                className={LABEL_MUTED}
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

        <div data-enter style={{ '--i': 3 } as React.CSSProperties}>
          <Button type="submit" loading={tx.pending} disabled={!ready} className="w-full">
            {BUTTON_TEXT[tx.state]}
            {tx.pending ? null : <ArrowRight size={15} />}
          </Button>
        </div>
      </Card>

      {/* Shorter than every other entrance here, deliberately: a failure the user has to read and
          act on should not be paced. `solid`, because it moves. The <details> disclosure below is
          left un-animated — a JS height animation on a <pre> of arbitrary length is a banned
          layout animation and it would delay the logs the user needs. */}
      {tx.error ? (
        <ScrollOnMount>
          <Card variant="solid" className="animate-rise-in border-down/40 bg-down/5 p-4">
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
        </ScrollOnMount>
      ) : null}

      {/* The payoff, and this surface's one --ease-settle entrance — the curve that reads as
          "landed". BANNED here and not up for discussion: confetti, a pulsing glow, a shimmer
          sweep, an animated border. This is a financial confirmation, and an infinite loop on one
          never stops. onConfirmed refreshes balances, so the AssetPicker figures change within a
          second of this card appearing; they change instantly and silently, as every polled figure
          on this route does. */}
      {tx.state === 'confirmed' && tx.signature ? (
        <ScrollOnMount>
          <Card
            variant="solid"
            // `rise-in`, not a bespoke `send-confirm` keyframe: Tailwind only emits @keyframes for
            // names its own `animation` theme keys reference, so an arbitrary animation naming a
            // keyframe nothing else uses resolves to an unknown name and plays nothing at all.
            // `rise-in` is emitted (animate-rise-in is used on the error card below), so re-timing
            // it here to 460ms on the settle curve is the same gesture with live CSS behind it.
            className="flex animate-[rise-in_460ms_var(--ease-settle)_both] flex-wrap items-center justify-between gap-2 border-up/40 bg-up/5 p-4"
          >
            <p className="flex items-center gap-2 text-sm font-semibold text-up">
              <span className="inline-flex animate-[check-pop_380ms_var(--ease-settle)_120ms_both]">
                <Check size={15} />
              </span>
              Sent
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
        </ScrollOnMount>
      ) : null}
    </form>
  );
}
