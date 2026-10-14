/* The Warden's Path: a living tutorial. Ysolde, a grey owl spirit, walks a new warden from soulstone
 * to first strike. Every step is judged from the warden's real state on the ledger (or a rite that
 * landed), so it can never be "faked" past — and a warden who arrives already strong finds the early
 * steps already lit. "Show me" carries you to the right place and makes the right control glow. */
import { h, clear } from '../core/dom';
import K from '../world/wyrmkit.js';
import { wallet } from '../wallet/wallet';
import { empire, type PlayerState } from '../game/empire';
import { txq } from '../wallet/queue';
import { audio } from '../core/audio';
import { enlisting } from '../game/enlist';
import { proclaim } from './omens';
import { here as routeNow } from '../core/nav';
import { live } from '../chain/live';
import { omenSight, playerName } from '../realm';
import { LONG_ASLEEP, alive, blowsWord, exposure, guardsOf, inRealm, kinds, raidOdds, wardKeeper, type RaidOdds } from '../game/war';

interface Step {
  id: string;
  title: string;
  say: string;                // Ysolde's words while the step waits
  do: string;                 // the plain thing to do, always shown
  done?: string;              // her words when it lands
  route: string;              // where "Show me" goes
  glow?: string;              // data-tut target to make glow
  alt?: string[];             // data-tut targets standing in for the glow when it is not on screen (a list to choose from)
  aim?: string;               // the target's name, as Ysolde says it ("Ysolde points to Summon")
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
  { id: 'stone', title: 'Bind your soulstone', route: '/', glow: 'begin', aim: 'Swear the oath',
    say: 'Hoo. A new light on the old wind. First you need a soulstone: your name in the sky, sealed to this browser.',
    do: 'Press “Swear the oath” to begin.',
    done: 'There. The stone is warm. It knows your hand now.', test: () => wallet.state !== 'empty' },
  { id: 'oath', title: 'Swear to a coven', route: '/', glow: 'begin', aim: 'Swear the oath',
    say: 'No warden survives alone up here. A coven lends you a leyline until your own springs run.',
    do: 'Press “Swear the oath”, name your warden and choose a coven.',
    done: 'Sworn. The coven’s scribe has written you in.', test: () => !!wallet.active?.playerId },
  { id: 'isle', title: 'Seek your isle', route: '/hold', glow: 'seek', aim: 'Seek Isle',
    say: 'Somewhere below the clouds drifts a shard with no one on it. Something old will hatch there to meet you.',
    do: 'Press Seek Isle in the bar at the bottom.',
    done: 'Feel that? Your isle. And listen: the egg is cracking.', test: (p) => !!p?.planetId },
  { id: 'wyrm', title: 'Meet your Elder Wyrm', route: '/hold', glow: 'wyrm', aim: 'your Elder Wyrm',
    say: 'Your Elder Wyrm is bound to you alone. Every raid you ride, you ride on its back.',
    do: 'Click your Elder Wyrm on the isle, or in the list on the left.',
    done: 'It knows your scent now. Guard it: if it falls mid-raid, the raid breaks.', test: () => !!flags.wyrm },
  { id: 'delver', title: 'Summon a Root Delver', route: '/hold', glow: 'summon', aim: 'Summon',
    say: 'Your isle’s marrow is full of wildroot. A Root Delver lifts it up for you.',
    do: 'Press Summon, then choose the Root Delver.',
    done: 'The circle is drawn. Now the summoning must be sung.', test: (p) => owns(p, 14) },
  { id: 'chant', title: 'Let the chant ripen', route: '/hold', glow: 'chants', aim: 'Incantations',
    say: 'Every summoning must be sung. Your Hold sings it for you with this computer’s spare strength, and it gets easier every moment.',
    do: 'Wait for the Incantations bar to fill; it says roughly how long. Explore meanwhile, but keep Wyrmhodl open: the singing happens here.',
    done: 'Heard! The Delver wakes and will dig on its own now.', test: (p) => owns(p, 14, true), slow: true },
  { id: 'cauldron', title: 'Raise a Dawn Cauldron', route: '/hold', glow: 'summon', aim: 'Summon',
    say: 'Raiders can carry off wildroot. A Dawn Cauldron brews it into alpha, and brewed alpha can never be taken.',
    do: 'Press Summon, then choose the Dawn Cauldron.',
    done: 'Good. From now on, what you delve, you keep.', test: (p) => owns(p, 15) },
  { id: 'alpha', title: 'Understand alpha', route: '/grimoire', glow: 'tale', aim: 'the old tale',
    say: 'Alpha is the first light, fallen when the sky broke. It feeds your springs, calls your beasts, and the covens honour it as coin.',
    do: 'Open the Grimoire and read the old tale.',
    done: 'Now you know why every warden up here is hungry.', test: () => !!flags.grimoire },
  { id: 'tithe', title: 'Tithe to your wellspring', route: '/leyweave', glow: 'tithe', aim: 'Tithe',
    say: 'Your beasts drink mana. Lend a little alpha to your coven’s wellspring and your mana flow rises.',
    do: 'In the Leyweave, press Tithe. You can take it back later.',
    done: 'Your flow rises. The leylines hum your name.', test: () => !!flags.tithe, ready: (p) => !!p && p.alpha > 0n },
  { id: 'atlas', title: 'Read the sky', route: '/atlas', glow: 'rich', aim: 'Unbrewed wildroot',
    say: 'Every light out there is a warden: sleeping, scheming, or watching you. Amber isles hold a prize.',
    do: 'In the Sky Atlas, press “Unbrewed wildroot” to show the rich isles.',
    done: 'You see them now. Some of them see you.', test: (p) => !!flags.atlas || !!flags.ride || p?.fleet?.status === 'away' },
  { id: 'ride', title: 'Ride out', route: '/atlas', glow: 'ride', alt: ['atlas'],
    say: 'While your warband is abroad your own hold stands unguarded, and their beasts can strike your Elder Wyrm over their isle. Choose a hold that cannot fell it.',
    do: 'In the Sky Atlas, choose a hold whose card says “long asleep”, or whose beasts cannot reach your Wyrm. Press Raid this hold, then Ride out.',
    done: 'The wind is under you. Fell their Elder Wyrm, and your plunder chant breaks their ward.', test: (p) => !!flags.ride || p?.fleet?.status === 'away' },
  { id: 'strike', title: 'Strike', route: '/skirmish', glow: 'unleash', aim: 'Unleash',
    say: 'Read the odds before you swing. Their beasts answer your blows, and any that reach your Elder Wyrm can strike it while you stay.',
    do: 'In the Skirmish the wisest blow is chosen for you. Read what it will do and what can strike your Wyrm, then press Unleash.',
    done: 'Blood in the clouds. You are a warden now, truly.', test: () => !!flags.strike },
];

/* ── Counsel: the raid steps send a young warband only where it comes home ── */

/** The route the warden stands on ('/skirmish/1-2'), whether the sky routes by hash or by path. */
const route = () => {
  if (/^#\//.test(location.hash)) return decodeURI(location.hash.slice(1));
  const r = routeNow(), w = new URLSearchParams(location.search).get('warden');
  return w && !r.slice(1).includes('/') ? `${r}/${w}` : r;
};

/** The warden's Elder Wyrm stands no more, and no new one is hatching: they have lost it. */
function grieving(p: PlayerState | null): boolean {
  if (!p?.planetId) return false;
  const wyrms = [...p.structs.values()].filter((s) => s.typeId === 1);
  return !wyrms.some((s) => !s.destroyed) && (wyrms.length > 0 || !!flags.wyrm);
}
/** What Ysolde says when the warden's Wyrm has fallen: a kind word and the way back, never a cheer. */
const GRIEF: Step = { id: 'grief', title: 'Your Elder Wyrm has fallen', route: '/hold', glow: 'hatch', aim: 'Hatch anew',
  say: 'Oh, warden. Your Elder Wyrm has fallen, and I am sorry: it was brave. Wounds never mend up here, but a fallen Wyrm hatches anew at full hearts. Until it does, your hold lies open to raiders.',
  do: 'At your Hold, press Hatch anew. When your new Wyrm wakes, we walk on together.', test: () => false };

/** The hold the warden means to raid: the one their warband hangs over, the Skirmish's foe, or the Atlas's chosen isle. */
function foeInView(p: PlayerState): PlayerState | null {
  const ride = document.querySelector('a[data-tut="ride"]')?.getAttribute('href') || '';
  const id = (p.fleet?.status === 'away' ? p.target?.Planet.owner : undefined)
    ?? /^\/skirmish\/([^/?#]+)/.exec(route())?.[1]
    ?? /skirmish\/(?:\?warden=)?([\w-]+)/.exec(ride)?.[1];
  const f = id ? empire.players.get(decodeURIComponent(id)) : null;
  return f && f.playerId !== p.playerId ? f : null;
}

/** Whether any hold in sight has long slept (null: not known yet). The sight is read at most once a minute. */
let sightAt = 0, anyAsleep: boolean | null = null;
function someoneAsleep(p: PlayerState): boolean | null {
  if (Date.now() - sightAt > 60_000) {
    sightAt = Date.now();
    void omenSight().then((m) => {
      const was = anyAsleep, at = live.height;
      anyAsleep = !!at && [...m].some(([pid, s]) => pid !== p.playerId && s.lastAction > 0 && at - s.lastAction > LONG_ASLEEP);
      if (was !== anyAsleep) { lastSig = ''; paintSoon(); }
    }).catch(() => { /* unknown: she says nothing of it */ });
  }
  return anyAsleep;
}

/** Why a raid on `who` is or is not one a young warband comes home from, in Ysolde's words. */
function oddsLine(o: RaidOdds, who: string): string {
  const ex = o.ex, reaching = ex && ex.by.length ? `their ${kinds(ex.by.map((b) => b.s))}` : 'their beasts';
  switch (o.why) {
    case 'open': return `${who}’s ward is open, and nothing of theirs at home can strike your Elder Wyrm. Ride while it lasts.`;
    case 'asleep': return `${who} has long slept. Their beasts will answer your blows, but they are unlikely to strike your Elder Wyrm. A fair first raid.`;
    case 'unreached': return `Nothing of ${who}’s can reach your Elder Wyrm where it flies, and their answers will not fell it. A fair raid.`;
    case 'guarded': return `${reaching.charAt(0).toUpperCase() + reaching.slice(1)} can reach your Elder Wyrm, but your guard takes their blows first and should hold while you break ${who}’s ward.`;
    case 'reached': return `Careful. ${who} is awake, and ${reaching} can reach your Elder Wyrm while you hang over their isle${ex && Number.isFinite(ex.blows) ? `: ${blowsWord(ex.blows)} would fell it` : ''}. That raid could cost you your Wyrm.`;
    case 'answers': return `Careful. ${who}’s beasts answer every blow, and their answers alone would fell your Elder Wyrm before their own Wyrm falls.`;
    case 'unreachable': return `None of your beasts can bring down ${who}’s Elder Wyrm from where they fly.`;
    default: return '';
  }
}

/** Ysolde's words for the raid steps, from where the warden really stands. She never sends a young warband
 * where it would likely lose its Elder Wyrm, and when no hold is safe she says what to do first. */
function counsel(step: Step, p: PlayerState | null): Partial<Step> | null {
  if (!p || (step.id !== 'ride' && step.id !== 'strike')) return null;
  const w = [...p.structs.values()].find((s) => s.typeId === 1 && !s.destroyed);
  if (!w) return null;
  if (!w.built) return { title: 'Wait for your Wyrm', say: 'Your new Elder Wyrm is still hatching. Every raid rides on its back, so we wait for it to wake.', do: 'Its hatching chant sings under Incantations, at your Hold.', route: '/hold', glow: 'chants', alt: undefined, aim: 'Incantations' };
  const f = foeInView(p), at = route(), onSk = at.startsWith('/skirmish');
  const sk = f ? `/skirmish/${f.playerId}` : '/skirmish';
  if (p.fleet?.status === 'away' && f) {
    // in their sky: the danger first, then what the raid still needs
    const theirs = f.fleet?.status !== 'away' ? [...f.structs.values()].filter((s) => alive(s) && s.type?.category === 'fleet') : [];
    const ex = exposure(w, theirs, p);
    const asleep = !!f.lastAction && live.height - f.lastAction > LONG_ASLEEP;
    if (ex.falls && !asleep) return { title: 'Ride home', say: `Their ${kinds(ex.by.map((b) => b.s))} can reach your Elder Wyrm here, and one blow from each would fell it. Ride home: a raid can wait, and a Wyrm cannot.`, do: 'Press Ride home in the Skirmish.', route: onSk ? at : sk, glow: 'home', alt: undefined, aim: 'Ride home' };
    if (!wardKeeper(f)) return { title: 'Hold their sky', say: `${playerName(f)}’s Elder Wyrm stands guard no more: their ward is open. Hold their sky while your plunder chant sings.`, do: 'Watch the plunder chant in the Skirmish’s war bar, then ride home once it lands.', route: onSk ? at : sk, glow: undefined, alt: undefined, aim: undefined };
    return step.id === 'strike' ? { route: onSk ? at : sk } : null;
  }
  // choosing a hold: only one a young warband comes home from
  const guarded = guardsOf(w, p).length > 0;
  const firstGuard = `Every hold I can see is awake, and an awake warden’s beasts strike whoever hangs over their isle. Set a guard beside your Elder Wyrm before you ride: a beast in ${inRealm(w.ambit)}, its own realm, takes the blows meant for it.`;
  const toGuard = { title: 'Guard your Wyrm first', do: 'At your Hold, summon a beast of your Wyrm’s realm, then press Guard… on it and choose your Elder Wyrm.', route: '/hold', glow: 'summon', alt: undefined, aim: 'Summon' };
  if (f) {
    const o = raidOdds(p, f, live.height);
    if (o.safe) return { say: oddsLine(o, playerName(f)), do: onSk ? 'Press Ride out.' : 'Press Raid this hold, then Ride out.', route: onSk ? at : '/atlas', glow: 'ride', alt: undefined };
    if (!guarded && someoneAsleep(p) === false) return { ...toGuard, say: `${oddsLine(o, playerName(f))} ${firstGuard}` };
    return { title: 'Choose a safer hold', say: `${oddsLine(o, playerName(f))} Choose a hold that has long slept, or one whose beasts cannot reach your Wyrm.`, do: 'In the Sky Atlas, choose another hold.', route: '/atlas', glow: 'atlas', alt: undefined, aim: 'the wardens of the sky' };
  }
  // no hold chosen yet: if none in sight is safe, say so plainly and what to do first
  if (!guarded && someoneAsleep(p) === false) return { ...toGuard, say: firstGuard };
  return step.id === 'strike' ? { say: 'Your warband is home. Choose a hold that cannot fell your Elder Wyrm, ride out, and strike from their sky.', do: step.do, route: '/atlas', glow: 'atlas', aim: 'the wardens of the sky' } : null;
}

/** The step as Ysolde tells it now: the warden's loss comes before every step; the raid steps take counsel. */
function effective(step: Step | undefined, p: PlayerState | null): Step | undefined {
  if (grieving(p)) return GRIEF;
  if (!step) return step;
  const c = counsel(step, p);
  return c ? { ...step, ...c } : step;
}

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
const here = (to: string) => { const at = route(); return to === '/' ? at === '/' : at === to || (to !== '/hold' && at.startsWith(to + '/')); };

/** Make a control glow until it is used (or for a while). Screens repaint, so the glow is
 * re-applied to whatever element carries the tag until it is touched or the moment passes. "Show me"
 * also brings the control into view, moves the keyboard there, and says so. */
let glowing: { tag: string; until: number; scrolled: boolean; aim?: string } | null = null;
// a stylesheet rule, not a class, so a control rebuilt by a repaint glows from the moment it is drawn
const glowSheet = document.createElement('style');
document.head.append(glowSheet);
function setGlow(g: typeof glowing) {
  glowing = g;
  glowSheet.textContent = g ? `[data-tut="${CSS.escape(g.tag)}"] { position: relative; z-index: 3; outline: 2px solid var(--gold) !important; outline-offset: 3px; animation: tutglow 1.2s ease-in-out infinite !important; }` : '';
}
/** Targets no screen tags itself: found by what they say, and tagged here so they can glow. */
const FIND: Record<string, () => HTMLElement | null> = {
  hatch: () => [...document.querySelectorAll<HTMLElement>('.hold-omens button')].find((b) => /^Hatch anew/.test(b.textContent?.trim() || '')) || null,
};
function tagFinds() { for (const [tag, find] of Object.entries(FIND)) if (!document.querySelector(`[data-tut="${tag}"]`)) { const el = find(); if (el) el.dataset.tut = tag; } }
/** The first element with this tag that stands on screen (not inside Ysolde). */
function onScreen(tag: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tut="${CSS.escape(tag)}"]`)) {
    if (el.closest('.path')) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth) return el;
  }
  return null;
}
/** A control's own name, as a screen reader hears it first: its label up to any colon, or its first line of words. */
const nameOf = (el: HTMLElement) => (el.getAttribute('aria-label') || el.innerText || '').split(/\n|:/)[0].trim().slice(0, 60);
/** Bring a control into view and put the keyboard on it, and say so politely. */
function point(el: HTMLElement, aim?: string) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView?.({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  if (!el.matches('a[href], button, input, select, textarea, summary, [tabindex]')) el.tabIndex = -1;
  el.focus({ preventScroll: true });
  announce(`Ysolde points to ${aim || nameOf(el) || 'the next step'}.`);
}
setInterval(() => {
  tagFinds();
  stepAside();
  if (!glowing) return;
  if (Date.now() > glowing.until) { setGlow(null); return; }
  if (glowing.scrolled) return;
  const el = onScreen(glowing.tag) || document.querySelector<HTMLElement>(`[data-tut="${CSS.escape(glowing.tag)}"]`);
  if (el) { glowing.scrolled = true; point(el, glowing.aim); stepAside(); }
}, 250);
document.addEventListener('click', (e) => {
  if (glowing && (e.target as HTMLElement)?.closest?.(`[data-tut="${glowing.tag}"]`)) setGlow(null);
}, true);
export function glow(tag: string) { setGlow({ tag, until: Date.now() + 12000, scrolled: false, aim: shownStep?.glow === tag ? shownStep.aim : undefined }); }

/* ── Ysolde never covers what she points at ──────────────────────────── */

/** The step she shows now (for its target), and the tags that stand for it on screen. */
let shownStep: Step | undefined;
/** The pill's corner when the home corner (bottom left) would cover the target. */
let spot = '';
const SPOTS = ['br', 'tr', 'tl'];
/** She folded to step aside from her target, for this step on this screen. */
let dodged = '';
const dodgeKey = () => `${shownStep?.id || ''}|${shownStep?.title || ''}|${route()}`;
/** Targets already scrolled clear of her once (she never fights the warden's own scrolling). */
const scrolledClear = new WeakSet<Element>();
function setSpot(s: string) { if (!panel) return; for (const x of SPOTS) panel.classList.toggle('at-' + x, x === s); spot = s; }
function targetEl(): HTMLElement | null {
  const tags = glowing ? [glowing.tag] : shownStep ? [shownStep.glow, ...(shownStep.alt || [])].filter((t): t is string => !!t) : [];
  for (const t of tags) { const el = onScreen(t); if (el) return el; }
  return null;
}
/** What of the target she must leave clear: all of it, or of a tall list, its first rows. */
function targetRect(el: HTMLElement): DOMRect {
  const r = el.getBoundingClientRect(), top = Math.max(0, r.top), tall = Math.min(innerHeight, r.bottom) - top;
  return tall > innerHeight * 0.4 ? new DOMRect(r.left, top, r.width, Math.min(tall, 140)) : r;
}
const overlaps = (a: DOMRect, b: DOMRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
/** If she covers the control she points at, she folds to her pill, and the pill takes the first corner that
 * leaves it clear; with no corner clear, the control is scrolled into the open, once. Every size. */
function stepAside() {
  if (!panel || !body || document.body.classList.contains('in-prologue')) return;
  if (dodged && dodged !== dodgeKey()) { dodged = ''; lastSig = ''; paintSoon(); }
  const el = targetEl();
  if (!el) { if (spot) setSpot(''); return; }
  const tr = targetRect(el);
  if (!panel.classList.contains('min')) {
    // opened by hand to be read, she stays until "Show me" or the fold
    if (openHere && !glowing) return;
    if (overlaps(tr, panel.getBoundingClientRect())) { dodged = dodgeKey(); openHere = false; lastSig = ''; paint(); }
    return;
  }
  // the home corner whenever it is clear, else the first other corner that is
  for (const s of ['', ...SPOTS]) { setSpot(s); if (!overlaps(tr, panel.getBoundingClientRect())) return; }
  setSpot('');
  if (!scrolledClear.has(el)) { scrolledClear.add(el); el.scrollIntoView?.({ block: 'center' }); }
}

/** A polite voice for those who cannot see her: each new step once, and where "Show me" points. */
let liveEl: HTMLElement | null = null;
function announce(text: string) {
  if (!liveEl) return;
  const el = liveEl;
  el.textContent = '';
  window.setTimeout(() => { el.textContent = text; }, 80);
}
/** Steps already announced this visit; the first one shown at boot is not spoken over the page's own. */
const announced = new Set<string>();
let announcedFirst = false;

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
  // a warden who has just lost their Elder Wyrm hears no cheer: every step that landed is heard quietly
  const grief = grieving(p);
  if (grief) { let any = false; for (const s of STEPS) if (done.has(s.id) && !flags['heard:' + s.id]) { flags['heard:' + s.id] = true; any = true; } if (any) save(); }
  // first paint: whatever is already true is simply lit, without fanfare, and already heard
  if (ready) {
    // never a celebration in the same breath as a loss
    if (!grief) for (const id of done) if (!lastDone.has(id)) celebrate(STEPS.find((x) => x.id === id)!);
    // the last step walked: the whole sky hears of it
    if (done.size === STEPS.length && lastDone.size < STEPS.length && !flags['heard:path']) {
      flags['heard:path'] = true; save();
      if (!grief) {
        setTimeout(() => proclaim('The path is walked', 'You are a warden now, truly. The rest of the sky is yours to learn.', 'gold'), 900);
        // she says farewell in full, then steps back into her lantern
        walkedAt = Date.now(); setTimeout(() => { lastSig = ''; paintSoon(); }, FAREWELL_MS + 300);
      }
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
  const next = pending.find((s) => !s.slow && (!s.ready || s.ready(p))) ?? pending[0];
  const waiting = next ? pending.filter((s) => s !== next && STEPS.indexOf(s) < STEPS.indexOf(next)) : [];
  // the raid steps take counsel from where the warden stands, and a fallen Wyrm comes before any step
  const cur = effective(next, p);
  shownStep = cur;
  // each new step is said once, politely, for those who cannot see her (not the one she shows at boot)
  const heard = cur ? `${cur.id}|${cur.title}` : 'walked';
  if (!announced.has(heard)) {
    announced.add(heard);
    if (announcedFirst) announce(cur ? `Ysolde: ${cur === GRIEF ? '' : 'next, '}${cur.title}. ${cur.do}` : 'Ysolde: the whole path is walked.');
  }
  announcedFirst = true;
  // one measure everywhere, the pill and the card alike: how many steps are walked. A step's place in
  // the list would jump about, since slow steps are stepped past and some come undone (a Delver falls).
  const n = done.size;
  // Ysolde speaks in full only where her step is done; elsewhere she folds to a "Next" pill and
  // keeps clear of the controls.
  // on a cramped screen (small laptop, tablet) she waits as a pill even on her own screen until asked
  const cramped = window.innerWidth < 1180 || window.innerHeight < 700;
  // she also folds, wherever she is, when standing open would cover the control she points at
  const stepped = !!dodged && dodged === dodgeKey();
  // with the path walked she keeps to a quiet pill (after her farewell), opened only when asked
  const folded = hidden() || stepped || (cur ? (!here(cur.route) || cramped) && !openHere : !openHere && Date.now() - walkedAt > FAREWELL_MS);
  const sig = [...done].join(',') + '|' + folded + '|' + (location.hash || '/') + '|' + (cur?.id || '') + '|' + waiting.map((w) => w.id).join(',') + '|' + cramped;
  // counsel changes her words without changing the step: what she says is part of what she shows
  const shows = sig + '|' + route() + '|' + (cur ? `${cur.title}|${cur.say}|${cur.do}|${cur.route}|${cur.glow}` : '');
  if (shows === lastSig) return;
  lastSig = shows;
  panel.classList.toggle('min', folded);
  if (!folded) setSpot('');
  document.body.classList.toggle('has-path', !folded);
  document.body.classList.toggle('has-pill', folded);
  clear(body);
  if (folded) {
    body.append(h('button', { type: 'button', class: 'path-pill', onclick: () => { if (hidden()) setHidden(false); openHere = true; dodged = ''; lastSig = ''; paint(); }, 'aria-label': `Open the Warden’s Path: ${n} of ${STEPS.length} steps walked${cur ? `, ${cur === GRIEF ? '' : 'next '}${cur.title}` : ''}` },
      h('span', { class: 'mono' }, `${n}/${STEPS.length}`), cur ? h('span', null, h('span', { class: 'faint' }, cur === GRIEF ? '' : 'Next: '), cur.title) : ' The Warden’s Path'));
    queueMicrotask(stepAside);
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
    h('div', { class: 'path-steps', 'aria-hidden': 'true' }, ...STEPS.map((s) => h('i', { class: done.has(s.id) ? 'on' : s.id === cur?.id ? 'cur' : waiting.includes(s) ? 'wait' : '' }))),
    said,
    todo,
    ripening,
    cur ? h('div', { class: 'row', style: { marginTop: '10px' } },
      h('button', { type: 'button', class: 'btn small gold', onclick: () => { if (location.hash !== cur.route && !(cur.route === '/' && (location.hash === '' || location.hash === '/'))) location.hash = cur.route; if (cur.glow) setTimeout(() => glow(cur.glow!), 450); } }, 'Show me'),
      cur.slow ? h('span', { class: 'faint', style: { fontSize: '12px' } }, 'This one ripens slowly.') : '') : '');
  if (line !== lastSaid) { lastSaid = line; speakInto(said, line); } else said.textContent = line;
  queueMicrotask(stepAside);
}

export function mountGuide() {
  if (panel) return;
  const canvas = h('canvas', { width: 96, height: 96, class: 'path-owl', 'aria-hidden': 'true' }) as HTMLCanvasElement;
  body = h('div', { class: 'path-body' });
  // her polite voice: each new step once, and where "Show me" points (seen by no one, heard by screen readers)
  liveEl = h('p', { class: 'path-live', role: 'status', 'aria-live': 'polite', style: { position: 'absolute', width: '1px', height: '1px', margin: '-1px', padding: '0', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: '0' } });
  panel = h('aside', { class: 'path glass', 'aria-label': 'The Warden’s Path — Ysolde the grey owl guides you' },
    h('div', { class: 'path-portrait' }, canvas, h('span', { class: 'path-name' }, 'Ysolde')), body, liveEl);
  document.body.append(panel);
  // the Atlas's chosen isle changes what she counsels for a raid: hear it when it changes
  let chosen = '';
  setInterval(() => { const r = document.querySelector('a[data-tut="ride"]')?.getAttribute('href') || ''; if (r !== chosen) { chosen = r; paintSoon(); } }, 500);
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
  window.addEventListener('hashchange', () => { openHere = false; paintSoon(); });
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
