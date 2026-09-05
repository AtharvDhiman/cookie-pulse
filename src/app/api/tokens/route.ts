import { fetchRegistry, fetchTokensByMint } from '@/lib/cookiescan';
import { CACHE_HEADERS, errorResponse } from '@/lib/http';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

/** Enough for any wallet's holdings or a deep link, without turning this into a bulk export. */
const MAX_MINTS = 200;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  // `?mints=a,b,c` resolves identity for specific mints regardless of price — what the portfolio and
  // a /trade deep link need, since the default projection is a price feed and drops everything
  // without one. Answered from the same memoised upstream body, so it costs a filter.
  const mintsParam = params.get('mints');
  if (mintsParam !== null) {
    const mints = [...new Set(mintsParam.split(',').map((m) => m.trim()).filter(Boolean))];
    if (mints.length === 0 || mints.length > MAX_MINTS) {
      return Response.json(
        { error: `mints must name between 1 and ${MAX_MINTS} addresses` },
        { status: 400 },
      );
    }
    try {
      return Response.json(await fetchTokensByMint(mints), { headers: CACHE_HEADERS });
    } catch (e) {
      return errorResponse(e);
    }
  }

  // Default is the projected priced view. `?view=full` is the explicit opt-in behind the screener's
  // show-all toggle; anything unrecognised falls back to the cheap view rather than 400ing, because
  // a typo in a query string should not cost the caller 2.7 MB. The CDN keys on the full URL, so
  // the two views cache independently under the same s-maxage.
  const view = params.get('view') === 'full' ? 'full' : 'priced';
  try {
    const registry = await fetchRegistry(view);
    return Response.json(registry, { headers: CACHE_HEADERS });
  } catch (e) {
    return errorResponse(e);
  }
}
