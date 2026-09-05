'use client';

import { Check, Copy } from 'lucide-react';
import { useCallback, useState, type ReactNode } from 'react';
import { initials } from '@/lib/format';

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export function Card({
  children,
  className,
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article';
}) {
  return (
    <Tag className={cn('rounded-xl border border-rule bg-surface', className)}>{children}</Tag>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('relative overflow-hidden rounded-md bg-surface2', className)}
      aria-hidden="true"
    >
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/5 to-transparent" />
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-4 py-10 text-center">
      <p className="text-sm font-medium text-ink2">{title}</p>
      {hint ? <p className="max-w-sm text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function Pill({
  children,
  tone = 'muted',
}: {
  children: ReactNode;
  tone?: 'muted' | 'accent' | 'up' | 'down' | 'warn';
}) {
  const tones = {
    muted: 'bg-surface2 text-muted border-rule',
    accent: 'bg-accent/15 text-accent border-accent/30',
    up: 'bg-up/15 text-up border-up/30',
    down: 'bg-down/15 text-down border-down/30',
    warn: 'bg-warn/15 text-warn border-warn/30',
  } as const;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold',
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

/** Signed percentage, coloured up/down. Renders a dash when the value is unknown. */
export function Change({ value, className }: { value: number | null; className?: string }) {
  if (value === null || !Number.isFinite(value)) {
    return <span className={cn('text-muted', className)}>—</span>;
  }
  const flat = Math.abs(value) < 0.005;
  return (
    <span
      className={cn(
        'tabular-nums',
        flat ? 'text-muted' : value > 0 ? 'text-up' : 'text-down',
        className,
      )}
    >
      {value >= 0 ? '+' : ''}
      {value.toFixed(2)}%
    </span>
  );
}

export function CopyButton({
  value,
  label,
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      return; // Clipboard blocked (insecure context) — stay silent rather than showing a fake tick.
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }, [value]);

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={label ? `Copy ${label}` : `Copy ${value}`}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-muted transition-colors hover:bg-surface2 hover:text-ink',
        className,
      )}
    >
      {copied ? <Check size={13} className="text-up" /> : <Copy size={13} />}
      {label ? <span className="text-xs">{copied ? 'Copied' : label}</span> : null}
    </button>
  );
}

/** Token logo with an initials fallback — 1500 of 6470 registry entries have no logo. */
export function TokenLogo({
  logo,
  symbol,
  size = 28,
}: {
  logo: string | null;
  symbol: string;
  size?: number;
}) {
  const [broken, setBroken] = useState(false);
  const px = { width: size, height: size };

  if (!logo || broken) {
    return (
      <span
        style={px}
        className="flex shrink-0 items-center justify-center rounded-full bg-surface2 text-[9px] font-bold text-muted ring-1 ring-rule"
      >
        {initials(symbol)}
      </span>
    );
  }
  return (
    <img
      src={logo}
      alt=""
      style={px}
      loading="lazy"
      onError={() => setBroken(true)}
      className="shrink-0 rounded-full bg-surface2 object-cover ring-1 ring-rule"
    />
  );
}

export function StatusDot({ status }: { status: 'operational' | 'degraded' | 'down' | 'unknown' }) {
  const tone = {
    operational: 'bg-up',
    degraded: 'bg-warn',
    down: 'bg-down',
    unknown: 'bg-muted',
  } as const;
  return (
    <span
      className={cn('inline-block h-2 w-2 shrink-0 rounded-full', tone[status])}
      aria-hidden="true"
    />
  );
}
