// DAS (Metaplex Digital Asset Standard) proxy — `getAssetsByOwner` for the portfolio NFT grid.
// Best effort by design: the portfolio hides the section rather than erroring if this fails.
import { PublicKey } from '@solana/web3.js';
import { serverConfig } from '@/lib/config';
import { CACHE_HEADERS, errorResponse, fetchJson } from '@/lib/http';
import { num, pick, str } from '@/lib/normalize';
import type { WalletNft } from '@/lib/types';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

/** DAS puts the display image under `content.links.image`, sometimes only in `content.files[]`. */
function imageOf(asset: unknown): string | null {
  const link = str(pick(asset, ['content', 'links', 'image']));
  if (link) return link;
  const files = pick(asset, ['content', 'files']);
  if (Array.isArray(files)) {
    for (const f of files) {
      const uri = str(pick(f, ['cdn_uri'])) ?? str(pick(f, ['uri']));
      const mime = str(pick(f, ['mime'])) ?? '';
      if (uri && (mime.startsWith('image/') || mime === '')) return uri;
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
    const json = await fetchJson<unknown>(serverConfig.cookiescan(), {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'assets',
        method: 'getAssetsByOwner',
        params: { ownerAddress: owner, page: 1, limit: 50, displayOptions: { showFungible: false } },
      }),
      timeoutMs: 15_000,
    });
    const items = pick(json, ['result', 'items']);
    const nfts = Array.isArray(items)
      ? items.map(toNft).filter((n): n is WalletNft => n !== null)
      : [];
    return Response.json(
      { nfts, total: num(pick(json, ['result', 'total'])) ?? nfts.length },
      { headers: CACHE_HEADERS },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
