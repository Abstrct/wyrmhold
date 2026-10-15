/* Screens & devices: the matrix a studio ships to. On each, every screen boots, no sideways scroll,
 * the primary controls sit inside the viewport, touch targets are big enough, nothing overflows its box. */
import { expect } from '../lib/report.mjs';
import { openGame, awake, go, stage, lookAtStage, ROUTES, ALLOW, sleep } from '../lib/game.mjs';

export const DEVICES = [
  ['desktop 1440×900', { width: 1440, height: 900 }],
  ['laptop 1280×800', { width: 1280, height: 800 }],
  ['small laptop 1024×700', { width: 1024, height: 700 }],
  ['tablet 768×1024', { width: 768, height: 1024, mobile: true }],
  ['tablet landscape 1180×820', { width: 1180, height: 820, mobile: true }],
  ['phone 390×844', { width: 390, height: 844, mobile: true }],
  ['phone landscape 844×390', { width: 844, height: 390, mobile: true }],
];
const PRIMARY = { '#/': '[data-tut=begin]', '#/hold': 'nav.rites .rite', '#/bestiary': '[aria-label="Beast lore"]', '#/atlas': '#warden-search', '#/skirmish': '[aria-label="Strike"]', '#/leyweave': 'button[aria-label^="Tithe to"]', '#/grimoire': '.codex-jumps' };

export default async function (t, ctx) {
  const page = await ctx.newPage();
  for (const [dev, vp] of DEVICES) {
    await t.test(`${dev}: every screen boots, fits, and keeps its primary control on screen`, 'S1', async (c) => {
      await openGame(page, ctx.app.url, '#/hold', { sworn: true, playerId: ctx.sky.me.pid, viewport: vp });
      const findings = [];
      for (const [name, route] of Object.entries(ROUTES)) {
        await go(page, route === '#/skirmish' ? '#/skirmish/' + ctx.sky.foe.pid : route);
        const state = await awake(page);
        await sleep(1200);
        const r = await page.eval(`(() => {
          const de = document.documentElement, scrolls = !!document.querySelector('.screen.scrolls');
          const sideways = de.scrollWidth > innerWidth + 1;
          const sel = ${JSON.stringify(PRIMARY)}[${JSON.stringify(route)}];
          const el = sel && document.querySelector(sel);
          const b = el && el.getBoundingClientRect();
          // a page that scrolls as a whole (phones) only has to let the control be scrolled to
          // whichever box scrolls (a reading screen, or the whole page on a phone) must be able to bring it into view
          let sc = null;
          for (let a = el && el.parentElement; a && a !== document.body; a = a.parentElement) { const oy = getComputedStyle(a).overflowY; if ((oy === 'auto' || oy === 'scroll') && a.scrollHeight > a.clientHeight + 4) { sc = a; break; } }
          sc = sc || document.scrollingElement;
          const scTop = sc === document.scrollingElement ? 0 : sc.getBoundingClientRect().top;
          const pageScrolls = sc.scrollHeight > sc.clientHeight + 4;
          const reach = b ? b.top - scTop + sc.scrollTop : 0;
          const onScreen = !el ? null : (b.width > 0 && b.right > 0 && b.left < innerWidth && (b.top < innerHeight || (pageScrolls && reach < sc.scrollHeight)));
          const screensDown = b ? +(reach / innerHeight).toFixed(1) : 0;
          // text that spills out of a box that clips it
          const clipped = [...document.querySelectorAll('#app *')].filter((e) => { const cs = getComputedStyle(e); if (!/hidden|clip/.test(cs.overflowX) || e.scrollWidth <= e.clientWidth + 2 || !e.innerText || !e.innerText.trim()) return false; if (e.closest('.list, .scroll-y, .marquee, .nav, .chips, .codex-jumps, .unit-tags')) return false; return e.getBoundingClientRect().width > 0; }).slice(0, 5).map((e) => (e.className || e.tagName) + ': ' + e.innerText.trim().slice(0, 30));
          const small = ${vp.mobile ? 'true' : 'false'} ? [...document.querySelectorAll('#app button, #app a.btn, #app .rite, #app .item')].filter((e) => e.offsetParent !== null).map((e) => [e, e.getBoundingClientRect()]).filter(([, r]) => r.width > 0 && (r.height < 36 || r.width < 36)).slice(0, 8).map(([e, r]) => ({ t: (e.innerText || e.getAttribute('aria-label') || e.className).trim().replace(/\\s+/g, ' ').slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) })) : [];
          const topbar = document.querySelector('.topbar'); const tb = topbar && topbar.getBoundingClientRect();
          return { sideways, onScreen, clipped, small, topbarFits: !tb || (tb.left >= -1 && tb.right <= innerWidth + 1), scrolls, screensDown };
        })()`);
        if (r.sideways) findings.push(`${name}: the page scrolls sideways`);
        if (r.onScreen === false) findings.push(`${name}: primary control (${PRIMARY[route]}) is off screen`);
        if (!r.topbarFits) findings.push(`${name}: the top bar overflows the viewport`);
        if (r.clipped.length) c.warn(`${name}: text clipped by its box`, r.clipped);
        if (r.screensDown > 2) c.warn(`${name}: the primary control sits ${r.screensDown} screens down`);
        const tiny = r.small.filter((x) => x.h < 24 || x.w < 24);
        if (tiny.length) findings.push(`${name}: touch targets under the 24px minimum: ${tiny.map((x) => `${x.t} ${x.w}×${x.h}`).join(', ')}`);
        const smallish = r.small.filter((x) => x.h >= 24 && x.w >= 24);
        if (smallish.length) c.warn(`${name}: touch targets under 36px`, smallish.map((x) => `${x.t} ${x.w}×${x.h}`));
        if (state === 'awake') { const st = await stage(page); if (!st.finite) findings.push(`${name}: camera NaN`); const seen = await lookAtStage(page); if (seen.mean < 12) findings.push(`${name}: sky black (mean ${seen.mean.toFixed(1)})`); }
        await page.screenshot(c.evidencePath(`${name}.png`));
      }
      expect.eq(findings.length, 0, 'layout failures', findings);
      expect.noErrors(page.errors(ALLOW), 'console');
    });
  }
  await t.test('the Hold’s roster shows a useful number of rows on every device (not two of fifteen)', 'S1', async (c) => {
    const rows = [], bad = [];
    for (const [dev, vp] of DEVICES) {
      await openGame(page, ctx.app.url, '#/hold', { sworn: true, playerId: ctx.sky.me.pid, viewport: vp });
      await awake(page); await page.waitFor(`document.querySelectorAll('.roster-panel .item').length > 5`, { what: 'the roster' }); await sleep(1200);
      const r = await page.eval(`(() => { const list = document.querySelector('.roster-panel .list'); const li = list.querySelector('li'); const lb = list.getBoundingClientRect(); const own = getComputedStyle(list).overflowY !== 'visible' && list.scrollHeight > list.clientHeight + 2; const pageScrolls = document.scrollingElement.scrollHeight > innerHeight + 4; const visible = Math.floor(lb.height / Math.max(1, li.offsetHeight)); return { visible, listH: Math.round(lb.height), rowH: li.offsetHeight, own, pageScrolls }; })()`);
      // a list that scrolls in its own box must show a few rows; on a page that scrolls as a whole the rows simply follow on
      if (!r.own && r.pageScrolls) { rows.push(`${dev}: the roster flows with the page`); continue; }
      rows.push(`${dev}: ${r.visible} rows visible (list ${r.listH}px, row ${r.rowH}px)`);
      if (r.visible < 2) bad.push(`${dev}: only ${r.visible} roster rows visible in its box (list ${r.listH}px)`);
      else if (r.visible < 3) c.warn(`${dev}: only ${r.visible} roster rows visible before scrolling`);
    }
    ctx.report.note('roster rows by device: ' + rows.join(' · '));
    expect.eq(bad.length, 0, 'devices where the roster shows (almost) nothing', bad);
  });
  await t.test('Ysolde never covers the control she points at (phone, phone sideways, tablet), at rest and after "Show me"', 'S1', async (c) => {
    // the 2026-10-13 playtests: her card or pill sat over Summon, the Atlas list, Guard and Tithe right after "Show me"
    const { w, guilds } = ctx.sky;
    const nw = ctx.worldLib.addWarden(w, { name: 'Lantern', guildId: guilds.hearth.id, beasts: [[1]], planetOre: 5 });
    w.anyAddressPlayer = nw.pid;
    const bad = [], seen = [];
    const measure = (when, dev) => page.eval(`(() => {
      const t = [...document.querySelectorAll('[data-tut="summon"]')].find((e) => e.getBoundingClientRect().width), p = document.querySelector('.path');
      if (!t || !p) return { missing: !t ? 'Summon' : 'Ysolde' };
      const a = t.getBoundingClientRect(), b = p.getBoundingClientRect(), on = a.bottom > 0 && a.top < innerHeight;
      return { on, hit: on && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top, folded: p.classList.contains('min'),
        target: [a.left, a.top, a.right, a.bottom].map(Math.round), ysolde: [b.left, b.top, b.right, b.bottom].map(Math.round) };
    })()`).then((r) => { seen.push(`${dev} ${when}: ${JSON.stringify(r)}`); if (r.missing) bad.push(`${dev} ${when}: no ${r.missing}`); else if (r.hit) bad.push(`${dev} ${when}: Ysolde ${r.ysolde} covers Summon ${r.target}`); return r; });
    try {
      for (const [dev, vp] of [['phone 390×844', { width: 390, height: 844, mobile: true }], ['phone landscape 844×390', { width: 844, height: 390, mobile: true }], ['tablet 1180×820', { width: 1180, height: 820, mobile: true }]]) {
        const storage = { 'wyrmhold.prologue': 'seen', 'wyrmhold.tour.hold': 'seen', 'wyrmhold.music': 'off', 'wyrmhold.path.hidden': '0', ['wyrmhold.path.' + nw.pid]: JSON.stringify({ wyrm: true }) };
        await openGame(page, ctx.app.url, '#/hold', { storage, sworn: true, playerId: nw.pid, viewport: vp });
        await awake(page);
        await page.waitFor(`document.querySelector('[data-tut="summon"]') && document.querySelector('.path .path-pill, .path .path-say')`, { what: 'Summon and Ysolde', timeout: 30000 });
        await sleep(1500);
        await measure('at rest', dev);
        // open her if she waits as a pill, then "Show me"
        if (await page.eval(`document.querySelector('.path').classList.contains('min')`)) { await page.eval(`document.querySelector('.path-pill').click()`); await sleep(700); }
        await page.eval(`[...document.querySelectorAll('.path button')].find((b) => /Show me/.test(b.textContent)).click()`);
        // she points (focus on Summon), the page scrolls it into view, and she steps aside if she would cover it
        await page.waitFor(`document.activeElement && document.activeElement.dataset.tut === 'summon'`, { what: '"Show me" to reach Summon', timeout: 20000 }).catch(() => null);
        await page.waitFor(`(() => { const r = document.activeElement.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })()`, { what: 'Summon in view', timeout: 10000 }).catch(() => null);
        await sleep(1500);
        const r = await measure('after Show me', dev);
        if (!r.missing && !r.on) bad.push(`${dev}: Summon is not brought into view`);
        await page.screenshot(c.evidencePath(`ysolde-${vp.width}x${vp.height}.png`));
      }
    } finally { w.anyAddressPlayer = ctx.sky.me.pid; }
    ctx.report.note('Ysolde and her target: ' + seen.join(' · '));
    expect.eq(bad.length, 0, 'Ysolde over the control she points at', bad);
  });
  await t.test('resizing a live screen (desktop → phone → desktop) keeps the sky and panels sound', 'S1', async () => {
    await openGame(page, ctx.app.url, '#/hold', { sworn: true, playerId: ctx.sky.me.pid, viewport: { width: 1280, height: 800 } });
    await awake(page); await sleep(800);
    for (const vp of [{ width: 390, height: 844, mobile: true }, { width: 844, height: 390, mobile: true }, { width: 1440, height: 900 }]) {
      await page.setViewport(vp.width, vp.height, { mobile: !!vp.mobile }); await sleep(900);
      const st = await stage(page); expect.ok(st.finite, `camera finite at ${vp.width}×${vp.height}`);
      const r = await page.eval(`({ sideways: document.documentElement.scrollWidth > innerWidth + 1, canvasW: document.querySelector('#app canvas').clientWidth })`);
      expect.ok(!r.sideways, `no sideways scroll at ${vp.width}`);
      expect.ok(Math.abs(r.canvasW - vp.width) < 4, `the canvas follows the viewport (${r.canvasW} vs ${vp.width})`);
    }
    expect.noErrors(page.errors(ALLOW), 'console');
  });

  /* ── The world behind the panels (2026-10-14 playtests: "Bro let me SEE my dragon") ── */
  const PHONE_UP = { width: 390, height: 844, mobile: true }, PHONE_SIDE = { width: 844, height: 390, mobile: true }, TABLET = { width: 1180, height: 820, mobile: true };
  /** The share of the screen where a touch lands on the sky itself (a grid of probes; tags and windows let touches through). */
  const openShare = () => page.eval(`(() => { const c = document.querySelector('#app .stage canvas'); let open = 0, n = 0; for (let y = 4; y < innerHeight; y += innerHeight / 16) for (let x = 4; x < innerWidth; x += innerWidth / 24) { n++; if (document.elementFromPoint(x, y) === c) open++; } return open / n; })()`);
  /** Where a unit is on screen this frame (through the scene's own camera), and whether a touch there would reach the sky. */
  const onScreen = (id) => page.eval(`(() => { const c = document.querySelector('#app .stage canvas'), k = c.__wyrmCtl, st = window.__wyrmStage; const w = k && k.where(${JSON.stringify(id)}); if (!w || !st) return null; const v = st.camera.position.clone().set(w[0], w[1], w[2]); st.camera.updateMatrixWorld(); v.project(st.camera); const b = c.getBoundingClientRect(); const x = b.left + (v.x + 1) / 2 * b.width, y = b.top + (1 - v.y) / 2 * b.height; const inside = v.z < 1 && x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight; const at = inside ? document.elementFromPoint(x, y) : null; return { x: Math.round(x), y: Math.round(y), inside, open: at === c, under: at && at !== c ? (at.closest('section, aside, nav, header, .glass') || at).getAttribute('aria-label') || at.className : null }; })()`);

  await t.test('“look at the world” tucks the panels away and brings them back, remembered per screen, by key and touch', 'S1', async (c) => {
    const bad = [];
    for (const [route, vp] of [['#/hold', PHONE_SIDE], ['#/skirmish/' + ctx.sky.foe.pid, PHONE_SIDE], ['#/bestiary', PHONE_UP], ['#/atlas', TABLET]]) {
      await openGame(page, ctx.app.url, route, { sworn: true, playerId: ctx.sky.me.pid, viewport: vp });
      await awake(page); await sleep(1200);
      const state = () => page.eval(`(() => { const b = document.querySelector('.world-btn'); const shown = (s) => [...document.querySelectorAll(s)].some((e) => e.getClientRects().length > 0); const r = b && b.getBoundingClientRect(); const u = document.querySelector('.btn.unleash'), ur = u && u.getBoundingClientRect();
        return { has: !!b, name: b && b.getAttribute('aria-label'), pressed: b && b.getAttribute('aria-pressed'), on: document.body.classList.contains('world-view'), panels: shown('.hud .cols > *'), btnOn: !!r && r.width > 0 && r.top >= 0 && r.bottom <= innerHeight && r.right <= innerWidth, h: r ? Math.round(r.height) : 0, focusable: !!b && b.tabIndex >= 0, strike: !!ur && ur.width > 0 && ur.top >= 0 && ur.bottom <= innerHeight }; })()`);
      const s0 = await state();
      if (!s0.has || !s0.name || s0.pressed !== 'false' || !s0.focusable) { bad.push(`${route}: no named, focusable toggle (${JSON.stringify(s0)})`); continue; }
      if (!s0.panels) bad.push(`${route}: the panels were hidden before the toggle`);
      if (vp.mobile && s0.h < 36) bad.push(`${route}: the toggle is ${s0.h}px tall, under a finger's 36`);
      await page.clickSel('.world-btn'); await sleep(900);
      const s1 = await state();
      if (!s1.on || s1.pressed !== 'true' || s1.panels) bad.push(`${route}: the toggle did not tuck the panels away (${JSON.stringify(s1)})`);
      if (!s1.btnOn) bad.push(`${route}: the way back is not on screen in the world view`);
      if (route.startsWith('#/skirmish') && !s1.strike) bad.push(`${route}: the strike button vanished with the panels: a fight could not go on`);
      if (vp === PHONE_SIDE && route === '#/hold') { const share = await openShare(); if (share < 0.8) bad.push(`${route}: the world view leaves only ${Math.round(share * 100)}% of the screen to the sky`); await page.screenshot(c.evidencePath('hold-world-view-844.png')); }
      // remembered: leave the screen and come back
      await go(page, '#/grimoire'); await go(page, route);
      await page.waitFor(`!!document.querySelector('.world-btn')`, { what: 'the toggle to return with the screen', timeout: 60000 }); await sleep(800);
      const s2 = await state();
      if (!s2.on || s2.pressed !== 'true') bad.push(`${route}: the world view was not remembered on coming back`);
      // Escape brings the panels back
      await page.eval(`document.querySelector('.world-btn').focus()`);
      await page.key('Escape', { code: 'Escape' }); await sleep(700);
      const s3 = await state();
      if (s3.on || s3.pressed !== 'false' || !s3.panels) bad.push(`${route}: Escape did not bring the panels back (${JSON.stringify(s3)})`);
    }
    expect.eq(bad.length, 0, 'world view failures', bad);
    expect.noErrors(page.errors(ALLOW), 'console');
  });

  await t.test('a phone held sideways (844×390): one slim bar, and a useful share of the sky open on the Hold and the Skirmish', 'S1', async (c) => {
    const bad = [], seen = [];
    for (const [name, route] of [['hold', '#/hold'], ['skirmish', '#/skirmish/' + ctx.sky.foe.pid]]) {
      await openGame(page, ctx.app.url, route, { sworn: true, playerId: ctx.sky.me.pid, viewport: PHONE_SIDE });
      await awake(page); await sleep(2000);
      const share = await openShare();
      const bar = await page.eval(`(() => { const r = document.querySelector('.topbar').getBoundingClientRect(); const m = document.querySelector('.nav-menu'); return { h: Math.round(r.height), menu: !!m && m.getClientRects().length > 0 }; })()`);
      seen.push(`${name}: ${Math.round(share * 100)}% open sky, bar ${bar.h}px`);
      if (share < 0.35) bad.push(`${name}: only ${Math.round(share * 100)}% of the screen shows the sky`);
      if (bar.h > 64) bad.push(`${name}: the top bar is ${bar.h}px of 390`);
      if (!bar.menu) bad.push(`${name}: the roads have no menu`);
      if (name === 'skirmish') {
        const u = await page.eval(`(() => { const r = document.querySelector('.btn.unleash').getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom) }; })()`);
        if (u.bottom > PHONE_SIDE.height) bad.push(`skirmish: the big button is below the fold (${u.top}–${u.bottom})`);
      }
      await page.screenshot(c.evidencePath(`${name}-844x390.png`));
    }
    // the roads menu opens, lists every road, and closes on Escape
    await page.clickSel('.nav-menu'); await sleep(300);
    const roads = await page.eval(`[...document.querySelectorAll('.topbar .nav a')].filter((a) => a.getClientRects().length > 0).map((a) => a.textContent)`);
    if (roads.length < 6) bad.push(`the roads menu shows ${roads.length} roads`);
    await page.key('Escape', { code: 'Escape' }); await sleep(200);
    if (await page.eval(`document.querySelector('.topbar').classList.contains('nav-open')`)) bad.push('Escape did not fold the roads menu');
    ctx.report.note('sideways phone: ' + seen.join(' · '));
    expect.eq(bad.length, 0, 'sideways phone layout', bad);
    expect.noErrors(page.errors(ALLOW), 'console');
  });

  await t.test('choosing a flying beast frames it where the warden can see it (phone upright, sideways, tablet), and follows it', 'S1', async (c) => {
    const me = ctx.sky.me, flyers = [[me.beasts[5].Struct.id, 'Shade Owl'], [me.beasts[3].Struct.id, 'Moth Galleon']];
    const bad = [];
    for (const [dev, vp] of [['390×844', PHONE_UP], ['844×390', PHONE_SIDE], ['1180×820', TABLET]]) {
      await openGame(page, ctx.app.url, '#/hold', { sworn: true, playerId: me.pid, viewport: vp });
      await awake(page); await page.waitFor(`document.querySelectorAll('.roster-panel .item').length > 5`, { what: 'the roster' }); await sleep(1500);
      for (const [id, name] of flyers) {
        await page.eval(`document.querySelector('.roster-panel .item[data-key=${JSON.stringify(id)}]').click(); window.scrollTo(0, 0); document.querySelector('.hud').scrollTop = 0;`);
        // the eye eases in over a second or two of frames (far longer under software rendering): wait for it to arrive
        await sleep(1500);
        await page.waitFor(`(() => { const k = document.querySelector('#app .stage canvas').__wyrmCtl.census(); return k.selected === ${JSON.stringify(id)} && k.settled; })()`, { what: `the camera to settle on the ${name}`, timeout: 120000 });
        const a = await onScreen(id);
        await sleep(3000);
        const b = await onScreen(id);
        for (const [when, p] of [['once settled', a], ['three seconds on', b]]) if (!p || !p.inside || !p.open) bad.push(`${dev}: the ${name} ${when} is ${!p ? 'nowhere' : !p.inside ? `off screen (${p.x}, ${p.y})` : `under ${p.under} (${p.x}, ${p.y})`}`);
        if (vp === TABLET) await page.screenshot(c.evidencePath(`${name.replace(' ', '-')}-${dev}.png`));
      }
    }
    expect.eq(bad.length, 0, 'flyers framed out of sight', bad);
    expect.noErrors(page.errors(ALLOW), 'console');
  });

  await t.test('touch: a drag on the panels scrolls them, never the camera; on an upright phone a swipe on the sky scrolls the page', 'S1', async () => {
    const bad = [];
    // a WebDriver touch drag never pans a page natively in Firefox (not even a plain long one): there only the
    // camera half of this check can be judged
    const pans = page.kind !== 'firefox';
    if (!pans) ctx.report.note('touch: Firefox cannot pan a page from a synthetic touch drag; only "the camera stays put" was checked');
    const strayed = () => page.eval(`document.querySelector('#app .stage canvas').__wyrmCtl.census().strayed`);
    const swipe = (x, y, dy) => page.send('Input.synthesizeScrollGesture', { x, y, xDistance: 0, yDistance: -dy, gestureSourceType: 'touch', speed: 900 }).then(() => sleep(800));
    // sideways: the panels' column, on a panel and on the gap between two of them
    await openGame(page, ctx.app.url, '#/hold', { sworn: true, playerId: ctx.sky.me.pid, viewport: PHONE_SIDE });
    await awake(page); await page.waitFor(`document.querySelectorAll('.roster-panel .item').length > 5`, { what: 'the roster' }); await sleep(1500);
    for (const [where, probe] of [['a panel', `(() => { const r = document.querySelector('.roster-panel h2').getBoundingClientRect(); return { x: r.left + 20, y: r.top + 10 }; })()`], ['the gutter beside the panels', `({ x: innerWidth - 4, y: 250 })`]]) {
      await page.eval(`document.querySelector('.hud').scrollTop = 0`); await sleep(300);
      const p = await page.eval(probe), top0 = await page.eval(`document.querySelector('.hud').scrollTop`);
      await swipe(p.x, Math.min(p.y, 360), 160);
      const top1 = await page.eval(`document.querySelector('.hud').scrollTop`);
      if (pans && top1 < top0 + 40) bad.push(`844×390: a drag on ${where} did not scroll the panels (${top0} → ${top1})`);
      if (await strayed()) bad.push(`844×390: a drag on ${where} turned the camera`);
    }
    // upright: a vertical swipe on the window onto the sky scrolls the page rather than tipping the camera
    await openGame(page, ctx.app.url, '#/hold', { sworn: true, playerId: ctx.sky.me.pid, viewport: PHONE_UP });
    await awake(page); await sleep(1500);
    const w = await page.eval(`(() => { const r = document.querySelector('.isle-window').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height * 0.7 }; })()`);
    await swipe(w.x, w.y, 200);
    const y = await page.eval(`window.scrollY || document.scrollingElement.scrollTop`);
    if (pans && y < 40) bad.push(`390×844: a swipe up on the sky did not scroll the page (scrollY ${y})`);
    if (await strayed()) bad.push('390×844: a swipe up on the sky tipped the camera');
    // and a sideways drag on the sky still turns the isle
    await page.eval(`window.scrollTo(0, 0)`); await sleep(400);
    const w2 = await page.eval(`(() => { const r = document.querySelector('.isle-window').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await page.send('Input.synthesizeScrollGesture', { x: w2.x + 80, y: w2.y, xDistance: -160, yDistance: 0, gestureSourceType: 'touch', speed: 900 }); await sleep(800);
    if (!(await strayed())) bad.push('390×844: a sideways drag on the sky no longer turns the isle');
    expect.eq(bad.length, 0, 'drags that went to the wrong place', bad);
  });

  await t.test('the Elder Wyrm card’s realm buttons are fully on screen and touchable at 1280×800 and 1180×820', 'S1', async (c) => {
    const bad = [];
    for (const vp of [{ width: 1280, height: 800 }, TABLET]) {
      await openGame(page, ctx.app.url, '#/hold', { sworn: true, playerId: ctx.sky.me.pid, viewport: vp });
      await awake(page); await page.waitFor(`document.querySelectorAll('.roster-panel .item').length > 5`, { what: 'the roster' }); await sleep(1200);
      await page.eval(`document.querySelector('.roster-panel .item[data-key=${JSON.stringify(ctx.sky.me.beasts[0].Struct.id)}]').click()`); await sleep(1200);
      const r = await page.eval(`(() => { const g = document.querySelector('[aria-label="Soar to a realm"]'); if (!g) return null; return [...g.querySelectorAll('button')].map((b) => { const q = b.getBoundingClientRect(); const at = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2); return { t: b.textContent, top: Math.round(q.top), bottom: Math.round(q.bottom), on: q.top >= 0 && q.bottom <= innerHeight && q.left >= 0 && q.right <= innerWidth, hit: !!at && b.contains(at) }; }); })()`);
      if (!r) { bad.push(`${vp.width}×${vp.height}: no realm buttons on the Wyrm's card`); continue; }
      for (const b of r) if (!b.on || !b.hit) bad.push(`${vp.width}×${vp.height}: ${b.t} is ${!b.on ? 'off screen' : 'covered'} (${b.top}–${b.bottom})`);
      await page.screenshot(c.evidencePath(`wyrm-card-${vp.width}x${vp.height}.png`));
    }
    expect.eq(bad.length, 0, 'realm buttons out of reach', bad);
  });
  await page.close();
}
