/* First-time-player bots on the Skirmish against the arena's foe (strikes every 15 s): one JSON line per run
 * (won, Wyrm lost, beasts felled, and how many blows' results the screen told within 6 s of the ledger).
 *   node qa/playtest.mjs ROOT PORT POLICY RUNS     POLICY: old-first | old-wyrm | new-default | new-fighton
 * ROOT is the checkout under test. For the screen before the 2026-10-12 redesign (old-*), make a worktree
 * at df55e04 and copy qa/arena.mjs and qa/lib/ledger.mjs into it. Wins are counted from the ledger. */
const [ROOT, PORT, POLICY, RUNS] = [process.argv[2], Number(process.argv[3]), process.argv[4], Number(process.argv[5] || 1)];
const { launchChrome, sleep } = await import(ROOT + '/qa/lib/cdp.mjs');
const { startArena } = await import(ROOT + '/qa/arena.mjs');
const LIMIT = 240000;

const STEP = {
  // the old screen: ride out from the banner, pick the first striker and the first mark that is not greyed, Unleash
  'old-first': `(async () => {
    const { txq } = await import('/src/wallet/queue.ts');
    const ride = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Ride out'); if (ride) { ride.click(); return 'press:ride'; }
    const mine = [...document.querySelectorAll('[aria-label="Your warband"] .item')];
    if (!mine.some((b) => b.classList.contains('on')) && mine[0]) { mine[0].click(); return 'pick:striker'; }
    const theirs = [...document.querySelectorAll('[aria-label="Their hold"] .item')];
    const marked = theirs.find((b) => b.classList.contains('mark'));
    if (!marked || marked.disabled) { const t = theirs.find((b) => !b.disabled); if (t) { t.click(); return 'pick:mark'; } return 'stuck'; }
    if (txq.active.some((j) => j.msgs.some((m) => /StructAttack$/.test(m.typeUrl)))) return 'wait';
    const u = [...document.querySelectorAll('[aria-label="Strike"] button')].find((b) => b.textContent.trim() === 'Unleash');
    if (u && !u.disabled) { u.click(); return 'press:unleash'; }
    return 'wait';
  })()`,
  // the old screen, aimed: Wyrm on Wyrm, the beast whose fall wins (if the player guesses that)
  'old-wyrm': `(async () => {
    const { txq } = await import('/src/wallet/queue.ts');
    const ride = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Ride out'); if (ride) { ride.click(); return 'press:ride'; }
    const mine = [...document.querySelectorAll('[aria-label="Your warband"] .item')].find((b) => /Elder Wyrm/.test(b.textContent));
    if (mine && !mine.classList.contains('on')) { mine.click(); return 'pick:striker'; }
    const theirs = [...document.querySelectorAll('[aria-label="Their hold"] .item')].find((b) => /Elder Wyrm/.test(b.textContent));
    if (theirs && !theirs.classList.contains('mark')) { theirs.click(); return 'pick:mark'; }
    if (txq.active.some((j) => j.msgs.some((m) => /StructAttack$/.test(m.typeUrl)))) return 'wait';
    const u = [...document.querySelectorAll('[aria-label="Strike"] button')].find((b) => b.textContent.trim() === 'Unleash');
    if (u && !u.disabled) { u.click(); return 'press:unleash'; }
    return 'wait';
  })()`,
  // the new screen: press the big button when it says it is ready (never "Unleash anyway?")
  'new-default': `(async () => {
    const b = document.querySelector('.btn.unleash'); if (!b || b.disabled) return 'wait';
    const t = b.innerText.trim();
    if (!/anyway|Gathering|Striking|Setting/.test(t) && (!/^Unleash/.test(t) || /ready/.test(t))) { b.click(); return 'press:big'; }
    return 'wait';
  })()`,
  // the new screen with Fight on: ride out, switch it on; when it rests, press the big button when ready
  'new-fighton': `(async () => {
    const fo = document.querySelector('.fight-on');
    if (fo && !fo.hidden && fo.getAttribute('aria-pressed') !== 'true' && !window.__foTried) { window.__foTried = true; fo.click(); return 'press:fighton'; }
    if (fo && fo.getAttribute('aria-pressed') === 'true') return 'wait';
    const b = document.querySelector('.btn.unleash'); if (!b || b.disabled) return 'wait';
    const t = b.innerText.trim();
    if (!/anyway|Gathering|Striking|Setting/.test(t) && (!/^Unleash/.test(t) || /ready/.test(t))) { b.click(); return 'press:big'; }
    return 'wait';
  })()`,
};

const results = [];
for (let run = 0; run < RUNS; run++) {
  const a = await startArena({ port: PORT, calm: false, log: () => {} });
  const browser = await launchChrome({ extraArgs: ['--use-angle=metal'] });
  const { w, me, foe } = a.sky;
  const dead = (s) => (Number(s.structAttributes.status) & 32) !== 0;
  const r = { policy: POLICY, run, won: false, secs: 0, myWyrmLost: false, theirWyrmFelled: false, theirFelled: 0, myLost: 0, presses: 0, picks: 0, stuckTicks: 0, troubleSeen: [] };
  try {
    const page = await browser.newPage({ width: 1440, height: 900 });
    function told() {
      const seen = [];
      window.__told = seen;
      const RX = /^−\d+$|−\d+ · \d+ of \d+ left|falls!|Falls!|Turned aside|Glamour!|Windslip!|takes the blow −|strikes back −\d|felled your|strikes your/;
      new MutationObserver((ms) => {
        for (const m of ms) for (const n of m.addedNodes) {
          const t = (n.textContent || '').trim();
          if (t && t.length < 400 && RX.test(t)) seen.push({ at: Date.now(), text: t.slice(0, 80) });
        }
      }).observe(document, { childList: true, subtree: true });
    }
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: '(' + told.toString() + ')();' });
    // ledger side: every blow the ledger tells, ours and the foe's, with the time it was told
    const blows = [];
    const emit = a.ledger.emitTx.bind(a.ledger);
    let raidWon = false;
    a.ledger.emitTx = (events, o) => { for (const e of events) { if (e.type === 'EventAttack') blows.push({ at: Date.now(), ours: e.data.attackerPlayerId === me.pid }); if (e.type === 'EventRaid' && /Successful/.test(e.data.status)) raidWon = true; } return emit(events, o); };
    r.blows = blows;
    await page.goto(a.app.url + 'qa/blank.html');
    await page.eval(`localStorage.clear(); for (const [k, v] of Object.entries({ 'wyrmhold.prologue': 'seen', 'wyrmhold.tour.hold': 'seen', 'wyrmhold.path.hidden': '1', 'wyrmhold.music': 'off' })) localStorage.setItem(k, v);`);
    await page.goto(a.app.url + '#/skirmish/' + foe.pid);
    const booted = `!document.getElementById('boot') || document.getElementById('boot').classList.contains('gone')`;
    try { await page.waitFor(booted, { timeout: 60000 }); } catch { await page.reload(); await page.waitFor(booted, { timeout: 120000 }); }
    await page.eval(`const { wallet } = await import('/src/wallet/wallet.ts'); await wallet.createInstant(); await wallet.resolvePlayers(); return true`);
    await page.waitFor(`(await import('/src/game/empire.ts')).empire.commander && document.querySelectorAll('[aria-label="Their hold"] .item').length > 3`, { timeout: 60000 });
    await sleep(3000);
    const t0 = Date.now();
    const trouble = new Set();
    while (Date.now() - t0 < LIMIT) {
      const act = await page.eval(STEP[POLICY]).catch(() => 'eval-failed');
      if (act.startsWith('press')) r.presses++;
      if (act.startsWith('pick')) r.picks++;
      if (act === 'stuck') r.stuckTicks++;
      // what the player is told when things go wrong: heralds and the line under the button
      const said = await page.eval(`[document.querySelector('#heralds')?.innerText || '', ...[...document.querySelectorAll('.inline-err, .chant .faint')].map((e) => e.innerText)].join('\\n')`).catch(() => '');
      for (const line of said.split('\\n')) if (/fail|refus|cannot|raid_complete|shields|did not land|not land/i.test(line)) trouble.add(line.trim().slice(0, 120));
      const shown = /Raid won/.test(await page.eval(`document.body.innerText`).catch(() => ''));
      if (shown || raidWon) { r.won = true; if (!shown) { await sleep(1500); r.wonShown = /Raid won/.test(await page.eval(`document.body.innerText`).catch(() => '')); } else r.wonShown = true; break; }
      if (dead(w.structs.get(me.beasts[0].Struct.id))) { r.myWyrmLost = true; break; }
      await sleep(800);
    }
    r.secs = Math.round((Date.now() - t0) / 1000);
    const toldList = await page.eval('window.__told || []').catch(() => []);
    const judge = (list) => { let n = 0; const lat = []; for (const b of list) { const hit = toldList.find((x) => x.at >= b.at - 3000 && x.at <= b.at + 6000); if (hit) { n++; lat.push(Math.max(0, hit.at - b.at)); } } return { blows: list.length, told: n, medianMs: lat.sort((x, y) => x - y)[Math.floor(lat.length / 2)] ?? null }; };
    r.feedback = { ours: judge(blows.filter((b) => b.ours)), theirs: judge(blows.filter((b) => !b.ours)), recorded: toldList.length, sample: toldList.slice(0, 3).map((x) => x.text), installed: await page.eval('Array.isArray(window.__told)').catch(() => 'eval-failed') };
    delete r.blows;
    if (!r.won && !r.myWyrmLost) r.diag = await page.eval(`(async () => {
      const { pow } = await import('/src/pow/pow.ts'); const { txq } = await import('/src/wallet/queue.ts'); const { empire } = await import('/src/game/empire.ts');
      const p = empire.commander;
      return { tasks: [...pow.tasks.values()].map((t) => ({ kind: t.kind, status: t.status, best: t.best && t.best.zeros, need: pow.required(t), waits: t.waits, hold: t.holdUntil, err: t.error })),
        jobs: txq.jobs.slice(-6).map((j) => j.status + ' · ' + j.label + ' · ' + (j.waitReason || j.error || '')),
        fleet: p && p.fleet && (p.fleet.status + ' ' + p.fleet.locationId), target: p && p.target && { raidStart: p.target.planetAttributes && p.target.planetAttributes.blockStartRaid, shield: p.target.planetAttributes && p.target.planetAttributes.planetaryShield, list: p.target.Planet.locationListStart },
        title: document.querySelector('.wb-title')?.textContent, button: document.querySelector('.btn.unleash')?.innerText };
    })()`).catch((e) => 'diag failed ' + e.message);
    if (!r.won && !r.myWyrmLost) r.ledger = { fleet: w.fleets.get(me.fleetId).status + ' ' + w.fleets.get(me.fleetId).locationId, raidStart: w.planets.get(foe.planetId).planetAttributes.blockStartRaid, listStart: w.planets.get(foe.planetId).Planet.locationListStart, height: w.height };
    r.theirWyrmFelled = dead(w.structs.get(foe.beasts[0].Struct.id));
    r.theirFelled = foe.beasts.filter((s) => dead(w.structs.get(s.Struct.id))).length;
    r.myLost = me.beasts.filter((s) => dead(w.structs.get(s.Struct.id))).length;
    r.troubleSeen = [...trouble].slice(0, 5);
  } catch (e) { r.error = e.message.slice(0, 200); }
  finally { await browser.close(); await a.stop(); }
  results.push(r);
  console.log(JSON.stringify(r));
}
process.exit(0);
