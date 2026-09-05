'use client';

// Is the Memo program actually deployed on Cookie Chain? It is (verified 5 Sep 2026 — getAccountInfo
// returns a BPF ELF executable), but a memo instruction against a missing program would fail the
// whole transfer, so the probe stays and the memo field self-hides if the answer ever changes.
//
// One RPC call for the lifetime of the tab: staleTime + gcTime Infinity, keyed on the program id.
import { useQuery } from '@tanstack/react-query';
import { MEMO_PROGRAM_ID } from '@/lib/config';
import { rpcCall } from '@/lib/rpc';

/** getAccountInfo returns `{ context, value }`; `value` is null when the account does not exist. */
interface AccountInfoResult {
  value: { executable?: boolean } | null;
}

/** True only once the probe has confirmed the program account exists. */
export function useMemoProgram(): boolean {
  const { data } = useQuery({
    queryKey: ['memo-program', MEMO_PROGRAM_ID],
    queryFn: async ({ signal }) => {
      const res = await rpcCall<AccountInfoResult | null>(
        'getAccountInfo',
        // dataSlice 0 => header only. Without it the RPC ships the whole BPF ELF just to prove
        // the account exists.
        [MEMO_PROGRAM_ID, { encoding: 'base64', dataSlice: { offset: 0, length: 0 } }],
        signal,
      );
      return res?.value !== null && res?.value !== undefined;
    },
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
  });

  return data === true;
}
