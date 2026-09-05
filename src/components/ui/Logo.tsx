'use client';

// The mark.
//
// This replaced a 🍪 emoji in the header and a second one, set at text-3xl, on the 404. An emoji as
// a brand mark is the clearest possible signal that nobody drew anything: it renders as a different
// picture on every platform, it cannot take the accent colour, and it carries whatever a font
// vendor decided a cookie looks like.
//
// Two attempts were thrown away before this one, both after looking at the result at 260px:
//
//   1. A ring with a heartbeat trace through it. It read as the stock medical-monitoring icon, the
//      cookie did not come through at all, and the chips were hidden behind the trace. Combining
//      two ideas made it mean neither.
//   2. The same shape as one `fill-rule="evenodd"` path. Evenodd only knocks out the OVERLAP of two
//      subpaths, so the part of the bite circle sitting outside the disc stayed painted — the mark
//      grew an orange lobe with a lens-shaped hole in it. A bite is a subtraction, and subtraction
//      needs a mask, not a fill rule.
//
// So: one idea, cut properly. A bitten cookie — a solid silhouette, which is what survives at 19px
// in a header — with its chips on a rising diagonal so they read as data points rather than as
// scatter. The cookie is the chain, the chips are the readings.
//
// The mask id is per-instance because the mark renders twice on most pages (header and footer) and
// duplicate ids would make the second one reference the first one's mask.
import { useId } from 'react';

export function Logo({ size = 20, className }: { size?: number; className?: string }) {
  const maskId = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <mask id={maskId}>
        {/* White keeps, black cuts. */}
        <rect width="24" height="24" fill="#fff" />
        {/* The bite. Centre sits 10.8 from the disc centre against a radius of 10, so it takes a
            crescent about 3.4 deep — a chunk, not a nibble, which is what stays legible at 19px. */}
        <circle cx="21" cy="6" r="4.2" fill="#000" />
        {/* Chips, on a rising diagonal. Equal radii here; the diagonal is the idea, and jittering
            the sizes as well would just look like noise at this scale. */}
        <circle cx="7.8" cy="15" r="1.35" fill="#000" />
        <circle cx="11.2" cy="12.2" r="1.35" fill="#000" />
        <circle cx="14.6" cy="9.4" r="1.35" fill="#000" />
      </mask>
      <circle cx="12" cy="12" r="10" fill="currentColor" mask={`url(#${maskId})`} />
    </svg>
  );
}
