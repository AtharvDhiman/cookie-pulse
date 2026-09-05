'use client';

// DAS `getAssetsByOwner` is best effort — Cookie Chain's indexer is not guaranteed to cover every
// wallet, so a failed call hides the whole section rather than showing an error the user cannot act
// on. Off-chain image URLs 404 often, hence the per-tile fallback. `/api/das` returns collectibles
// only — the indexer ignores `showFungible`, so the wallet's SPL balances are dropped there rather
// than reappearing here as tiles for rows the holdings table already lists.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ImageOff } from 'lucide-react';
import { getNfts } from '@/lib/api';
import { explorerToken } from '@/lib/config';
import type { WalletNft } from '@/lib/types';
import { useReveal } from '@/hooks/useReveal';
import { Card, CardHeader, EmptyState, Skeleton, cn } from '@/components/ui/primitives';

/** Past this the ladder stops growing — only ~5-10 tiles are ever in view at lg:grid-cols-5. */
const STAGGER_CAP = 9;

function NftTile({ nft, index }: { nft: WalletNft; index: number }) {
  const [broken, setBroken] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const { ref, revealProps } = useReveal<HTMLDivElement>(index);

  // A cached image can finish decoding before React attaches onLoad, which would leave the tile
  // permanently at opacity 0. Ask the element directly, once.
  useEffect(() => {
    if (imgRef.current?.complete) setLoaded(true);
  }, []);

  return (
    // The reveal sits on this wrapper rather than on the <a>. `[data-reveal][data-shown]` resolves
    // to `transform: none` at a higher specificity than any hover utility, so a lift declared on
    // the same element would silently never fire. These grid children declare no span of their
    // own, so an extra box is safe here in a way it is not on the /overview cards.
    // This is the one real stagger on the surface, and it is legitimate because it is a visual
    // grid, not a data table: nothing inside carries a polled number.
    <div
      ref={ref}
      {...revealProps}
      style={
        {
          ...revealProps.style,
          // Tile geometry, expressed by overriding the shared tokens locally instead of inventing
          // a second reveal mechanism: less travel and a tighter beat than a full-width panel.
          '--rise-card': '10px',
          '--dur-reveal': '420ms',
          '--beat-section': '45ms',
        } as CSSProperties
      }
      data-reveal-scale=""
      className="min-w-0"
    >
      <a
        href={explorerToken(nft.id)}
        target="_blank"
        rel="noopener noreferrer"
        // The border colour moves alongside the transform on purpose: under reduced motion the
        // transform is stripped and colour is the only affordance left.
        className="group block rounded-xl border border-hairline/10 bg-surface2 p-2 transition-[transform,border-color] duration-[180ms] ease-[cubic-bezier(.2,.7,.3,1)] hover:-translate-y-[3px] hover:border-accent/50 active:translate-y-0 active:scale-[.995]"
      >
        <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-md bg-surface">
          {nft.image && !broken ? (
            // The lazy-image pop is fixed at the image, inside its already-sized aspect-square box,
            // so the tile never changes height. The onError -> `broken` swap only replaces a child,
            // so the wrapper's data-shown survives and the reveal cannot replay.
            <img
              ref={imgRef}
              src={nft.image}
              alt=""
              loading="lazy"
              onLoad={() => setLoaded(true)}
              onError={() => setBroken(true)}
              className={cn(
                'h-full w-full object-cover group-hover:scale-[1.04]',
                '[transition:opacity_200ms_var(--ease-lead),transform_320ms_var(--ease-lead)]',
                loaded ? 'opacity-100' : 'opacity-0',
              )}
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
    </div>
  );
}

export function NftGrid({ owner }: { owner: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['wallet-nfts', owner],
    queryFn: ({ signal }) => getNfts(owner, signal),
    staleTime: 60_000,
    retry: 1,
  });

  // Skip silently, per the brief. Instant unmount, no exit animation.
  if (isError) return null;

  const nfts = data?.nfts ?? [];

  return (
    // `solid` because the panel reveals: a transform on a backdrop-filtered surface re-blurs its
    // whole backdrop every frame.
    <Card as="section" variant="solid" reveal revealIndex={1} className="overflow-hidden">
      <CardHeader
        title="NFTs"
        meta={
          !isLoading && nfts.length > 0 ? (
            <span className="text-xs text-muted">{nfts.length} held</span>
          ) : null
        }
      />

      {isLoading ? (
        // Skeletons never reveal or stagger: 17 shimmer loops are already running on this route at
        // first load, and a reveal would stack a second transform on a nested element.
        <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="aspect-square w-full" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ))}
        </div>
      ) : nfts.length === 0 ? (
        <EmptyState title="No NFTs" hint="No collectibles indexed for this wallet on Cookie Chain." />
      ) : (
        <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-5">
          {nfts.map((nft, i) => (
            <NftTile key={nft.id} nft={nft} index={Math.min(i, STAGGER_CAP)} />
          ))}
        </div>
      )}
    </Card>
  );
}
