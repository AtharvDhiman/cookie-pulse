'use client';

import { Check, Copy } from 'lucide-react';
import { useCallback, useState, type ReactNode } from 'react';
import { initials } from '@/lib/format';

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/**
 * The app's one panel. `glass` is translucent with a blurred backdrop — right over the ambient
 * glow; `solid` is opaque, for dense data surfaces where translucency costs legibility.
 */
export function Card({
  children,
  className,
  variant = 'glass',
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  variant?: 'glass' | 'solid';
  as?: 'div' | 'section' | 'article' | 'aside';
}) {
  return (
    <Tag
      className={cn(
        'rounded-2xl',
        variant === 'glass' ? 'glass' : 'glass-solid',
        className,
      )}
    >
      {children}
    </Tag>
  );
}

/** Small uppercase label above a section — the reference leans on these heavily. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        'text-[10px] font-semibold uppercase tracking-[0.14em] text-muted',
        className,
      )}
    >
      {children}
    </p>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('relative overflow-hidden rounded-md bg-surface2', className)}
      aria-hidden="true"
    >
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 px-4 py-12 text-center">
      <p className="text-sm font-semibold text-ink2">{title}</p>
      {hint ? <p className="max-w-sm text-xs leading-relaxed text-muted">{hint}</p> : null}
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
    muted: 'bg-surface2 text-muted border-hairline/10',
    accent: 'bg-accent/12 text-accent border-accent/25',
    up: 'bg-up/12 text-up border-up/25',
    down: 'bg-down/12 text-down border-down/25',
    warn: 'bg-warn/12 text-warn border-warn/25',
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

/** Signed percentage, coloured up/down. A dash when the value is genuinely unknown. */
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
      return; // Clipboard blocked (insecure context) — better silent than a lying tick.
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
        'inline-flex shrink-0 items-center gap-1 rounded-xl px-1.5 py-1 text-muted transition-colors hover:bg-surface2 hover:text-ink',
        className,
      )}
    >
      {copied ? <Check size={13} className="text-up" /> : <Copy size={13} />}
      {label ? <span className="text-xs">{copied ? 'Copied' : label}</span> : null}
    </button>
  );
}

/** Token logo with an initials fallback — 1,500 of 6,470 registry entries have no logo. */
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
        className="flex shrink-0 items-center justify-center rounded-full bg-surface2 text-[9px] font-bold text-muted ring-1 ring-hairline/10"
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
      className="shrink-0 rounded-full bg-surface2 object-cover ring-1 ring-hairline/10"
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
    <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
      {/* A soft halo makes the live state readable at a glance without adding a label. */}
      <span
        className={cn('absolute inline-flex h-full w-full rounded-full opacity-40', tone[status])}
        style={{ filter: 'blur(3px)' }}
      />
      <span
        className={cn(
          'relative inline-flex h-2 w-2 rounded-full',
          tone[status],
          status === 'operational' && 'animate-pulse-dot',
        )}
      />
    </span>
  );
}
