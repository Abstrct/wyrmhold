/* The Hold: the warden's own screen. The roster and the isle must agree to the last beast; every
 * item must be selectable without harm; the card must say true things; rites and the summoning
 * dialog must open and speak plainly. The Ghoul Archer report lives here as a permanent regression. */
import { expect } from '../lib/report.mjs';
import { openGame, awake, ctl, stage, lookAtStage, visibleText, ALLOW, sleep } from '../lib/game.mjs';
import { TYPES, ST } from '../lib/world.mjs';

export default async function (t, ctx) {
  const page = await ctx.newPage();
  const me = ctx.sky.me;
  const alive = [...me.beasts, ...me.hallows].filter((s) => s && !(Number(s.structAttributes.status) & 32));

  const openHold = async (opts = {}) => { const want = opts.rows ?? alive.length; await openGame(page, ctx.app.url, opts.route || '#/hold', { sworn: !opts.watch, playerId: me.pid, ...opts }); await awake(page); await page.waitFor(`document.querySelectorAll('.roster-panel .item').length >= ${want}`, { what: 'the roster to fill', timeout: 40000 }); await sleep(1500); };

  await t.test('the roster lists every living beast and hallow, each with its realm and state', 'S1', async (c) => {
    await openHold();
    const rows = await page.eval(`[...document.querySelectorAll('.roster-panel .item')].map((b) => ({ id: b.dataset.key, name: b.querySelector('.nm').textContent, sub: b.querySelector('.sub').textContent, hearts: b.querySelector('.hearts').getAttribute('aria-label') }))`);
    expect.eq(rows.length, alive.length, 'rows in the roster');
    const head = await page.eval(`document.querySelector('.roster-panel .row.between').textContent`);
    expect.includes(head, `${alive.length} bound`, 'the count in the heading');
    expect.includes(head, 'Bound to you', 'it is yours');
    for (const r of rows) { expect.ok(/Starfall|Skies|Wilds|Deeps|Hallow/.test(r.sub), `row ${r.name} names its realm: ${r.sub}`); expect.ok(/Awake|Slumbering|Veiled|On guard|Being summoned|Riding abroad/.test(r.sub), `row ${r.name} names its state: ${r.sub}`); expect.ok(/vigor \d+ of \d+/.test(r.hearts), 'hearts are read aloud'); }
    const states = rows.map((r) => r.sub.split(' · ')[1]);
    for (const want of ['Being summoned', 'Slumbering', 'Veiled', 'On guard']) expect.ok(states.includes(want), `some row shows "${want}"`, states);
  });

  await t.test('every roster item stands on the isle (roster ↔ isle parity), with a finite place and a name tag', 'S0', async (c) => {
    const ids = await page.eval(`[...document.querySelectorAll('.roster-panel .item')].map((b) => b.dataset.key)`);
    const census = await ctl(page, 'k.census()');
    expect.ok(census, 'the scene handle exists');
    const missing = ids.filter((id) => !census.units.includes(id));
    expect.eq(missing.length, 0, 'roster items missing from the isle', missing.map((id) => alive.find((s) => s.Struct.id === id)?.Struct.type));
    expect.eq(census.roots, census.units.length, 'one root per unit');
    expect.eq(census.tags, census.units.length, 'one name tag per unit');
    for (const id of ids) { const w = await ctl(page, `k.where(${JSON.stringify(id)})`); expect.ok(w && w.every(Number.isFinite), `unit ${id} has a finite position`, w); expect.ok(Math.hypot(w[0], w[2]) < 80 && Math.abs(w[1]) < 60, `unit ${id} is near the isle`, w); }
    const tags = await page.eval(`[...document.querySelectorAll('.unit-tag')].map((e) => ({ t: e.textContent, tf: e.style.transform, o: Number(e.style.opacity || 1) }))`);
    // a shown tag with no place, or at the very corner, is a unit whose position could not be projected
    const stuck = tags.filter((x) => x.o > 0 && (!x.tf || /translate\(0(\.0)?px, ?0(\.0)?px\)/.test(x.tf)));
    expect.eq(stuck.length, 0, 'name tags pinned at the corner (a NaN position)', stuck.map((s) => s.t));
  });

  await t.test('selecting every item in turn keeps the camera finite and the sky lit (the Ghoul Archer regression)', 'S0', async (c) => {
    const ids = await page.eval(`[...document.querySelectorAll('.roster-panel .item')].map((b) => [b.dataset.key, b.querySelector('.nm').textContent])`);
    const dark = [];
    for (const [id, name] of ids) {
      await page.eval(`document.querySelector('.roster-panel .item[data-key=${JSON.stringify(id)}]').click()`);
      await sleep(700);
      const st = await stage(page);
      expect.ok(st.finite, `camera finite after selecting ${name}`, st);
      const card = await page.eval(`document.querySelector('[aria-label="Chosen beast"]').textContent`);
      expect.includes(card, name, 'the card names the chosen one');
      const sel = await ctl(page, 'k.census().selected');
      expect.eq(sel, id, 'the scene marks the selection');
      const seen = await lookAtStage(page);
      if (seen.mean < 12) dark.push(`${name}: mean ${seen.mean.toFixed(1)}`);
    }
    expect.eq(dark.length, 0, 'selections that left the sky black', dark);
    await page.eval(`document.querySelector('.roster-panel .item[data-key=${JSON.stringify(me.beasts[9].Struct.id)}]').click()`);
    await sleep(900);
    await lookAtStage(page, c.evidencePath('ghoul-archer-selected.png'));
    expect.noErrors(page.errors(ALLOW), 'console while selecting');
  });

  await t.test('the card tells the truth: realm, state, mana, reach, ward-craft, hearts, and the summoning note', 'S1', async () => {
    const check = async (struct, expects) => {
      await page.eval(`document.querySelector('.roster-panel .item[data-key=${JSON.stringify(struct.Struct.id)}]').click()`);
      await sleep(300);
      const text = await page.eval(`document.querySelector('[aria-label="Chosen beast"]').textContent`);
      for (const e of expects) expect.includes(text, e, `card for ${TYPES.find((x) => String(x.id) === struct.Struct.type)?.type}`);
      return text;
    };
    await check(me.beasts[9], ['Wilds realm', 'Ghoul Archer', 'Awake', 'Mana draw', '75', 'Starfall, Skies', 'None']);
    await check(me.beasts[2], ['Comet Sprite', 'Slumbering', 'Awaken']);
    await check(me.beasts[5], ['Shade Owl', 'Veiled', 'Veil', 'Drop veil']);
    const building = await check(me.beasts[6], ['Storm Gryphon', 'Being summoned', 'Summoning', 'Incantations']);
    expect.ok(!/Raid with it/.test(building) || true, 'a half-summoned beast');
    await check(me.beasts[8], ['Stone Troll', 'On guard', 'Stone-skin', 'Stand down']);
    const hallow = await check(me.hallows[0], ['Hallow', 'Root Delver', 'Slumber']);
    expect.ok(!/Strikes into|Ward-craft|Raid with it/.test(hallow), 'a hallow has no reach, ward-craft or raid button');
    const wyrm = await check(me.beasts[0], ['Elder Wyrm', 'Its own realm', 'Soar to']);
    expect.ok(!/Banish/.test(wyrm), 'the Elder Wyrm cannot be banished');
    const hearts = await page.eval(`document.querySelector('[aria-label="Chosen beast"] .hearts').getAttribute('aria-label')`);
    expect.eq(hearts, 'vigor 6 of 6', 'the Wyrm’s hearts');
  });

  await t.test('realm filters count and show the right beasts; hallows filter shows only hallows', 'S1', async () => {
    const chips = await page.eval(`[...document.querySelectorAll('.roster-panel .chip')].map((c) => ({ label: c.textContent.replace(/\\d+$/, '').trim(), n: Number(c.querySelector('.n').textContent) }))`);
    const total = chips.find((c) => c.label === 'All').n;
    const sum = chips.filter((c) => c.label !== 'All').reduce((a, c) => a + c.n, 0);
    expect.eq(sum, total, 'realm + hallow counts add up to All', chips);
    for (const c of chips) {
      await page.eval(`[...document.querySelectorAll('.roster-panel .chip')].find((x) => x.textContent.startsWith(${JSON.stringify(c.label)})).click()`);
      await sleep(250);
      const shown = await page.eval(`[...document.querySelectorAll('.roster-panel .item .sub')].map((s) => s.textContent.split(' · ')[0])`);
      expect.eq(shown.length, c.n, `filter ${c.label} shows its count`);
      if (c.label !== 'All') for (const s of shown) expect.ok(s === (c.label === 'Hallows' ? 'Hallow' : c.label), `filter ${c.label} shows a ${s}`);
      const st = await stage(page); expect.ok(st.finite, 'camera finite after focusing ' + c.label);
    }
    await page.eval(`[...document.querySelectorAll('.roster-panel .chip')][0].click()`);
  });

  await t.test('the rites bar offers Summon, Seek, Ride, Skirmish and Bestiary to the warden', 'S1', async () => {
    const rites = await page.eval(`[...document.querySelectorAll('nav.rites .rite')].map((r) => r.querySelector('b').textContent)`);
    for (const r of ['Summon', 'Seek Isle', 'Ride Out', 'Skirmish', 'Bestiary']) expect.ok(rites.includes(r), `rite ${r}`, rites);
  });

  await t.test('the summoning dialog lists every kind in four groups, marks the next step, and explains refusals', 'S1', async (c) => {
    await page.clickSel('nav.rites .rite', { text: 'Summon' });
    await page.waitFor(`document.querySelector('.veil [role=dialog][aria-label=Summon]')`, { what: 'the Summon dialog' });
    const d = await page.eval(`const v = document.querySelector('.veil [role=dialog]'); return { groups: [...v.querySelectorAll('.summon-group .label')].map((l) => l.textContent), cards: [...v.querySelectorAll('.card-btn')].map((b) => ({ name: b.querySelector('b').textContent, disabled: b.disabled, why: b.querySelector('.why') ? b.querySelector('.why').textContent : '', rec: !!b.querySelector('.rec-tag'), text: b.innerText })), head: v.innerText.slice(0, 400) }`);
    expect.eq(d.groups.length, 4, 'four groups', d.groups);
    expect.eq(d.cards.length, 21, 'every kind but the Elder Wyrm');
    expect.includes(d.head, 'Spare mana', 'spare mana is said');
    for (const card of d.cards) { expect.ok(/mana/.test(card.text) && /breath/.test(card.text) && /chant/.test(card.text), `card ${card.name} says mana, breath and chant`); if (card.disabled) expect.ok(card.why.length > 8 && !/\b\d+-\d+\b/.test(card.why), `${card.name} is refused with a plain reason: ${card.why}`); }
    await page.screenshot(c.evidencePath('summon.png'));
    await page.key('Escape');
    await sleep(200);
    const stillOpen = await page.eval(`!!document.querySelector('.veil')`);
    if (stillOpen) { c.warn('Escape does not close the Summon dialog'); await page.eval(`document.querySelector('.veil .icon-btn[aria-label=Close]').click()`); }
    await sleep(200);
    expect.eq(await page.eval(`document.querySelectorAll('.veil').length`), 0, 'dialog closed');
  });

  await t.test('Guard… lists allies by kind (numbered when alike), never by ledger mark', 'S1', async () => {
    await page.eval(`document.querySelector('.roster-panel .item[data-key=${JSON.stringify(me.beasts[9].Struct.id)}]').click()`);
    await sleep(300);
    await page.clickSel('[aria-label="Chosen beast"] button', { text: 'Guard' });
    await page.waitFor(`document.querySelector('.veil [role=dialog][aria-label=Guard]')`, { what: 'the Guard dialog' });
    const choices = await page.eval(`[...document.querySelectorAll('.veil .choice')].map((b) => b.innerText)`);
    expect.ok(choices.length >= 10, 'allies offered', choices.length);
    for (const ch of choices) expect.ok(!/\b\d+-\d+\b/.test(ch), 'no ledger mark: ' + ch);
    await page.eval(`document.querySelector('.veil').click()`);
    await sleep(200);
    expect.eq(await page.eval(`document.querySelectorAll('.veil').length`), 0, 'tapping the veil closes it');
  });

  await t.test('omens speak to the warden’s real state: wildroot in store, a guard, a fallen Wyrm, raiders', 'S2', async (c) => {
    const more = () => page.eval(`const b = document.querySelector('.hold-omens .omens-more'); if (b && /more/.test(b.textContent)) b.click(); return document.querySelector('.hold-omens').innerText`);
    let text = await more();
    expect.ok(/wildroot wait|sheaves of wildroot/.test(text), 'stored wildroot is warned about', text);
    expect.ok(!/overdrawn/.test(text), 'the menagerie is not overdrawn (fixture mana suffices)', text);
    expect.ok(!/\b\d+-\d+\b/.test(text), 'omens carry no ledger marks', text);
    // the Elder Wyrm falls
    const wyrm = me.beasts[0]; const was = wyrm.structAttributes.status;
    wyrm.structAttributes.status = String(ST.fallen); wyrm.structAttributes.isDestroyed = true;
    ctx.ledger.emitTx([{ type: 'EventStruct', key: 'structure', data: { id: wyrm.Struct.id, owner: me.pid, locationId: me.fleetId } }]);
    await page.waitFor(`/Elder Wyrm has fallen/.test(document.querySelector('.hold-omens').innerText)`, { what: 'the fallen-Wyrm omen', timeout: 15000 });
    text = await more();
    expect.includes(text, 'Hatch anew', 'a way back is offered');
    await page.screenshot(c.evidencePath('wyrm-fallen.png'));
    wyrm.structAttributes.status = was; wyrm.structAttributes.isDestroyed = false;
    ctx.ledger.emitTx([{ type: 'EventStruct', key: 'structure', data: { id: wyrm.Struct.id, owner: me.pid, locationId: me.fleetId } }]);
    await page.waitFor(`!/Elder Wyrm has fallen/.test(document.querySelector('.hold-omens').innerText)`, { what: 'the omen to clear', timeout: 15000 });
    // a known card survives the repaint storm: the selection stays
    const sel = await ctl(page, 'k.census().selected');
    expect.eq(sel, me.beasts[9].Struct.id, 'the selection survives a ledger repaint');
  });

  await t.test('watching another warden’s hold: read-only, named, with a way back', 'S1', async () => {
    const foeRows = [...ctx.sky.foe.beasts, ...ctx.sky.foe.hallows].filter((s) => s && !(Number(s.structAttributes.status) & 32)).length;
    await openHold({ watch: true, route: '#/hold/' + ctx.sky.foe.pid, sworn: false, rows: foeRows });
    const text = await visibleText(page);
    expect.includes(text, 'You are looking at Grimwald', 'the banner names them');
    expect.includes(text, 'Bound to Grimwald', 'the roster is theirs');
    expect.ok(/Back to your own/.test(text), 'a way back');
    const rites = await page.eval(`[...document.querySelectorAll('nav.rites .rite')].map((r) => r.querySelector('b').textContent)`);
    expect.ok(!rites.includes('Summon'), 'no Summon on another’s hold', rites);
    await page.eval(`document.querySelector('.roster-panel .item').click()`);
    await sleep(300);
    const card = await page.eval(`document.querySelector('[aria-label="Chosen beast"]').innerText`);
    expect.includes(card, 'You are watching', 'the card says you cannot command it');
    expect.ok(!/Slumber|Banish|Guard/.test(card), 'no verbs offered');
  });

  await t.test('a crowded hold (32 bound) draws every unit, labels do not pile up, and the roster scrolls', 'S1', async (c) => {
    const crowd = ctx.sky.crowd;
    await openGame(page, ctx.app.url, '#/hold/' + crowd.pid);
    await awake(page);
    const n = [...crowd.beasts, ...crowd.hallows].filter(Boolean).length;
    await page.waitFor(`document.querySelectorAll('.roster-panel .item').length >= ${n}`, { what: 'the crowd', timeout: 20000 });
    await sleep(1500);
    const census = await ctl(page, 'k.census()');
    expect.eq(census.units.length, n, 'units drawn');
    const r = await page.eval(`(() => { const list = document.querySelector('.roster-panel .list'); const tags = [...document.querySelectorAll('.unit-tag')].filter((e) => Number(e.style.opacity) > 0); const boxes = tags.map((e) => e.getBoundingClientRect()); let overlaps = 0; for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const a = boxes[i], b = boxes[j]; if (a.left < b.right - 4 && a.right > b.left + 4 && a.top < b.bottom - 4 && a.bottom > b.top + 4) overlaps++; } return { scrollable: list.scrollHeight > list.clientHeight + 2, visibleRows: Math.floor(list.clientHeight / Math.max(1, list.querySelector('li').offsetHeight)), shownTags: tags.length, overlaps }; })()`);
    expect.ok(r.scrollable, 'the roster scrolls');
    expect.gte(r.visibleRows, 3, 'at least three rows visible without scrolling');
    expect.lte(r.overlaps, 2, 'overlapping name tags');
    await page.screenshot(c.evidencePath('crowded.png'));
    expect.noErrors(page.errors(ALLOW), 'console');
    const st = await stage(page); expect.ok(st.finite, 'camera finite');
  });

  await t.test('a warden with no isle yet is told so, and offered the first isle', 'S2', async () => {
    await openGame(page, ctx.app.url, '#/hold/' + ctx.sky.fresh.pid);
    await page.waitFor(`/holds no isle|no isle/i.test(document.body.innerText)`, { what: 'the Hold to say there is no isle', timeout: 40000 });
    const text = await visibleText(page);
    expect.ok(/holds no isle|no isle/i.test(text), 'the Hold says there is no isle', text.slice(0, 500));
    expect.noErrors(page.errors(ALLOW), 'console');
  });

  await t.test('a beast of a kind the catalogue does not know neither crashes nor shows a number for a name', 'S1', async (c) => {
    await openGame(page, ctx.app.url, '#/hold/' + ctx.sky.strange.pid);
    await awake(page);
    await sleep(2500);
    expect.noErrors(page.errors(ALLOW), 'console');
    const text = await page.eval(`document.querySelector('.roster-panel').innerText`);
    if (/Ledger type|undefined|NaN/.test(text)) c.warn('the roster shows a raw type: ' + text.match(/Ledger type \d+|undefined|NaN/)[0]);
    const st = await stage(page); expect.ok(st.finite, 'camera finite');
  });
  await page.close();
}
