/* Clarity & tongue: what the warden reads on every screen. No ledger marks, no engine words, no
 * "undefined", every control named, every number with a unit, every glossed term explained. */
import { expect } from '../lib/report.mjs';
import { openGame, awake, go, visibleText, ROUTES, sleep, ALLOW } from '../lib/game.mjs';
import { ST } from '../lib/world.mjs';

const ENGINE = /\b(structs?|planets?|fleets?|guilds?|wallet|energy|reactors?|substations?|infusions?|allocations?|players?|testnet|blockchain|mempool|proof[- ]of[- ]work|hash(?:es|ing)?|tx|txs|transactions?|gas|kW|mW|command ship|battleship|starfighter|frigate|tank|cruiser|destroyer|submersible|ore extractor|ore refinery|lcd|rpc|websocket|json|undefined|NaN|null|\[object Object\])\b/i;
const IDS = /(?:^|[^\w.])(\d+-\d+)(?![\w-])/g;

export default async function (t, ctx) {
  const page = await ctx.newPage();
  const screens = [['gate', '#/'], ['hold', '#/hold'], ['hold (watching Grimwald)', '#/hold/' + ctx.sky.foe.pid], ['bestiary', '#/bestiary/10'], ['atlas', '#/atlas'], ['skirmish', '#/skirmish/' + ctx.sky.foe.pid], ['leyweave', '#/leyweave'], ['grimoire', '#/grimoire']];
  await openGame(page, ctx.app.url, '#/hold', { sworn: true, playerId: ctx.sky.me.pid });
  for (const [name, route] of screens) {
    await t.test(`${name}: the visible words are the realm’s own (no ids, no engine words, no undefined)`, 'S2', async (c) => {
      await go(page, route); await awake(page); await sleep(1800);
      const text = await visibleText(page);
      const words = [...new Set((text.match(ENGINE) || []).map((w) => w.toLowerCase()))];
      // "Warden 1-23" is the realm's own name for a nameless warden; any other mark is a leak
      const ids = [...text.matchAll(IDS)].map((m) => m[1]).filter((id) => !new RegExp(`Warden ${id}`).test(text));
      expect.eq(words.length, 0, 'engine words on screen', words.map((w) => { const i = text.toLowerCase().indexOf(w); return `“${w}” in “…${text.slice(Math.max(0, i - 40), i + 40).replace(/\s+/g, ' ')}…”`; }));
      expect.eq([...new Set(ids)].length, 0, 'ledger marks on screen', [...new Set(ids)].map((id) => { const i = text.indexOf(id); return `${id} in “…${text.slice(Math.max(0, i - 40), i + 40).replace(/\s+/g, ' ')}…”`; }));
      // the veil-guard heals engine words at the last moment; anything it healed is a leak upstream
      const healed = await page.eval(`window.__veilLog ? window.__veilLog() : []`);
      if (healed.length) c.warn(`the veil-guard had to retell ${healed.length} string(s) on the way to this screen`, healed.slice(0, 6));
      const attrs = await page.eval(`[...document.querySelectorAll('#app [title], #app [aria-label]')].map((e) => (e.getAttribute('title') || '') + ' ' + (e.getAttribute('aria-label') || '')).join(' | ')`);
      const attrWords = [...new Set((attrs.match(ENGINE) || []).map((w) => w.toLowerCase()))];
      if (attrWords.length) c.warn('engine words in titles/labels: ' + attrWords.join(', '));
    });
  }
  await t.test('every button and link has words or a name; no control is a bare icon', 'S2', async () => {
    const bad = [];
    for (const [name, route] of screens) {
      await go(page, route); await awake(page); await sleep(800);
      const r = await page.eval(`[...document.querySelectorAll('button, a[href], [role=button]')].filter((e) => e.offsetParent !== null).map((e) => ({ tag: e.tagName, text: (e.innerText || '').trim(), label: e.getAttribute('aria-label') || e.getAttribute('title') || '', cls: e.className })).filter((e) => !e.text && !e.label)`);
      for (const x of r) bad.push(`${name}: <${x.tag.toLowerCase()} class="${x.cls}">`);
    }
    expect.eq(bad.length, 0, 'nameless controls', bad);
  });
  await t.test('numbers on the Hold carry their units (mana, breath, sheaves, hearts); nothing reads as a bare figure', 'S2', async (c) => {
    await go(page, '#/hold'); await awake(page); await sleep(1500);
    await page.eval(`document.querySelector('.roster-panel .item').click()`); await sleep(300);
    // a figure that stands alone, outside a labelled fact (dt/dd) or a meter, says nothing on its own
    const bare = await page.eval(`(() => { const out = []; const w = document.createTreeWalker(document.querySelector('#app'), NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) { const t = n.nodeValue.trim(); const e = n.parentElement; if (!/^\\d[\\d,.]*$/.test(t) || !e || e.offsetParent === null) continue; if (e.closest('dd, .meter, .chip, .n, .hearts, .rite-mark, .stepper, .herald-n, .unit-tag, .mono, i')) continue; out.push(t + ' in <' + e.tagName.toLowerCase() + ' class="' + e.className + '">'); } return out; })()`);
    if (bare.length) c.warn('figures with no label beside them', bare.slice(0, 8));
    const meters = await page.eval(`[...document.querySelectorAll('.topbar .meter')].map((m) => m.getAttribute('aria-label'))`);
    expect.gte(meters.length, 2, 'the top bar has meters', meters);
    for (const m of meters) expect.ok(/Press to learn what it means/.test(m) && /\w+, .+/.test(m), 'a meter explains itself: ' + m);
  });
  await t.test('the top bar’s link state speaks plainly: live, connecting, and quiet', 'S2', async () => {
    await go(page, '#/hold'); await sleep(500);
    const live = await page.eval(`document.querySelector('.topbar').innerText`);
    expect.ok(/the sky is awake/.test(live), 'live state wording', live.slice(0, 120));
    ctx.ledger.faults.wsDown = true; ctx.ledger.dropSockets();
    await page.waitFor(`!/the sky is awake/.test(document.querySelector('.topbar').innerText)`, { what: 'a quiet-sky state', timeout: 20000 });
    const down = await page.eval(`document.querySelector('.topbar').innerText.match(/^.*\\n(.*)$/m)[1]`);
    expect.ok(!/down|offline|websocket|rpc|error/i.test(down), 'the quiet state is said in the realm’s words: ' + down);
    ctx.ledger.faults.wsDown = false;
    await page.waitFor(`/the sky is awake/.test(document.querySelector('.topbar').innerText)`, { what: 'the sky to wake again', timeout: 40000 });
  });
  await t.test('the help scroll opens from the top bar and names the seven places', 'S2', async () => {
    await page.clickSel('.help-btn');
    await page.waitFor(`document.querySelector('.veil [role=dialog]')`, { what: 'the help dialog' });
    try {
      const text = await page.eval(`document.querySelector('.veil [role=dialog]').innerText`);
      const missing = ['Hold', 'Atlas', 'Skirmish', 'Leyweave', 'Bestiary', 'Grimoire'].filter((w) => !text.includes(w));
      expect.eq(missing.length, 0, 'places the help scroll never names', missing);
      expect.ok(!ENGINE.test(text), 'help speaks the realm’s tongue', text.match(ENGINE));
      await page.key('Escape'); await sleep(300);
      expect.ok(!(await page.eval(`!!document.querySelector('.veil')`)), 'Escape closes the help scroll');
    } finally { await page.eval(`document.querySelectorAll('.veil').forEach((v) => v.remove())`); }
  });
  await t.test('a meter’s gloss opens on press, explains the number, and closes on Escape', 'S2', async () => {
    await page.clickSel('.topbar .meter');
    await page.waitFor(`document.querySelector('.gloss')`, { what: 'the gloss' });
    const text = await page.eval(`document.querySelector('.gloss').innerText`);
    expect.ok(text.length > 40, 'the gloss explains', text);
    expect.ok(!ENGINE.test(text), 'in the realm’s tongue', text.match(ENGINE));
    await page.key('Escape'); await sleep(300);
    expect.ok(!(await page.eval(`!!document.querySelector('.gloss')`)), 'Escape closes the gloss');
  });
  /* Six of seven persona playtesters (2026-10-13) read "Sung by this browser while Wyrmhodl is open" under a
   * "~26 h" delve as "nothing happens while my phone is in my pocket", and learned it after the oath. In truth a
   * chant's bar falls with the bells whether or not Wyrmhodl is open; a delve is ripe in about half a day. */
  await t.test('How to play says how long things take, that chants ripen while Wyrmhodl is closed, and that unbrewed wildroot can be stolen', 'S2', async () => {
    await go(page, '#/hold'); await sleep(400);
    await page.clickSel('.help-btn');
    await page.waitFor(`document.querySelector('.veil [role=dialog]')`, { what: 'the help dialog' });
    try {
      const text = await page.eval(`document.querySelector('.veil [role=dialog]').innerText.replace(/\\s+/g, ' ')`);
      expect.ok(/minutes to hours/.test(text) && /hours to delve and brew/.test(text), 'the four moves say how long things take', text.slice(0, 600));
      expect.ok(/ripen even while Wyrmhodl is closed/.test(text) && /come back to finish them/.test(text), 'chants ripen while closed, and the warden comes back to finish them', text.slice(0, 900));
      expect.ok(/raiders can steal it/.test(text), 'unbrewed wildroot can be stolen in the meantime');
      expect.ok(/spare strength/.test(text) && /warm a phone/.test(text), 'what an open Wyrmhodl costs this device is said plainly');
      expect.ok(!/thread and lantern|only while|while Wyrmhodl is open\./i.test(text), 'nothing says chants stop when Wyrmhodl is closed', text.match(/thread and lantern|only while|while Wyrmhodl is open\./i));
    } finally { await page.eval(`document.querySelectorAll('.veil').forEach((v) => v.remove())`); }
  });
  await t.test('the Incantations panel tells the truth about time: chants ripen while Wyrmhodl is closed, each says when, and a drawn circle is not the chant', 'S2', async (c) => {
    const { addWarden } = ctx.worldLib, w = ctx.sky.w;
    // a warden of their own: a long summoning (the Barrow Vault), a delve and a brew, all just begun
    const nw = addWarden(w, { name: 'Chanter', guildId: ctx.sky.guilds.hearth.id, beasts: [[1]], hallows: [[14], [15], [18, ST.building]], ore: 2, planetOre: 5 });
    const pa = w.planets.get(nw.planetId).planetAttributes;
    pa.blockStartOreMine = String(w.height - 3); pa.blockStartOreRefine = String(w.height - 3);
    const p2 = await ctx.newPage();
    w.anyAddressPlayer = nw.pid;
    try {
      await openGame(p2, ctx.app.url, '#/hold', { sworn: true, playerId: nw.pid });
      await awake(p2);
      const PANEL = `document.querySelector('section[aria-label=Incantations]')`;
      await p2.waitFor(`${PANEL} && !${PANEL}.hidden && ${PANEL}.querySelectorAll('.chant').length >= 3`, { what: 'three chants in the Incantations panel', timeout: 40000 });
      await sleep(1500);
      const r = await p2.eval(`(() => { const s = ${PANEL}; return { text: s.innerText.replace(/\\s+/g, ' '), rows: [...s.querySelectorAll('.chant')].map((li) => li.innerText.replace(/\\s+/g, ' ')), bars: [...s.querySelectorAll('.chant [role=progressbar]')].map((b) => Number(b.getAttribute('aria-valuenow'))), live: s.querySelectorAll('[aria-live], [role=status]').length, chips: [...s.querySelectorAll('.chips button')].map((b) => ({ text: b.textContent.trim(), pressed: b.getAttribute('aria-pressed') })) }; })()`);
      await p2.screenshot(c.evidencePath('incantations.png'));
      expect.ok(/ripen even while Wyrmhodl is closed/.test(r.text) && /come back to finish them in moments/.test(r.text), 'the panel says chants ripen while Wyrmhodl is closed', r.text);
      expect.ok(!/while Wyrmhodl is open\.|Sung by this|done within|sooner with luck|browser/i.test(r.text), 'nothing says chants stop when Wyrmhodl is closed, or gives only an upper bound', r.text);
      const row = (re) => r.rows.find((x) => re.test(x)) || '';
      const summon = row(/Summoning chant · Barrow Vault/), delve = row(/Delving chant · Root Delver/), brew = row(/Brewing chant · Dawn Cauldron/);
      expect.ok(/Circle drawn · ripe /.test(summon), 'the summoning says its circle is drawn and its chant ripens', r.rows);
      expect.ok(/Next sheaf · ripe /.test(delve) && /Next alpha · ripe /.test(brew), 'the delve and the brew say what they ripen into', r.rows);
      // when, as a person says it: "ripe in ~40 min", "ripe tonight (~9 h)"
      const WHEN = /ripe (in ~\d+ (min|h)|(this \w+|tonight|late tonight|before dawn|tomorrow \w+|\w+day \w+) \(~\d+ (min|h|days)\))/;
      for (const x of [summon, delve, brew]) expect.ok(WHEN.test(x) && !/bell/.test(x), 'each chant says when it will be ripe, in time a person can feel: ' + x);
      const hours = (x) => Number((x.match(/~(\d+) h\b/) || [])[1]);
      expect.ok(hours(delve) >= 5 && hours(delve) <= 15, 'a delve is ripe in about half a day, not the old “~26 h” bound', delve);
      expect.ok(hours(brew) >= 10 && hours(brew) <= 26, 'a brew is ripe in most of a day, not the old “~2 days” bound', brew);
      expect.ok(r.bars.length >= 3 && r.bars.every((n) => n >= 0 && n <= 100), 'each chant is a progress bar a screen reader can read', r.bars);
      expect.eq(r.live, 0, 'the panel announces nothing by itself (no live region inside it)');
      // chanting gently: one press, remembered, and the other press undoes it
      expect.eq(JSON.stringify(r.chips.map((x) => x.text)), JSON.stringify(['Chant gently', 'Chant with all my strength']), 'the two ways to chant');
      expect.eq(r.chips.filter((x) => x.pressed === 'true').length, 1, 'one way is chosen', r.chips);
      const POW = `(await import('/src/pow/pow.ts')).pow.settings`;
      const press = (label) => p2.eval(`[...document.querySelectorAll('section[aria-label=Incantations] .chips button')].find((b) => b.textContent.includes(${JSON.stringify(label)})).click()`);
      await press('Chant gently'); await sleep(300);
      const soft = await p2.eval(`({ s: ${POW}, saved: JSON.parse(localStorage.getItem('wyrmhold.chant') || '{}'), pressed: document.querySelector('section[aria-label=Incantations] .chips button').getAttribute('aria-pressed') })`);
      expect.ok(soft.s.threads === 1 && soft.s.engine === 'cpu' && soft.saved.threads === 1 && soft.pressed === 'true', 'Chant gently uses one thread and no lantern, and is remembered', soft);
      await press('with all my strength'); await sleep(300);
      const full = await p2.eval(`${POW}`);
      expect.ok(full.threads >= 1 && full.engine === 'auto', 'Chant with all my strength goes back to the device’s spare strength', full);
      expect.noErrors(p2.errors(ALLOW), 'console');
    } finally { w.anyAddressPlayer = ctx.sky.me.pid; await p2.close(); }
  });
  await page.close();
}
