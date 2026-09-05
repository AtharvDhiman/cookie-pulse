'use client';

// Memoised so a parent re-render mid-roll cannot reset the node React owns. Pass a module-scoped
// formatter, not an inline arrow, or the memo is defeated on every render.
import { memo } from 'react';
import { useCountUp } from '@/hooks/useCountUp';

function CountUpImpl({
  value,
  format,
  className,
}: {
  value: number | null;
  format: (n: number) => string;
  className?: string;
}) {
  const ref = useCountUp(value, format);
  return (
    <span ref={ref} className={className}>
      {value === null ? '—' : format(value)}
    </span>
  );
}

export const CountUp = memo(CountUpImpl);
