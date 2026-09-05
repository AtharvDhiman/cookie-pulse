'use client';

// A reveal for markup that cannot host the hook itself — Server Components, and plain blocks that
// are not a Card. Renders exactly one element and adds no wrapper of its own beyond it, so it never
// breaks grid or flex participation.
import type { ReactNode } from 'react';
import { useReveal } from '@/hooks/useReveal';

type Tag = 'div' | 'section' | 'ul' | 'li' | 'header' | 'footer' | 'article';

export function Reveal({
  as: Element = 'div',
  index,
  className,
  children,
}: {
  as?: Tag;
  index?: number;
  className?: string;
  children: ReactNode;
}) {
  const { ref, revealProps } = useReveal<HTMLElement>(index);
  return (
    <Element ref={ref as never} className={className} {...revealProps}>
      {children}
    </Element>
  );
}
