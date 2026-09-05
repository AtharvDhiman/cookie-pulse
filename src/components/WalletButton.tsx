'use client';

// A custom connect button rather than WalletMultiButton: the brief needs the truncated address,
// a copy control, an explorer link and the COOK balance in the header, all themed with the app.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { ChevronDown, ExternalLink, LogOut, Wallet } from 'lucide-react';
import { explorerAddress, COOK_SYMBOL } from '@/lib/config';
import { formatAmount, shortAddr } from '@/lib/format';
import { useCookBalance } from '@/hooks/useBalances';
import { Button } from './ui/Button';
import { CopyButton, LABEL_MUTED, cn } from './ui/primitives';

export function WalletButton() {
  const { publicKey, disconnect, connecting } = useWallet();
  const { setVisible } = useWalletModal();
  const { data: balance, isLoading: balanceLoading } = useCookBalance();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Wallet state only exists in the browser; render the same markup on both passes until mounted.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

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

  const onDisconnect = useCallback(() => {
    setOpen(false);
    void disconnect();
  }, [disconnect]);

  if (!mounted || !publicKey) {
    return (
      <Button onClick={() => setVisible(true)} loading={connecting} className="px-3 py-2 text-xs sm:text-sm">
        <Wallet size={15} />
        <span className="hidden sm:inline">Connect wallet</span>
        <span className="sm:hidden">Connect</span>
      </Button>
    );
  }

  const address = publicKey.toBase58();

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="press flex items-center gap-2 rounded-xl border border-hairline/10 bg-surface2 px-2.5 py-2 text-xs font-medium transition-colors hover:border-accent/50 sm:text-sm"
      >
        {/* Fixed width: the '…'→number and 4→6 digit changes would otherwise reflow the whole
            header cluster on every 20s balance poll. No count-up — rolling a financial figure
            through wrong intermediate values on a terminal reads as a slot machine. */}
        <span className="hidden min-w-[5.5rem] text-right tabular-nums text-ink2 sm:inline">
          {/* `?? 0` printed "0.0000 COOK" when the read failed — a balance of zero is a claim,
              and /portfolio already shows an em dash for exactly this case. */}
          {balanceLoading
            ? '…'
            : balance == null
              ? `— ${COOK_SYMBOL}`
              : `${formatAmount(balance, 4)} ${COOK_SYMBOL}`}
        </span>
        <span className="hidden h-4 w-px bg-rule sm:inline-block" />
        <span className="font-mono">{shortAddr(address)}</span>
        <ChevronDown
          size={13}
          className={cn(
            'text-muted transition-transform duration-200 ease-[cubic-bezier(.2,.7,.3,1)]',
            open && 'rotate-180',
          )}
        />
      </button>

      {open ? (
        <div
          role="menu"
          className="menu-in absolute right-0 z-40 mt-2 w-64 rounded-xl border border-hairline/10 bg-surface p-3 shadow-xl"
        >
          <p className={LABEL_MUTED}>Connected</p>
          <div
            data-stagger
            style={{ '--i': 0 } as React.CSSProperties}
            className="mt-1 flex items-center justify-between gap-1"
          >
            <span className="truncate font-mono text-xs text-ink2" title={address}>
              {shortAddr(address, 10, 8)}
            </span>
            <CopyButton value={address} label="address" />
          </div>

          <div
            data-stagger
            style={{ '--i': 1 } as React.CSSProperties}
            className="mt-3 flex items-baseline justify-between border-t border-hairline/10 pt-3"
          >
            <span className="text-xs text-muted">Balance</span>
            <span className="tabular-nums text-sm font-semibold">
              {balanceLoading
                ? '…'
                : balance == null
                  ? `— ${COOK_SYMBOL}`
                  : `${formatAmount(balance, 6)} ${COOK_SYMBOL}`}
            </span>
          </div>

          <a
            href={explorerAddress(address)}
            target="_blank"
            rel="noopener noreferrer"
            data-stagger
            style={{ '--i': 2 } as React.CSSProperties}
            className="mt-3 flex items-center gap-2 rounded-xl px-2 py-2 text-xs text-ink2 transition-colors hover:bg-surface2 hover:text-ink"
          >
            <ExternalLink size={14} /> View on Cookiescan
          </a>
          <button
            type="button"
            onClick={onDisconnect}
            data-stagger
            style={{ '--i': 3 } as React.CSSProperties}
            className="press flex w-full items-center gap-2 rounded-xl px-2 py-2 text-xs text-down transition-colors hover:bg-down/10"
          >
            <LogOut size={14} /> Disconnect
          </button>
        </div>
      ) : null}
    </div>
  );
}
