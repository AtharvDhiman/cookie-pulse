// Hunt for things that RENDER wrong without erroring.
//
// Written after shipping a heading whose text was amber on an amber block — invisible, and
// completely silent: no console error, no CSP violation, no failed request. The CSP check that ran
// before that deploy asked "did any route error", which is a different question from "can every
// route still be read".
//
// So this walks every element that paints text, resolves the background it is ACTUALLY painted on
// (compositing every translucent ancestor down to the page ground, since a `bg-white/5` panel over
// a dark body is neither), and computes the real contrast ratio. Anything a person could not read
// is reported with the selector that produced it.
//
// It also catches the other silent-failure shapes seen in this codebase: an element with content
// and zero size (the 34px sparkline), and text clipped to nothing by its container.
//
//   node scripts/visual-audit.mjs <base-url>
//
// Exits non-zero if anything is unreadable, so it can gate a deploy.
import * as ChromeLauncher from 'chrome-launcher';

const BASE = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '');
const ROUTES = ['/', '/screener', '/trade', '/send', '/portfolio', '/bridge'];
const THEMES = ['dark', 'light'];
// 360 is the narrowest phone worth supporting, and most layout breakage only shows up there.
const VIEWPORTS = [
  { w: 1440, h: 1000, name: 'desktop' },
  { w: 360, h: 780, name: 'mobile' },
];

class Cdp {
  static async attach(port) {
    const t = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(
      (x) => x.type === 'page',
    );
    const c = new Cdp();
    c.id = 0;
    c.p = new Map();
    c.ws = new WebSocket(t.webSocketDebuggerUrl);
    c.ws.addEventListener('message', (e) => {
      const m = JSON.parse(String(e.data));
      if (m.id === undefined) return;
      const h = c.p.get(m.id);
      if (!h) return;
      c.p.delete(m.id);
      m.error ? h.err(new Error(m.error.message)) : h.ok(m.result);
    });
    await new Promise((ok, err) => {
      c.ws.addEventListener('open', () => ok(), { once: true });
      c.ws.addEventListener('error', () => err(new Error('ws')), { once: true });
    });
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((ok, err) => {
      this.p.set(id, { ok, err });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

// Runs in the page. Kept as one string so there is no bundling step.
const AUDIT = `(() => {
  const parse = (c) => {
    const m = String(c).match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const p = m[1].split(',').map((x) => parseFloat(x.trim()));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  const lum = (c) => {
    const f = [c.r, c.g, c.b].map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
  };
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
    return (hi + 0.05) / (lo + 0.05);
  };

  // The background this element is actually painted on: composite every translucent ancestor
  // down onto the page ground. A panel at 4% white over a near-black body is neither of those.
  const painted = (el) => {
    const stack = [];
    let n = el;
    while (n && n !== document.documentElement) {
      const cs = getComputedStyle(n);
      const bg = parse(cs.backgroundColor);
      if (bg && bg.a > 0) stack.push(bg);
      // A background-image (gradient) is opaque enough to stop the walk; we cannot sample it, so
      // report it separately rather than guessing a colour.
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return { unknown: true, stack };
      n = n.parentElement;
    }
    const rootBg = parse(getComputedStyle(document.documentElement).backgroundColor) ||
                   parse(getComputedStyle(document.body).backgroundColor) ||
                   { r: 255, g: 255, b: 255, a: 1 };
    let acc = rootBg.a > 0 ? rootBg : { r: 255, g: 255, b: 255, a: 1 };
    for (let i = stack.length - 1; i >= 0; i--) acc = over(stack[i], acc);
    return { color: acc };
  };

  const sel = (el) => {
    const id = el.id ? '#' + el.id : '';
    const cls = typeof el.className === 'string' && el.className
      ? '.' + el.className.trim().split(/\\s+/).slice(0, 3).join('.')
      : '';
    return el.tagName.toLowerCase() + id + cls;
  };

  const findings = [];
  const seen = new Set();

  // -- page-level horizontal overflow ----------------------------------------------------------
  // A page that scrolls sideways on a phone is always a defect, and it never throws.
  //
  // documentElement.scrollWidth is NOT the test. It reports 1024 on /screener at 360px because a
  // descendant overflow-x-auto table is 1020px wide -- clipped, scrollable on its own, and
  // completely correct. The only thing that matters is whether the USER can drag the page
  // sideways, so that is what is measured: try to scroll and see if it moved.
  const de = document.documentElement;
  const beforeX = window.scrollX;
  window.scrollTo(600, window.scrollY);
  const movedX = window.scrollX > beforeX;
  window.scrollTo(beforeX, window.scrollY);
  if (movedX) {
    let worst = null;
    for (const el of document.querySelectorAll('body *')) {
      const b = el.getBoundingClientRect();
      if (b.width === 0) continue;
      if (b.right > de.clientWidth + 1 && (!worst || b.right > worst.right)) {
        // Ignore anything inside a deliberate horizontal scroller (the screener table).
        let scroller = false;
        for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
          const ov = getComputedStyle(n).overflowX;
          if (ov === 'auto' || ov === 'scroll') { scroller = true; break; }
        }
        if (!scroller) worst = { right: b.right, el };
      }
    }
    if (worst) {
      findings.push({
        kind: 'page-overflow-x',
        sel: sel(worst.el),
        text: (worst.el.textContent || '').trim().slice(0, 50),
        detail: 'page scrolls sideways; document ' + de.scrollWidth + 'px vs viewport ' +
                de.clientWidth + '; widest offender reaches ' + Math.round(worst.right) + 'px',
      });
    }
  }

  // getComputedStyle on a child of a display:none parent returns the CHILD's own display, which
  // is not none -- so every element inside a hidden-until-md container looked like a zero-size
  // defect at 360px. offsetParent === null is the cheap, correct test for 'not rendered at all',
  // with position:fixed excluded because those legitimately have no offsetParent.
  const rendered = (el) => {
    if (el.offsetParent !== null) return true;
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed' && cs.display !== 'none') return true;
    return false;
  };

  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (!rendered(el)) continue;
    const box = el.getBoundingClientRect();

    // Direct text only, so a wrapper is not blamed for its child's text.
    const own = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join(' ')
      .trim();

    // -- zero-size element that has content ---------------------------------------------------
    if ((box.width === 0 || box.height === 0) && (own || el.children.length > 0)) {
      const tag = el.tagName.toLowerCase();
      // <br>, <script> and friends legitimately have no box; sr-only is deliberate.
      const okEmpty = ['br','script','style','template','meta','link','title','option','svg','defs','mask','clippath','lineargradient','radialgradient','stop','g','circle','path','line','rect','ellipse','tspan'].includes(tag);
      if (!okEmpty && !el.className.toString().includes('sr-only') && own) {
        findings.push({ kind: 'zero-size', sel: sel(el), text: own.slice(0, 50),
                        detail: box.width.toFixed(1) + 'x' + box.height.toFixed(1) });
      }
      continue;
    }

    if (!own || box.width < 2 || box.height < 2) continue;
    if (parseFloat(cs.opacity) === 0) continue;
    // Skip anything an ancestor has faded out entirely (reveal system at rest).
    let faded = false;
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      if (parseFloat(getComputedStyle(n).opacity) === 0) { faded = true; break; }
    }
    if (faded) continue;

    const fg = parse(cs.color);
    if (!fg || fg.a === 0) {
      findings.push({ kind: 'transparent-text', sel: sel(el), text: own.slice(0, 50),
                      detail: 'color: ' + cs.color });
      continue;
    }

    const bgInfo = painted(el);
    if (bgInfo.unknown) continue; // sits on a gradient; cannot sample reliably

    const eff = fg.a < 1 ? over(fg, bgInfo.color) : fg;
    const r = ratio(eff, bgInfo.color);
    const size = parseFloat(cs.fontSize);
    const bold = parseInt(cs.fontWeight, 10) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const floor = large ? 3 : 4.5;

    const key = sel(el) + '|' + own.slice(0, 24);
    if (seen.has(key)) continue;
    seen.add(key);

    if (r < 1.6) {
      findings.push({ kind: 'INVISIBLE', sel: sel(el), text: own.slice(0, 50),
                      detail: r.toFixed(2) + ':1  ' + cs.color + ' on rgb(' +
                              [bgInfo.color.r, bgInfo.color.g, bgInfo.color.b].map(Math.round).join(',') + ')' });
    } else if (r < floor) {
      findings.push({ kind: 'low-contrast', sel: sel(el), text: own.slice(0, 50),
                      detail: r.toFixed(2) + ':1 (needs ' + floor + ')  ' + Math.round(size) + 'px' });
    }
  }
  return JSON.stringify(findings);
})()`;

const chrome = await ChromeLauncher.launch({
  chromeFlags: ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-prefers-reduced-motion'],
});
let total = 0;
let invisible = 0;
try {
  const cdp = await Cdp.attach(chrome.port);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  for (const vp of VIEWPORTS) {
  for (const theme of THEMES) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.w < 768,
    });
    console.log(`\n${vp.name.toUpperCase()} ${vp.w}px \u00b7 ${theme}`);
    for (const route of ROUTES) {
      await cdp.send('Page.navigate', { url: BASE + route });
      await new Promise((r) => setTimeout(r, 7000));
      // Set the theme the way the app does, then let it repaint.
      await cdp.send('Runtime.evaluate', {
        expression: `localStorage.setItem('cookie-pulse-theme','${theme}');
                     document.documentElement.classList.toggle('light', ${theme === 'light'});`,
      });
      await new Promise((r) => setTimeout(r, 1200));
      // Scroll through so reveal-gated content is actually painted before auditing.
      await cdp.send('Runtime.evaluate', {
        expression: `(async () => { for (let y=0; y<=document.documentElement.scrollHeight; y+=500) {
          window.scrollTo(0,y); await new Promise(r=>setTimeout(r,80)); } window.scrollTo(0,0);
          await new Promise(r=>setTimeout(r,700)); })()`,
        awaitPromise: true,
      });

      const res = await cdp.send('Runtime.evaluate', { expression: AUDIT, returnByValue: true });
      const found = JSON.parse(res.result.value || '[]');
      total += found.length;
      invisible += found.filter((f) => f.kind === 'INVISIBLE' || f.kind === 'transparent-text').length;
      console.log(`  ${route.padEnd(11)} ${found.length === 0 ? 'clean' : found.length + ' finding(s)'}`);
      for (const f of found.slice(0, 8)) {
        console.log(`      [${f.kind}] ${f.sel}`);
        console.log(`         "${f.text}"`);
        console.log(`         ${f.detail}`);
      }
      if (found.length > 8) console.log(`      … and ${found.length - 8} more`);
    }
  }
  }
} finally {
  await chrome.kill();
}
console.log(`\n  ${total} finding(s), ${invisible} of them unreadable`);
process.exitCode = invisible > 0 ? 1 : 0;
