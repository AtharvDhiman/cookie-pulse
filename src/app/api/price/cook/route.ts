import { fetchCookPrice } from '@/lib/cookiescan';
import { CACHE_HEADERS, errorResponse } from '@/lib/http';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const price = await fetchCookPrice();
    return Response.json(price, { headers: CACHE_HEADERS });
  } catch (e) {
    return errorResponse(e);
  }
}
