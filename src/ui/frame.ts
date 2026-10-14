/* The frame every screen shares: the sigil, the realm's roads, the ledger's pulse, the warden's
 * soulstone, and the five meters of a hold (alpha, wildroot, mana, breath, ward). */
import { h } from '../core/dom';
import { live } from '../chain/live';
import { wallet } from '../wallet/wallet';
import { empire, type PlayerState } from '../game/empire';
import { num } from '../chain/lcd';
import { fmtAlpha, fmtBreath, fmtMana, sheaves } from '../lore';
import { enlisting } from '../game/enlist';
import { ambience, audio } from '../core/audio';
import { glyph } from './glyphs';

export function sigil(size = 34, color = '#e8c872') {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', String(size)); svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 40 40'); svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', color); svg.setAttribute('stroke-width', '1.6'); svg.setAttribute('aria-hidden', 'true');
  for (const [d, fill] of [['M20 2 L37 20 L20 38 L3 20 Z', ''], ['M8 20 C13 12, 27 12, 32 20 C27 28, 13 28, 8 20 Z', ''], ['M20 13 C22 17, 22 23, 20 27 C18 23, 18 17, 20 13 Z', color]]) {
    const p = document.createElementNS(ns, 'path'); p.setAttribute('d', d); if (fill) p.setAttribute('fill', fill); svg.append(p);
  }
  return svg;
}

export function icon(path: string, size = 18) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', String(size)); svg.setAttribute('height', String(size)); svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2'); svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
  const p = document.createElementNS(ns, 'path'); p.setAttribute('d', path); svg.append(p);
  return svg;
}
export const ICON = { close: 'M6 6l12 12M18 6L6 18', arrow: 'M5 12h14M13 6l6 6-6 6', warn: 'M12 3l10 18H2zM12 10v5M12 18v.5', key: 'M15 7a4 4 0 1 1-3.9 4.9L3 20v-3h3v-3h3l2.1-2.1A4 4 0 0 1 15 7z' };

/** The roads, grouped by what they are for: play, the economy of mana, and learning. */
const ROADS: [string, string, string][][] = [
  [['/hold', 'The Hold', 'Your isle and beasts'], ['/atlas', 'Sky Atlas', 'Every isle in the sky: find one to raid'], ['/skirmish', 'Skirmish', 'Fight and plunder']],
  [['/leyweave', 'Leyweave', 'Mana: tithe alpha for more']],
  [['/bestiary', 'Bestiary', 'Every beast and hallow'], ['/grimoire', 'Grimoire', 'The lore and the glossary']],
];

/** The top bar. Returns the element and a disposer for its listeners. */
export function topbar(route: string, onSoulstone: (start?: 'words') => void, opts: { meters?: boolean } = {}) {
  const dot = h('span', { class: 'link-dot' });
  const bell = h('span', { class: 'mono faint', style: { fontSize: '12px' } });
  const stone = h('button', { type: 'button', class: 'btn small', 'data-tut': 'soulstone', title: 'Your soulstone: your warden, soul-words and details', onclick: () => onSoulstone() });
  // A soulstone forged here whose words were never written down: the one thing worth nagging about.
  const nag = h('button', { type: 'button', class: 'btn small nag', title: 'Your soul-words are the only way back if this browser forgets you', onclick: () => onSoulstone('words') },
    icon(ICON.warn, 15), h('span', { class: 't' }, 'Keep your soul-words'));
  const music = h('button', { type: 'button', class: 'icon-btn', style: { width: '36px', height: '36px' }, onclick: () => ambience.toggle() });
  const help = h('button', { type: 'button', class: 'icon-btn help-btn', style: { width: '36px', height: '36px' }, 'aria-label': 'How to play', title: 'How to play', onclick: () => { void import('./help').then((m) => m.openHelp()); } }, '?');
  const meterBox = h('div', { class: 'meters' });
  const bar = h('header', { class: 'glass topbar' + (opts.meters ? ' with-meters' : '') },
    h('a', { class: 'brand', href: '/' }, sigil(), h('span', null, h('b', null, 'Wyrmhodl'), h('small', null, h('span', { class: 'row', style: { gap: '6px' } }, dot, bell)))),
    opts.meters ? meterBox : null,
    h('nav', { class: 'nav', 'aria-label': 'Realms' }, ...ROADS.flatMap((group, gi) => [gi ? h('span', { class: 'nav-sep', 'aria-hidden': 'true' }) : null,
      ...group.map(([href, label, tip]) => h('a', { href, title: tip, class: route === href ? 'on' : '', 'aria-current': route === href ? 'page' : null }, label))])),
    h('div', { class: 'row bar-actions', style: { gap: '6px' } }, nag, help, music, stone));
  const paint = () => {
    dot.className = 'link-dot ' + (live.state === 'live' ? 'live' : live.state === 'down' ? 'down' : '');
    bell.textContent = live.state === 'live' ? 'the sky is awake' : live.state === 'down' ? 'the sky is silent' : 'reaching the sky…';
    bell.title = live.state === 'live' ? `Bell ${live.height.toLocaleString('en-US')}. The sky beats about every six seconds.` : '';
    const a = wallet.active;
    stone.textContent = '';
    stone.append(icon(ICON.key, 16), ' ',
      wallet.state === 'empty' ? 'Bind your soulstone'
        : enlisting.running ? 'Swearing the oath…'
          : a?.playerId ? (a.label && a.label !== 'Commander' ? a.label : 'Your warden') : wallet.unlocked ? 'Finish the oath' : 'Soulstone sealed');
    nag.hidden = !(wallet.unlocked && wallet.deviceSealed && !wallet.backedUp);
    if (opts.meters) paintMeters(meterBox, empire.commander);
    music.textContent = '';
    music.setAttribute('aria-label', ambience.on ? 'Hush the sky’s music' : 'Let the sky sing');
    music.setAttribute('aria-pressed', String(ambience.on));
    music.title = ambience.on ? 'Hush the music' : 'Let the sky sing';
    music.append(icon(ambience.on ? 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z' : 'M9 18V5l12-2v13M3 3l18 18', 16));
  };
  const offs = [live.onBlock(paint), live.onState(paint), wallet.onChange(paint), empire.onChange(paint), enlisting.onChange(paint), ambience.onChange(paint)];
  // on a phone the roads scroll sideways: start with the current one in view
  requestAnimationFrame(() => {
    const nav = bar.querySelector('.nav') as HTMLElement | null, on = nav?.querySelector('a.on') as HTMLElement | null;
    if (nav && on && nav.scrollWidth > nav.clientWidth) nav.scrollLeft = on.offsetLeft - nav.offsetLeft - (nav.clientWidth - on.offsetWidth) / 2;
  });
  paint();
  // heralds on narrower screens speak just below the bar, not over its buttons
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { if (bar.isConnected) document.documentElement.style.setProperty('--bar-bottom', `${Math.max(0, Math.round(bar.getBoundingClientRect().bottom + (bar.closest('.scrolls')?.scrollTop ?? 0)))}px`); }) : null;
  ro?.observe(bar);
  return { el: bar, dispose: () => { offs.forEach((f) => f()); closeGloss(); ro?.disconnect(); } };
}

export function wardOf(p: PlayerState | null) { return num(p?.planet?.planetAttributes?.planetaryShield); }

/** Each meter, said plainly: what it is, and how to get more. */
export const GLOSS: Record<string, [string, string, string]> = {
  alpha: ['Alpha', 'Your treasure. It pays for summoning and tithes, and once brewed no raider can take it.', 'More: dig wildroot with a Root Delver, then brew it in a Dawn Cauldron.'],
  root: ['Wildroot', 'Raw treasure dug from your isle. Until it is brewed into alpha, raiders can steal it.', 'More: a Root Delver digs it up. Brew it quickly in a Dawn Cauldron.'],
  mana: ['Mana', 'Your leylines pour mana; your awake beasts drink it. The number is what is spare, and every summoning needs that much spare. If they drink more than you pour, every beast falters.', 'More: tithe alpha to a wellspring in the Leyweave, or let a beast slumber.'],
  breath: ['Breath', 'Your readiness to act. Summoning, striking, riding out and guarding each need some, and doing one spends it all.', 'It refills on its own, one every bell (about six seconds).'],
  ward: ['Ward', 'How hard your hold is to raid: the higher it is, the longer a raider must chant to break in.', 'More: raise a Ward Lantern, Veil Moon, Thunder Spire or Barrow Vault.'],
};

let gloss: HTMLElement | null = null;
function closeGloss() { gloss?.remove(); gloss = null; document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escGloss); }
function outside(e: Event) { if (!(e.target as HTMLElement)?.closest?.('.gloss, .meter')) closeGloss(); }
function escGloss(e: KeyboardEvent) { if (e.key === 'Escape') closeGloss(); }
function openGloss(anchor: HTMLElement, key: string) {
  const was = gloss?.dataset.key;
  closeGloss();
  if (was === key) return;
  const [name, what, more] = GLOSS[key];
  const r = anchor.getBoundingClientRect();
  gloss = h('div', { class: 'gloss glass', role: 'dialog', 'aria-label': name, 'data-key': key },
    h('b', null, name), h('p', null, what), h('p', { class: 'more' }, more));
  document.body.append(gloss);
  const w = gloss.offsetWidth;
  gloss.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
  gloss.style.top = r.bottom + 8 + 'px';
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', escGloss);
}

/** Treasure that changes should be seen changing: the meter glows and the difference floats up. */
let lastFor = '';
const lastVal: Record<string, bigint> = {};
const glowUntil: Record<string, { until: number; up: boolean }> = {};
function noticeChange(p: PlayerState, box: HTMLElement) {
  const now: Record<string, bigint> = { alpha: p.alpha, root: BigInt(p.ore), ward: BigInt(wardOf(p)) };
  if (lastFor !== p.playerId) { lastFor = p.playerId; Object.assign(lastVal, now); return; }
  for (const k of Object.keys(now)) {
    const d = now[k] - (lastVal[k] ?? now[k]);
    lastVal[k] = now[k];
    if (d === 0n) continue;
    glowUntil[k] = { until: Date.now() + 1800, up: d > 0n };
    // brewed alpha rings a small high bell: the sound of treasure that cannot be taken
    if (k === 'alpha' && d > 0n) audio.bell(1318.5, 0.05, 1.4);
    const text = (d > 0n ? '+' : '−') + (k === 'alpha' ? `${fmtAlpha(d > 0n ? d : -d)} α` : k === 'root' ? `${d > 0n ? d : -d} wildroot` : `${d > 0n ? d : -d} ward`);
    requestAnimationFrame(() => {
      const m = box.querySelector(`[data-key="${k}"]`) as HTMLElement | null;
      if (!m || !m.offsetParent) return;
      const r = m.getBoundingClientRect();
      const chip = h('div', { class: 'meter-delta' + (d > 0n ? ' up' : ' down'), 'aria-hidden': 'true' }, text);
      Object.assign(chip.style, { left: `${r.left + r.width / 2}px`, top: `${r.bottom + 4}px` });
      document.body.append(chip);
      setTimeout(() => chip.remove(), 1700);
    });
  }
}

export function paintMeters(box: HTMLElement, p: PlayerState | null) {
  // meters repaint every bell: keep keyboard focus on the one the warden was on
  const focused = (document.activeElement as HTMLElement | null)?.closest?.('.meter') as HTMLElement | null;
  const refocus = focused && box.contains(focused) ? focused.dataset.key : null;
  box.textContent = '';
  if (refocus) queueMicrotask(() => (box.querySelector(`[data-key="${refocus}"]`) as HTMLElement | null)?.focus({ preventScroll: true }));
  if (!p) return;
  const cap = p.capacity + p.connectionCapacity, load = p.load + p.structsLoad;
  const pct = cap > 0n ? Math.min(100, Number((load * 100n) / cap)) : 100;
  const breath = empire.charge(p);
  // mana leads with what is spare, the number every summoning asks about
  const spare = cap - load;
  const said: Record<string, string> = { alpha: `${fmtAlpha(p.alpha)} alpha`, root: sheaves(p.ore), mana: spare >= 0n ? `${fmtMana(spare)} spare of ${fmtMana(cap)}` : `${fmtMana(-spare)} short`, breath: fmtBreath(breath), ward: String(wardOf(p)) };
  noticeChange(p, box);
  const lit = (key: string) => { const g = glowUntil[key]; return g && g.until > Date.now() ? (g.up ? ' lit-up' : ' lit-down') : ''; };
  const meter = (key: string, cls: string, ...kids: (Node | string)[]) =>
    h('button', { type: 'button', class: 'meter ' + cls + lit(key), 'data-key': key, 'aria-label': `${GLOSS[key][0]}, ${said[key]}. Press to learn what it means.`, onclick: (e: Event) => openGloss(e.currentTarget as HTMLElement, key) }, ...kids);
  box.append(
    meter('alpha', 'm-alpha',
      h('span', { class: 'k' }, h('span', null, glyph('alpha', 13), 'Alpha')), h('span', { class: 'v' }, fmtAlpha(p.alpha), h('small', { class: 'alpha-glyph' }, ' α'))),
    meter('root', 'm-root' + (p.ore > 0 ? ' risk' : ''),
      h('span', { class: 'k' }, h('span', null, glyph('wildroot', 13), 'Wildroot')), h('span', { class: 'v' }, String(p.ore), h('small', null, p.ore === 1 ? ' sheaf' : ' sheaves'))),
    meter('mana', 'm-mana',
      h('span', { class: 'k' }, h('span', null, glyph('mana', 13), 'Mana'), h('span', { title: `Your beasts drink ${fmtMana(load)} of the ${fmtMana(cap)} your leylines pour` },
        h('span', { class: 'long' }, spare >= 0n ? `${fmtMana(spare)} spare` : `${fmtMana(-spare)} short`), h('span', { class: 'short' }, spare >= 0n ? fmtMana(spare) : `−${fmtMana(-spare)}`))),
      // full bar = plenty spare, like breath; it runs ember as the leylines near their end
      h('span', { class: 'bar' }, h('i', { style: { width: (100 - pct) + '%', background: pct > 90 || !p.online ? 'var(--ember)' : 'var(--sky)' } }))),
    meter('breath', 'm-breath',
      h('span', { class: 'k' }, h('span', null, glyph('breath', 13), 'Breath'), h('span', null, fmtBreath(breath))),
      h('span', { class: 'bar' }, h('i', { style: { width: Math.min(100, breath / 8 * 100) + '%', background: 'var(--verdigris)' } }))),
    meter('ward', 'm-ward',
      h('span', { class: 'k' }, h('span', null, glyph('ward', 13), 'Ward')), h('span', { class: 'v' }, String(wardOf(p)))),
  );
}

export function hearts(hp: number, max: number) { return '♥'.repeat(Math.max(0, hp)) + '♡'.repeat(Math.max(0, max - hp)); }
