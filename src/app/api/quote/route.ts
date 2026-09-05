import { fetchQuote } from '@/lib/cookiebox';
import { errorResponse, NO_CACHE_HEADERS } from '@/lib/http';
import { parseSlippageBps } from '@/lib/config';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const p = new URL(request.url).searchParams;
  const inputMint = p.get('inputMint');
  const outputMint = p.get('outputMint');
  const amount = p.get('amount');

  if (!inputMint || !outputMint || !amount) {
    return Response.json(
      { error: 'inputMint, outputMint and amount are required' },
      { status: 400, headers: NO_CACHE_HEADERS },
    );
  }
  if (!/^\d+$/.test(amount) || amount === '0') {
    return Response.json(
      { error: 'amount must be a positive integer in raw base units' },
      { status: 400, headers: NO_CACHE_HEADERS },
    );
  }

  // Shared with /api/swap-tx: the quote on screen and the transaction built from it must resolve an
  // absent, empty or malformed field to the same slippage.
  const slippageBps = parseSlippageBps(p.get('slippageBps'));

  try {
    // null = the aggregator has no route; that is a valid answer, not an error.
    const route = await fetchQuote({
      inputMint,
      outputMint,
      amount,
      slippageBps,
      owner: p.get('owner'),
    });
    return Response.json({ route }, { headers: NO_CACHE_HEADERS });
  } catch (e) {
    return errorResponse(e);
  }
}
