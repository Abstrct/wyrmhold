/* The Warden's Path: a living tutorial. Ysolde, a grey owl spirit, walks a new warden from soulstone
 * to first strike. Every step is judged from the warden's real state on the ledger (or a rite that
 * landed), so it can never be "faked" past — and a warden who arrives already strong finds the early
 * steps already lit. "Show me" carries you to the right place and makes the right control glow. */
import { h, clear } from '../core/dom';
import { ROUTE_EVENT, go, here as whereNow } from '../core/nav';
import K from '../world/wyrmkit.js';
import { wallet } from '../wallet/wallet';
import { empire, type PlayerState } from '../game/empire';
import { txq } from '../wallet/queue';
import { audio } from '../core/audio';
import { enlisting } from '../game/enlist';
import { proclaim } from './omens';

interface Step {
  id: string;
  title: string;
  say: string;                // Ysolde's words while the step waits
  do: string;                 // the plain thing to do, always shown
  done?: string;              // her words when it lands
  route: string;              // where "Show me" goes
  glow?: string;              // data-tut target to make glow
  test: (p: PlayerState | null) => boolean;
  slow?: boolean;             // ripens over many bells: the path may walk on
  ready?: (p: PlayerState | null) => boolean; // not possible yet: the path walks on and comes back
}

const HIDE_KEY = 'wyrmhold.path.hidden';
/** Each warden walks their own path: remembered moments are kept per warden sigil. */
const flagsKey = () => `wyrmhold.path.${wallet.active?.playerId || wallet.active?.address || 'unbound'}`;
let flagsFor = '';
let flags: Record<string, boolean> = {};
function loadFlags() {
  const k = flagsKey();
  if (k === flagsFor) return;
  // Binding a soulstone and swearing move the same warden from 'unbound' to an address to a
  // sigil: carry the moments already walked along, and keep celebrating what lands next.
  const same = !!flagsFor && (flagsFor.endsWith('.unbound') || flagsFor === `wyrmhold.path.${wallet.active?.address}`);
  let loaded: Record<string, boolean> = {};
  try { loaded = JSON.parse(localStorage.getItem(k) || '{}'); } catch { loaded = {}; }
  flagsFor = k;
  // only a warden sworn this very visit keeps the fanfare going; a restored one starts quiet
  if (same) { flags = { ...flags, ...loaded }; save(); lastSig = ''; if (!enlisting.current) ready = false; return; }
  flags = loaded;
  lastSig = ''; lastSaid = ''; ready = false;
}
const save = () => { try { localStorage.setItem(flagsKey(), JSON.stringify(flags)); } catch { /* memory only */ } };

/** Screens call this when the warden does something the path watches for. */
export function markPath(id: string) { loadFlags(); if (!flags[id]) { flags[id] = true; save(); paintSoon(); } }
/** Whether a watched moment of the path has happened (e.g. the warden has met their Wyrm). */
export function pathHas(id: string) { loadFlags(); return !!flags[id]; }

const owns = (p: PlayerState | null, type: number, built = false) => !!p && [...p.structs.values()].some((s) => s.typeId === type && !s.destroyed && (!built || s.built));

const STEPS: Step[] = [
  { id: 'stone', title: 'Bind your soulstone', route: '/', glow: 'begin',
    say: 'Hoo. A new light on the old wind. First you need a soulstone: your name in the sky, sealed to this browser.',
    do: 'Press “Swear the oath” to begin.',
    done: 'There. The stone is warm. It knows your hand now.', test: () => wallet.state !== 'empty' },
  { id: 'oath', title: 'Swear to a coven', route: '/', glow: 'begin',
    say: 'No warden survives alone up here. A coven lends you a leyline until your own springs run.',
    do: 'Press “Swear the oath”, name your warden and choose a coven.',
    done: 'Sworn. The coven’s scribe has written you in.', test: () => !!wallet.active?.playerId },
  { id: 'isle', title: 'Seek your isle', route: '/hold', glow: 'seek',
    say: 'Somewhere below the clouds drifts a shard with no one on it. Something old will hatch there to meet you.',
    do: 'Press Seek Isle in the bar at the bottom.',
    done: 'Feel that? Your isle. And listen: the egg is cracking.', test: (p) => !!p?.planetId },
  { id: 'wyrm', title: 'Meet your Elder Wyrm', route: '/hold', glow: 'wyrm',
    say: 'Your Elder Wyrm is bound to you alone. Every raid you ride, you ride on its back.',
    do: 'Click your Elder Wyrm on the isle, or in the list on the left.',
    done: 'It knows your scent now. Guard it: if it falls mid-raid, the raid breaks.', test: () => !!flags.wyrm },
  { id: 'delver', title: 'Summon a Root Delver', route: '/hold', glow: 'summon',
    say: 'Your isle’s marrow is full of wildroot. A Root Delver lifts it up for you.',
    do: 'Press Summon, then choose the Root Delver.',
    done: 'The circle is drawn. Now the summoning must be sung.', test: (p) => owns(p, 14) },
  { id: 'chant', title: 'Let the chant ripen', route: '/hold', glow: 'chants',
    say: 'Every summoning must be sung. Your Hold sings it for you with this computer’s spare strength, and it gets easier every moment.',
    do: 'Wait for the Incantations bar to fill; it says roughly how long. Explore meanwhile, but keep Wyrmhodl open: the singing happens here.',
    done: 'Heard! The Delver wakes and will dig on its own now.', test: (p) => owns(p, 14, true), slow: true },
  { id: 'cauldron', title: 'Raise a Dawn Cauldron', route: '/hold', glow: 'summon',
    say: 'Raiders can carry off wildroot. A Dawn Cauldron brews it into alpha, and brewed alpha can never be taken.',
    do: 'Press Summon, then choose the Dawn Cauldron.',
    done: 'Good. From now on, what you delve, you keep.', test: (p) => owns(p, 15) },
  { id: 'alpha', title: 'Understand alpha', route: '/grimoire', glow: 'tale',
    say: 'Alpha is the first light, fallen when the sky broke. It feeds your springs, calls your beasts, and the covens honour it as coin.',
    do: 'Open the Grimoire and read the old tale.',
    done: 'Now you know why every warden up here is hungry.', test: () => !!flags.grimoire },
  { id: 'tithe', title: 'Tithe to your wellspring', route: '/leyweave', glow: 'tithe',
    say: 'Your beasts drink mana. Lend a little alpha to your coven’s wellspring and your mana flow rises.',
    do: 'In the Leyweave, press Tithe. You can take it back later.',
    done: 'Your flow rises. The leylines hum your name.', test: () => !!flags.tithe, ready: (p) => !!p && p.alpha > 0n },
  { id: 'atlas', title: 'Read the sky', route: '/atlas', glow: 'rich',
    say: 'Every light out there is a warden: sleeping, scheming, or watching you. Amber isles hold a prize.',
    do: 'In the Sky Atlas, press “Unbrewed wildroot” to show the rich isles.',
    done: 'You see them now. Some of them see you.', test: (p) => !!flags.atlas || !!flags.ride || p?.fleet?.status === 'away' },
  { id: 'ride', title: 'Ride out', route: '/atlas', glow: 'ride',
    say: 'While your warband is abroad your own hold stands unguarded, so be quick and be sure.',
    do: 'In the Sky Atlas, choose an isle, press Raid this hold, then Ride out.',
    done: 'The wind is under you. Fell their Elder Wyrm, and your plunder chant breaks their ward.', test: (p) => !!flags.ride || p?.fleet?.status === 'away' },
  { id: 'strike', title: 'Strike', route: '/skirmish', glow: 'unleash',
    say: 'Read the odds before you swing. Most beasts that live will answer, and guards step in front of what they guard.',
    do: 'In Skirmish the wisest blow is chosen for you. Read what it will do, then press Unleash.',
    done: 'Blood in the clouds. You are a warden now, truly.', test: () => !!flags.strike },
];

let panel: HTMLElement | null = null;
let body: HTMLElement | null = null;
let portrait: { dispose(): void } | null = null;
let lastDone = new Set<string>();
let ready = false;
let paintTimer = 0;
function paintSoon() { if (!paintTimer) paintTimer = window.setTimeout(() => { paintTimer = 0; paint(); }, 60); }

function hidden() {
  try { const v = localStorage.getItem(HIDE_KEY); if (v != null) return v === '1'; } catch { /* default */ }
  // On a phone Ysolde starts folded into her lantern: one tap opens her.
  return matchMedia('(max-width: 720px)').matches;
}
function setHidden(v: boolean) { try { localStorage.setItem(HIDE_KEY, v ? '1' : '0'); } catch { /* memory */ } openHere = false; lastSig = ''; paint(); }
/** Opened by hand on a screen that is not the step's own: stays open until the warden moves on. */
let openHere = false;
/** When the last step was walked in this visit (her farewell shows in full for a while). */
let walkedAt = 0;
const FAREWELL_MS = 20000;
// '/hold/<someone>' is their hold, not yours: only the Skirmish and Atlas count a sub-path as theirs
const here = (route: string) => { const at = whereNow(); return route === '/' ? at === '/' : at === route || (route !== '/hold' && at.startsWith(route + '/')); };

/** Make a control glow until it is used (or for a while). Screens repaint, so the glow is
 * re-applied to whatever element carries the tag until it is touched or the moment passes. */
let glowing: { tag: string; until: number; scrolled: boolean } | null = null;
// a stylesheet rule, not a class, so a control rebuilt by a repaint glows from the moment it is drawn
const glowSheet = document.createElement('style');
document.head.append(glowSheet);
function setGlow(g: typeof glowing) {
  glowing = g;
  glowSheet.textContent = g ? `[data-tut="${CSS.escape(g.tag)}"] { position: relative; z-index: 3; outline: 2px solid var(--gold) !important; outline-offset: 3px; animation: tutglow 1.2s ease-in-out infinite !important; }` : '';
}
setInterval(() => {
  if (!glowing) return;
  if (Date.now() > glowing.until) { setGlow(null); return; }
  if (glowing.scrolled) return;
  const el = document.querySelector(`[data-tut="${glowing.tag}"]`) as HTMLElement | null;
  if (el) { glowing.scrolled = true; el.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); }
}, 250);
document.addEventListener('click', (e) => {
  if (glowing && (e.target as HTMLElement)?.closest?.(`[data-tut="${glowing.tag}"]`)) setGlow(null);
}, true);
export function glow(tag: string) { setGlow({ tag, until: Date.now() + 12000, scrolled: false }); }

/** A tiny living portrait: the grey owl, breathing in her own little sky. */
const owlPortrait = (canvas: HTMLCanvasElement) => K.portrait(canvas, { type: 6, tint: 0x9a93b0 }) as { dispose(): void };

/** Type a line out, like a voice. */
function speakInto(el: HTMLElement, text: string) {
  el.textContent = '';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) { el.textContent = text; return; }
  let i = 0;
  const tick = () => { if (!el.isConnected) return; el.textContent = text.slice(0, i += 2); if (i < text.length) setTimeout(tick, 18); };
  tick();
}

function celebrate(step: Step) {
  audio.bell(783.99, 0.18, 2.6);
  setTimeout(() => audio.bell(1046.5, 0.14, 2.2), 180);
  const burst = h('div', { class: 'path-burst', 'aria-hidden': 'true' });
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2, d = 70 + Math.random() * 90;
    burst.append(h('i', { style: { '--dx': `${Math.cos(a) * d}px`, '--dy': `${Math.sin(a) * d}px`, animationDelay: `${Math.random() * 120}ms` } as unknown as Record<string, string> }));
  }
  panel?.append(burst);
  setTimeout(() => burst.remove(), 1600);
  void step;
}

let lastSaid = '';
let lastSig = '';
/** A left-hand column that runs down to where Ysolde stands open stops just above her. Measured,
 * not guessed: the columns start lower on some screens (a stepper, notices) than on others. */
function fitColumns() {
  if (!panel) return;
  const open = document.body.classList.contains('has-path') && window.innerWidth > 720;
  const pr = panel.getBoundingClientRect();
  document.querySelectorAll<HTMLElement>('.cols > .col-l').forEach((col) => {
    const r = col.getBoundingClientRect();
    if (!open || r.left > pr.right) { if (col.dataset.fit) { col.style.maxHeight = ''; delete col.dataset.fit; } return; }
    col.style.maxHeight = `min(100%, ${Math.max(170, Math.round(pr.top - r.top - 12))}px)`; col.dataset.fit = '1';
  });
}

function paint() {
  queueMicrotask(fitColumns);
  if (!panel || !body) return;
  loadFlags();
  const p = empire.commander;
  // a sworn warden whose hold is still being read: wait for it before deciding what is new
  const loading = !!wallet.active?.playerId && !p;
  // while a sworn warden's hold is still being read, keep what is shown (or a plain pill) rather than
  // falling back to early steps that only look undone because nothing has been read yet
  if (loading) {
    if (lastSig) return;
    lastSig = 'loading';
    panel.classList.add('min'); document.body.classList.remove('has-path'); document.body.classList.add('has-pill');
    clear(body);
    body.append(h('button', { type: 'button', class: 'path-pill', 'aria-label': 'The Warden’s Path' }, h('span', { class: 'faint' }, 'The Warden’s Path · reading…')));
    return;
  }
  const done = new Set(STEPS.filter((s) => s.test(p)).map((s) => s.id));
  // first paint: whatever is already true is simply lit, without fanfare, and already heard
  if (ready) {
    for (const id of done) if (!lastDone.has(id)) celebrate(STEPS.find((x) => x.id === id)!);
    // the last step walked: the whole sky hears of it
    if (done.size === STEPS.length && lastDone.size < STEPS.length && !flags['heard:path']) {
      flags['heard:path'] = true; save();
      setTimeout(() => proclaim('The path is walked', 'You are a warden now, truly. The rest of the sky is yours to learn.', 'gold'), 900);
      // she says farewell in full, then steps back into her lantern
      walkedAt = Date.now(); setTimeout(() => { lastSig = ''; paintSoon(); }, FAREWELL_MS + 300);
    }
  } else if (!loading) {
    let any = false;
    for (const id of done) if (!flags['heard:' + id]) { flags['heard:' + id] = true; any = true; }
    if (done.size === STEPS.length && !flags['heard:path']) { flags['heard:path'] = true; any = true; }
    if (any) save();
  }
  lastDone = done;
  if (!loading) ready = true;
  // A step that ripens slowly, or cannot be done yet, steps aside: the path walks on and comes back.
  const pending = STEPS.filter((s) => !done.has(s.id));
  const cur = pending.find((s) => !s.slow && (!s.ready || s.ready(p))) ?? pending[0];
  const waiting = cur ? pending.filter((s) => s !== cur && STEPS.indexOf(s) < STEPS.indexOf(cur)) : [];
  // one measure everywhere, the pill and the card alike: how many steps are walked. A step's place in
  // the list would jump about, since slow steps are stepped past and some come undone (a Delver falls).
  const n = done.size;
  // Ysolde speaks in full only where her step is done; elsewhere she folds to a "Next" pill and
  // keeps clear of the controls.
  // on a cramped screen (small laptop, tablet) she waits as a pill even on her own screen until asked
  const cramped = window.innerWidth < 1180 || window.innerHeight < 700;
  // with the path walked she keeps to a quiet pill (after her farewell), opened only when asked
  const folded = hidden() || (cur ? (!here(cur.route) || cramped) && !openHere : !openHere && Date.now() - walkedAt > FAREWELL_MS);
  const sig = [...done].join(',') + '|' + folded + '|' + whereNow() + '|' + (cur?.id || '') + '|' + waiting.map((w) => w.id).join(',') + '|' + cramped;
  if (sig === lastSig) return;
  lastSig = sig;
  panel.classList.toggle('min', folded);
  document.body.classList.toggle('has-path', !folded);
  document.body.classList.toggle('has-pill', folded);
  clear(body);
  if (folded) {
    body.append(h('button', { type: 'button', class: 'path-pill', onclick: () => { if (hidden()) setHidden(false); openHere = true; lastSig = ''; paint(); }, 'aria-label': `Open the Warden’s Path: ${n} of ${STEPS.length} steps walked${cur ? `, next ${cur.title}` : ''}` },
      h('span', { class: 'mono' }, `${n}/${STEPS.length}`), cur ? h('span', null, h('span', { class: 'faint' }, 'Next: '), cur.title) : ' The Warden’s Path'));
    return;
  }
  const said = h('p', { class: 'path-say' });
  // The latest step walked since Ysolde last spoke earns its line (even when the path skipped
  // past a slow step); any older unheard ones are quietly heard.
  const recent = [...STEPS].reverse().find((s) => done.has(s.id) && s.done && !flags['heard:' + s.id]);
  for (const s of STEPS) if (done.has(s.id) && s !== recent) flags['heard:' + s.id] = true;
  const last = 'You have walked the whole path. I will be in the Grimoire if you need the old words. Hoo.';
  const line = cur ? (recent ? `${recent.done} ${cur.say}` : cur.say) : recent ? `${recent.done} ${last}` : last;
  const todo = cur ? h('p', { class: 'path-do' }, h('span', { class: 'k' }, 'Next'), cur.do) : '';
  const ripening = waiting.length ? h('p', { class: 'path-wait' }, h('span', { class: 'k' }, 'Soon'), waiting.map((w) => w.id === 'tithe' ? 'Tithe, once your Cauldron brews alpha' : w.title).join(' · ')) : '';
  if (recent) { flags['heard:' + recent.id] = true; save(); }
  body.append(
    h('div', { class: 'path-head' },
      h('div', null, h('p', { class: 'eyebrow', style: { color: 'var(--gold)' } }, `The Warden’s Path · ${n} of ${STEPS.length} walked`),
        h('h2', { class: 'display', style: { fontSize: '21px', marginTop: '3px' } }, cur ? cur.title : 'The path is walked')),
      h('button', { type: 'button', class: 'icon-btn', style: { width: '32px', height: '32px', fontSize: '14px' }, 'aria-label': 'Fold the guide away', title: 'Fold away', onclick: () => { if (openHere) { openHere = false; lastSig = ''; paint(); if (!panel?.classList.contains('min')) setHidden(true); } else setHidden(true); } }, '–')),
    h('div', { class: 'path-steps', 'aria-hidden': 'true' }, ...STEPS.map((s) => h('i', { class: done.has(s.id) ? 'on' : s === cur ? 'cur' : waiting.includes(s) ? 'wait' : '' }))),
    said,
    todo,
    ripening,
    cur ? h('div', { class: 'row', style: { marginTop: '10px' } },
      h('button', { type: 'button', class: 'btn small gold', onclick: () => { go(cur.route); if (cur.glow) setTimeout(() => glow(cur.glow!), 450); } }, 'Show me'),
      cur.slow ? h('span', { class: 'faint', style: { fontSize: '12px' } }, 'This one ripens slowly.') : '') : '');
  if (line !== lastSaid) { lastSaid = line; speakInto(said, line); } else said.textContent = line;
}

export function mountGuide() {
  if (panel) return;
  const canvas = h('canvas', { width: 96, height: 96, class: 'path-owl', 'aria-hidden': 'true' }) as HTMLCanvasElement;
  body = h('div', { class: 'path-body' });
  panel = h('aside', { class: 'path glass', 'aria-label': 'The Warden’s Path — Ysolde the grey owl guides you' },
    h('div', { class: 'path-portrait' }, canvas, h('span', { class: 'path-name' }, 'Ysolde')), body);
  document.body.append(panel);
  // the side columns stop above Ysolde, however tall her words run
  if (typeof ResizeObserver !== 'undefined') {
    let queued = 0;
    const soon = () => { if (!queued) queued = requestAnimationFrame(() => { queued = 0; fitColumns(); }); };
    const ro = new ResizeObserver(soon);
    // each screen's .cols row resizes when notices or banners above it come and go; a new screen brings new ones
    const watchCols = () => { ro.disconnect(); ro.observe(panel!); document.querySelectorAll('.cols').forEach((c) => ro.observe(c)); soon(); };
    const app = document.getElementById('app');
    if (app) new MutationObserver(watchCols).observe(app, { childList: true });
    watchCols();
  }
  window.addEventListener('resize', fitColumns);
  try { portrait = owlPortrait(canvas); } catch { /* no GL: the words still guide */ }
  empire.onChange(paintSoon); wallet.onChange(paintSoon); enlisting.onChange(paintSoon);
  txq.onSettled((j) => {
    if (j.status !== 'success') return;
    const urls = j.msgs.map((m) => m.typeUrl).join();
    if (/ReactorInfuse|GeneratorInfuse/.test(urls)) markPath('tithe');
    if (/FleetMove/.test(urls)) markPath('ride');
    if (/StructAttack/.test(urls)) markPath('strike');
  });
  window.addEventListener(ROUTE_EVENT, () => { openHere = false; paintSoon(); });
  window.addEventListener('resize', paintSoon);
  paint();
  void portrait;
}

/** Start the path again from the first unlit step (flags for watched moments are kept). */
export function resetPath() {
  loadFlags();
  // the moments walked stay walked; only what Ysolde has already said is forgotten
  for (const k of Object.keys(flags)) if (k.startsWith('heard:')) delete flags[k];
  save(); lastSaid = ''; lastSig = ''; setHidden(false);
}
