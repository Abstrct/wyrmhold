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
  // A blind playtester (2026-10-13) could never press "Raid this hold": the Atlas and the Leyweave rebuilt
  // everything on every ledger change, throwing focus off the control and snapping "Ledger marks" shut.
  const countChanges = () => page.eval(`const { empire } = await import('/src/game/empire.ts'); window.__qaOff = empire.onChange(() => window.__qaN++); window.__qaN = 0; return true`);
  await t.test('keyboard: on the Atlas, focus on Raid this hold and an open "Ledger marks" survive the ledger moving; Enter rides to war', 'S1', async () => {
    const { me, foe } = ctx.sky, wyrm = foe.beasts[0], hp = wyrm.structAttributes.health;
    await openGame(page, ctx.app.url, '#/atlas', { sworn: true, playerId: me.pid });
    await awake(page);
    const theirs = `[...document.querySelectorAll('[aria-label="Wardens"] .item')].find((b) => b.querySelector('.nm').textContent === 'Grimwald')`;
    await page.waitFor(`!!(${theirs})`, { what: 'Grimwald in the warden list', timeout: 25000 });
    await page.eval(`${theirs}.click()`);
    await page.waitFor(`/Their Elder Wyrm/.test(document.querySelector('[aria-label="Scouting"]') ? document.querySelector('[aria-label="Scouting"]').innerText : '')`, { what: 'the scouting block', timeout: 20000 });
    // open "Ledger marks" and step on to Raid this hold by keyboard
    await page.eval(`document.querySelector('[aria-label="Chosen isle"] summary').focus()`);
    await page.key('Enter'); await page.key('Tab');
    const at = await page.eval(`(() => { const card = document.querySelector('[aria-label="Chosen isle"]'); window.__qaKeep = { a: document.activeElement, card, marks: card.querySelector('details') }; return { text: document.activeElement.textContent.trim(), open: window.__qaKeep.marks.open }; })()`);
    expect.ok(at.open, 'Enter opens Ledger marks');
    expect.includes(at.text, 'Raid this hold', 'Tab from Ledger marks reaches Raid this hold');
    await countChanges();
    try {
      // the ledger moves: their Wyrm is struck, and both wardens are read again and again
      wyrm.structAttributes.health = '1';
      for (let i = 0; i < 4; i++) {
        ctx.ledger.emitTx([{ type: 'EventStruct', key: 'structure', data: { id: wyrm.Struct.id, owner: foe.pid, locationId: foe.fleetId } }, { type: 'EventPlayer', key: 'player', data: { id: foe.pid } }, { type: 'EventPlayer', key: 'player', data: { id: me.pid } }]);
        await sleep(1500);
      }
      await page.waitFor(`/^vigor 1 of/.test(document.querySelector('[aria-label="Scouting"] .hearts').getAttribute('aria-label'))`, { what: 'the scouting to tell the struck Wyrm', timeout: 20000 });
      const r = await page.eval(`(() => { const k = window.__qaKeep, a = document.activeElement; window.__qaOff(); return { n: window.__qaN, same: a === k.a, focus: (a.textContent || a.tagName).trim().slice(0, 40), card: k.card.isConnected, open: k.marks.isConnected && k.marks.open }; })()`);
      expect.gte(r.n, 4, 'ledger updates while waiting');
      expect.ok(r.same, 'focus stays on Raid this hold', r.focus);
      expect.ok(r.card, 'the chosen isle card stays (no fade out and in)');
      expect.ok(r.open, '"Ledger marks" stays open');
      await page.key('Enter');
      await page.waitFor(`location.hash === '#/skirmish/${foe.pid}'`, { what: 'Enter on Raid this hold to open the Skirmish', timeout: 5000 });
    } finally {
      wyrm.structAttributes.health = hp;
      ctx.ledger.emitTx([{ type: 'EventStruct', key: 'structure', data: { id: wyrm.Struct.id, owner: foe.pid, locationId: foe.fleetId } }]);
    }
    expect.noErrors(page.errors(ALLOW), 'console');
  });
  await t.test('keyboard: on the Leyweave, focus on a Tithe button survives the ledger moving; Enter opens that coven’s Tithe', 'S1', async () => {
    const me = ctx.sky.me, g = ctx.sky.w.players.get(me.pid).gridAttributes, load = g.load;
    await openGame(page, ctx.app.url, '#/leyweave', { sworn: true, playerId: me.pid });
    await awake(page);
    await page.waitFor(`document.querySelectorAll('button[aria-label^="Tithe to"]').length >= 3 && /spare|short/.test(document.querySelector('.ley-main h3').textContent)`, { what: 'the wells and your mana flow', timeout: 25000 });
    const label = await page.eval(`(() => { const b = document.querySelectorAll('button[aria-label^="Tithe to"]')[1]; b.focus(); window.__qaKeep = { a: b, well: b.closest('.card-btn'), flow: document.querySelector('.ley-main h3').textContent }; return b.getAttribute('aria-label'); })()`);
    await countChanges();
    try {
      // the ledger moves: your beasts drink more, and your warden is read again and again
      g.load = String(Number(load) + Math.max(1000, Math.floor(Number(g.capacity) / 10)));
      for (let i = 0; i < 4; i++) { ctx.ledger.emitTx([{ type: 'EventPlayer', key: 'player', data: { id: me.pid } }]); await sleep(1500); }
      await page.waitFor(`document.querySelector('.ley-main h3').textContent !== window.__qaKeep.flow`, { what: 'the mana flow to change', timeout: 20000 });
      const r = await page.eval(`(() => { const k = window.__qaKeep, a = document.activeElement; window.__qaOff(); return { n: window.__qaN, same: a === k.a, focus: (a.getAttribute('aria-label') || a.textContent || a.tagName).trim().slice(0, 40), well: k.well.isConnected }; })()`);
      expect.gte(r.n, 4, 'ledger updates while waiting');
      expect.ok(r.same, 'focus stays on ' + label, r.focus);
      expect.ok(r.well, 'the wellspring cards are not rebuilt when only your flow changes');
      await page.key('Enter');
      await page.waitFor(`document.querySelector('.veil [role=dialog] h2')`, { what: 'the Tithe dialog', timeout: 5000 });
      expect.eq(await page.eval(`document.querySelector('.veil [role=dialog] h2').textContent`), label, 'Enter opens the Tithe of the focused well');
    } finally {
      g.load = load;
      ctx.ledger.emitTx([{ type: 'EventPlayer', key: 'player', data: { id: me.pid } }]);
      await page.eval(`document.querySelectorAll('.veil').forEach((v) => v.remove())`);
    }
    expect.noErrors(page.errors(ALLOW), 'console');
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
  await t.test('touch: two fingers pinch to zoom the sky; a pinch never picks a beast, a tap still does', 'S1', async (c) => {
    await openGame(page, ctx.app.url, '#/hold', { sworn: true, playerId: ctx.sky.me.pid, viewport: { width: 390, height: 844, mobile: true } });
    await awake(page); await page.waitFor(`document.querySelectorAll('.roster-panel .item').length > 5`, { what: 'the roster' }); await sleep(2500);
    // the open sky: a point on the canvas that no panel covers
    const sky = await page.eval(`(() => { const c = document.querySelector('#app .stage canvas'); const r = c.getBoundingClientRect(); for (let y = 140; y < 420; y += 20) for (let x = 120; x < 270; x += 30) if (document.elementFromPoint(x, y) === c) return { x, y }; return null; })()`);
    expect.ok(sky, 'some open sky to pinch on');
    const dist = () => page.eval(`(() => { const st = window.__wyrmStage, k = document.querySelector('#app .stage canvas').__wyrmCtl; const c = st.camera.position; return Math.hypot(c.x, c.y, c.z); })()`);
    const pinchTo = async (from, to) => {
      const pts = (g) => [{ x: sky.x - g / 2, y: sky.y, id: 1 }, { x: sky.x + g / 2, y: sky.y, id: 2 }];
      await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(from) });
      for (let i = 1; i <= 8; i++) await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(from + (to - from) * i / 8) });
      await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(2200);
    };
    const sel0 = await page.eval(`document.querySelector('#app .stage canvas').__wyrmCtl.census().selected`);
    const d0 = await dist();
    await pinchTo(60, 200);
    const d1 = await dist();
    expect.ok(d1 < d0 * 0.8, `spreading two fingers zooms in (camera ${d0.toFixed(1)} → ${d1.toFixed(1)})`);
    await pinchTo(200, 60);
    const d2 = await dist();
    expect.ok(d2 > d1 * 1.25, `pinching two fingers zooms out (camera ${d1.toFixed(1)} → ${d2.toFixed(1)})`);
    const st = await stage(page); expect.ok(st.finite, 'camera finite after pinching');
    expect.eq(await page.eval(`document.querySelector('#app .stage canvas').__wyrmCtl.census().selected`), sel0, 'a pinch does not pick or drop a beast');
    // a single tap still picks: aim at a unit in the open sky
    const hit = await page.eval(`(() => { const c = document.querySelector('#app .stage canvas'), k = c.__wyrmCtl, cam = window.__wyrmStage.camera, r = c.getBoundingClientRect(); for (const id of k.census().units) { const w = k.where(id); const m = cam.matrixWorldInverse.elements, p = cam.projectionMatrix.elements; const x = m[0]*w[0]+m[4]*(w[1]+1.5)+m[8]*w[2]+m[12], y = m[1]*w[0]+m[5]*(w[1]+1.5)+m[9]*w[2]+m[13], z = m[2]*w[0]+m[6]*(w[1]+1.5)+m[10]*w[2]+m[14]; const cw = -z; if (cw <= 0) continue; const sx = r.left + ((p[0]*x+p[8]*z)/cw + 1) / 2 * r.width, sy = r.top + (1 - (p[5]*y+p[9]*z)/cw) / 2 * r.height; if (document.elementFromPoint(sx, sy) === c) return { sx, sy }; } return null; })()`);
    if (!hit) { c.warn('no beast in the open sky to tap after zooming'); return; }
    await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: hit.sx, y: hit.sy, id: 3 }] });
    await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(600);
    expect.ok(await page.eval(`document.querySelector('#app .stage canvas').__wyrmCtl.census().selected`), 'a single tap still picks a beast');
    await page.screenshot(c.evidencePath('after-pinch.png'));
    expect.noErrors(page.errors(ALLOW), 'console');
  });
  await page.close();
}
