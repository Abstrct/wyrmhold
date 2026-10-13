#!/usr/bin/env node
/* Captures of the Skirmish in the arena, for design review. Runs headless Chrome on this machine's GPU.
 *
 *   node qa/arena-shots.mjs OUT_DIR before    # the old screen: pick both Wyrms by hand, strike once
 *   node qa/arena-shots.mjs OUT_DIR after     # the new one: home, in their sky, a blow landing, the fray,
 *                                             # their Wyrm marked, their ward broken, the raid won
 *   node qa/arena-shots.mjs OUT_DIR devices   # a phone and a short laptop in their sky
 *   node qa/arena-shots.mjs OUT_DIR fun       # guard your Wyrm, Fight on, the raid's tale, scouting */
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launchChrome, sleep } from './lib/cdp.mjs';
import { startArena } from './arena.mjs';

const out = resolve(process.argv[2] || 'qa/reports/arena-shots');
const prefix = process.argv[3] || 'after';
mkdirSync(out, { recursive: true });
const a = await startArena({ port: 5196, calm: true, log: () => {} });
const browser = await launchChrome({ extraArgs: ['--use-angle=metal'] });
const QUIET = { 'wyrmhold.prologue': 'seen', 'wyrmhold.tour.hold': 'seen', 'wyrmhold.path.hidden': '1', 'wyrmhold.music': 'off' };
const { w, me, foe } = a.sky;
const shot = (page, name) => page.screenshot(join(out, `${prefix}-${name}.png`));

async function open(page, width, height, mobile = false) {
  await page.setViewport(width, height, { mobile });
  await page.goto(a.app.url + 'qa/blank.html');
  await page.eval(`localStorage.clear(); const st = ${JSON.stringify(QUIET)}; for (const k in st) localStorage.setItem(k, st[k]);`);
  await page.goto(a.app.url + '#/skirmish/' + foe.pid);
  // a cold first load now and then never lifts the boot veil (Vite still optimising): load once more
  const booted = `!document.getElementById('boot') || document.getElementById('boot').classList.contains('gone')`;
  try { await page.waitFor(booted, { timeout: 60000 }); } catch { await page.reload(); await page.waitFor(booted, { timeout: 120000 }); }
  await page.eval(`const { wallet } = await import('/src/wallet/wallet.ts'); if (wallet.state === 'empty') await wallet.createInstant(); await wallet.resolvePlayers();`);
  await page.waitFor(`!!(await import('/src/game/empire.ts')).empire.commander`, { timeout: 60000 });
  await page.waitFor(`[...document.querySelectorAll('#app .stage canvas')].every((c) => c.classList.contains('awake'))`, { timeout: 120000 });
  await sleep(2500);
}
function rideOut() {
  const f = w.fleets.get(me.fleetId), tp = w.planets.get(foe.planetId);
  f.status = 'away'; f.locationId = foe.planetId;
  tp.Planet.locationListStart = f.id; tp.Planet.locationListCount = '1'; tp.planetAttributes.blockStartRaid = String(w.height);
  a.ledger.emitTx([{ type: 'EventFleet', key: 'fleet', data: { id: f.id, owner: me.pid, locationId: foe.planetId } }]);
}
const pickWyrms = (page) => page.eval(`
  const mine = [...document.querySelectorAll('[aria-label="Your warband"] .item')].find((b) => /Elder Wyrm/.test(b.textContent)); if (mine) mine.click();
  await new Promise((r) => setTimeout(r, 300));
  const theirs = [...document.querySelectorAll('[aria-label="Their hold"] .item')].find((b) => /Elder Wyrm/.test(b.textContent)); if (theirs) theirs.click();
  await new Promise((r) => setTimeout(r, 300));`);
const unleash = (page) => page.eval(`const b = [...document.querySelectorAll('button')].find((b) => /^Unleash/.test(b.textContent.trim())); if (b && !b.disabled) b.click(); return !!b && !b.disabled;`);
/** Press the big button whenever a blow is ready, until `until` (a page expression) holds. */
const fight = (page, until, ms = 60000) => page.eval(`const t0 = Date.now(); while (Date.now() - t0 < ${ms}) { if (${until}) return true; const b = document.querySelector('.btn.unleash'); if (b && !b.disabled && /ready/.test(b.textContent)) b.click(); await new Promise((r) => setTimeout(r, 900)); } return false;`, { timeout: ms + 5000 });

try {
  if (prefix === 'fun') {
    // the aids that came after the fixes: guard your Wyrm, Fight on, the raid's tale, scouting in the Atlas
    const page = await browser.newPage({ width: 1440, height: 900 });
    await open(page, 1440, 900);
    await shot(page, '11-guard-prompt');
    await page.eval(`document.querySelector('.wb-guardme button').click()`);
    await sleep(4000);
    await page.eval(`document.querySelector('.btn.unleash').click()`);
    await page.waitFor(`/Fell Grimwald/.test(document.querySelector('.wb-title')?.textContent || '')`, { timeout: 30000 });
    await sleep(2500);
    await page.eval(`document.querySelector('.fight-on').click()`);
    await page.waitFor(`document.querySelectorAll('.fray-row').length >= 3`, { timeout: 60000 }).catch(() => null);
    await sleep(800);
    await shot(page, '12-fight-on');
    await page.waitFor(`/Raid won/.test(document.querySelector('.wb-title')?.textContent || '')`, { timeout: 150000 }).catch(() => null);
    await sleep(7000);   // let the banners pass
    await shot(page, '13-tale');
    await page.eval(`location.hash = '#/atlas/${a.sky.w.players.size >= 3 ? [...a.sky.w.players.values()][2].Player.id : foe.pid}'`);
    await page.waitFor(`document.querySelector('[aria-label="Scouting"]') && /Their Elder Wyrm/.test(document.querySelector('[aria-label="Scouting"]').innerText)`, { timeout: 60000 }).catch(() => null);
    await sleep(2500);
    await shot(page, '14-scout');
  } else if (prefix === 'devices') {
    // a phone and a short laptop, each in their sky after the foe has answered once
    rideOut(); a.foeStrike();
    const phone = await browser.newPage({ width: 390, height: 844 });
    await open(phone, 390, 844, true);
    await sleep(2500);
    await phone.screenshot(join(out, 'after-8-phone.png'));
    await phone.eval(`document.querySelector('.strike-panel')?.scrollIntoView({ block: 'start' });`);
    await sleep(800);
    await phone.screenshot(join(out, 'after-9-phone-strike.png'));
    await phone.close();
    const lap = await browser.newPage({ width: 1280, height: 800 });
    await open(lap, 1280, 800);
    await sleep(1500);
    await lap.screenshot(join(out, 'after-10-laptop.png'));
  } else {
    const page = await browser.newPage({ width: 1440, height: 900 });
    await open(page, 1440, 900);
    await shot(page, '1-home');
    rideOut();
    await sleep(6000);
    // the foe answers twice before we choose
    a.foeStrike(); await sleep(1200); a.foeStrike(); await sleep(2500);
    if (prefix === 'before') {
      await pickWyrms(page); await sleep(800);
      await shot(page, '2-orbit');
      w.height += 10;
      const sent = await unleash(page);
      await sleep(sent ? 2600 : 500);
      await shot(page, '3-blow');
      await sleep(2500);
      await shot(page, '4-after');
    } else {
      await shot(page, '2-orbit');
      w.height += 10;
      await unleash(page);
      // catch the words rising from the struck beast
      await page.waitFor(`document.querySelectorAll('.sk-pop').length > 0`, { timeout: 20000 }).catch(() => null);
      await sleep(350);
      await shot(page, '3-blow');
      await sleep(2500);
      // a few more blows, the foe answering
      await fight(page, `document.querySelectorAll('.fray-row').length >= 4`, 40000);
      a.foeStrike(); await sleep(2500);
      await shot(page, '4-fray');
      // aim at their Wyrm: the forecast says who takes the blow and what comes back
      await page.eval(`const b = [...document.querySelectorAll('[aria-label="Their hold"] .item')].find((b) => /Elder Wyrm/.test(b.textContent)); if (b) b.click();`);
      await sleep(800);
      await shot(page, '5-their-wyrm');
      await fight(page, `/plundering|Raid won/.test(document.querySelector('.wb-title')?.textContent || '')`, 90000);
      await sleep(1200);
      await shot(page, '6-ward-broken');
      await page.waitFor(`/Raid won/.test(document.querySelector('.wb-title')?.textContent || '')`, { timeout: 60000 }).catch(() => null);
      await sleep(1500);
      await shot(page, '7-won');
    }
  }
  console.log('shots in ' + out);
} finally {
  await browser.close();
  await a.stop();
}
