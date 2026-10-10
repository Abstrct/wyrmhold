/* The Grimoire in code: how Wyrmhold names every thing the ledger knows. Mechanics come from the
 * catalogue (src/data/catalogue.ts); only the words change here. Nothing the warden reads should
 * ever speak another world's tongue: everything shown passes through speak(). */
import { typeOf, type Ambit, type StructType } from './data/catalogue';

export type Realm = 'starfall' | 'skies' | 'wilds' | 'deeps';
export const REALM_OF_AMBIT: Record<Ambit, Realm> = { space: 'starfall', air: 'skies', land: 'wilds', water: 'deeps' };
export const AMBIT_OF_REALM: Record<Realm, Ambit> = { starfall: 'space', skies: 'air', wilds: 'land', deeps: 'water' };
export const REALMS: Realm[] = ['starfall', 'skies', 'wilds', 'deeps'];
export const REALM_NAME: Record<Realm, string> = { starfall: 'Starfall', skies: 'Skies', wilds: 'Wilds', deeps: 'Deeps' };
export const REALM_COLOR: Record<Realm, string> = { starfall: '#c9a0ff', skies: '#8fd8ff', wilds: '#b8d98a', deeps: '#4fd1d9' };
export const HALLOW_COLOR = '#e8c872';

export interface Lore { name: string; epithet: string; tale: string }

export const BEASTS: Record<number, Lore> = {
  1: { name: 'Elder Wyrm', epithet: 'Heart of the Hold', tale: 'Hatched upon your isle and bound to you alone. The only beast that soars between realms, and it must stand in a realm to strike there. Every raid rides on its back; fell a raider’s Wyrm and the raid is broken.' },
  2: { name: 'Void Behemoth', epithet: 'Whale of the empty dark', tale: 'A leviathan that swims between stars. Its low song cracks stone-skin outright, and a second, seeking cry reaches anything in Starfall.' },
  3: { name: 'Comet Sprite', epithet: 'A spark with a grudge', tale: 'A mote of falling star that never learned to stop. Its tail-lash always lands at least one blow.' },
  4: { name: 'Moth Galleon', epithet: 'Lantern-ship of the high dark', tale: 'Black oak carried by four great moth wings. The only starfarer that stoops to strike the Skies.' },
  5: { name: 'Harpy', epithet: 'Cheapest talons aloft', tale: 'Shrieking, spiteful and quick to bind. Glamour turns aside one of every three seeking blows.' },
  6: { name: 'Shade Owl', epithet: 'Hunts by not being seen', tale: 'Veiled, it can only be struck from its own realm. Striking drops the veil.' },
  7: { name: 'Storm Gryphon', epithet: 'Rides the thunderhead', tale: 'Eagle before and lion behind, wreathed in static. Windslip carries it past one of every three flung blows.' },
  8: { name: 'Siege Treant', epithet: 'Patient as a mountain', tale: 'An old tree that learned to throw boulders. Whatever it strikes cannot strike back at it.' },
  9: { name: 'Stone Troll', epithet: 'Takes three blows to fall', tale: 'Slow, mossy and very hard to kill. Stone-skin softens every blow by one.' },
  10: { name: 'Ghoul Archer', epithet: 'Looses at anything that flies', tale: 'A grave-pale bowman whose shafts seek wings and stars alike.' },
  11: { name: 'Kraken', epithet: 'Eight arms, three realms', tale: 'The most versatile beast of the Deeps; a flung arm always finds the Skies.' },
  12: { name: 'Siren', epithet: 'Sings back twice as hard', tale: 'A sea-serpent with a frill of gold. Strike it from its own waters and it answers double.' },
  13: { name: 'Drowned Wight', epithet: 'Rises cold from below', tale: 'A drowned watchman in a sodden cloak. Veiled beneath the surface, only things of the Deeps can find it.' },
  14: { name: 'Root Delver', epithet: 'Mine of the isle’s marrow', tale: 'Delves wildroot from deep within your isle — roots that drank the fallen alpha. What it hauls up can be plundered until it is brewed.' },
  15: { name: 'Dawn Cauldron', epithet: 'Where wildroot becomes alpha', tale: 'Draws the alpha out of raw wildroot. Once brewed, it is yours alone: no raider can carry alpha away.' },
  16: { name: 'Ward Lantern', epithet: 'A light the dark respects', tale: 'Hangs in Starfall above your isle and raises your ward by 25.' },
  17: { name: 'Veil Moon', epithet: 'A little moon of misdirection', tale: 'Raises your ward by 12 and turns aside seeking blows aimed at your hallows.' },
  18: { name: 'Barrow Vault', epithet: 'Old stone, older oaths', tale: 'Raises your ward by 50 — the stoutest ward a hallow can lend.' },
  19: { name: 'Thunder Spire', epithet: 'Answers raiders with lightning', tale: 'Raises your ward by 13 and lashes the beasts of any warden who comes to plunder.' },
  20: { name: 'Mana Spring', epithet: 'Turns alpha into flowing mana', tale: 'Feed it alpha and it flows for your hold.' },
  21: { name: 'Ley Heart', epithet: 'A crystal that hums the leylines', tale: 'A greater spring: more mana for every gram of alpha fed.' },
  22: { name: 'The Worldroot', epithet: 'A tree whose roots drink the sky', tale: 'The greatest hallow, and the hungriest before it gives.' },
};

export const lore = (typeId: number): Lore => BEASTS[typeId] ?? { name: typeOf(typeId)?.type ?? `Ledger type ${typeId}`, epithet: '', tale: '' };
export const beastName = (typeId: number) => lore(typeId).name;
export const isHallow = (t?: StructType) => t?.category === 'planet';

/** Defensive arts, by the chain's unitDefenses value. */
export const WARD_CRAFT: Record<string, string> = {
  noUnitDefenses: 'None', signalJamming: 'Glamour', defensiveManeuver: 'Windslip', stealthMode: 'Veil',
  armour: 'Stone-skin', indirectCombatModule: 'Rootbound',
};

/** Reach bitmask → realm names. */
export function reachOf(mask: number): Realm[] {
  const out: Realm[] = [];
  if (mask & 16) out.push('starfall');
  if (mask & 8) out.push('skies');
  if (mask & 4) out.push('wilds');
  if (mask & 2) out.push('deeps');
  return out;
}

/** Ledger units → realm units. Mana is measured in motes (one per milliwatt-thousand); alpha in grams. */
export const mana = (mw: bigint | number) => Math.round(Number(mw) / 1000);
export const fmtMana = (mw: bigint | number) => mana(mw).toLocaleString('en-US');
export const alpha = (ualpha: bigint) => Number(ualpha) / 1e6;
export const fmtAlpha = (ualpha: bigint) => alpha(ualpha).toLocaleString('en-US', { maximumFractionDigits: 3 });

/** Every sentence the warden reads goes through here: the realm's words for the ledger's. */
export function speak(text: string): string {
  if (!text) return text;
  let s = String(text);
  const R: [RegExp, string | ((...a: string[]) => string)][] = [
    [/^Move (.+?) → (?:fleet|planet|warband|isle) (space|air|land|water) \d+/, (_m: string, who: string, a: string) => `${who} soars into ${({ space: 'Starfall', air: 'the Skies', land: 'the Wilds', water: 'the Deeps' } as Record<string, string>)[a]}`],
    [/\b(space|air|land|water) (\d+)\b/g, (_m: string, a: string, n: string) => `${({ space: 'Starfall', air: 'Skies', land: 'Wilds', water: 'Deeps' } as Record<string, string>)[a]} ${n}`],
    [/\bambits?\b/gi, 'realm'], [/\bMove\b/g, 'Soar'],
    [/\b(?:fleet|warband) sails for\b/gi, 'Warband rides for'], [/\b(?:fleet|warband) returns home\b/gi, 'Warband rides home'], [/^Explore a new isle/i, 'Seek a new isle'],
    [/\bmust carry a zero fee\b/gi, 'must carry no offering'], [/\bzero fee\b/gi, 'no offering'], [/\bFees?\b/g, 'Offering'], [/\bfees?\b/g, 'offering'], [/\bgas\b/gi, 'strength'], [/\bthis node\b/gi, 'this keeper'], [/\bBattery\b/g, 'Breath'], [/\bwhile under_raid\b/g, 'while raiders hang overhead'], [/\bunder_raid\b/g, 'raiders overhead'], [/\bbattery\b/g, 'breath'],
    [/\bmempool\b/gi, 'the wind'],
    // ledger errors name things by their marks; the warden needs the meaning, not the number
    [/\b(?:planet|isle) \(\d+-\d+\) is empty, nothing to mine\b/gi, 'your isle is spent: there is nothing left to dig. Seek a new isle'],
    [/\s*\(\d+-\d+\)/g, ''],
    [/\bLCD\b/g, 'The ledger-keeper'], [/\benlisting\b/gi, 'swearing the oath'],
    [/(\d[\d,.]*) kW\b/g, (_m: string, n: string) => `${Math.round(Number(n.replace(/,/g, '')) * 1000).toLocaleString('en-US')} mana`],
    [/(\d[\d,.]*) W\b/g, '$1 mana'],
    [/\b12 or 24 word recovery phrase\b/gi, 'set of twelve or twenty-four soul-words'],
    [/\bon chain\b/gi, 'in the ledger'], [/\bsigner\b/gi, 'scribe'], [/\bEnlisting\b/g, 'Swearing the oath'], [/\benlist\b/gi, 'swear the oath'],
    [/\bExploring\b/g, 'Seeking'], [/\bExplore\b/g, 'Seek'],
    [/\bualpha\b/g, 'alpha-dust'],
    [/^Build /, 'Summon '], [/\bbuilds\b/gi, 'summonings'], [/\bbuilding\b/gi, 'summoning'], [/\bbuild\b/gi, 'summoning'], [/\bbuilt\b/gi, 'summoned'],
    [/Power up/g, 'Awaken'], [/Power down/g, 'Slumber'], [/\bpowered down\b/gi, 'slumbering'], [/\boffline\b/gi, 'slumbering'], [/\bonline\b/gi, 'awake'],
    [/ fires on /g, ' strikes '], [/\bfire\b/gi, 'strike'],
    
    [/\bexplore\b/gi, 'seek'], [/\bexploring\b/gi, 'seeking'],
    [/Unstealth/g, 'Drop veil of'], [/\bStealth\b/g, 'Veil'], [/\bstealth\b/g, 'veil'],
    [/Burn ([\d.]+) alpha in/g, 'Feed $1 alpha to'], [/\bScrap /g, 'Banish '],
    [/ · space /g, ' · Starfall '], [/ · air /g, ' · Skies '], [/ · land /g, ' · Wilds '], [/ · water /g, ' · Deeps '],
    [/^Mine ore/, 'Delving chant'], [/^Refine ore/, 'Brewing chant'], [/^Raid /, 'Plunder chant · '],
    [/ · proof (\d+)$/, ' · chant of $1'], [/\bproof of work\b/gi, 'chant'], [/\bproofs?\b/gi, 'chant'], [/\bhash(es|ing)?\b/gi, 'chant'],
    [/\bcommand (struct|ship)\b/gi, 'Elder Wyrm'], [/\bcommanders?\b/gi, 'warden'], [/\bplayers?\b/gi, 'warden'],
    [/\bplanets?\b/gi, 'isle'], [/\bfleets?\b/gi, 'warband'], [/\bguilds?\b/gi, 'coven'],
    [/\bstructs\b/gi, 'beasts'], [/\bstruct\b/gi, 'beast'], [/(\d[\d,]*) ore\b/gi, '$1 sheaves of wildroot'], [/\bore\b/gi, 'wildroot'],
    [/\bcharge\b/gi, 'breath'], [/\bcapacity\b/gi, 'mana flow'], [/\bgrid\b/gi, 'leyweave'], [/\bpower\b/gi, 'mana'], [/\benergy\b/gi, 'mana'],
    [/\bshields?\b/gi, 'ward'], [/\bsubstations?\b/gi, 'ley shrine'], [/\breactors?\b/gi, 'wellspring'],
    [/\binfus(e|ed|ion|ing)\b/gi, 'tithe'], [/\bdefus(e|ed|ion|ing)\b/gi, 'unbinding'],
    [/\bblocks?\b/gi, 'bells'], [/\bchain\b/gi, 'ledger'], [/\btestnet\b/gi, 'ledger'],
    [/\brecovery phrase\b/gi, 'soul-words'], [/\bmnemonic\b/gi, 'soul-words'], [/\bwallet\b/gi, 'soulstone'],
    [/\btx(n|s)?\b/gi, 'rite'], [/\btransactions?\b/gi, 'rite'], [/\bsign(ed|ing)?\b/gi, 'seal$1'],
  ];
  for (const [re, to] of R) s = s.replace(re, to as string);
  // the ledger's switch words, said as the warden would
  s = s.replace(/\bbeast is slumbering but must be awake (?:for|to) deactivate\b/gi, 'it is already slumbering')
    .replace(/\bbeast is awake but must be slumbering (?:for|to) activate\b/gi, 'it is already awake')
    .replace(/\bfor deactivate\b/gi, 'to slumber').replace(/\bfor activate\b/gi, 'to awaken');
  return s.replace(/\b([Tt])he The /g, '$1he ').replace(/\ba The /g, 'the ').replace(/\ba (isle|alpha|Elder|ember|ally)/g, 'an $1');
}
export const retell = speak;
export const retellError = speak;

/** Bells as a wait a person can feel. A bell is about six seconds. */
export function bellsAsTime(n: number) {
  const s = Math.max(0, n) * 6;
  if (s < 60) return `${Math.max(5, Math.round(s / 5) * 5)} s`;
  const m = s / 60;
  if (m < 90) return `${Math.round(m)} min`;
  const hr = m / 60;
  return hr < 36 ? `${Math.round(hr)} h` : `${Math.round(hr / 24)} days`;
}
/** Breath only matters up to the dearest rite: past that it is simply full. */
export const fmtBreath = (n: number) => (n >= 99 ? 'full' : String(n));
/** How long ago something happened, from a timestamp in ms. */
export function agoMs(t: number, now = Date.now()) {
  const s = (now - t) / 1000;
  if (s < 45) return 'just now';
  return bellsAsTime(s / 6) + ' ago';
}

/** Coven names for guilds that publish none (the ledger's id is always shown beside it). */
export const COVEN_NAMES: Record<string, string> = { '0-1': 'The First Hearth', '0-2': 'The Gilded Mire', '0-3': 'Lanternwatch', '0-4': 'Kilgore Crabla', '0-5': 'The Beta Spire' };
export const COVEN_COLORS = ['#e8c872', '#5fd3b5', '#c9a0ff', '#ff8f7a', '#8fc8ff', '#f0b26a', '#9be08a', '#ff8fb1'];
export function covenColor(id: string) { const n = Number(id.split('-')[1] || 0); return COVEN_COLORS[(n - 1 + COVEN_COLORS.length) % COVEN_COLORS.length]; }
export function covenName(id: string, published?: string) { return id ? published || COVEN_NAMES[id] || `Coven ${id}` : 'A wild wellspring'; }

