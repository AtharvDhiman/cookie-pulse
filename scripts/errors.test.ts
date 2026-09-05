/**
 * Unit tests for the two pure pieces of the transaction outcome path:
 *
 *   - `toFriendlyError`   — which bucket a real error string lands in
 *   - `verdictFor`        — what a signature status plus a blockhash-validity answer proves
 *
 *   npm run test:errors
 *
 * No network and no wallet: every input below is a string or object the app has actually produced,
 * or that an endpoint has actually returned. Exits non-zero if any assertion fails.
 */
import { toFriendlyError } from '../src/lib/errors';
import {
  describeVerdict,
  parseSignatureStatus,
  verdictFor,
  type SignatureStatus,
} from '../src/lib/confirm';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail: string): void {
  if (ok) {
    passed++;
    console.log(`  ${GREEN}PASS${RESET} ${label} ${DIM}${detail}${RESET}`);
  } else {
    failed++;
    console.log(`  ${RED}FAIL${RESET} ${label} ${DIM}${detail}${RESET}`);
  }
}

/** Bucket titles, spelled out rather than imported: a copy change should fail a test, not pass it. */
const REJECTED = 'Transaction cancelled in Nightly.';
const NOT_CONNECTED = 'Wallet not connected.';
const RENT = 'The amount is below the rent minimum for a new account.';
const FROZEN = 'This token account is frozen.';
const FUNDS = 'Not enough COOK to pay fees.';
const SLIPPAGE = 'Price moved more than your slippage.';
const EXPIRED = 'Took too long to confirm.';
const SIMULATION = 'Simulation failed.';
const NETWORK = 'Cookie Chain RPC is not responding.';
const NO_ROUTE = 'No route for this pair.';
const GENERIC = 'Transaction failed.';

function bucket(input: unknown, expected: string, note: string): void {
  const actual = toFriendlyError(input).title;
  const shown = typeof input === 'string' ? input : String((input as Error).message);
  check(
    `${note} ${DIM}→${RESET} ${expected}`,
    actual === expected,
    actual === expected ? shown.slice(0, 72) : `got "${actual}" for ${shown.slice(0, 60)}`,
  );
}

console.log('\nCookie Pulse error + verdict tests\n');

// --- error buckets: the ordinary cases ------------------------------------------------------------
console.log('toFriendlyError — wallet');
bucket('User rejected the request.', REJECTED, 'nightly rejection');
bucket(
  new Error('WalletSignTransactionError: User rejected the request'),
  REJECTED,
  'adapter rejection',
);
bucket('WalletError: code 4001', REJECTED, 'anchored 4001 still matches a real code');
bucket(new Error('WalletNotConnected'), NOT_CONNECTED, 'no wallet');

console.log('\ntoFriendlyError — funds, rent and frozen accounts');
bucket(
  'Error: Transaction results in an account (1) with insufficient funds for rent',
  RENT,
  'rent minimum, not an empty wallet',
);
// The app's own wording, built at useTransaction.ts from `sim.value.err`. The old rule was anchored
// as `0x1$`, which this string can never match — it was silently falling through to "Simulation
// failed." with no advice at all.
bucket(
  'Simulation failed: {"InstructionError":[0,{"Custom":1}]}',
  FUNDS,
  'InstructionError Custom(1)',
);
bucket('custom program error: 0x1', FUNDS, 'bare 0x1');
bucket(
  'Attempt to debit an account but found no record of a prior credit.',
  FUNDS,
  'unfunded fee payer',
);
bucket('Swap simulation failed.\nAccountNotFound', FUNDS, 'aggregator HTTP 422 body');
bucket('custom program error: 0x11', FROZEN, 'Token-2022 AccountFrozen');
bucket('Program failed: {"InstructionError":[0,{"Custom":17}]}', FROZEN, 'AccountFrozen as JSON');

console.log('\ntoFriendlyError — slippage, expiry, simulation, network, routing');
bucket('custom program error: 0x1771', SLIPPAGE, 'aggregator slippage code');
bucket('{"InstructionError":[3,{"Custom":6001}]}', SLIPPAGE, 'slippage as JSON');
bucket(
  new Error(
    'TransactionExpiredBlockheightExceededError: Signature 2RwCtLgESWTNM7v51ENHziDF39ug1iGrZnFxiHp6Zpty has expired: block height exceeded.',
  ),
  EXPIRED,
  'blockhash window elapsed',
);
bucket(
  'Simulation failed: {"InstructionError":[0,{"Custom":9999}]}',
  SIMULATION,
  'unmapped program error',
);
bucket(new Error('TypeError: Failed to fetch'), NETWORK, 'RPC unreachable');
bucket('Could not build the swap (HTTP 404)', NO_ROUTE, 'pair stopped routing before signing');

// --- error buckets: the five anchoring defects ----------------------------------------------------
console.log('\ntoFriendlyError — anchored codes must not swallow unrelated strings');
bucket(
  'Error: request id 4001234 timed out',
  NETWORK,
  'a request id containing 4001 is not a rejection',
);
bucket(
  'Error: request id 6001234 timed out',
  NETWORK,
  'a request id containing 6001 is not slippage',
);
bucket(
  'HTTP 404 from api.cookiescan.io/api/tokens',
  GENERIC,
  'a registry 404 is not a missing swap route',
);
bucket(
  'Failed on-chain in slot 23,375,024: {"InstructionError":[0,{"Custom":9999}]}',
  GENERIC,
  'a slot number containing 502 is not an RPC outage',
);

// --- copy assertions ------------------------------------------------------------------------------
console.log('\ntoFriendlyError — copy');
const rent = toFriendlyError('Transaction results in an account with insufficient funds for rent');
check(
  'rent advice names the rent minimum in lamports',
  rent.detail !== null && rent.detail.includes('890,880'),
  rent.detail ?? 'no detail',
);
check(
  'rent advice names the too-small-transfer-to-a-fresh-address case',
  rent.detail !== null && /does not exist yet/i.test(rent.detail),
  rent.detail ?? 'no detail',
);
check(
  'rent advice is no longer only "top up"',
  rent.detail !== 'Top up your wallet, then try again.',
  'inverted from the fee bucket',
);

const simWithLogs = new Error('Simulation failed: {"InstructionError":[0,{"Custom":9999}]}');
Object.assign(simWithLogs, { logs: ['Program log: oh no'] });
const withLogs = toFriendlyError(simWithLogs);
const withoutLogs = toFriendlyError('Simulation failed: {"InstructionError":[0,{"Custom":9999}]}');
check(
  '"Details below" appears when logs exist',
  withLogs.logs !== null && (withLogs.detail?.includes('Details below') ?? false),
  withLogs.detail ?? 'no detail',
);
check(
  '"Details below" is absent when logs is empty',
  withoutLogs.logs === null && !(withoutLogs.detail ?? '').includes('Details below'),
  withoutLogs.detail ?? 'no detail',
);

// --- verdicts -------------------------------------------------------------------------------------
// The finalized case is a real response from rpc.cookiescan.io for signature
// 2RwCtLgESWTNM7v51ENHziDF39ug1iGrZnFxiHp6Zptyp6Eh7CfQqmKrkHQebBiSzCrPj6GFaA62S4RPcoLxUWnx.
console.log('\nverdictFor — a status plus a blockhash answer');
const finalized: SignatureStatus = {
  confirmationStatus: 'finalized',
  err: null,
  slot: 23371721,
};
const landed = verdictFor(finalized, null);
check('finalized + err null → landed', landed.kind === 'landed', landed.kind);
check(
  'landed carries the slot from the status response',
  landed.kind === 'landed' && landed.slot === 23371721,
  landed.kind === 'landed' ? String(landed.slot) : '—',
);
check(
  'the success line reads "Confirmed in slot N"',
  describeVerdict(landed) === 'Confirmed in slot 23,371,721',
  describeVerdict(landed),
);

const onChainFailure = verdictFor(
  { confirmationStatus: 'confirmed', err: { InstructionError: [0, { Custom: 1 }] }, slot: 23371722 },
  null,
);
check('non-null err → failed', onChainFailure.kind === 'failed', onChainFailure.kind);
check(
  'the failure line says it failed on-chain',
  describeVerdict(onChainFailure).startsWith('Failed on-chain'),
  describeVerdict(onChainFailure),
);

check(
  'null status + dead blockhash → never-seen',
  verdictFor(null, false).kind === 'never-seen',
  verdictFor(null, false).kind,
);
check(
  'null status + LIVE blockhash → unknown, never "safe to retry"',
  verdictFor(null, true).kind === 'unknown',
  verdictFor(null, true).kind,
);
check(
  'null status + no blockhash answer → unknown',
  verdictFor(null, null).kind === 'unknown',
  verdictFor(null, null).kind,
);
check(
  'processed-only is not yet a landing',
  verdictFor({ confirmationStatus: 'processed', err: null, slot: 23371723 }, null).kind ===
    'unknown',
  'a processed transaction can still be dropped on a fork',
);

console.log('\nparseSignatureStatus — the live getSignatureStatuses shape');
const live = parseSignatureStatus({
  confirmationStatus: 'finalized',
  confirmations: null,
  err: null,
  slot: 23371721,
  status: { Ok: null },
});
check(
  'parses the finalized entry',
  live !== null && live.slot === 23371721 && live.err === null && live.confirmationStatus === 'finalized',
  JSON.stringify(live),
);
check('a null entry parses to null', parseSignatureStatus(null) === null, 'never seen');

console.log(`\n${failed === 0 ? GREEN : RED}${passed} passed, ${failed} failed${RESET}\n`);
if (failed > 0) process.exit(1);
