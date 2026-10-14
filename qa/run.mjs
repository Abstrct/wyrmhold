#!/usr/bin/env node
/* The proving ground: Wyrmhold's QA framework. Starts a mock ledger, the game, and headless Chrome,
 * then runs every suite (or the ones named) and writes a report.
 *
 *   node qa/run.mjs                  # everything
 *   node qa/run.mjs hold assets      # named suites
 *   node qa/run.mjs --list           # what there is
 *   node qa/run.mjs flows --grep tab # only the checks whose name matches (a case-blind pattern)
 *   options: --headed  --keep (leave servers up)  --out DIR  --app URL (an already running game, mock ledger still ours)
 *            --blockMs N (bells; default 1000)  --net (also compare the catalogue with the public ledger) */
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { launchChrome } from './lib/cdp.mjs';
import { Ledger } from './lib/ledger.mjs';
import * as worldLib from './lib/world.mjs';
const { standardSky } = worldLib;
import { startApp } from './lib/app.mjs';
import { Report } from './lib/report.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SUITES = [
  ['assets', 'Art & assets', 'Every beast and hallow builds, measures, animates and compiles'],
  ['logic', 'Game logic', 'Catalogue, lore translator, realm mapping, formatting, action rules'],
  ['smoke', 'Smoke & stability', 'Every screen boots clean, draws a sky, throws nothing'],
  ['hold', 'The Hold', 'Roster ↔ isle parity, every beast selectable, card and rites, summoning'],
  ['bestiary', 'Bestiary', 'Every rune shows its beast and sheet'],
  ['skirmish', 'Skirmish', 'Both warbands drawn, reach and odds, the raid stepper'],
  ['atlas', 'Sky Atlas & Leyweave & Grimoire', 'Lists, search, cards, wells, sections'],
  ['flows', 'Player journeys', 'A fresh browser: prologue, oath, the Hold as its own, rites that queue'],
  ['clarity', 'Clarity & tongue', 'No ledger ids, no engine words, no undefined; names and glosses'],
  ['a11y', 'Accessibility & input', 'Names on controls, keyboard paths, dialogs, reduced motion'],
  ['responsive', 'Screens & devices', 'Desktop, laptop, tablet, phone portrait and landscape'],
  ['data', 'Data channels', 'The coven’s API through the relay, GRASS patching the sky, fallbacks to the node'],
  ['resilience', 'Resilience', 'Ledger down, slow, failing, unknown data, live feed drops'],
  ['perf', 'Performance & memory', 'Draw budgets, frame pacing, leaks across a long session'],
];

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? (args.splice(i, 1), true) : false; };
const opt = (n, d) => { const i = args.indexOf(n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
if (flag('--list')) { for (const [n, p, d] of SUITES) console.log(`${n.padEnd(11)} ${p.padEnd(34)} ${d}`); process.exit(0); }
const headed = flag('--headed'), keep = flag('--keep'), net = flag('--net');
const out = resolve(opt('--out', join(HERE, 'reports', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19))));
const appUrlOpt = opt('--app', null);
const blockMs = Number(opt('--blockMs', 1000));
const grep = opt('--grep', null);
const wanted = args.filter((a) => !a.startsWith('--'));
const unknown = wanted.filter((w) => !SUITES.some(([n]) => n === w));
if (unknown.length) { console.error('unknown suite(s): ' + unknown.join(', ')); process.exit(2); }
const chosen = SUITES.filter(([n]) => !wanted.length || wanted.includes(n));

mkdirSync(out, { recursive: true });
// a stray error in the rig itself is noted in the report, never allowed to end the run unreported
const strays = [];
process.on('unhandledRejection', (e) => { strays.push(String(e && e.stack || e).slice(0, 400)); console.error('  rig   unhandled: ' + String(e && e.message || e)); });
process.on('uncaughtException', (e) => { strays.push(String(e && e.stack || e).slice(0, 400)); console.error('  rig   uncaught: ' + String(e && e.message || e)); });
const report = new Report(out);
const ledger = new Ledger(null);
await ledger.start({ blockMs });
const sky = standardSky(ledger.lcdUrl);
ledger.world = sky.w;
sky.w.anyAddressPlayer = sky.me.pid;
const app = appUrlOpt ? { url: appUrlOpt.replace(/\/?$/, '/'), stop: async () => {} } : await startApp({ lcdUrl: ledger.lcdUrl, wsUrl: ledger.wsUrl });
const browser = await launchChrome({ headed });
console.log(`proving ground · ledger ${ledger.lcdUrl} · game ${app.url} · ${browser.version} · report ${out}`);

const ctx = { browser, app, ledger, sky, report, out, net, worldLib, async newPage(o) { return browser.newPage(o); } };
let failedToLoad = 0;
for (const [name, pillar] of chosen) {
  const suite = report.suite(name, pillar);
  if (grep) { const re = new RegExp(grep, 'i'), all = suite.test.bind(suite); suite.test = (n, sev, fn) => (re.test(n) ? all(n, sev, fn) : Promise.resolve('skip')); }
  try { const mod = await import(join(HERE, 'suites', name + '.mjs')); await mod.default(suite, ctx); }
  catch (e) { failedToLoad++; report.add({ suite: name, pillar, name: '(suite)', severity: 'S0', status: 'fail', message: 'the suite itself failed: ' + e.message, details: [e.stack], ms: 0 }); }
  // every suite leaves the sky as it found it
  ledger.faults = { down: false, latencyMs: 0, failPaths: [], failStatus: 503, wsDown: false };
  ledger.paused = false; ledger.onBroadcast = null;
  sky.w.anyAddressPlayer = sky.me.pid; sky.w.enlist = null; sky.w.refuse = null; sky.w.lastSigner = null;
  if (app.alive && !app.alive()) { report.note('the game server died during ' + name + ': ' + app.logs().slice(-600).replace(/\n/g, ' | ')); break; }
}
if (app.logs && /error|Error/.test(app.logs())) report.note('game server log: ' + app.logs().split('\n').filter((l) => /error/i.test(l)).slice(-5).join(' | '));
if (strays.length) report.note(`the rig itself hit ${strays.length} stray error(s): ` + strays.slice(0, 3).join(' | '));
const s = report.write({ app: app.url, chrome: browser.version, ledger: ledger.lcdUrl, suites: chosen.map(([n]) => n) });
console.log(`\n${s.pass} passed · ${s.fail} failed (${s.blocking} blocking) · ${s.warn} with findings · ${s.skip} skipped · ${(s.ms / 1000).toFixed(0)}s\nreport: ${out}/report.md`);
if (!keep) { await browser.close(); await app.stop(); await ledger.stop(); }
else console.log(`kept running: game ${app.url} ledger ${ledger.lcdUrl}`);
process.exit(s.blocking || failedToLoad ? 1 : 0);
