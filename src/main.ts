/* Wyrmhold boots: the ledger's pulse (live), the soulstone (wallet), the empire it commands,
 * the chant engine (pow) and the rite queue (txq) — and
 * then the realm's screens, routed by hash. */
import './styles.css';
import { live } from './chain/live';
import { followGrass } from './guild/directory';
import { wallet } from './wallet/wallet';
import { empire } from './game/empire';
import { pow } from './pow/pow';
import { txq } from './wallet/queue';
import { resumeEnlist } from './game/enlist';
import { toast } from './core/dom';
import { audio, ambience } from './core/audio';
import { retell, retellError } from './lore';
import { openOath } from './ui/oath';
import { mountGuide } from './ui/guide';
import { guardTheVeil } from './ui/veilguard';
import { watchOmens, proclaim } from './ui/omens';
import { takeClaim } from './core/claims';
import { canRetry } from './game/actions';
import type { Screen, Ctx } from './screens/types';

const MAKERS: Record<string, () => Promise<(ctx: Ctx) => Screen>> = {
  '': () => import('./screens/gate').then((m) => m.gate),
  hold: () => import('./screens/hold').then((m) => m.hold),
  bestiary: () => import('./screens/bestiary').then((m) => m.bestiary),
  atlas: () => import('./screens/atlas').then((m) => m.atlas),
  skirmish: () => import('./screens/skirmish').then((m) => m.skirmish),
  grimoire: () => import('./screens/codex').then((m) => m.codex),
  codex: () => import('./screens/codex').then((m) => m.codex),
  leyweave: () => import('./screens/leyweave').then((m) => m.leyweave),
};

const app = document.getElementById('app')!;
const bootStep = document.getElementById('boot-step')!;
let current: Screen | null = null;
let routing = 0;

function parse(): { name: string; param?: string; path: string } {
  const raw = (location.hash || '#/').replace(/^#\/?/, '');
  const [name, param] = raw.split('/');
  return { name: MAKERS[name] ? name : '', param: param ? decodeURIComponent(param) : undefined, path: '#/' + (MAKERS[name] ? name : '') };
}

async function route() {
  const my = ++routing;
  const r = parse();
  const make = await MAKERS[r.name]();
  if (my !== routing) return;
  current?.leave();
  app.textContent = '';
  document.body.dataset.route = r.name || 'gate';
  const ctx: Ctx = { route: r.path, param: r.param, go: (p) => { location.hash = p; }, oath: openOath };
  current = make(ctx);
  app.append(current.el);
  current.enter?.();
  document.title = current.title ? `${current.title} · Wyrmhold` : 'Wyrmhold';
}

/* The herald: rites that land or fail, told once, wherever the warden is. */
txq.onSettled((j) => {
  // a summoning sung to the end is a moment: the sky says so
  if (j.source === 'pow' && j.status === 'success' && j.msgs.some((m) => /StructBuildComplete/.test(m.typeUrl)) && j.playerId && wallet.byPlayer(j.playerId)) {
    const beast = retell(j.label).replace(/ · chant of \d+$/, '').replace(/^.*chant · /i, '').replace(/^The /, '') || 'beast';
    proclaim(`The ${beast} wakes`, 'Your summoning is sung. It stands on your isle now, and works on its own.', 'gold');
    audio.stinger('alpha', 0.6);
    return;
  }
  if (j.source === 'pow' && j.status === 'success') { toast(retell(j.label).replace(/ · chant of \d+$/, '') + ' — the chant is heard.', 'player'); audio.stinger('alpha', 0.5); return; }
  // a drawn circle is only the start: say what comes next, not "done"
  if (j.status === 'success' && j.msgs.some((m) => /StructBuildInitiate/.test(m.typeUrl))) {
    const beast = retell(j.label).replace(/^.*circle · /i, '').replace(/^The /, '') || 'beast';
    toast(`The circle is drawn for the ${beast}. Its summoning chant is being sung; watch it under Incantations.`, 'player', 5000);
  } else if (j.status === 'success' && document.body.dataset.route === 'skirmish' && j.msgs.some((m) => /StructAttack$/.test(m.typeUrl))) return;   // the fray tells it, blow by blow
  else if (j.status === 'success') toast(retell(j.label) + ' — done.', 'player', 2600);
  else if (j.status === 'failed' && takeClaim(j.id)) return;
  // a refused plunder chant is kept and spoken again by the chant engine; "Again" would only repeat it
  else if (j.status === 'failed' && j.source === 'pow' && j.msgs.some((m) => /PlanetRaidComplete$/.test(m.typeUrl))) return;
  // "Again" only while the refusal is fresh and the rite still makes sense (see canRetry)
  else if (j.status === 'failed') toast(retell(j.label).replace(/ · chant of \d+$/, '') + ' failed: ' + retellError(j.error || 'the ledger refused'), 'enemy', 7000, canRetry(j) ? { label: 'Again', run: () => { if (canRetry(j)) txq.retry(j.id); } } : undefined);
});

/* Escape closes the topmost dialog, the way a warden expects. A dialog with its own "Not now" or close
 * button is closed through it (so a question answers "no"); the Oath, which listens for itself, is left alone. */
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  const veils = document.querySelectorAll('.veil');
  const veil = veils[veils.length - 1] as HTMLElement | undefined;
  if (!veil || veil.querySelector('#oath-title')) return;
  // the safe answer, wherever it sits: a confirm may make it the bright button and the rite the quiet one
  const btn = veil.querySelector<HTMLElement>('[data-dismiss]') || veil.querySelector<HTMLElement>('button[aria-label="Close"], .btn.ghost');
  if (btn) btn.click(); else veil.remove();
});

async function boot() {
  guardTheVeil();
  bootStep.textContent = 'Reaching the ledger…';
  live.start();
  followGrass();
  watchOmens();
  bootStep.textContent = 'Unsealing your soulstone…';
  await Promise.race([wallet.restore(), new Promise((r) => setTimeout(r, 5000))])
    .catch((e) => toast((e as Error).message, 'enemy', 9000, { label: 'Soulstone', run: openOath }));
  wallet.onChange(resumeEnlist); resumeEnlist();
  void empire; void pow;
  if (wallet.state === 'locked' && txq.active.length) toast(`${txq.active.length} rite(s) wait for your soulstone`, 'warn', 6000, { label: 'Unseal', run: openOath });
  window.addEventListener('hashchange', route);
  await route();
  mountGuide();
  const b = document.getElementById('boot');
  b?.classList.add('gone');
  setTimeout(() => b?.remove(), 900);
  document.addEventListener('pointerdown', () => { audio.bell(880, 0.0001, 0.05); ambience.start(); }, { once: true });
}

void boot();
