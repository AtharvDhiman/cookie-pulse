'use client';

import type { CSSProperties } from 'react';
import { Fuel, ShieldCheck } from 'lucide-react';
import { COOK_SYMBOL, FEE_RESERVE_COOK } from '@/lib/config';
import { Reveal } from '@/components/motion/Reveal';
import { SendForm } from '@/components/send/SendForm';

export default function SendPage() {
  return (
    <div className="mx-auto max-w-xl py-4">
      <header className="mb-5">
        <h1
          data-enter
          style={{ '--i': 0 } as CSSProperties}
          className="font-display text-[26px] font-extrabold leading-tight tracking-tightest sm:text-[34px]"
        >
          Send
        </h1>
        {/* The mainnet warning gets no emphasis animation, no colour pulse and no delayed
            entrance. A safety notice that performs reads as marketing, and gets discounted by
            exactly the people who need it. It rides the same ladder as any other paragraph. */}
        <p data-enter style={{ '--i': 1 } as CSSProperties} className="mt-2 text-sm text-ink2">
          Transfer native {COOK_SYMBOL} or any token this wallet holds to another Cookie Chain
          address. Mainnet only — every transfer moves real funds.
        </p>
      </header>

      <SendForm />

      {/* The only genuine scroll reveal on /send, and the cheapest correct one in the app. The
          route is 1.0-1.3 viewports tall, so the progress bar suppresses itself via the
          data-scrollable gate — no scroll length is manufactured to justify a parallax. */}
      <ul className="mt-5 space-y-2 text-xs text-muted">
        <Reveal as="li" index={0} className="flex items-start gap-2">
          <Fuel size={13} className="mt-0.5 shrink-0" />
          <span>
            Max keeps {FEE_RESERVE_COOK} {COOK_SYMBOL} back so the wallet can still pay for its next
            signature. A token transfer also pays rent if the recipient has no account for that mint
            yet.
          </span>
        </Reveal>
        <Reveal as="li" index={1} className="flex items-start gap-2">
          <ShieldCheck size={13} className="mt-0.5 shrink-0" />
          <span>
            Addresses are not reversible — check the recipient before approving. The transaction is
            simulated before it is broadcast, and any failure is shown with its logs.
          </span>
        </Reveal>
      </ul>
    </div>
  );
}
