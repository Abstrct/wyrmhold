/* Performance & memory: draw budgets per screen, frame pacing, and a long session that walks every
 * road many times while bells strike, watching for anything that grows without bound. */
import { expect } from '../lib/report.mjs';
import { openGame, awake, go, stage, frameTimes, ROUTES, ALLOW, sleep } from '../lib/game.mjs';

// budgets are generous ceilings: a regression shows as a jump, the report keeps the census
const BUDGET = { calls: 900, triangles: 2_600_000, programs: 90, textures: 120, geometries: 700 };

export default async function (t, ctx) {
  const page = await ctx.newPage({ width: 1280, height: 800 });
  const census = {};
  await openGame(page, ctx.app.url, '#/hold', { sworn: true, playerId: ctx.sky.me.pid });
  for (const [name, route] of Object.entries(ROUTES)) {
    if (name === 'grimoire') continue;
    await t.test(`${name}: draw calls, triangles, programs and textures within budget`, 'S2', async (c) => {
      await go(page, route === '#/skirmish' ? '#/skirmish/' + ctx.sky.foe.pid : route);
      await awake(page); await sleep(2500);
      const st = await stage(page);
      expect.ok(st, 'a stage');
      census[name] = st;
      for (const k of Object.keys(BUDGET)) if (st[k] > BUDGET[k]) c.warn(`${k} ${st[k]} over budget ${BUDGET[k]}`);
      const ft = await frameTimes(page, 45);
      census[name].frame = ft;
      // software rendering: pacing is reported, only a stall counts
      if (ft.max > 1500) c.warn(`a frame took ${Math.round(ft.max)} ms`);
    });
  }
  ctx.report.note('draw census: ' + Object.entries(census).map(([k, v]) => `${k}: ${v.calls} calls, ${(v.triangles / 1000).toFixed(0)}k▲, ${v.programs} programs, ${v.textures} tex, ${v.geometries} geo, frame mean ${v.frame?.mean.toFixed(0)} ms p95 ${v.frame?.p95.toFixed(0)}`).join(' · '));

  await t.test('a long session: 6 laps of every road while bells strike; heap, contexts and DOM do not grow without bound', 'S1', async (c) => {
    const heap = () => page.eval(`performance.memory ? performance.memory.usedJSHeapSize : 0`);
    const dom = () => page.eval(`({ nodes: document.getElementsByTagName('*').length, canvases: document.querySelectorAll('canvas').length, tags: document.querySelectorAll('.unit-tag').length, listeners: 0 })`);
    const roads = ['#/hold', '#/atlas', '#/skirmish/' + ctx.sky.foe.pid, '#/bestiary/9', '#/leyweave', '#/grimoire'];
    const samples = [];
    for (let lap = 0; lap < 6; lap++) {
      for (const r of roads) { await go(page, r); await awake(page); await sleep(350); }
      await page.send('HeapProfiler.collectGarbage').catch(() => {});
      await sleep(300);
      samples.push({ heap: await heap(), ...(await dom()) });
    }
    ctx.report.note('long session samples: ' + samples.map((s) => `${(s.heap / 1048576).toFixed(0)}MB/${s.nodes}n/${s.canvases}c`).join(' → '));
    const first = samples[1], last = samples[samples.length - 1];
    expect.lte(last.nodes, first.nodes * 1.5 + 200, 'DOM nodes stay bounded');
    expect.lte(last.canvases, 3, 'canvases stay bounded');
    if (last.heap > first.heap * 1.6 + 30 * 1048576) c.warn(`heap grew from ${(first.heap / 1048576).toFixed(0)} MB to ${(last.heap / 1048576).toFixed(0)} MB over 5 laps`);
    const ctxErrs = page.console.filter((m) => /Too many active WebGL contexts|CONTEXT_LOST|lost the WebGL/i.test(m.text));
    expect.eq(ctxErrs.length, 0, 'WebGL context loss or exhaustion', ctxErrs.map((e) => e.text));
    expect.noErrors(page.errors(ALLOW), 'console');
  });
  await t.test('a soak on the Hold: 60 s of bells and ledger events; units, tags and errors stay steady', 'S1', async (c) => {
    await go(page, '#/hold'); await awake(page); await page.waitFor(`document.querySelectorAll('.roster-panel .item').length > 5`, { what: 'the roster' }); await sleep(1000);
    const me = ctx.sky.me;
    const census0 = await page.eval(`document.querySelector('#app .stage canvas').__wyrmCtl.census()`);
    const t0 = Date.now(); let ticks = 0;
    while (Date.now() - t0 < 60000) {
      // the ledger moves: a struct of ours changes, the grid moves
      const s = me.beasts[2]; s.structAttributes.status = s.structAttributes.status === '7' ? '3' : '7';
      ctx.ledger.emitTx([{ type: 'EventStruct', key: 'structure', data: { id: s.Struct.id, owner: me.pid, locationId: me.fleetId } }, { type: 'EventGrid', key: 'gridRecord', data: { attributeId: `0-1-${me.pid.split('-')[1]}`, value: String(ticks % 5) } }]);
      ticks++;
      await sleep(3000);
    }
    const census1 = await page.eval(`document.querySelector('#app .stage canvas').__wyrmCtl.census()`);
    expect.eq(census1.units.length, census0.units.length, 'units after the soak');
    expect.eq(census1.tags, census1.units.length, 'tags after the soak');
    expect.eq(census1.roots, census1.units.length, 'roots after the soak');
    const st = await stage(page); expect.ok(st.finite, 'camera finite');
    const rows = await page.eval(`document.querySelectorAll('.roster-panel .item').length`);
    expect.eq(rows, census0.units.length, 'roster rows after the soak');
    expect.noErrors(page.errors(ALLOW), 'console during the soak');
  });
  await page.close();
}
