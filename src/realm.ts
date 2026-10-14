/* Reading the ledger as a realm: a warden's beasts and hallows on an isle, free summoning
 * circles (slots), and the wardens abroad. */
import { LCD_URL, lcd, num, type PlanetFull, type RawFleet, type RawPlayer } from './chain/lcd';
import type { OwnedStruct, PlayerState } from './game/empire';
import { reservedSlots } from './game/actions';
import { AMBIT_FLAG, AMBITS, type Ambit, type StructType } from './data/catalogue';
import { REALM_OF_AMBIT, skyHolds, type Realm } from './lore';
import { grass, grassGrid, type GrassMsg } from './chain/grass';
import { guildList } from './guild/api';
import { safeEach } from './core/util';

export interface IsleUnit { id: string; type: number; realm?: Realm; offline?: boolean; building?: boolean; plot?: number }

/** Where a struct stands in the realm, or null if it isn't on the isle (destroyed, or away with the warband). */
export function realmOf(s: OwnedStruct): Realm { return REALM_OF_AMBIT[(s.ambit as Ambit)] || 'wilds'; }

export function unitsOf(p: PlayerState): IsleUnit[] {
  const out: IsleUnit[] = [];
  const away = p.fleet?.status === 'away';
  for (const s of p.structs.values()) {
    if (s.destroyed || !s.typeId) continue;
    const fleetBeast = s.type?.category === 'fleet';
    if (fleetBeast && away) continue;
    const u: IsleUnit = { id: s.id, type: s.typeId, offline: s.built && !s.online, building: !s.built };
    if (fleetBeast) u.realm = realmOf(s);
    else u.plot = s.slot + (s.ambit === 'water' ? 4 : 0);
    out.push(u);
  }
  return out;
}

/** A free circle for a summoning of type `t`, honouring queued summonings. */
export function freeCircle(p: PlayerState, t: StructType): { ambit: Ambit; slot: number } | null {
  const where = t.category;
  const holder = (where === 'planet' ? p.planet?.Planet : p.fleet) as unknown as Record<string, string[] | string> | undefined;
  if (!holder) return null;
  const held = reservedSlots(p.playerId);
  for (const a of AMBITS) {
    if (!(t.possibleAmbit & AMBIT_FLAG[a])) continue;
    const ids = (holder[a] as string[]) || [];
    const n = Math.max(num(holder[a + 'Slots'] as string), ids.length);
    for (let i = 0; i < n; i++) if (!ids[i] && !held.has(`${where}:${a}:${i}`)) return { ambit: a, slot: i };
  }
  return null;
}

export function owned(p: PlayerState, typeId: number) {
  let n = 0;
  for (const s of p.structs.values()) if (s.typeId === typeId && !s.destroyed) n++;
  return n;
}

/* ── Wardens abroad ─────────────────────────────────────────────────── */

export interface Warden { id: string; name: string; guildId: string; planetId: string; fleetId: string; address: string }

let roster: { at: number; list: Warden[] } | null = null;

/** The newest wardens with isles, straight from the ledger (one page, newest first). While GRASS
 * streams, the list is kept current from it (a warden renamed, a new isle claimed, a newcomer) and
 * lives half an hour; without it, five minutes. */
export async function wardens(limit = 400): Promise<Warden[]> {
  if (roster && Date.now() - roster.at < (grass.live ? 30 : 5) * 60_000) return roster.list;
  const r = await fetch(`${LCD_URL}/structs/player?pagination.limit=${limit}&pagination.reverse=true`, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`The ledger answered ${r.status}`);
  const body = await r.json() as { Player?: RawPlayer[] };
  const list = (body.Player || [])
    .filter((p) => p.planetId)
    .map((p) => ({ id: p.id, name: p.name || '', guildId: p.guildId, planetId: p.planetId, fleetId: p.fleetId, address: p.primaryAddress }));
  roster = { at: Date.now(), list };
  return list;
}

/** A player row from GRASS (structs.player.<guild>.<player>, snake_case): fold it into the roster. */
function rosterPatch(d: Record<string, unknown>) {
  if (!roster || typeof d.id !== 'string') return;
  const s = (v: unknown) => (typeof v === 'string' ? v : '');
  const i = roster.list.findIndex((w) => w.id === d.id);
  const name = s(d.username) || s(d.name);
  if (i >= 0) {
    const w = roster.list[i];
    const next = { ...w, name: name || w.name, guildId: s(d.guild_id) || w.guildId, planetId: s(d.planet_id) || w.planetId, fleetId: s(d.fleet_id) || w.fleetId };
    // a warden whose isle is gone (spent and not yet replaced) leaves the sky
    if ('planet_id' in d && !d.planet_id) roster.list.splice(i, 1); else roster.list[i] = next;
  } else if (s(d.planet_id)) {
    roster.list.unshift({ id: d.id, name, guildId: s(d.guild_id), planetId: s(d.planet_id), fleetId: s(d.fleet_id), address: s(d.primary_address) });
  }
}

export const wardenName = (w: { name: string; id: string }) => w.name || `Warden ${w.id}`;
/** A player's name for display. The player record stands its sigil in for a missing name; say "Warden 1-3" instead. */
export const playerName = (p: { name?: string; playerId: string }) => (p.name && p.name !== p.playerId ? p.name : `Warden ${p.playerId}`);

/* ── Raiders overhead ───────────────────────────────────────────────── */

interface ApiFleet { id: string; owner: string; status: string; location_type: string; location_id: string; location_list_forward: string; location_list_backward: string }

/** Foreign warbands hanging in an isle's sky, first in line first. One Guild API read of every
 * warband at the isle when it can answer; else the ledger's visitor list, one warband at a time. */
export async function raidersAt(planet: { Planet: { id: string; owner: string; locationListStart: string } } | null): Promise<{ fleetId: string; owner: string }[]> {
  if (!planet?.Planet.locationListStart) return [];
  const isle = planet.Planet;
  const keep = (f: { owner: string; status: string; locationId: string }) => f.owner !== isle.owner && f.status === 'away' && f.locationId === isle.id;
  const here = await guildList<ApiFleet>(`fleet/list/location/${encodeURIComponent(isle.id)}`, 200);
  if (here) {
    // walk the ledger's own line through the rows, so the order is the ledger's
    const byId = new Map(here.map((f) => [f.id, f]));
    const out: { fleetId: string; owner: string }[] = [];
    const seen = new Set<string>();
    for (let id = isle.locationListStart; id && byId.has(id) && !seen.has(id); id = byId.get(id)!.location_list_forward) {
      seen.add(id);
      const f = byId.get(id)!;
      if (keep({ owner: f.owner, status: f.status, locationId: f.location_id })) out.push({ fleetId: f.id, owner: f.owner });
    }
    // nothing matched the isle's own line: the indexer and the isle disagree, so ask the ledger
    if (seen.size) return out;
  }
  const out: { fleetId: string; owner: string }[] = [];
  let id = isle.locationListStart;
  for (let guard = 0; id && guard < 24; guard++) {
    const f = await lcd.fleet(id).catch(() => null);
    if (!f) break;
    if (keep(f)) out.push({ fleetId: f.id, owner: f.owner });
    id = f.locationListForward;
  }
  return out;
}

/** An isle's sky holds 1 + its extra places of foreign warbands at once (msg_server_fleet_move.go), and the
 * ledger refuses a ride into a full one ("queue_full"). Why `rider` cannot ride there now, or null if it can. */
export function skyFull(isle: PlanetFull | null | undefined, rider?: { planetId: string; fleet: RawFleet | null } | null): string | null {
  if (!isle || isle.Planet.id === rider?.planetId) return null;
  // a warband already in that sky is one of the raiders it holds
  if (rider?.fleet?.status === 'away' && rider.fleet.locationId === isle.Planet.id) return null;
  const cap = 1 + num(isle.Planet.locationListExtra);
  return num(isle.Planet.locationListCount) >= cap ? `Another warband already hangs over that isle, and ${skyHolds(cap)}. You can ride out once it leaves.` : null;
}

/* ── Omen-sight: who holds wildroot unbrewed, and who has slept ─────── */

export interface Sight { ore: number; lastAction: number }

/* The sight of every warden, read whole once and then kept current from GRASS: each wildroot or
 * bell change patches one entry. GRASS never says when a value is cleared (the indexer deletes
 * the row and sends nothing), and wildroot is cleared whenever it is all brewed or all plundered,
 * so a wildroot movement in the ledger of goods (mined, refined, seized) re-reads that one warden.
 * Without GRASS, or after any gap in it, the whole sight is read again once it is a minute old. */
const sight = {
  map: new Map<string, Sight>(),
  /** When the last whole read landed (0: never, or since a gap). */
  at: 0,
  /** Entries GRASS changed while a whole read was in flight: they are newer than what it brings. */
  during: null as Map<string, Sight> | null,
  reading: null as Promise<Map<string, Sight>> | null,
  listeners: new Set<() => void>(),
  recheck: new Set<string>(),
  recheckT: 0 as ReturnType<typeof setTimeout> | 0,
};

/** Hear when the sight changes (a patch from GRASS or a whole read). */
export function onSight(f: () => void) { sight.listeners.add(f); return () => { sight.listeners.delete(f); }; }
function sightChanged() { safeEach(sight.listeners, (f) => f()); }

function sightEntry(pid: string): Sight {
  let s = sight.map.get(pid);
  if (!s) { s = { ore: 0, lastAction: 0 }; sight.map.set(pid, s); }
  return s;
}

/** Every warden's stored (plunderable) wildroot and last-stirred bell. */
export async function omenSight(force = false): Promise<Map<string, Sight>> {
  const fresh = sight.at && (grass.live ? true : Date.now() - sight.at < 60_000);
  if (!force && fresh) return sight.map;
  if (sight.reading && !force) return sight.reading;
  // a forced read starts after any read already under way: that one may predate what the caller knows
  const before = sight.reading?.catch(() => null);
  const p: Promise<Map<string, Sight>> = (before ? before.then(readSight) : readSight()).finally(() => { if (sight.reading === p) sight.reading = null; });
  sight.reading = p;
  return p;
}

async function readSight(): Promise<Map<string, Sight>> {
  sight.during = new Map();
  try {
    const rows = await sightFromGuild() ?? await sightFromLedger();
    const map = new Map<string, Sight>();
    const at = (pid: string) => { let s = map.get(pid); if (!s) { s = { ore: 0, lastAction: 0 }; map.set(pid, s); } return s; };
    for (const r of rows) {
      if (r.attr === 'ore') at(r.pid).ore = r.value; else at(r.pid).lastAction = r.value;
    }
    for (const [pid, s] of sight.during) map.set(pid, { ...at(pid), ...s });
    // patch the one map in place: screens holding it see the new sight at once
    sight.map.clear();
    for (const [k, v] of map) sight.map.set(k, v);
    sight.at = Date.now();
    sightChanged();
    return sight.map;
  } finally { sight.during = null; }
}

type SightRow = { pid: string; attr: 'ore' | 'lastAction'; value: number };

async function sightFromGuild(): Promise<SightRow[] | null> {
  const read = (attr: 'ore' | 'lastAction') => guildList<{ object_id: string; val: string }>(`grid/attribute-type/${attr}/object-type/player`)
    .then((rows) => rows && rows.map((g) => ({ pid: g.object_id, attr, value: Number(g.val) || 0 })));
  const [ore, last] = await Promise.all([read('ore'), read('lastAction')]);
  return ore && last ? [...ore, ...last] : null;
}

/** The ledger node's grid records, keyed "<attr>-1-<warden index>": 0 is stored wildroot, 11 the last rite's bell. */
async function sightFromLedger(): Promise<SightRow[]> {
  const from = (prefix: string) => encodeURIComponent(btoa(prefix));
  const page = async (prefix: string) => {
    const r = await fetch(`${LCD_URL}/structs/grid?pagination.limit=8000&pagination.key=${from(prefix)}`);
    if (!r.ok) throw new Error(`The ledger answered ${r.status}`);
    return ((await r.json()).gridRecords || []) as { attributeId: string; value: string }[];
  };
  const [oreRecs, lastRecs] = await Promise.all([page('0-1-'), page('11-1-')]);
  const out: SightRow[] = [];
  for (const g of [...oreRecs, ...lastRecs]) {
    const m = /^(\d+)-1-(\d+)$/.exec(g.attributeId);
    if (!m || (m[1] !== '0' && m[1] !== '11')) continue;
    out.push({ pid: '1-' + m[2], attr: m[1] === '0' ? 'ore' : 'lastAction', value: Number(g.value) || 0 });
  }
  return out;
}

function sightPatch(pid: string, patch: Partial<Sight>) {
  Object.assign(sightEntry(pid), patch);
  if (sight.during) sight.during.set(pid, { ...sight.during.get(pid), ...patch } as Sight);
}

/** Read again, from the ledger node, the wildroot of wardens GRASS says moved some. A handful at a time. */
function recheckOre(pid: string) {
  sight.recheck.add(pid);
  if (sight.recheckT) return;
  sight.recheckT = setTimeout(async () => {
    sight.recheckT = 0;
    const ids = [...sight.recheck].slice(0, 12);
    for (const id of ids) sight.recheck.delete(id);
    const got = await Promise.all(ids.map((id) => lcd.player(id).then((p) => ({ id, ore: num(p.gridAttributes?.ore) }), () => null)));
    let any = false;
    for (const g of got) if (g && (sight.map.get(g.id)?.ore ?? 0) !== g.ore) { sightPatch(g.id, { ore: g.ore }); any = true; }
    if (any) sightChanged();
    if (sight.recheck.size) recheckOre([...sight.recheck][0]);
  }, 1500);
}

/* ── Following GRASS ───────────────────────────────────────────────── */

if (typeof window !== 'undefined') {
  grass.onMsg((m: GrassMsg) => {
    if (m.parts[1] === 'player' && !m.stub) { rosterPatch(m.data); return; }
    // a stub names the warden only: hear it from the ledger next time the roster is read
    if (m.parts[1] === 'player' && roster) { roster.at = 0; return; }
    if (!sight.at) return;
    const g = grassGrid(m);
    if (g) {
      if (g.objectType !== 'player' || (g.attr !== 'ore' && g.attr !== 'lastAction')) return;
      sightPatch(g.objectId, g.attr === 'ore' ? { ore: Number(g.value) || 0 } : { lastAction: Number(g.value) || 0 });
      sightChanged();
      return;
    }
    // structs.inventory.ore.<guild>.<player>.<address>: wildroot dug, brewed or carried off
    if (m.parts[1] === 'inventory' && m.parts[2] === 'ore') {
      for (const id of [m.parts[4], m.data.counterparty_player_id]) if (typeof id === 'string' && /^1-\d+$/.test(id)) recheckOre(id);
      return;
    }
    // a raid that seized wildroot: the isle's warden has less now
    if (m.parts[1] === 'planet' && m.category === 'raid_status' && /^1-\d+$/.test(m.parts[3] || '')) recheckOre(m.parts[3]);
  });
  // whatever passed while GRASS was away was missed: read whole again when next asked
  grass.onReconnect(() => { sight.at = 0; if (roster) roster.at = 0; });
  grass.onState((s) => { if (s === 'down') sight.at = Math.min(sight.at, Date.now() - 55_000) || 0; });
}
