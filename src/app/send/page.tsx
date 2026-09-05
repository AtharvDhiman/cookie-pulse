'use client';

import { Fuel, ShieldCheck } from 'lucide-react';
import { COOK_SYMBOL, FEE_RESERVE_COOK } from '@/lib/config';
import { SendForm } from '@/components/send/SendForm';

export default function SendPage() {
  return (
    <div className="mx-auto max-w-xl py-4">
      <header className="mb-5">
        <h1 className="font-display text-[26px] font-extrabold leading-tight tracking-tightest sm:text-[34px]">Send</h1>
        <p className="mt-2 text-sm text-ink2">
          Transfer native {COOK_SYMBOL} or any token this wallet holds to another Cookie Chain
          address. Mainnet only — every transfer moves real funds.
        </p>
      </header>

      <SendForm />

      <ul className="mt-5 space-y-2 text-xs text-muted">
        <li className="flex items-start gap-2">
          <Fuel size={13} className="mt-0.5 shrink-0" />
          <span>
            Max keeps {FEE_RESERVE_COOK} {COOK_SYMBOL} back so the wallet can still pay for its next
            signature. A token transfer also pays rent if the recipient has no account for that mint
            yet.
          </span>
        </li>
        <li className="flex items-start gap-2">
          <ShieldCheck size={13} className="mt-0.5 shrink-0" />
          <span>
            Addresses are not reversible — check the recipient before approving. The transaction is
            simulated before it is broadcast, and any failure is shown with its logs.
          </span>
        </li>
      </ul>
    </div>
  );
}
