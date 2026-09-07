// What actually happened to a transaction we already broadcast. This is the one question the app
// must never guess at: by the time it is asked, real COOK is already in flight.
//
// `confirmTransaction` either resolves or throws, and a throw is NOT evidence of failure — the
// blockhash window can elapse while the transaction is still landing, and a stalled signature
// subscription can hang until it does. So the blockhash/lastValidBlockHeight strategy stays exactly
// where it was, as the backstop, and a 2s `getSignatureStatuses` poll races it until one of three
// definite answers exists: it landed, it failed on-chain, or its blockhash is dead and the signature
// was never seen — the only case where retrying is unambiguously safe.
//
// The verdict itself is pure, so it is testable without a network (`npm run test:errors`).
import { num, pick, str } from './normalize';
import { fetchBlockhashValid, fetchSignatureStatus } from './rpc';

export interface SentTx {
  signature: string;
  blockhash: string;
  lastValidBlockHeight: number;
}

/** The fields of a `getSignatureStatuses` entry that the verdict depends on. */
export interface SignatureStatus {
  slot: number | null;
  /** null when the transaction succeeded; anything else is the on-chain error. */
  err: unknown;
  confirmationStatus: 'processed' | 'confirmed' | 'finalized' | null;
}

export type Verdict =
  | { kind: 'landed'; slot: number | null }
  | { kind: 'failed'; slot: number | null; error: string }
  | { kind: 'never-seen' }
  | { kind: 'unknown'; reason: string };

/** Why an answer is still not definite. Rendered verbatim, so each one is a whole sentence. */
export const UNKNOWN_REASON = {
  notIndexedYet: 'The RPC has not seen this signature yet, but its blockhash is still valid.',
  seenNotConfirmed: 'The RPC has seen this signature but has not confirmed it yet.',
  blockhashUnknown: 'The RPC did not say whether the blockhash is still valid.',
  rpcSilent: 'The RPC did not answer the status check.',
  awaitingCorroboration:
    'The blockhash looks dead and the signature is unknown — re-checking before saying so.',
} as const;

function errText(err: unknown): string {
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/**
 * Pure. `blockhashValid` is null when the node was not asked or did not answer with a boolean.
 *
 * A missing status is the dangerous case: on its own it means nothing, because the RPC may simply
 * not have indexed the signature yet. It only becomes proof of a non-landing once the blockhash can
 * no longer be used, at which point no validator can ever include the transaction.
 */
export function verdictFor(status: SignatureStatus | null, blockhashValid: boolean | null): Verdict {
  if (status) {
    if (status.err !== null && status.err !== undefined) {
      return { kind: 'failed', slot: status.slot, error: errText(status.err) };
    }
    // 'processed' is not a landing — it can still be dropped on a fork, so keep asking.
    if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') {
      return { kind: 'landed', slot: status.slot };
    }
    return { kind: 'unknown', reason: UNKNOWN_REASON.seenNotConfirmed };
  }
  if (blockhashValid === false) return { kind: 'never-seen' };
  return {
    kind: 'unknown',
    reason: blockhashValid === true ? UNKNOWN_REASON.notIndexedYet : UNKNOWN_REASON.blockhashUnknown,
  };
}

/** Pure. Reads one entry of the `getSignatureStatuses` `value` array; null means never seen. */
export function parseSignatureStatus(raw: unknown): SignatureStatus | null {
  if (!raw || typeof raw !== 'object') return null;
  const status = str(pick(raw, ['confirmationStatus']));
  return {
    slot: num(pick(raw, ['slot'])),
    err: pick(raw, ['err']) ?? null,
    confirmationStatus:
      status === 'processed' || status === 'confirmed' || status === 'finalized' ? status : null,
  };
}

/** Pure. The single sentence the UI shows for a verdict. */
export function describeVerdict(verdict: Verdict): string {
  switch (verdict.kind) {
    case 'landed':
      return verdict.slot === null
        ? 'Confirmed'
        : `Confirmed in slot ${verdict.slot.toLocaleString('en-US')}`;
    case 'failed':
      return verdict.slot === null
        ? 'Failed on-chain'
        : `Failed on-chain in slot ${verdict.slot.toLocaleString('en-US')}`;
    case 'never-seen':
      return 'The blockhash is dead and this signature was never seen on-chain';
    case 'unknown':
      return verdict.reason;
  }
}

export const POLL_INTERVAL_MS = 2_000;
/** How long the poll keeps asking after the backstop settles, to turn its answer into a definite one. */
const BACKSTOP_GRACE_MS = 20_000;
/** Absolute ceiling, so a wedged RPC cannot hold the UI open forever. */
const MAX_RESOLVE_MS = 120_000;
/**
 * Consecutive rounds that must independently agree before we tell anyone a signature was never seen.
 * That verdict is the only one whose UI says re-broadcasting is safe, and on a load-balanced RPC a
 * single sample can miss a transaction that did land — so one observation is not allowed to spend
 * the user's money twice.
 */
const NEVER_SEEN_CONFIRMATIONS = 2;

/** The blockhash-strategy confirm, injected so this module never imports web3.js. */
export type ConfirmBackstop = (sent: SentTx) => Promise<unknown>;

/** A sleep whose pending timer can be dropped, so a race that loses does not leak it. */
function timer(ms: number): { promise: Promise<void>; cancel: () => void } {
  let handle: ReturnType<typeof setTimeout>;
  const promise = new Promise<void>((resolve) => {
    handle = setTimeout(resolve, ms);
  });
  return { promise, cancel: () => clearTimeout(handle) };
}

/**
 * How long ANY single RPC read here may take — status and blockhash alike.
 *
 * Without it the MAX_RESOLVE_MS ceiling below is advisory: it is only tested BETWEEN polls, so
 * one socket that opens and never answers — a wedged load-balancer backend, a captive portal, a
 * node in a GC pause — parks the UI on "Waiting for confirmation" indefinitely, which is the
 * exact failure the ceiling was written to prevent.
 *
 * The first version of this applied only to the status read and left the blockhash read beside
 * it with no signal at all, so the hang it was written to stop was still reachable through the
 * other leg. Both go through `bounded` now.
 *
 * `pollOnce` can make three of these in one iteration (status, blockhash, re-read), so the real
 * ceiling is MAX_RESOLVE_MS plus at most one poll's worth of in-flight reads, not exactly
 * MAX_RESOLVE_MS. Bounded is the property that matters.
 */
const RPC_READ_TIMEOUT_MS = 8_000;

/**
 * Every RPC read in this file, bounded.
 *
 * Shared rather than copied: one helper means the next read added here cannot reintroduce the
 * asymmetry where one leg had a timeout and the other did not. An abort rejects, and every
 * caller already folds a rejection into its own safe reading.
 */
async function bounded<T>(run: (signal: AbortSignal) => Promise<T>, fallback: T): Promise<T> {
  const ac = new AbortController();
  const cutoff = timer(RPC_READ_TIMEOUT_MS);
  try {
    // RACED, not merely aborted.
    //
    // The first version of this only called `ac.abort()` on a timer and awaited the read. That
    // bounds nothing on its own: an AbortController can only cut a read short if the callee
    // actually honours the signal, and a promise that ignores it just keeps the await parked --
    // which a regression test caught by counting attempts (one in twenty seconds, when the read
    // should have been retried). Real `fetch` does honour it, so this was correct in production
    // and unprovable, which is the worst combination for the one path in this app that decides
    // whether a user's money moved.
    //
    // Racing makes the ceiling hold whatever the callee does. The abort still fires, because
    // freeing the socket is worth doing even once the answer is no longer wanted.
    return await Promise.race([
      run(ac.signal).catch(() => fallback),
      cutoff.promise.then(() => {
        ac.abort();
        return fallback;
      }),
    ]);
  } finally {
    cutoff.cancel();
  }
}

/** `null` = the node answered and has no record. `undefined` = the node did not answer usefully. */
async function readStatus(signature: string): Promise<SignatureStatus | null | undefined> {
  return bounded<SignatureStatus | null | undefined>(
    async (signal) => parseSignatureStatus(await fetchSignatureStatus(signature, signal)),
    undefined,
  );
}

/** One status check. An RPC failure is information about the RPC, never about the transaction. */
async function pollOnce(sent: SentTx): Promise<Verdict> {
  const status = await readStatus(sent.signature);
  if (status === undefined) return { kind: 'unknown', reason: UNKNOWN_REASON.rpcSilent };

  // Only ask about the blockhash when the status is missing — that is the only branch it decides.
  if (status) return verdictFor(status, null);
  if (!sent.blockhash) return verdictFor(null, null);

  // Bounded like the status read. This call had no signal and no timeout, so it was the one leg
  // of pollOnce that could hang forever — measured still pending at 135s against a 120s
  // ceiling. A timeout yields null, which verdictFor already reads as "the node did not say".
  const valid = await bounded<boolean | null>(
    (signal) => fetchBlockhashValid(sent.blockhash, signal),
    null,
  );
  if (valid !== false) return verdictFor(null, valid);

  // The blockhash is dead, which is the only thing that can make a missing status meaningful. Read
  // the status once more, AFTER that observation: the first read and the blockhash read are two
  // round trips apart, and a transaction that landed in between would otherwise be reported as
  // never seen — the one verdict that invites the user to pay again.
  const recheck = await readStatus(sent.signature);
  if (recheck === undefined) return { kind: 'unknown', reason: UNKNOWN_REASON.rpcSilent };
  if (recheck) return verdictFor(recheck, null);
  return { kind: 'never-seen' };
}

/**
 * Resolve a broadcast signature to a definite outcome, or say plainly that it could not be resolved.
 *
 * `backstop` is the untouched `confirmTransaction` blockhash strategy. It is never awaited on its
 * own — a rejection from it is not a verdict — but it is watched: when it settles the poll only
 * needs a short grace window, and when it settles *successfully* it outranks a not-yet-indexed
 * status, because it saw the signature.
 *
 * There is no cancellation hook on purpose: by the time this runs the transaction is already
 * broadcast, so the only correct thing to do is keep asking until one of the two deadlines below.
 */
export async function resolveConfirmation(
  sent: SentTx,
  backstop: ConfirmBackstop,
): Promise<Verdict> {
  const deadline = Date.now() + MAX_RESOLVE_MS;
  // Held on an object rather than in `let`s: they are written from callbacks and read across awaits.
  // `onChainError` is separate from `confirmed` on purpose. A backstop that resolves carrying
  // `value.err` has told us something DEFINITE — the transaction reached a block and failed —
  // and that is not the same as "not confirmed". Collapsing both into one boolean meant a
  // reverted transaction whose status reads were behind could still reach the never-seen
  // verdict, the one whose UI says nothing was spent and re-broadcasting is safe.
  const backstopState = {
    confirmed: false,
    onChainError: null as unknown,
    done: false,
    graceUntil: null as number | null,
  };

  const settled = backstop(sent).then(
    (res) => {
      // web3.js `confirmTransaction` RESOLVES — it does not throw — for a transaction that landed
      // in a block and then failed: the SignatureResult it hands back carries `value.err`. Reading
      // a bare resolution as success is therefore the difference between "Swap confirmed" and
      // "Swap failed" on a reverted trade, which is the one mistake this module exists to prevent.
      //
      // An unrecognised shape counts as confirmed, which is the behaviour every other strategy
      // (legacy timeout, durable nonce) already relied on. Only a present `err` demotes it.
      const err = pick(res, ['value', 'err']);
      backstopState.confirmed = err == null;
      if (err != null) backstopState.onChainError = err;
      backstopState.done = true;
      backstopState.graceUntil = Date.now() + BACKSTOP_GRACE_MS;
    },
    () => {
      backstopState.done = true;
      backstopState.graceUntil = Date.now() + BACKSTOP_GRACE_MS;
    },
  );

  let last: Verdict = { kind: 'unknown', reason: UNKNOWN_REASON.notIndexedYet };
  let neverSeenStreak = 0;
  /** `last` is a between-ticks holding message, not an answer this run can end on. */
  let provisional = false;

  for (;;) {
    const verdict = await pollOnce(sent);
    if (verdict.kind === 'landed' || verdict.kind === 'failed') return verdict;

    if (verdict.kind === 'never-seen') {
      // Contradiction: the backstop confirmed, so the status query is behind, not the chain.
      if (backstopState.confirmed) return landedWithoutSlot(sent);
      // Same contradiction, opposite sign: the backstop watched it land and fail. Reporting
      // that as never-seen would tell the user their COOK was never spent and invite them to
      // send it again.
      if (backstopState.onChainError != null) {
        return { kind: 'failed', slot: null, error: errText(backstopState.onChainError) };
      }
      neverSeenStreak += 1;
      if (neverSeenStreak >= NEVER_SEEN_CONFIRMATIONS) return verdict;
      // Not yet corroborated — hold the softer sentence and look again next tick.
      //
      // But `last` is also what is RETURNED when the loop breaks, and this sentence promises a
      // re-check ("re-checking before saying so") that will then never happen. So it is held only
      // for display between ticks; if this turns out to be the final reading, the honest terminal
      // answer is that the app could not tell, which is what `notIndexedYet` says.
      last = { kind: 'unknown', reason: UNKNOWN_REASON.awaitingCorroboration };
      provisional = true;
    } else {
      // Any other reading breaks the streak: the rounds must be consecutive to count.
      neverSeenStreak = 0;
      last = verdict;
      provisional = false;
    }

    const now = Date.now();
    if (now >= deadline) break;
    if (backstopState.graceUntil !== null && now >= backstopState.graceUntil) break;

    // Racing `settled` wakes the loop early when the backstop answers, so a confirmed transaction is
    // not held for a full tick. But `settled` stays resolved forever after, and re-racing it would
    // make every later iteration return instantly — a tight loop hammering the RPC for the whole
    // grace window. Once it has fired, just sleep.
    const tick = timer(POLL_INTERVAL_MS);
    try {
      if (backstopState.done) await tick.promise;
      else await Promise.race([tick.promise, settled]);
    } finally {
      tick.cancel();
    }
  }

  // Out of time. A confirming backstop is still an answer, just without a slot of its own.
  if (backstopState.confirmed) return landedWithoutSlot(sent);
  if (backstopState.onChainError != null) {
    return { kind: 'failed', slot: null, error: errText(backstopState.onChainError) };
  }
  // Never end on the provisional sentence: it tells the user a re-check is coming, and nothing
  // will re-check.
  if (provisional) return { kind: 'unknown', reason: UNKNOWN_REASON.notIndexedYet };
  return last;
}

/**
 * The backstop saw the transaction land but the status endpoint has not named a slot. One last read
 * is worth it: `describeVerdict` can then say which slot it landed in instead of a bare "Confirmed".
 * Still returns `landed` either way — the backstop is the evidence, the slot is only the detail.
 */
async function landedWithoutSlot(sent: SentTx): Promise<Verdict> {
  const status = await readStatus(sent.signature);
  // Was `if (status) return { kind: 'landed', ... }` — the only place in this file that read a
  // status without asking whether it carried an error, so a re-read that came back FAILED was
  // still reported as a landing. Everything else here routes through `verdictFor`.
  if (status) {
    if (status.err !== null && status.err !== undefined) {
      return { kind: 'failed', slot: status.slot, error: errText(status.err) };
    }
    return { kind: 'landed', slot: status.slot };
  }
  return { kind: 'landed', slot: null };
}
