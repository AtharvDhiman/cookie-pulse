'use client';

import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { cn } from './primitives';

type Variant = 'primary' | 'secondary' | 'ghost';
type Size = 'sm' | 'md';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  children: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  // Gradient fill plus an accent glow — the one element on screen allowed to draw the eye.
  primary:
    'accent-gradient text-accent-ink shadow-[0_8px_24px_-10px_rgb(var(--accent-glow)/0.7)] hover:brightness-110 active:brightness-95',
  secondary:
    'bg-surface2 text-ink border border-hairline/10 hover:border-accent/40 hover:bg-surface2/70',
  ghost: 'text-ink2 hover:bg-surface2 hover:text-ink',
};

const SIZES: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2.5 text-sm',
};

// Explicit property list, not `transition-all`: that swept in the primary variant's 24px accent
// box-shadow and its hover brightness filter, repainting a gradient-filled element every frame on
// the most-pressed control in the app.
const BASE =
  'inline-flex items-center justify-center gap-2 rounded-xl font-semibold press transition-[transform,filter,background-color,border-color,color,box-shadow,opacity] duration-150 ease-[cubic-bezier(.2,.7,.3,1)]';

/**
 * The button treatment as a class string, for the cases that cannot be a <button>.
 *
 * This exists because three navigation CTAs — the hero's "Start trading", /bridge's two, and the
 * 404's — each re-typed the gradient, the glow radius, the padding and the easing by hand, and all
 * four had drifted: three different box-shadow spreads, three paddings for the same visual weight,
 * and two different transition property lists. A primary action must look the same whether it
 * submits a transaction or navigates.
 */
export function buttonClass({
  variant = 'primary',
  size = 'md',
  className,
}: { variant?: Variant; size?: Size; className?: string } = {}): string {
  return cn(BASE, VARIANTS[variant], SIZES[size], className);
}

/**
 * A link wearing the button treatment. Lifts 1px on hover, which <button> deliberately does not:
 * going somewhere reads as a lift, acting in place reads as a press.
 */
export function ButtonLink({
  href,
  variant = 'primary',
  size = 'md',
  className,
  children,
  ...rest
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: string;
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}) {
  return (
    <Link
      {...rest}
      href={href}
      className={buttonClass({
        variant,
        size,
        className: cn(
          'motion-safe:hover:-translate-y-px motion-safe:active:translate-y-0',
          className,
        ),
      })}
    >
      {children}
    </Link>
  );
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  disabled,
  className,
  children,
  ...rest
}: Props) {
  return (
    <button
      {...rest}
      // A pending transaction must not be re-submittable, so `loading` disables on its own.
      disabled={disabled || loading}
      className={buttonClass({
        variant,
        size,
        className: cn(
          'disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none disabled:hover:brightness-100 disabled:active:scale-100',
          className,
        ),
      })}
    >
      {loading ? <Loader2 size={15} className="animate-spin" /> : null}
      {children}
    </button>
  );
}
