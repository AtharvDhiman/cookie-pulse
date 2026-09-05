'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchChainHealth } from '@/lib/rpc';

/** One batched JSON-RPC round trip every 15s, straight from the browser to the Cookie Chain RPC. */
export function useChainHealth() {
  return useQuery({
    queryKey: ['chain-health'],
    queryFn: ({ signal }) => fetchChainHealth(signal),
    refetchInterval: 15_000,
    staleTime: 10_000,
    retry: 1,
  });
}
