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
import { CopyButton, cn } from './ui/primitives';

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
        className="flex items-center gap-2 rounded-xl border border-hairline/10 bg-surface2 px-2.5 py-2 text-xs font-medium transition-colors hover:border-accent/50 sm:text-sm"
      >
        <span className="hidden tabular-nums text-ink2 sm:inline">
          {balanceLoading ? '…' : `${formatAmount(balance ?? 0, 4)} ${COOK_SYMBOL}`}
        </span>
        <span className="hidden h-4 w-px bg-rule sm:inline-block" />
        <span className="font-mono">{shortAddr(address)}</span>
        <ChevronDown size={13} className={cn('text-muted transition-transform', open && 'rotate-180')} />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-2 w-64 animate-fade-in rounded-xl border border-hairline/10 bg-surface p-3 shadow-xl"
        >
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Connected</p>
          <div className="mt-1 flex items-center justify-between gap-1">
            <span className="truncate font-mono text-xs text-ink2" title={address}>
              {shortAddr(address, 10, 8)}
            </span>
            <CopyButton value={address} label="address" />
          </div>

          <div className="mt-3 flex items-baseline justify-between border-t border-hairline/10 pt-3">
            <span className="text-xs text-muted">Balance</span>
            <span className="tabular-nums text-sm font-semibold">
              {balanceLoading ? '…' : `${formatAmount(balance ?? 0, 6)} ${COOK_SYMBOL}`}
            </span>
          </div>

          <a
            href={explorerAddress(address)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 flex items-center gap-2 rounded-xl px-2 py-2 text-xs text-ink2 transition-colors hover:bg-surface2 hover:text-ink"
          >
            <ExternalLink size={14} /> View on Cookiescan
          </a>
          <button
            type="button"
            onClick={onDisconnect}
            className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-xs text-down transition-colors hover:bg-down/10"
          >
            <LogOut size={14} /> Disconnect
          </button>
        </div>
      ) : null}
    </div>
  );
}
