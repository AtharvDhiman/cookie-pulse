'use client';

// The accent hairline along the bottom edge of the sticky header, and the one mount point for the
// app's single scroll listener. Rendered once, inside <header>.
//
// The bar hides itself on routes with no meaningful runway (/trade is ~250px tall on desktop) via
// the data-scrollable attribute useScrollShell maintains — a progress bar that is always full is
// worse than no progress bar.
import { useScrollShell } from '@/hooks/useScrollShell';

export function ScrollProgress() {
  useScrollShell();
  return (
    <div className="scroll-progress" aria-hidden="true">
      <span />
    </div>
  );
}
