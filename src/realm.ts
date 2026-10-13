/* Reading the ledger as a realm: a warden's beasts and hallows on an isle, free summoning
 * circles (slots), and the wardens abroad. */
import { LCD_URL, lcd, num, type PlanetFull, type RawFleet, type RawPlayer } from './chain/lcd';
import type { OwnedStruct, PlayerState } from './game/empire';
import { reservedSlots } from './game/actions';
import { AMBIT_FLAG, AMBITS, type Ambit, type StructType } from './data/catalogue';
import { REALM_OF_AMBIT, skyHolds, type Realm } from './lore';

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

let cache: { at: number; list: Warden[] } | null = null;

/** The newest wardens with isles, straight from the ledger (one page, newest first). */
export async function wardens(limit = 400): Promise<Warden[]> {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.list;
  const r = await fetch(`${LCD_URL}/structs/player?pagination.limit=${limit}&pagination.reverse=true`, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`The ledger answered ${r.status}`);
  const body = await r.json() as { Player?: RawPlayer[] };
  const list = (body.Player || [])
    .filter((p) => p.planetId)
    .map((p) => ({ id: p.id, name: p.name || '', guildId: p.guildId, planetId: p.planetId, fleetId: p.fleetId, address: p.primaryAddress }));
  cache = { at: Date.now(), list };
  return list;
}

export const wardenName = (w: { name: string; id: string }) => w.name || `Warden ${w.id}`;
/** A player's name for display. The player record stands its sigil in for a missing name; say "Warden 1-3" instead. */
export const playerName = (p: { name?: string; playerId: string }) => (p.name && p.name !== p.playerId ? p.name : `Warden ${p.playerId}`);

/* ── Raiders overhead ───────────────────────────────────────────────── */

/** Foreign warbands hanging in an isle's sky, read from the ledger's visitor list (first in line first). */
export async function raidersAt(planet: { Planet: { id: string; owner: string; locationListStart: string } } | null): Promise<{ fleetId: string; owner: string }[]> {
  if (!planet?.Planet.locationListStart) return [];
  const out: { fleetId: string; owner: string }[] = [];
  let id = planet.Planet.locationListStart;
  for (let guard = 0; id && guard < 24; guard++) {
    const f = await lcd.fleet(id).catch(() => null);
    if (!f) break;
    if (f.owner !== planet.Planet.owner && f.status === 'away' && f.locationId === planet.Planet.id) out.push({ fleetId: f.id, owner: f.owner });
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
let sightCache: { at: number; map: Map<string, Sight> } | null = null;

/** Every warden's stored (plunderable) wildroot and last-stirred bell, in two pages from the ledger.
 * Grid records are keyed "<attr>-1-<warden index>": 0 is stored wildroot, 11 the last rite's bell. */
export async function omenSight(force = false): Promise<Map<string, Sight>> {
  if (!force && sightCache && Date.now() - sightCache.at < 60_000) return sightCache.map;
  const from = (prefix: string) => encodeURIComponent(btoa(prefix));
  const page = async (prefix: string) => {
    const r = await fetch(`${LCD_URL}/structs/grid?pagination.limit=8000&pagination.key=${from(prefix)}`);
    if (!r.ok) throw new Error(`The ledger answered ${r.status}`);
    return ((await r.json()).gridRecords || []) as { attributeId: string; value: string }[];
  };
  const [oreRecs, lastRecs] = await Promise.all([page('0-1-'), page('11-1-')]);
  const map = new Map<string, Sight>();
  const at = (pid: string) => { let s = map.get(pid); if (!s) { s = { ore: 0, lastAction: 0 }; map.set(pid, s); } return s; };
  for (const g of [...oreRecs, ...lastRecs]) {
    const m = /^(\d+)-1-(\d+)$/.exec(g.attributeId);
    if (!m) continue;
    if (m[1] === '0') at('1-' + m[2]).ore = Number(g.value) || 0;
    else if (m[1] === '11') at('1-' + m[2]).lastAction = Number(g.value) || 0;
  }
  sightCache = { at: Date.now(), map };
  return map;
}
