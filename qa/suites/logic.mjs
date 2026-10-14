/* Game logic, run in the game's own modules: the catalogue the client ships, the realm mapping the
 * scenes use, the tongue every sentence passes through, and the rules that decide what a warden may do. */
import { expect } from '../lib/report.mjs';
import { TYPES } from '../lib/world.mjs';

export default async function (t, ctx) {
  const page = await ctx.newPage();
  await page.goto(ctx.app.url + 'qa/blank.html');
  const m = async (path) => page.eval(`window.__m = window.__m || {}; window.__m[${JSON.stringify(path)}] = await import(${JSON.stringify(path)}); return Object.keys(window.__m[${JSON.stringify(path)}])`);
  await m('/src/lore.ts'); await m('/src/data/catalogue.ts'); await m('/src/realm.ts'); await m('/src/core/util.ts'); await m('/src/world/wyrmkit.js'); await m('/src/game/actions.ts'); await m('/src/game/empire.ts');
  const L = (expr) => page.eval(`const lore = window.__m['/src/lore.ts'], cat = window.__m['/src/data/catalogue.ts'], realm = window.__m['/src/realm.ts'], util = window.__m['/src/core/util.ts'], K = window.__m['/src/world/wyrmkit.js'].default, actions = window.__m['/src/game/actions.ts'], empire = window.__m['/src/game/empire.ts']; ${expr.includes('return') ? expr : 'return (' + expr + ')'}`);

  await t.test('the catalogue has 22 types with the fields the screens read', 'S1', async () => {
    const r = await L(`cat.STRUCT_TYPES.map((x) => [x.id, x.type, x.category, x.maxHealth, x.possibleAmbit, x.buildDraw, x.passiveDraw, x.primaryWeaponAmbits, x.unitDefenses])`);
    expect.eq(r.length, 22, 'types');
    for (const [id, name, cat, hp, amb] of r) { expect.ok(name && cat && hp > 0 && amb > 0, `type ${id} is complete`, r); }
    expect.eq(new Set(r.map((x) => x[1])).size, 22, 'names are unique');
  });
  await t.test('every type has lore (name, epithet, tale) and the lore names match the catalogue', 'S2', async () => {
    const r = await L(`cat.STRUCT_TYPES.map((x) => ({ id: x.id, cat: x.type, l: lore.lore(x.id) }))`);
    for (const x of r) { expect.ok(x.l.name && x.l.epithet && x.l.tale, `type ${x.id} has full lore`); expect.eq(x.l.name, x.cat, `lore name for ${x.id}`); }
  });
  await t.test('an unknown type still has a name and never throws', 'S1', async () => {
    const r = await L(`[lore.lore(99).name, lore.beastName(0), lore.lore(-1).name]`);
    for (const l of r) expect.ok(l && !/undefined|NaN/.test(l), 'fallback name', r);
  });
  await t.test('the scenes’ home realm for every type agrees with the chain’s possible ambit', 'S1', async () => {
    const r = await L(`cat.STRUCT_TYPES.map((x) => ({ id: x.id, scene: K.REALM[x.id], reach: lore.reachOf(x.possibleAmbit) }))`);
    for (const x of r) expect.ok(x.reach.includes(x.scene), `type ${x.id}: scene realm ${x.scene} not in possible ${x.reach}`);
  });
  await t.test('realm names, colours and ambit tables are complete and consistent', 'S1', async () => {
    const r = await L(`lore.REALMS.map((r) => [r, lore.REALM_NAME[r], lore.REALM_COLOR[r], lore.AMBIT_OF_REALM[r], lore.REALM_OF_AMBIT[lore.AMBIT_OF_REALM[r]]])`);
    for (const [realm, name, color, ambit, back] of r) { expect.ok(name && /^#/.test(color) && ambit, `realm ${realm} complete`); expect.eq(back, realm, 'ambit round-trips'); }
  });
  await t.test('reachOf decodes every mask the catalogue uses', 'S1', async () => {
    const r = await L(`[lore.reachOf(2), lore.reachOf(4), lore.reachOf(8), lore.reachOf(16), lore.reachOf(24), lore.reachOf(30), lore.reachOf(32), lore.reachOf(0)]`);
    expect.eq(JSON.stringify(r), JSON.stringify([['deeps'], ['wilds'], ['skies'], ['starfall'], ['starfall', 'skies'], ['starfall', 'skies', 'wilds', 'deeps'], [], []]), 'masks');
  });
  await t.test('the tongue: raw ledger errors come out in the realm’s words', 'S2', async () => {
    const raw = ['planet (2-999) not found', 'fleet 9-12 is away', 'struct 5-1 is offline but must be online for activate', 'not enough energy: capacity 500 W', 'account sequence mismatch', 'insufficient charge', 'Build Ore Extractor', 'Move Command Ship → fleet air 0', 'player (1-5) has no planet', 'guild 0-1 refused', 'wallet locked', 'tx failed: out of gas', 'shield too low', 'reactor 3-1 infusion', 'mempool is full', 'planet (2-3) is empty, nothing to mine', 'rpc error: code = Unknown desc = struct (5-3) is destroyed and cannot activate', 'failed to execute message; message index: 0: fleet 9-2 is away'];
    const out = await L(`${JSON.stringify(raw)}.map((s) => [s, lore.speak(s)])`);
    const forbidden = /\b(planet|fleet|struct|guild|wallet|energy|shield|reactor|mempool|charge|ore|block|tx|chain|player|capacity|power|explore|build|online|offline|stealth|mine|rpc|desc|code =|message index)\b/i;
    const ids = /\b\d+-\d+\b/;
    const bad = out.filter(([, s]) => forbidden.test(s) || ids.test(s)).map((b) => `${b[0]} → ${b[1]}`);
    expect.eq(bad.length, 0, 'sentences that still speak the engine’s tongue', bad);
  });
  // 2026-10-13 playtest: riders read "warband cannot move while queue_full". Every state refusal in the
  // ledger's keeper (errors_structured.go: fleet, planet and struct states) is said in words
  await t.test('the ledger’s state refusals (queue_full, not_active, raid_clock_unset…) come out as plain words', 'S2', async () => {
    const raw = ['rpc error: code = Unknown desc = failed to execute message; message index: 0: fleet (9-12) cannot move while queue_full', 'planet (2-7) cannot move while not_active',
      'fleet (9-3) cannot raid_complete while on_station', 'fleet (9-3) cannot raid_complete while not_first_in_queue', 'planet (2-7) cannot raid_complete while not_active',
      'planet (2-7) cannot raid_complete while raid_clock_unset', 'planet (2-7) cannot raid_complete while shields_active', 'fleet (9-3) cannot build while away', 'fleet (9-3) cannot explore while away',
      'new planet cannot be explored while current planet (2-7) has ore available for mining', 'planet (2-7) cannot mine while under_raid', 'planet (2-7) cannot refine while under_raid',
      'planet (2-7) is already complete, move on bud, no work to be done here', 'struct (5-3) is offline but must be online for readiness_check', 'struct (5-3) is destroyed but must be active for trash',
      'struct (5-3) is online but must be offline for activation', 'struct (5-3) is not_defending but must be defending for defense_clear', 'struct (5-3) is built but must be building for build_cancel',
      'fleet (9-3) needs a command struct before deploy', 'fleet (9-3) needs an online command struct before deploy'];
    const out = await L(`${JSON.stringify(raw)}.map((s) => [s, lore.speak(s), lore.speak(lore.speak(s))])`);
    const forbidden = /\b(planet|fleet|struct|explore|build|online|offline|mine|deploy|bud)\b|\b[a-z]+_[a-z_]+\b|\b\d+-\d+\b/i;
    const bad = out.filter(([, s]) => forbidden.test(s)).map((b) => `${b[0]} → ${b[1]}`);
    expect.eq(bad.length, 0, 'refusals that still speak in codes', bad);
    const unstable = out.filter(([, a, b]) => a !== b).map((b) => `${b[1]} → ${b[2]}`);
    expect.eq(unstable.length, 0, 'retelling a retold refusal changes it', unstable);
    expect.ok(/already hangs over that isle/.test(out[0][1]) && /once it leaves/.test(out[0][1]), 'a full sky says what happened and what to do', out[0][1]);
  });
  await t.test('a ride into a full sky is warned of before it rides; one already there is not', 'S2', async () => {
    await m('/src/realm.ts');
    const r = await L(`const R = window.__m['/src/realm.ts'];
      const isle = (count, extra = '') => ({ Planet: { id: '2-9', locationListCount: String(count), locationListExtra: extra } });
      const rider = { planetId: '2-1', fleet: { status: 'onStation', locationId: '2-1' } };
      return [R.skyFull(isle(0), rider), R.skyFull(isle(1), rider), R.skyFull(isle(1, '1'), rider), R.skyFull(isle(1), { planetId: '2-1', fleet: { status: 'away', locationId: '2-9' } }), R.skyFull(isle(1), { planetId: '2-9', fleet: null }), R.skyFull(null, rider)]`);
    expect.eq(r[0], null, 'an empty sky');
    expect.ok(typeof r[1] === 'string' && /only one raider/.test(r[1]) && !/\b\d+-\d+\b|queue/.test(r[1]), 'a full sky is warned of, plainly', r[1]);
    expect.eq(r[2], null, 'an isle with an extra place still has room');
    expect.eq(r[3], null, 'a warband already there');
    expect.eq(r[4], null, 'riding home');
    expect.eq(r[5], null, 'an isle not read yet');
  });
  // 2026-10-13 playtest: an "Again" tapped twenty minutes late rode a new Wyrm to an isle already plundered
  await t.test('"Again" is offered only for a fresh refusal, and never to seek a new isle blind', 'S1', async () => {
    const r = await L(`const now = Date.now(), job = (o) => ({ id: 'x', status: 'failed', updatedAt: now - 5000, msgs: [{ typeUrl: '/structs.structs.MsgFleetMove', value: {} }], ...o });
      return [actions.canRetry(job({})), actions.canRetry(job({ updatedAt: now - actions.AGAIN_MS - 1000 })), actions.canRetry(job({ status: 'success' })), actions.AGAIN_MS]`);
    expect.eq(r[0], true, 'a refusal just heard may be tried again');
    expect.eq(r[1], false, 'an old one may not');
    expect.eq(r[2], false, 'only a failure');
    expect.lte(r[3], 5 * 60_000, 'the window is short');
  });
  await t.test('one sheaf is a sheaf', 'S3', async () => {
    const r = await L(`[lore.sheaves(1), lore.sheaves(2), lore.sheaves(1200), lore.speak('Raiders took 1 ore'), lore.speak('Raiders took 3 ore')]`);
    expect.eq(JSON.stringify(r), JSON.stringify(['1 sheaf', '2 sheaves', '1,200 sheaves', 'Raiders took 1 sheaf of wildroot', 'Raiders took 3 sheaves of wildroot']), 'sheaves');
  });
  await t.test('the tongue never doubles articles or capitals', 'S3', async () => {
    const out = await L(`['The Build Ore Extractor', 'a Explore', 'Build The Tank', 'a energy'].map((s) => lore.speak(s))`);
    for (const s of out) expect.ok(!/\b(the The|a The|a isle|a alpha)\b/.test(s), 'clean articles: ' + s);
  });
  await t.test('bells read as time a person can feel', 'S2', async () => {
    const r = await L(`[0, 1, 5, 10, 60, 600, 900, 6000, 14400, 100000].map((n) => lore.bellsAsTime(n))`);
    expect.eq(JSON.stringify(r), JSON.stringify(['5 s', '5 s', '30 s', '1 min', '6 min', '60 min', '2 h', '10 h', '24 h', '7 days']), 'bells');
    const odd = r.filter((x) => /^1 (days|mins|hours)$/.test(x)); expect.eq(odd.length, 0, 'plural slips', odd);
  });
  await t.test('chant waits read as a person says them: rough times, the part of the day they end, never only an upper bound', 'S2', async () => {
    await m('/src/ui/chants.ts');
    const r = await page.eval(`const c = window.__m['/src/ui/chants.ts']; const at = (d, hr) => new Date(2026, 9, d, hr), H = 600; return {
      rough: [0, 5, 60, 400, 700, 5600, 10600, 30000].map((n) => c.roughWait(n)),
      when: [c.whenAfter(3 * H, at(14, 15)), c.whenAfter(7 * H, at(14, 15)), c.whenAfter(11 * H, at(14, 15)), c.whenAfter(20 * H, at(14, 15)), c.whenAfter(2 * H, at(14, 2)), c.whenAfter(50 * H, at(14, 15))],
      ripe: [c.ripeWhen(300), c.ripeWhen(9 * H)], zeros: c.quickZeros(), delve: c.chantTime(14000), brew: c.chantTime(28000), wyrm: c.chantTime(200) }`);
    expect.eq(JSON.stringify(r.rough), JSON.stringify(['~1 min', '~1 min', '~6 min', '~40 min', '~1 h', '~9 h', '~18 h', '~2 days']), 'rough waits', r.rough);
    expect.eq(JSON.stringify(r.when), JSON.stringify(['this evening', 'tonight', 'late tonight', 'tomorrow morning', 'before dawn', 'Friday evening']), 'when a wait ends', r.when);
    expect.eq(r.ripe[0], 'ripe in ~30 min', 'a short wait');
    expect.ok(/^ripe .+ \(~9 h\)$/.test(r.ripe[1]), 'a long wait says when, and about how long: ' + r.ripe[1]);
    expect.ok(r.zeros >= 4 && r.zeros <= 12, 'what a device finds in a minute', r.zeros);
    // the old panel showed the bound for a chant of no strength at all ("~26 h", "~2 days")
    const h = (s) => Number((s.match(/^~(\d+) h$/) || [])[1]);
    expect.ok(h(r.delve) >= 5 && h(r.delve) <= 15 && h(r.brew) >= 10 && h(r.brew) <= 26, 'a delve takes about half a day and a brew most of a day', r);
    expect.ok(/min$/.test(r.wyrm), 'an Elder Wyrm hatches in minutes', r.wyrm);
  });
  await t.test('mana, alpha, breath and hearts format as the Grimoire says', 'S2', async () => {
    const r = await L(`[lore.fmtMana(75000), lore.fmtMana(2275000), lore.fmtAlpha(122000000n), lore.fmtAlpha(1500n), lore.fmtBreath(5), lore.fmtBreath(99), lore.fmtBreath(240), util.formatAlpha('999950000'), util.formatPower('999960'), util.formatPower('0')]`);
    expect.eq(JSON.stringify(r), JSON.stringify(['75', '2,275', '122', '0.002', '5', 'full', 'full', '1.0 kg', '1 kW', '0 W']), 'formats');
  });
  await t.test('chant difficulty falls with age and the clocks agree with each other', 'S1', async () => {
    const r = await L(`const d = [1, 2, 10, 100, 1000, 5000].map((a) => util.powDifficulty(a, 5000)); return { d, age: util.powAgeFor(10, 5000), back: util.powDifficulty(util.powAgeFor(10, 5000), 5000) }`);
    for (let i = 1; i < r.d.length; i++) expect.lte(r.d[i], r.d[i - 1], 'difficulty is monotone');
    expect.lte(r.back, 10, 'ageFor(target) reaches the target');
  });
  await t.test('event payloads name the objects they touch (routing of live events)', 'S1', async () => {
    const r = await L(`[empire.touchedIds('EventStruct', { structure: { id: '5-9', owner: '1-7', locationId: '9-7' } }), empire.touchedIds('EventGrid', { gridRecord: { attributeId: '0-1-7', value: '3' } }), empire.touchedIds('EventRaid', { eventRaidDetail: { planetId: '2-3', fleetId: '9-8' } }), empire.touchedIds('EventAttack', { eventAttackDetail: { attackerStructId: '5-1', eventAttackShotDetail: [{ targetStructId: '5-2', targetPlayerId: '1-2' }] } }), empire.touchedIds('Weird', null)]`);
    expect.eq(JSON.stringify(r), JSON.stringify([['5-9', '1-7', '9-7'], ['1-7'], ['2-3', '9-8'], ['5-1', '5-2', '1-2'], []]), 'ids');
  });
  await t.test('units of a warden: fallen and abroad beasts are left off the isle, hallows keep their plots', 'S1', async () => {
    const r = await L(`
      const mk = (id, typeId, o) => ({ id, typeId, type: cat.typeOf(typeId), ambit: o.ambit || 'land', slot: o.slot || 0, built: o.built !== false, online: o.online !== false, destroyed: !!o.destroyed, hidden: false, locationId: 'x', locationType: 'x', health: 3, status: 7, materialized: true, locked: false, blockStartBuild: 0, blockStartOreMine: 0, blockStartOreRefine: 0, defenders: [], protectedStructIndex: 0, ore: 0 });
      const structs = new Map([['5-1', mk('5-1', 1, { ambit: 'air' })], ['5-2', mk('5-2', 10, {})], ['5-3', mk('5-3', 13, { destroyed: true })], ['5-4', mk('5-4', 14, { slot: 2 })], ['5-5', mk('5-5', 15, { ambit: 'water', slot: 1 })], ['5-6', mk('5-6', 7, { built: false })], ['5-7', mk('5-7', 9, { online: false })]]);
      const p = { structs, fleet: { status: 'onStation' } };
      const home = realm.unitsOf(p); const away = realm.unitsOf({ structs, fleet: { status: 'away' } });
      return { home, away, realmOfSpace: realm.realmOf({ ambit: 'space' }), realmOfOdd: realm.realmOf({ ambit: 'lava' }) }`);
    expect.eq(r.home.length, 6, 'home units (the fallen one off)');
    expect.ok(r.home.find((u) => u.id === '5-4').plot === 2 && r.home.find((u) => u.id === '5-5').plot === 5, 'hallow plots (water + 4)');
    expect.ok(r.home.find((u) => u.id === '5-6').building && r.home.find((u) => u.id === '5-7').offline, 'building and offline flags');
    expect.eq(r.away.length, 2, 'only hallows while the warband is abroad');
    expect.eq(r.realmOfSpace, 'starfall', 'space is Starfall'); expect.eq(r.realmOfOdd, 'wilds', 'an unknown ambit falls to the Wilds');
  });
  await t.test('verbs: what a beast may do in each state, and why a summoning is refused', 'S1', async () => {
    const r = await L(`
      const base = { id: '5-1', typeId: 6, type: cat.typeOf(6), built: true, online: true, hidden: false, destroyed: false, protectedStructIndex: 0 };
      const ids = (s) => actions.verbsFor({}, s).map((v) => v.id);
      const p = { online: true, fleet: { status: 'onStation', commandStruct: '5-0' }, structs: new Map([['5-0', { destroyed: false, online: true }]]), load: 100n, structsLoad: 100n, capacity: 10000000n, connectionCapacity: 0n };
      return { awake: ids(base), asleep: ids({ ...base, online: false }), veiled: ids({ ...base, hidden: true }), building: ids({ ...base, built: false }), fallen: ids({ ...base, destroyed: true }), guarding: ids({ ...base, protectedStructIndex: 4 }),
        ok: actions.buildBlock(p, cat.typeOf(14)), tooHungry: actions.buildBlock(p, cat.typeOf(22)), abroad: actions.buildBlock({ ...p, fleet: { status: 'away' } }), overdrawn: actions.buildBlock({ ...p, online: false }), noWyrm: actions.buildBlock({ ...p, structs: new Map() }) }`);
    expect.eq(JSON.stringify(r.awake), JSON.stringify(['off', 'stealth']), 'awake Shade Owl');
    expect.eq(JSON.stringify(r.asleep), JSON.stringify(['on', 'stealth']), 'asleep');
    expect.eq(JSON.stringify(r.veiled), JSON.stringify(['off', 'unstealth']), 'veiled');
    expect.eq(JSON.stringify(r.building), JSON.stringify(['cancel']), 'building'); expect.eq(r.fallen.length, 0, 'fallen'); expect.ok(r.guarding.includes('undefend'), 'guarding');
    expect.eq(r.ok, null, 'a Delver may be summoned');
    expect.includes(r.tooHungry, 'spare mana', 'the Worldroot is too hungry');
    for (const k of ['tooHungry', 'abroad', 'overdrawn', 'noWyrm']) { expect.ok(typeof r[k] === 'string' && r[k].length > 10, `${k} refused with a reason`); expect.ok(!/\b\d+-\d+\b/.test(r[k]), `${k} reason has no ledger id: ${r[k]}`); }
  });
  await t.test('a free circle honours each realm’s slots and queued summonings', 'S1', async () => {
    const r = await L(`const p = { playerId: '1-7', planet: { Planet: { land: ['5-1', '', '5-3'], landSlots: '3', water: ['', ''], waterSlots: '2', space: [], spaceSlots: '0', air: [], airSlots: '0' } }, fleet: { land: ['5-9', ''], landSlots: '2', space: ['', ''], spaceSlots: '2', air: [], airSlots: '0', water: [], waterSlots: '0' } }; return [realm.freeCircle(p, cat.typeOf(14)), realm.freeCircle(p, cat.typeOf(16)), realm.freeCircle(p, cat.typeOf(10)), realm.freeCircle(p, cat.typeOf(2)), realm.freeCircle({ ...p, planet: null }, cat.typeOf(14))]`);
    expect.eq(JSON.stringify(r), JSON.stringify([{ ambit: 'land', slot: 1 }, null, { ambit: 'land', slot: 1 }, { ambit: 'space', slot: 0 }, null]), 'circles');
  });
  if (ctx.net) await t.test('the shipped catalogue matches the public ledger’s struct types (numbers, not names)', 'S1', async () => {
    const r = await fetch('https://public.testnet.structs.network/structs/struct_type?pagination.limit=100', { signal: AbortSignal.timeout(20000) }).then((x) => x.json());
    const live = r.StructType || [];
    expect.eq(live.length, TYPES.length, 'type count');
    const skip = new Set(['type', 'class', 'classAbbreviation', 'defaultCosmeticModelNumber', 'defaultCosmeticName']);
    const diffs = [];
    for (const l of live) { const b = TYPES.find((x) => String(x.id) === String(l.id)); if (!b) { diffs.push(`type ${l.id} missing`); continue; } for (const k of Object.keys(l)) if (!skip.has(k) && String(l[k]) !== String(b[k])) diffs.push(`type ${l.id}.${k}: ledger ${l[k]} ≠ shipped ${b[k]}`); }
    expect.eq(diffs.length, 0, 'drift between the ledger and the shipped catalogue', diffs);
  });
  await page.close();
}
