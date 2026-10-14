/* The Grimoire: the realm's own book. How the sky broke, what alpha is, every rite and what it
 * costs, every beast and hallow, and the laws of war — all in the realm's tongue. Numbers come
 * from the catalogue; no word here belongs to any other world. */
import { h } from '../core/dom';
import K from '../world/wyrmkit.js';
import type { Ctx, Screen } from './types';
import { topbar } from '../ui/frame';
import { STRUCT_TYPES } from '../data/catalogue';
import { markPath, resetPath } from '../ui/guide';
import { resetTour } from '../ui/tour';
import { HALLOW_COLOR, REALM_COLOR, REALM_NAME, WARD_CRAFT, fmtMana, lore, reachOf, slugOf } from '../lore';
import { TALE, THINGS, RITES, laws } from '../grimoire';
import { chantTime } from '../ui/chants';

export function codex(ctx: Ctx): Screen {
  const bar = topbar('/grimoire', ctx.oath, { meters: true });
  const table = (heads: string[], rows: (string | Node)[][], cls: string[] = []) => h('div', { class: 'table-box' }, h('table', { class: 't' },
    h('thead', null, h('tr', null, ...heads.map((x) => h('th', { scope: 'col' }, x)))),
    h('tbody', null, ...rows.map((r) => h('tr', null, ...r.map((c, i) => h('td', { class: cls[i] || '' }, c)))))));
  const slug = (t: string) => 'gr-' + t.toLowerCase().replace(/[^a-z]+/g, '-');
  const section = (title: string, ...kids: Node[]) => h('section', { id: slug(title), style: { marginTop: '56px', scrollMarginTop: '24px' } }, h('h2', { class: 'display', style: { fontSize: '36px' } }, title), ...kids);
  // the page is long: a row of quick jumps (buttons, since the hash is the router's)
  const jumps = h('nav', { class: 'row codex-jumps', 'aria-label': 'In the Grimoire' }, h('span', { class: 'label' }, 'Jump to'),
    ...['Things of the realm', 'Rites', 'Beasts and hallows', 'The laws of war', 'The warden’s oath'].map((t) =>
      h('button', { type: 'button', class: 'linkish', onclick: () => document.getElementById(slug(t))?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, t)));
  const beasts = STRUCT_TYPES.map((t) => {
    const hallow = t.category === 'planet';
    const home = reachOf(t.possibleAmbit)[0];
    const realm = hallow ? 'Hallow' : t.id === 1 ? 'Every realm' : REALM_NAME[home];
    const color = hallow || t.id === 1 ? HALLOW_COLOR : REALM_COLOR[home];
    return [h('a', { href: `/bestiary/${slugOf(t.id)}`, style: { textDecoration: 'none', color: 'var(--gold-hi)' } }, lore(t.id).name), h('span', { style: { color } }, realm),
      // the summoning chant as a time, the same one the Summon dialog and Incantations give
      String(t.maxHealth), fmtMana(t.passiveDraw), h('span', { title: `Chant length ${t.buildDifficulty.toLocaleString('en-US')}` }, chantTime(t.buildDifficulty)), WARD_CRAFT[t.unitDefenses] || '—'];
  });
  const wyrmCanvas = h('canvas', { class: 'codex-wyrm', width: 300, height: 300, 'aria-hidden': 'true' }) as HTMLCanvasElement;
  let wyrm: { dispose(): void } | null = null;
  try { wyrm = K.portrait(wyrmCanvas, { type: 1, size: 300, dist: 21, scale: 0.95, turn: -0.7, lift: 0.4 }); } catch { /* no GL: the book still reads */ }
  const el = h('div', { class: 'screen scrolls codex-page' },
    h('div', { style: { padding: '12px clamp(12px, 2vw, 24px) 0' } }, bar.el),
    h('main', { class: 'codex' },
      h('div', { class: 'codex-hero' },
        h('div', null,
          h('p', { class: 'eyebrow' }, 'The Grimoire'),
          h('h1', { class: 'display', style: { fontSize: 'clamp(44px, 6vw, 76px)', marginTop: '10px' } }, 'Of alpha, and the broken sky'),
          h('div', { class: 'row', style: { marginTop: '14px' } },
            h('a', { class: 'btn small', href: '/prologue' }, 'Hear the prologue again'),
            h('button', { type: 'button', class: 'btn small ghost', onclick: () => { resetPath(); } }, 'Walk the Warden’s Path again'),
            h('button', { type: 'button', class: 'btn small ghost', onclick: () => { resetTour(); ctx.go('/hold'); } }, 'Look around the Hold again')),
          jumps),
        wyrmCanvas),
      ...TALE.map((p, i) => h('p', { class: i === 0 ? 'tale-first' : null, 'data-tut': i === 0 ? 'tale' : null, style: { maxWidth: '760px', fontSize: i ? '18px' : '21px', color: i ? '#cfc5dd' : 'var(--ink)', fontFamily: i ? undefined : 'var(--serif)' } }, p)),
      section('Things of the realm', table(['Name', 'What it is'], THINGS, ['f', 'muted'])),
      section('Rites', table(['Rite', 'Breath', 'What it does'], RITES, ['f', 'mono', 'muted'])),
      section('Beasts and hallows', table(['Name', 'Realm', 'Vigor', 'Mana', 'Chant', 'Ward-craft'], beasts, ['f'])),
      section('The laws of war', h('div', { class: 'grid-cards', style: { marginTop: '16px' } }, ...laws().map(([k, v]) => h('div', { class: 'card-btn', style: { cursor: 'default' } }, h('b', null, k), h('span', { class: 'muted', style: { fontSize: '15px' } }, v))))),
      section('The warden’s oath', h('ul', { style: { marginTop: '14px', paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '17px', color: '#ddd4ea' } },
        h('li', null, 'Your soulstone never leaves this browser. Wyrmhodl asks it to set its seal on a rite; it never sends it anywhere.'),
        h('li', null, 'No rite is spoken until you speak it, and the Hold watches the sky after every rite before it tells you what happened.'),
        h('li', null, 'Before every summoning, your spare mana is weighed. If the leylines cannot bear it, the circle is not offered.'),
        h('li', null, 'Chants ripen with time, even while Wyrmhodl is closed, and are spoken the moment you return to them. While it is open, Wyrmhodl chants on this device with its spare strength, so a lucky chant lands sooner; that work can warm a phone and drain it faster. “Chant gently” under Incantations uses less of it.')))));
  markPath('grimoire');
  return { el, title: 'Grimoire', leave: () => { wyrm?.dispose(); bar.dispose(); } };
}
