/**
 * Check a real signature against the verdict logic the UI uses.
 *
 *   npm run verify-tx -- <signature>
 *
 * The confirmation path in src/lib/confirm.ts is the highest-risk code in this app and the only
 * part that unit tests can never fully close: `verdictFor` has been exercised against synthetic
 * statuses, but until a real transaction goes through it, nothing has proved the shapes the RPC
 * actually returns match the shapes the parser expects.
 *
 * So this reads the chain twice — once for the signature status the UI polls, once for the full
 * transaction — and reports three things side by side:
 *
 *   1. What the chain says happened.
 *   2. What `verdictFor` says about it, using the same parser the UI uses.
 *   3. Whether those two agree.
 *
 * A disagreement here is the bug worth finding: it means the UI would tell someone their
 * transaction failed when it landed, or landed when it failed.
 */
import { RPC_URL } from '../src/lib/config';
import {
  parseSignatureStatus,
  verdictFor,
  describeVerdict,
  type SignatureStatus,
} from '../src/lib/confirm';

const sig = process.argv[2];
if (!sig || sig.length < 64) {
  console.error('usage: npm run verify-tx -- <signature>');
  process.exit(1);
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = (await res.json()) as { result?: T; error?: { message: string } };
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result as T;
}

function line(label: string, value: string) {
  console.log(`  ${label.padEnd(22)} ${value}`);
}

async function main() {
  console.log(`\n  signature              ${sig}`);
  console.log(`  rpc                    ${RPC_URL}\n`);

  // 1. The status the UI polls, parsed by the UI's own parser.
  const statusRaw = await rpc<{ value: unknown[] }>('getSignatureStatuses', [
    [sig],
    { searchTransactionHistory: true },
  ]);
  const status: SignatureStatus | null = parseSignatureStatus(statusRaw.value?.[0]);

  // 2. The full transaction — the ground truth.
  const tx = await rpc<{
    slot: number;
    blockTime: number | null;
    meta: { err: unknown; fee: number; logMessages: string[] | null } | null;
  } | null>('getTransaction', [sig, { maxSupportedTransactionVersion: 0 }]);

  if (!tx) {
    line('on-chain', 'NOT FOUND — the RPC has no record of this signature');
  } else {
    line('on-chain', tx.meta?.err ? 'FAILED' : 'SUCCEEDED');
    line('slot', String(tx.slot));
    line('fee', `${tx.meta ? tx.meta.fee / 1e9 : '?'} COOK`);
    if (tx.blockTime) line('block time', new Date(tx.blockTime * 1000).toISOString());
    if (tx.meta?.err) line('error', JSON.stringify(tx.meta.err));
  }

  console.log();
  line('parsed status', status ? JSON.stringify(status) : 'null (no record)');

  // The UI only reaches for the blockhash when the status is empty, so `true` here mirrors the
  // ordinary case: a transaction whose blockhash has not yet expired.
  const verdict = verdictFor(status, true);
  line('verdictFor()', typeof verdict === 'string' ? verdict : JSON.stringify(verdict));
  line('shown to user', describeVerdict(verdict));

  // 3. Do they agree?
  console.log();
  const chainSucceeded = tx !== null && !tx.meta?.err;
  const chainFailed = tx !== null && !!tx.meta?.err;
  const v = typeof verdict === 'string' ? verdict : (verdict as { kind?: string }).kind ?? '';
  const saysLanded = /land|confirm|finaliz|success/i.test(v);
  const saysFailed = /fail|error|revert/i.test(v);

  if (tx === null) {
    console.log('  ?  No on-chain record, so there is nothing to agree with. If you just sent');
    console.log('     this, wait a few seconds and re-run — propagation is not instant.');
  } else if ((chainSucceeded && saysLanded) || (chainFailed && saysFailed)) {
    console.log('  PASS  the UI verdict matches what the chain actually did.');
  } else {
    console.log('  MISMATCH  the UI would report something other than what happened.');
    console.log(`            chain=${chainSucceeded ? 'succeeded' : 'failed'} verdict=${v}`);
    process.exitCode = 1;
  }
  console.log();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
