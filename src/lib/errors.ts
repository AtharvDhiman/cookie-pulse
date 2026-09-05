// Every failure the user can see goes through here. Wallet adapters, web3.js and the Cookiebox agg
// all throw differently; the UI only ever renders a `FriendlyError`.
//
// Numeric codes are matched on word boundaries. A bare substring test for `4001` also matches the
// request id in "request id 4001234 timed out", and a bare `404` matches every HTTP 404 in the app —
// both of which mislabelled unrelated failures as things they were not.

export interface FriendlyError {
  title: string;
  detail: string | null;
  /** Rendered as a collapsible <pre> — simulation logs only. */
  logs: string[] | null;
  action: 'retry' | 'bridge' | 'raise-slippage' | null;
}

/**
 * Rent-exempt minimum for a bare system account, read live from Cookie Chain:
 * `getMinimumBalanceForRentExemption(0)` → 890880 lamports = 0.00089088 COOK.
 */
const RENT_MINIMUM_LAMPORTS = '890,880';
const RENT_MINIMUM_COOK = '0.00089088';

/**
 * A failure whose wording the thrower already decided. The pattern table below maps *classes* of
 * error; it cannot phrase one that has to name live numbers — a build-time re-quote that moved the
 * output from one venue and amount to another. Those throw this instead of a bare `Error` with a
 * string the table would then have to parse back out.
 */
export class PresentableError extends Error {
  readonly friendly: FriendlyError;

  constructor(friendly: FriendlyError) {
    super(friendly.title);
    this.name = 'PresentableError';
    this.friendly = friendly;
  }
}

const RAW = (e: unknown): string => {
  if (!e) return '';
  if (typeof e === 'string') return e;
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
};

/** web3.js hangs simulation logs off the error object rather than the message. */
function extractLogs(e: unknown): string[] | null {
  if (e && typeof e === 'object') {
    const logs = (e as { logs?: unknown }).logs;
    if (Array.isArray(logs) && logs.length > 0) return logs.map(String);
  }
  return null;
}

/**
 * Programs for which custom error 1 really does mean "not enough funds": the System program
 * (negative resulting lamports) and both token programs (insufficient token balance).
 */
const FUNDS_ERROR_1_PROGRAMS = new Set([
  '11111111111111111111111111111111',
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
]);

/** The program id in the last `Program <id> failed:` line, if the logs name one. */
function failingProgram(logs: string[] | null): string | null {
  if (!logs) return null;
  for (let i = logs.length - 1; i >= 0; i--) {
    const m = /^Program (\S+) failed:/.exec(logs[i]);
    if (m) return m[1];
  }
  return null;
}

/**
 * Whether a `Custom: 1` in this failure can be read as "insufficient funds".
 *
 * Custom error codes are per-program: 1 means insufficient funds in the System and token programs,
 * but a Cookiebox router, DAMM or CLMM program numbers its own errors from the same space. Claiming
 * "Not enough COOK to pay fees" — with a call to action that sends the user off to bridge more —
 * for a router error would be wrong twice over. So when the logs name the failing program, the
 * claim is only made for programs where it holds; with no logs to go on, the common case stands.
 */
function custom1MeansFunds(logs: string[] | null): boolean {
  const program = failingProgram(logs);
  return program === null || FUNDS_ERROR_1_PROGRAMS.has(program);
}

/**
 * A network error's `message` is written for a developer console, not for a card on a dashboard.
 * "Failed to fetch" (Chrome), "NetworkError when attempting to fetch resource." (Firefox) and
 * "Load failed" (Safari) all mean the same unremarkable thing, and all three read as a bug when
 * printed verbatim under a heading. Anything more specific than those is worth showing as it is.
 */
export function readErrorDetail(e: unknown, fallback: string): string {
  const m = e instanceof Error ? e.message : '';
  if (!m) return fallback;
  return /failed to fetch|networkerror|load failed/i.test(m)
    ? 'The network request did not complete.'
    : m;
}

export function toFriendlyError(e: unknown): FriendlyError {
  // Already phrased by whoever threw it — matching it against the patterns below could only make
  // the message worse.
  if (e instanceof PresentableError) return e.friendly;

  const raw = RAW(e);
  const logs = extractLogs(e);
  const err = (
    title: string,
    detail: string | null = null,
    action: FriendlyError['action'] = null,
  ): FriendlyError => ({ title, detail, logs, action });

  // Wallet rejection — adapters use several spellings, plus the 4001 EIP-style code.
  if (
    /user rejected|rejected the request|WalletSignTransactionError|user denied|\b4001\b/i.test(raw)
  ) {
    return err('Transaction cancelled in Nightly.', 'You dismissed the signature request.');
  }
  if (/WalletNotConnected|wallet not connected/i.test(raw)) {
    return err('Wallet not connected.', 'Connect Nightly and try again.');
  }

  // Rent, which is NOT the same failure as running out of COOK and needs the opposite advice: the
  // usual cause is sending an amount too small to keep a brand-new recipient account alive, not an
  // empty sender. Must precede the fee bucket, whose `insufficient funds` also matches this string.
  if (/InsufficientFundsForRent|insufficient funds for rent/i.test(raw)) {
    return err(
      'The amount is below the rent minimum for a new account.',
      `An address that does not exist yet must be funded with at least ${RENT_MINIMUM_COOK} COOK ` +
        `(${RENT_MINIMUM_LAMPORTS} lamports) in one go, or the network will not create it. Send more ` +
        'than that, or check the recipient address. If your own balance is what is short, top up first.',
      'bridge',
    );
  }

  // Token-2022 / SPL Token error 17 = 0x11 = AccountFrozen. Over half the registry carries a freeze
  // authority (170 of a 300-mint sample, 5 Sep 2026), so this is a live case, not a theoretical one.
  if (/AccountFrozen|\b0x11\b|"Custom"\s*:\s*17\b/i.test(raw)) {
    return err(
      'This token account is frozen.',
      "The mint's freeze authority has frozen it, so it cannot send or receive. Only the token issuer can lift that.",
    );
  }

  // Fees / funds. `AccountNotFound` is what the Cookiebox agg returns when the owner holds no COOK.
  // The JSON form is the one the app produces itself: simulation errors arrive as
  // `Simulation failed: {"InstructionError":[0,{"Custom":1}]}` — never as a bare `0x1`, which is why
  // the old end-anchored `0x1$` could not fire. Error 1 is "insufficient funds" for both the System
  // program (negative lamports) and SPL Token (short token balance), hence the two-sided advice.
  if (
    /insufficient (lamports|funds)|Attempt to debit an account but found no record|AccountNotFound/i.test(
      raw,
    ) ||
    (/\b0x1\b|"Custom"\s*:\s*1\b/i.test(raw) && custom1MeansFunds(logs))
  ) {
    return err(
      'Not enough COOK to pay fees.',
      'Top up your wallet, then try again. If you were sending a token, check its balance covers the amount too.',
      'bridge',
    );
  }

  // Slippage. 0x1771 = 6001 is the aggregator's "exceeds desired slippage" custom error.
  if (/0x1771|\b6001\b|slippage|ExceededSlippage|min out|MinimumOut/i.test(raw)) {
    return err(
      'Price moved more than your slippage.',
      'Try 3% slippage, or a smaller amount.',
      'raise-slippage',
    );
  }

  // Blockhash window elapsed. The transaction may STILL land — never imply it definitely failed.
  // `useTransaction` now resolves this case to a definite verdict before it can reach here; this
  // stays for any caller that confirms without going through `resolveConfirmation`.
  if (/TransactionExpiredBlockheightExceeded|block height exceeded|Blockhash not found|BlockhashNotFound/i.test(raw)) {
    return err(
      'Took too long to confirm.',
      'It may still land — check Cookiescan before sending again.',
      'retry',
    );
  }

  if (/simulat/i.test(raw)) {
    // Only promise logs when there are logs: the aggregator's own simulation failure arrives as an
    // HTTP 422 body with no `logs` field at all.
    return err(
      'Simulation failed.',
      logs
        ? 'The transaction would fail on-chain. Details below.'
        : 'The transaction would fail on-chain, so nothing was sent.',
    );
  }

  // The 5xx codes are bounded for the same reason as 4001: unbounded, "502" also matches the middle
  // of a slot number, and slot numbers reach here in on-chain failure text.
  if (
    /failed to fetch|networkerror|load failed|ECONNREFUSED|ETIMEDOUT|abort|timed out|\b(502|503|504)\b/i.test(
      raw,
    )
  ) {
    return err('Cookie Chain RPC is not responding.', 'Retrying shortly.', 'retry');
  }

  // "No route" is a textual answer, not a status code. A bare 404 cannot mean this: `fetchQuote`
  // already turns the aggregator's 404 into `route: null` upstream, so the only 404 that reaches a
  // transaction is the swap build finding the pair stopped routing between quote and signature —
  // and that arrives as the aggregator's own sentence, forwarded verbatim by `errorResponse`.
  // Matching the HTTP-404 fallback string too would be wrong: that string only appears when the
  // response was not JSON at all, which means the route itself is missing, not the pair.
  if (/no route|route not found/i.test(raw)) {
    return err('No route for this pair.', 'There is no pool path between these tokens yet.');
  }

  return err('Transaction failed.', raw.slice(0, 220) || null, 'retry');
}
