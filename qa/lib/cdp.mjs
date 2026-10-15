/* A small Chrome DevTools Protocol driver: no dependencies beyond Node 22+ (global WebSocket).
 * Launches headless Chrome with software WebGL, attaches to pages, evaluates, screenshots, drives
 * input, and collects every console message and uncaught exception the page produces. */
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME_PATHS = [
  process.env.QA_CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean);

export function findChrome() {
  for (const p of CHROME_PATHS) if (existsSync(p)) return p;
  throw new Error('No Chrome found. Set QA_CHROME=/path/to/chrome');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launchChrome({ port = 9222 + Math.floor(Math.random() * 500), headed = false, width = 1280, height = 800, extraArgs = [], gpu = false } = {}) {
  const profile = join(tmpdir(), `wyrmhold-qa-${process.pid}-${port}`);
  rmSync(profile, { recursive: true, force: true }); mkdirSync(profile, { recursive: true });
  const args = [
    headed ? '' : '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    // software WebGL by default (the same on every machine); --gpu draws on this machine's own GPU, far faster
    ...(gpu ? [process.platform === 'darwin' ? '--use-angle=metal' : '--use-angle=default'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']), '--ignore-gpu-blocklist', '--enable-webgl', '--enable-precise-memory-info',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--autoplay-policy=no-user-gesture-required', '--mute-audio', '--disable-features=BackForwardCache', `--window-size=${width},${height}`, '--hide-scrollbars',
    ...extraArgs, 'about:blank',
  ].filter(Boolean);
  const proc = spawn(findChrome(), args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', (d) => { stderr += d; if (stderr.length > 20000) stderr = stderr.slice(-10000); });
  let version = null;
  for (let i = 0; i < 100; i++) {
    try { version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break; } catch { await sleep(100); }
  }
  if (!version) { proc.kill(); throw new Error('Chrome did not answer on its debugging port. ' + stderr.slice(-500)); }
  const browser = await Browser.connect(version.webSocketDebuggerUrl);
  browser.proc = proc; browser.profile = profile; browser.version = version.Browser;
  return browser;
}

class Browser {
  static async connect(url) {
    const b = new Browser();
    b.ws = new WebSocket(url);
    await new Promise((res, rej) => { b.ws.onopen = res; b.ws.onerror = () => rej(new Error('CDP socket failed')); });
    b.ws.onmessage = (m) => b.dispatch(JSON.parse(m.data));
    b.ws.onclose = () => { b.closed = true; for (const [, p] of b.pending) p.reject(new Error('CDP socket closed')); b.pending.clear(); };
    return b;
  }
  id = 0; pending = new Map(); handlers = new Map(); pages = new Map(); closed = false;
  send(method, params = {}, sessionId) {
    if (this.closed) return Promise.reject(new Error('CDP socket closed'));
    const id = ++this.id;
    const msg = { id, method, params }; if (sessionId) msg.sessionId = sessionId;
    this.ws.send(JSON.stringify(msg));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject, method }));
  }
  dispatch(msg) {
    if (msg.id) {
      const p = this.pending.get(msg.id); if (!p) return; this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}${msg.error.data ? ' ' + msg.error.data : ''}`)); else p.resolve(msg.result);
      return;
    }
    const page = msg.sessionId ? this.pages.get(msg.sessionId) : null;
    if (page) page.handle(msg.method, msg.params);
    const hs = this.handlers.get(msg.method); if (hs) for (const h of hs) h(msg.params, msg.sessionId);
  }
  on(method, fn) { if (!this.handlers.has(method)) this.handlers.set(method, new Set()); this.handlers.get(method).add(fn); return () => this.handlers.get(method).delete(fn); }
  async newPage({ width = 1280, height = 800 } = {}) {
    const { targetId } = await this.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    const page = new Page(this, sessionId, targetId);
    this.pages.set(sessionId, page);
    await page.init(width, height);
    return page;
  }
  async close() {
    try { await this.send('Browser.close'); } catch { /* already gone */ }
    try { this.ws.close(); } catch { /* ignore */ }
    try { this.proc?.kill('SIGKILL'); } catch { /* ignore */ }
    await sleep(200);
    rmSync(this.profile, { recursive: true, force: true });
  }
}

export class Page {
  constructor(browser, sessionId, targetId) { this.b = browser; this.sessionId = sessionId; this.targetId = targetId; this.console = []; this.exceptions = []; this.requests = []; this.failed = []; this.listeners = new Map(); }
  send(method, params) { return this.b.send(method, params, this.sessionId); }
  on(method, fn) { if (!this.listeners.has(method)) this.listeners.set(method, new Set()); this.listeners.get(method).add(fn); return () => this.listeners.get(method).delete(fn); }
  handle(method, params) {
    if (method === 'Runtime.consoleAPICalled') {
      const text = params.args.map((a) => a.value !== undefined ? String(a.value) : a.description || a.type).join(' ');
      this.console.push({ level: params.type, text, at: Date.now(), stack: params.stackTrace?.callFrames?.slice(0, 3).map((f) => `${f.url.split('/').slice(-2).join('/')}:${f.lineNumber}`).join(' < ') });
    } else if (method === 'Runtime.exceptionThrown') {
      const d = params.exceptionDetails;
      const text = d.exception?.description || d.text || 'uncaught exception';
      this.exceptions.push({ text, at: Date.now(), url: d.url, line: d.lineNumber });
    } else if (method === 'Log.entryAdded') {
      const e = params.entry;
      if (e.level === 'error' || e.level === 'warning') this.console.push({ level: e.level === 'warning' ? 'warning' : 'error', text: `[${e.source}] ${e.text}${e.url ? ' ' + e.url : ''}`, at: Date.now() });
    } else if (method === 'Network.requestWillBeSent') {
      this.requests.push({ id: params.requestId, url: params.request.url, method: params.request.method, at: Date.now() });
    } else if (method === 'Network.loadingFailed') {
      const r = this.requests.find((x) => x.id === params.requestId);
      this.failed.push({ url: r?.url, error: params.errorText, at: Date.now() });
    }
    const hs = this.listeners.get(method); if (hs) for (const h of hs) h(params);
  }
  /** A fresh target in place of this one: every document, WebGL context and worker of the old page is gone for sure. */
  async recycle() {
    const { width, height, mobile } = this.viewport || { width: 1280, height: 800 };
    try { await this.b.send('Target.closeTarget', { targetId: this.targetId }); } catch { /* already gone */ }
    this.b.pages.delete(this.sessionId);
    const { targetId } = await this.b.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await this.b.send('Target.attachToTarget', { targetId, flatten: true });
    this.sessionId = sessionId; this.targetId = targetId; this.b.pages.set(sessionId, this);
    await this.init(width, height);
    if (mobile) await this.setViewport(width, height, { mobile });
  }
  async init(width, height) {
    await this.send('Page.enable'); await this.send('Runtime.enable'); await this.send('Log.enable'); await this.send('Network.enable');
    await this.setViewport(width, height);
  }
  async setViewport(width, height, { mobile = false, scale = 1 } = {}) {
    this.viewport = { width, height, mobile };
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile, screenWidth: width, screenHeight: height });
    if (mobile) await this.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    else await this.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  }
  async emulateMedia(features) { await this.send('Emulation.setEmulatedMedia', { features: Object.entries(features).map(([name, value]) => ({ name, value })) }); }
  async goto(url, { waitLoad = true, timeout = 30000 } = {}) {
    this.console.length = 0; this.exceptions.length = 0; this.requests.length = 0; this.failed.length = 0;
    const { errorText } = await this.send('Page.navigate', { url });
    if (errorText) throw new Error(`navigate ${url}: ${errorText}`);
    if (!waitLoad) return;
    // the new document is complete when it says so; an evaluate that lands mid-navigation is retried
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      // The game rewrites old '#/x' addresses into paths ('/?again=1#/hold' becomes '/hold/?again=1'), so the
      // address alone may never match: the document's own navigation entry still names what was asked for.
      try {
        const r = await this.send('Runtime.evaluate', { expression: 'document.readyState + "|" + location.href + "|" + (performance.getEntriesByType("navigation")[0]?.name || "")', returnByValue: true });
        const [state, href, asked] = String(r.result.value).split('|');
        const base = url.split('#')[0];
        if (state === 'complete' && (href === url || href.startsWith(base) || asked === url || asked.startsWith(base))) return;
      } catch { /* navigating */ }
      await sleep(60);
    }
    throw new Error(`navigate ${url}: not complete after ${timeout}ms`);
  }
  async reload() { await this.send('Page.reload', { ignoreCache: true }); await sleep(300); }
  /** Evaluate an expression (may use await); returns its JSON value. Throws with the page's error. */
  async eval(expression, { timeout = 90000 } = {}) {
    // an expression first; statements (with their own return) when that does not parse
    // a navigation mid-evaluation can leave the call unanswered: never wait longer than the timeout
    const run = (body) => Promise.race([this.send('Runtime.evaluate', { expression: `(async () => { ${body} })()`, awaitPromise: true, returnByValue: true, timeout }), sleep(timeout + 2000).then(() => { throw new Error('eval: no answer in ' + timeout + 'ms (did the page navigate?)'); })]);
    let r = await run('return (' + expression + '\n)');
    if (r.exceptionDetails && /SyntaxError/.test(r.exceptionDetails.exception?.description || r.exceptionDetails.text || '')) r = await run(expression);
    if (r.exceptionDetails) { const d = r.exceptionDetails; throw new Error('page: ' + (d.exception?.description || d.text)); }
    return r.result.value;
  }
  /** Poll until an expression is truthy. */
  async waitFor(expression, { timeout = 30000, every = 150, what = expression } = {}) {
    const t0 = Date.now();
    let last;
    while (Date.now() - t0 < timeout) {
      try { last = await this.eval(expression); if (last) return last; } catch (e) { last = e.message; }
      await sleep(every);
    }
    throw new Error(`timed out after ${timeout}ms waiting for ${what} (last: ${JSON.stringify(last)?.slice(0, 200)})`);
  }
  async screenshot(path, { clip, format = 'png', quality } = {}) {
    const params = { format, captureBeyondViewport: false }; if (clip) params.clip = { ...clip, scale: 1 }; if (quality) params.quality = quality;
    const { data } = await this.send('Page.captureScreenshot', params);
    const buf = Buffer.from(data, 'base64');
    if (path) await writeFile(path, buf);
    return buf;
  }
  async click(x, y, { button = 'left', clickCount = 1 } = {}) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount });
  }
  async move(x, y) { await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); }
  async wheel(x, y, deltaY) { await this.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY }); }
  async drag(x0, y0, x1, y1, steps = 8) {
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', clickCount: 1 });
    for (let i = 1; i <= steps; i++) await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + (x1 - x0) * i / steps, y: y0 + (y1 - y0) * i / steps, button: 'left', buttons: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1, button: 'left', clickCount: 1 });
  }
  /** Press a key. Enter carries '\r' as text, or the page never sees a button activation. No nativeVirtualKeyCode:
   * on macOS it names a different key (27 is not Escape there), and after one, emulated touches go unanswered. */
  async key(key, { text, code, modifiers = 0 } = {}) {
    const KEYS = { Enter: { code: 'Enter', keyCode: 13, text: '\r' }, Tab: { code: 'Tab', keyCode: 9 }, Escape: { code: 'Escape', keyCode: 27 }, ' ': { code: 'Space', keyCode: 32, text: ' ' }, ArrowDown: { code: 'ArrowDown', keyCode: 40 }, ArrowUp: { code: 'ArrowUp', keyCode: 38 }, ArrowLeft: { code: 'ArrowLeft', keyCode: 37 }, ArrowRight: { code: 'ArrowRight', keyCode: 39 } };
    const k = KEYS[key] || { code: code || 'Key' + key.toUpperCase(), keyCode: key.toUpperCase().charCodeAt(0), text: key };
    const t = text ?? k.text;
    await this.send('Input.dispatchKeyEvent', { type: t ? 'keyDown' : 'rawKeyDown', key, code: k.code, windowsVirtualKeyCode: k.keyCode, text: t, unmodifiedText: t, modifiers });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: k.code, windowsVirtualKeyCode: k.keyCode, modifiers });
  }
  async type(text) { for (const ch of text) await this.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, unmodifiedText: ch, key: ch }), await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch }); }
  /** Click the centre of the first element matching a selector (or a predicate text), scrolled into view. */
  async clickSel(selector, { text, index = 0 } = {}) {
    const box = await this.eval(`
      const all = [...document.querySelectorAll(${JSON.stringify(selector)})]${text ? `.filter((e) => e.textContent.includes(${JSON.stringify(text)}))` : ''};
      const el = all[${index}]; if (!el) return null;
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };`);
    if (!box) throw new Error(`no element for ${selector}${text ? ' with text ' + text : ''}`);
    await this.click(box.x, box.y);
    return box;
  }
  /** Console errors and exceptions since the last goto, minus an allowlist of patterns. */
  errors(allow = []) {
    const bad = [...this.exceptions.map((e) => ({ kind: 'exception', text: e.text })), ...this.console.filter((c) => c.level === 'error' || c.level === 'assert' || (c.level === 'warning' && /WebGL|CONTEXT_LOST|THREE\./.test(c.text))).map((c) => ({ kind: 'console', text: c.text + (c.stack ? ' @ ' + c.stack : '') }))];
    return bad.filter((b) => !allow.some((re) => re.test(b.text)));
  }
  async close() { try { await this.b.send('Target.closeTarget', { targetId: this.targetId }); } catch { /* ignore */ } this.b.pages.delete(this.sessionId); }
}

export { sleep };
