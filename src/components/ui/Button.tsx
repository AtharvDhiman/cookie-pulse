'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';
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
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all duration-150',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none disabled:hover:brightness-100',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
    >
      {loading ? <Loader2 size={15} className="animate-spin" /> : null}
      {children}
    </button>
  );
}
