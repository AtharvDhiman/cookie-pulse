'use client';

// Shown on every page when a connected wallet holds no COOK — without it, every transaction the app
// offers would fail at the fee, with no obvious way forward.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useWallet } from '@solana/wallet-adapter-react';
import { ArrowRight, Fuel } from 'lucide-react';
import { useCookBalance } from '@/hooks/useBalances';

export function ZeroCookBanner() {
  const { publicKey } = useWallet();
  const { data: balance, isSuccess } = useCookBalance();
  const pathname = usePathname();

  // Only when we actually know the balance is zero — never while it is still loading.
  if (!publicKey || !isSuccess || (balance ?? 0) > 0 || pathname === '/bridge') return null;

  return (
    <div className="border-b border-warn/30 bg-warn/10">
      <div className="mx-auto flex w-full max-w-[1240px] flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-xs text-ink2 sm:px-5 sm:text-[13px]">
        <Fuel size={14} className="shrink-0 text-warn" />
        <span>
          <strong className="font-semibold text-ink">No COOK in this wallet.</strong> You need a
          little to pay fees (~0.000005 COOK per signature).
        </span>
        <Link
          href="/bridge"
          className="inline-flex items-center gap-1 font-semibold text-accent hover:underline"
        >
          How to get COOK <ArrowRight size={13} />
        </Link>
      </div>
    </div>
  );
}
