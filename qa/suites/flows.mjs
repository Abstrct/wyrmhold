/* Player journeys, from a browser that has never seen the game: the prologue, the oath (soulstone,
 * soul-words, coven, isle), the Hold as one's own, Ysolde's path, a summoning that queues and lands. */
import { expect } from '../lib/report.mjs';
import { openGame, awake, go, visibleText, stage, ALLOW, sleep } from '../lib/game.mjs';
import { addStruct, ST } from '../lib/world.mjs';

/** What the Hold shows of a warden: the beasts on the isle (with their name tags, the chosen one and the ward)
 * and the Chronicle's lines (0 while it is hidden). */
const holdShows = (p) => p.eval(`(() => {
  const s = document.querySelector('#app .stage canvas').__wyrmCtl.census(), ch = document.querySelector('#app section[aria-label=Chronicle]');
  return { units: s.units.length, tags: s.tags, selected: s.selected, ward: s.ward, chronicle: ch && !ch.hidden ? ch.querySelectorAll('li').length : 0 };
})()`);
/** A forgotten warden leaves nothing behind in the Hold: the isle is a stranger's, as one mounts it. */
function expectEmptied(s, when) {
  expect.eq(s.units, 0, `${when}: no beasts left on the isle`, s);
  expect.eq(s.tags, 0, `${when}: no name tags left over the isle`, s);
  expect.eq(s.selected, null, `${when}: nothing chosen`, s);
  expect.eq(s.ward, 0, `${when}: the ward is down`, s);
  expect.eq(s.chronicle, 0, `${when}: the Chronicle tells none of the forgotten warden’s rites`, s);
}

export default async function (t, ctx) {
  const page = await ctx.newPage();
  const w = ctx.sky.w;

  await t.test('first visit: the prologue plays on the Gate, can be skipped, and ends on the oath or a look around', 'S1', async (c) => {
    await openGame(page, ctx.app.url, '#/', { storage: { 'wyrmhold.music': 'off' } });
    await page.waitFor(`document.querySelector('.prologue')`, { what: 'the prologue', timeout: 15000 });
    await sleep(2500);
    const text = await page.eval(`document.querySelector('.prologue').innerText`);
    expect.ok(text.length > 40, 'the tale is told', text.slice(0, 200));
    await page.screenshot(c.evidencePath('prologue.png'));
    const buttons = await page.eval(`[...document.querySelectorAll('.prologue button, .prologue a')].map((b) => b.textContent.trim())`);
    expect.ok(buttons.length >= 1, 'a way on or out of the prologue', buttons);
    // skip to the end
    for (let i = 0; i < 12 && await page.eval(`!!document.querySelector('.prologue')`); i++) { const btn = await page.eval(`(() => { const b = [...document.querySelectorAll('.prologue button, .prologue a')].find((x) => /skip|wander|later|next|go on|continue|bind|oath/i.test(x.textContent)); if (!b) return null; b.click(); return b.textContent.trim(); })()`); if (!btn) await page.click(640, 400); await sleep(700); }
    await sleep(500);
    const after = await page.eval(`({ prologue: !!document.querySelector('.prologue'), oath: !!document.querySelector('.veil [role=dialog]'), seen: localStorage.getItem('wyrmhold.prologue') })`);
    expect.ok(!after.prologue, 'the prologue closed');
    expect.eq(after.seen, 'seen', 'the prologue is remembered as seen');
    expect.noErrors(page.errors(ALLOW), 'console');
  });

  await t.test('the oath, start to finish: a soulstone is forged, its words kept, a name and coven chosen, the scribe writes the warden in, an isle is sought', 'S0', async (c) => {
    // the mock scribe makes a new warden for whoever signs up
    let made = null;
    w.anyAddressPlayer = null;
    w.enlist = (b) => { const { addWarden } = ctx.worldLib; const nw = addWarden(w, { name: b.username, guildId: b.guild_id, noPlanet: true, beasts: [], address: b.primary_address }); made = nw; return nw.pid; };
    const before = ctx.ledger.broadcasts || 0;
    try {
      await openGame(page, ctx.app.url, '#/', { storage: { 'wyrmhold.prologue': 'seen', 'wyrmhold.music': 'off' } });
      await awake(page);
      await page.clickSel('[data-tut=begin]');
      await page.waitFor(`document.querySelector('.veil [role=dialog]')`, { what: 'the oath dialog' });
      // step 1: forge a soulstone
      let text = await page.eval(`document.querySelector('.veil [role=dialog]').innerText`);
      expect.ok(/Bind your soulstone/.test(text), 'step one asks for a soulstone', text.slice(0, 200));
      await page.screenshot(c.evidencePath('oath-1-soulstone.png'));
      await page.clickSel('.veil button.choice', { text: 'forge a soulstone' });
      // step 2: keep the soul-words (the button waits for the promise)
      await page.waitFor(`document.querySelector('.veil #kept')`, { what: 'the soul-words panel', timeout: 30000 });
      const words = await page.eval(`document.querySelectorAll('.veil .words span').length`);
      expect.eq(words, 24, 'twenty-four soul-words are shown');
      expect.ok(await page.eval(`[...document.querySelectorAll('.veil .btn.gold')].find((b) => /choose a coven/.test(b.textContent)).disabled`), 'the way on waits until the words are kept');
      await page.screenshot(c.evidencePath('oath-2-words.png'));
      await page.clickSel('.veil #kept');
      await page.clickSel('.veil .btn.gold', { text: 'choose a coven' });
      // step 3: a name and a coven
      await page.waitFor(`document.querySelector('.veil #warden-name') && document.querySelectorAll('.veil [role=radiogroup] [role=radio]').length >= 3`, { what: 'the name field and the covens', timeout: 30000 });
      const covens = await page.eval(`[...document.querySelectorAll('.veil [role=radiogroup] [role=radio]')].map((b) => b.innerText.trim().split('\\n')[0])`);
      for (const cv of ['The First Hearth', 'The Gilded Mire', 'Lanternwatch']) expect.ok(covens.some((x) => x.includes(cv)), `coven ${cv} is listed by name`, covens);
      const swearLabel = () => page.eval(`document.querySelector('.veil .btn.gold.block').textContent`);
      expect.ok(/Name your warden/.test(await swearLabel()), 'the swear button asks for a name first');
      await page.clickSel('.veil #warden-name');
      await page.type('a b');
      const fixed = await page.eval(`document.getElementById('warden-name').value`);
      expect.eq(fixed, 'a_b', 'spaces become underscores as typed');
      await page.eval(`const i = document.getElementById('warden-name'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true }))`);
      await page.type('Proofwarden');
      await page.clickSel('.veil [role=radio]', { text: 'The First Hearth' });
      await sleep(200);
      expect.ok(/Swear the oath/.test(await swearLabel()), 'the swear button is ready');
      await page.screenshot(c.evidencePath('oath-3-coven.png'));
      await page.clickSel('.veil .btn.gold.block');
      // step 4: the scribe writes the warden in, the client seeks an isle on its own
      await page.waitFor(`(await import('/src/wallet/wallet.ts')).wallet.active && (await import('/src/wallet/wallet.ts')).wallet.active.playerId`, { what: 'the scribe to write the warden in', timeout: 60000 });
      expect.ok(made, 'the coven’s scribe made a warden');
      expect.eq(ctx.sky.w.players.get(made.pid).Player.name, 'Proofwarden', 'the warden carries the chosen name');
      const t0 = Date.now(); while ((ctx.ledger.broadcasts || 0) === before && Date.now() - t0 < 30000) await sleep(300);
      expect.ok((ctx.ledger.broadcasts || 0) > before, 'an isle was sought (a rite was broadcast)');
      // the isle is a rite of its own: until the ledger grants it, the oath says it is being sought, never that it awaits
      const oathText = `document.querySelector('.veil [role=dialog]') ? document.querySelector('.veil [role=dialog]').innerText : ''`;
      await page.waitFor(`/The Oath is sworn/i.test(${oathText})`, { what: 'the oath sworn', timeout: 30000 });
      await sleep(2500);
      text = await page.eval(oathText);
      expect.ok(/Seeking your isle/i.test(text) && !/Your isle awaits|Enter your Hold|stirs on a fresh isle/i.test(text), 'before the isle exists, the oath says it is being sought', text.slice(0, 300));
      await page.screenshot(c.evidencePath('oath-4-seeking.png'));
      ctx.worldLib.grantIsle(w, made.pid);
      ctx.ledger.emitTx([{ type: 'EventPlayer', key: 'player', data: { id: made.pid } }]);
      await page.waitFor(`/Your isle awaits/.test(${oathText}) && /Enter your Hold/.test(${oathText})`, { what: 'the finish line, once the isle is granted', timeout: 30000 });
      await page.screenshot(c.evidencePath('oath-5-sworn.png'));
      text = await visibleText(page);
      expect.ok(!/\b\d+-\d+\b/.test(text.replace(/Warden \d+-\d+/g, '')), 'no ledger marks shown during the oath', text.match(/\b\d+-\d+\b/g));
      await page.clickSel('.veil .btn.gold.block', { text: 'Enter your Hold' });
      await page.waitFor(`document.body.dataset.route === 'hold'`, { what: 'the Hold' });
      expect.noErrors(page.errors(ALLOW), 'console');
    } finally { w.anyAddressPlayer = ctx.sky.me.pid; w.enlist = null; }
  });

  await t.test('the Hold as one’s own, fresh: Ysolde’s path shows the next step, the first-look tour runs once, the Wyrm hatches', 'S1', async (c) => {
    // a brand-new warden: isle, Wyrm, nothing else
    const { addWarden } = ctx.worldLib;
    const nw = addWarden(w, { name: 'Hatchling', guildId: ctx.sky.guilds.hearth.id, beasts: [[1]], planetOre: 5 });
    w.anyAddressPlayer = nw.pid;
    try {
    await openGame(page, ctx.app.url, '#/hold', { storage: { 'wyrmhold.prologue': 'seen', 'wyrmhold.music': 'off' }, sworn: true, playerId: nw.pid });
    await awake(page);
    // the first look begins a moment after the isle wakes: wait for it (or for it to have been walked)
    await page.waitFor(`document.querySelector('.tour') || localStorage.getItem('wyrmhold.tour.hold') === 'seen'`, { what: 'the first-look tour', timeout: 40000 });
    const r = await page.eval(`({ tour: !!document.querySelector('.tour, [class*="tour"]'), touring: document.body.classList.contains('touring'), path: document.querySelector('.path') ? document.querySelector('.path').innerText : '', seen: localStorage.getItem('wyrmhold.tour.hold') })`);
    await page.screenshot(c.evidencePath('first-hold.png'));
    expect.ok(r.touring || r.tour || r.seen === 'seen', 'the first-look tour speaks (or has spoken)', r);
    // finish the tour
    for (let i = 0; i < 10 && await page.eval(`document.body.classList.contains('touring')`); i++) { await page.eval(`(() => { const b = [...document.querySelectorAll('button')].filter((x) => x.offsetParent !== null).find((x) => /next|go on|done|got it|close|begin|finish/i.test(x.textContent)); if (b) b.click(); })()`); await sleep(500); }
    await page.waitFor(`document.querySelector('.path')`, { what: 'Ysolde', timeout: 10000 });
    const path = await page.eval(`document.querySelector('.path').innerText`);
    expect.ok(/\d+\/12|STEP \d+ OF 12/i.test(path), 'the path counts its steps', path);
    expect.ok(/Next:|Meet your Elder Wyrm|Summon|Root Delver/.test(path), 'the path names the next step', path);
    } finally { w.anyAddressPlayer = ctx.sky.me.pid; }
  });

  await t.test('a summoning: Summon → a kind the warden may bind → the circle rite queues, is signed, broadcast, and appears as "Being summoned"', 'S0', async (c) => {
    const me = ctx.sky.me;
    const { TYPES, homeAmbit } = ctx.worldLib;
    await openGame(page, ctx.app.url, '#/hold', { sworn: true, playerId: me.pid });
    await awake(page); await page.waitFor(`document.querySelectorAll('.roster-panel .item').length > 5`, { what: 'the roster' }); await sleep(800);
    const before = ctx.ledger.broadcasts || 0;
    let newId = null, chosen = null;
    try {
      await page.clickSel('nav.rites .rite', { text: 'Summon' });
      await page.waitFor(`document.querySelector('.veil [role=dialog][aria-label=Summon]')`, { what: 'the Summon dialog' });
      const cards = await page.eval(`[...document.querySelectorAll('.veil .card-btn')].map((b) => ({ name: b.querySelector('b').textContent, disabled: b.disabled, why: b.querySelector('.why') ? b.querySelector('.why').textContent : '' }))`);
      const open = cards.filter((x) => !x.disabled);
      expect.ok(open.length, 'some kind can be summoned', cards.map((x) => `${x.name}: ${x.why}`));
      chosen = TYPES.find((t) => t.type === open[0].name);
      // the chain's part: the circle is drawn in the first free slot of its realm
      ctx.ledger.onBroadcast = () => {
        if (newId) return;
        const onFleet = chosen.category === 'fleet', holder = onFleet ? w.fleets.get(me.fleetId) : w.planets.get(me.planetId).Planet, ambit = homeAmbit(chosen);
        let slot = holder[ambit].findIndex((x) => !x); if (slot < 0) slot = holder[ambit].length;
        const s = addStruct(w, { typeId: chosen.id, owner: me.pid, locationType: onFleet ? 'fleet' : 'planet', locationId: onFleet ? me.fleetId : me.planetId, ambit, slot, status: ST.building });
        holder[ambit][slot] = s.Struct.id; newId = s.Struct.id;
        setTimeout(() => ctx.ledger.emitTx([{ type: 'EventStruct', key: 'structure', data: { id: s.Struct.id, owner: me.pid, locationId: s.Struct.locationId } }]), 1200);
      };
      await page.clickSel('.veil .card-btn', { text: chosen.type });
      await page.waitFor(`document.getElementById('heralds') && /circle/i.test(document.getElementById('heralds').innerText)`, { what: 'the circle herald', timeout: 10000 });
      const t0 = Date.now(); while ((ctx.ledger.broadcasts || 0) === before && Date.now() - t0 < 40000) await sleep(300);
      expect.ok((ctx.ledger.broadcasts || 0) > before, 'the circle rite was broadcast');
      await page.waitFor(`[...document.querySelectorAll('.roster-panel .item')].some((b) => b.dataset.key === ${JSON.stringify(newId || '')} || (/Being summoned/.test(b.textContent) && b.textContent.includes(${JSON.stringify(chosen.type)})))`, { what: `the new ${chosen.type} in the roster, being summoned`, timeout: 40000 });
      await page.waitFor(`document.querySelector('#app .stage canvas').__wyrmCtl.has(${JSON.stringify(newId)})`, { what: 'the new one on the isle' });
      await sleep(800);
      const text = await visibleText(page);
      expect.ok(/circle is drawn|chant is being sung|Incantations/i.test(text), 'the warden is told the chant is being sung, not that it is done', text.slice(0, 300));
      await page.screenshot(c.evidencePath('summoning.png'));
      const st = await stage(page); expect.ok(st.finite, 'camera finite');
      expect.noErrors(page.errors(ALLOW), 'console');
    } finally { ctx.ledger.onBroadcast = null; }
  });

  await t.test('the Chronicle tells the rite in the realm’s words and the Incantations panel appears while a chant sounds', 'S2', async (c) => {
    const text = await page.eval(`[...document.querySelectorAll('.col-r section')].map((s) => s.getAttribute('aria-label') + ': ' + s.innerText.slice(0, 160)).join('\\n')`);
    expect.ok(/Chronicle|Incantations/.test(text), 'the panels', text);
    expect.ok(!/Msg|Build|Initiate|tx|struct/.test(text), 'engine words in the chronicle', text.match(/Msg\w+|Initiate|struct/g));
  });

  await t.test('forgetting the soulstone empties the Hold honestly and returns the stranger’s rites', 'S1', async (c) => {
    const before = await holdShows(page);
    expect.ok(before.units > 0 && before.chronicle > 0 && before.ward > 0, 'before: the warden’s beasts, ward and rites are shown', before);
    await page.eval(`const { wallet } = await import('/src/wallet/wallet.ts'); wallet.forget(); return true`);
    await sleep(1500);
    const text = await visibleText(page);
    expect.ok(/No warden is bound|Swear the oath/.test(text), 'the Hold says there is no warden', text.slice(0, 300));
    const rites = await page.eval(`[...document.querySelectorAll('nav.rites .rite')].map((r) => r.querySelector('b').textContent)`);
    expect.ok(rites.includes('Swear the oath'), 'the oath is offered again', rites);
    // the isle is a stranger's again at once, not at the next reload (a persona playtest, 2026-10-13)
    expectEmptied(await holdShows(page), 'after forgetting');
    await page.screenshot(c.evidencePath('forgotten.png'));
    expect.noErrors(page.errors(ALLOW), 'console');
  });

  /* Two tabs share one soulstone in storage, but each holds its own soul-words in memory. A persona playtest
   * (2026-10-13) forgot the soulstone in one tab and forged another: the other tab stayed the signer with the old
   * words and sealed the new warden's rites with the old key, which the ledger refused ("PubKey does not match
   * signer address … invalid pubkey"); the forgotten warden's chants went on, submitted under the new address. */
  const W = `(await import('/src/wallet/wallet.ts')).wallet`, LEAD = `(await import('/src/core/leader.ts')).leader.isLeader`, POW = `(await import('/src/pow/pow.ts')).pow`;
  const lifted = `!document.getElementById('boot') || document.getElementById('boot').classList.contains('gone')`;
  const explore = (p, pid, label) => p.eval(`const { txq } = await import('/src/wallet/queue.ts'); const j = await txq.submit({ typeUrl: '/structs.structs.MsgPlanetExplore', value: { playerId: ${JSON.stringify(pid)} } }, { account: 0, label: ${JSON.stringify(label)} }); return { status: j.status, hash: j.hash }`, { timeout: 60000 }).catch((e) => ({ error: e.message }));
  const pageB = await ctx.newPage();
  const { addWarden } = ctx.worldLib;
  const next = addWarden(w, { name: 'Secondstone', guildId: ctx.sky.guilds.hearth.id, beasts: [[1]] });
  const known = [];
  const refusedBefore = ctx.ledger.refusals.length;

  await t.test('two tabs: a soulstone forgotten in one and a new one forged, the other tab lets the old words go and every rite from either tab is sealed with the new key', 'S0', async (c) => {
    const me = ctx.sky.me;
    try {
      // tab A: sworn to the menagerie warden, whose summonings owe chants; it is the signer
      await openGame(page, ctx.app.url, '#/hold', { sworn: true, playerId: me.pid });
      // a first frame's shaders hold a page's thread for a long while under software WebGL: let both skies wake first
      await awake(page);
      const oldAddr = await page.eval(`${W}.active.address`);
      w.addresses.set(oldAddr, me.pid); known.push(oldAddr);
      // tab B: the same browser profile, so the same soulstone, which opens itself there too
      await pageB.goto(ctx.app.url + '#/grimoire');
      await pageB.waitFor(lifted, { what: 'tab B to boot', timeout: 60000 });
      await pageB.waitFor(`${W}.unlocked && ${W}.active.address === ${JSON.stringify(oldAddr)}`, { what: 'tab B to open the same soulstone', timeout: 60000 });
      await awake(pageB);
      const roles = { a: await page.eval(LEAD), b: await pageB.eval(LEAD) };
      expect.ok(roles.a && !roles.b, 'tab A signs and tab B hands it its rites, as in the playtest', roles);
      await page.waitFor(`[...${POW}.tasks.values()].some((t) => t.playerId === ${JSON.stringify(me.pid)})`, { what: 'the old warden’s chants in tab A', timeout: 60000 });

      // tab B forgets the soulstone: tab A's Hold lets the warden go at once, not at the next reload
      await pageB.eval(`${W}.forget(); return true`);
      await page.waitFor(`!${W}.unlocked && /No warden is bound/.test(document.body.innerText)`, { what: 'tab A to let the forgotten soulstone go', timeout: 15000 });
      const chants = await Promise.all([page, pageB].map((p) => p.eval(`[...${POW}.tasks.values()].filter((t) => t.playerId === ${JSON.stringify(me.pid)}).length`)));
      expect.eq(chants.join(','), '0,0', 'the forgotten warden’s chants are dropped in both tabs');
      await page.screenshot(c.evidencePath('tab-a-after-forget.png'));

      // tab B forges a new soulstone, which the ledger knows as another warden
      w.anyAddressPlayer = next.pid;
      const newAddr = await pageB.eval(`await ${W}.createInstant(); await ${W}.resolvePlayers(); return ${W}.active.address`);
      known.push(newAddr);
      expect.ok(newAddr && newAddr !== oldAddr, 'a new soulstone was forged', newAddr);
      // tab A opens it as it would on load, and reads the new warden (it never reloaded)
      await page.waitFor(`${W}.unlocked && (await import('/src/game/empire.ts')).empire.commander && (await import('/src/game/empire.ts')).empire.commander.playerId === ${JSON.stringify(next.pid)}`, { what: 'tab A to follow to the new soulstone and its warden', timeout: 30000 });
      expect.eq(await page.eval(`${W}.key(0).address`), newAddr, 'tab A derives the new soulstone’s key');

      // a rite from each tab: whichever signs, it is sealed with the new key and the ledger takes it
      for (const [p, name] of [[pageB, 'B'], [page, 'A']]) {
        const r = await explore(p, next.pid, `A rite from tab ${name}`);
        expect.eq(r.status, 'success', `the rite from tab ${name} lands`, r);
        expect.eq(ctx.ledger.txs.get(r.hash)?.signer, newAddr, `the rite from tab ${name} is sealed with the new key`);
      }
      const refused = ctx.ledger.refusals.slice(refusedBefore);
      expect.eq(refused.length, 0, 'nothing was sealed by one key for another’s rite', refused);
      expect.noErrors([...page.errors(ALLOW), ...pageB.errors(ALLOW)], 'console');
    } finally { w.anyAddressPlayer = next.pid; }
  });

  await t.test('a signer tab that has not yet heard the soulstone change still never seals with the old key', 'S0', async () => {
    try {
      // make tab A the signer again: tab B steps away (its lock goes with its page) and comes back behind A.
      // about:blank, not the game's own blank page: goto() would take a same-origin page for the game and race its load
      await pageB.goto('about:blank');
      await page.waitFor(LEAD, { what: 'tab A to sign', timeout: 120000 });
      await pageB.goto(ctx.app.url + '#/grimoire');
      await pageB.waitFor(lifted, { what: 'tab B to boot', timeout: 60000 });
      await pageB.waitFor(`${W}.unlocked`, { what: 'tab B to open the soulstone', timeout: 60000 });
      await awake(pageB);
      // storage events can lag another tab's write: tab A hears nothing more
      await page.eval(`window.__deaf = (e) => e.stopImmediatePropagation(); window.addEventListener('storage', window.__deaf, true); return true`);
      const third = await pageB.eval(`${W}.forget(); await ${W}.createInstant(); await ${W}.resolvePlayers(); return ${W}.active.address`);
      known.push(third);
      // tab A, still the signer with the last soulstone's words, is handed a rite for the new one
      const id = await page.eval(`const { txq } = await import('/src/wallet/queue.ts'); return txq.enqueue({ typeUrl: '/structs.structs.MsgPlanetExplore', value: { playerId: ${JSON.stringify(next.pid)} } }, { account: 0, label: 'A rite while deaf' }).id`);
      const j = await pageB.waitFor(`(await import('/src/wallet/queue.ts')).txq.jobs.filter((x) => x.id === ${JSON.stringify(id)} && ['success', 'failed', 'cancelled'].includes(x.status)).map((x) => ({ status: x.status, hash: x.hash, error: x.error }))[0]`, { what: 'the rite to be settled by whichever tab signs', timeout: 45000 });
      expect.eq(j.status, 'success', 'the rite lands', j);
      expect.eq(ctx.ledger.txs.get(j.hash)?.signer, third, 'it is sealed with the new key');
      expect.eq(await page.eval(`${W}.unlocked && ${W}.key(0).address`), third, 'tab A let the old words go the moment it tried to use them, and opened the new soulstone');
      const refused = ctx.ledger.refusals.slice(refusedBefore);
      expect.eq(refused.length, 0, 'nothing was sealed by one key for another’s rite', refused);
    } finally {
      await page.eval(`window.removeEventListener('storage', window.__deaf, true); return true`).catch(() => null);
      for (const a of known) w.addresses.delete(a);
      w.anyAddressPlayer = ctx.sky.me.pid;
    }
  });
  await pageB.close();
  await page.close();
}
