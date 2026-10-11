/* Page helpers that know the game: open a screen with a prepared browser, wait for the sky to wake,
 * read the scene through its test handle, and measure what the warden actually sees. */
import { decodePng, measure } from './png.mjs';
import { sleep } from './cdp.mjs';

export const ROUTES = { gate: '#/', hold: '#/hold', bestiary: '#/bestiary', atlas: '#/atlas', skirmish: '#/skirmish', leyweave: '#/leyweave', grimoire: '#/grimoire' };
/** Storage that marks every first-visit moment as already seen, so a check meets the screen, not the tutorial. */
export const QUIET = { 'wyrmhold.prologue': 'seen', 'wyrmhold.tour.hold': 'seen', 'wyrmhold.path.hidden': '1', 'wyrmhold.music': 'off' };
/** Console noise that is not the game's fault. */
export const ALLOW = [/\[vite\]/, /favicon/, /fonts\.g(oogleapis|static)\.com/, /ERR_INTERNET_DISCONNECTED/, /net::ERR_NAME_NOT_RESOLVED/, /WebGL: INVALID_|GL Driver Message/, /GroupMarkerNotSet|Automatic fallback to software WebGL/, /\[Deprecation\]/, /the sky's music|AudioContext/, /KHR_parallel_shader_compile/, /^\[network\] Failed to load resource: the server responded with a status of 404/];

export async function openGame(page, appUrl, route = '#/', { storage = QUIET, viewport, sworn = false, playerId, waitBoot = true, media } = {}) {
  // a fresh target every time: nothing of the last screen (contexts, workers, timers) survives
  await page.recycle();
  if (viewport) await page.setViewport(viewport.width, viewport.height, { mobile: !!viewport.mobile });
  if (media) await page.emulateMedia(media);
  // land on the origin first, so storage can be written before the game boots
  await page.goto(appUrl + 'qa/blank.html');
  await page.eval(`localStorage.clear(); sessionStorage.clear(); const st = ${JSON.stringify(storage)}; for (const k in st) localStorage.setItem(k, st[k]); await new Promise((r) => { const q = indexedDB.deleteDatabase('wyrmhold-keys'); q.onsuccess = q.onerror = q.onblocked = r; setTimeout(r, 500); });`);
  await page.goto(appUrl + route);
  if (waitBoot) await page.waitFor(`!document.getElementById('boot') || document.getElementById('boot').classList.contains('gone')`, { what: 'the boot veil to lift', timeout: 60000 });
  if (sworn) await swear(page, playerId);
  return page;
}

/** Give the browser a soulstone bound to a warden the mock ledger maps every address to. */
export async function swear(page, playerId) {
  await page.eval(`const { wallet } = await import('/src/wallet/wallet.ts'); if (wallet.state === 'empty') await wallet.createInstant(); await wallet.resolvePlayers(); return wallet.active && wallet.active.playerId;`);
  await page.waitFor(`(await import('/src/game/empire.ts')).empire.commander${playerId ? ` && (await import('/src/game/empire.ts')).empire.commander.playerId === ${JSON.stringify(playerId)}` : ''}`, { what: 'the sworn warden to be read', timeout: 60000 });
}

export async function go(page, route) { await page.eval(`location.hash = ${JSON.stringify(route)}`); await sleep(150); await page.waitFor(`document.body.dataset.route && document.querySelector('#app .screen')`, { what: 'the screen to mount' }); }

/** Wait for the first frame of every stage on the screen, or for the no-WebGL notice. */
export async function awake(page, { timeout = 180000 } = {}) {
  try {
    return await page.waitFor(`(() => { const cs = [...document.querySelectorAll('#app .stage canvas')]; if (!cs.length) return 'none'; return cs.every((c) => c.classList.contains('awake') || c.parentElement.classList.contains('no-world')) ? 'awake' : false; })()`, { what: 'the sky to wake', timeout });
  } catch (e) {
    // say what the page looked like when the sky would not wake
    let diag = null;
    try { diag = await page.eval(`({ route: document.body.dataset.route, boot: !!document.getElementById('boot'), canvases: [...document.querySelectorAll('#app canvas')].map((c) => ({ cls: c.className, w: c.clientWidth, h: c.clientHeight, parent: c.parentElement && c.parentElement.className, hasCtl: !!c.__wyrmCtl })), stage: !!window.__wyrmStage, ready: window.__wyrmStage && window.__wyrmStage.ready(), text: document.body.innerText.slice(0, 200) })`, { timeout: 15000 }); } catch (x) { diag = { evalFailed: x.message }; }
    const { Failure } = await import('./report.mjs');
    throw new Failure(e.message, [JSON.stringify(diag), ...page.errors().slice(0, 5).map((x) => x.text.slice(0, 200))]);
  }
}

/** The first stage's controller handle and camera health. */
export const ctl = (page, expr) => page.eval(`const c = document.querySelector('#app .stage canvas'); const k = c && c.__wyrmCtl; if (!k) return null; ${/^\s*return\b/.test(expr) ? expr : 'return (' + expr + ')'}`);
export const stage = (page) => page.eval(`const st = window.__wyrmStage; if (!st) return null; const p = st.camera.position; const f = (v) => Number.isFinite(v); const i = st.renderer.info; /* the composer's passes each reset the counters: count one whole composed frame */ i.autoReset = false; i.reset(); try { st.renderFrame(); } catch (e) { /* a frame that throws is caught elsewhere */ } const frame = { calls: i.render.calls, triangles: i.render.triangles }; i.autoReset = true; return { frameCalls: frame.calls, frameTriangles: frame.triangles, finite: f(p.x) && f(p.y) && f(p.z), cam: [p.x, p.y, p.z].map((v) => +v.toFixed(2)), calls: frame.calls, triangles: frame.triangles, programs: i.programs ? i.programs.length : 0, geometries: i.memory.geometries, textures: i.memory.textures, pixelRatio: st.renderer.getPixelRatio() };`);

/** What the warden sees: luminance of the viewport or a region (0..255), and the share of black. */
export async function look(page, { clip, path } = {}) {
  const buf = await page.screenshot(path, { clip });
  const img = decodePng(buf);
  return { ...measure(img), width: img.width, height: img.height };
}
/** The box of the open sky: the viewport minus nothing (panels are glass; a black sky shows through them). */
export async function lookAtStage(page, path) {
  const r = await page.eval(`(() => { const c = document.querySelector('#app .stage canvas'); if (!c) return null; const b = c.getBoundingClientRect(); return { x: Math.max(0, b.left), y: Math.max(0, b.top), width: Math.min(innerWidth, b.width), height: Math.min(innerHeight, b.height) }; })()`);
  return look(page, { clip: r || undefined, path });
}

export const visibleText = (page) => page.eval(`document.body.innerText`);
export const frameTimes = (page, frames = 60) => page.eval(`await new Promise((res) => { const ts = []; let last = performance.now(); const f = (now) => { ts.push(now - last); last = now; if (ts.length < ${frames}) requestAnimationFrame(f); else res(ts); }; requestAnimationFrame(f); })`).then((ts) => { const s = [...ts].sort((a, b) => a - b); return { mean: ts.reduce((a, b) => a + b, 0) / ts.length, p95: s[Math.floor(s.length * 0.95)], max: s[s.length - 1] }; });
export { sleep };
