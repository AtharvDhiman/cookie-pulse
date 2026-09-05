'use client';

// The single transaction path for Send and Trade. Every step is explicit because the failure modes
// differ sharply: a rejected signature is harmless, a confirm timeout is NOT proof the transaction
// failed (it can still land), and a simulation error must show its logs.
//
// idle -> building -> awaiting-signature -> simulating -> sending -> confirming -> confirmed | failed
import { useCallback, useState } from 'react';
import { VersionedTransaction } from '@solana/web3.js';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { toast } from 'sonner';
import { explorerTx } from '@/lib/config';
import { shortAddr } from '@/lib/format';
import { toFriendlyError, type FriendlyError } from '@/lib/errors';
import { describeVerdict, resolveConfirmation, type Verdict } from '@/lib/confirm';

export type TxState =
  | 'idle'
  | 'building'
  | 'awaiting-signature'
  | 'simulating'
  | 'sending'
  | 'confirming'
  | 'confirmed'
  | 'failed';

export interface BuiltTx {
  transaction: VersionedTransaction;
  blockhash: string;
  lastValidBlockHeight: number;
}

export interface RunArgs {
  /** Verb shown in the toast, e.g. "Send" or "Swap". */
  label: string;
  build: () => Promise<BuiltTx>;
  onConfirmed?: (signature: string) => void;
}

const STATE_TEXT: Record<Exclude<TxState, 'idle' | 'confirmed' | 'failed'>, string> = {
  building: 'Building transaction…',
  'awaiting-signature': 'Approve in Nightly…',
  simulating: 'Simulating…',
  sending: 'Sending to Cookie Chain…',
  confirming: 'Waiting for confirmation…',
};

/**
 * A settled non-landing verdict, in the user's words. Only 'never-seen' is safe to retry blindly,
 * and it is the only one that says so.
 */
function failureFor(verdict: Exclude<Verdict, { kind: 'landed' }>): FriendlyError {
  if (verdict.kind === 'failed') {
    // Decode the on-chain error through the same table as everything else — a Custom(6001) that
    // failed on-chain is still a slippage problem — but lead with the verdict, so the user knows the
    // transaction is settled rather than still in flight.
    const decoded = toFriendlyError(new Error(verdict.error));
    return {
      ...decoded,
      detail: decoded.detail
        ? `${describeVerdict(verdict)} · ${decoded.detail}`
        : describeVerdict(verdict),
    };
  }
  if (verdict.kind === 'never-seen') {
    return {
      title: 'The transaction never landed.',
      detail: `${describeVerdict(verdict)}, so nothing was spent. It is safe to try again.`,
      logs: null,
      action: 'retry',
    };
  }
  // Deliberately no retry action. This is the one branch where the transaction may still be live,
  // and a Retry button beside "it may still land" invites paying twice.
  return {
    title: 'Could not confirm this transaction.',
    detail: `${describeVerdict(verdict)} It may still land — open it on Cookiescan before sending again.`,
    logs: null,
    action: null,
  };
}

export function useTransaction() {
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();
  const [state, setState] = useState<TxState>('idle');
  const [error, setError] = useState<FriendlyError | null>(null);
  const [signature, setSignature] = useState<string | null>(null);

  const pending =
    state !== 'idle' && state !== 'confirmed' && state !== 'failed';

  const reset = useCallback(() => {
    setState('idle');
    setError(null);
    setSignature(null);
  }, []);

  const run = useCallback(
    async ({ label, build, onConfirmed }: RunArgs): Promise<string | null> => {
      if (!publicKey || !signTransaction) {
        const friendly = toFriendlyError(new Error('WalletNotConnected'));
        setError(friendly);
        setState('failed');
        toast.error(friendly.title, { description: friendly.detail ?? undefined });
        return null;
      }

      setError(null);
      setSignature(null);
      // Every exit below replaces this toast by id, and the run is deliberately never cancelled:
      // `Toaster` lives in the root layout, so navigating away from /send mid-confirmation leaves
      // this closure free to finish and post the real verdict, rather than discarding the outcome
      // of a transaction that has already spent real COOK. `resolveConfirmation` bounds itself.
      const id = toast.loading(`${label}: ${STATE_TEXT.building}`);

      const step = (next: Exclude<TxState, 'idle' | 'confirmed' | 'failed'>) => {
        setState(next);
        toast.loading(`${label}: ${STATE_TEXT[next]}`, { id });
      };

      // One failure renderer for both a thrown step and a settled non-landing verdict, so a confirm
      // that resolves to "failed" keeps the Cookiescan link a thrown confirm error has always had.
      const showFailure = (friendly: FriendlyError, sentSig: string | null) => {
        setError(friendly);
        setState('failed');
        toast.error(friendly.title, {
          id,
          description: sentSig
            ? `${friendly.detail ? `${friendly.detail} · ` : ''}${shortAddr(sentSig, 8, 8)}`
            : (friendly.detail ?? undefined),
          duration: 12_000,
          ...(sentSig
            ? {
                action: {
                  label: 'View on Cookiescan',
                  onClick: () => window.open(explorerTx(sentSig), '_blank', 'noopener,noreferrer'),
                },
              }
            : {}),
        });
      };

      // Held locally as well as in state: the catch block runs inside this same closure, so reading
      // the state variable there would still see null and drop the explorer link on a confirm
      // timeout — exactly the case where the user most needs it.
      let sentSignature: string | null = null;

      try {
        step('building');
        const built = await build();

        step('awaiting-signature');
        const signed = await signTransaction(built.transaction);

        // Simulate the SIGNED transaction with sigVerify off: catches program errors before we
        // broadcast, without the simulator rejecting an unsigned message.
        step('simulating');
        const sim = await connection.simulateTransaction(signed, {
          sigVerify: false,
          replaceRecentBlockhash: false,
        });
        if (sim.value.err) {
          const simError = new Error(`Simulation failed: ${JSON.stringify(sim.value.err)}`);
          Object.assign(simError, { logs: sim.value.logs ?? [] });
          throw simError;
        }

        step('sending');
        const sig = await connection.sendRawTransaction(signed.serialize(), {
          skipPreflight: true,
          maxRetries: 3,
        });
        sentSignature = sig;
        setSignature(sig);

        step('confirming');
        // The blockhash/lastValidBlockHeight strategy is unchanged and still the backstop; a 2s
        // status poll races it so a stalled signature subscription cannot hang the UI for the whole
        // blockhash window, and so the outcome is one of three definite answers rather than
        // "it may still land".
        const verdict = await resolveConfirmation(
          {
            signature: sig,
            blockhash: built.blockhash,
            lastValidBlockHeight: built.lastValidBlockHeight,
          },
          (sent) =>
            connection.confirmTransaction(
              {
                signature: sent.signature,
                blockhash: sent.blockhash,
                lastValidBlockHeight: sent.lastValidBlockHeight,
              },
              'confirmed',
            ),
        );

        if (verdict.kind !== 'landed') {
          showFailure(failureFor(verdict), sig);
          return null;
        }

        setState('confirmed');
        toast.success(`${label} confirmed`, {
          id,
          // The slot comes from the status response, so it is the slot the chain put it in.
          description: `${describeVerdict(verdict)} · ${shortAddr(sig, 8, 8)}`,
          duration: 12_000,
          action: {
            label: 'View on Cookiescan',
            onClick: () => window.open(explorerTx(sig), '_blank', 'noopener,noreferrer'),
          },
        });
        onConfirmed?.(sig);
        return sig;
      } catch (e) {
        // A signature exists whenever we got past send, so a failure after broadcast still links
        // out — the user needs to be able to check the transaction before retrying.
        showFailure(toFriendlyError(e), sentSignature);
        return null;
      }
    },
    [connection, publicKey, signTransaction],
  );

  return { run, reset, state, pending, error, signature };
}
