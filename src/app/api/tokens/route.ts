import { fetchRegistry } from '@/lib/cookiescan';
import { CACHE_HEADERS, errorResponse } from '@/lib/http';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  // Default is the projected priced view. `?view=full` is the explicit opt-in behind the screener's
  // show-all toggle; anything unrecognised falls back to the cheap view rather than 400ing, because
  // a typo in a query string should not cost the caller 2.7 MB. The CDN keys on the full URL, so
  // the two views cache independently under the same s-maxage.
  const view = new URL(request.url).searchParams.get('view') === 'full' ? 'full' : 'priced';
  try {
    const registry = await fetchRegistry(view);
    return Response.json(registry, { headers: CACHE_HEADERS });
  } catch (e) {
    return errorResponse(e);
  }
}
