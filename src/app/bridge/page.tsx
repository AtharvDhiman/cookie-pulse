'use client';

import Link from 'next/link';
import { ArrowUpRight, Wallet } from 'lucide-react';
import {
  BRIDGE_URL,
  COOK_SOLANA_DECIMALS,
  COOK_SOLANA_MINT,
  HYPERLANE_DOMAINS,
  RPC_URL,
  WS_URL,
} from '@/lib/config';
import { Card, CopyButton } from '@/components/ui/primitives';

interface Step {
  n: number;
  title: string;
  body: React.ReactNode;
  link?: { href: string; label: string };
  values?: { label: string; value: string }[];
}

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
    <div className="flex items-center justify-between gap-2 rounded-xl border border-hairline/10 bg-surface2 px-3 py-2">
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</p>
        <p className="truncate font-mono text-xs text-ink2" title={value}>
          {value}
        </p>
      </div>
      <CopyButton value={value} label={label} />
    </div>
  );
}

export default function BridgePage() {
  return (
    <div className="mx-auto max-w-3xl py-4">
      <header className="mb-6">
        <h1 className="font-display text-[26px] font-extrabold leading-tight tracking-tightest sm:text-[34px]">How to get COOK</h1>
        <p className="mt-2 max-w-prose text-sm text-ink2">
          Cookie Chain is mainnet-only — there is no faucet and no devnet, so every transaction
          spends real COOK. Four steps to fund a wallet from scratch.
        </p>
      </header>

      <ol className="space-y-3">
        {STEPS.map((step) => (
          <li key={step.n}>
            <Card className="p-4 sm:p-5">
              <div className="flex gap-3 sm:gap-4">
                <span className="accent-gradient flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-accent-ink shadow-[0_6px_16px_-8px_rgb(var(--accent-glow)/0.8)]">
                  {step.n}
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="font-display text-base font-bold tracking-tight">{step.title}</h2>
                  <p className="mt-1 text-sm leading-relaxed text-ink2">{step.body}</p>

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
                      className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline"
                    >
                      {step.link.label} <ArrowUpRight size={14} />
                    </a>
                  ) : null}
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ol>

      <Card className="mt-4 flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-2 text-sm text-ink2">
          <Wallet size={16} className="text-accent" />
          Funded already?
        </div>
        <div className="flex gap-2">
          <Link
            href="/trade"
            className="accent-gradient rounded-xl px-3 py-2 text-xs font-semibold text-accent-ink shadow-[0_8px_22px_-10px_rgb(var(--accent-glow)/0.7)] hover:brightness-110"
          >
            Make a swap
          </Link>
          <Link
            href="/portfolio"
            className="rounded-xl border border-hairline/10 bg-surface2 px-3 py-2 text-xs font-semibold hover:border-accent/50"
          >
            View portfolio
          </Link>
        </div>
      </Card>

      <p className="mt-4 text-xs text-muted">
        Nightly is the recommended wallet. Any Wallet Standard SVM wallet pointed at the Cookie Chain
        RPC will also connect.
      </p>
    </div>
  );
}
