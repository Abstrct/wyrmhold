/* Firefox for the proving ground, driven over WebDriver BiDi (Firefox's own remote protocol; it dropped CDP).
 * `launchFirefox()` gives a Browser whose pages speak the same small API as cdp.mjs's Page: goto, eval,
 * waitFor, screenshot, click, key, type, setViewport, errors, recycle. So game.mjs's helpers and most suites run
 * unchanged. What BiDi cannot do (CDP's own domains: touch emulation, heap snapshots, network blocking) throws
 * "not in Firefox" from `send()`, and the check that needs it fails plainly rather than lying. No dependencies. */
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FIREFOX_PATHS = [process.env.QA_FIREFOX, '/Applications/Firefox.app/Contents/MacOS/firefox', '/usr/bin/firefox', '/usr/lib/firefox/firefox'].filter(Boolean);
export function findFirefox() {
  for (const p of FIREFOX_PATHS) if (existsSync(p)) return p;
  throw new Error('No Firefox found. Set QA_FIREFOX=/path/to/firefox');
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Preferences for a quiet, automatable Firefox: no first-run pages, no updates, touch events on, WebGL on. */
const PREFS = {
  'browser.startup.page': 0, 'browser.startup.homepage': 'about:blank', 'browser.startup.homepage_override.mstone': 'ignore',
  'browser.shell.checkDefaultBrowser': false, 'browser.aboutwelcome.enabled': false, 'browser.tabs.warnOnClose': false,
  'browser.sessionstore.resume_from_crash': false, 'browser.translations.automaticallyPopup': false,
  'datareporting.policy.dataSubmissionEnabled': false, 'datareporting.healthreport.uploadEnabled': false, 'toolkit.telemetry.enabled': false,
  'app.update.auto': false, 'app.update.disabledForTesting': true, 'browser.safebrowsing.malware.enabled': false, 'browser.safebrowsing.phishing.enabled': false,
  'dom.disable_open_during_load': false, 'dom.ipc.reportProcessHangs': false, 'hangmonitor.timeout': 0, 'dom.max_script_run_time': 0,
  'media.autoplay.default': 0, 'webgl.force-enabled': true, 'dom.w3c_touch_events.enabled': 1, 'remote.prefs.recommended': true,
  // the game is served from http://127.0.0.1: treat it as secure enough for its storage and workers
  'dom.securecontext.allowlist': '127.0.0.1,localhost',
};

/** A Firefox process on a fresh profile, listening for BiDi. */
async function startFirefox({ headed, width, height, prefs, port }) {
  const profile = join(tmpdir(), `wyrmhold-qa-ff-${process.pid}-${port}`);
  rmSync(profile, { recursive: true, force: true }); mkdirSync(profile, { recursive: true });
  writeFileSync(join(profile, 'user.js'), Object.entries({ ...PREFS, ...prefs }).map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join('\n') + '\n');
  const args = [headed ? '' : '--headless', '--no-remote', '--new-instance', '--profile', profile, `--remote-debugging-port=${port}`, `--width=${width}`, `--height=${height}`, 'about:blank'].filter(Boolean);
  const proc = spawn(findFirefox(), args, { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, MOZ_CRASHREPORTER_DISABLE: '1' } });
  let stderr = '';
  let wsUrl = null;
  proc.stderr.on('data', (d) => {
    stderr += d; if (stderr.length > 30000) stderr = stderr.slice(-15000);
    const m = /WebDriver BiDi listening on (ws:\/\/\S+)/.exec(String(d)); if (m) wsUrl = m[1];
  });
  for (let i = 0; i < 300 && !wsUrl; i++) { if (proc.exitCode != null) break; await sleep(100); }
  if (!wsUrl) { proc.kill(); throw new Error('Firefox did not open its BiDi port. ' + stderr.slice(-600)); }
  return { proc, profile, url: wsUrl.replace(/\/?$/, '') + '/session' };
}

export async function launchFirefox({ headed = false, width = 1280, height = 800, prefs = {}, port = 9300 + Math.floor(Math.random() * 600) } = {}) {
  const opts = { headed, width, height, prefs, port };
  const f = await startFirefox(opts);
  const browser = await Browser.connect(f.url);
  Object.assign(browser, { proc: f.proc, profile: f.profile, opts, defaultSize: { width, height } });
  await browser.findHome();
  return browser;
}

class Browser {
  static async connect(url) {
    const b = new Browser();
    b.url = url;
    await b.open();
    return b;
  }
  id = 0; pending = new Map(); pages = new Map(); closed = false; kind = 'firefox'; reconnecting = null;
  /** A socket and a session on it. Called again after a drop: the tabs (browsing contexts) outlive a session,
   *  so every Page carries on with its own context once the new session listens again. */
  async open() {
    const ws = new WebSocket(this.url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('BiDi socket failed')); });
    this.ws = ws;
    ws.onmessage = (m) => { this.lastIn = { size: m.data.length, at: Date.now() }; if (m.data.length > (this.maxIn || 0)) this.maxIn = m.data.length; this.dispatch(JSON.parse(m.data)); };
    ws.onclose = (e) => { if (ws === this.ws) this.lost(e); };
    // Firefox ends a dropped socket's session a moment later: until then a new one is refused ("Maximum number…")
    let s;
    for (let tries = 0; ; tries++) {
      try { s = await this.call('session.new', { capabilities: { alwaysMatch: { acceptInsecureCerts: true, unhandledPromptBehavior: { default: 'ignore' } } } }); break; }
      catch (e) { if (tries > 40 || !/Maximum number of active sessions/.test(e.message)) throw e; await sleep(250); }
    }
    this.version = `Firefox/${s.capabilities?.browserVersion || '?'}`;
    await this.call('session.subscribe', { events: ['log.entryAdded', 'browsingContext.userPromptOpened'] });
  }
  /** The window Firefox opened at start: kept, so the browser never runs out of windows between checks. */
  async findHome() {
    const tree = await this.call('browsingContext.getTree', {});
    this.home = tree.contexts[0]?.context;
  }
  /* A socket that closed under a live Firefox (seen once, 14 minutes into a full run) failed every check after it.
   * Firefox keeps a dropped socket's session, so a new one is refused and the old can't be rejoined: start Firefox
   * afresh instead. What was in flight fails, saying why; the next check that opens its screen (openGame recycles
   * the page) carries on in the new browser. */
  lost(e) {
    const why = `BiDi socket closed (${e.code}${e.reason ? ' ' + e.reason : ''})`;
    const pending = [...this.pending.values()]; this.pending.clear();
    for (const p of pending) p.reject(new Error(`${why} during ${p.method}`));
    if (this.closing) { this.closed = why; return; }
    console.error(`[bidi] ${why}; Firefox ${this.proc?.exitCode != null ? 'exited ' + this.proc.exitCode : 'still running'}; last in ${this.lastIn?.size} B ${Date.now() - (this.lastIn?.at || 0)} ms ago, largest ${this.maxIn} B; last out ${this.lastOut}; in flight ${pending.map((p) => p.method).join(', ') || 'nothing'}. Starting Firefox again.`);
    for (const p of this.pages.values()) p.ctx = null;   // their tabs go with the old process
    this.pages.clear();
    this.reconnecting = this.relaunch()
      .then(() => console.error('[bidi] Firefox started again; pages reopen on their next screen'))
      .catch((x) => { this.closed = `${why}; starting again failed: ${x.message}`; console.error('[bidi] ' + this.closed); })
      .finally(() => { this.reconnecting = null; });
  }
  async relaunch() {
    try { this.proc?.kill('SIGKILL'); } catch { /* gone */ }
    await sleep(300);
    rmSync(this.profile, { recursive: true, force: true });
    const f = await startFirefox({ ...this.opts, port: this.opts.port + 1 });
    this.opts.port += 1;
    Object.assign(this, { proc: f.proc, profile: f.profile, url: f.url });
    await this.open();
    await this.findHome();
  }
  send(method, params = {}) {
    if (this.reconnecting) return this.reconnecting.then(() => this.send(method, params));
    return this.call(method, params);
  }
  /** One command on the socket as it is (open() uses it while a reconnect is under way). */
  call(method, params = {}) {
    if (this.closed) return Promise.reject(new Error(this.closed));
    const id = ++this.id;
    this.lastOut = method;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject, method }));
  }
  dispatch(msg) {
    if (msg.id != null && (msg.type === 'success' || msg.type === 'error')) {
      const p = this.pending.get(msg.id); if (!p) return; this.pending.delete(msg.id);
      if (msg.type === 'error') p.reject(new Error(`${p.method}: ${msg.error}: ${msg.message || ''}`)); else p.resolve(msg.result);
      return;
    }
    if (msg.type === 'event') {
      const ctx = msg.params?.source?.context || msg.params?.context;
      const page = ctx ? this.pages.get(ctx) : null;
      if (page) page.handle(msg.method, msg.params);
      if (msg.method === 'browsingContext.userPromptOpened' && ctx) void this.send('browsingContext.handleUserPrompt', { context: ctx, accept: false }).catch(() => {});
    }
  }
  async newPage({ width = this.defaultSize?.width || 1280, height = this.defaultSize?.height || 800 } = {}) {
    const page = new Page(this);
    await page.open(width, height);
    return page;
  }
  async close() {
    this.closing = true;
    try { await Promise.race([this.send('browser.close', {}), sleep(3000)]); } catch { /* already gone */ }
    try { this.ws.close(); } catch { /* ignore */ }
    try { this.proc?.kill('SIGKILL'); } catch { /* ignore */ }
    await sleep(300);
    rmSync(this.profile, { recursive: true, force: true });
  }
}

/** WebDriver key values for the keys the suites press. */
const KEY = { Enter: '', Tab: '', Escape: '', ' ': ' ', Backspace: '', ArrowDown: '', ArrowUp: '', ArrowLeft: '', ArrowRight: '', Shift: '', Control: '', Alt: '', Meta: '' };

export class Page {
  constructor(browser) { this.b = browser; this.console = []; this.exceptions = []; this.requests = []; this.failed = []; this.kind = 'firefox'; }
  handle(method, params) {
    if (method !== 'log.entryAdded') return;
    if (params.type === 'javascript') this.exceptions.push({ text: params.text || 'uncaught exception', at: Date.now(), url: params.stackTrace?.callFrames?.[0]?.url, line: params.stackTrace?.callFrames?.[0]?.lineNumber });
    else {
      const level = params.level === 'warn' ? 'warning' : params.level === 'info' ? 'info' : params.level || 'log';
      const text = params.text ?? (params.args || []).map((a) => (a.value !== undefined ? String(a.value) : a.type)).join(' ');
      const f = params.stackTrace?.callFrames || [];
      this.console.push({ level, text, at: Date.now(), stack: f.slice(0, 3).map((x) => `${String(x.url).split('/').slice(-2).join('/')}:${x.lineNumber}`).join(' < ') });
    }
  }
  async open(width, height) {
    const { context } = await this.b.send('browsingContext.create', { type: 'tab' });
    this.ctx = context; this.b.pages.set(context, this);
    await this.setViewport(width, height);
  }
  async recycle() {
    const { width, height } = this.viewport || this.b.defaultSize;
    await this.close();
    await this.open(width, height);
  }
  async setViewport(width, height, { mobile = false, scale = 1 } = {}) {
    this.viewport = { width, height, mobile };
    await this.b.send('browsingContext.setViewport', { context: this.ctx, viewport: { width, height }, devicePixelRatio: scale });
  }
  /** BiDi cannot emulate media features per page: a check that needs reduced motion runs with the pref instead. */
  async emulateMedia() { this.mediaUnsupported = true; }
  async goto(url, { waitLoad = true, timeout = 30000 } = {}) {
    if (!this.ctx) { const { width, height } = this.viewport || this.b.defaultSize; await this.open(width, height); }   // Firefox was started again
    this.console.length = 0; this.exceptions.length = 0; this.requests.length = 0; this.failed.length = 0;
    const nav = this.b.send('browsingContext.navigate', { context: this.ctx, url, wait: waitLoad ? 'complete' : 'none' });
    const r = await Promise.race([nav, sleep(timeout).then(() => 'timeout')]);
    if (r === 'timeout') throw new Error(`navigate ${url}: not complete after ${timeout}ms`);
  }
  async reload() { await this.b.send('browsingContext.reload', { context: this.ctx, ignoreCache: true, wait: 'complete' }); }
  /** Evaluate an expression (may use await); returns its JSON value. Throws with the page's error. */
  async eval(expression, { timeout = 90000 } = {}) {
    const wrap = (body) => `(async () => { const __v = await (async () => { ${body} })(); return __v === undefined ? '"__undefined__"' : JSON.stringify(__v); })()`;
    const run = (body) => Promise.race([
      this.b.send('script.evaluate', { expression: wrap(body), target: { context: this.ctx }, awaitPromise: true, resultOwnership: 'none' }),
      sleep(timeout + 2000).then(() => { throw new Error('eval: no answer in ' + timeout + 'ms (did the page navigate?)'); }),
    ]);
    let r = await run('return (' + expression + '\n)');
    if (r.type === 'exception' && /SyntaxError/.test(r.exceptionDetails?.text || '')) r = await run(expression);
    if (r.type === 'exception') throw new Error('page: ' + (r.exceptionDetails?.text || 'error'));
    const s = r.result?.value;
    if (s === '"__undefined__"' || s === undefined) return undefined;
    return JSON.parse(s);
  }
  async waitFor(expression, { timeout = 30000, every = 150, what = expression } = {}) {
    const t0 = Date.now(); let last;
    while (Date.now() - t0 < timeout) {
      try { last = await this.eval(expression, { timeout: Math.max(2000, timeout - (Date.now() - t0)) }); if (last) return last; } catch (e) { last = e.message; }
      await sleep(every);
    }
    throw new Error(`timed out after ${timeout}ms waiting for ${what} (last: ${JSON.stringify(last)?.slice(0, 200)})`);
  }
  async screenshot(path, { clip } = {}) {
    const params = { context: this.ctx, origin: 'viewport' };
    if (clip) params.clip = { type: 'box', x: clip.x, y: clip.y, width: clip.width, height: clip.height };
    const { data } = await this.b.send('browsingContext.captureScreenshot', params);
    const buf = Buffer.from(data, 'base64');
    if (path) await writeFile(path, buf);
    return buf;
  }
  pointer(actions, type = 'mouse') {
    return this.b.send('input.performActions', { context: this.ctx, actions: [{ type: 'pointer', id: type === 'touch' ? 'finger' : 'mouse', parameters: { pointerType: type }, actions }] });
  }
  async click(x, y, { button = 'left', clickCount = 1 } = {}) {
    const b = button === 'right' ? 2 : button === 'middle' ? 1 : 0;
    const acts = [{ type: 'pointerMove', x: Math.round(x), y: Math.round(y) }];
    for (let i = 0; i < clickCount; i++) acts.push({ type: 'pointerDown', button: b }, { type: 'pointerUp', button: b });
    await this.pointer(acts, this.viewport?.mobile ? 'touch' : 'mouse');
  }
  async move(x, y) { await this.pointer([{ type: 'pointerMove', x: Math.round(x), y: Math.round(y) }]); }
  async wheel(x, y, deltaY) { await this.b.send('input.performActions', { context: this.ctx, actions: [{ type: 'wheel', id: 'wheel', actions: [{ type: 'scroll', x: Math.round(x), y: Math.round(y), deltaX: 0, deltaY }] }] }); }
  async drag(x0, y0, x1, y1, steps = 8) {
    const acts = [{ type: 'pointerMove', x: Math.round(x0), y: Math.round(y0) }, { type: 'pointerDown', button: 0 }];
    for (let i = 1; i <= steps; i++) acts.push({ type: 'pointerMove', x: Math.round(x0 + (x1 - x0) * i / steps), y: Math.round(y0 + (y1 - y0) * i / steps), duration: 16 });
    acts.push({ type: 'pointerUp', button: 0 });
    await this.pointer(acts);
  }
  async key(key, { modifiers = 0 } = {}) {
    const mods = [modifiers & 8 && KEY.Shift, modifiers & 2 && KEY.Control, modifiers & 1 && KEY.Alt, modifiers & 4 && KEY.Meta].filter(Boolean);
    const v = KEY[key] || key;
    const acts = [...mods.map((m) => ({ type: 'keyDown', value: m })), { type: 'keyDown', value: v }, { type: 'keyUp', value: v }, ...mods.reverse().map((m) => ({ type: 'keyUp', value: m }))];
    await this.b.send('input.performActions', { context: this.ctx, actions: [{ type: 'key', id: 'keyboard', actions: acts }] });
  }
  async type(text) {
    const acts = []; for (const ch of text) acts.push({ type: 'keyDown', value: ch }, { type: 'keyUp', value: ch });
    await this.b.send('input.performActions', { context: this.ctx, actions: [{ type: 'key', id: 'keyboard', actions: acts }] });
  }
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
  /** The few CDP input calls the suites make, said as BiDi pointer actions (each finger its own touch source,
   * kept pressed between calls). Anything else has no Firefox equivalent here and says so. */
  async send(method, params = {}) {
    if (method === 'Input.dispatchTouchEvent') {
      this.fingers ||= new Map();
      const pts = params.touchPoints || [];
      const acts = [];
      if (params.type === 'touchStart' || params.type === 'touchMove') {
        for (const t of pts) {
          const id = 'finger' + (t.id ?? 0), down = this.fingers.has(id);
          const steps = [{ type: 'pointerMove', x: Math.round(t.x), y: Math.round(t.y) }];
          if (!down) steps.push({ type: 'pointerDown', button: 0 });
          this.fingers.set(id, true);
          acts.push({ type: 'pointer', id, parameters: { pointerType: 'touch' }, actions: steps });
        }
      } else {
        // touchEnd / touchCancel: lift every finger not still listed
        const still = new Set(pts.map((t) => 'finger' + (t.id ?? 0)));
        for (const id of [...this.fingers.keys()]) if (!still.has(id)) { acts.push({ type: 'pointer', id, parameters: { pointerType: 'touch' }, actions: [{ type: 'pointerUp', button: 0 }] }); this.fingers.delete(id); }
      }
      if (acts.length) await this.b.send('input.performActions', { context: this.ctx, actions: acts });
      return {};
    }
    if (method === 'Input.synthesizeScrollGesture') {
      // a finger (or mouse) drag the other way to the scroll asked for
      const { x, y, xDistance = 0, yDistance = 0, gestureSourceType } = params;
      const type = gestureSourceType === 'mouse' ? 'mouse' : 'touch';
      const acts = [{ type: 'pointerMove', x: Math.round(x), y: Math.round(y) }, { type: 'pointerDown', button: 0 }];
      for (let i = 1; i <= 10; i++) acts.push({ type: 'pointerMove', x: Math.round(x + xDistance * i / 10), y: Math.round(y + yDistance * i / 10), duration: 16 });
      acts.push({ type: 'pointerUp', button: 0 });
      await this.pointer(acts, type);
      return {};
    }
    if (method === 'Input.dispatchMouseEvent') {
      const b = params.button === 'right' ? 2 : 0;
      const step = params.type === 'mousePressed' ? { type: 'pointerDown', button: b } : params.type === 'mouseReleased' ? { type: 'pointerUp', button: b } : params.type === 'mouseWheel' ? null : { type: 'pointerMove', x: Math.round(params.x), y: Math.round(params.y) };
      if (params.type === 'mouseWheel') await this.wheel(params.x, params.y, params.deltaY || 0);
      else await this.pointer(params.type === 'mouseMoved' ? [step] : [{ type: 'pointerMove', x: Math.round(params.x), y: Math.round(params.y) }, step]);
      return {};
    }
    // no way to force a collection from outside in Firefox: the heap figures it would steady are not comparable anyway
    if (method === 'HeapProfiler.collectGarbage') { this.gcUnsupported = true; return {}; }
    throw new Error(`${method}: not in Firefox (a Chrome DevTools method)`);
  }
  /** Console errors and exceptions since the last goto, minus an allowlist of patterns. */
  errors(allow = []) {
    const bad = [...this.exceptions.map((e) => ({ kind: 'exception', text: e.text })), ...this.console.filter((c) => c.level === 'error' || (c.level === 'warning' && /WebGL|CONTEXT_LOST|THREE\./.test(c.text))).map((c) => ({ kind: 'console', text: c.text + (c.stack ? ' @ ' + c.stack : '') }))];
    return bad.filter((b) => !allow.some((re) => re.test(b.text)));
  }
  async close() {
    if (!this.ctx) return;
    try { await this.b.send('browsingContext.close', { context: this.ctx }); } catch { /* already gone */ }
    this.b.pages.delete(this.ctx); this.ctx = null;
  }
}
