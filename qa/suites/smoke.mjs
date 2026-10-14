/* Smoke & stability: every screen, as a stranger and as a sworn warden, boots without a thrown
 * error, draws a sky that is not black, names itself, and leaves cleanly when the next screen comes. */
import { expect } from '../lib/report.mjs';
import { openGame, awake, go, stage, lookAtStage, ROUTES, ALLOW, sleep } from '../lib/game.mjs';

export default async function (t, ctx) {
  const page = await ctx.newPage();
  const screens = [['gate', '#/'], ['hold (yours, before any oath)', '#/hold'], ['hold (watching)', '#/hold/' + ctx.sky.me.pid], ['bestiary', '#/bestiary/10'], ['atlas', '#/atlas'], ['skirmish', '#/skirmish/' + ctx.sky.foe.pid], ['leyweave', '#/leyweave'], ['grimoire', '#/grimoire']];
  for (const [name, route] of screens) {
    await t.test(`${name} boots clean and draws`, 'S0', async (c) => {
      await openGame(page, ctx.app.url, route);
      const state = await awake(page);
      await sleep(1200);
      const errs = page.errors(ALLOW);
      expect.noErrors(errs, 'console');
      const st = await stage(page);
      if (state === 'awake') { expect.ok(st && st.finite, 'camera is finite', st); }
      const title = await page.eval('document.title');
      expect.ok(/Wyrmhodl/.test(title), 'title names the game: ' + title);
      const seen = await lookAtStage(page, c.evidencePath('after-boot.png'));
      if (state === 'awake') expect.ok(seen.mean > 12 && seen.dark < 0.9, `the sky is drawn (mean ${seen.mean.toFixed(1)}, ${Math.round(seen.dark * 100)}% black)`);
      if (state === 'none' && route !== '#/grimoire') c.warn('no stage canvas on this screen');
      const noWorld = await page.eval(`!!document.querySelector('.stage.no-world')`);
      expect.ok(!noWorld, 'WebGL woke (no "could not draw the sky" notice)');
    });
  }
  await t.test('every screen, sworn, boots clean and draws', 'S0', async (c) => {
    await openGame(page, ctx.app.url, '#/hold', { sworn: true, playerId: ctx.sky.me.pid });
    for (const [name, route] of Object.entries(ROUTES)) {
      await go(page, route);
      const state = await awake(page);
      await sleep(900);
      const errs = page.errors(ALLOW);
      expect.noErrors(errs, name + ' console');
      if (state === 'awake') { const st = await stage(page); expect.ok(st && st.finite, name + ' camera finite', st); const seen = await lookAtStage(page, c.evidencePath(name + '.png')); expect.ok(seen.mean > 12, `${name}: sky drawn (mean ${seen.mean.toFixed(1)})`); }
    }
  });
  await t.test('walking every road twice leaves no stray scenes, dialogs, tags or heralds behind', 'S1', async (c) => {
    await openGame(page, ctx.app.url, '#/hold', { sworn: true, playerId: ctx.sky.me.pid });
    const walk = ['#/atlas', '#/skirmish/' + ctx.sky.foe.pid, '#/bestiary/5', '#/leyweave', '#/grimoire', '#/hold', '#/atlas', '#/hold'];
    for (const r of walk) { await go(page, r); await awake(page); await sleep(400); }
    const r = await page.eval(`({ screens: document.querySelectorAll('#app .screen').length, canvases: document.querySelectorAll('#app canvas').length, tagBoxes: document.querySelectorAll('.unit-tags').length, veils: document.querySelectorAll('.veil').length, heralds: document.querySelectorAll('#heralds .herald').length, stages: document.querySelectorAll('#app .stage').length })`);
    expect.eq(r.screens, 1, 'one screen mounted');
    expect.lte(r.canvases, 2, 'canvases on the page (the screen, and at most one portrait)');
    expect.lte(r.tagBoxes, 1, 'unit-tag containers');
    expect.eq(r.veils, 0, 'open dialogs');
    const errs = page.errors([...ALLOW, /Too many active WebGL contexts/]);
    expect.noErrors(errs, 'console after the walk');
    const ctxLost = page.console.filter((m) => /Too many active WebGL contexts|CONTEXT_LOST/i.test(m.text));
    if (ctxLost.length) c.warn(`${ctxLost.length} WebGL context warnings during the walk`);
  });
  await t.test('a deep link to an unknown road lands on the Gate, and a bad warden id on an honest message', 'S1', async () => {
    await openGame(page, ctx.app.url, '#/nowhere/at/all');
    expect.eq(await page.eval(`document.body.dataset.route`), 'gate', 'unknown road → gate');
    await openGame(page, ctx.app.url, '#/hold/1-999999');
    await sleep(2500);
    const text = await page.eval('document.body.innerText');
    expect.ok(/Reading their hold|not answering|Bound to them/i.test(text), 'the Hold says it is reading or cannot find them', text.slice(0, 300));
    // the ledger rightly answers 404 for a warden who does not exist; only a thrown error counts
    expect.noErrors(page.errors([...ALLOW, /\[network\].*404/]), 'console');
  });
  await page.close();
}
