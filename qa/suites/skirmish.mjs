/* Skirmish: both warbands drawn and listed, reach and odds told from the catalogue, the war bar honest
 * about where the warden stands and what wins, every blow told in the fray, and a strike that never
 * lies about who can reach whom. */
import { expect } from '../lib/report.mjs';
import { openGame, awake, ctl, stage, lookAtStage, visibleText, ALLOW, sleep } from '../lib/game.mjs';
import { typeOf, AMBIT_FLAG } from '../lib/world.mjs';

export default async function (t, ctx) {
  const page = await ctx.newPage();
  const me = ctx.sky.me, foe = ctx.sky.foe, w = ctx.sky.w;
  const openSk = async () => { await openGame(page, ctx.app.url, '#/skirmish/' + foe.pid, { sworn: true, playerId: me.pid }); await awake(page); await page.waitFor(`document.querySelectorAll('[aria-label="Your warband"] .item').length >= 10 && document.querySelectorAll('[aria-label="Their hold"] .item').length >= 5`, { what: 'both lists', timeout: 20000 }); await sleep(1200); };
  const big = () => page.eval(`const b = document.querySelector('.btn.unleash'); return b && { text: b.innerText.replace(/\\s+/g, ' ').trim(), disabled: b.disabled }`);
  const fleet = w.fleets.get(me.fleetId), theirIsle = w.planets.get(foe.planetId);
  const rideOut = () => { fleet.status = 'away'; fleet.locationId = foe.planetId; theirIsle.Planet.locationListStart = fleet.id; theirIsle.Planet.locationListCount = '1'; theirIsle.planetAttributes.blockStartRaid = String(w.height); ctx.ledger.emitTx([{ type: 'EventFleet', key: 'fleet', data: { id: fleet.id, owner: me.pid, locationId: foe.planetId } }]); };
  const rideHome = () => { fleet.status = 'onStation'; fleet.locationId = me.planetId; theirIsle.Planet.locationListStart = ''; theirIsle.Planet.locationListCount = '0'; ctx.ledger.emitTx([{ type: 'EventFleet', key: 'fleet', data: { id: fleet.id, owner: me.pid, locationId: me.planetId } }]); };
  /** What the catalogue says a striker can reach (the ledger's CanTargetAmbit, plus the veil). */
  const canReach = (a, tS) => {
    const at = typeOf(Number(a.Struct.type)), ta = tS.Struct.operatingAmbit, hidden = !!(Number(tS.structAttributes.status) & 16);
    if (hidden && ta !== a.Struct.operatingAmbit) return false;
    const can = (mask) => (mask & AMBIT_FLAG[ta]) || ((mask & 32) && a.Struct.operatingAmbit === ta);
    return !!((at.primaryWeaponCharge && can(at.primaryWeaponAmbits)) || (at.secondaryWeaponCharge && can(at.secondaryWeaponAmbits)));
  };

  await t.test('your warband and their hold are listed and every listed beast stands in the scene', 'S0', async (c) => {
    await openSk();
    const ours = await page.eval(`[...document.querySelectorAll('[aria-label="Your warband"] .item')].map((b) => b.dataset.key.slice(5))`);
    const theirs = await page.eval(`[...document.querySelectorAll('[aria-label="Their hold"] .item')].map((b) => b.dataset.key.slice(7))`);
    const mineAlive = me.beasts.filter((s) => s && (Number(s.structAttributes.status) & 2) && !(Number(s.structAttributes.status) & 32));
    expect.eq(ours.length, mineAlive.length, 'your built, living beasts');
    const theirsAlive = [...foe.beasts, ...foe.hallows].filter((s) => s && (Number(s.structAttributes.status) & 2) && !(Number(s.structAttributes.status) & 32));
    expect.eq(theirs.length, theirsAlive.length, 'their built, living beasts and hallows (warband at home)');
    // the sky rebuilds once both warbands are read, on the same (already awake) canvas: wait for that scene
    const all = [...ours, ...theirs];
    await page.waitFor(`(() => { const k = document.querySelector('#app .stage canvas').__wyrmCtl; if (!k) return false; const u = k.census().units; return ${JSON.stringify(all)}.every((id) => u.includes(id)); })()`, { what: 'every listed beast in the rebuilt scene', timeout: 60000 }).catch(() => null);
    const census = await ctl(page, 'k.census()');
    for (const id of all) { expect.ok(census.units.includes(id), `${id} stands in the scene`); const p = await ctl(page, `k.where(${JSON.stringify(id)})`); expect.ok(p && p.every(Number.isFinite), `${id} finite`, p); }
    const seen = await lookAtStage(page, c.evidencePath('both-holds.png'));
    expect.ok(seen.mean > 12, 'sky lit');
    expect.noErrors(page.errors(ALLOW), 'console');
  });

  await t.test('at home: the war bar says how a raid is won, and the big button rides out', 'S2', async () => {
    const steps = await page.eval(`[...document.querySelectorAll('.stepper li')].map((l) => l.className + ':' + l.querySelector('.t').textContent)`);
    if (steps.length) { expect.ok(steps[0].startsWith('done:'), 'Choose a foe is done', steps); expect.ok(steps[1].startsWith('now:'), 'Ride out is now', steps); }
    const bar = await page.eval(`document.querySelector('.warbar').innerText`);
    expect.ok(/Raid Grimwald/.test(bar) && /fell their Elder Wyrm/i.test(bar), 'the war bar names the foe and the goal', bar);
    const b = await big();
    expect.ok(b && /^Ride out/.test(b.text) && !b.disabled, 'the big button rides out', b);
    expect.ok(!(await page.eval(`[...document.querySelectorAll('button')].some((x) => /^Unleash/.test(x.innerText.trim()) && !x.disabled)`)), 'no live Unleash at home');
  });

  await t.test('a blow is chosen for you, and every mark says which of your beasts can reach it, as the catalogue allows', 'S1', async () => {
    const chosen = await page.eval(`document.querySelector('.fc-who') ? document.querySelector('.fc-who').innerText : ''`);
    expect.ok(/Your .+Grimwald’s .+/.test(chosen.replace(/\n/g, ' ')), 'a striker and a mark are chosen without asking', chosen);
    const rows = await page.eval(`[...document.querySelectorAll('[aria-label="Their hold"] .item')].map((b) => ({ id: b.dataset.key.slice(7), reach: [...b.querySelectorAll('.reach .rch')].map((x) => x.textContent), none: b.querySelector('.reach.none') ? b.querySelector('.reach.none').textContent : '' }))`);
    const mine = me.beasts.filter((s) => s && (Number(s.structAttributes.status) & 6) === 6 && !(Number(s.structAttributes.status) & 32) && typeOf(Number(s.Struct.type))?.category === 'fleet');
    const LORE = await page.eval(`const l = await import('/src/lore.ts'); return Object.fromEntries(Object.entries(l.BEASTS).map(([k, v]) => [k, v.name]))`);
    const wrong = [];
    for (const r of rows) {
      const tS = w.structs.get(r.id);
      const expected = [...new Set(mine.filter((a) => canReach(a, tS)).map((a) => LORE[a.Struct.type]))].sort();
      const shown = [...new Set(r.reach)].sort();
      // the row names up to three: those it names must reach, and a mark nothing reaches says why
      if (shown.some((n) => !expected.includes(n))) wrong.push(`${LORE[tS.Struct.type]}: shows ${shown} but only ${expected} can reach it`);
      if (!expected.length && !r.none) wrong.push(`${LORE[tS.Struct.type]}: nothing reaches it, and it does not say why`);
      if (expected.length && !shown.length) wrong.push(`${LORE[tS.Struct.type]}: ${expected} can reach it, but it shows none`);
    }
    expect.eq(wrong.length, 0, 'reach that disagrees with the catalogue', wrong);
  });

  await t.test('the forecast tells dodge odds the way the ledger rolls them (Glamour turns aside 2 in 3 seeking blows)', 'S1', async () => {
    // our Harpy (a seeking blow, Skies) on their Harpy (Glamour): lands one time in three
    const ourHarpy = me.beasts.find((s) => s && s.Struct.type === '5'), theirHarpy = foe.beasts.find((s) => s && s.Struct.type === '5');
    await page.eval(`document.querySelector('[data-key="ours:${ourHarpy.Struct.id}"]').click()`); await sleep(250);
    await page.eval(`document.querySelector('[data-key="theirs:${theirHarpy.Struct.id}"]').click()`); await sleep(400);
    const chips = await page.eval(`Object.fromEntries([...document.querySelectorAll('.fc-chip')].map((c) => [c.querySelector('.k').textContent, c.querySelector('.v').textContent]))`);
    expect.eq(chips.Lands, '33%', 'a seeking blow on Glamour lands one time in three', chips);
    const why = await page.eval(`document.querySelector('.fc-why') ? document.querySelector('.fc-why').textContent : ''`);
    expect.ok(/Glamour turns aside two of every three seeking blows/.test(why), 'and says so in words', why);
    // a flung blow (the Kraken's arm) always lands on it
    const kraken = me.beasts.find((s) => s && s.Struct.type === '11');
    await page.eval(`document.querySelector('[data-key="ours:${kraken.Struct.id}"]').click()`); await sleep(400);
    const chips2 = await page.eval(`Object.fromEntries([...document.querySelectorAll('.fc-chip')].map((c) => [c.querySelector('.k').textContent, c.querySelector('.v').textContent]))`);
    expect.eq(chips2.Lands, 'always', 'a flung blow on Glamour always lands', chips2);
  });

  await t.test('a guard is named: on their Wyrm, in the war bar, and in the forecast as the one who takes the blow', 'S1', async () => {
    // the standard sky's foe has no guard: stand their Stone Troll beside their Wyrm, in its realm, for this check
    const wyrm = foe.beasts[0], guard = foe.beasts.find((s) => s && s.Struct.type === '9'); // the Stone Troll, Wilds
    const was = { ambit: guard.Struct.operatingAmbit, defenders: wyrm.structDefenders, idx: guard.structAttributes.protectedStructIndex };
    try {
      guard.Struct.operatingAmbit = wyrm.Struct.operatingAmbit; wyrm.structDefenders = [guard.Struct.id]; guard.structAttributes.protectedStructIndex = wyrm.Struct.index;
      ctx.ledger.emitTx([{ type: 'EventStructDefender', key: 'structDefender', data: { protectedStructId: wyrm.Struct.id, defendingStructId: guard.Struct.id } }]);
      await page.waitFor(`/guards their Wyrm/i.test(document.querySelector('[aria-label="Their hold"]').innerText)`, { what: 'the guard badge', timeout: 20000 });
      const bar = await page.eval(`document.querySelector('.warbar').innerText`);
      expect.ok(/Stone Troll guards it/.test(bar), 'the war bar names the guard', bar);
      const ourWyrm = me.beasts[0];
      await page.eval(`document.querySelector('[data-key="ours:${ourWyrm.Struct.id}"]').click()`); await sleep(250);
      await page.eval(`document.querySelector('[data-key="theirs:${wyrm.Struct.id}"]').click()`); await sleep(500);
      const panel = await page.eval(`document.querySelector('.strike-panel').innerText`);
      expect.ok(/Hits their Stone Troll/i.test(panel) && /takes this blow|guard/i.test(panel), 'the forecast says the guard takes the blow', panel.slice(0, 400));
    } finally {
      guard.Struct.operatingAmbit = was.ambit; wyrm.structDefenders = was.defenders; guard.structAttributes.protectedStructIndex = was.idx;
      ctx.ledger.emitTx([{ type: 'EventStructDefender', key: 'structDefender', data: { protectedStructId: wyrm.Struct.id, defendingStructId: guard.Struct.id } }]);
    }
  });

  await t.test('the camera views (Ours, Both, Theirs) move the eye and keep it finite', 'S1', async () => {
    for (const v of ['Ours', 'Theirs', 'Both']) {
      await page.clickSel('[aria-label="Camera view"] button', { text: v });
      await sleep(900);
      const st = await stage(page); expect.ok(st.finite, `camera finite on ${v}`);
    }
  });

  await t.test('riding out: the warband flies abroad, the war bar says fell their Wyrm, and Unleash wakes', 'S1', async (c) => {
    rideOut();
    try {
      await page.waitFor(`/Fell Grimwald/.test(document.querySelector('.wb-title') ? document.querySelector('.wb-title').textContent : '')`, { what: 'the war bar in their sky', timeout: 20000 });
      await sleep(2500);
      const bar = await page.eval(`document.querySelector('.warbar').innerText`);
      expect.ok(/plunder waits/i.test(bar), 'the war bar says the plunder waits on their Wyrm', bar);
      // with breath enough, a chosen blow is ready to strike
      w.players.get(me.pid).gridAttributes.lastAction = String(w.height - 20);
      ctx.ledger.emitTx([{ type: 'EventPlayer', key: 'player', data: { id: me.pid } }]);
      await page.waitFor(`/^Unleash/.test(document.querySelector('.btn.unleash').innerText.trim()) && !document.querySelector('.btn.unleash').disabled`, { what: 'Unleash ready', timeout: 20000 });
      await page.screenshot(c.evidencePath('in-orbit.png'));
      const st = await stage(page); expect.ok(st.finite, 'camera finite abroad');
    } finally { rideHome(); }
    await page.waitFor(`/Raid Grimwald/.test(document.querySelector('.wb-title') ? document.querySelector('.wb-title').textContent : '')`, { what: 'home again', timeout: 20000 });
  });

  await t.test('Unleash sends a rite: the queue takes it, the ledger hears it, and the button says it is striking', 'S1', async (c) => {
    rideOut();
    try {
      await page.waitFor(`/Fell Grimwald/.test(document.querySelector('.wb-title') ? document.querySelector('.wb-title').textContent : '')`, { what: 'in orbit', timeout: 20000 });
      w.players.get(me.pid).gridAttributes.lastAction = String(w.height - 20);
      ctx.ledger.emitTx([{ type: 'EventPlayer', key: 'player', data: { id: me.pid } }]);
      await page.waitFor(`/^Unleash/.test(document.querySelector('.btn.unleash').innerText.trim()) && !document.querySelector('.btn.unleash').disabled`, { what: 'Unleash ready', timeout: 20000 });
      const before = ctx.ledger.broadcasts || 0;
      ctx.sky.w.lastSigner = null;
      await page.clickSel('.btn.unleash');
      await page.waitFor(`/Striking|Gathering breath/.test(document.querySelector('.btn.unleash').innerText)`, { what: 'the button to say the blow is on its way', timeout: 10000 });
      const t0 = Date.now();
      while ((ctx.ledger.broadcasts || 0) === before && Date.now() - t0 < 25000) await sleep(300);
      expect.ok((ctx.ledger.broadcasts || 0) > before, 'the rite was broadcast to the ledger');
      const paths = ctx.ledger.log.filter((l) => l.at > t0 - 1000).map((l) => l.path);
      expect.ok(paths.some((p) => /simulate/.test(p)), 'the rite was simulated for gas first');
      await page.screenshot(c.evidencePath('after-unleash.png'));
      expect.noErrors(page.errors(ALLOW), 'console');
    } finally { rideHome(); }
  });

  await t.test('Fight on strikes the wisest blow by itself when breath fills, and stops when the fight ends', 'S1', async () => {
    rideOut();
    try {
      await page.waitFor(`/Fell Grimwald/.test(document.querySelector('.wb-title') ? document.querySelector('.wb-title').textContent : '')`, { what: 'in orbit', timeout: 20000 });
      // let any earlier blow finish its way through the queue first
      await page.waitFor(`!/Striking|Gathering/.test(document.querySelector('.btn.unleash').innerText)`, { what: 'no blow in flight', timeout: 30000 }).catch(() => null);
      w.players.get(me.pid).gridAttributes.lastAction = String(w.height - 20);
      ctx.ledger.emitTx([{ type: 'EventPlayer', key: 'player', data: { id: me.pid } }]);
      await sleep(1500);
      const before = ctx.ledger.broadcasts || 0;
      await page.waitFor(`!document.querySelector('.fight-on').hidden`, { what: 'the Fight on switch', timeout: 10000 });
      await page.clickSel('.fight-on');
      expect.eq(await page.eval(`document.querySelector('.fight-on').getAttribute('aria-pressed')`), 'true', 'Fight on is on');
      const t0 = Date.now();
      while ((ctx.ledger.broadcasts || 0) === before && Date.now() - t0 < 25000) await sleep(300);
      expect.ok((ctx.ledger.broadcasts || 0) > before, 'a blow was struck without a press');
    } finally { rideHome(); }
    await page.waitFor(`document.querySelector('.fight-on').getAttribute('aria-pressed') === 'false'`, { what: 'Fight on to rest at home', timeout: 20000 });
  });

  await t.test('a blow that would surely fell your own Elder Wyrm asks for a second press before it is sent', 'S1', async () => {
    const wyrm = me.beasts[0], theirWyrm = foe.beasts[0];
    const was = wyrm.structAttributes.health;
    rideOut();
    try {
      wyrm.structAttributes.health = '2';   // their Wyrm answers for 2: this blow would fell ours
      w.players.get(me.pid).gridAttributes.lastAction = String(w.height - 20);
      ctx.ledger.emitTx([{ type: 'EventPlayer', key: 'player', data: { id: me.pid } }]);
      await page.waitFor(`/Fell Grimwald/.test(document.querySelector('.wb-title')?.textContent || '') && !/Striking|Gathering/.test(document.querySelector('.btn.unleash').innerText)`, { what: 'in orbit, nothing in flight', timeout: 30000 });
      await page.eval(`document.querySelector('[data-key="ours:${wyrm.Struct.id}"]').click()`); await sleep(250);
      await page.eval(`document.querySelector('[data-key="theirs:${theirWyrm.Struct.id}"]').click()`); await sleep(500);
      const verdict = await page.eval(`document.querySelector('.fc-verdict')?.textContent || ''`);
      expect.ok(/would fall/.test(verdict), 'the forecast says the Wyrm would fall', verdict);
      const before = ctx.ledger.broadcasts || 0;
      await page.clickSel('.btn.unleash');
      await sleep(600);
      const label = await page.eval(`document.querySelector('.btn.unleash').innerText.replace(/\\s+/g, ' ')`);
      expect.ok(/Unleash anyway\?/.test(label), 'the first press only asks', label);
      await sleep(2500);
      expect.eq(ctx.ledger.broadcasts || 0, before, 'nothing is sent on the first press');
      await page.clickSel('.btn.unleash');
      const t0 = Date.now();
      while ((ctx.ledger.broadcasts || 0) === before && Date.now() - t0 < 25000) await sleep(300);
      expect.ok((ctx.ledger.broadcasts || 0) > before, 'the second press strikes');
    } finally { wyrm.structAttributes.health = was; rideHome(); }
  });

  await t.test('the fray tells a blow the ledger reports, in the realm’s words, and words rise in the sky', 'S1', async (c) => {
    const harpy = foe.beasts.find((s) => s && s.Struct.type === '5'), wyrm = me.beasts[0];
    const detail = { attackerStructId: harpy.Struct.id, attackerStructTypeId: '5', attackerStructType: 'Starfighter', attackerPlayerId: foe.pid, weaponSystem: 'primaryWeapon', weaponControl: 'guided', attackerHealthBefore: '3', attackerHealthAfter: '1', attackerHealthMax: '3',
      eventAttackShotDetail: [{ targetStructId: wyrm.Struct.id, targetPlayerId: me.pid, targetStructTypeId: '1', targetStructType: 'Command Ship', damageDealt: '2', damage: '2', targetHealthBefore: '6', targetHealthAfter: '4', targetHealthMax: '6', targetCountered: true, targetCounteredDamage: '2' }] };
    ctx.ledger.emitTx([{ type: 'EventAttack', key: 'eventAttackDetail', data: detail }]);
    await page.waitFor(`document.querySelectorAll('.fray-row').length > 0`, { what: 'the fray to tell the blow', timeout: 15000 });
    const row = await page.eval(`document.querySelector('.fray-row').innerText.replace(/\\s+/g, ' ')`);
    expect.ok(/Grimwald’s Harpy strikes your Elder Wyrm/.test(row), 'who struck whom', row);
    expect.ok(/−2 · 4 of 6 left/.test(row) && /Your Elder Wyrm strikes back −2/.test(row), 'what it did and what answered', row);
    await sleep(900);
    await page.screenshot(c.evidencePath('fray.png'));
    // the same blow told again (the live feed can repeat itself) is told once
    ctx.ledger.emitTx([{ type: 'EventAttack', key: 'eventAttackDetail', data: detail }]);
    await sleep(1500);
    expect.eq(await page.eval(`document.querySelectorAll('.fray-row').length`), 1, 'one blow, one line');
  });

  await t.test('the plunder chant waits while their Wyrm guards the isle, and says so (no doomed proofs)', 'S1', async () => {
    rideOut();
    const sent = [];
    const was = ctx.ledger.onBroadcast;
    ctx.ledger.onBroadcast = (hash, raw) => { sent.push(raw); if (was) was(hash, raw); };
    try {
      await page.waitFor(`(await import('/src/pow/pow.ts')).pow.active.some((t) => t.kind === 'raid')`, { what: 'a plunder chant', timeout: 30000 });
      await page.waitFor(`(await import('/src/pow/pow.ts')).pow.active.some((t) => t.kind === 'raid' && t.waits)`, { what: 'the chant to wait on their Wyrm', timeout: 30000 });
      await sleep(4000);
      const raids = sent.filter((r) => Buffer.from(r, 'base64').includes(Buffer.from('MsgPlanetRaidComplete')));
      expect.eq(raids.length, 0, 'no plunder proof is spoken while their Wyrm stands');
    } finally { ctx.ledger.onBroadcast = was; rideHome(); }
  });

  await t.test('without a foe: the war bar says to choose one and points to the Atlas', 'S2', async () => {
    await openGame(page, ctx.app.url, '#/skirmish', { sworn: true, playerId: me.pid });
    await awake(page);
    await sleep(1500);
    const text = await visibleText(page);
    expect.ok(/Choose a hold to raid/.test(text) && /Sky Atlas/.test(text), 'the war bar', text.slice(0, 300));
    expect.ok(!(await page.eval(`document.querySelector('[aria-label="Their hold"]').offsetParent`)), 'their panel is hidden');
    expect.noErrors(page.errors(ALLOW), 'console');
  });

  await t.test('defending: raiders over your isle are the foe, and the war bar says to fell their Wyrm', 'S1', async (c) => {
    const rf = w.fleets.get(foe.fleetId); rf.status = 'away'; rf.locationId = me.planetId;
    const mp = w.planets.get(me.planetId); mp.Planet.locationListStart = rf.id; mp.Planet.locationListCount = '1';
    try {
      await openGame(page, ctx.app.url, '#/skirmish', { sworn: true, playerId: me.pid });
      await awake(page);
      await page.waitFor(`/Raiders over your isle/.test(document.body.innerText)`, { what: 'the defence war bar', timeout: 45000 }).catch(async (e) => { throw new (await import('../lib/report.mjs')).Failure(e.message, [await page.eval(`document.querySelector('.hud').innerText.slice(0, 400)`), ...page.errors().map((x) => x.text.slice(0, 200))]); });
      const text = await visibleText(page);
      expect.includes(text, 'Grimwald', 'the raider is named');
      expect.ok(/Fell Grimwald’s Elder Wyrm and their raid breaks/.test(text), 'what breaks the raid');
      const theirs = await page.eval(`document.querySelectorAll('[aria-label="Their hold"] .item').length`);
      expect.gte(theirs, 1, 'their warband is listed');
      await page.screenshot(c.evidencePath('defending.png'));
    } finally { rf.status = 'onStation'; rf.locationId = foe.planetId; mp.Planet.locationListStart = ''; mp.Planet.locationListCount = '0'; }
    expect.noErrors(page.errors(ALLOW), 'console');
  });
  await page.close();
}
