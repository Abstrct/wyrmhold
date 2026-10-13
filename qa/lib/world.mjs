/* Fixture skies. Every id follows the ledger's "<objectType>-<index>" form: guilds 0, players 1,
 * planets 2, reactors 3, substations 4, structs 5, fleets 9. The menagerie warden owns one of every
 * kind of beast and hallow in every state the client must draw. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const TYPES = JSON.parse(readFileSync(fileURLToPath(new URL('../../src/data/structTypes.json', import.meta.url)), 'utf8')).types;
export const typeOf = (id) => TYPES.find((t) => t.id === id);
export const AMBIT_FLAG = { water: 2, land: 4, air: 8, space: 16 };
export const AMBITS = ['space', 'air', 'land', 'water'];
/** The first realm a type may stand in. */
export const homeAmbit = (t) => AMBITS.find((a) => t.possibleAmbit & AMBIT_FLAG[a]);
// status bits: materialized 1, built 2, online 4, hidden 16, destroyed 32
export const ST = { building: 1, offline: 3, awake: 7, veiled: 23, fallen: 39 };

export function newWorld() {
  const w = {
    chainId: 'wyrmhold-qa-1', height: 1000,
    players: new Map(), planets: new Map(), fleets: new Map(), structs: new Map(), guilds: new Map(), reactors: new Map(), substations: new Map(), infusions: [], addresses: new Map(), gridRecords: [],
    structTypes: TYPES.map((t) => ({ ...t, id: String(t.id) })),
    anyAddressPlayer: null, next: { player: 1, planet: 1, fleet: 1, struct: 1, guild: 1, reactor: 1, substation: 1 },
  };
  w.id = (kind) => { const n = w.next[kind]++; return { player: '1-', planet: '2-', reactor: '3-', substation: '4-', struct: '5-', fleet: '9-', guild: '0-' }[kind] + n; };
  return w;
}

export function addGuild(w, { name, tag = name.slice(0, 3).toUpperCase(), description = `${name}, a coven of the broken sky.`, endpointBase = '' } = {}) {
  const id = w.id('guild'), reactorId = w.id('reactor'), subId = w.id('substation');
  const n = Number(id.split('-')[1]);
  w.guilds.set(id, { id, meta: { name, tag, description }, chain: { id, index: String(n), endpoint: `${endpointBase}/guilds/${id}/guild.json`, creator: 'structs1' + id, owner: '1-' + n, joinInfusionMinimum: '0', primaryReactorId: reactorId, entrySubstationId: subId, entryRank: '101', name, pfp: '' } });
  w.reactors.set(reactorId, { Reactor: { id: reactorId, validator: 'structsvaloper1' + id, guildId: id, defaultCommission: '0.1', owner: '1-' + n }, gridAttributes: { fuel: String(120_000_000 * n), capacity: String(900_000_000 * n), load: String(300_000_000 * n), power: '0' } });
  w.substations.set(subId, { Substation: { id: subId, owner: '1-' + n, creator: 'structs1' + id, name: `${name} shrine`, pfp: '' }, gridAttributes: { capacity: '400000000', load: '100000000', connectionCapacity: '250000', connectionCount: '8' } });
  return { id, reactorId, subId };
}

const isle = (id, addr, pid, planetOre, shield) => ({ Planet: { id, maxOre: '5', creator: addr, owner: pid, space: ['', '', '', ''], air: ['', '', '', ''], land: ['', '', '', '', '', '', '', ''], water: ['', '', '', ''], spaceSlots: '4', airSlots: '4', landSlots: '8', waterSlots: '4', status: planetOre > 0 ? 'active' : 'complete', name: '', locationListStart: '', locationListLast: '', locationListExtra: '', locationListCount: '0' }, gridAttributes: { ore: String(planetOre) }, planetAttributes: { planetaryShield: String(shield), blockStartRaid: '0', blockRaiderArrived: '0' } });

/** What a sought isle comes to on the chain: a fresh isle for a warden who has none, its warband moored there. */
export function grantIsle(w, pid, { planetOre = 5, shield = 60 } = {}) {
  const P = w.players.get(pid).Player;
  const planetId = w.id('planet');
  w.planets.set(planetId, isle(planetId, P.primaryAddress, pid, planetOre, shield));
  P.planetId = planetId;
  const f = w.fleets.get(P.fleetId);
  if (f && !f.locationId) f.locationId = planetId;
  return planetId;
}

/** A warden with an isle and a warband. `beasts` and `hallows` are [typeId, status?, extra?] lists. */
export function addWarden(w, { name = '', guildId, beasts = [], hallows = [], ore = 0, alpha = 25_000_000, capacity = 30_000_000, connectionCapacity = 250_000, planetOre = 5, shield = 60, fleetStatus = 'onStation', fleetAt = null, noPlanet = false, lastAction = 0, hidden = false, address } = {}) {
  const pid = w.id('player'), idx = pid.split('-')[1];
  const guild = w.guilds.get(guildId) || [...w.guilds.values()][0];
  const planetId = noPlanet ? '' : w.id('planet'), fleetId = w.id('fleet');
  const addr = address || `structs1qa${idx.padStart(36, '0')}`;
  w.addresses.set(addr, pid);
  const planet = noPlanet ? null : isle(planetId, addr, pid, planetOre, shield);
  const fleet = { id: fleetId, owner: pid, locationType: 'planet', locationId: fleetAt || planetId, status: fleetStatus, locationListForward: '', locationListBackward: '', space: ['', '', '', ''], air: ['', '', '', ''], land: ['', '', '', ''], water: ['', '', '', ''], spaceSlots: '4', airSlots: '4', landSlots: '4', waterSlots: '4', commandStruct: '' };
  let structsLoad = 0, load = 0;
  const place = (typeId, status = ST.awake, extra = {}) => {
    const t = typeOf(typeId); if (!t) { return addStruct(w, { typeId, owner: pid, locationType: 'fleet', locationId: fleetId, ambit: extra.ambit || 'land', slot: extra.slot ?? 0, status, ...extra }); }
    const onFleet = t.category === 'fleet', holder = onFleet ? fleet : planet?.Planet;
    if (!holder) return null;
    const ambit = extra.ambit || homeAmbit(t);
    let slot = extra.slot;
    if (slot == null) { slot = holder[ambit].findIndex((s) => !s); if (slot < 0) { holder[ambit].push(''); slot = holder[ambit].length - 1; holder[ambit + 'Slots'] = String(holder[ambit].length); } }
    const s = addStruct(w, { typeId, owner: pid, locationType: onFleet ? 'fleet' : 'planet', locationId: onFleet ? fleetId : planetId, ambit, slot, status, ...extra });
    if (typeId === 1) fleet.commandStruct = s.Struct.id; else holder[ambit][slot] = s.Struct.id;
    if ((status & 4) && (status & 2)) structsLoad += t.passiveDraw;
    return s;
  };
  const made = { beasts: [], hallows: [] };
  for (const b of beasts) made.beasts.push(place(...b));
  for (const hl of hallows) made.hallows.push(place(...hl));
  load = Math.round(structsLoad * 0.1);
  w.players.set(pid, { Player: { id: pid, index: idx, guildId: guild?.id || '', substationId: guild?.chain.entrySubstationId || '', creator: addr, primaryAddress: addr, planetId, fleetId, guildRank: '101', name, pfp: '', pfpClientRenderAttributes: '{"head":1,"neck":1,"body":1,"arms":1,"background":1}', hidden }, gridAttributes: { ore: String(ore), fuel: '0', capacity: String(capacity), load: String(load), structsLoad: String(structsLoad), power: '0', connectionCapacity: String(connectionCapacity), connectionCount: '1', lastAction: String(lastAction), nonce: '1', ready: '0' }, playerInventory: { rocks: { denom: 'ualpha', amount: String(alpha) } } });
  if (planet) w.planets.set(planetId, planet);
  w.fleets.set(fleetId, fleet);
  w.gridRecords.push({ attributeId: `0-1-${idx}`, value: ore }, { attributeId: `11-1-${idx}`, value: lastAction });
  return { pid, planetId, fleetId, address: addr, ...made };
}

export function addStruct(w, { typeId, owner, locationType, locationId, ambit, slot, status = ST.awake, health, protectedStructIndex = 0, ore = 0, defenders = [] }) {
  const id = w.id('struct'), t = typeOf(typeId);
  const s = { Struct: { id, index: id.split('-')[1], type: String(typeId), creator: 'structs1' + owner, owner, locationType, locationId, operatingAmbit: ambit, slot: String(slot) },
    structAttributes: { health: String(health ?? (t ? t.maxHealth : 3)), status: String(status), blockStartBuild: status & 2 ? '0' : String(w.height - 3), blockStartOreMine: '0', blockStartOreRefine: '0', protectedStructIndex: String(protectedStructIndex), typeCount: '0', isMaterialized: !!(status & 1), isBuilt: !!(status & 2), isOnline: !!(status & 4), isHidden: !!(status & 16), isDestroyed: !!(status & 32), isLocked: false },
    gridAttributes: { ore: String(ore), fuel: '0', capacity: '0', load: '0', structsLoad: '0', power: '0' }, structDefenders: defenders };
  w.structs.set(id, s);
  return s;
}

/** Visitors over an isle: `raider`'s warband hangs over `victim`'s isle (first in its visitor list). */
export function raid(w, raiderPid, victimPid) {
  const r = w.players.get(raiderPid).Player, v = w.players.get(victimPid).Player;
  const f = w.fleets.get(r.fleetId); f.status = 'away'; f.locationType = 'planet'; f.locationId = v.planetId;
  const pl = w.planets.get(v.planetId); pl.Planet.locationListStart = f.id; pl.Planet.locationListCount = '1'; pl.planetAttributes.blockStartRaid = String(w.height); pl.planetAttributes.blockRaiderArrived = String(w.height);
}

/** The standard sky every suite starts from. */
export function standardSky(endpointBase = '') {
  const w = newWorld();
  const hearth = addGuild(w, { name: 'The First Hearth', tag: 'HRT', endpointBase });
  const mire = addGuild(w, { name: 'The Gilded Mire', tag: 'MIRE', endpointBase });
  const watch = addGuild(w, { name: 'Lanternwatch', tag: 'LWT', endpointBase });
  // the menagerie: one of everything, in every state the Hold must draw
  const me = addWarden(w, { name: 'Testwarden', guildId: hearth.id, ore: 2, planetOre: 3, shield: 75, lastAction: 940,
    beasts: [[1], [2], [3, ST.offline], [4], [5], [6, ST.veiled], [7, ST.building], [8], [9, ST.awake, { health: 1 }], [10], [11], [12], [13, ST.fallen]],
    hallows: [[14], [15], [16], [17], [18], [19, ST.building], [20], [21], [22, ST.offline]] });
  // a guard post: the Stone Troll guards the Elder Wyrm
  const wyrm = me.beasts[0], troll = me.beasts[8];
  troll.structAttributes.protectedStructIndex = wyrm.Struct.index; wyrm.structDefenders = [troll.Struct.id];
  // the foe: a hold with hallows and a warband at home, wildroot to plunder
  const foe = addWarden(w, { name: 'Grimwald', guildId: mire.id, ore: 4, planetOre: 2, shield: 40, lastAction: 100,
    beasts: [[1], [5], [9], [11], [6, ST.veiled]], hallows: [[14], [15], [16], [18]] });
  // a fresh warden with no isle yet; a crowded hold; an unnamed warden; an isle that is spent
  const fresh = addWarden(w, { name: 'Newling', guildId: hearth.id, noPlanet: true, beasts: [[1]] });
  const crowd = addWarden(w, { name: 'Hoarder', guildId: watch.id, ore: 9, lastAction: 990, beasts: [[1], ...Array.from({ length: 24 }, (_, i) => [2 + (i % 12)])], hallows: [[14], [15], [20], [21], [18], [16], [17]] });
  const unnamed = addWarden(w, { name: '', guildId: mire.id, beasts: [[1], [3]], hallows: [[14]] });
  const spent = addWarden(w, { name: 'Ashen', guildId: watch.id, planetOre: 0, ore: 0, beasts: [[1]], hallows: [[14], [15]] });
  // a stranger whose beast type the catalogue does not know (a newer ledger)
  const strange = addWarden(w, { name: 'Oddkin', guildId: hearth.id, beasts: [[1], [99, ST.awake, { ambit: 'land', slot: 1 }]], hallows: [[14]] });
  const NAMES = ['Wynyn', 'Brannoc', 'Ysmay', 'Corvane', 'Thessaly', 'Ulric', 'Maelis', 'Dagny', 'Ormund', 'Perrin', 'Saskia', 'Taliesin', 'Isolde', 'Bram', 'Elowen', 'Fenwick', 'Gwendra', 'Halvar'];
  const fill = NAMES.map((n, i) => addWarden(w, { name: n, guildId: [hearth, mire, watch][i % 3].id, ore: i % 4 === 0 ? i : 0, lastAction: 400 + i * 30, beasts: [[1], [2 + (i % 12)], [2 + ((i + 5) % 12)]], hallows: [[14], [15], i % 2 ? [20] : [16]] }));
  w.infusions.push({ destinationType: 'reactor', destinationId: hearth.reactorId, fuel: '2000000', power: '1800000', commission: '0.1', playerId: me.pid, address: me.address, ratio: '1', defusing: '0' });
  return { w, guilds: { hearth, mire, watch }, me, foe, fresh, crowd, unnamed, spent, strange, fill };
}
