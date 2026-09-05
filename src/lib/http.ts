// Server-side JSON fetch: timeout + one retry, but only for idempotent requests. A POST is never
// retried — a retried /swap-tx could build a second transaction. Ported from cookie-mcp (MIT)
// `src/core/http.ts`.
import 'server-only';

export const DEFAULT_TIMEOUT_MS = 12_000;

export class UpstreamError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'UpstreamError';
    this.status = status;
  }
}

async function attempt<T>(url: string, init: RequestInit & { timeoutMs?: number }): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
      signal: controller.signal,
    });
    const text = await res.text();
    let data: unknown = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        throw new UpstreamError(`${url} returned non-JSON (HTTP ${res.status})`, 502);
      }
    }
    if (!res.ok) {
      // The Cookiebox agg puts its real reason in `error` (e.g. "Swap simulation failed.\nAccountNotFound").
      const msg = (data as { error?: string })?.error ?? `request failed (HTTP ${res.status})`;
      throw new UpstreamError(msg, res.status);
    }
    return data as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson<T>(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const idempotent = !init.method || init.method.toUpperCase() === 'GET';
  const maxAttempts = idempotent ? 2 : 1;
  let last: unknown;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await attempt<T>(url, init);
    } catch (e) {
      last = e;
      // 4xx will not self-heal; only timeouts, network errors, 429 and 5xx are worth a second try.
      const retryable =
        !(e instanceof UpstreamError) || e.status === 429 || e.status >= 500;
      if (!retryable || i === maxAttempts - 1) break;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw last instanceof Error ? last : new UpstreamError(`request to ${url} failed`, 502);
}

/** Uniform JSON error body for our own route handlers. */
export function errorResponse(e: unknown): Response {
  const status = e instanceof UpstreamError ? (e.status >= 400 && e.status < 600 ? e.status : 502) : 502;
  const message = e instanceof Error ? e.message : 'upstream request failed';
  return Response.json({ error: message }, { status });
}

export const CACHE_HEADERS = { 'Cache-Control': 's-maxage=20, stale-while-revalidate=60' };
export const NO_CACHE_HEADERS = { 'Cache-Control': 'no-store' };
