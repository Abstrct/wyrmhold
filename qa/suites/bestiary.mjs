/* Bestiary: every rune on the dais shows its beast, its sheet says true numbers from the catalogue,
 * the deep link holds, and "Watch it summoned" harms nothing. */
import { expect } from '../lib/report.mjs';
import { openGame, awake, stage, lookAtStage, ALLOW, sleep } from '../lib/game.mjs';
import { TYPES } from '../lib/world.mjs';

export default async function (t, ctx) {
  const page = await ctx.newPage();
  await t.test('the index lists all 22 kinds in their realm groups, and "yours ×N" for what you hold', 'S1', async () => {
    await openGame(page, ctx.app.url, '#/bestiary/1', { sworn: true, playerId: ctx.sky.me.pid });
    await awake(page);
    await page.waitFor(`document.querySelectorAll('[aria-label="Bestiary index"] .item').length >= 22`, { what: 'the index' });
    const r = await page.eval(`({ groups: [...document.querySelectorAll('[aria-label="Bestiary index"] h2')].map((h) => h.textContent.trim()), items: [...document.querySelectorAll('[aria-label="Bestiary index"] .item')].map((b) => b.innerText.replace(/\\s+/g, ' ').trim()) })`);
    expect.eq(r.items.length, 22, 'kinds listed');
    for (const g of ['The Bound', 'Starfall', 'Skies', 'Wilds', 'Deeps', 'Hallows']) expect.ok(r.groups.includes(g), 'group ' + g, r.groups);
    expect.ok(r.items.some((i) => /yours ×\d/.test(i)), 'what you hold is marked', r.items.slice(0, 5));
    expect.ok(!r.items.some((i) => /#\d|\b\d+-\d+\b/.test(i)), 'no ids in the index');
  });
  await t.test('every rune shows its beast: sheet named, numbers from the catalogue, sky lit, camera finite', 'S0', async (c) => {
    const dark = [], wrong = [];
    for (const ty of TYPES) {
      await page.eval(`[...document.querySelectorAll('[aria-label="Bestiary index"] .item')].find((b) => b.querySelector('.nm').textContent === ${JSON.stringify(ty.type)}).click()`);
      await sleep(650);
      const r = await page.eval(`({ h1: document.querySelector('[aria-label="Beast lore"] h1').textContent, text: document.querySelector('[aria-label="Beast lore"]').innerText, path: location.pathname, title: document.title })`);
      if (r.h1 !== ty.type) wrong.push(`${ty.id}: ${r.h1}`);
      if (!r.text.includes(`${ty.maxHealth} hearts`)) wrong.push(`${ty.type}: hearts ${ty.maxHealth} not shown`);
      // the address names the beast (/bestiary/stone-troll), and so does the tab
      const slug = ty.type.toLowerCase().replace(/^the /, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (r.path !== `/bestiary/${slug}`) wrong.push(`${ty.type}: address ${r.path}`);
      if (!r.title.startsWith(ty.type + ' — ')) wrong.push(`${ty.type}: tab ${r.title}`);
      if (ty.category === 'fleet' && !/Strikes into/i.test(r.text)) wrong.push(`${ty.type}: no reach`);
      if (ty.category === 'planet' && /Strikes into/i.test(r.text)) wrong.push(`${ty.type}: a hallow with reach`);
      const st = await stage(page); if (!st.finite) wrong.push(`${ty.type}: camera NaN`);
      const seen = await lookAtStage(page); if (seen.mean < 12) dark.push(`${ty.type}: mean ${seen.mean.toFixed(1)}`);
      if (ty.id === 10 || ty.id === 1 || ty.id === 22) await page.screenshot(c.evidencePath(`type-${ty.id}.png`));
    }
    expect.eq(wrong.length, 0, 'sheets that lie', wrong);
    expect.eq(dark.length, 0, 'runes that leave the sky black', dark);
    expect.noErrors(page.errors(ALLOW), 'console');
  });
  await t.test('"Watch it summoned" plays and the dais stays finite', 'S1', async () => {
    await page.clickSel('[aria-label="Beast lore"] button', { text: 'Watch it summoned' });
    await sleep(1500);
    const st = await stage(page); expect.ok(st.finite, 'camera finite after the summoning', st);
    expect.noErrors(page.errors(ALLOW), 'console');
  });
  await t.test('a deep link to a rune opens on it; a bad rune falls back to the Elder Wyrm', 'S1', async () => {
    await openGame(page, ctx.app.url, '#/bestiary/13');
    await awake(page);
    expect.eq(await page.eval(`document.querySelector('[aria-label="Beast lore"] h1').textContent`), 'Drowned Wight', 'deep link');
    await openGame(page, ctx.app.url, '#/bestiary/banana');
    await awake(page);
    expect.eq(await page.eval(`document.querySelector('[aria-label="Beast lore"] h1').textContent`), 'Elder Wyrm', 'fallback');
    expect.noErrors(page.errors(ALLOW), 'console');
  });
  await t.test('a stranger (no oath) is sent to the oath, a warden to their Hold', 'S2', async () => {
    const stranger = await page.eval(`[...document.querySelectorAll('[aria-label="Beast lore"] .btn')].map((b) => b.textContent)`);
    expect.ok(stranger.some((s) => /Swear the oath first/.test(s)), 'the stranger’s button', stranger);
    await openGame(page, ctx.app.url, '#/bestiary/14', { sworn: true, playerId: ctx.sky.me.pid });
    await awake(page);
    await page.waitFor(`[...document.querySelectorAll('[aria-label="Beast lore"] .btn')].some((b) => /Hold/.test(b.textContent))`, { what: 'the warden’s button' });
    const warden = await page.eval(`document.querySelector('[aria-label="Beast lore"]').innerText`);
    expect.ok(/You hold 1\./.test(warden), 'says how many you hold', warden.slice(-200));
  });
  await page.close();
}
