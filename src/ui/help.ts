/* How to play, on one page: the loop a warden lives by, where each part happens, and the few
 * words worth knowing. Opened from the "?" in the top bar, wherever the warden is. */
import { h } from '../core/dom';
import { icon, ICON, GLOSS } from './frame';
import { resetPath } from './guide';
import { resetTour, holdTour } from './tour';

let open: HTMLElement | null = null;

const LOOP: [string, string, string, string][] = [
  ['1', 'Summon', 'Raise a Root Delver and a Dawn Cauldron on your Hold. Each summoning is sung by a chant that your Hold sings for you. The Bestiary shows every beast before you bind it.', '#/hold'],
  ['2', 'Dig and brew', 'The Delver digs up wildroot; the Cauldron brews it into alpha. Wildroot can be stolen; alpha cannot.', '#/hold'],
  ['3', 'Grow', 'In the Leyweave, tithe alpha to your coven’s wellspring for more mana, then summon beasts and wards.', '#/leyweave'],
  ['4', 'Raid', 'Find an isle with unbrewed wildroot in the Sky Atlas and ride out. In the Skirmish, fell its Elder Wyrm, and the plunder is yours.', '#/atlas'],
];

export function openHelp() {
  if (open) return;
  const close = () => { veil.remove(); open = null; document.removeEventListener('keydown', esc); window.removeEventListener('hashchange', close); };
  const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  const go = (href: string) => () => { close(); location.hash = href; };
  const veil = h('div', { class: 'veil', onclick: (e: Event) => { if (e.target === veil) close(); } },
    h('section', { class: 'scroll wide help', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'help-title' },
      h('div', { class: 'row between', style: { alignItems: 'flex-start', flexWrap: 'nowrap' } },
        h('div', null, h('p', { class: 'eyebrow' }, 'How to play'), h('h2', { id: 'help-title', style: { marginTop: '6px' } }, 'The warden’s round')),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: close }, icon(ICON.close))),
      h('ol', { class: 'help-loop' }, ...LOOP.map(([n, t, d, href]) => h('li', null,
        h('span', { class: 'n' }, n), h('b', null, t), h('p', null, d),
        h('button', { type: 'button', class: 'btn small', onclick: go(href) }, 'Go there', icon(ICON.arrow, 14))))),
      h('p', { class: 'label', style: { marginTop: '22px' } }, 'Words worth knowing'),
      h('dl', { class: 'help-words' }, ...Object.values(GLOSS).map(([name, what]) => h('div', null, h('dt', null, name), h('dd', null, what))),
        h('div', null, h('dt', null, 'Chant'), h('dd', null, 'The work behind a summoning, a dig, a brew or a plunder. Your Hold sings it on this computer, and every chant gets easier as time passes.')),
        h('div', null, h('dt', null, 'Soulstone'), h('dd', null, 'Your key, sealed in this browser. Its 24 soul-words are the only way to bring your warden back anywhere else.'))),
      h('div', { class: 'row', style: { marginTop: '20px', gap: '8px' } },
        h('button', { type: 'button', class: 'btn small ghost', onclick: () => {
          resetTour();
          // already home: the hash would not change, so start the look around here
          if (location.hash === '#/hold') { close(); holdTour(); } else go('#/hold')();
        } }, 'Show me around the Hold again'),
        h('button', { type: 'button', class: 'btn small ghost', onclick: () => { resetPath(); close(); } }, 'Start Ysolde’s path again'),
        h('a', { class: 'btn small ghost', href: '#/grimoire', onclick: close }, 'The full Grimoire'))));
  open = veil;
  document.body.append(veil);
  document.addEventListener('keydown', esc);
  window.addEventListener('hashchange', close);
  (veil.querySelector('.help-loop .btn') as HTMLElement | null)?.focus();
}
