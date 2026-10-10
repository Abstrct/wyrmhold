/* The Summoning Circle: every beast and hallow the ledger knows, on a rune dais. Stats are the
 * chain's own (src/data/catalogue.ts); only the names and tales are Wyrmhold's. */
import { h, clear } from '../core/dom';
import K from '../world/wyrmkit.js';
import { mountScene, type Ctx, type Screen } from './types';
import { topbar } from '../ui/frame';
import { STRUCT_TYPES, typeOf } from '../data/catalogue';
import { empire } from '../game/empire';
import { HALLOW_COLOR, REALMS, REALM_COLOR, REALM_NAME, WARD_CRAFT, fmtMana, lore, reachOf, type Realm } from '../lore';
import { owned } from '../realm';

const HOME: Record<number, Realm | 'bound'> = { 1: 'bound' };
function homeOf(id: number): Realm | 'bound' | 'hallow' {
  if (HOME[id]) return HOME[id];
  const t = typeOf(id)!;
  if (t.category === 'planet') return 'hallow';
  return reachOf(t.possibleAmbit)[0] || 'wilds';
}

export function bestiary(ctx: Ctx): Screen {
  let type = Number(ctx.param) || 1;
  const canvas = h('canvas');
  const bar = topbar('#/bestiary', ctx.oath, { meters: true });
  const index = h('aside', { class: 'glass panel col-l scroll-y', 'aria-label': 'Bestiary index', style: { overflowY: 'auto' } });
  const sheet = h('section', { class: 'glass panel rise', 'aria-label': 'Beast lore', style: { flex: '0 1 420px', minWidth: '280px', padding: '22px' } });
  const el = h('div', { class: 'screen' }, h('div', { class: 'stage' }, canvas),
    h('div', { class: 'hud' }, bar.el, h('div', { class: 'isle-window', 'aria-hidden': 'true' }), h('div', { class: 'cols through beast-cols' }, index, sheet)));
  const scene = mountScene(canvas, (c) => K.circle(c, { type }));

  function choose(id: number) {
    type = id; scene.get()?.show(id); history.replaceState(null, '', `#/bestiary/${id}`); paint();
    // on a phone the beast and its lore sit above the list: bring them back into view
    if (matchMedia('(max-width: 720px)').matches) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function paint() {
    clear(index);
    const groups: [string, string, (id: number) => boolean][] = [
      ['The Bound', HALLOW_COLOR, (id) => homeOf(id) === 'bound'],
      ...REALMS.map((r) => [REALM_NAME[r], REALM_COLOR[r], (id: number) => homeOf(id) === r] as [string, string, (id: number) => boolean]),
      ['Hallows', HALLOW_COLOR, (id) => homeOf(id) === 'hallow'],
    ];
    for (const [label, color, test] of groups) {
      const ids = STRUCT_TYPES.map((t) => t.id).filter(test);
      if (!ids.length) continue;
      index.append(h('section', { style: { marginBottom: '14px' } },
        h('h2', { class: 'label row', style: { color, margin: '0 0 6px', gap: '8px' } }, h('span', { class: 'gem', style: { background: color, width: '8px', height: '8px' } }), label),
        h('ul', { class: 'list' }, ...ids.map((id) => h('li', null, h('button', { type: 'button', class: 'item' + (type === id ? ' on' : ''), 'aria-current': String(type === id), style: { minHeight: '44px' }, onclick: () => choose(id) },
          h('span', { class: 'nm', style: { fontSize: '16px' } }, lore(id).name), (empire.commander && owned(empire.commander, id)) ? h('span', { class: 'mono faint', style: { fontSize: '11px' } }, `yours ×${owned(empire.commander, id)}`) : null))))));
    }
    clear(sheet);
    const t = typeOf(type)!, L = lore(type), home = homeOf(type);
    const color = home === 'hallow' || home === 'bound' ? HALLOW_COLOR : REALM_COLOR[home];
    const bars: [string, string, number, string][] = [
      ['Vigor', `${t.maxHealth} hearts`, t.maxHealth / 10, '#f08a8a'],
      ['Mana draw', fmtMana(t.passiveDraw), Math.log10(Math.max(10, t.passiveDraw / 1000)) / 5, '#8fd8ff'],
      ['Summoning chant', t.buildDifficulty <= 250 ? 'quick' : t.buildDifficulty <= 460 ? 'steady' : 'long', t.buildDifficulty / 5000, '#e8c872'],
    ];
    if (t.primaryWeaponCharge) bars.push(['Breath to strike', String(t.primaryWeaponCharge), t.primaryWeaponCharge / 5, '#5fd3b5']);
    const reach = [...new Set([...reachOf(t.primaryWeaponAmbits), ...reachOf(t.secondaryWeaponAmbits)])];
    const p = empire.commander;
    sheet.append(
      h('p', { class: 'eyebrow', style: { color } }, `${home === 'hallow' ? 'Hallow' : home === 'bound' ? 'The Bound' : REALM_NAME[home]} · rune ${type}`),
      h('h1', { class: 'display', style: { fontSize: '44px', marginTop: '6px' } }, L.name),
      h('p', { class: 'italic', style: { margin: '8px 0 0', fontSize: '19px' } }, L.epithet),
      h('p', { style: { margin: '14px 0 0', color: '#ddd4ea' } }, L.tale),
      h('div', { class: 'stack', style: { gap: '10px', marginTop: '18px' } }, ...bars.map(([k, v, f, c]) => h('div', null,
        h('div', { class: 'row between' }, h('span', { class: 'label' }, k), h('span', { class: 'mono', style: { fontSize: '12px' } }, v)),
        h('span', { class: 'bar', style: { marginTop: '4px' } }, h('i', { style: { width: Math.max(4, Math.min(100, f * 100)) + '%', background: c } }))))),
      t.category === 'fleet' ? h('div', { style: { marginTop: '18px' } },
        h('p', { class: 'label', style: { margin: '0 0 4px' } }, 'Strikes into'),
        h('p', { class: 'faint', style: { margin: '0 0 8px', fontSize: '13px' } }, type === 1 ? 'The realm it stands in. It soars between all four.' : 'It can only strike beasts standing in the lit realms.'),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '6px' } }, ...REALMS.map((r) => {
          const on = type === 1 || reach.includes(r);
          // a legend, not a button: flat, underlined in the realm's colour where it can strike
          return h('div', { style: { padding: '6px 4px', textAlign: 'center', fontSize: '13px', borderBottom: `2px solid ${on ? REALM_COLOR[r] : 'rgba(243,235,221,.1)'}`, color: on ? 'var(--ink)' : '#6f6684' } }, REALM_NAME[r]);
        })),
        h('p', { style: { margin: '10px 0 0', fontSize: '14px' } }, h('span', { style: { color: 'var(--violet)' } }, 'Ward-craft: '), WARD_CRAFT[t.unitDefenses] || 'None')) : '',
      p ? h('p', { class: 'faint', style: { margin: '16px 0 0', fontSize: '14px' } }, owned(p, type) ? `You hold ${owned(p, type)}.` : 'You hold none yet.') : '',
      h('div', { class: 'row', style: { marginTop: '18px' } },
        h('button', { type: 'button', class: 'btn', onclick: () => scene.get()?.summon(type) }, 'Watch it summoned'),
        p ? h('a', { class: 'btn gold', href: '#/hold' }, type === 1 ? 'Meet yours at your Hold' : t.buildLimit && owned(p, type) >= t.buildLimit ? 'Yours is at your Hold' : 'Summon at your Hold')
          : h('button', { type: 'button', class: 'btn gold', onclick: () => ctx.oath() }, 'Swear the oath first')));
  }
  const off = empire.onChange(paint);
  paint();
  return { el, title: 'Bestiary', leave: () => { off(); scene.dispose(); bar.dispose(); } };
}
