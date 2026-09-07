/**
 * Capture the README screenshots against a running production build.
 *
 * The previous set was taken by hand and went nineteen commits stale — it predated the sparklines,
 * the capital map, the token-safety audit, the orbit hero, the drawn mark and the whole design
 * pass, which is exactly the failure mode a committed script prevents.
 *
 * Drives headless Chrome over CDP. No new dependency: `chrome-launcher` is already in the tree and
 * Node 22 has a global WebSocket, so this needs nothing that `npm install` did not already fetch.
 *
 *   npm run build && npm run start &      # or any running instance
 *   npm run shots -- http://localhost:3000
 *
 * Two things here are not incidental:
 *
 *   1. Every page is scrolled to the bottom and back before capture. Below-the-fold content sits at
 *      opacity 0 until its IntersectionObserver fires, so a naive capture of a long route returns a
 *      page of blank cards — the screenshots would document the reveal system rather than the app.
 *   2. `prefers-reduced-motion` is forced. The orbit rotates and the skeletons shimmer; without
 *      this, two captures of the same route differ, and a diff on a PNG is worthless.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ChromeLauncher from 'chrome-launcher';

interface Shot {
  file: string;
  path: string;
  /** CSS pixels. Doubled by the 2x device scale factor in the written PNG. */
  height: number;
}

const WIDTH = 1440;
const SCALE = 2;

const SHOTS: Shot[] = [
  { file: 'overview.png', path: '/', height: 1000 },
  { file: 'dashboard.png', path: '/', height: 1250 },
  { file: 'screener.png', path: '/screener', height: 1000 },
  { file: 'trade.png', path: '/trade', height: 1000 },
  { file: 'send.png', path: '/send', height: 1000 },
  { file: 'portfolio.png', path: '/portfolio', height: 1000 },
  { file: 'bridge.png', path: '/bridge', height: 1000 },
];

const OUT_DIR = join(process.cwd(), 'docs', 'screenshots');
const BASE = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');

/** Minimal CDP client. One websocket, monotonic ids, promise per command. */
class Cdp {
  private ws!: WebSocket;
  private id = 0;
  private pending = new Map<number, { ok: (v: unknown) => void; err: (e: Error) => void }>();

  static async attach(port: number): Promise<Cdp> {
    const res = await fetch(`http://127.0.0.1:${port}/json/list`);
    const targets = (await res.json()) as { type: string; webSocketDebuggerUrl?: string }[];
    const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (!page?.webSocketDebuggerUrl) throw new Error('no page target to attach to');

    const c = new Cdp();
    c.ws = new WebSocket(page.webSocketDebuggerUrl);
    c.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data)) as {
        id?: number;
        result?: unknown;
        error?: { message: string };
      };
      if (msg.id === undefined) return; // an event, not a reply
      const p = c.pending.get(msg.id);
      if (!p) return;
      c.pending.delete(msg.id);
      if (msg.error) p.err(new Error(msg.error.message));
      else p.ok(msg.result);
    });
    await new Promise<void>((ok, err) => {
      c.ws.addEventListener('open', () => ok(), { once: true });
      c.ws.addEventListener('error', () => err(new Error('CDP socket failed')), { once: true });
    });
    return c;
  }

  send<T = Record<string, unknown>>(method: string, params: unknown = {}): Promise<T> {
    const id = ++this.id;
    return new Promise<T>((ok, err) => {
      this.pending.set(id, { ok: ok as (v: unknown) => void, err });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.ws.close();
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Walks the page to the bottom and back so every reveal target has crossed the viewport, then
 * waits out the longest reveal (460ms) plus a margin. Returns how many are still hidden — a
 * non-zero count means the capture would be misleading, so it is reported rather than swallowed.
 */
const SETTLE = `(async () => {
  const step = 400;
  for (let y = 0; y <= document.documentElement.scrollHeight; y += step) {
    window.scrollTo(0, y);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    await new Promise(r => setTimeout(r, 60));
  }
  window.scrollTo(0, 0);
  await new Promise(r => setTimeout(r, 900));

  // Wait for images, with a cap.
  //
  // Token logos are lazy-loaded from an IPFS gateway that answers in 4-6s cold, so a capture timed
  // only on the reveal system photographs a table of letter-badge placeholders and calls it the
  // product. Decoding is awaited rather than just the complete flag, because a decoded-but-not-
  // image still screenshots blank.
  const deadline = Date.now() + 25000;
  for (;;) {
    const imgs = [...document.querySelectorAll('img')];
    const pending = imgs.filter(i => !i.complete);
    if (pending.length === 0 || Date.now() > deadline) break;
    await new Promise(r => setTimeout(r, 400));
  }
  await Promise.all(
    [...document.querySelectorAll('img')].map(i =>
      i.decode ? i.decode().catch(() => {}) : Promise.resolve()
    )
  );
  await new Promise(r => setTimeout(r, 600));
  const targets = [...document.querySelectorAll('[data-reveal]')];
  const imgs = [...document.querySelectorAll('img')];
  return JSON.stringify({
    total: targets.length,
    hidden: targets.filter(e => +getComputedStyle(e).opacity < 1).length,
    images: imgs.length,
    imagesLoaded: imgs.filter(i => i.complete && i.naturalWidth > 0).length,
  });
})()`;

async function main() {
  const chrome = await ChromeLauncher.launch({
    chromeFlags: [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      `--window-size=${WIDTH},1000`,
      '--force-prefers-reduced-motion',
    ],
  });

  let failures = 0;
  try {
    const cdp = await Cdp.attach(chrome.port);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });

    for (const shot of SHOTS) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: WIDTH,
        height: shot.height,
        deviceScaleFactor: SCALE,
        mobile: false,
      });

      await cdp.send('Page.navigate', { url: `${BASE}${shot.path}` });
      // The routes poll live RPC on mount; this is the data arriving, not the paint.
      await sleep(7000);

      const settled = await cdp.send<{ result: { value?: string } }>('Runtime.evaluate', {
        expression: SETTLE,
        awaitPromise: true,
        returnByValue: true,
      });
      const reveal = JSON.parse(
        settled.result.value ?? '{"total":0,"hidden":0,"images":0,"imagesLoaded":0}',
      ) as { total: number; hidden: number; images: number; imagesLoaded: number };
      if (reveal.hidden > 0) {
        failures++;
        console.error(
          `  ! ${shot.file}: ${reveal.hidden} of ${reveal.total} reveal targets still hidden`,
        );
      }

      const png = await cdp.send<{ data: string }>('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
      });
      const out = join(OUT_DIR, shot.file);
      writeFileSync(out, Buffer.from(png.data, 'base64'));
      console.log(
        `  ${shot.file.padEnd(16)} ${shot.path.padEnd(11)} ${WIDTH * SCALE}x${shot.height * SCALE}` +
          `  reveals ${reveal.total - reveal.hidden}/${reveal.total}` +
          `  images ${reveal.imagesLoaded}/${reveal.images}`,
      );
    }
    cdp.close();
  } finally {
    await chrome.kill();
  }

  if (failures > 0) {
    console.error(`\n${failures} capture(s) had unrevealed content.`);
    process.exit(1);
  }
  console.log(`\n${SHOTS.length} screenshots written to docs/screenshots/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
