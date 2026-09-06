// Display formatting. Cookie Chain prices span ~9 orders of magnitude (0.0000000072 → 0.0012),
// so significant-digit formatting matters more than a fixed decimal count.

export function formatUsd(v: number | null | undefined, opts?: { compact?: boolean }): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  if (v === 0) return '$0.00';
  const abs = Math.abs(v);
  if (opts?.compact && abs >= 1000) return `$${compact(v)}`;
  if (abs >= 1) return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (abs >= 0.01) return `$${v.toFixed(4)}`;
  // Sub-cent, which is most of this registry (prices reach 7.2e-9). `toPrecision` would emit
  // exponential notation below 1e-6 and render as "$3.849e-7", so widen toFixed to keep 4
  // significant digits in plain decimal instead.
  const decimals = Math.min(18, Math.max(4, -Math.floor(Math.log10(abs)) + 3));
  return `$${trimZeros(v.toFixed(decimals))}`;
}

/** Drops trailing zeros left by a wide toFixed, keeping at least two decimal places. */
function trimZeros(s: string): string {
  if (!s.includes('.')) return s;
  const trimmed = s.replace(/0+$/, '');
  const [whole, frac = ''] = trimmed.split('.');
  return frac.length >= 2 ? `${whole}.${frac}` : `${whole}.${frac.padEnd(2, '0')}`;
}

export function compact(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  // Thresholds are the value at which the NEXT unit down would round up to 1000.00, not the unit
  // boundary itself. Branching on the raw magnitude meant 999,999,738 COOK -- this chain's actual
  // supply -- was below 1e9, fell to the M branch, and printed "1000.00M". The comparison uses the
  // absolute value and the division uses the signed one, so negatives still render correctly.
  if (abs >= 999.995e6) return `${(v / 1e9).toFixed(2)}B`;
  if (abs >= 999.995e3) return `${(v / 1e6).toFixed(2)}M`;
  if (abs >= 999.995) return `${(v / 1e3).toFixed(2)}K`;
  return v.toFixed(2);
}

/**
 * `opts.compact: false` keeps full precision above 1e6.
 *
 * The default compacts, which is right for a balance chip and wrong for a number the chain
 * enforces: "Minimum received" is the floor below which the swap reverts, and rendering
 * 1,980,054.14802 as "1.98M" understates the guarantee by thousands of tokens. Opt-out rather than
 * opt-in so every existing call site keeps its current behaviour.
 */
export function formatAmount(
  v: number | null | undefined,
  decimals = 6,
  opts?: { compact?: boolean },
): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  if (v === 0) return '0';
  const abs = Math.abs(v);
  if (abs >= 1e6 && opts?.compact !== false) return compact(v);
  if (abs >= 1) return v.toLocaleString('en-US', { maximumFractionDigits: Math.min(decimals, 6) });
  return v.toFixed(Math.min(decimals, 9)).replace(/0+$/, '').replace(/\.$/, '');
}

export function formatPct(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`;
}

export function shortAddr(a: string | null | undefined, lead = 4, tail = 4): string {
  if (!a) return '—';
  return a.length <= lead + tail + 1 ? a : `${a.slice(0, lead)}…${a.slice(-tail)}`;
}

export function timeAgo(unixSeconds: number | null | undefined, nowMs: number): string {
  if (!unixSeconds || !Number.isFinite(unixSeconds)) return '—';
  const s = Math.max(0, Math.round(nowMs / 1000 - unixSeconds));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Fallback avatar text when a token has no logo (1500 of 6470 do not). */
export function initials(symbol: string): string {
  return symbol.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase() || '?';
}

/** Decimal string -> raw base units, without float rounding. Returns null on malformed input. */
export function toRawAmount(input: string, decimals: number): string | null {
  const t = input.trim();
  if (!/^\d*\.?\d*$/.test(t) || t === '' || t === '.') return null;
  const [whole = '', frac = ''] = t.split('.');
  if (frac.length > decimals) return null;
  const raw = `${whole}${frac.padEnd(decimals, '0')}`.replace(/^0+(?=\d)/, '');
  return raw === '' ? '0' : raw;
}

/** Raw base units -> number. Safe for display; not for further exact arithmetic. */
export function fromRawAmount(raw: string | number | bigint, decimals: number): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n / 10 ** decimals : 0;
}
