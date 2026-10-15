/* Chrome and Firefox, side by side: the same screens of the same sky, measured the same way in each.
 *   node qa/browsers.mjs [--out DIR] [--only chrome|firefox] [--screens gate,hold] [--settle 6] [--idle 10] [--headed]
 * Per screen: time to the sky's first frame, frame pacing (rAF), the CPU cost of composing one frame, the draw
 * counters, the browser's CPU use while the warden only watches (all of its processes), and its memory. Then the
 * chant engine is timed on its own: one hashing thread, the warden's full pool, and the WebGPU hasher. Writes
 * report.md, report.json and a screenshot of every screen in each browser. Chrome draws on this machine's GPU
 * (as Firefox does), so the two are fair. Headless Firefox has no WebGPU adapter; pass --headed to time it. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ledger } from './lib/ledger.mjs';
import { standardSky } from './lib/world.mjs';
import { startApp } from './lib/app.mjs';
import { launchChrome, sleep } from './lib/cdp.mjs';
import { launchFirefox } from './lib/bidi.mjs';
import { openGame, awake, ALLOW } from './lib/game.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const out = resolve(opt('--out', join(HERE, 'reports', 'browsers-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19))));
const only = opt('--only', null);
const SETTLE = Number(opt('--settle', 6)), IDLE = Number(opt('--idle', 10));
const headed = args.includes('--headed');
const pick = opt('--screens', null)?.split(',');
mkdirSync(out, { recursive: true });

/** Every process under `root` (the browser and its content, GPU and helper processes). */
function tree(root) {
  const rows = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,rss=,time='], { encoding: 'utf8' }).trim().split('\n').map((l) => l.trim().split(/\s+/));
  const kids = new Map();
  for (const [pid, ppid] of rows) { if (!kids.has(ppid)) kids.set(ppid, []); kids.get(ppid).push(pid); }
  const want = new Set([String(root)]); const q = [String(root)];
  while (q.length) for (const k of kids.get(q.shift()) || []) if (!want.has(k)) { want.add(k); q.push(k); }
  const secs = (t) => t.split(':').reverse().reduce((s, v, i) => s + Number(v.replace(/-.*/, '')) * 60 ** i, 0);
  let rss = 0, cpu = 0;
  for (const [pid, , r, t] of rows) if (want.has(pid)) { rss += Number(r) * 1024; cpu += secs(t); }
  return { procs: want.size, rss, cpu };
}

const SCREENS = [
  { key: 'gate', route: '#/', title: 'The Gate' },
  { key: 'hold', route: '#/hold', title: 'The Hold (sworn, 30+ beasts)', sworn: true },
  { key: 'atlas', route: '#/atlas', title: 'Sky Atlas' },
  { key: 'bestiary', route: '#/bestiary/elder-wyrm', title: 'Bestiary' },
  { key: 'skirmish', route: null, title: 'Skirmish (sworn, against the foe)', sworn: true },
  { key: 'leyweave', route: '#/leyweave', title: 'Leyweave' },
  { key: 'grimoire', route: '#/grimoire', title: 'Grimoire' },
].filter((s) => !pick || pick.includes(s.key));

/* The chant engine timed apart from the game: hash.worker threads (as pow.ts spawns them) and the GPU hasher
 * on a fixed prefix, with the floor above any proof so nothing is reported, only counted. */
const CHANT = `
  const PREFIX = '5-431197BUILD3005708NONCE', sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const threads = async (n) => {
    let hashes = 0; const ws = [];
    for (let i = 0; i < n; i++) { const w = new Worker('/src/pow/hash.worker.ts', { type: 'module' }); w.onmessage = (e) => { if (e.data.type === 'progress') hashes += e.data.hashes; }; w.postMessage({ type: 'start', taskId: 'bench', prefix: PREFIX, start: i * 1e11, floor: 64 }); ws.push(w); }
    await sleep(1500); hashes = 0; const t0 = performance.now(); await sleep(4000); const rate = hashes / ((performance.now() - t0) / 1000);
    ws.forEach((w) => w.terminate()); return Math.round(rate);
  };
  const { pow } = await import('/src/pow/pow.ts');
  const was = pow.settings.enabled; pow.settings.enabled = false;   // the game's own chants stand aside while timed
  const pool = pow.settings.threads;
  const one = await threads(1), all = await threads(pool);
  let gpu = null;
  try {
    const { GpuHasher } = await import('/src/pow/gpu.ts');
    const g = await GpuHasher.open();
    if (!g) gpu = { error: navigator.gpu ? 'no adapter' : 'no WebGPU' };
    else {
      let n = 0, why = null; g.onProgress = (id, k) => { n += k; }; g.onFound = () => {}; g.onFail = (w) => { why = w; };
      g.run('bench', PREFIX, 64); await sleep(2500); n = 0; const t0 = performance.now(); await sleep(5000);
      gpu = why ? { error: why } : { rate: Math.round(n / ((performance.now() - t0) / 1000)), adapter: g.adapter };
      g.destroy();
    }
  } catch (e) { gpu = { error: String(e.message || e) }; }
  pow.settings.enabled = was;
  return { one, pool, all, gpu, cores: navigator.hardwareConcurrency };`;

const ledger = new Ledger(null); await ledger.start({ blockMs: 1000 });
const sky = standardSky(ledger.lcdUrl); ledger.world = sky.w; sky.w.anyAddressPlayer = sky.me.pid;
const app = await startApp({ lcdUrl: ledger.lcdUrl, wsUrl: ledger.wsUrl });
const results = {};

for (const kind of ['chrome', 'firefox']) {
  if (only && only !== kind) continue;
  const browser = kind === 'firefox' ? await launchFirefox({ headed }) : await launchChrome({ gpu: true, headed });
  const root = browser.proc.pid;
  console.log(`\n${kind} · ${browser.version}`);
  const rows = results[kind] = { version: browser.version, screens: {} };
  const page = await browser.newPage({ width: 1440, height: 900 });
  try {
    for (const sc of SCREENS) {
      const route = sc.route || `#/skirmish/${sky.foe.pid}`;
      const t0 = Date.now();
      let r = { route };
      try {
        await openGame(page, app.url, route, { sworn: !!sc.sworn, playerId: sky.me.pid });
        const state = await awake(page, { timeout: 120000 });
        r.awakeMs = Date.now() - t0;
        r.world = state;
        await sleep(SETTLE * 1000);
        // frame pacing as the warden sees it
        r.frames = await page.eval(`await new Promise((res) => { const ts = []; let last = performance.now(); const f = (now) => { ts.push(now - last); last = now; if (ts.length < 180) requestAnimationFrame(f); else res(ts); }; requestAnimationFrame(f); })`)
          .then((ts) => { const s = [...ts].sort((a, b) => a - b); const mean = ts.reduce((a, b) => a + b, 0) / ts.length; return { fps: +(1000 / mean).toFixed(1), meanMs: +mean.toFixed(2), p95Ms: +s[Math.floor(s.length * 0.95)].toFixed(2), maxMs: +s[s.length - 1].toFixed(2), over33: ts.filter((x) => x > 33.4).length }; });
        // the CPU cost of composing one frame (what the main thread spends; the GPU's share runs after)
        r.render = await page.eval(`(() => { const st = window.__wyrmStage; if (!st || !st.ready()) return null; const i = st.renderer.info; i.autoReset = false; i.reset(); st.renderFrame(); const calls = i.render.calls, tris = i.render.triangles; i.autoReset = true; const n = 30, t0 = performance.now(); for (let k = 0; k < n; k++) st.renderFrame(); const gl = st.renderer.getContext(); gl.finish(); const ms = (performance.now() - t0) / n; return { frameMs: +ms.toFixed(2), calls, triangles: tris, programs: i.programs ? i.programs.length : 0, textures: i.memory.textures, pixelRatio: st.renderer.getPixelRatio() }; })()`);
        // what it costs to leave it open: CPU seconds of every browser process over IDLE seconds of watching
        const a = tree(root); await sleep(IDLE * 1000); const b = tree(root);
        r.cpuPct = +(((b.cpu - a.cpu) / IDLE) * 100).toFixed(1);
        r.rssMB = Math.round(b.rss / 1048576);
        r.procs = b.procs;
        r.errors = page.errors(ALLOW).map((e) => e.text.slice(0, 200));
        r.warnings = [...new Set((page.console || []).filter((m) => m.level === 'warning' && !ALLOW.some((re) => re.test(m.text))).map((m) => m.text.slice(0, 160)))];
        await page.screenshot(join(out, `${kind}-${sc.key}.png`));
      } catch (e) { r.error = String(e.message || e).slice(0, 300); }
      rows.screens[sc.key] = r;
      console.log(`  ${sc.key.padEnd(9)} awake ${String(r.awakeMs ?? '—').padStart(6)} ms · ${r.frames ? r.frames.fps + ' fps p95 ' + r.frames.p95Ms + ' ms' : '—'} · frame ${r.render?.frameMs ?? '—'} ms · cpu ${r.cpuPct ?? '—'}% · ${r.rssMB ?? '—'} MB${r.errors?.length ? ` · ${r.errors.length} errors` : ''}${r.error ? ' · FAILED ' + r.error : ''}`);
    }
    if (!args.includes('--no-chant')) {
      rows.chant = await page.eval(CHANT).catch((e) => ({ error: String(e.message || e).slice(0, 300) }));
      console.log(`  chant     ${JSON.stringify(rows.chant)}`);
    }
  } finally { await browser.close(); }
}
await app.stop(); await ledger.stop?.();

writeFileSync(join(out, 'report.json'), JSON.stringify(results, null, 1));
const k = Object.keys(results);
const cell = (v, unit = '') => (v == null ? '—' : `${v}${unit}`);
let md = `# Chrome and Firefox, side by side\n\n${k.map((x) => `- ${x}: ${results[x].version}`).join('\n')}\n- 1440×900, the fixture sky, both drawing on this machine's GPU, ${headed ? 'headed' : 'headless'}; settle ${SETTLE} s, watch ${IDLE} s\n\n`;
md += `| Screen | ${k.map((x) => `${x} first frame | ${x} fps (p95 ms) | ${x} frame CPU | ${x} CPU while watching | ${x} memory`).join(' | ')} |\n|${'---|'.repeat(1 + k.length * 5)}\n`;
for (const sc of SCREENS) {
  md += `| ${sc.title} | ${k.map((x) => { const r = results[x].screens[sc.key] || {}; return r.error ? `failed: ${r.error.slice(0, 60)} | | | |` : `${cell(r.awakeMs, ' ms')} | ${r.frames ? `${r.frames.fps} (${r.frames.p95Ms})` : '—'} | ${cell(r.render?.frameMs, ' ms')} | ${cell(r.cpuPct, '%')} | ${cell(r.rssMB, ' MB')}`; }).join(' | ')} |\n`;
}
const mh = (n) => (n == null ? '—' : `${(n / 1e6).toFixed(n < 1e7 ? 2 : 0)} M/s`);
md += `\n## The chant engine\n\n| | one thread | the pool | WebGPU |\n|---|---|---|---|\n${k.map((x) => { const c = results[x].chant; return !c ? `| ${x} | — | — | — |` : c.error ? `| ${x} | failed: ${c.error.slice(0, 80)} | | |` : `| ${x} | ${mh(c.one)} | ${mh(c.all)} (${c.pool} threads of ${c.cores}) | ${c.gpu?.rate != null ? `${mh(c.gpu.rate)} on ${c.gpu.adapter}` : c.gpu?.error || '—'} |`; }).join('\n')}\n`;
md += `\n## Console errors\n\n${k.map((x) => `- ${x}: ${Object.entries(results[x].screens).map(([s, r]) => (r.errors?.length ? `${s}: ${r.errors.join(' · ')}` : '')).filter(Boolean).join('; ') || 'none'}`).join('\n')}\n`;
md += `\n## Console warnings\n\n${k.map((x) => { const w = [...new Set(Object.values(results[x].screens).flatMap((r) => r.warnings || []))]; return `- ${x}: ${w.length ? w.map((t) => '`' + t.replace(/`/g, "'") + '`').join(' · ') : 'none'}`; }).join('\n')}\n`;
writeFileSync(join(out, 'report.md'), md);
console.log('\n' + md + `\nreport: ${out}`);
process.exit(0);
