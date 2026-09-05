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

/** The blockhash-strategy confirm, injected so this module never imports web3.js. */
export type ConfirmBackstop = (sent: SentTx) => Promise<unknown>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One status check. An RPC failure is information about the RPC, never about the transaction. */
async function pollOnce(sent: SentTx): Promise<Verdict> {
  let status: SignatureStatus | null;
  try {
    status = parseSignatureStatus(await fetchSignatureStatus(sent.signature));
  } catch {
    return { kind: 'unknown', reason: UNKNOWN_REASON.rpcSilent };
  }
  // Only ask about the blockhash when the status is missing — that is the only branch it decides.
  if (status) return verdictFor(status, null);
  if (!sent.blockhash) return verdictFor(null, null);

  let valid: boolean | null = null;
  try {
    valid = await fetchBlockhashValid(sent.blockhash);
  } catch {
    valid = null;
  }
  return verdictFor(null, valid);
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
  const backstopState = { confirmed: false, graceUntil: null as number | null };

  const settled = backstop(sent).then(
    () => {
      backstopState.confirmed = true;
      backstopState.graceUntil = Date.now() + BACKSTOP_GRACE_MS;
    },
    () => {
      backstopState.graceUntil = Date.now() + BACKSTOP_GRACE_MS;
    },
  );

  let last: Verdict = { kind: 'unknown', reason: UNKNOWN_REASON.notIndexedYet };
  for (;;) {
    const verdict = await pollOnce(sent);
    if (verdict.kind === 'landed' || verdict.kind === 'failed') return verdict;
    if (verdict.kind === 'never-seen') {
      // Contradiction: the backstop confirmed, so the status query is behind, not the chain.
      return backstopState.confirmed ? { kind: 'landed', slot: null } : verdict;
    }

    last = verdict;
    const now = Date.now();
    if (now >= deadline) break;
    if (backstopState.graceUntil !== null && now >= backstopState.graceUntil) break;
    // Wakes early when the backstop answers, so a confirmed transaction is not held for a full tick.
    await Promise.race([sleep(POLL_INTERVAL_MS), settled]);
  }

  // Out of time. A confirming backstop is still an answer, just without a slot to name.
  if (backstopState.confirmed) return { kind: 'landed', slot: null };
  return last;
}
