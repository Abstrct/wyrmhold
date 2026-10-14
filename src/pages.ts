/* Every page the sky shows the open web: its address, the title search results print, the words its
 * link card carries, and the plain words a reader sees before the world wakes. The build writes one
 * HTML page for each (seo/seo.ts) and the router names the tab from the same list, so a page found
 * in a search reads the same once it is open. Everything here is in the realm's tongue. */
import { STRUCT_TYPES, typeOf } from './data/catalogue';
import { BEASTS, REALMS, REALM_NAME, WARD_CRAFT, fmtMana, homeOf, lore, reachOf, slugOf } from './lore';
import { TALE, THINGS, RITES, laws } from './grimoire';

export const NAME = 'Wyrmhodl';

/** A line of a list: a name, what it is, and where it leads. */
export interface Item { name: string; text?: string; href?: string }
/** A run of the page: an optional heading, then paragraphs, a list, or named terms. */
export interface Part { heading?: string; paras?: string[]; items?: Item[]; terms?: Item[] }
export interface Page {
  /** From the site's root: '/', '/hold', '/bestiary/stone-troll'. */
  route: string;
  /** The tab and search-result title. */
  title: string;
  /** The search snippet and link-card blurb (keep it near 155 characters). */
  description: string;
  /** The link card: its file under img/og/, and the words drawn on it. */
  card: { key: string; eyebrow: string; heading: string; tagline: string; alt: string };
  heading: string;
  lede: string;
  parts: Part[];
  /** Two facts Slack prints under its unfurl (twitter:label/data); the price and the place by default. */
  labels?: [string, string][];
}

const term = ([name, text]: [string, string]) => ({ name, text });
const pick = (...names: string[]) => THINGS.filter(([n]) => names.includes(n)).map(term);

export const PLACES: Item[] = [
  { href: '/', name: 'The Gate', text: 'the tale, the oath, and the wardens abroad' },
  { href: '/hold', name: 'The Hold', text: 'your isle, your beasts and hallows, your rites and chants' },
  { href: '/bestiary', name: 'Bestiary', text: 'every beast and hallow on the summoning dais' },
  { href: '/atlas', name: 'Sky Atlas', text: 'every warden’s isle, around their coven’s crystal' },
  { href: '/leyweave', name: 'Leyweave', text: 'the wellsprings, your shrine, your tithes' },
  { href: '/skirmish', name: 'Skirmish', text: 'ride out, mark, unleash, plunder' },
  { href: '/grimoire', name: 'Grimoire', text: 'the old tale, the rites, the laws of war' },
];
const elsewhere = (route: string): Part => ({ heading: 'Elsewhere in the sky', items: PLACES.filter((p) => p.href !== route) });

const IDS = STRUCT_TYPES.map((t) => t.id).filter((id) => BEASTS[id]);
const where = (id: number) => { const h = homeOf(id); return h === 'bound' ? 'The Bound' : h === 'hallow' ? 'Hallow' : REALM_NAME[h]; };
const beastItem = (id: number): Item => ({ name: lore(id).name, text: [lore(id).epithet, lore(id).tale].filter(Boolean).join('. '), href: `/bestiary/${slugOf(id)}` });
const GROUPS: [string, (id: number) => boolean][] = [
  ['The Bound', (id) => homeOf(id) === 'bound'],
  ...REALMS.map((r) => [REALM_NAME[r], (id: number) => homeOf(id) === r] as [string, (id: number) => boolean]),
  ['Hallows', (id) => homeOf(id) === 'hallow'],
];

const home: Page = {
  route: '/',
  title: `${NAME} — Bind beasts, brew alpha, hold the broken sky`,
  description: 'A free multiplayer browser game of floating isles above a sea of cloud. Hatch your Elder Wyrm, summon beasts, brew alpha and raid rival wardens.',
  card: { key: 'home', eyebrow: 'When the sky broke, alpha fell like rain', heading: NAME, tagline: 'Bind beasts. Brew alpha.\nHold the broken sky.', alt: 'A floating isle with a castle and a waterfall above a sea of cloud at dusk, an Elder Wyrm in flight.' },
  heading: NAME,
  lede: 'Bind beasts. Brew alpha. Hold the broken sky.',
  parts: [
    { paras: [
      'When the sky broke, alpha fell like rain.',
      `${NAME} is a sky-realm of floating isles above a sea of cloud. Bind a soulstone, swear to a coven, seek your isle and hatch your Elder Wyrm. Delve wildroot from your isle’s marrow and brew it into alpha, the first light: it wakes your springs, calls beasts out of the circle, and once brewed can never be stolen. Then read the sky, ride out, and take what other wardens leave unbrewed.`,
      'Every warden you meet is a real person, and every rite you speak is sealed with your own soulstone and written into the ledger. Your soulstone stays sealed in your browser. Free to play, with nothing to install.',
    ] },
    { heading: 'Where the sky takes you', items: PLACES.slice(1) },
    { heading: 'The Bestiary', items: IDS.map((id) => ({ name: lore(id).name, text: lore(id).epithet, href: `/bestiary/${slugOf(id)}` })) },
  ],
};

const sections: Page[] = [
  {
    route: '/hold',
    title: `The Hold — your isle, your Elder Wyrm, your beasts · ${NAME}`,
    description: 'Your floating isle in Wyrmhodl. Hatch your Elder Wyrm, summon beasts and hallows, delve wildroot and brew it into alpha that no raider can steal.',
    card: { key: 'hold', eyebrow: `${NAME} · The Hold`, heading: 'The Hold', tagline: 'Your isle. Your Wyrm.\nYour beasts.', alt: 'A warden’s isle of trees and lanterns under a glassy ward dome, above a sea of cloud.' },
    heading: 'The Hold',
    lede: 'Every warden holds one isle and one Elder Wyrm.',
    parts: [
      { paras: [
        'Seek an isle and your Elder Wyrm hatches upon it, bound to you alone. Summon a Root Delver to lift wildroot from the isle’s marrow, and a Dawn Cauldron to brew it into alpha. Wildroot can be plundered until it is brewed; alpha never can.',
        'Every summoning is sung by a chant that your Hold sings for you, right here in your browser. Raise hallows to ward your isle: a Ward Lantern, a Veil Moon, a Barrow Vault, a Thunder Spire. Every waking beast drinks mana, and your spare mana is weighed before any circle is drawn.',
      ] },
      { heading: 'What a warden keeps', terms: pick('Alpha (α)', 'Wildroot', 'Mana', 'Breath', 'Ward', 'Chant', 'Isle') },
      elsewhere('/hold'),
    ],
  },
  {
    route: '/bestiary',
    title: `The Bestiary — every beast and hallow · ${NAME}`,
    description: `All ${IDS.length} beasts and hallows of Wyrmhodl, from the Elder Wyrm to the Worldroot: where each belongs, its vigor, its reach and its ward-craft.`,
    card: { key: 'bestiary', eyebrow: `${NAME} · The Bestiary`, heading: 'The Bestiary', tagline: 'Every beast and hallow\non the summoning dais.', alt: 'The Elder Wyrm on a glowing rune dais ringed by lit pillars, above a sea of cloud.' },
    heading: 'The Bestiary',
    lede: 'Every beast and hallow the sky knows, on the summoning dais.',
    parts: [
      ...GROUPS.map(([heading, test]) => ({ heading, items: IDS.filter(test).map(beastItem) })).filter((p) => p.items.length),
      elsewhere('/bestiary'),
    ],
  },
  {
    route: '/atlas',
    title: `Sky Atlas — every warden’s isle · ${NAME}`,
    description: 'Every warden’s isle in the broken sky, gathered around their coven’s crystal. Find a hold with wildroot left unbrewed, then ride out to plunder it.',
    card: { key: 'atlas', eyebrow: `${NAME} · Sky Atlas`, heading: 'Sky Atlas', tagline: 'Every isle in the sky.\nFind one to raid.', alt: 'Hundreds of lantern-lit isles drifting around a coven’s golden crystal in the night sky.' },
    heading: 'Sky Atlas',
    lede: 'Every isle in the sky, around the crystal of its coven.',
    parts: [
      { paras: [
        'The Sky Atlas maps every warden in the sky, each isle drifting around the crystal of the coven it is sworn to. Every one of them is a real person, holding the sky as you do.',
        'Search for a warden by name, narrow the sky to a single coven, and look for holds with wildroot left unbrewed: those are worth the ride. Then send your warband out.',
      ] },
      { heading: 'Of the sky', terms: pick('Isle', 'Coven', 'Warband', 'Starfall · Skies · Wilds · Deeps') },
      elsewhere('/atlas'),
    ],
  },
  {
    route: '/skirmish',
    title: `Skirmish — ride out, strike and plunder · ${NAME}`,
    description: 'Ride your warband to a rival’s isle, fell their Elder Wyrm, and chant through their ward to carry off the wildroot they left unbrewed.',
    card: { key: 'skirmish', eyebrow: `${NAME} · Skirmish`, heading: 'Skirmish', tagline: 'Ride out. Strike.\nPlunder.', alt: 'Two floating isles face each other across a sea of cloud at sunset.' },
    heading: 'Skirmish',
    lede: 'Ride out, mark, unleash, plunder.',
    parts: [
      { paras: [
        'In the Skirmish your warband and theirs face each other across the sky. Mark a beast, unleash, and fight on: every blow is a rite sealed with your own soulstone.',
        'While their Elder Wyrm stands at home their ward holds. Fell it, and your plunder chant breaks through and carries off their unbrewed wildroot. If your own Wyrm falls, the raid breaks and your warband flees home.',
      ] },
      { heading: 'The laws of war', terms: laws().map(term) },
      elsewhere('/skirmish'),
    ],
  },
  {
    route: '/leyweave',
    title: `Leyweave — wellsprings, shrines and tithes · ${NAME}`,
    description: 'Tithe alpha to your coven’s wellspring and its leylines carry mana to your shrine. More mana lets more of your beasts wake and work.',
    card: { key: 'leyweave', eyebrow: `${NAME} · Leyweave`, heading: 'Leyweave', tagline: 'Tithe alpha.\nDrink mana.', alt: 'Glowing leylines arc between floating isles above a moonlit sea of cloud.' },
    heading: 'Leyweave',
    lede: 'The wellsprings, your shrine, your tithes.',
    parts: [
      { paras: [
        'Alpha tithed to a wellspring becomes mana. Leylines carry it to the shrines, and every hold drinks from a shrine.',
        'A coven lends its leyline to the newly sworn, and its wellspring pours mana for all who tithe. Unbinding a tithe draws the alpha back over many days.',
      ] },
      { heading: 'Of the leylines', terms: pick('Mana', 'Alpha (α)', 'Coven', 'Wellspring · Ley Shrine · Leyline') },
      elsewhere('/leyweave'),
    ],
  },
  {
    route: '/grimoire',
    title: `The Grimoire — of alpha and the broken sky · ${NAME}`,
    description: 'The tale of the broken sky, the things of the realm, every rite and what it costs, and the laws of war, as Wyrmhodl keeps them.',
    card: { key: 'grimoire', eyebrow: `${NAME} · The Grimoire`, heading: 'The Grimoire', tagline: 'Of alpha, and\nthe broken sky.', alt: 'A floating isle with a castle and a waterfall above a sea of cloud at dusk, an Elder Wyrm in flight.' },
    heading: 'The Grimoire',
    lede: 'Of alpha, and the broken sky.',
    parts: [
      { paras: TALE },
      { heading: 'Things of the realm', terms: THINGS.map(term) },
      { heading: 'Rites', terms: RITES.map(([name, breath, text]) => ({ name, text: /\d/.test(breath) ? `${text} Breath: ${breath}.` : text })) },
      { heading: 'The laws of war', terms: laws().map(term) },
      elsewhere('/grimoire'),
    ],
  },
];

function beastPage(id: number, i: number): Page {
  const L = lore(id), t = typeOf(id)!, slug = slugOf(id);
  const reach = [...new Set([...reachOf(t.primaryWeaponAmbits), ...reachOf(t.secondaryWeaponAmbits)])].map((r) => REALM_NAME[r]);
  const facts: Item[] = [
    { name: 'Belongs to', text: homeOf(id) === 'bound' ? 'The Bound: hatched on its warden’s isle, and theirs alone' : homeOf(id) === 'hallow' ? 'The hallows, raised on a warden’s isle' : `The ${where(id)}` },
    { name: 'Vigor', text: `${t.maxHealth} hearts` },
    { name: 'Mana drawn', text: `${fmtMana(t.passiveDraw)} mana` },
  ];
  if (t.category === 'fleet') facts.push({ name: 'Strikes into', text: id === 1 ? 'The realm it stands in. It soars between all four.' : reach.join(', ') || 'None' });
  if (WARD_CRAFT[t.unitDefenses] && WARD_CRAFT[t.unitDefenses] !== 'None') facts.push({ name: 'Ward-craft', text: WARD_CRAFT[t.unitDefenses] });
  const prev = IDS[(i - 1 + IDS.length) % IDS.length], next = IDS[(i + 1) % IDS.length];
  return {
    route: `/bestiary/${slug}`,
    title: `${L.name} — ${L.epithet} · ${NAME} Bestiary`,
    description: `${L.name}: ${L.epithet.charAt(0).toLowerCase() + L.epithet.slice(1)}. ${L.tale}`,
    card: { key: `beast-${slug}`, eyebrow: `${NAME} Bestiary · ${where(id)}`, heading: L.name, tagline: L.epithet, alt: `The ${L.name.replace(/^The /, '')} on a glowing rune dais ringed by lit pillars, above a sea of cloud.` },
    heading: L.name,
    lede: L.epithet,
    labels: [['Realm', where(id)], ['Vigor', `${t.maxHealth} hearts`]],
    parts: [
      { paras: [L.tale] },
      { heading: 'On the dais', terms: facts },
      { heading: 'More of the Bestiary', items: [beastItem(prev), beastItem(next), { name: 'Every beast and hallow', href: '/bestiary' }] },
    ],
  };
}

export const PAGES: Page[] = [home, ...sections, ...IDS.map(beastPage)];

const BY_ROUTE = new Map(PAGES.map((p) => [p.route, p]));
/** The page an address names, if the sky has one built for it. */
export const pageFor = (route: string) => BY_ROUTE.get(route === '' ? '/' : route.replace(/\/+$/, '') || '/');
export const pageTitle = (route: string) => pageFor(route)?.title;
