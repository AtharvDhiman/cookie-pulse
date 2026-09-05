'use client';

// The two honest shapes of "something changed and the user should know", so nobody invents a third.
//
// Both compare VALUES held in a ref, never React Query's object identity and never `isFetching`.
// The registry refetches roughly 450 times an hour with a tab left open; anything keyed to a fetch
// rather than to a changed value turns the app into a slot machine.
import { useEffect, useRef, useState } from 'react';

/** True for `ms` after `value` genuinely changes. A first resolve is not a change, so never fires on mount. */
export function useChanged<T>(value: T, ms = 900): boolean {
  const previous = useRef<T>(value);
  const mounted = useRef(false);
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      previous.current = value;
      return;
    }
    if (previous.current === value) return;

    previous.current = value;
    setChanged(true);
    const timer = setTimeout(() => setChanged(false), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);

  return changed;
}

/**
 * Freezes a decision at mount for the life of this component instance. Used so the first render of
 * a list marks none of its rows as new, while a row that arrives later keeps its highlight even
 * across the re-renders that follow.
 */
export function useFreshOnMount(armed: boolean): boolean {
  const [fresh] = useState(() => armed);
  return fresh;
}
