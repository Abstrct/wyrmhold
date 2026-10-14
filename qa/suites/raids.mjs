/* Raids on your hold: being raided must never be invisible. On 2026-10-13 five of seven playtesters lost
 * an Elder Wyrm, beasts or wildroot while away or abroad, and the game never said who did it or what was
 * taken: the Chronicle only listed their own rites, the Defend herald vanished before it could be pressed,
 * the welcome back said only that the Wyrm kept watch, and a screen reader heard "your beast.Defend".
 * These checks keep what fixed it: the Chronicle tells what others did by name, "While you were away"
 * tells what happened with the page closed (read back from the ledger's search), an alert stays on every
 * screen while raiders hang over your isle, and a raider can be raided back. */
import { expect } from '../lib/report.mjs';
import { openGame, awake, go, ALLOW, sleep } from '../lib/game.mjs';
import { typeOf, raid } from '../lib/world.mjs';

const IDS = /(?:^|[^\w.])(\d+-\d+)(?![\w-])/g;
const ENGINE = /\b(structs?|planets?|fleets?|guilds?|wallet|energy|players?|ore|command ship|battleship|starfighter|tank|destroyer|undefined|NaN|null)\b/i;

export default async function (t, ctx) {
  const page = await ctx.newPage();
  const { w, me, foe } = ctx.sky;
  const L = ctx.ledger;
  const [, , sprite, , myHarpy] = me.beasts;
  const myWyrm = me.beasts[0];
  const [, theirHarpy, theirTroll, theirKraken] = foe.beasts;

  /* the ledger's own words for each deed (shapes as the devnet node emits them) */
  const shotAt = (target, { damage = 2, fell = false, evaded = false } = {}) => {
    const max = typeOf(Number(target.Struct.type)).maxHealth;
    return { targetStructId: target.Struct.id, targetPlayerId: target.Struct.owner, targetStructTypeId: target.Struct.type, targetStructType: typeOf(Number(target.Struct.type)).type,
      targetStructLocationType: target.Struct.locationType, targetStructLocationId: target.Struct.locationId, evaded, evadedCause: evaded ? 'signalJamming' : 'noUnitDefenses', blocked: false,
      blockedByStructId: '', blockedByStructTypeId: '0', blockerDestroyed: false, damageDealt: String(evaded ? 0 : damage), damage: String(evaded ? 0 : damage), targetDestroyed: fell,
      targetHealthBefore: String(max), targetHealthAfter: String(fell ? 0 : evaded ? max : Math.max(0, max - damage)), targetHealthMax: String(max) };
  };
  const attack = (striker, shots) => ({ type: 'EventAttack', key: 'eventAttackDetail', data: { attackerStructId: striker.Struct.id, attackerStructTypeId: striker.Struct.type, attackerStructType: typeOf(Number(striker.Struct.type)).type,
    attackerStructLocationType: striker.Struct.locationType, attackerStructLocationId: striker.Struct.locationId, weaponSystem: 'primaryWeapon', eventAttackShotDetail: shots, attackerPlayerId: striker.Struct.owner } });
  const raidEv = (status, seized = 0) => ({ type: 'EventRaid', key: 'eventRaidDetail', data: { fleetId: foe.fleetId, planetId: me.planetId, status, seized_ore: String(seized) } });
  const fleetEv = (away) => ({ type: 'EventFleet', key: 'fleet', data: { id: foe.fleetId, owner: foe.pid, locationType: 'planet', locationId: away ? me.planetId : foe.planetId, status: away ? 'away' : 'onStation' } });
  const theft = (n) => ({ type: 'EventOreTheft', key: 'eventOreTheftDetail', data: { victimPlayerId: me.pid, thiefPlayerId: foe.pid, amount: String(n) } });
  /** Strike one rite a bell after the last, as the node would. */
  const strike = async (events) => { L.emitTx(events); await sleep(1100); };

  const chronicle = () => page.eval(`(document.querySelector('[aria-label=Chronicle]') || {}).innerText || ''`);
  const leaks = (text) => ({ ids: [...text.matchAll(IDS)].map((m) => m[1]).filter((id) => !new RegExp(`Warden ${id}`).test(text)), words: text.match(ENGINE) });
  const swearWithWords = async () => {
    // a soulstone sealed by a passphrase survives a reload with no device-key race (see the data suite)
    await page.eval(`const { wallet } = await import('/src/wallet/wallet.ts'); const { newMnemonic } = await import('/src/wallet/keys.ts'); await wallet.create(newMnemonic(24), 'qa-raids'); await wallet.resolvePlayers(); return true`);
    await page.waitFor(`(await import('/src/game/empire.ts')).empire.commander?.playerId === ${JSON.stringify(me.pid)}`, { what: 'the sworn warden to be read', timeout: 60000 });
  };
  const holdReady = () => page.waitFor(`document.querySelectorAll('.roster-panel .item').length > 5`, { what: 'the roster', timeout: 60000 });

  await t.test('while the Hold is open, a raid and blows from a foe are told in the Chronicle by name, once each, with a way to raid them back', 'S1', async (c) => {
    await openGame(page, ctx.app.url, '#/hold', { sworn: true, playerId: me.pid });
    await awake(page); await holdReady();
    // the first reading back is done before the foe moves (the record knows what came before)
    await page.waitFor(`localStorage.getItem('wyrmhold.away.${me.pid}')`, { what: 'the hold to be read back', timeout: 90000 });
    await strike([raidEv('initiated'), fleetEv(true)]);
    await strike([attack(theirTroll, [shotAt(sprite, { damage: 3, fell: true })])]);
    await strike([attack(theirHarpy, [shotAt(myHarpy, { evaded: true })])]);
    await strike([theft(2), raidEv('raidSuccessful', 2)]);
    const want = ['Grimwald’s warband came to plunder your isle.', 'Grimwald’s Stone Troll felled your Comet Sprite.', 'Your Harpy turned aside a blow from Grimwald’s Harpy.', 'Grimwald’s warband plundered your isle: 2 sheaves of wildroot carried off.'];
    await page.waitFor(`(() => { const t = (document.querySelector('[aria-label=Chronicle]') || {}).innerText || ''; return ${JSON.stringify(want)}.every((w) => t.includes(w)); })()`, { what: 'the Chronicle to tell each deed by name', timeout: 60000 })
      .catch(async (e) => { throw new (await import('../lib/report.mjs')).Failure(e.message, [await chronicle()]); });
    let text = await chronicle();
    const l = leaks(text);
    expect.eq(l.ids.length, 0, 'ledger marks in the Chronicle', l.ids);
    expect.ok(!l.words, 'engine words in the Chronicle', l.words);
    // a fallen beast is heard, not only seen (a herald, polite, or the quiet voice)
    const heard = await page.eval(`[...document.querySelectorAll('#heralds .herald, [data-voice=harm]')].map((e) => e.textContent).join(' | ')`);
    expect.ok(/felled your Comet Sprite/.test(heard), 'the Comet Sprite’s fall is told aloud', heard);
    // the live feed and the ledger's search overlap: reading back again tells nothing twice
    await page.eval(`await (await import('/src/game/raidlog.ts')).readAgain(); return true`);
    await sleep(1500);
    text = await chronicle();
    expect.eq(text.split('plundered your isle').length - 1, 1, 'the plunder is told once, though heard live and read back');
    const back = await page.eval(`[...document.querySelectorAll('[aria-label=Chronicle] .raid-back')].map((b) => ({ text: b.textContent, label: b.getAttribute('aria-label') }))`);
    expect.eq(back.length, 1, 'one way back at the raider', back);
    expect.eq(back[0].label, 'Raid Grimwald back', 'the button says whom it rides against');
    await page.screenshot(c.evidencePath('chronicle.png'));
    await strike([raidEv('attackerRetreated'), fleetEv(false)]);
    await page.waitFor(`/Grimwald’s warband rode home without plunder/.test(document.querySelector('[aria-label=Chronicle]').innerText)`, { what: 'the retreat to be told', timeout: 15000 });
    await page.clickSel('[aria-label=Chronicle] .raid-back');
    await page.waitFor(`document.body.dataset.route === 'skirmish'`, { what: 'the Skirmish', timeout: 15000 });
    const at = await page.eval(`location.hash + location.pathname + location.search`);
    expect.includes(at, foe.pid, 'the raid back rides against the raider');
    expect.noErrors(page.errors(ALLOW), 'console');
  });

  await t.test('with the page closed, a raid lands; on coming back "While you were away" names the raider, the loss and the wildroot taken, and offers to raid them back', 'S1', async (c) => {
    const grid = w.players.get(me.pid).gridAttributes, rec = w.gridRecords.find((g) => g.attributeId === `0-1-${me.pid.split('-')[1]}`);
    const oreWas = grid.ore;
    try {
      await openGame(page, ctx.app.url, '#/hold');
      await swearWithWords();
      await holdReady();
      // the first visit in this browser only starts the sketch of the hold
      await page.waitFor(`localStorage.getItem('wyrmhold.away.${me.pid}')`, { what: 'the first sketch of the hold', timeout: 90000 });
      expect.ok(await page.eval(`document.querySelector('.away-card').hidden`), 'nothing to tell on a first visit');
      // the warden closes the page
      await page.goto(ctx.app.url + 'qa/blank.html', { timeout: 120000 });
      await sleep(1100);
      await strike([raidEv('initiated'), fleetEv(true)]);
      await strike([attack(theirKraken, [shotAt(myWyrm, { damage: 6, fell: true })])]);
      grid.ore = '0'; if (rec) rec.value = 0;
      await strike([theft(2), raidEv('raidSuccessful', 2)]);
      await strike([raidEv('attackerRetreated'), fleetEv(false)]);
      // and comes back, landing on the Gate as a returning warden does: its welcome says it in one line
      await page.goto(ctx.app.url + '?again=1#/', { timeout: 120000 });
      await page.waitFor(`!document.getElementById('boot') || document.getElementById('boot').classList.contains('gone')`, { what: 'the boot veil', timeout: 90000 });
      await page.waitFor(`/While you were away: Grimwald plundered your isle and your Elder Wyrm fell/.test(document.querySelector('.gate-welcome')?.textContent || '')`, { what: 'the welcome to carry the news', timeout: 90000 })
        .catch(async (e) => { throw new (await import('../lib/report.mjs')).Failure(e.message, [await page.eval(`document.querySelector('.gate-welcome')?.textContent || ''`), await page.eval(`localStorage.getItem('wyrmhold.raidlog.${me.pid}')`)]); });
      expect.eq(await page.eval(`document.querySelector('.gate-welcome').getAttribute('aria-live')`), 'polite', 'the welcome is heard politely');
      await page.screenshot(c.evidencePath('gate-welcome.png'));
      await go(page, '#/hold');
      await page.waitFor(`(() => { const e = document.querySelector('.away-card'); return e && !e.hidden && /Grimwald/.test(e.innerText) && /Raid them back/.test(e.innerText); })()`, { what: 'the While-you-were-away card', timeout: 90000 })
        .catch(async (e) => { throw new (await import('../lib/report.mjs')).Failure(e.message, [await page.eval(`(document.querySelector('.away-card') || {}).outerHTML || 'no card'`)]); });
      const card = await page.eval(`const e = document.querySelector('.away-card'); return { text: e.innerText, role: e.getAttribute('role'), head: document.getElementById(e.getAttribute('aria-labelledby'))?.textContent, back: [...e.querySelectorAll('.raid-back')].map((b) => b.getAttribute('aria-label')) }`);
      expect.eq(card.role, 'region', 'a region a screen reader can find');
      expect.eq(card.head, 'While you were away', 'named by its heading');
      expect.includes(card.text, 'Grimwald plundered your isle and your Elder Wyrm fell', 'the lead says who and what');
      expect.includes(card.text, '2 sheaves of wildroot carried off', 'the wildroot taken');
      expect.includes(card.text, 'Grimwald’s Kraken felled your Elder Wyrm', 'the loss, by whom');
      expect.ok(!/delved/.test(card.text), 'no wildroot is said to be delved when it was only carried off', card.text);
      expect.ok(card.back.includes('Raid Grimwald back'), 'a way to raid them back', card.back);
      const l = leaks(card.text);
      expect.eq(l.ids.length, 0, 'ledger marks on the card', l.ids);
      expect.ok(!l.words, 'engine words on the card', l.words);
      // heard once: the Gate's polite welcome said it, so the card does not say it again
      await sleep(1000);
      expect.eq(await page.eval(`document.querySelector('.gate-welcome') ? 'gate' : 'hold'`), 'hold', 'on the Hold now');
      expect.ok(!/While you were away/.test(await page.eval(`(document.querySelector('[data-voice=harm]') || {}).textContent || ''`)), 'the card is not heard a second time');
      await page.screenshot(c.evidencePath('away-card.png'));
      await page.clickSel('.away-card [data-key=away-done]');
      await sleep(400);
      const after = await page.eval(`({ hidden: document.querySelector('.away-card').hidden, focus: document.activeElement && document.activeElement !== document.body ? (document.activeElement.getAttribute('aria-label') || document.activeElement.className) : null })`);
      expect.ok(after.hidden, 'Got it puts the card away');
      expect.ok(after.focus, 'focus lands somewhere sensible, not on the page', after);
      // told once: a reload does not tell it again
      await page.goto(ctx.app.url + '?again=2#/hold', { timeout: 120000 });
      await page.waitFor(`!document.getElementById('boot') || document.getElementById('boot').classList.contains('gone')`, { what: 'the boot veil', timeout: 90000 });
      await holdReady();
      await page.waitFor(`/Grimwald’s Kraken felled your Elder Wyrm/.test((document.querySelector('[aria-label=Chronicle]') || {}).innerText || '')`, { what: 'the Chronicle to be read back', timeout: 60000 });
      await sleep(4000);
      expect.ok(await page.eval(`document.querySelector('.away-card').hidden`), 'the same news is not told twice');
      expect.noErrors(page.errors(ALLOW), 'console');
    } finally { grid.ore = oreWas; if (rec) rec.value = Number(oreWas); }
  });

  await t.test('while raiders hang over your isle a Defend alert stays on every screen until they leave', 'S1', async (c) => {
    const rf = w.fleets.get(foe.fleetId), mp = w.planets.get(me.planetId);
    try {
      await openGame(page, ctx.app.url, '#/atlas', { sworn: true, playerId: me.pid });
      await awake(page);
      raid(w, foe.pid, me.pid);
      await strike([raidEv('initiated'), fleetEv(true)]);
      // (a fixed element has no offsetParent: measure it instead)
      const shown = `(() => { const e = document.querySelector('.raid-alert'); return !!e && !e.hidden && e.getClientRects().length > 0 && e.getBoundingClientRect().width > 0; })()`;
      await page.waitFor(shown, { what: 'the Defend alert on the Atlas', timeout: 60000 });
      const a = await page.eval(`const e = document.querySelector('.raid-alert'); const b = e.querySelector('button'); return { text: e.innerText, live: e.getAttribute('aria-live'), label: e.getAttribute('aria-label'), button: b.textContent, name: b.getAttribute('aria-label') }`);
      expect.includes(a.text, 'Grimwald’s warband hangs over your isle', 'it names the raider');
      expect.eq(a.button, 'Defend', 'a Defend button');
      expect.includes(a.name, 'Grimwald', 'the button is named for whom it defends against');
      expect.ok(!a.live, 'the alert is not a live region that re-speaks itself (the voice says it once)');
      await page.screenshot(c.evidencePath('alert-atlas.png'));
      // longer than the old herald lived
      await sleep(12000);
      expect.ok(await page.eval(shown), 'still there after twelve seconds');
      await go(page, '#/grimoire');
      await page.waitFor(shown, { what: 'the alert in the Grimoire', timeout: 10000 });
      // the warden's own Hold says it in its notices, with its own Defend
      await go(page, '#/hold');
      await page.waitFor(`/Raiders hang over your isle/.test(document.querySelector('.hold-omens')?.innerText || '')`, { what: 'the Hold’s raiders notice', timeout: 30000 });
      expect.ok(!(await page.eval(shown)), 'no second alert over the Hold’s own notice');
      await go(page, '#/leyweave');
      await page.waitFor(shown, { what: 'the alert on the Leyweave', timeout: 10000 });
      await page.screenshot(c.evidencePath('alert-leyweave.png'));
      // Defend goes to the Skirmish against the raider
      await page.clickSel('.raid-alert button');
      await page.waitFor(`(async () => (await import('/src/core/nav.ts')).here() === ${JSON.stringify('/skirmish/' + foe.pid)} || (document.body.dataset.route === 'skirmish' && (location.hash + location.search).includes(${JSON.stringify(foe.pid)})))()`, { what: 'Defend to lead to the Skirmish against the raider', timeout: 15000 });
      // the raid ends: the alert goes
      await go(page, '#/atlas'); await sleep(500);
      rf.status = 'onStation'; rf.locationId = foe.planetId; mp.Planet.locationListStart = ''; mp.Planet.locationListCount = '0'; mp.planetAttributes.blockStartRaid = '0';
      await strike([raidEv('attackerRetreated'), fleetEv(false)]);
      await page.waitFor(`(() => { const e = document.querySelector('.raid-alert'); return !e || e.hidden; })()`, { what: 'the alert to go when the raiders leave', timeout: 60000 });
      expect.noErrors(page.errors(ALLOW), 'console');
    } finally { rf.status = 'onStation'; rf.locationId = foe.planetId; mp.Planet.locationListStart = ''; mp.Planet.locationListCount = '0'; mp.planetAttributes.blockStartRaid = '0'; }
  });

  await t.test('every deed the ledger tells is read and said in the realm’s words: guards, dodges, falls, answers, and each stage of a raid', 'S1', async () => {
    const guarded = { ...shotAt(myWyrm, { damage: 2 }), blocked: true, blockedByStructId: me.beasts[8].Struct.id, blockedByStructTypeId: '9', blockerDestroyed: true };
    const answered = { ...attack(myHarpy, [{ ...shotAt(theirTroll, { damage: 1 }), targetCountered: true, targetCounterDestroyedAttacker: true }]) };
    const stranger = { type: 'EventRaid', key: 'eventRaidDetail', data: { fleetId: '9-999', planetId: me.planetId, status: 'raidSuccessful', seized_ore: '1' } };
    const r = await page.eval(`
      const { __deeds } = await import('/src/game/raidlog.ts');
      const { harmLine } = await import('/src/ui/harm.ts');
      const ev = (e) => ({ type: e.type, data: e.data });
      const isles = { ${JSON.stringify(me.planetId)}: ${JSON.stringify(me.pid)} };
      const read = (events, hash) => __deeds(events.map(ev), hash, 1200, [${JSON.stringify(me.pid)}], isles).map((h) => ({ key: h.key, foe: h.foe || null, line: harmLine(h) }));
      return {
        guard: read([${JSON.stringify(attack(theirKraken, [guarded]))}], 'G'),
        answer: read([${JSON.stringify(answered)}], 'X'),
        stages: ['initiated', 'shieldsVulnerable', 'raidSuccessful', 'attackerDefeated', 'attackerRetreated'].flatMap((s, i) => read([{ type: 'EventFleet', data: { id: ${JSON.stringify(foe.fleetId)}, owner: ${JSON.stringify(foe.pid)} } }, { type: 'EventRaid', data: { fleetId: ${JSON.stringify(foe.fleetId)}, planetId: ${JSON.stringify(me.planetId)}, status: s, seized_ore: s === 'raidSuccessful' ? '3' : '0' } }], 'S' + i)),
        stranger: read([${JSON.stringify(stranger)}], 'U'),
        ours: read([{ type: 'EventRaid', data: { fleetId: ${JSON.stringify(me.fleetId)}, planetId: ${JSON.stringify(foe.planetId)}, status: 'raidSuccessful', seized_ore: '2' } }], 'O'),
      };`);
    expect.eq(r.guard.length, 1, 'one blow, one deed', r.guard);
    expect.eq(r.guard[0].line, 'Your Stone Troll fell guarding your Elder Wyrm from Grimwald’s Kraken.', 'a guard that fell is told');
    expect.eq(r.answer.length, 1, 'our striker felled by the answer is a deed', r.answer);
    expect.eq(r.answer[0].line, 'Your Harpy fell striking Grimwald’s Stone Troll.', 'the answer is told');
    expect.eq(JSON.stringify(r.stages.map((s) => s.line)), JSON.stringify([
      'Grimwald’s warband came to plunder your isle.',
      'Grimwald’s warband broke your ward: your isle lay open to their plunder.',
      'Grimwald’s warband plundered your isle: 3 sheaves of wildroot carried off.',
      'Grimwald’s Elder Wyrm fell over your isle: their raid is broken.',
      'Grimwald’s warband rode home without plunder.',
    ]), 'every stage of a raid, by name');
    expect.ok(r.stages.every((s) => s.foe === foe.pid), 'the raider is known from the rite itself', r.stages);
    expect.eq(r.stranger.length, 1, 'a raid by a warband the rite does not name is still kept', r.stranger);
    expect.eq(r.stranger[0].foe, null, 'and its warden is not guessed from the warband’s mark');
    expect.ok(/^A raider’s warband plundered your isle: 1 sheaf of wildroot/.test(r.stranger[0].line), 'an unknown raider is "a raider" until the ledger says who', r.stranger[0].line);
    expect.eq(r.ours.length, 0, 'our own raids on others are not harm done to us');
    // the keys the live feed and the ledger's search share
    expect.ok(r.stages.every((s, i) => s.key.startsWith('S' + i + ':')), 'deeds are known by their rite', r.stages.map((s) => s.key));
  });

  await t.test('a herald with a button is heard as its words, then a separately named button', 'S2', async () => {
    await page.eval(`const { toast } = await import('/src/core/dom.ts'); toast('A raider strikes your beast.', 'enemy', 6000, { label: 'Defend', run: () => {} }); return true`);
    await sleep(200);
    const r = await page.eval(`const e = [...document.querySelectorAll('#heralds .herald')].find((x) => /A raider strikes your beast/.test(x.textContent)); const b = e.querySelector('button'); return { text: e.textContent, button: b.textContent, label: b.getAttribute('aria-label') }`);
    expect.ok(/beast\. Defend$/.test(r.text), 'the words end before the button begins', r.text);
    expect.eq(r.button, 'Defend', 'the button has its own name');
  });
  await page.close();
}
