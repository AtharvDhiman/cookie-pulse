'use client';

// /trade — the swap terminal.
//
// `useSearchParams` opts the tree into client-side bailout, so the component that reads ?in=/?out=
// lives inside a <Suspense> boundary; without it `next build` fails with "useSearchParams should be
// wrapped in a suspense boundary".
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { SwapPanel } from '@/components/trade/SwapPanel';
import { Card, Skeleton } from '@/components/ui/primitives';

function TradeFromParams() {
  const params = useSearchParams();
  return <SwapPanel initialInMint={params.get('in')} initialOutMint={params.get('out')} />;
}

function TradeSkeleton() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:items-start">
      <Card className="min-w-0 space-y-3 p-3 sm:p-4">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-11 w-full rounded-xl" />
      </Card>
      <Card className="min-w-0 space-y-2 p-3 sm:p-4">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-9 w-full" />
      </Card>
    </div>
  );
}

export default function TradePage() {
  return (
    <div className="py-4">
      <header className="mb-5">
        <h1 className="font-display text-[26px] font-extrabold leading-tight tracking-tightest sm:text-[34px]">Trade</h1>
        <p className="mt-2 max-w-prose text-sm text-ink2">
          Swap any Cookie Chain token through the Cookiebox aggregator. Quotes refresh every 10
          seconds, the route below shows exactly which pools your order touches, and your wallet
          signs a transaction the router built — nothing is custodial.
        </p>
      </header>

      <Suspense fallback={<TradeSkeleton />}>
        <TradeFromParams />
      </Suspense>
    </div>
  );
}
