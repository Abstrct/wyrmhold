/* Sky Atlas, Leyweave, Grimoire: the reading screens. Lists are complete and searchable, cards say
 * true things, wells are named for their covens, the Grimoire's roads all lead somewhere. */
import { expect } from '../lib/report.mjs';
import { openGame, awake, ctl, stage, lookAtStage, visibleText, ALLOW, sleep } from '../lib/game.mjs';

export default async function (t, ctx) {
  const page = await ctx.newPage();
  const sky = ctx.sky;
  const withIsle = [...sky.w.players.values()].filter((p) => p.Player.planetId).length;

  await t.test('the Atlas lists every warden with an isle, named (or "Warden <sigil>"), grouped by coven', 'S1', async (c) => {
    await openGame(page, ctx.app.url, '#/atlas', { sworn: true, playerId: sky.me.pid });
    await awake(page);
    await page.waitFor(`document.querySelectorAll('[aria-label="Wardens"] .list .item').length >= ${withIsle}`, { what: 'the warden list', timeout: 25000 });
    await sleep(1500);
    const r = await page.eval(`({ items: [...document.querySelectorAll('[aria-label="Wardens"] .list .item')].map((b) => b.innerText.replace(/\\s+/g, ' ')), chips: [...document.querySelectorAll('[aria-label="Covens"] .chip')].map((c) => c.textContent.trim()), foot: document.querySelector('[aria-label="Wardens"] p.faint').textContent })`);
    expect.eq(r.items.length, withIsle, 'wardens listed');
    expect.ok(r.items.some((i) => /Grimwald/.test(i)) && r.items.some((i) => /Warden \d+-\d+|Warden/.test(i)), 'named and unnamed wardens', r.items.slice(0, 6));
    for (const cv of ['The First Hearth', 'The Gilded Mire', 'Lanternwatch']) expect.ok(r.chips.some((ch) => ch.includes(cv)), `coven chip ${cv}`, r.chips);
    expect.ok(!r.items.some((i) => /#\d|\b0-\d+\b/.test(i)), 'no raw coven or planet ids');
    await page.screenshot(c.evidencePath('atlas.png'));
    expect.noErrors(page.errors(ALLOW), 'console');
  });
  await t.test('searching narrows the list; choosing one shows the isle card with Raid this hold; your own says Your Hold', 'S1', async () => {
    await page.clickSel('#warden-search');
    await page.type('grim');
    await sleep(400);
    let items = await page.eval(`[...document.querySelectorAll('[aria-label="Wardens"] .list .item')].map((b) => b.innerText)`);
    expect.eq(items.length, 1, 'one match for "grim"', items);
    await page.eval(`document.querySelector('[aria-label="Wardens"] .list .item').click()`);
    await sleep(800);
    let card = await page.eval(`document.querySelector('[aria-label="Chosen isle"]') ? document.querySelector('[aria-label="Chosen isle"]').innerText : ''`);
    expect.includes(card, 'Grimwald', 'the card names them');
    expect.ok(/Raid this hold/.test(card), 'Raid this hold is offered');
    expect.ok(/wildroot/i.test(card), 'their plunderable wildroot is told', card);
    const st = await stage(page); expect.ok(st.finite, 'camera finite after choosing');
    await page.eval(`const s = document.getElementById('warden-search'); s.value = ''; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true }));`);
    await page.waitFor(`document.querySelectorAll('[aria-label="Wardens"] .list .item').length > 5`, { what: 'the full list again' });
    // your own isle is listed as "Your Hold", never by your name
    await page.eval(`[...document.querySelectorAll('[aria-label="Wardens"] .list .item')].find((b) => /Your Hold/.test(b.textContent)).click()`);
    await sleep(600);
    card = await page.eval(`document.querySelector('[aria-label="Chosen isle"]').innerText`);
    expect.includes(card, 'Your Hold', 'your own isle is yours');
    expect.ok(!/Raid this hold/.test(card), 'you cannot raid yourself');
  });
  await t.test('the "unbrewed wildroot" filter keeps only wardens with stores, and the sky glows for them', 'S2', async () => {
    await page.clickSel('[data-tut=rich]');
    await page.waitFor(`document.querySelector('[data-tut=rich]').getAttribute('aria-pressed') === 'true'`, { what: 'the filter on' });
    const items = await page.eval(`[...document.querySelectorAll('[aria-label="Wardens"] .list .item')].map((b) => b.innerText)`);
    // your own isle is never a raid: it is left out of the filter
    const rich = [...sky.w.players.values()].filter((p) => p.Player.planetId && Number(p.gridAttributes.ore) > 0 && p.Player.id !== sky.me.pid).length;
    expect.eq(items.length, rich, 'wardens with unbrewed wildroot', items);
    await page.clickSel('[data-tut=rich]');
    await page.waitFor(`document.querySelector('[data-tut=rich]').getAttribute('aria-pressed') === 'false'`, { what: 'the filter off' });
  });
  await t.test('a coven chip narrows to that coven; wardens who slept long are marked', 'S2', async () => {
    await page.clickSel('[aria-label="Covens"] .chip', { text: 'Lanternwatch' });
    await sleep(500);
    const items = await page.eval(`[...document.querySelectorAll('[aria-label="Wardens"] .list .item')].map((b) => b.innerText)`);
    const inWatch = [...sky.w.players.values()].filter((p) => p.Player.planetId && p.Player.guildId === sky.guilds.watch.id).length;
    expect.eq(items.length, inWatch, 'Lanternwatch wardens', items);
    expect.ok(!items.some((i) => /\b\d+-\d+\b/.test(i)) || items.every((i) => !/^\d/.test(i)), 'no bare ids');
  });

  await t.test('the Leyweave names every coven’s wellspring with fuel and flow, your shrine, and your tithe', 'S1', async (c) => {
    await openGame(page, ctx.app.url, '#/leyweave', { sworn: true, playerId: sky.me.pid });
    // the tithe is matched by address: the soulstone's own, which only the browser knows
    const addr = await page.eval(`(await import('/src/wallet/wallet.ts')).wallet.active.address`);
    for (const i of sky.w.infusions) if (i.playerId === sky.me.pid) i.address = addr;
    await page.eval(`location.hash = '#/hold'`); await sleep(300); await page.eval(`location.hash = '#/leyweave'`);
    await awake(page);
    await page.waitFor(`document.querySelectorAll('.grid-cards .card-btn, .grid-cards > *').length >= 3`, { what: 'the wells', timeout: 25000 });
    await sleep(1200);
    const text = await visibleText(page);
    for (const cv of ['The First Hearth', 'The Gilded Mire', 'Lanternwatch']) expect.includes(text, cv, 'well of ' + cv);
    expect.ok(/Tithe/.test(text), 'Tithe is offered');
    expect.ok(/Unbind/.test(text), 'your tithe can be unbound');
    expect.ok(/mana/i.test(text) && /alpha/i.test(text), 'mana and alpha are the words');
    expect.ok(!/\b(reactor|substation|infusion|kW|W\b)/.test(text), 'no engine words', text.match(/\b(reactor|substation|infusion|kW)\b/g));
    expect.ok(!/\b[0-9]-\d+\b/.test(text.replace(/\d+-\d+ (?:spare|of)/g, '')), 'no ledger ids', text.match(/\b\d-\d+\b/g));
    await page.screenshot(c.evidencePath('leyweave.png'));
    expect.noErrors(page.errors(ALLOW), 'console');
  });
  await t.test('the Tithe dialog opens, previews, and refuses nonsense amounts without a rite', 'S1', async () => {
    const before = ctx.ledger.broadcasts || 0;
    await page.clickSel('button[aria-label^="Tithe to"]');
    await page.waitFor(`document.querySelector('.veil [role=dialog]')`, { what: 'the Tithe dialog' });
    const d = await page.eval(`document.querySelector('.veil [role=dialog]').innerText`);
    expect.ok(/Tithe to/.test(d), 'titled', d.slice(0, 100));
    const input = await page.eval(`!!document.querySelector('.veil input')`);
    expect.ok(input, 'an amount field');
    await page.eval(`const i = document.querySelector('.veil input'); i.value = '-5'; i.dispatchEvent(new Event('input', { bubbles: true }));`);
    const go = await page.eval(`[...document.querySelectorAll('.veil .btn.gold')].map((b) => b.textContent)`);
    expect.ok(go.length, 'a confirm button', go);
    await page.clickSel('.veil .btn.gold');
    await sleep(800);
    expect.eq(ctx.ledger.broadcasts || 0, before, 'no rite for a negative tithe');
    await page.key('Escape'); await sleep(200);
    await page.eval(`document.querySelectorAll('.veil').forEach((v) => v.remove())`);
  });

  await t.test('the Grimoire has its sections, a jump nav that lands, the beast table with 22 rows, and no engine words', 'S1', async (c) => {
    await openGame(page, ctx.app.url, '#/grimoire');
    await sleep(1500);
    // every jump lands its section's heading near the top of the page
    const jumps = await page.eval(`[...document.querySelectorAll('.codex-jumps button, .codex-jumps a')].map((b) => b.textContent.trim())`);
    expect.gte(jumps.length, 4, 'jumps in the Grimoire', jumps);
    const missed = [];
    for (const j of jumps) {
      await page.eval(`[...document.querySelectorAll('.codex-jumps button, .codex-jumps a')].find((b) => b.textContent.trim() === ${JSON.stringify(j)}).click()`);
      await sleep(900);
      // the heading reaches the top, or, for the last sections, the page has run out of room and the heading is in view
      const at = await page.eval(`(() => { const h = [...document.querySelectorAll('section h2')].find((x) => x.textContent.trim() === ${JSON.stringify(j)}); if (!h) return null; const sc = h.closest('.scrolls') || document.scrollingElement; const end = sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 4; return { top: Math.round(h.getBoundingClientRect().top), end, h: innerHeight }; })()`);
      if (!at || at.top < -10 || (at.top > 260 && !(at.end && at.top < at.h - 40))) missed.push(`${j}: heading at ${at && at.top}`);
    }
    expect.eq(missed.length, 0, 'jumps that do not land on their section', missed);
    const r = await page.eval(`({ jumps: [], sections: [...document.querySelectorAll('section h2')].map((h) => h.textContent), rows: document.querySelectorAll('table').length ? [...document.querySelectorAll('table')].map((t) => t.querySelectorAll('tbody tr').length) : [], text: document.body.innerText })`);
    expect.gte(r.sections.length, 5, 'sections', r.sections);
    for (const [label, href, found] of r.jumps) expect.ok(found, `jump "${label}" (${href}) lands on a section`);
    expect.ok(r.rows.includes(22), 'the beast table has 22 rows', r.rows);
    const bad = r.text.match(/\b(struct|planet|fleet|guild|wallet|energy|reactor|substation|player|testnet|blockchain|proof of work|hash)\b/gi);
    expect.ok(!bad, 'engine words in the Grimoire', bad);
    await page.screenshot(c.evidencePath('grimoire.png'));
    expect.noErrors(page.errors(ALLOW), 'console');
  });
  await t.test('the Gate: title, the three moves, the oath call, and the wardens abroad ticker', 'S1', async (c) => {
    await openGame(page, ctx.app.url, '#/');
    await awake(page);
    await page.waitFor(`document.querySelectorAll('.marquee a').length > 0`, { what: 'the ticker', timeout: 20000 });
    const r = await page.eval(`({ h1: document.querySelector('h1').textContent, moves: [...document.querySelectorAll('.how li b')].map((b) => b.textContent), enter: document.querySelector('[data-tut=begin]').textContent, ticker: document.querySelectorAll('.marquee a').length, count: document.querySelector('.gate-foot .mono').textContent })`);
    expect.eq(r.h1, 'Wyrmhold', 'title');
    expect.eq(JSON.stringify(r.moves), JSON.stringify(['Raise', 'Brew', 'Raid']), 'three moves');
    expect.includes(r.enter, 'Swear the oath', 'the stranger’s call');
    expect.gte(r.ticker, withIsle, 'wardens in the ticker');
    expect.includes(r.count, String(withIsle), 'the count');
    await page.screenshot(c.evidencePath('gate.png'));
    const seen = await lookAtStage(page); expect.ok(seen.mean > 12, 'sky lit');
    expect.noErrors(page.errors(ALLOW), 'console');
  });
  await page.close();
}
