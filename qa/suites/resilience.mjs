/* Resilience: the ledger goes quiet, slow, or wrong; the live feed drops; data arrives that the
 * client never expected. The warden must always be told plainly, offered a way on, and never crash. */
import { expect } from '../lib/report.mjs';
import { openGame, awake, go, stage, visibleText, ALLOW, sleep } from '../lib/game.mjs';

export default async function (t, ctx) {
  const page = await ctx.newPage();
  const L = ctx.ledger;
  const reset = () => { L.faults = { down: false, latencyMs: 0, failPaths: [], failStatus: 503, wsDown: false }; L.paused = false; };

  await t.test('ledger down from the start: the Hold says it is not answering and offers "Try again"; the Atlas and Leyweave say so too', 'S1', async (c) => {
    L.faults.down = true;
    await openGame(page, ctx.app.url, '#/hold', { sworn: false, waitBoot: true });
    // a sworn warden whose ledger is silent: seed the soulstone with the vault only (no resolve)
    await page.eval(`const { wallet } = await import('/src/wallet/wallet.ts'); if (wallet.state === 'empty') await wallet.createInstant(); wallet.setAccount(0, { playerId: ${JSON.stringify(ctx.sky.me.pid)} }); return true`);
    await sleep(1000);
    let text = await visibleText(page);
    expect.ok(/Reading your hold|not answering/.test(text), 'the Hold explains the wait', text.slice(0, 300));
    await page.waitFor(`/not answering/.test(document.body.innerText)`, { what: 'the honest "not answering" after the patience runs out', timeout: 20000 });
    text = await visibleText(page);
    expect.includes(text, 'Try again', 'a way to ask again');
    await page.screenshot(c.evidencePath('hold-ledger-down.png'));
    await go(page, '#/atlas'); await sleep(2500);
    text = await visibleText(page);
    expect.ok(/quiet|not answering|could not|again/i.test(text), 'the Atlas says the ledger is quiet', text.slice(0, 400));
    await go(page, '#/leyweave'); await sleep(2500);
    text = await visibleText(page);
    expect.ok(/quiet|not answering|could not|again|Reading/i.test(text), 'the Leyweave says so too', text.slice(0, 400));
    // Firefox words a dropped connection as a blocked cross-origin read ("CORS request did not succeed")
    expect.noErrors(page.errors([...ALLOW, /Failed to fetch|ERR_CONNECTION|net::|CORS request did not succeed|NetworkError when attempting to fetch/]), 'console (network failures are expected, exceptions are not)');
    const st = await stage(page); expect.ok(!st || st.finite, 'camera finite');
  });
  await t.test('…and when the ledger returns, the screens recover on their own', 'S1', async () => {
    reset();
    await go(page, '#/hold');
    await page.waitFor(`document.querySelectorAll('.roster-panel .item').length > 5`, { what: 'the hold to be read once the ledger answers', timeout: 40000 });
    await go(page, '#/atlas');
    await page.waitFor(`document.querySelectorAll('[aria-label="Wardens"] .list .item').length > 5`, { what: 'the atlas to recover', timeout: 40000 });
  });
  await t.test('a slow ledger (3 s per answer): one sky, one roster, no duplicate scenes', 'S1', async () => {
    L.faults.latencyMs = 3000;
    await openGame(page, ctx.app.url, '#/hold', { sworn: true, playerId: ctx.sky.me.pid });
    await awake(page);
    await page.waitFor(`document.querySelectorAll('.roster-panel .item').length > 5`, { what: 'the roster', timeout: 60000 });
    await sleep(4000);
    const r = await page.eval(`({ canvases: document.querySelectorAll('#app canvas').length, rosters: document.querySelectorAll('.roster-panel').length, tagBoxes: document.querySelectorAll('.unit-tags').length })`);
    expect.eq(r.canvases, 1, 'one canvas'); expect.eq(r.rosters, 1, 'one roster'); expect.lte(r.tagBoxes, 1, 'one tag box');
    reset();
  });
  await t.test('the ledger answers 503 for structs: the hold still reads what it can and throws nothing', 'S1', async () => {
    L.faults.failPaths = [/\/structs\/struct\//];
    await openGame(page, ctx.app.url, '#/hold', { sworn: false });
    await page.eval(`const { wallet } = await import('/src/wallet/wallet.ts'); if (wallet.state === 'empty') await wallet.createInstant(); await wallet.resolvePlayers(); return true`);
    await sleep(6000);
    expect.noErrors(page.errors([...ALLOW, /503|stumbled/]), 'no uncaught exceptions');
    const st = await stage(page); expect.ok(!st || st.finite, 'camera finite');
    reset();
  });
  await t.test('the live feed drops and returns: the top bar says so, and the hold re-reads after the reconnect', 'S1', async () => {
    await openGame(page, ctx.app.url, '#/hold', { sworn: true, playerId: ctx.sky.me.pid });
    await awake(page);
    L.faults.wsDown = true; L.dropSockets();
    await page.waitFor(`!/the sky is awake/.test(document.querySelector('.topbar').innerText)`, { what: 'the quiet state', timeout: 20000 });
    L.faults.wsDown = false;
    await page.waitFor(`/the sky is awake/.test(document.querySelector('.topbar').innerText)`, { what: 'live again', timeout: 40000 });
    const h0 = await page.eval(`(await import('/src/chain/live.ts')).live.height`);
    await sleep(2500);
    const h1 = await page.eval(`(await import('/src/chain/live.ts')).live.height`);
    expect.ok(h1 > h0, 'bells flow again after the reconnect');
    expect.noErrors(page.errors(ALLOW), 'console');
  });
  await t.test('bells stop (a stalled node): the client notices within a minute and does not freeze', 'S2', async (c) => {
    L.paused = true;
    const t0 = Date.now();
    await page.waitFor(`!/the sky is awake/.test(document.querySelector('.topbar').innerText)`, { what: 'the stall to be noticed', timeout: 70000 }).catch(() => c.warn('a stalled feed (no bells for 60 s) is not reported in the top bar'));
    ctx.report.note(`stall noticed after ${Math.round((Date.now() - t0) / 1000)} s`);
    L.paused = false;
    await page.waitFor(`/the sky is awake/.test(document.querySelector('.topbar').innerText)`, { what: 'awake again', timeout: 60000 });
  });
  await t.test('strange data: a struct with no type, a planet that vanished, a fleet pointing nowhere', 'S1', async () => {
    const w = ctx.sky.w, me = ctx.sky.me;
    const odd = { Struct: { id: '5-7777', index: '7777', type: '', creator: 'x', owner: me.pid, locationType: 'fleet', locationId: me.fleetId, operatingAmbit: 'land', slot: '3' }, structAttributes: { health: '3', status: '7' } };
    w.structs.set('5-7777', odd);
    const fleet = w.fleets.get(me.fleetId); fleet.land[3] = '5-7777';
    const planet = w.planets.get(me.planetId); const savedPlanet = planet; w.planets.delete(me.planetId);
    await openGame(page, ctx.app.url, '#/hold', { sworn: true, playerId: me.pid });
    await awake(page); await sleep(3000);
    expect.noErrors(page.errors([...ALLOW, /404|not found/]), 'no uncaught exceptions with a missing planet and a typeless struct');
    const st = await stage(page); expect.ok(st.finite, 'camera finite');
    w.planets.set(me.planetId, savedPlanet); fleet.land[3] = ''; w.structs.delete('5-7777');
  });
  await t.test('a rite the ledger refuses is told back in the realm’s words, with a way to try again', 'S1', async (c) => {
    const w = ctx.sky.w;
    await openGame(page, ctx.app.url, '#/hold', { sworn: true, playerId: ctx.sky.me.pid });
    await awake(page); await page.waitFor(`document.querySelectorAll('.roster-panel .item').length > 5`, { what: 'the roster' }); await sleep(800);
    // a refusal time cannot fix (a charge or network refusal only waits and retries, which is right)
    w.refuse = 'rpc error: code = Unknown desc = struct (5-3) is destroyed and cannot activate';
    try {
    await page.eval(`document.querySelector('.roster-panel .item[data-key=${JSON.stringify(ctx.sky.me.beasts[2].Struct.id)}]').click()`); await sleep(300);
    await page.clickSel('[aria-label="Chosen beast"] button', { text: 'Awaken' });
    await page.waitFor(`/did not land|refused|failed/.test(document.querySelector('[aria-label="Chosen beast"]').innerText + (document.getElementById('heralds') ? document.getElementById('heralds').innerText : ''))`, { what: 'the refusal told', timeout: 40000 });
    const text = await page.eval(`document.querySelector('[aria-label="Chosen beast"]').innerText + '\\n' + (document.getElementById('heralds') ? document.getElementById('heralds').innerText : '')`);
    expect.ok(!/rpc error|code = |desc =|\b5-3\b|\bstruct\b/.test(text), 'the refusal is retold, not quoted', text.slice(-300));
    expect.ok(/Try again|Again/.test(text), 'a way to try again');
    await page.screenshot(c.evidencePath('refused-rite.png'));
    } finally { w.refuse = null; }
  });
  await page.close();
}
