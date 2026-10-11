/* Skirmish: both warbands drawn and listed, reach and odds told from the catalogue, the raid stepper
 * honest about where the warden stands, and marks that never lie about who can strike whom. */
import { expect } from '../lib/report.mjs';
import { openGame, awake, ctl, stage, lookAtStage, visibleText, go, ALLOW, sleep } from '../lib/game.mjs';
import { TYPES, typeOf, AMBIT_FLAG } from '../lib/world.mjs';

export default async function (t, ctx) {
  const page = await ctx.newPage();
  const me = ctx.sky.me, foe = ctx.sky.foe;
  const openSk = async () => { await openGame(page, ctx.app.url, '#/skirmish/' + foe.pid, { sworn: true, playerId: me.pid }); await awake(page); await page.waitFor(`document.querySelectorAll('[aria-label="Your warband"] .item').length >= 10 && document.querySelectorAll('[aria-label="Their hold"] .item').length >= 5`, { what: 'both lists', timeout: 20000 }); await sleep(1200); };

  await t.test('your warband and their hold are listed and every listed beast stands in the scene', 'S0', async (c) => {
    await openSk();
    const ours = await page.eval(`[...document.querySelectorAll('[aria-label="Your warband"] .item')].map((b) => b.dataset.key.slice(5))`);
    const theirs = await page.eval(`[...document.querySelectorAll('[aria-label="Their hold"] .item')].map((b) => b.dataset.key.slice(7))`);
    const mineAlive = me.beasts.filter((s) => s && (Number(s.structAttributes.status) & 2) && !(Number(s.structAttributes.status) & 32));
    expect.eq(ours.length, mineAlive.length, 'your built, living beasts');
    const theirsAlive = [...foe.beasts, ...foe.hallows].filter((s) => s && (Number(s.structAttributes.status) & 2) && !(Number(s.structAttributes.status) & 32));
    expect.eq(theirs.length, theirsAlive.length, 'their built, living beasts and hallows (warband at home)');
    const census = await ctl(page, 'k.census()');
    for (const id of [...ours, ...theirs]) { expect.ok(census.units.includes(id), `${id} stands in the scene`); const w = await ctl(page, `k.where(${JSON.stringify(id)})`); expect.ok(w && w.every(Number.isFinite), `${id} finite`, w); }
    const seen = await lookAtStage(page, c.evidencePath('both-holds.png'));
    expect.ok(seen.mean > 12, 'sky lit');
    expect.noErrors(page.errors(ALLOW), 'console');
  });

  await t.test('the stepper says where you stand: foe chosen, ride out next; Unleash waits with a reason', 'S2', async () => {
    const steps = await page.eval(`[...document.querySelectorAll('.stepper li')].map((l) => l.className + ':' + l.querySelector('.t').textContent)`);
    expect.ok(steps[0].startsWith('done:'), 'Choose a foe is done', steps);
    expect.ok(steps[1].startsWith('now:'), 'Ride out is now', steps);
    const text = await page.eval(`document.querySelector('[aria-label="Strike"]').innerText`);
    expect.ok(/Ride out to their isle first|Choose a striker/.test(text), 'why Unleash waits', text);
    const disabled = await page.eval(`[...document.querySelectorAll('[aria-label="Strike"] button')].find((b) => b.textContent === 'Unleash').disabled`);
    expect.ok(disabled, 'Unleash is disabled at home');
  });

  await t.test('for every striker, the marks it can reach are exactly those the catalogue allows, and the odds are told', 'S1', async () => {
    const ours = await page.eval(`[...document.querySelectorAll('[aria-label="Your warband"] .item')].map((b) => ({ id: b.dataset.key.slice(5), name: b.querySelector('.nm').textContent }))`);
    const wrong = [];
    for (const o of ours) {
      await page.eval(`document.querySelector('[data-key=${JSON.stringify('ours:' + o.id)}]').click()`);
      await sleep(250);
      const a = ctx.sky.w.structs.get(o.id), at = typeOf(Number(a.Struct.type));
      const rows = await page.eval(`[...document.querySelectorAll('[aria-label="Their hold"] .item')].map((b) => ({ id: b.dataset.key.slice(7), disabled: b.disabled, sub: b.querySelector('.sub').textContent, title: b.title }))`);
      for (const r of rows) {
        const tS = ctx.sky.w.structs.get(r.id), hidden = !!(Number(tS.structAttributes.status) & 16), ta = tS.Struct.operatingAmbit;
        const can = (mask) => (mask & AMBIT_FLAG[ta]) || ((mask & 32) && a.Struct.operatingAmbit === ta);
        let reach = !(hidden && ta !== a.Struct.operatingAmbit) && ((at.primaryWeaponCharge && can(at.primaryWeaponAmbits)) || (at.secondaryWeaponCharge && can(at.secondaryWeaponAmbits)));
        if (!!reach !== !r.disabled) wrong.push(`${o.name} → ${typeOf(Number(tS.Struct.type)).type} (${ta}${hidden ? ', veiled' : ''}): expected ${reach ? 'reachable' : 'out of reach'}, shown ${r.disabled ? 'disabled: ' + r.sub : 'enabled'}`);
        if (r.disabled && !(r.sub.length > 6)) wrong.push(`${o.name} → ${r.id}: disabled without a reason`);
      }
      const first = rows.find((r) => !r.disabled);
      if (first) {
        await page.eval(`document.querySelector('[data-key=${JSON.stringify('theirs:' + first.id)}]').click()`);
        await sleep(250);
        const odds = await page.eval(`document.querySelector('[aria-label="Strike"] .muted').textContent`);
        if (!/blow for \d+ breath/.test(odds) || !/damage/.test(odds)) wrong.push(`${o.name}: odds unclear: ${odds}`);
      }
    }
    expect.eq(wrong.length, 0, 'reach or odds that disagree with the catalogue', wrong);
    const st = await stage(page); expect.ok(st.finite, 'camera finite');
  });

  await t.test('the camera views (Ours, Both, Theirs) move the eye and keep it finite', 'S1', async () => {
    for (const v of ['Ours', 'Theirs', 'Both']) {
      await page.clickSel('[aria-label="Camera view"] button', { text: v });
      await sleep(900);
      const st = await stage(page); expect.ok(st.finite, `camera finite on ${v}`);
    }
  });

  await t.test('riding out: the warband flies abroad, Unleash wakes, the stepper moves to Strike', 'S1', async (c) => {
    const f = ctx.sky.w.fleets.get(me.fleetId);
    f.status = 'away'; f.locationId = foe.planetId;
    const tp = ctx.sky.w.planets.get(foe.planetId); tp.Planet.locationListStart = f.id; tp.Planet.locationListCount = '1'; tp.planetAttributes.blockStartRaid = String(ctx.sky.w.height);
    ctx.ledger.emitTx([{ type: 'EventFleet', key: 'fleet', data: { id: f.id, owner: me.pid, locationId: foe.planetId } }]);
    await page.waitFor(`[...document.querySelectorAll('.stepper li')].some((l) => l.className.startsWith('now') && /Strike/.test(l.textContent))`, { what: 'the Strike step', timeout: 20000 });
    await sleep(2500);
    const text = await page.eval(`document.querySelector('.hud').innerText`);
    expect.ok(/Over Grimwald/.test(text), 'the banner says you are over their isle', text.slice(0, 300));
    expect.ok(/plunder/i.test(text), 'the plunder chant is mentioned');
    // pick a striker and a mark it can reach: Unleash is live
    await page.eval(`[...document.querySelectorAll('[aria-label="Your warband"] .item')].find((b) => /Elder Wyrm/.test(b.textContent)).click()`);
    await sleep(200);
    const target = await page.eval(`const b = [...document.querySelectorAll('[aria-label="Their hold"] .item')].find((b) => !b.disabled); if (b) b.click(); return b && b.querySelector('.nm').textContent`);
    expect.ok(target, 'a reachable mark exists for the Elder Wyrm');
    await sleep(300);
    const unleash = await page.eval(`[...document.querySelectorAll('[aria-label="Strike"] button')].find((b) => b.textContent === 'Unleash').disabled`);
    expect.ok(!unleash, 'Unleash is enabled in orbit');
    await page.screenshot(c.evidencePath('in-orbit.png'));
    const st = await stage(page); expect.ok(st.finite, 'camera finite abroad');
    // home again
    f.status = 'onStation'; f.locationId = me.planetId; tp.Planet.locationListStart = ''; tp.Planet.locationListCount = '0';
    ctx.ledger.emitTx([{ type: 'EventFleet', key: 'fleet', data: { id: f.id, owner: me.pid, locationId: me.planetId } }]);
    await page.waitFor(`[...document.querySelectorAll('.stepper li')].some((l) => l.className.startsWith('now') && /Ride out/.test(l.textContent))`, { what: 'home again', timeout: 20000 });
  });

  await t.test('Unleash sends a rite: the queue takes it, the ledger hears it, and the chronicle tells it', 'S1', async (c) => {
    const f = ctx.sky.w.fleets.get(me.fleetId); f.status = 'away'; f.locationId = foe.planetId;
    try {
    ctx.ledger.emitTx([{ type: 'EventFleet', key: 'fleet', data: { id: f.id, owner: me.pid, locationId: foe.planetId } }]);
    await page.waitFor(`/Over Grimwald/.test(document.querySelector('.hud').innerText)`, { what: 'in orbit', timeout: 20000 });
    await sleep(500);
    await page.eval(`[...document.querySelectorAll('[aria-label="Your warband"] .item')].find((b) => /Elder Wyrm/.test(b.textContent)).click()`);
    await sleep(200);
    await page.eval(`[...document.querySelectorAll('[aria-label="Their hold"] .item')].find((b) => !b.disabled).click()`);
    await sleep(300);
    const before = ctx.ledger.broadcasts || 0;
    ctx.sky.w.lastSigner = null;
    await page.clickSel('[aria-label="Strike"] button', { text: 'Unleash' });
    await page.waitFor(`document.querySelector('#heralds') && /gathers itself|strike/i.test(document.querySelector('#heralds').innerText)`, { what: 'the strike herald', timeout: 10000 });
    const t0 = Date.now();
    while ((ctx.ledger.broadcasts || 0) === before && Date.now() - t0 < 25000) await sleep(300);
    expect.ok((ctx.ledger.broadcasts || 0) > before, 'the rite was broadcast to the ledger');
    const paths = ctx.ledger.log.filter((l) => l.at > t0 - 1000).map((l) => l.path);
    expect.ok(paths.some((p) => /simulate/.test(p)), 'the rite was simulated for gas first');
    await page.waitFor(`/strikes|Strike/.test(document.querySelector('.sk-chron') ? document.querySelector('.sk-chron').innerText : '')`, { what: 'the chronicle entry', timeout: 25000 });
    await page.screenshot(c.evidencePath('after-unleash.png'));
    expect.noErrors(page.errors(ALLOW), 'console');
    } finally { f.status = 'onStation'; f.locationId = me.planetId; }
  });

  await t.test('without a foe: the far isle says "No foe chosen" and points to the Atlas', 'S2', async () => {
    await openGame(page, ctx.app.url, '#/skirmish', { sworn: true, playerId: me.pid });
    await awake(page);
    await sleep(1500);
    const text = await visibleText(page);
    expect.ok(/Choose a hold to raid from the Sky Atlas/.test(text), 'the banner', text.slice(0, 300));
    expect.ok(!(await page.eval(`document.querySelector('[aria-label="Their hold"]').offsetParent`)), 'their panel is hidden');
    expect.noErrors(page.errors(ALLOW), 'console');
  });

  await t.test('defending: raiders over your isle are the foe, and the stepper yields to the defence banner', 'S1', async (c) => {
    const rf = ctx.sky.w.fleets.get(foe.fleetId); rf.status = 'away'; rf.locationId = me.planetId;
    const mp = ctx.sky.w.planets.get(me.planetId); mp.Planet.locationListStart = rf.id; mp.Planet.locationListCount = '1';
    await openGame(page, ctx.app.url, '#/skirmish', { sworn: true, playerId: me.pid });
    await awake(page);
    await page.waitFor(`/Raiders over your isle/.test(document.body.innerText)`, { what: 'the defence banner', timeout: 45000 }).catch(async (e) => { throw new (await import('../lib/report.mjs')).Failure(e.message, [await page.eval(`document.querySelector('.hud').innerText.slice(0, 400)`), ...page.errors().map((x) => x.text.slice(0, 200))]); });
    const text = await visibleText(page);
    expect.includes(text, 'Grimwald', 'the raider is named');
    const theirs = await page.eval(`document.querySelectorAll('[aria-label="Their hold"] .item').length`);
    expect.gte(theirs, 1, 'their warband is listed');
    await page.screenshot(c.evidencePath('defending.png'));
    rf.status = 'onStation'; rf.locationId = foe.planetId; mp.Planet.locationListStart = ''; mp.Planet.locationListCount = '0';
    expect.noErrors(page.errors(ALLOW), 'console');
  });
  await page.close();
}
