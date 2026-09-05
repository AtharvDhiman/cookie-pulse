import { PublicKey } from '@solana/web3.js';
import { buildSwapTx } from '@/lib/cookiebox';
import { errorResponse, NO_CACHE_HEADERS } from '@/lib/http';
import { MAX_SLIPPAGE_BPS } from '@/lib/config';
import { pick } from '@/lib/normalize';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

const bad = (error: string) => Response.json({ error }, { status: 400, headers: NO_CACHE_HEADERS });

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bad('body must be JSON');
  }

  const inputMint = pick(body, ['inputMint']);
  const outputMint = pick(body, ['outputMint']);
  const amount = pick(body, ['amount']);
  const owner = pick(body, ['owner']);

  if (typeof inputMint !== 'string' || typeof outputMint !== 'string') {
    return bad('inputMint and outputMint are required');
  }
  const rawAmount = String(amount ?? '');
  if (!/^\d+$/.test(rawAmount) || rawAmount === '0') {
    return bad('amount must be a positive integer in raw base units');
  }
  if (typeof owner !== 'string') return bad('owner is required');
  try {
    // Reject a malformed owner here rather than paying a 60s aggregator timeout to learn it.
    new PublicKey(owner);
  } catch {
    return bad('owner is not a valid address');
  }

  const requested = Number(pick(body, ['slippageBps']));
  const slippageBps = Number.isFinite(requested)
    ? Math.min(Math.max(Math.round(requested), 1), MAX_SLIPPAGE_BPS)
    : 100;

  try {
    const built = await buildSwapTx({ inputMint, outputMint, amount: rawAmount, slippageBps, owner });
    return Response.json(built, { headers: NO_CACHE_HEADERS });
  } catch (e) {
    return errorResponse(e);
  }
}
