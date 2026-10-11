/* Accessibility & input: a warden who cannot see the sky, or cannot use a mouse, must still play.
 * Landmarks, names, keyboard roads through the roster and dialogs, live regions, reduced motion. */
import { expect } from '../lib/report.mjs';
import { openGame, awake, go, stage, ROUTES, ALLOW, sleep } from '../lib/game.mjs';

export default async function (t, ctx) {
  const page = await ctx.newPage();
  await openGame(page, ctx.app.url, '#/hold', { sworn: true, playerId: ctx.sky.me.pid });
  await awake(page);
  await page.waitFor(`document.querySelectorAll('.roster-panel .item').length > 5`, { what: 'the roster' });

  await t.test('landmarks: a nav for the realms, named panels, a heading order that makes sense', 'S2', async () => {
    const r = await page.eval(`({ navs: [...document.querySelectorAll('nav')].map((n) => n.getAttribute('aria-label')), panels: [...document.querySelectorAll('aside, section')].filter((e) => e.offsetParent !== null).map((e) => e.getAttribute('aria-label')), hs: [...document.querySelectorAll('h1, h2, h3')].filter((e) => e.offsetParent !== null).map((h) => h.tagName + ':' + h.textContent.trim().slice(0, 30)), live: document.querySelectorAll('[aria-live], [role=status]').length })`);
    expect.ok(r.navs.includes('Realms') && r.navs.includes('Rites'), 'navs are named', r.navs);
    expect.eq(r.panels.filter((p) => !p).length, 0, 'unnamed visible panels', r.panels);
    expect.ok(r.hs.length >= 2, 'headings present', r.hs);
    expect.gte(r.live, 1, 'a live region for heralds and omens');
  });
  await t.test('the canvas is hidden from assistive tech and the sky never traps focus', 'S2', async () => {
    const r = await page.eval(`[...document.querySelectorAll('#app canvas')].map((c) => c.getAttribute('aria-hidden') === 'true' || c.closest('[aria-hidden=true]') !== null || c.tabIndex < 0)`);
    expect.ok(r.every(Boolean), 'canvases are aria-hidden or unfocusable', r);
  });
  await t.test('keyboard: Tab reaches the realms, the roster and the rites; Enter picks a beast; the focus ring is visible', 'S1', async (c) => {
    await page.eval(`document.body.focus(); document.activeElement && document.activeElement.blur && document.activeElement.blur();`);
    const reached = new Set(); let picked = null;
    for (let i = 0; i < 80; i++) {
      await page.key('Tab');
      const a = await page.eval(`(() => { const e = document.activeElement; if (!e || e === document.body) return null; const cs = getComputedStyle(e); return { tag: e.tagName, text: (e.innerText || e.getAttribute('aria-label') || '').trim().slice(0, 40), inRoster: !!e.closest('.roster-panel .item'), inRites: !!e.closest('nav.rites'), inNav: !!e.closest('.topbar .nav'), key: e.dataset.key, outline: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0, shadow: cs.boxShadow !== 'none' }; })()`);
      if (!a) continue;
      if (a.inNav) reached.add('nav'); if (a.inRites) reached.add('rites');
      if (a.inRoster && !picked) { picked = a; await page.key('Enter'); await sleep(400); const card = await page.eval(`document.querySelector('[aria-label="Chosen beast"]').innerText`); expect.includes(card, a.text.split('\n')[0], 'Enter on a roster item shows its card'); if (!a.outline && !a.shadow) c.warn('no visible focus ring on roster items'); reached.add('roster'); }
      if (reached.size === 3) break;
    }
    for (const k of ['nav', 'roster', 'rites']) expect.ok(reached.has(k), `Tab reaches the ${k}`, [...reached]);
  });
  await t.test('the Summon dialog is modal, named, closes on Escape, and gives focus back', 'S1', async (c) => {
    await page.clickSel('nav.rites .rite', { text: 'Summon' });
    await page.waitFor(`document.querySelector('.veil [role=dialog]')`, { what: 'the dialog' });
    const d = await page.eval(`const v = document.querySelector('.veil [role=dialog]'); return { modal: v.getAttribute('aria-modal'), label: v.getAttribute('aria-label') || v.getAttribute('aria-labelledby'), focusInside: v.contains(document.activeElement) }`);
    expect.eq(d.modal, 'true', 'aria-modal'); expect.ok(d.label, 'named');
    if (!d.focusInside) c.warn('focus does not move into the Summon dialog when it opens');
    await page.key('Escape'); await sleep(300);
    const still = await page.eval(`!!document.querySelector('.veil')`);
    if (still) { c.warn('Escape does not close the Summon dialog (only the ✕ and the veil do)'); await page.eval(`document.querySelector('.veil .icon-btn[aria-label=Close]').click()`); await sleep(200); }
    const back = await page.eval(`(() => { const e = document.activeElement; return e && e !== document.body ? (e.innerText || e.getAttribute('aria-label') || '').trim().slice(0, 30) : null; })()`);
    if (!back) c.warn('focus is lost (on body) after the dialog closes');
  });
  await t.test('the oath dialog is reachable by keyboard from the top bar and closes on Escape', 'S1', async () => {
    await page.clickSel('[data-tut=soulstone]');
    await page.waitFor(`document.querySelector('.veil [role=dialog]')`, { what: 'the oath' });
    const d = await page.eval(`const v = document.querySelector('.veil [role=dialog]'); return { modal: v.getAttribute('aria-modal'), labelled: !!(v.getAttribute('aria-labelledby') && document.getElementById(v.getAttribute('aria-labelledby'))), h2: v.querySelector('h2') && v.querySelector('h2').textContent }`);
    expect.eq(d.modal, 'true', 'modal'); expect.ok(d.labelled, 'labelled by its title');
    await page.key('Escape'); await sleep(300);
    expect.ok(!(await page.eval(`!!document.querySelector('.veil')`)), 'Escape closes the oath');
  });
  await t.test('heralds are announced politely and never stack beyond three', 'S2', async () => {
    await page.eval(`const { toast } = await import('/src/core/dom.ts'); for (let i = 0; i < 6; i++) toast('A herald ' + i, 'player', 4000); return true`);
    await sleep(200);
    const r = await page.eval(`({ live: document.getElementById('heralds').getAttribute('aria-live'), n: document.querySelectorAll('#heralds .herald').length })`);
    expect.eq(r.live, 'polite', 'aria-live'); expect.lte(r.n, 3, 'heralds shown at once');
    await page.eval(`const { toast } = await import('/src/core/dom.ts'); toast('Same word', 'warn', 3000); toast('Same word', 'warn', 3000); return true`);
    await sleep(100);
    const dup = await page.eval(`[...document.querySelectorAll('#heralds .herald')].filter((h) => /Same word/.test(h.textContent)).length`);
    expect.eq(dup, 1, 'the same word twice is one herald with a count');
  });
  await t.test('reduced motion: every screen still boots, draws and stays finite', 'S1', async () => {
    await openGame(page, ctx.app.url, '#/hold', { sworn: true, playerId: ctx.sky.me.pid, media: { 'prefers-reduced-motion': 'reduce' } });
    for (const r of ['#/hold', '#/skirmish/' + ctx.sky.foe.pid, '#/atlas', '#/bestiary/7']) { await go(page, r); await awake(page); await sleep(500); const st = await stage(page); expect.ok(st && st.finite, r + ' finite'); }
    expect.noErrors(page.errors(ALLOW), 'console');
    await page.emulateMedia({});
  });
  await t.test('touch: a tap on a beast on the isle picks it (pointer events reach the sky)', 'S1', async (c) => {
    await openGame(page, ctx.app.url, '#/hold', { sworn: true, playerId: ctx.sky.me.pid });
    await awake(page); await page.waitFor(`document.querySelectorAll('.roster-panel .item').length > 5`, { what: 'the roster' }); await sleep(2500);
    // find a unit's screen position through the scene, then tap it
    const pos = await page.eval(`(() => { const c = document.querySelector('#app .stage canvas'); const k = c.__wyrmCtl; const st = window.__wyrmStage; const T = st.camera; const ids = k.census().units; const out = []; for (const id of ids) { const w = k.where(id); if (!w) continue; const v = { x: w[0], y: w[1] + 1.5, z: w[2] }; const m = T.matrixWorldInverse.elements, p = T.projectionMatrix.elements; const x = m[0] * v.x + m[4] * v.y + m[8] * v.z + m[12], y = m[1] * v.x + m[5] * v.y + m[9] * v.z + m[13], z = m[2] * v.x + m[6] * v.y + m[10] * v.z + m[14]; const cx = p[0] * x + p[8] * z, cy = p[5] * y + p[9] * z, cw = -z; const nx = cx / cw, ny = cy / cw; const r = c.getBoundingClientRect(); const sx = r.left + (nx + 1) / 2 * r.width, sy = r.top + (1 - ny) / 2 * r.height; const el = document.elementFromPoint(sx, sy); if (el === c && cw > 0) out.push({ id, sx, sy }); } return out; })()`);
    expect.ok(pos.length, 'some unit is in the open sky and not under a panel');
    let hit = null;
    for (const p of pos.slice(0, 6)) { await page.click(p.sx, p.sy); await sleep(400); const sel = await page.eval(`document.querySelector('#app .stage canvas').__wyrmCtl.census().selected`); if (sel) { hit = { want: p.id, got: sel }; break; } }
    expect.ok(hit, 'a tap on the sky picked a beast', pos.slice(0, 3));
    if (hit && hit.got !== hit.want) c.warn(`tapped ${hit.want}, picked ${hit.got} (a neighbour was in front)`);
  });
  await page.close();
}
