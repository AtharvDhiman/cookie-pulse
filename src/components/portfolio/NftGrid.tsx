'use client';

// DAS `getAssetsByOwner` is best effort — Cookie Chain's indexer is not guaranteed to cover every
// wallet, so a failed call hides the whole section rather than showing an error the user cannot act
// on. Off-chain image URLs 404 often, hence the per-tile fallback.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ImageOff } from 'lucide-react';
import { getNfts } from '@/lib/api';
import { explorerToken } from '@/lib/config';
import type { WalletNft } from '@/lib/types';
import { Card, EmptyState, Skeleton } from '@/components/ui/primitives';

function NftTile({ nft }: { nft: WalletNft }) {
  const [broken, setBroken] = useState(false);

  return (
    <a
      href={explorerToken(nft.id)}
      target="_blank"
      rel="noopener noreferrer"
      className="group rounded-xl border border-hairline/10 bg-surface2 p-2 transition-colors hover:border-accent/50"
    >
      <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-md bg-surface">
        {nft.image && !broken ? (
          <img
            src={nft.image}
            alt=""
            loading="lazy"
            onError={() => setBroken(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <ImageOff size={22} className="text-muted" aria-hidden="true" />
        )}
      </div>
      <p className="mt-2 truncate text-xs font-semibold" title={nft.name}>
        {nft.name}
      </p>
      <p className="truncate text-[11px] text-muted">
        {nft.collection ? `Collection ${nft.collection.slice(0, 6)}…` : 'No collection'}
      </p>
    </a>
  );
}

export function NftGrid({ owner }: { owner: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['wallet-nfts', owner],
    queryFn: ({ signal }) => getNfts(owner, signal),
    select: (res) => res.nfts,
    staleTime: 60_000,
    retry: 1,
  });

  // Skip silently, per the brief.
  if (isError) return null;

  return (
    <Card as="section" className="overflow-hidden">
      <header className="flex items-center justify-between gap-2 border-b border-hairline/10 px-4 py-3">
        <h2 className="text-sm font-bold tracking-tight">NFTs</h2>
        {!isLoading && data && data.length > 0 ? (
          <span className="text-xs text-muted">{data.length} held</span>
        ) : null}
      </header>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="aspect-square w-full" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ))}
        </div>
      ) : !data || data.length === 0 ? (
        <EmptyState title="No NFTs" hint="Nothing indexed for this wallet on Cookie Chain." />
      ) : (
        <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-5">
          {data.map((nft) => (
            <NftTile key={nft.id} nft={nft} />
          ))}
        </div>
      )}
    </Card>
  );
}
