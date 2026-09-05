/**
 * Tests for the confirmation verdict path — the code that decides what to tell a user about a
 * transaction that is already broadcast and already spending real COOK.
 *
 *   npm run test:confirm
 *
 * `global.fetch` is stubbed rather than the module, because src/lib/rpc.ts talks to the chain
 * through plain `fetch`. That keeps the code under test completely unmodified, and lets these
 * assertions count real request volume — which is the point: the two defects this file guards
 * against were a request storm and a verdict reached from a single sample.
 */
import {
  POLL_INTERVAL_MS,
  UNKNOWN_REASON,
  describeVerdict,
  parseSignatureStatus,
  resolveConfirmation,
  verdictFor,
  type SentTx,
  type Verdict,
} from '../src/lib/confirm';

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

const SENT: SentTx = {
  signature: '5'.repeat(88),
  blockhash: 'BLOCKHASH1111111111111111111111111111111111',
  lastValidBlockHeight: 1_000,
};

interface StubPlan {
  /** Called per getSignatureStatuses request; return null for "no record". */
  status: (call: number) => unknown;
  /** Called per isBlockhashValid request. */
  blockhashValid?: (call: number) => boolean;
}

interface StubHandle {
  statusCalls: number;
  blockhashCalls: number;
  total: number;
  restore: () => void;
}

function installStub(plan: StubPlan): StubHandle {
  const original = globalThis.fetch;
  const handle: StubHandle = {
    statusCalls: 0,
    blockhashCalls: 0,
    get total() {
      return handle.statusCalls + handle.blockhashCalls;
    },
    restore: () => {
      globalThis.fetch = original;
    },
  } as StubHandle;

  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const body: unknown = JSON.parse(String(init?.body ?? '[]'));
    const calls = Array.isArray(body) ? body : [body];
    const out = calls.map((c: { id: string; method: string }) => {
      if (c.method === 'getSignatureStatuses') {
        handle.statusCalls += 1;
        return { jsonrpc: '2.0', id: c.id, result: { value: [plan.status(handle.statusCalls)] } };
      }
      if (c.method === 'isBlockhashValid') {
        handle.blockhashCalls += 1;
        const valid = plan.blockhashValid ? plan.blockhashValid(handle.blockhashCalls) : true;
        return { jsonrpc: '2.0', id: c.id, result: { value: valid } };
      }
      return { jsonrpc: '2.0', id: c.id, result: null };
    });
    return { ok: true, status: 200, json: async () => out } as unknown as Response;
  }) as typeof fetch;

  return handle;
}

const landed = (slot: number) => ({ slot, err: null, confirmationStatus: 'confirmed' });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  console.log('\nconfirm.ts — transaction verdicts\n');

  // ── Pure verdict logic ────────────────────────────────────────────────────────────────────────
  console.log('verdictFor');
  check(
    'a missing status with a live blockhash is not a verdict',
    verdictFor(null, true).kind === 'unknown',
    UNKNOWN_REASON.notIndexedYet,
  );
  check(
    'a confirmed status lands',
    verdictFor(parseSignatureStatus(landed(42)), null).kind === 'landed',
  );
  check(
    "'processed' is not a landing — it can still be dropped on a fork",
    verdictFor(parseSignatureStatus({ slot: 1, err: null, confirmationStatus: 'processed' }), null)
      .kind === 'unknown',
  );
  check(
    'an on-chain error fails, and names the slot',
    describeVerdict(
      verdictFor(parseSignatureStatus({ slot: 7, err: { InstructionError: [0, 'X'] } }), null),
    ) === 'Failed on-chain in slot 7',
  );

  // ── Regression: the request storm ─────────────────────────────────────────────────────────────
  // Once the backstop settled, the loop re-raced an already-resolved promise, so every subsequent
  // iteration returned instantly and polled as fast as the network would answer.
  console.log('\nrequest volume after the backstop settles');
  {
    const stub = installStub({ status: () => null, blockhashValid: () => true });
    // Resolves almost immediately, then the poll holds the grace window open.
    const running = resolveConfirmation(SENT, async () => {
      await sleep(30);
    });
    const WINDOW_MS = 4_200;
    await sleep(WINDOW_MS);
    const seen = stub.total;
    const ceiling = Math.ceil(WINDOW_MS / POLL_INTERVAL_MS) * 2 + 4;
    check(
      `polls are throttled to the ${POLL_INTERVAL_MS}ms interval`,
      seen <= ceiling,
      `${seen} requests in ${WINDOW_MS}ms (ceiling ${ceiling})`,
    );
    stub.restore();
    void running.catch(() => {});
  }

  // ── Regression: never-seen needs corroboration ────────────────────────────────────────────────
  // This is the only verdict whose UI tells the user it is safe to broadcast again.
  console.log('\nnever-seen requires corroboration');
  {
    const stub = installStub({ status: () => null, blockhashValid: () => false });
    const started = Date.now();
    const verdict: Verdict = await resolveConfirmation(SENT, () => new Promise(() => {}));
    const elapsed = Date.now() - started;
    check(
      'still reaches the never-seen verdict',
      verdict.kind === 'never-seen',
      describeVerdict(verdict),
    );
    check(
      'but not from a single sample — it waits a full poll interval first',
      elapsed >= POLL_INTERVAL_MS,
      `${elapsed}ms elapsed (>= ${POLL_INTERVAL_MS}ms)`,
    );
    check(
      'and re-reads the status after seeing the blockhash die',
      stub.statusCalls >= 4,
      `${stub.statusCalls} status reads across ${stub.blockhashCalls} blockhash reads`,
    );
    stub.restore();
  }

  // ── The race the ordering fix closes ──────────────────────────────────────────────────────────
  // Status read says "no record", then the blockhash read says "dead". If the transaction landed in
  // between those two round trips, the old order reported it as never seen.
  console.log('\na transaction that lands between the two reads');
  {
    const stub = installStub({
      status: (n) => (n === 1 ? null : landed(23_386_552)),
      blockhashValid: () => false,
    });
    const verdict = await resolveConfirmation(SENT, () => new Promise(() => {}));
    check(
      'is reported as landed, not never-seen',
      verdict.kind === 'landed',
      describeVerdict(verdict),
    );
    check(
      'and the slot comes from the status response',
      verdict.kind === 'landed' && verdict.slot === 23_386_552,
      `slot ${verdict.kind === 'landed' ? verdict.slot : '—'}`,
    );
    stub.restore();
  }

  // ── A malformed reply is not evidence ─────────────────────────────────────────────────────────
  console.log('\na malformed status reply');
  {
    const original = globalThis.fetch;
    let statusCalls = 0;
    globalThis.fetch = (async (_u: string, init?: RequestInit) => {
      const calls = JSON.parse(String(init?.body ?? '[]')) as { id: string; method: string }[];
      const out = calls.map((c) => {
        if (c.method === 'getSignatureStatuses') {
          statusCalls += 1;
          // `value` is not an array — the node said something we do not understand.
          return { jsonrpc: '2.0', id: c.id, result: { value: null } };
        }
        return { jsonrpc: '2.0', id: c.id, result: { value: false } };
      });
      return { ok: true, status: 200, json: async () => out } as unknown as Response;
    }) as typeof fetch;

    const verdict = await resolveConfirmation(SENT, async () => {
      throw new Error('blockhash expired');
    });
    check(
      'never becomes never-seen',
      verdict.kind !== 'never-seen',
      `${verdict.kind}: ${describeVerdict(verdict)}`,
    );
    check(
      'and is reported as RPC silence',
      verdict.kind === 'unknown' && verdict.reason === UNKNOWN_REASON.rpcSilent,
      `${statusCalls} status reads`,
    );
    globalThis.fetch = original;
  }

  console.log(`\n${failed === 0 ? GREEN : RED}${passed} passed, ${failed} failed${RESET}\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
