'use client';

import Link from 'next/link';
import type { CSSProperties } from 'react';
import { ArrowUpRight, Wallet } from 'lucide-react';
import {
  BRIDGE_URL,
  COOK_SOLANA_DECIMALS,
  COOK_SOLANA_MINT,
  HYPERLANE_DOMAINS,
  RPC_URL,
  WS_URL,
} from '@/lib/config';
import { Card, CopyButton, cn } from '@/components/ui/primitives';
import { PointerWeight } from '@/components/motion/PointerWeight';
import { useReveal } from '@/hooks/useReveal';

/**
 * Tab must never park a control underneath the sticky header (WCAG 2.2 SC 2.4.11). This route has
 * ten focusables and five of them sit below the fold at 1440x900, so every one of them reserves the
 * measured header height plus a gutter before the browser scrolls it into view. Layout, not motion:
 * ungated, and correct with reduced motion or no JS.
 *
 * The fallback is 106px, matching screener/page.tsx and ScreenerTable, because it is not a
 * near-miss default — it is the ONLY value with JavaScript disabled, where Header's effect never
 * writes `--header-h`. The header is a 64px bar plus a ~42px nav row, so a 64px fallback would park
 * every below-fold control under the nav on exactly the no-JS path this constant claims to cover.
 */
const FOCUS_CLEARANCE = 'scroll-mt-[calc(var(--header-h,106px)_+_16px)]';

interface Step {
  n: number;
  title: string;
  body: React.ReactNode;
  link?: { href: string; label: string };
  values?: { label: string; value: string }[];
}

// Module-level and keyed by `step.n`, so these four <li> instances never remount and their entrance
// can never replay. /bridge holds no React Query hook at all, so nothing here can move on a poll.
const STEPS: Step[] = [
  {
    n: 1,
    title: 'Get some SOL on Solana',
    body: (
      <>
        Buy SOL on any exchange and withdraw it to your Nightly wallet on the{' '}
        <strong className="text-ink">Solana</strong> network. A few dollars is plenty — Cookie Chain
        fees are about 0.000005 COOK per signature.
      </>
    ),
  },
  {
    n: 2,
    title: 'Swap SOL for COOK on Jupiter',
    body: (
      <>
        COOK on Solana is a <strong className="text-ink">Token-2022</strong> mint with{' '}
        {COOK_SOLANA_DECIMALS} decimals. Paste the mint below into Jupiter and swap. Keep a little
        SOL back for Solana fees and the bridge transaction.
      </>
    ),
    link: { href: 'https://jup.ag', label: 'Open jup.ag' },
    values: [{ label: 'COOK mint on Solana', value: COOK_SOLANA_MINT }],
  },
  {
    n: 3,
    title: 'Bridge Solana → Cookie Chain',
    body: (
      <>
        Use the Hyperlane bridge to move COOK across. It arrives as{' '}
        <strong className="text-ink">native COOK</strong> (9 decimals) on Cookie Chain, which is what
        pays for fees.
      </>
    ),
    link: { href: BRIDGE_URL, label: 'Open hyperlane.cookiescan.io' },
    // Domain IDs are identifiers, not quantities. Nothing counts up here: a roll on 1399811149
    // renders ~60 consecutive wrong, readable, copyable chain IDs, and a user who bridges to a
    // truncated domain loses funds.
    values: [
      { label: 'Solana domain', value: String(HYPERLANE_DOMAINS.solana) },
      { label: 'Cookie Chain domain', value: String(HYPERLANE_DOMAINS.cookie) },
    ],
  },
  {
    n: 4,
    title: 'Point Nightly at Cookie Chain',
    body: (
      <>
        In Nightly, open <strong className="text-ink">Settings → Networks → Solana</strong> and add a
        custom RPC with the two values below. Then reconnect here and your COOK balance shows up in
        the header.
      </>
    ),
    values: [
      { label: 'Network name', value: 'Cookie Chain' },
      { label: 'RPC endpoint', value: RPC_URL },
      { label: 'WebSocket endpoint', value: WS_URL },
    ],
  },
];

function ValueRow({ label, value }: { label: string; value: string }) {
  return (
    // Colour only. This row sits directly under the pointer while the user is aiming at a copy
    // button, and any geometry change under an aiming cursor causes mis-clicks. The mono value
    // itself gets nothing — no typewriter, and above all no marquee on the truncated mobile
    // strings: a moving string cannot be read or double-click-selected, and would loop forever in
    // a background tab. `title` plus the copy button already solve truncation.
    <div className="flex items-center justify-between gap-2 rounded-xl border border-hairline/10 bg-surface2 px-3 py-2 transition-colors duration-[160ms] focus-within:border-accent/40 hover:border-accent/30">
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</p>
        <p className="truncate font-mono text-xs text-ink2" title={value}>
          {value}
        </p>
      </div>
      <CopyButton value={value} label={label} className={FOCUS_CLEARANCE} />
    </div>
  );
}

export default function BridgePage() {
  // Opacity only, via `--rise-card: 0px`: the standard 14px rise on a 16px line is nearly the
  // line's own height and reads as a glitch rather than a lift.
  const footnote = useReveal<HTMLParagraphElement>(6);

  return (
    <div className="mx-auto max-w-3xl py-4">
      {/* Above the fold on every viewport, so this is a self-completing CSS animation rather than
          an observer reveal — an IntersectionObserver here would leave the first screen blank until
          hydration. The h1 and the intro rise as one unit: two lines 12px apart, and staggering
          them would make the header read as two events. */}
      <header className="mb-6" data-enter="" style={{ '--i': 0 } as CSSProperties}>
        <h1 className="font-display text-[26px] font-extrabold leading-tight tracking-tightest sm:text-[34px]">
          How to get <span className="accent-text accent-sweep">COOK</span>
        </h1>
        <p className="mt-2 max-w-prose text-sm text-ink2">
          Cookie Chain is mainnet-only — there is no faucet and no devnet, so every transaction
          spends real COOK. Four steps to fund a wallet from scratch.
        </p>
      </header>

      {/* The <ol> gets no reveal and no transform — it is only the stagger coordinate space. A
          parent fade multiplied by four child fades makes the last card's curve mushy. */}
      <ol className="space-y-3">
        {STEPS.map((step) => (
          <li key={step.n} data-enter="" style={{ '--i': step.n } as CSSProperties}>
            {/* The app's only pointer physicality, and the only place the three gates admit it:
                solid, whole-surface, and holding no polled number. `variant="solid"` is a
                prerequisite rather than a preference — transforming a backdrop-filtered card
                re-blurs its whole backdrop every frame and visibly shifts its tint. */}
            <PointerWeight>
              <Card variant="solid" className="p-4 sm:p-5">
                <div className="flex gap-3 sm:gap-4">
                  {/* Preflight strips the native <ol> marker, so this badge IS the list ordinal —
                      the one beat on this route that carries meaning rather than decoration. It
                      lands 80ms behind its own card, so the user watches 1, 2, 3, 4 count on. */}
                  <span className="step-badge accent-gradient flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-accent-ink shadow-[0_6px_16px_-8px_rgb(var(--accent-glow)/0.8)]">
                    {step.n}
                  </span>
                  <div className="min-w-0 flex-1">
                    {/* Title and body get nothing: no per-line reveal, no split, no sweep on the
                        <strong> runs. Those runs are load-bearing warnings that stop someone
                        bridging to the wrong mint, and instructional prose that assembles while
                        you read it is worse than prose that is simply there. */}
                    <h2 className="font-display text-base font-bold tracking-tight">{step.title}</h2>
                    <p className="mt-1 text-sm leading-relaxed text-ink2">{step.body}</p>

                    {/* No nested stagger: the six ValueRows arrive as part of their card. Step 4 is
                        already at a 240ms delay and holds three rows; a sibling ladder would push
                        the WebSocket endpoint — the string people scroll here to copy — past 700ms
                        of delay before it even starts travelling. */}
                    {step.values ? (
                      <div className="mt-3 space-y-2">
                        {step.values.map((v) => (
                          <ValueRow key={v.label} {...v} />
                        ))}
                      </div>
                    ) : null}

                    {step.link ? (
                      <a
                        href={step.link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cn(
                          'group mt-3 inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline',
                          FOCUS_CLEARANCE,
                        )}
                      >
                        {step.link.label}{' '}
                        {/* A 2px nudge (--nudge, written literally so the JIT can infer the type)
                            along the glyph's own diagonal. The underline stays exactly as it was —
                            text-decoration cannot transition, and a scaleX pseudo-rule would run
                            under the icon on this inline-flex anchor and read as a bug. */}
                        <ArrowUpRight
                          size={14}
                          className="transition-transform duration-[160ms] ease-[cubic-bezier(.2,.7,.3,1)] motion-safe:group-hover:translate-x-[2px] motion-safe:group-hover:translate-y-[-2px] motion-safe:group-active:translate-x-0 motion-safe:group-active:translate-y-0"
                        />
                      </a>
                    ) : null}
                  </div>
                </div>
              </Card>
            </PointerWeight>
          </li>
        ))}
      </ol>

      {/* The payoff beat: a genuine scroll reveal on every viewport. It holds two of the five
          below-fold focusables, which is what makes the reveal contract's `:focus-within` clause
          load-bearing here. Solid because it transforms. */}
      <Card
        variant="solid"
        reveal
        revealIndex={5}
        className="mt-4 flex flex-wrap items-center justify-between gap-3 p-4"
      >
        <div className="flex items-center gap-2 text-sm text-ink2">
          <Wallet size={16} className="text-accent" />
          Funded already?
        </div>
        <div className="flex gap-2">
          {/* Both buttons had no transition class at all, so `hover:brightness-110` and
              `hover:border-accent/50` were hard cuts. Identical durations and distances on the two:
              mismatched hover physics on adjacent buttons is more noticeable than no hover at all.
              The lift stays at exactly 1px — this row wraps to two lines at 390px. */}
          <Link
            href="/trade"
            className={cn(
              'accent-gradient rounded-xl px-3 py-2 text-xs font-semibold text-accent-ink shadow-[0_8px_22px_-10px_rgb(var(--accent-glow)/0.7)]',
              'transition-[filter,transform,color,border-color] duration-150 ease-[cubic-bezier(.2,.7,.3,1)] hover:brightness-110',
              'motion-safe:hover:-translate-y-px motion-safe:active:translate-y-0 motion-safe:active:scale-[0.98] motion-safe:active:duration-[90ms]',
              FOCUS_CLEARANCE,
            )}
          >
            Make a swap
          </Link>
          <Link
            href="/portfolio"
            className={cn(
              'rounded-xl border border-hairline/10 bg-surface2 px-3 py-2 text-xs font-semibold hover:border-accent/50',
              'transition-[filter,transform,color,border-color] duration-150 ease-[cubic-bezier(.2,.7,.3,1)]',
              'motion-safe:hover:-translate-y-px motion-safe:active:translate-y-0 motion-safe:active:scale-[0.98] motion-safe:active:duration-[90ms]',
              FOCUS_CLEARANCE,
            )}
          >
            View portfolio
          </Link>
        </div>
      </Card>

      <p
        {...footnote.revealProps}
        ref={footnote.ref}
        style={{ '--i': 6, '--rise-card': '0px' } as CSSProperties}
        className="mt-4 text-xs text-muted"
      >
        Nightly is the recommended wallet. Any Wallet Standard SVM wallet pointed at the Cookie Chain
        RPC will also connect.
      </p>
    </div>
  );
}
