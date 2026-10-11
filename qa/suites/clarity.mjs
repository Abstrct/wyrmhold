/* Clarity & tongue: what the warden reads on every screen. No ledger marks, no engine words, no
 * "undefined", every control named, every number with a unit, every glossed term explained. */
import { expect } from '../lib/report.mjs';
import { openGame, awake, go, visibleText, ROUTES, sleep } from '../lib/game.mjs';

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
  await page.close();
}
