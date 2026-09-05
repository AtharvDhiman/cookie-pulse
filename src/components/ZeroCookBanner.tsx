'use client';

// Shown on every page when a connected wallet holds no COOK — without it, every transaction the app
// offers would fail at the fee, with no obvious way forward.
//
// The slot is PERMANENTLY MOUNTED and animates 0fr→1fr. That is not decoration: the open condition
// depends on a 20s balance poll, so the previous mount/unmount meant a single failed poll removed
// the banner and recovery put it back — turning every RPC blip into a 37px page shove under a
// sticky header. A zero balance does not stop being zero because one poll failed, so `hasOpened`
// pins it open for the session once it has legitimately opened.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { ArrowRight, Fuel } from 'lucide-react';
import { useCookBalance } from '@/hooks/useBalances';

export function ZeroCookBanner() {
  const { publicKey } = useWallet();
  const { data: balance, isSuccess } = useCookBalance();
  const pathname = usePathname();

  // Latches on the first confirmed zero and stays latched until the balance is confirmed non-zero
  // or the wallet goes away — so a failed poll cannot close it.
  const [hasOpened, setHasOpened] = useState(false);
  const confirmedZero = isSuccess && (balance ?? 0) === 0;
  const confirmedFunded = isSuccess && (balance ?? 0) > 0;

  useEffect(() => {
    if (!publicKey) {
      setHasOpened(false);
      return;
    }
    if (confirmedZero) setHasOpened(true);
    else if (confirmedFunded) setHasOpened(false);
  }, [publicKey, confirmedZero, confirmedFunded]);

  const open = Boolean(publicKey) && hasOpened && pathname !== '/bridge';

  return (
    <div className="banner-slot" data-open={open ? '' : undefined} aria-hidden={!open}>
      <div>
        <div className="border-b border-warn/30 bg-warn/10">
          <div className="mx-auto flex w-full max-w-[1280px] flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-xs text-ink2 sm:px-6 sm:text-[13px]">
            <Fuel size={14} className="shrink-0 text-warn" aria-hidden="true" />
            <span>
              <strong className="font-semibold text-ink">No COOK in this wallet.</strong> You need a
              little to pay fees (~0.000005 COOK per signature).
            </span>
            <Link
              href="/bridge"
              // Not focusable while the row is collapsed: an invisible tab stop is worse than none.
              tabIndex={open ? undefined : -1}
              className="inline-flex items-center gap-1 font-semibold text-accent hover:underline"
            >
              How to get COOK <ArrowRight size={13} />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
