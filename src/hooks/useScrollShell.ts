'use client';

// The single scroll listener in the application.
//
// One passive scroll listener and one ResizeObserver, both funnelled into one rAF loop that parks
// itself when everything has settled. It writes only to <html> — four custom properties and three
// boolean attributes — so no React state changes and nothing re-renders while you scroll.
//
// Drives, all at once: the progress hairline, the header scrim, the haste governor, the ambient
// parallax, and the short-page suppression gate.
import { useEffect } from 'react';

// Lerp constants are per-frame approach rates, not distances. The glow and the grid drift at
// different rates, which is what produces parallax separation on a flick — a scroll-linked
// timeline, being a pure function of position, cannot do that.
const LERP_PROGRESS = 0.15;
const LERP_GLOW = 0.08;
const LERP_GRID = 0.14;

const GLOW_RATE = -0.06;
const GLOW_MAX = -64;
const GRID_RATE = 0.028;
const GRID_MAX = 28;

const HASTE_ON = 1800; // px/s
const HASTE_OFF = 900;
const SCROLLED_ON = 12; // px
const SCROLLED_OFF = 4;
const SCROLLABLE_MIN = 800; // px of runway before the progress bar earns its place

const PARK = 0.0005;

export function useScrollShell(): void {
  useEffect(() => {
    // Reduced motion registers nothing at all. Writing smaller values would still burn a frame per
    // scroll event on a page already polling five endpoints.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const root = document.documentElement;

    let progress = 0;
    let glow = 0;
    let grid = 0;
    let velocity = 0;

    let lastY = window.scrollY;
    let lastT = performance.now();

    let scrolled = false;
    let haste = false;
    let running = false;
    let raf = 0;

    const frame = () => {
      const y = window.scrollY;
      const runway = Math.max(0, root.scrollHeight - window.innerHeight);

      const targetProgress = runway > 0 ? Math.min(1, y / runway) : 0;
      const targetGlow = Math.max(GLOW_MAX, Math.min(0, y * GLOW_RATE));
      const targetGrid = Math.min(GRID_MAX, Math.max(0, y * GRID_RATE));

      progress += (targetProgress - progress) * LERP_PROGRESS;
      glow += (targetGlow - glow) * LERP_GLOW;
      grid += (targetGrid - grid) * LERP_GRID;

      root.style.setProperty('--scroll-progress', progress.toFixed(4));
      root.style.setProperty('--amb-y', glow.toFixed(2) + 'px');
      root.style.setProperty('--amb-grid-y', grid.toFixed(2) + 'px');

      // Velocity decays here rather than on the scroll event, so the governor releases even when
      // the user stops dead and no further events arrive.
      velocity *= 0.86;
      if (haste && velocity < HASTE_OFF) {
        haste = false;
        root.removeAttribute('data-haste');
      }

      const settled =
        Math.abs(targetProgress - progress) < PARK &&
        Math.abs(targetGlow - glow) < 0.05 &&
        Math.abs(targetGrid - grid) < 0.05 &&
        !haste;

      if (settled) {
        running = false;
        return;
      }
      raf = requestAnimationFrame(frame);
    };

    const start = () => {
      if (running) return;
      running = true;
      raf = requestAnimationFrame(frame);
    };

    const onScroll = () => {
      const now = performance.now();
      const y = window.scrollY;
      const dt = now - lastT;
      if (dt > 0) velocity = (Math.abs(y - lastY) / dt) * 1000;
      lastY = y;
      lastT = now;

      if (!scrolled && y >= SCROLLED_ON) {
        scrolled = true;
        root.setAttribute('data-scrolled', '');
      } else if (scrolled && y <= SCROLLED_OFF) {
        scrolled = false;
        root.removeAttribute('data-scrolled');
      }

      if (!haste && velocity > HASTE_ON) {
        haste = true;
        root.setAttribute('data-haste', '');
      }

      start();
    };

    const measure = () => {
      const scrollable = root.scrollHeight - window.innerHeight >= SCROLLABLE_MIN;
      root.toggleAttribute('data-scrollable', scrollable);
      start();
    };

    measure();
    window.addEventListener('scroll', onScroll, { passive: true });

    const ro = new ResizeObserver(measure);
    ro.observe(document.body);

    return () => {
      window.removeEventListener('scroll', onScroll);
      ro.disconnect();
      cancelAnimationFrame(raf);
      root.removeAttribute('data-scrolled');
      root.removeAttribute('data-haste');
      root.removeAttribute('data-scrollable');
    };
  }, []);
}
