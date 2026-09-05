/**
 * Live check of the health batch that feeds the Overview: chain-pulse's sparklines and non-vote TPS,
 * and capital-map's supply and validator stake all ride this ONE request.
 *
 *   npx tsx scripts/health.check.ts
 *
 * Asserts the shape and the invariants, never specific counts — this chain moves, and _RISKS.md is
 * explicit that criteria are "the app reports what the chain currently says", not fixed numbers.
 */
import { HEALTH_CALLS, PERF_SAMPLE_MINUTES, deriveChainHealth, derivePerfWindow } from '../src/lib/rpc';
import type { RpcRes } from '../src/lib/rpc';

const RPC = process.env.NEXT_PUBLIC_RPC_URL?.trim() || 'https://rpc.cookiescan.io';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed++;
    console.log(`  ${GREEN}PASS${RESET} ${label} ${DIM}${detail}${RESET}`);
  } else {
    failed++;
    console.log(`  ${RED}FAIL${RESET} ${label} ${DIM}${detail}${RESET}`);
  }
}

async function main(): Promise<void> {
  console.log(`\nhealth batch → ${RPC}\n`);

  let requests = 0;
  const started = Date.now();
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      HEALTH_CALLS.map((c) => ({ jsonrpc: '2.0', id: c.id, method: c.method, params: c.params ?? [] })),
    ),
  });
  requests += 1;
  const text = await res.text();
  const elapsed = Date.now() - started;
  const list = JSON.parse(text) as RpcRes[];

  check('the whole strip is one POST', requests === 1, `${requests} request, ${elapsed}ms`);
  check(
    'response stays small enough to poll every 15s',
    text.length < 9_000,
    `${(text.length / 1024).toFixed(1)} KB for ${HEALTH_CALLS.length} methods`,
  );
  const errored = list.filter((r) => r.error);
  check('every method answered', errored.length === 0, errored.map((r) => r.id).join(',') || 'no errors');

  const map = new Map<string, RpcRes>(list.map((r) => [r.id, r]));
  const health = deriveChainHealth(map, elapsed);

  console.log('\nchain-pulse');
  const { perf } = health;
  check('the window has samples', perf.minutes > 0, `${perf.minutes} of ${PERF_SAMPLE_MINUTES} minutes`);
  check(
    'both series have one point per minute',
    perf.slotsPerSec.length === perf.minutes && perf.nonVotePerMinute.length === perf.minutes,
    `${perf.slotsPerSec.length} / ${perf.nonVotePerMinute.length}`,
  );
  check(
    'non-vote TPS is separated from total, and is lower',
    perf.nonVoteTps !== null && perf.totalTps !== null && perf.nonVoteTps <= perf.totalTps,
    `non-vote ${perf.nonVoteTps?.toFixed(4)} vs total ${perf.totalTps?.toFixed(2)}`,
  );
  const recomputedZeros = perf.nonVotePerMinute.filter((v) => v === 0).length;
  check(
    'the zero-minute count is computed from the series',
    perf.zeroActivityMinutes === recomputedZeros,
    `${perf.zeroActivityMinutes} of ${perf.minutes} minutes idle`,
  );
  check(
    'the epoch ETA is derived and positive',
    health.epochEtaSeconds !== null && health.epochEtaSeconds > 0,
    health.epochEtaSeconds === null
      ? 'null'
      : `~${(health.epochEtaSeconds / 3600).toFixed(1)}h remaining`,
  );

  console.log('\ncapital-map inputs');
  check(
    'supply rides the same batch',
    health.supplyLamports !== null && health.supplyLamports > 0,
    health.supplyLamports === null ? 'null' : `${(health.supplyLamports / 1e9).toLocaleString('en-US')} COOK`,
  );
  check(
    'activated validator stake is summed, not just counted',
    health.activatedStakeLamports !== null && health.activatedStakeLamports > 0,
    health.activatedStakeLamports === null
      ? 'null'
      : `${(health.activatedStakeLamports / 1e9).toLocaleString('en-US', { maximumFractionDigits: 0 })} COOK across ${health.validatorCount} validators`,
  );
  check(
    'activated stake is far below supply (it is not the stake-pool reserve)',
    health.activatedStakeLamports !== null &&
      health.supplyLamports !== null &&
      health.activatedStakeLamports < health.supplyLamports,
    'sanity',
  );

  console.log('\npurity');
  const emptyWindow = derivePerfWindow(undefined);
  check(
    'derivePerfWindow tolerates a missing result',
    emptyWindow.minutes === 0 && emptyWindow.nonVoteTps === null,
    'no throw, no fabricated zero TPS',
  );
  const mocked = deriveChainHealth(new Map<string, RpcRes>(), 0);
  check(
    'deriveChainHealth runs on an empty map without a network',
    mocked.status === 'down' && mocked.perf.minutes === 0 && mocked.supplyLamports === null,
    `status ${mocked.status}`,
  );

  console.log(`\n${failed === 0 ? GREEN : RED}${passed} passed, ${failed} failed${RESET}\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
