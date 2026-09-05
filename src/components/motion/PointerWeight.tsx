'use client';

// The one expressive, pointer-driven effect in the system: a 3px lift, a shallow tilt, and a
// specular highlight that follows the cursor.
//
// Deliberately scoped to the /bridge step cards and nothing else. Every other card in the app is
// either `glass` — transforming a backdrop-filtered element re-blurs its whole backdrop each frame
// and visibly shifts its tint — or holds a polled figure, and springing a container around a
// number that is itself changing looks broken rather than alive.
import { useCallback, useEffect, useRef, type ReactNode } from 'react';

const LERP = 0.12;

export function PointerWeight({
  children,
  className,
  tiltDeg = 1.6,
}: {
  children: ReactNode;
  className?: string;
  tiltDeg?: number;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const raf = useRef(0);

  // Targets are written by pointermove; the loop chases them. Held in a ref so a moving cursor
  // never triggers a React render.
  const target = useRef({ rx: 0, ry: 0, x: 50, y: 50, lift: 0 });
  const current = useRef({ rx: 0, ry: 0, x: 50, y: 50, lift: 0 });

  const stop = useCallback(() => {
    cancelAnimationFrame(raf.current);
    raf.current = 0;
  }, []);

  const loop = useCallback(() => {
    const el = inner.current;
    if (!el) return;

    const c = current.current;
    const t = target.current;
    c.rx += (t.rx - c.rx) * LERP;
    c.ry += (t.ry - c.ry) * LERP;
    c.x += (t.x - c.x) * LERP;
    c.y += (t.y - c.y) * LERP;
    c.lift += (t.lift - c.lift) * LERP;

    el.style.setProperty('--pw-rx', c.rx.toFixed(3) + 'deg');
    el.style.setProperty('--pw-ry', c.ry.toFixed(3) + 'deg');
    el.style.setProperty('--pw-x', c.x.toFixed(2) + '%');
    el.style.setProperty('--pw-y', c.y.toFixed(2) + '%');
    el.style.setProperty('--pw-lift', (-c.lift).toFixed(2) + 'px');

    const settled =
      Math.abs(t.rx - c.rx) < 0.01 &&
      Math.abs(t.ry - c.ry) < 0.01 &&
      Math.abs(t.lift - c.lift) < 0.01;

    if (settled) {
      raf.current = 0;
      return;
    }
    raf.current = requestAnimationFrame(loop);
  }, []);

  const start = useCallback(() => {
    if (!raf.current) raf.current = requestAnimationFrame(loop);
  }, [loop]);

  useEffect(() => stop, [stop]);

  const enabled = () =>
    typeof window !== 'undefined' &&
    window.matchMedia('(hover: hover) and (pointer: fine)').matches &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!enabled()) return;
    const box = outer.current?.getBoundingClientRect();
    if (!box) return;

    const px = (event.clientX - box.left) / box.width;
    const py = (event.clientY - box.top) / box.height;

    target.current = {
      // Tilt away from the cursor: pushing the near edge down is what reads as weight.
      rx: (0.5 - py) * 2 * tiltDeg,
      ry: (px - 0.5) * 2 * tiltDeg,
      x: px * 100,
      y: py * 100,
      lift: 3,
    };
    outer.current?.setAttribute('data-pw-active', '');
    start();
  };

  const onPointerLeave = () => {
    target.current = { rx: 0, ry: 0, x: 50, y: 50, lift: 0 };
    outer.current?.removeAttribute('data-pw-active');
    // The CSS transition on the released state carries it home; the loop is no longer needed.
    stop();
    const el = inner.current;
    if (!el) return;
    current.current = { rx: 0, ry: 0, x: 50, y: 50, lift: 0 };
    el.style.setProperty('--pw-rx', '0deg');
    el.style.setProperty('--pw-ry', '0deg');
    el.style.setProperty('--pw-lift', '0px');
  };

  return (
    <div
      ref={outer}
      className={'pw ' + (className ?? '')}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      <div ref={inner} className="pw-inner">
        {children}
      </div>
    </div>
  );
}
