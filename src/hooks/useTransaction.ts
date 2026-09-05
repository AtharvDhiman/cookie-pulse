'use client';

// The single transaction path for Send and Trade. Every step is explicit because the failure modes
// differ sharply: a rejected signature is harmless, a confirm timeout is NOT proof the transaction
// failed (it can still land), and a simulation error must show its logs.
//
// idle -> building -> awaiting-signature -> simulating -> sending -> confirming -> confirmed | failed
import { useCallback, useRef, useState } from 'react';
import { VersionedTransaction } from '@solana/web3.js';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { toast } from 'sonner';
import { explorerTx } from '@/lib/config';
import { shortAddr } from '@/lib/format';
import { toFriendlyError, type FriendlyError } from '@/lib/errors';

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

export function useTransaction() {
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();
  const [state, setState] = useState<TxState>('idle');
  const [error, setError] = useState<FriendlyError | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const toastId = useRef<string | number | null>(null);

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
      const id = toast.loading(`${label}: ${STATE_TEXT.building}`);
      toastId.current = id;

      const step = (next: Exclude<TxState, 'idle' | 'confirmed' | 'failed'>) => {
        setState(next);
        toast.loading(`${label}: ${STATE_TEXT[next]}`, { id });
      };

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
        setSignature(sig);

        step('confirming');
        await connection.confirmTransaction(
          {
            signature: sig,
            blockhash: built.blockhash,
            lastValidBlockHeight: built.lastValidBlockHeight,
          },
          'confirmed',
        );

        setState('confirmed');
        toast.success(`${label} confirmed`, {
          id,
          description: shortAddr(sig, 8, 8),
          duration: 12_000,
          action: {
            label: 'View on Cookiescan',
            onClick: () => window.open(explorerTx(sig), '_blank', 'noopener,noreferrer'),
          },
        });
        onConfirmed?.(sig);
        return sig;
      } catch (e) {
        const friendly = toFriendlyError(e);
        setError(friendly);
        setState('failed');
        // The signature exists whenever we got past send, so a confirm timeout still links out.
        const sentSig = signature;
        toast.error(friendly.title, {
          id,
          description: friendly.detail ?? undefined,
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
        return null;
      }
    },
    [connection, publicKey, signTransaction, signature],
  );

  return { run, reset, state, pending, error, signature };
}
