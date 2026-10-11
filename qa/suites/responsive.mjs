/* Screens & devices: the matrix a studio ships to. On each, every screen boots, no sideways scroll,
 * the primary controls sit inside the viewport, touch targets are big enough, nothing overflows its box. */
import { expect } from '../lib/report.mjs';
import { openGame, awake, go, stage, lookAtStage, ROUTES, ALLOW, sleep } from '../lib/game.mjs';

export const DEVICES = [
  ['desktop 1440×900', { width: 1440, height: 900 }],
  ['laptop 1280×800', { width: 1280, height: 800 }],
  ['small laptop 1024×700', { width: 1024, height: 700 }],
  ['tablet 768×1024', { width: 768, height: 1024, mobile: true }],
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
  await page.close();
}
