'use client';

// The power-on count. A figure rolls 0 -> value exactly once in its life; every later change to
// that same figure snaps. Four figures in the whole app are allowed this, all of them counts —
// never a price, never a currency total, never an identifier. A rolling dollar figure reads as a
// value that is still being computed, which on a trading surface is a lie.
import { useEffect, useRef } from 'react';

const DURATION = 900;

export function useCountUp(value: number | null, format: (n: number) => string) {
  const ref = useRef<HTMLSpanElement>(null);
  const spent = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || spent.current) return;
    if (value === null || !Number.isFinite(value)) return;

    spent.current = true;

    // rAF is not covered by the CSS reduced-motion reset, so this branch is mandatory.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.textContent = format(value);
      return;
    }

    const started = performance.now();
    let raf = 0;

    const tick = (now: number) => {
      const p = Math.min(1, (now - started) / DURATION);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = format(value * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, format]);

  return ref;
}
