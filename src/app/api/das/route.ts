// DAS (Metaplex Digital Asset Standard) proxy — `getAssetsByOwner` for the portfolio NFT grid.
// Best effort by design: the portfolio hides the section rather than erroring if this fails.
import { PublicKey } from '@solana/web3.js';
import { serverConfig } from '@/lib/config';
import { CACHE_HEADERS, errorResponse, fetchJson } from '@/lib/http';
import { normalizeLogo } from '@/lib/cookiescan';
import { pick, str } from '@/lib/normalize';
import type { WalletNft } from '@/lib/types';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

/**
 * Cookie Chain's indexer accepts `displayOptions.showFungible` and then ignores it — verified
 * 5 Sep 2026, `true` and `false` return byte-identical sets — so every SPL balance comes back
 * alongside the collectibles and has to be dropped here, by the `interface` DAS actually returns.
 * A `decimals === 0 && supply === 1` heuristic would misread a fresh mint as a collectible.
 */
const FUNGIBLE_INTERFACES = new Set(['FungibleToken', 'FungibleAsset']);

/** Unknown or missing interfaces are kept: only a positively-identified fungible is dropped. */
function isCollectible(asset: unknown): boolean {
  return !FUNGIBLE_INTERFACES.has(str(pick(asset, ['interface'])) ?? '');
}

// One page covers every wallet observed on this chain (the largest held 11 assets), but the loop
// keeps the count exact for a whale rather than silently reporting a page as the whole holding.
const PAGE_SIZE = 500;
const MAX_PAGES = 4;

async function fetchAssets(owner: string): Promise<unknown[]> {
  const items: unknown[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const json = await fetchJson<unknown>(serverConfig.cookiescan(), {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'assets',
        method: 'getAssetsByOwner',
        params: { ownerAddress: owner, page, limit: PAGE_SIZE },
      }),
      timeoutMs: 15_000,
    });
    const batch = pick(json, ['result', 'items']);
    if (!Array.isArray(batch) || batch.length === 0) break;
    items.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return items;
}

/**
 * DAS puts the display image under `content.links.image`, sometimes only in `content.files[]`.
 *
 * Every URL here is off-chain and arbitrary, and NFT metadata leans on IPFS even harder than the
 * token registry does — so the same dead-gateway rewrite applies, or /portfolio's NFT grid shows
 * empty tiles for the same invisible reason the screener showed letter badges.
 */
function imageOf(asset: unknown): string | null {
  const link = normalizeLogo(str(pick(asset, ['content', 'links', 'image'])));
  if (link) return link;
  const files = pick(asset, ['content', 'files']);
  if (Array.isArray(files)) {
    for (const f of files) {
      const uri = str(pick(f, ['cdn_uri'])) ?? str(pick(f, ['uri']));
      const mime = str(pick(f, ['mime'])) ?? '';
      if (uri && (mime.startsWith('image/') || mime === '')) return normalizeLogo(uri);
    }
  }
  return null;
}

function toNft(asset: unknown): WalletNft | null {
  const id = str(pick(asset, ['id']));
  if (!id) return null;
  const grouping = pick(asset, ['grouping']);
  const collection = Array.isArray(grouping)
    ? (str(pick(grouping[0], ['group_value'])) ?? null)
    : null;
  return {
    id,
    name: str(pick(asset, ['content', 'metadata', 'name'])) ?? 'Untitled',
    image: imageOf(asset),
    collection,
  };
}

export async function GET(request: Request) {
  const owner = new URL(request.url).searchParams.get('owner');
  if (!owner) return Response.json({ error: 'owner is required' }, { status: 400 });
  try {
    new PublicKey(owner);
  } catch {
    return Response.json({ error: 'owner is not a valid address' }, { status: 400 });
  }

  try {
    const nfts = (await fetchAssets(owner))
      .filter(isCollectible)
      .map(toNft)
      .filter((n): n is WalletNft => n !== null);
    // `result.total` counts fungibles too, so it is not an NFT count. The filtered length is.
    return Response.json({ nfts, total: nfts.length }, { headers: CACHE_HEADERS });
  } catch (e) {
    return errorResponse(e);
  }
}
