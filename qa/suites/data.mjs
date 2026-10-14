/* Data channels: what the client reads from a guild's own API (signed in through the relay) and what
 * it hears on GRASS, the guild indexer's stream, beside the ledger node it reads otherwise.
 * This suite serves the game a second time with the relay on and GRASS followed from the coven's
 * guild.json, as `vite` does in development; every other suite reads the ledger node alone. */
import { expect } from '../lib/report.mjs';
import { openGame, go, visibleText, ALLOW, sleep } from '../lib/game.mjs';
import { Failure } from '../lib/report.mjs';
import { startApp } from '../lib/app.mjs';

export default async function (t, ctx) {
  const L = ctx.ledger, sky = ctx.sky, w = sky.w;
  const app = await startApp({ port: 5197, lcdUrl: L.lcdUrl, wsUrl: L.wsUrl, env: { VITE_RELAY_URL: '', VITE_GRASS_URL: '', STRUCTS_LCD: L.lcdUrl, RELAY_ALLOW_LOCAL: '1' } });
  const page = await ctx.newPage();
  const since = (at) => ({ lcd: L.log.filter((r) => r.at >= at), api: L.guildReads.filter((r) => r.at >= at) });
  const setOre = (pid, ore) => {
    const idx = pid.split('-')[1];
    w.players.get(pid).gridAttributes.ore = String(ore);
    const rec = w.gridRecords.find((g) => g.attributeId === `0-1-${idx}`);
    if (rec) rec.value = ore; else w.gridRecords.push({ attributeId: `0-1-${idx}`, value: ore });
  };
  const gridMsg = (pid, attr, value) => L.emitGrass(`structs.grid.player.${pid}.${pid}`, { category: attr, object_id: pid, object_type: 'player', player_id: pid, attribute_type: attr, value_p: value, value, updated_at: new Date().toISOString() });
  const brannoc = sky.fill[1];

  try {
    await t.test('a sworn warden is signed in at their own coven’s API with a valid seal, through the relay', 'S1', async () => {
      const at = Date.now();
      // a soulstone sealed by a passphrase: the device key store (and its race with a first shader
      // compile on a loaded machine) plays no part in what this suite proves
      await openGame(page, app.url, '#/hold');
      await page.eval(`const { wallet } = await import('/src/wallet/wallet.ts'); const { newMnemonic } = await import('/src/wallet/keys.ts'); await wallet.create(newMnemonic(24), 'qa-data-passphrase'); await wallet.resolvePlayers(); return true`);
      await page.waitFor(`(await import('/src/game/empire.ts')).empire.commander?.playerId === ${JSON.stringify(sky.me.pid)}`, { what: 'the sworn warden to be read', timeout: 60000 });
      await go(page, '#/atlas');
      await page.waitFor(`document.querySelectorAll('[aria-label="Wardens"] .list .item').length > 5`, { what: 'the atlas list', timeout: 40000 });
      const logins = L.logins.filter((l) => l.at >= at);
      expect.ok(logins.length >= 1, 'the coven was asked to sign the warden in', JSON.stringify(logins));
      expect.ok(logins.every((l) => l.valid && l.fresh && l.member && l.gid === sky.guilds.hearth.id), 'every sign-in was sealed by the warden’s key, fresh, at their own coven', JSON.stringify(logins));
      expect.ok(logins.length <= 2, 'signed in once, not on every read', `${logins.length} sign-ins`);
    });

    await t.test('the Atlas reads every warden’s wildroot and bell from the coven’s API, not the ledger node’s grid pages', 'S1', async () => {
      const at = Date.now();
      await page.eval(`(await import('/src/realm.ts')).omenSight(true).then((m) => m.size)`);
      const s = since(at);
      expect.ok(s.api.some((r) => /grid\/attribute-type\/ore\/object-type\/player/.test(r.rest)), 'wildroot from the API', JSON.stringify(s.api.map((r) => r.rest)));
      expect.ok(s.api.some((r) => /grid\/attribute-type\/lastAction\/object-type\/player/.test(r.rest)), 'bells from the API', JSON.stringify(s.api.map((r) => r.rest)));
      expect.ok(!s.lcd.some((r) => r.path === '/structs/grid'), 'the ledger node’s grid pages were not read', JSON.stringify(s.lcd.map((r) => r.path)));
      const ore = await page.eval(`(await import('/src/realm.ts')).omenSight().then((m) => m.get(${JSON.stringify(sky.crowd.pid)})?.ore)`);
      expect.eq(ore, 9, 'the Hoarder’s wildroot, as the API tells it');
    });

    await t.test('the Leyweave reads every wellspring and the warden’s own tithes in a few API reads, none per wellspring', 'S1', async () => {
      const at = Date.now();
      await go(page, '#/leyweave');
      await page.waitFor(`/resting/.test(document.body.innerText) && /Your tithe/.test(document.body.innerText)`, { what: 'the wells and the warden’s tithe', timeout: 40000 });
      const s = since(at);
      for (const re of [/reactor\/all/, /grid\/attribute-type\/fuel\/object-type\/reactor/, /infusion\/list\/address\//, /grid\/object\/4-/]) expect.ok(s.api.some((r) => re.test(r.rest)), `read ${re.source} from the API`, JSON.stringify(s.api.map((r) => r.rest)));
      expect.ok(!s.lcd.some((r) => /^\/structs\/(reactor|infusion)/.test(r.path)), 'no wellspring or tithe read from the ledger node', JSON.stringify(s.lcd.map((r) => r.path)));
      const text = await visibleText(page);
      expect.includes(text, 'Your tithe: 2', 'the warden’s 2 α tithe, from the API’s precise units');
      expect.noErrors(page.errors(ALLOW), 'console');
    });

    await t.test('an indexer that has fallen behind is passed over: the ledger node answers instead', 'S1', async () => {
      L.indexerLag = 10;
      await sleep(3500);   // the client asks how far behind the indexer is at most once a block
      const at = Date.now();
      try {
        await page.eval(`(await import('/src/realm.ts')).omenSight(true).then((m) => m.size)`);
        const s = since(at);
        expect.ok(s.lcd.some((r) => r.path === '/structs/grid'), 'the ledger node’s grid pages were read', JSON.stringify(s.lcd.map((r) => r.path)));
        expect.ok(!s.api.some((r) => /grid\//.test(r.rest)), 'no grid read from the lagging API', JSON.stringify(s.api.map((r) => r.rest)));
      } finally { L.indexerLag = 0; await sleep(3500); }
    });

    await t.test('raiders over an isle come from one API read, in the ledger’s own order', 'S1', async () => {
      const foe = w.players.get(sky.foe.pid).Player, isle = w.planets.get(foe.planetId).Planet;
      const [a, b] = [sky.fill[2], sky.fill[3]].map((x) => w.fleets.get(x.fleetId));
      const was = [a, b].map((f) => ({ ...f })), wasIsle = { ...isle };
      // b arrived first, a behind it
      Object.assign(b, { status: 'away', locationType: 'planet', locationId: isle.id, locationListForward: a.id, locationListBackward: '' });
      Object.assign(a, { status: 'away', locationType: 'planet', locationId: isle.id, locationListForward: '', locationListBackward: b.id });
      Object.assign(isle, { locationListStart: b.id, locationListLast: a.id, locationListCount: '2' });
      const at = Date.now();
      try {
        const got = await page.eval(`const r = await import('/src/realm.ts'); return r.raidersAt({ Planet: ${JSON.stringify({ id: isle.id, owner: isle.owner, locationListStart: isle.locationListStart })} })`);
        expect.eq(JSON.stringify(got.map((x) => x.fleetId)), JSON.stringify([b.id, a.id]), 'both warbands, first in line first');
        const s = since(at);
        const state = await page.eval(`(await import('/src/guild/api.ts')).guildReadState()`);
        expect.ok(s.api.some((r) => r.rest.startsWith(`api/fleet/list/location/${isle.id}`)), 'one read of every warband at the isle', [JSON.stringify(s.api.map((r) => r.rest)), JSON.stringify(state), JSON.stringify(s.lcd.map((r) => r.path))]);
        // (the empire may read the warden's own warband meanwhile; only the raiders' would be the walk)
        expect.ok(!s.lcd.some((r) => r.path === `/structs/fleet/${a.id}` || r.path === `/structs/fleet/${b.id}`), 'no walk of the visitor list on the ledger node', JSON.stringify(s.lcd.map((r) => r.path)));
      } finally { Object.assign(a, was[0]); Object.assign(b, was[1]); Object.assign(isle, wasIsle); }
    });

    await t.test('GRASS is followed from the coven’s guild.json and its heartbeat counts bells', 'S1', async () => {
      await page.waitFor(`(await import('/src/chain/grass.ts')).grass.state === 'live'`, { what: 'GRASS to be live', timeout: 20000 });
      const st = await page.eval(`const { grass } = await import('/src/chain/grass.ts'); return { url: grass.url, height: grass.height }`);
      expect.eq(st.url, L.grassUrl, 'the stream the coven names');
      expect.ok(st.height >= w.height - 2, 'the heartbeat’s bell is current', JSON.stringify(st));
    });

    await t.test('a wildroot change on GRASS shows in the Atlas at once, without reading the sky again', 'S1', async () => {
      await go(page, '#/atlas');
      await page.waitFor(`document.querySelectorAll('[aria-label="Wardens"] .list .item').length > 5`, { what: 'the atlas list', timeout: 40000 });
      await page.eval(`await (await import('/src/realm.ts')).omenSight(); return true`);
      const at = Date.now();
      setOre(brannoc.pid, 7);
      gridMsg(brannoc.pid, 'ore', 7);
      await page.waitFor(`[...document.querySelectorAll('[aria-label="Wardens"] .list .item')].some((e) => /Brannoc/.test(e.innerText) && /7 wildroot/.test(e.innerText))`, { what: 'Brannoc’s 7 wildroot in the list', timeout: 10000 });
      const s = since(at);
      expect.ok(!s.api.some((r) => /grid\//.test(r.rest)) && !s.lcd.some((r) => r.path === '/structs/grid'), 'the sky was not read again', JSON.stringify([...s.api.map((r) => r.rest), ...s.lcd.map((r) => r.path)]));
    });

    await t.test('wildroot all brewed (GRASS says nothing of a cleared value) is read again when the ledger of goods moves', 'S1', async () => {
      setOre(brannoc.pid, 0);
      L.emitGrass(`structs.inventory.ore.${brannoc.guildId || sky.guilds.mire.id}.${brannoc.pid}.${brannoc.address}`, { category: 'refined', player_id: brannoc.pid, address: brannoc.address, denom: 'ore', amount_p: 7, direction: 'debit' });
      const at = Date.now();
      try {
        await page.waitFor(`![...document.querySelectorAll('[aria-label="Wardens"] .list .item')].some((e) => /Brannoc/.test(e.innerText) && /wildroot/.test(e.innerText))`, { what: 'Brannoc’s wildroot to be gone', timeout: 10000 });
      } catch (e) {
        const seen = await page.eval(`({ sight: await (await import('/src/realm.ts')).omenSight().then((m) => m.get(${JSON.stringify(brannoc.pid)})), grass: (await import('/src/chain/grass.ts')).grass.state, rows: [...document.querySelectorAll('[aria-label="Wardens"] .list .item')].filter((e) => /Brannoc/.test(e.innerText)).map((e) => e.innerText) })`);
        throw new Failure(e.message, [JSON.stringify(seen), JSON.stringify(since(at).lcd.map((r) => r.path))]);
      }
    });

    await t.test('after a gap in GRASS the sky is read whole again', 'S1', async () => {
      L.dropGrass();
      await page.waitFor(`(await import('/src/chain/grass.ts')).grass.state !== 'live'`, { what: 'GRASS to notice the drop', timeout: 10000 });
      await page.waitFor(`(await import('/src/chain/grass.ts')).grass.state === 'live'`, { what: 'GRASS to come back', timeout: 20000 });
      const at = Date.now();
      await page.eval(`await (await import('/src/realm.ts')).omenSight(); return true`);
      const s = since(at);
      expect.ok(s.api.some((r) => /grid\/attribute-type\/ore/.test(r.rest)) || s.lcd.some((r) => r.path === '/structs/grid'), 'the sky read whole', JSON.stringify([...s.api.map((r) => r.rest), ...s.lcd.map((r) => r.path)]));
    });

    await t.test('an attribute event on the node’s feed is written straight into the hold, with no whole read', 'S1', async () => {
      const beast = sky.me.beasts[1], sid = beast.Struct.id, idx = sid.split('-')[1];
      const was = beast.structAttributes.health;
      await page.waitFor(`(await import('/src/game/empire.ts')).empire.commander?.structs.has(${JSON.stringify(sid)})`, { what: 'the beast to be held', timeout: 20000 });
      const at = Date.now();
      try {
        beast.structAttributes.health = '1';
        L.emitTx([{ type: 'EventStructAttribute', key: 'structAttributeRecord', data: { attributeId: `0-5-${idx}`, value: '1' } }]);
        await page.waitFor(`(await import('/src/game/empire.ts')).empire.commander?.structs.get(${JSON.stringify(sid)})?.health === 1`, { what: 'the beast’s vigor to fall to 1', timeout: 10000 });
        await sleep(1500);
        const reads = since(at).lcd.filter((r) => r.path === `/structs/player/${sky.me.pid}` || r.path === `/structs/struct/${sid}`);
        expect.ok(!reads.length, 'nothing of the warden was read again', JSON.stringify(reads.map((r) => r.path)));
      } finally {
        beast.structAttributes.health = was;
        L.emitTx([{ type: 'EventStructAttribute', key: 'structAttributeRecord', data: { attributeId: `0-5-${idx}`, value: was } }]);
      }
    });

    await t.test('a reload paints the hold from the last visit at once, and no rite is sent until the ledger answers', 'S1', async () => {
      // a ledger that won't answer for this warden: the copy is all there is for a while
      L.faults.failPaths = [new RegExp(`^/structs/player/${sky.me.pid}$`)];
      try {
        // a new document (a query the game ignores), so the harness can wait for it properly
        await page.goto(app.url + '?again=1#/hold');
        await page.waitFor(`(await import('/src/game/empire.ts')).empire.commander?.restored === true`, { what: 'the warden as last seen', timeout: 20000 });
        const early = await page.eval(`const { empire } = await import('/src/game/empire.ts'); const { txq } = await import('/src/wallet/queue.ts'); const p = empire.commander; return { beasts: p.structs.size, verified: txq.verifiedOf(p.playerId), charge: txq.chargeOf(p.playerId) }`);
        expect.ok(early.beasts > 5, 'the beasts are there before the ledger answers', JSON.stringify(early));
        // (the soulstone is sealed again after a reload: the copy needs no key to be shown)
        expect.eq(early.verified, false, 'the queue knows the copy is not the ledger');
        expect.eq(early.charge, null, 'no charge is promised from the copy');
        await page.waitFor(`/how you left it/.test(document.body.innerText)`, { what: 'the Hold to say it is showing the last visit', timeout: 20000 });
        L.faults.failPaths = [];
        await page.waitFor(`(await import('/src/game/empire.ts')).empire.commander?.restored === false`, { what: 'the ledger’s answer to replace the copy', timeout: 30000 });
        await page.waitFor(`!/how you left it/.test(document.body.innerText)`, { what: 'the notice to go', timeout: 10000 });
        await page.eval(`await (await import('/src/wallet/wallet.ts')).wallet.unlock('qa-data-passphrase'); return true`);
      } finally { L.faults.failPaths = []; }
    });

    await t.test('with the ledger node’s live feed down, GRASS still tells the empire what changed', 'S1', async () => {
      const before = w.players.get(sky.me.pid).gridAttributes.ore;
      L.faults.wsDown = true; L.dropSockets();
      try {
        await page.waitFor(`(await import('/src/chain/live.ts')).live.state !== 'live'`, { what: 'the live feed to drop', timeout: 15000 });
        await page.waitFor(`(await import('/src/chain/grass.ts')).grass.state === 'live'`, { what: 'GRASS to be live', timeout: 20000 });
        setOre(sky.me.pid, 5);
        const at = Date.now();
        gridMsg(sky.me.pid, 'ore', 5);
        await page.waitFor(`(await import('/src/game/empire.ts')).empire.commander?.ore === 5`, { what: 'the commander’s wildroot to change', timeout: 15000 });
        expect.ok(!since(at).lcd.some((r) => r.path === `/structs/player/${sky.me.pid}`), 'patched from the frame, not read again', JSON.stringify(since(at).lcd.map((r) => r.path)));
        // a frame GRASS can't carry whole (a beast moved) still has the warden read again
        const moved = sky.me.beasts[2].Struct.id;
        L.emitGrass(`structs.planet.${sky.me.planetId}.${sky.me.pid}`, { category: 'struct_move', planet_id: sky.me.planetId, player_id: sky.me.pid, block_height: w.height, detail: { struct_id: moved, location_type: 'fleet', location_id: sky.me.fleetId, ambit: 'land', slot: 2 } });
        await page.waitFor(`true`, { timeout: 100 });
        const t2 = Date.now() - 50;
        await sleep(3000);
        expect.ok(L.log.some((r) => r.at >= t2 - 3000 && r.path === `/structs/player/${sky.me.pid}`), 'a moved beast has the warden read again', JSON.stringify(since(t2 - 3000).lcd.map((r) => r.path)));
        const charge = await page.eval(`const { empire } = await import('/src/game/empire.ts'); const { grass } = await import('/src/chain/grass.ts'); const p = empire.commander; return { charge: empire.charge(p), grass: grass.height, last: p.lastAction }`);
        expect.ok(charge.charge >= charge.grass - charge.last - 1, 'the charge keeps counting on GRASS’s bells', JSON.stringify(charge));
      } finally { L.faults.wsDown = false; setOre(sky.me.pid, Number(before)); }
    });
  } finally {
    await app.stop();
  }
}
