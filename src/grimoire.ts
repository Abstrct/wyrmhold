/* The Grimoire's words: the tale of the broken sky, the things of the realm, every rite, and the
 * laws of war with the odds the realm actually keeps. The Grimoire screen shows them, and the
 * built pages carry them for readers that never wake the world (seo/seo.ts). */
import { typeOf } from './data/catalogue';

export const TALE = [
  'Before the bells, there was one sky, and it was whole. Then it broke — no song remembers why — and its shards fell upward into the dark and stayed there, drifting above the cloud-sea. Each shard is an isle.',
  'From the wound in the sky came alpha: the first light, falling like warm rain. Where it touched stone, springs woke. Where it touched soil, wildroot grew fat and strange, drinking it down into the marrow of the isles. Where it touched the old beasts sleeping in the clouds, they opened their eyes.',
  'Every warden holds one isle and one Elder Wyrm, and hungers for the same thing: more alpha. It fertilises the springs that pour mana. It is tithed to the wellsprings of the covens. It calls beasts out of the circle. And because it cannot be stolen once it is brewed, every warden races to brew it before a neighbour comes to plunder the wildroot it grows in.',
];

export const THINGS: [string, string][] = [
  ['Alpha (α)', 'The first light. It quickens everything it touches, feeds every spring and summoning, and no raider can carry it away.'],
  ['Wildroot', 'Roots that drank fallen alpha. Raw, heavy, and plunderable until the Dawn Cauldron draws the alpha out of it.'],
  ['Mana', 'What alpha becomes when a spring or wellspring is fed. Every waking beast drinks it; summon past your flow and the circle will not light.'],
  ['Breath', 'Your readiness to act, shared by your whole warband. One draws in with every bell; summoning, striking, riding out or guarding spends it all.'],
  ['Ward', 'How long a raider must chant to break into your hold. Lanterns, moons, vaults and spires raise it.'],
  ['Bell', 'The sky’s heartbeat — about six seconds. Everything in the realm happens on a bell.'],
  ['Chant', 'Summoning, delving, brewing and plundering each need one. A chant grows easier with time, even while Wyrmhodl is closed: a summoning takes minutes to hours, a sheaf of wildroot about half a day to delve and most of a day to brew. Come back and a ripe chant is finished in moments; left open, Wyrmhodl chants on with this device’s spare strength, and a lucky chant lands sooner.'],
  ['Isle', 'A shard of the old sky. It holds a finite marrow of wildroot; when it is spent, a warden seeks another.'],
  ['Warband', 'Your beasts that fly. They ride out together, and while they are abroad your hold has no beasts to guard it.'],
  ['Coven', 'Wardens sworn together. A coven lends its leyline to the newly sworn, and its wellspring pours mana for all who tithe.'],
  ['Wellspring · Ley Shrine · Leyline', 'Alpha tithed to a wellspring becomes mana; leylines carry it to shrines; holds drink from a shrine.'],
  ['Starfall · Skies · Wilds · Deeps', 'The four realms of every isle: the high dark, the open air, the land and the waters.'],
  ['Soulstone', 'Your name in the sky, sealed in this browser. Its twenty-four soul-words are the only way back to your warden.'],
];

export const RITES: [string, string, string][] = [
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

/** The laws of war. */
export function laws(): [string, string][] {
  const g = typeOf(5)!, w = typeOf(7)!, tr = typeOf(9)!, bh = typeOf(2)!, sr = typeOf(12)!;
  const R = (t: typeof g) => t as unknown as Record<string, number>;
  const turned = (n: number, d: number) => `${n} in ${d}`;
  return [
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
    ['Wounds', 'Wounds never mend: no rite heals a beast, and every heart it loses stays lost. A fallen beast can be summoned anew at full hearts, and a fallen Elder Wyrm hatches anew. While your warband hangs over their isle, their beasts that reach yours can strike it, not only answer your blows: the Skirmish counts how many blows would fell your Wyrm.'],
    ['Plunder', 'Takes unbrewed wildroot, never alpha, never a soulstone. Fell the raider’s Elder Wyrm and the plunder breaks.'],
  ];
}
