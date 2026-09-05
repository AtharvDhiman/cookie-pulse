import { fetchMarkets } from '@/lib/cookiescan';
import { CACHE_HEADERS, errorResponse } from '@/lib/http';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const snapshot = await fetchMarkets();
    return Response.json(snapshot, { headers: CACHE_HEADERS });
  } catch (e) {
    return errorResponse(e);
  }
}
