'use client';

// Scroll reveal, tier 1 — the workhorse behind ~85% of the motion in the app.
//
// One module-level IntersectionObserver serves every element on every route: a per-node observer
// would mean hundreds of them on the screener alone. Elements are unobserved the moment they show,
// so the set only ever shrinks.
//
// The rootMargin's bottom value is POSITIVE on purpose. It expands the root box downward, arming an
// element ~15% of a viewport before its top crosses the fold, so by the time the user's eye arrives
// the transition is already most of the way through its travel. Reading it as a typo and "fixing"
// it to a negative value makes every reveal land late.
import { useEffect, useRef, type CSSProperties } from 'react';

const OPTIONS: IntersectionObserverInit = { threshold: 0, rootMargin: '0px 0px 15% 0px' };

let shared: IntersectionObserver | null = null;

function observer(): IntersectionObserver | null {
  if (typeof IntersectionObserver === 'undefined') return null;
  if (!shared) {
    shared = new IntersectionObserver((entries, io) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        (entry.target as HTMLElement).dataset.shown = '';
        io.unobserve(entry.target);
      }
    }, OPTIONS);
  }
  return shared;
}

interface RevealProps {
  'data-reveal': '';
  style?: CSSProperties;
}

/**
 * `index` staggers this element against its siblings; leave it undefined for a lone block.
 * Pass a bare number — `min()` inside `calc()` yields 0ms if the custom property carries units.
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>(index?: number) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || el.dataset.shown !== undefined) return;

    const io = observer();
    if (!io) {
      // No IntersectionObserver at all: show everything rather than gate content on a missing API.
      el.dataset.shown = '';
      return;
    }

    // Cancels the CSS failsafe — the observer has taken responsibility for this element.
    el.dataset.armed = '';
    io.observe(el);
    return () => io.unobserve(el);
  }, []);

  const revealProps: RevealProps =
    index === undefined
      ? { 'data-reveal': '' }
      : { 'data-reveal': '', style: { '--i': index } as CSSProperties };

  return { ref, revealProps };
}
