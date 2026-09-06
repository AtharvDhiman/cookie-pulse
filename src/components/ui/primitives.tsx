'use client';

import { Check, Copy } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { initials } from '@/lib/format';
import { useReveal } from '@/hooks/useReveal';

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
  reveal = false,
  revealIndex,
}: {
  children: ReactNode;
  className?: string;
  variant?: 'glass' | 'solid';
  as?: 'div' | 'section' | 'article' | 'aside';
  /** Opt this panel into the scroll reveal without wrapping it — a wrapper would break grid participation. */
  reveal?: boolean;
  /** Stagger position among sibling panels. Bare number; units break the `min()` in the delay calc. */
  revealIndex?: number;
}) {
  // Called unconditionally, as hooks must be. With `reveal` false the ref is never attached, so the
  // effect finds no element and does nothing.
  const { ref, revealProps } = useReveal<HTMLElement>(revealIndex);
  return (
    <Tag
      ref={reveal ? (ref as never) : undefined}
      {...(reveal ? revealProps : null)}
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

/**
 * The app's one small-uppercase label.
 *
 * There were nine of these across 24 sites: three sizes (10px, 11px, 12px) and four tracking
 * values (`wide`, `wider`, 0.12em, 0.14em), with /send and /trade labelling the SAME field at
 * 12px and 11px respectively. None of that was chosen — and a label that changes size between two
 * halves of the same flow is the kind of thing a designer notices immediately.
 *
 * Colour is deliberately NOT in `LABEL`. Tailwind classes do not resolve by string order, so a
 * caller appending `text-ink2` to a base containing `text-muted` gets whichever rule happens to
 * sit later in the compiled sheet. Anything wanting a different colour composes `LABEL` instead.
 */
export const LABEL =
  'font-mono text-[10px] font-semibold uppercase tracking-[0.12em] leading-none';
export const LABEL_MUTED = `${LABEL} text-muted`;

/** The MAX / HALF micro-buttons that sit inside the two amount fields. */
export const MICRO_ACTION =
  'press press-sm shrink-0 border border-hairline/25 bg-surface2 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-accent transition-colors hover:border-accent/60 hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-40';

/** Small uppercase label above a section — the reference leans on these heavily. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn(LABEL_MUTED, className)}>{children}</p>;
}

/**
 * The one card header.
 *
 * Before this existed there were seven of them: three padding families (`px-3 py-2.5 sm:px-4`,
 * `px-4 py-3`, `px-4 py-3 sm:px-5`) and six title treatments across 13px, 14px and 15px, only one
 * of which used the display face. Nothing chose those differences — they are the residue of seven
 * components being written at different times, and they are exactly what reads as "assembled"
 * rather than "designed" when a page is scanned quickly.
 *
 * `meta` is the right-hand slot: a count, a freshness note, a pill, a link. It is deliberately not
 * typed to any of those, because the only rule is that it is secondary to the title.
 */
export function CardHeader({
  eyebrow,
  title,
  titleClassName,
  subtitle,
  icon,
  meta,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  /** Escape hatch for a title that is a value rather than a name (the health strip's status). */
  titleClassName?: string;
  subtitle?: ReactNode;
  /** Rendered inside the <h2>, before the title. Must be aria-hidden by the caller. */
  icon?: ReactNode;
  meta?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // Denser than the glass design and ruled on both edges. `bg-surface2` makes the head a
        // band rather than a floating caption, which is how a terminal separates a region.
        'flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-hairline/20 bg-surface2/60 px-3 py-2 sm:px-4',
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        {eyebrow ? <Eyebrow className="mb-1">{eyebrow}</Eyebrow> : null}
        {/* Uppercase mono. A section head in a terminal is set in the same face as the data
            under it, because it is the same kind of object: a field name. */}
        <h2
          className={cn(
            'flex items-center gap-1.5 font-mono text-[12px] font-bold uppercase tracking-[0.08em] text-ink',
            titleClassName,
          )}
        >
          {icon}
          {title}
        </h2>
        {subtitle ? (
          <p className="mt-1 text-[11px] leading-relaxed text-muted">{subtitle}</p>
        ) : null}
      </div>
      {meta ? <div className="flex shrink-0 items-center gap-2">{meta}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('relative overflow-hidden rounded-md bg-surface2', className)}
      aria-hidden="true"
    >
      <div className="shimmer-sweep absolute inset-0 -translate-x-full animate-shimmer" />
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    // Left-aligned and rule-marked rather than centred. A centred empty state reads as a
    // designed illustration slot; a terminal reports the absence in the same column as the data.
    <div className="flex flex-col gap-1.5 px-4 py-10 sm:px-5">
      <p className="font-mono text-[12px] font-bold uppercase tracking-[0.08em] text-ink2">
        <span className="mr-2 text-muted">──</span>
        {title}
      </p>
      {hint ? <p className="max-w-md text-xs leading-relaxed text-muted">{hint}</p> : null}
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
        // Square. A rounded-full tag is a web-app convention; a terminal tags a row with a boxed
        // code. Mono so a tag never changes the height of the row it sits in.
        'inline-flex items-center gap-1 whitespace-nowrap border px-1.5 py-px font-mono text-[10px] font-semibold uppercase tracking-[0.06em]',
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
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      return; // Clipboard blocked (insecure context) — better silent than a lying tick.
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1400);
  }, [value]);

  // Both states occupy the same grid cell, so the button is permanently as wide as the wider of
  // them. Swapping the text outright used to collapse the control by 36-81px and shove whatever
  // sat beside it — a layout bug, so this half is not gated on reduced motion.
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={label ? `Copy ${label}` : `Copy ${value}`}
      className={cn(
        'press press-sm inline-flex shrink-0 items-center gap-1 rounded-xl px-1.5 py-1 text-muted transition-colors hover:bg-surface2 hover:text-ink',
        className,
      )}
    >
      <span className="grid shrink-0 place-items-center">
        <Copy
          size={13}
          aria-hidden="true"
          className={cn(
            'col-start-1 row-start-1 transition-opacity duration-150',
            copied && 'opacity-0',
          )}
        />
        <Check
          size={13}
          aria-hidden="true"
          className={cn(
            'col-start-1 row-start-1 text-up transition-opacity duration-150',
            copied ? 'animate-check-pop opacity-100' : 'opacity-0',
          )}
        />
      </span>
      {label ? (
        <span className="grid text-xs">
          <span
            aria-hidden={copied}
            className={cn(
              'col-start-1 row-start-1 transition-opacity duration-150',
              copied && 'opacity-0',
            )}
          >
            {label}
          </span>
          <span
            aria-hidden={!copied}
            className={cn(
              'col-start-1 row-start-1 transition-opacity duration-150',
              copied ? 'opacity-100' : 'opacity-0',
            )}
          >
            Copied
          </span>
        </span>
      ) : null}
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

export function StatusDot({
  status,
  pinged = false,
}: {
  status: 'operational' | 'degraded' | 'down' | 'unknown';
  /** One outward ping. Drive it from a CHANGED VALUE, never from a fetch — the health query polls. */
  pinged?: boolean;
}) {
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
        className={cn(
          'absolute inline-flex h-full w-full rounded-full opacity-40',
          tone[status],
          pinged && 'animate-ping-once',
        )}
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
