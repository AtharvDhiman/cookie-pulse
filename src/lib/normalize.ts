// Defensive parsing for every upstream response. Cookiescan sometimes returns numbers as strings
// (69 of 6470 registry prices did on 4 Sep 2026) and may wrap arrays under `data` / `tokens` /
// `markets` or return them bare, so nothing here trusts a shape.

/** Pull the first array found at the top level or under any of `keys`. Never throws. */
export function unwrap<T>(json: unknown, keys: string[]): T[] {
  if (Array.isArray(json)) return json as T[];
  if (json && typeof json === 'object') {
    for (const k of keys) {
      const v = (json as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v as T[];
    }
  }
  return [];
}

/** Coerce to a finite number, or null. Accepts numeric strings; rejects NaN/Infinity/''/null. */
export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** `num` with a fallback, for fields that only ever feed arithmetic. */
export function num0(v: unknown, fallback = 0): number {
  return num(v) ?? fallback;
}

export function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * A registry entry that is one indivisible edition rather than a fungible balance: 0 decimals and a
 * total supply of exactly 1. Cookiescan's `/api/tokens` carries no interface field, so this is the
 * only per-row signal available without a second index — and on 5 Sep 2026 it disagreed with the
 * DAS index on none of the 6,473 mints (see NOTES.md), so the agreement is measured, not assumed.
 *
 * `/api/das` deliberately does not use this heuristic and must not start: it classifies a *wallet's*
 * assets, where a freshly created fungible mint can legitimately sit at supply 1 with nothing to
 * cross-check it against.
 */
export function isNftLike(t: { decimals: number; supply: number }): boolean {
  return t.decimals === 0 && t.supply === 1;
}

/** Reads a nested path without throwing on missing intermediates. */
export function pick(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const k of path) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}
