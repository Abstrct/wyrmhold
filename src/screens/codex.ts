/* The Grimoire: the realm's own book. How the sky broke, what alpha is, every rite and what it
 * costs, every beast and hallow, and the laws of war — all in the realm's tongue. Numbers come
 * from the catalogue; no word here belongs to any other world. */
import { h } from '../core/dom';
import K from '../world/wyrmkit.js';
import type { Ctx, Screen } from './types';
import { topbar } from '../ui/frame';
import { STRUCT_TYPES, typeOf } from '../data/catalogue';
import { markPath, resetPath } from '../ui/guide';
import { resetTour } from '../ui/tour';
import { HALLOW_COLOR, REALM_COLOR, REALM_NAME, WARD_CRAFT, fmtMana, lore, reachOf } from '../lore';

const TALE = [
  'Before the bells, there was one sky, and it was whole. Then it broke — no song remembers why — and its shards fell upward into the dark and stayed there, drifting above the cloud-sea. Each shard is an isle.',
  'From the wound in the sky came alpha: the first light, falling like warm rain. Where it touched stone, springs woke. Where it touched soil, wildroot grew fat and strange, drinking it down into the marrow of the isles. Where it touched the old beasts sleeping in the clouds, they opened their eyes.',
  'Every warden holds one isle and one Elder Wyrm, and hungers for the same thing: more alpha. It fertilises the springs that pour mana. It is tithed to the wellsprings of the covens. It calls beasts out of the circle. And because it cannot be stolen once it is brewed, every warden races to brew it before a neighbour comes to plunder the wildroot it grows in.',
];

const THINGS: [string, string][] = [
  ['Alpha (α)', 'The first light. It quickens everything it touches, feeds every spring and summoning, and no raider can carry it away.'],
  ['Wildroot', 'Roots that drank fallen alpha. Raw, heavy, and plunderable until the Dawn Cauldron draws the alpha out of it.'],
  ['Mana', 'What alpha becomes when a spring or wellspring is fed. Every waking beast drinks it; summon past your flow and the circle will not light.'],
  ['Breath', 'Your readiness to act, shared by your whole warband. One draws in with every bell; summoning, striking, riding out or guarding spends it all.'],
  ['Ward', 'How long a raider must chant to break into your hold. Lanterns, moons, vaults and spires raise it.'],
  ['Bell', 'The sky’s heartbeat — about six seconds. Everything in the realm happens on a bell.'],
  ['Chant', 'Summoning, delving, brewing and plundering each need one. Your Hold sings them for you on this computer; each grows easier with time and lands the moment it is ripe.'],
  ['Isle', 'A shard of the old sky. It holds a finite marrow of wildroot; when it is spent, a warden seeks another.'],
  ['Warband', 'Your beasts that fly. They ride out together, and while they are abroad your hold has no beasts to guard it.'],
  ['Coven', 'Wardens sworn together. A coven lends its leyline to the newly sworn, and its wellspring pours mana for all who tithe.'],
  ['Wellspring · Ley Shrine · Leyline', 'Alpha tithed to a wellspring becomes mana; leylines carry it to shrines; holds drink from a shrine.'],
  ['Starfall · Skies · Wilds · Deeps', 'The four realms of every isle: the high dark, the open air, the land and the waters.'],
  ['Soulstone', 'Your name in the sky, sealed in this browser. Its twenty-four soul-words are the only way back to your warden.'],
];

const RITES: [string, string, string][] = [
  ['Summon', '8', 'Draw a circle and call a beast or hallow. Its mana is claimed the moment the circle is drawn; the summoning chant completes it.'],
  ['Awaken · Slumber', '2 · —', 'Wake a beast so it can act, or let it sleep to free its mana.'],
  ['Unleash', '3–5', 'Strike a mark within your beast’s reach.'],
  ['Guard · Stand down', '1', 'Step in front of an ally’s blows, or leave its side.'],
  ['Veil · Drop veil', '2 · —', 'Shade Owl and Drowned Wight only: unseen except by their own realm.'],
  ['Soar', '3', 'The Elder Wyrm alone changes realms.'],
  ['Delve', 'chant', 'The Root Delver lifts wildroot from the marrow.'],
  ['Brew', 'chant', 'The Dawn Cauldron draws alpha out of wildroot.'],
  ['Feed', '—', 'Pour alpha into your own spring for mana, for good.'],
  ['Tithe · Unbind', '—', 'Lend alpha to a wellspring for mana; unbinding draws it back over many days.'],
  ['Seek a new isle', '—', 'Once your isle’s marrow is dug out. Your warband and stores come along; the hallows on it are lost.'],
  ['Ride out · Ride home', '—', 'Your warband flies to another isle, or back.'],
  ['Plunder', 'chant', 'Hold the sky over another hold and chant through its ward to carry off its unbrewed wildroot. If your Wyrm falls, the plunder breaks.'],
  ['Banish', '8', 'Release a beast for good and free its circle.'],
];

export function codex(ctx: Ctx): Screen {
  const bar = topbar('#/grimoire', ctx.oath, { meters: true });
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
    return [h('a', { href: `#/bestiary/${t.id}`, style: { textDecoration: 'none', color: 'var(--gold-hi)' } }, lore(t.id).name), h('span', { style: { color } }, realm),
      String(t.maxHealth), fmtMana(t.passiveDraw), t.buildDifficulty.toLocaleString('en-US'), WARD_CRAFT[t.unitDefenses] || '—'];
  });
  // The laws of war, with the odds the realm actually keeps.
  const g = typeOf(5)!, w = typeOf(7)!, tr = typeOf(9)!, bh = typeOf(2)!, sr = typeOf(12)!;
  const R = (t: typeof g) => t as unknown as Record<string, number>;
  const turned = (n: number, d: number) => `${n} in ${d}`;
  const LAWS: [string, string][] = [
    ['How a raid is won', 'Ride out to their isle. While their Elder Wyrm stands at home, their ward holds and no plunder can land: fell it, and your chant breaks in and carries off their unbrewed wildroot.'],
    ['How a blow falls', 'In this order: their guards strike back at the striker; a guard in the mark’s own realm steps in and takes the blow; the mark, if it lives, strikes back; a Thunder Spire lashes anyone who strikes its isle’s hallows.'],
    ['Breath', 'Every blow needs breath, and striking spends it all. The Skirmish shows how much a blow needs and strikes the moment you have it.'],
    ['Seeking and flung blows', 'Every strike is one or the other. Some beasts slip one kind, never both: strike them with the other.'],
    ['Glamour', `Harpy, Void Behemoth, Kraken. ${turned(R(g).guidedDefensiveSuccessRateNumerator, R(g).guidedDefensiveSuccessRateDenominator)} seeking blows aimed at them fly wide. Flung blows always land.`],
    ['Windslip', `The Storm Gryphon. ${turned(R(w).unguidedDefensiveSuccessRateNumerator, R(w).unguidedDefensiveSuccessRateDenominator)} flung blows aimed at it fly wide. Seeking blows always land.`],
    ['Stone-skin', `The Stone Troll and the great springs. Every blow is softened by ${tr.attackReduction}.`],
    ['The song cracks stone', `The Void Behemoth’s ${bh.primaryWeaponArmourPiercing ? 'low song' : 'blow'} ignores stone-skin.`],
    ['Veil', 'A veiled beast can only be marked by beasts of its own realm. Striking drops the veil.'],
    ['Rootbound', 'Whatever the Siege Treant strikes cannot answer it.'],
    ['Answer', `A struck beast that lives strikes back, if it is awake and can reach its striker’s realm. The Siege Treant is the exception both ways: nothing answers its blows, and it never answers. The Siren answers ${sr.counterAttackSameAmbit} in its own waters.`],
    ['Guard', 'A guard strikes back at whoever strikes its ward, if it can reach them, and takes the blow itself when it stands in the ward’s own realm. Fell the guard first.'],
    ['The Elder Wyrm', 'It strikes only in its own realm and must soar to reach another. Every raid rides on it: if a raider’s Wyrm falls, the raid breaks and the warband flees home.'],
    ['Plunder', 'Takes unbrewed wildroot, never alpha, never a soulstone. Fell the raider’s Elder Wyrm and the plunder breaks.'],
  ];
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
            h('a', { class: 'btn small', href: '#//prologue' }, 'Hear the prologue again'),
            h('button', { type: 'button', class: 'btn small ghost', onclick: () => { resetPath(); } }, 'Walk the Warden’s Path again'),
            h('button', { type: 'button', class: 'btn small ghost', onclick: () => { resetTour(); ctx.go('#/hold'); } }, 'Look around the Hold again')),
          jumps),
        wyrmCanvas),
      ...TALE.map((p, i) => h('p', { class: i === 0 ? 'tale-first' : null, 'data-tut': i === 0 ? 'tale' : null, style: { maxWidth: '760px', fontSize: i ? '18px' : '21px', color: i ? '#cfc5dd' : 'var(--ink)', fontFamily: i ? undefined : 'var(--serif)' } }, p)),
      section('Things of the realm', table(['Name', 'What it is'], THINGS, ['f', 'muted'])),
      section('Rites', table(['Rite', 'Breath', 'What it does'], RITES, ['f', 'mono', 'muted'])),
      section('Beasts and hallows', table(['Name', 'Realm', 'Vigor', 'Mana', 'Chant', 'Ward-craft'], beasts, ['f'])),
      section('The laws of war', h('div', { class: 'grid-cards', style: { marginTop: '16px' } }, ...LAWS.map(([k, v]) => h('div', { class: 'card-btn', style: { cursor: 'default' } }, h('b', null, k), h('span', { class: 'muted', style: { fontSize: '15px' } }, v))))),
      section('The warden’s oath', h('ul', { style: { marginTop: '14px', paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '17px', color: '#ddd4ea' } },
        h('li', null, 'Your soulstone never leaves this browser. Wyrmhodl asks it to set its seal on a rite; it never sends it anywhere.'),
        h('li', null, 'No rite is spoken until you speak it, and the Hold watches the sky after every rite before it tells you what happened.'),
        h('li', null, 'Before every summoning, your spare mana is weighed. If the leylines cannot bear it, the circle is not offered.'),
        h('li', null, 'Chants run beside you on your own hands — every thread and lantern of this machine — and are spoken the bell they ripen.')))));
  markPath('grimoire');
  return { el, title: 'Grimoire', leave: () => { wyrm?.dispose(); bar.dispose(); } };
}
