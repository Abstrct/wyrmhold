/* Your empire: live state of every player this wallet controls — the commander and each
 * replicant. Player + grid, home planet + attributes, fleet, and every struct in their slots.
 * Read whole from the LCD: at first, when the chain says something of yours changed shape (a
 * beast summoned or moved, a warband riding), after your own transactions land, after any gap in
 * the live feed, and every few blocks as a backstop.
 *
 * Between whole reads the state is kept current the way structs-universe's perception keeps its
 * galaxy: an attribute event (grid, beast or isle attribute) carries the attribute's whole new
 * value, so it is written straight into the state it names and nothing is read again. The node's
 * own feed brings these first; GRASS brings the same while that feed is down. Values are absolute,
 * so hearing one twice is harmless; a patch that lands while that warden is being read marks
 * them for one more read, so the read can't carry older news over it.
 *
 * Your own wardens are kept as last seen (IndexedDB) so the next visit paints them at once. A
 * warden shown that way is `restored` until the ledger answers, and no rite of theirs is sent
 * before then: what the screen shows may be old, what is signed never is. */
import { lcd, big, num, attributeEvent, type AttrRecord, type PlayerFull, type PlanetFull, type RawFleet, type StructFull } from '../chain/lcd';
import { live } from '../chain/live';
import { grass, grassGrid, grassTouches, type GrassMsg } from '../chain/grass';
import { cache } from '../cache/idb';
import { wallet } from '../wallet/wallet';
import { txq } from '../wallet/queue';
import { safeEach, sleep } from '../core/util';
import { typeOf, type StructType } from '../data/catalogue';

export interface OwnedStruct {
  id: string; typeId: number; type: StructType | undefined;
  locationType: string; locationId: string; ambit: string; slot: number;
  health: number; status: number;
  built: boolean; online: boolean; hidden: boolean; destroyed: boolean; materialized: boolean; locked: boolean;
  blockStartBuild: number; blockStartOreMine: number; blockStartOreRefine: number;
  defenders: string[];
  protectedStructIndex: number;
  ore: number;
}

export interface PlayerState {
  playerId: string;
  account: number;
  address: string;
  name: string;
  pfp: string;
  guildId: string;
  substationId: string;
  planetId: string;
  fleetId: string;
  alpha: bigint;          // ualpha in the player's wallet (playerInventory)
  ore: number;            // stored ore (raidable)
  load: bigint; structsLoad: bigint; capacity: bigint; connectionCapacity: bigint;
  lastAction: number;
  online: boolean;
  planet: PlanetFull | null;
  fleet: RawFleet | null;
  /** The planet our fleet sits at while away (a raid target), with its raid clock and shield. */
  target: PlanetFull | null;
  structs: Map<string, OwnedStruct>;
  readAt: number;
  readHeight: number;
  /** Shown from the last visit's copy; the ledger hasn't answered for this warden yet. */
  restored?: boolean;
}

/** How often a whole read backs up the patches while they flow, and while they don't (in blocks). */
const BACKSTOP_PATCHED = 40, BACKSTOP = 8;
const KEEP_NS = 'empire', KEEP_MS = 7 * 86_400_000;
const keepKey = (pid: string) => 'warden:' + pid;

type Fn = () => void;

class Empire {
  players = new Map<string, PlayerState>();
  /** Players followed read-only (another commander's deck); account is -1 for these. */
  private watched = new Map<string, number>();   // player → how many holders (deck, crew…)
  private listeners = new Set<Fn>();
  private dirty = new Set<string>();
  private reading = new Set<string>();
  private lastFull = 0;
  private lastRetry = 0;
  /** Object ids (isles, warbands, beasts) → owning warden of ours, for event routing. */
  private owner = new Map<string, string>();

  constructor() {
    if (typeof window === 'undefined') return;
    wallet.onChange(() => this.sync());
    live.onBlock((b) => {
      // a warden whose first read failed (the ledger was down), or who is held only as last seen,
      // is asked for again every few blocks, not forgotten
      if (b.height - this.lastRetry >= BACKSTOP) {
        this.lastRetry = b.height;
        for (const a of wallet.accounts) if (a.playerId && (!this.players.has(a.playerId) || this.players.get(a.playerId)!.restored)) this.dirty.add(a.playerId);
        for (const w of this.watched.keys()) if (!this.players.has(w)) this.dirty.add(w);
      }
      // while patches flow from a live feed the state stays current between whole reads
      if (b.height - this.lastFull >= (live.state === 'live' ? BACKSTOP_PATCHED : BACKSTOP)) {
        this.lastFull = b.height;
        for (const id of this.players.keys()) this.dirty.add(id);
      }
      void this.flush();
    });
    live.onTx((tx) => {
      let patched = false;
      for (const e of tx.events) {
        // an attribute's new value is written straight in; anything else of ours is read again
        const rec = attributeEvent(e.type, e.data);
        if (rec) { const r = this.patch(rec, tx.height); if (r) { patched ||= r === 'changed'; continue; } }
        for (const id of touchedIds(e.type, e.data)) this.markOwner(id);
      }
      if (patched) this.emit();
      if (this.dirty.size) void this.flush();
    });
    // a gap in the live feed may have hidden anything: read everyone whole
    live.onReconnect(() => { void this.refresh(); });
    // GRASS says the same things a block later. While the node's own feed is down it is the
    // only word that something of ours changed; while that feed is up it would only repeat it
    // (and a late repeat could briefly undo a newer value).
    grass.onMsg((m) => { if (live.state !== 'live' && m.subject !== 'consensus') this.hearGrass(m); });
    grass.onReconnect(() => { if (live.state !== 'live') void this.refresh(); });
    wallet.onForget(() => { void cache.clear(KEEP_NS); });
    txq.onSettled((j) => { if (j.playerId && this.players.has(j.playerId)) { this.dirty.add(j.playerId); void this.flush(); } });
    // The queue asks us how charged a player is before it sends a struct action.
    txq.chargeOf = (pid) => { const p = this.players.get(pid); return p && !p.restored ? this.charge(p) : null; };
    // ...and whether what we hold of them came from the ledger this visit, not the last one
    txq.verifiedOf = (pid) => !this.players.get(pid)?.restored;
    this.sync();
  }

  /** Route an object id to the warden it belongs to (ours or watched), marking them for a whole read. */
  private markOwner(id: string) {
    const who = this.players.has(id) ? id : this.owner.get(id);
    if (who) this.dirty.add(who);
  }

  /**
   * Write one attribute's new value into every warden's state that holds its object. 'changed' or
   * 'same' when some warden holds it (no read needed), null when none does (the caller reads).
   * `height` is the block it happened at, when known: older than a warden's last read, it is old news.
   */
  private patch(r: AttrRecord, height = 0): 'changed' | 'same' | null {
    let held = false, changedAny = false;
    const v = r.value;
    for (const p of this.players.values()) {
      // per warden: does their state hold this object, and did the value move? Older than this
      // warden's last whole read, it is old news: that read already knew better, so nothing is written.
      const dry = height > 0 && height < p.readHeight;
      const w = { hit: false, changed: false };
      const set = (o: object, k: string, x: unknown) => {
        w.hit = true;
        const rec = o as Record<string, unknown>;
        if (!dry && rec[k] !== x) { rec[k] = x; w.changed = true; }
      };
      const touch = () => { w.hit = true; };
      if (r.store === 'grid') {
        if (r.objectId === p.playerId || r.objectId === p.substationId) {
          if (r.objectId === p.playerId && r.name === 'ore') set(p, 'ore', num(v));
          else if (r.objectId === p.playerId && r.name === 'lastAction') set(p, 'lastAction', num(v));
          else if (r.objectId === p.playerId && (r.name === 'load' || r.name === 'structsLoad' || r.name === 'capacity')) set(p, r.name, big(v));
          // a hold's secondary capacity is its shrine's per-connection share
          else if (r.objectId === p.substationId && r.name === 'connectionCapacity') set(p, 'connectionCapacity', big(v));
          else touch();   // fuel, nonce, the player's own connection figures: nothing shown here
          if (w.changed) p.online = p.load + p.structsLoad <= p.capacity + p.connectionCapacity;
        } else if (p.structs.has(r.objectId)) {
          if (r.name === 'ore') set(p.structs.get(r.objectId)!, 'ore', num(v)); else touch();
        }
        for (const pl of [p.planet, p.target]) if (pl && pl.Planet.id === r.objectId) set(pl.gridAttributes ??= {}, r.name, v);
      } else if (r.store === 'planet') {
        for (const pl of [p.planet, p.target]) if (pl && pl.Planet.id === r.objectId) set(pl.planetAttributes ??= {}, r.name, v);
      } else {
        const st = p.structs.get(r.objectId);
        if (st) {
          const n = num(v);
          if (r.name === 'health') set(st, 'health', n);
          else if (r.name === 'status') {
            // built at last: the ledger clears the build clock in the same breath, and says nothing of it
            if (n & 2 && !st.built) set(st, 'blockStartBuild', 0);
            set(st, 'status', n);
            if (!dry) Object.assign(st, flags(n));
          } else if (r.name === 'blockStartBuild' || r.name === 'blockStartOreMine' || r.name === 'blockStartOreRefine' || r.name === 'protectedStructIndex') set(st, r.name, n);
          else touch();
        }
      }
      if (!w.hit) continue;
      held = true;
      if (w.changed) {
        changedAny = true;
        // a patch landing while this warden's whole read is in flight: that read may predate it
        if (this.reading.has(p.playerId)) this.dirty.add(p.playerId);
      }
    }
    return changedAny ? 'changed' : held ? 'same' : null;
  }

  /** A GRASS message while the node's feed is down: patch what it carries whole, read again what it doesn't. */
  private hearGrass(m: GrassMsg) {
    let r: 'changed' | 'same' | null = null;
    const g = grassGrid(m);
    if (g) {
      const store = g.objectType === 'player' || g.objectType === 'planet' || g.objectType === 'struct' || g.objectType === 'substation' ? 'grid' : null;
      if (store) r = this.patch({ store, name: g.attr, objectId: g.objectId, value: g.value });
    } else if (m.parts[1] === 'planet' && !m.stub) {
      // planet activity: the fields are under `detail`, with the block it happened at
      const d = (m.data.detail && typeof m.data.detail === 'object' ? m.data.detail : m.data) as Record<string, unknown>;
      const height = Number(m.data.block_height) || 0;
      const planet = String(m.data.planet_id ?? m.parts[2] ?? '');
      const sid = typeof d.struct_id === 'string' ? d.struct_id : '';
      const n = (k: string) => (d[k] == null ? null : String(d[k]));
      const one = (rec: AttrRecord | null) => (rec && /^\d+$/.test(rec.value) ? this.patch(rec, height) : null);
      switch (m.category) {
        case 'struct_health': r = one(sid ? { store: 'struct', name: 'health', objectId: sid, value: n('health') ?? '' } : null); break;
        case 'struct_status': r = one(sid ? { store: 'struct', name: 'status', objectId: sid, value: n('status') ?? '' } : null); break;
        case 'struct_block_build_start': r = one(sid ? { store: 'struct', name: 'blockStartBuild', objectId: sid, value: n('block') ?? '' } : null); break;
        case 'shield_change': r = one({ store: 'planet', name: 'planetaryShield', objectId: planet, value: n('planetary_shield') ?? '' }); break;
        // the frame carries the clock itself: 0 when the raid has ended
        case 'block_raid_start': r = one({ store: 'planet', name: 'blockStartRaid', objectId: planet, value: n('block_start_raid') ?? '' }); break;
        default: break;
      }
    }
    if (r === 'changed') this.emit();
    if (r) return;
    for (const id of grassTouches(m)) this.markOwner(id);
    if (this.dirty.size) void this.flush();
  }

  onChange(f: Fn) { this.listeners.add(f); f(); return () => this.listeners.delete(f); }
  private emit() { safeEach(this.listeners, (f) => f()); }

  get commander(): PlayerState | null {
    const a = wallet.active;
    return a?.playerId ? this.players.get(a.playerId) ?? null : null;
  }

  /** Blocks since the player's last action — the battery every struct action draws on. */
  charge(p: PlayerState): number {
    // GRASS's heartbeat trails the node's by a block, so it only counts while the node's feed is down
    const h = Math.max(live.height, grass.height) || p.readHeight;
    return Math.max(0, h - p.lastAction);
  }

  /** Re-read the roster of players from the wallet's accounts. */
  sync() {
    const want = new Map(wallet.accounts.filter((a) => a.playerId).map((a) => [a.playerId!, a]));
    let changed = false;
    for (const id of [...this.players.keys()]) if (!want.has(id) && !this.watched.has(id)) { this.players.delete(id); changed = true; }
    for (const id of want.keys()) if (!this.players.has(id)) { this.dirty.add(id); void this.restore(id); }
    if (changed) this.emit();
    void this.flush();
  }

  /** Paint a warden of ours from the last visit's copy while the ledger is read (never over a live read). */
  private async restore(playerId: string) {
    const e = await cache.entry<PlayerState>(keepKey(playerId), KEEP_NS).catch(() => null);
    const acct = wallet.byPlayer(playerId);
    if (!e || !acct || this.players.has(playerId) || Date.now() - e.at > KEEP_MS) return;
    const v = e.v;
    // the catalogue entries are this build's, not the copy's
    const structs = new Map([...v.structs].map(([id, st]) => [id, { ...st, type: typeOf(String(st.typeId)) }] as [string, OwnedStruct]));
    const st: PlayerState = { ...v, structs, account: acct.index, address: acct.address, restored: true };
    this.players.set(playerId, st);
    this.own(st);
    this.emit();
  }

  /** Note which warden every isle, warband and beast of `st` belongs to. */
  private own(st: PlayerState) {
    for (const [k, v] of this.owner) if (v === st.playerId) this.owner.delete(k);
    if (st.planetId) this.owner.set(st.planetId, st.playerId);
    if (st.fleetId) this.owner.set(st.fleetId, st.playerId);
    for (const id of st.structs.keys()) this.owner.set(id, st.playerId);
  }

  /** Follow any player read-only. */
  watch(playerId: string) {
    if (wallet.byPlayer(playerId)) return;
    this.watched.set(playerId, (this.watched.get(playerId) || 0) + 1);
    this.dirty.add(playerId);
    void this.flush();
  }
  unwatch(playerId: string) {
    const n = this.watched.get(playerId) || 0;
    if (n > 1) { this.watched.set(playerId, n - 1); return; }
    if (!this.watched.delete(playerId) || wallet.byPlayer(playerId)) return;
    this.players.delete(playerId);
    for (const [k, v] of this.owner) if (v === playerId) this.owner.delete(k);
    this.emit();
  }
  /** True when this wallet can sign for the player. */
  commands(playerId: string) { return !!wallet.byPlayer(playerId); }

  refresh(playerId?: string) {
    if (playerId) this.dirty.add(playerId); else { for (const a of wallet.accounts) if (a.playerId) this.dirty.add(a.playerId); for (const w of this.watched.keys()) this.dirty.add(w); }
    return this.flush();
  }

  private flushing = false;
  private async flush() {
    if (this.flushing) return;
    this.flushing = true;
    try {
      while (this.dirty.size) {
        const batch = [...this.dirty].slice(0, 4);
        for (const id of batch) this.dirty.delete(id);
        await Promise.all(batch.map((id) => this.read(id)));
      }
    } finally { this.flushing = false; }
  }

  private async read(playerId: string) {
    if (this.reading.has(playerId)) { this.dirty.add(playerId); return; }
    const acct = wallet.byPlayer(playerId);
    if (!acct && !this.watched.has(playerId)) return;
    this.reading.add(playerId);
    try {
      const pf: PlayerFull = await lcd.player(playerId);
      const P = pf.Player;
      const g = pf.gridAttributes || {};
      const [planet, fleet, sub] = await Promise.all([
        P.planetId ? lcd.planet(P.planetId).catch(() => null) : Promise.resolve(null),
        P.fleetId ? lcd.fleet(P.fleetId).catch(() => null) : Promise.resolve(null),
        // Secondary capacity is the substation's per-connection share, not a grid record of the player.
        P.substationId ? lcd.entity<{ gridAttributes?: { connectionCapacity?: string } }>('substation', P.substationId).catch(() => null) : Promise.resolve(null),
      ]);
      const share = big(sub?.gridAttributes?.connectionCapacity);
      const target = fleet && fleet.status === 'away' && fleet.locationType === 'planet' && fleet.locationId
        ? await lcd.planet(fleet.locationId).catch(() => null) : null;
      const ids = new Set<string>();
      const add = (list?: string[]) => { for (const s of list || []) if (s) ids.add(s); };
      if (planet) { add(planet.Planet.space); add(planet.Planet.air); add(planet.Planet.land); add(planet.Planet.water); }
      if (fleet) { add(fleet.space); add(fleet.air); add(fleet.land); add(fleet.water); if (fleet.commandStruct) ids.add(fleet.commandStruct); }
      const structs = new Map<string, OwnedStruct>();
      const list = [...ids];
      for (let i = 0; i < list.length; i += 8) {
        const chunk = await Promise.all(list.slice(i, i + 8).map((id) => lcd.struct(id).catch(() => null)));
        for (const s of chunk) if (s) { const o = toOwned(s); if (o.typeId) structs.set(o.id, o); }
      }
      const height = live.height || (await lcd.latestHeight().then((r) => r.height).catch(() => 0));
      const st: PlayerState = {
        playerId, account: acct ? acct.index : -1, address: acct ? acct.address : P.primaryAddress,
        name: P.name || playerId, pfp: P.pfpClientRenderAttributes, guildId: P.guildId, substationId: P.substationId,
        planetId: P.planetId, fleetId: P.fleetId,
        alpha: big(pf.playerInventory?.rocks?.amount), ore: num(g.ore),
        load: big(g.load), structsLoad: big(g.structsLoad), capacity: big(g.capacity), connectionCapacity: share,
        lastAction: num(g.lastAction),
        online: big(g.load) + big(g.structsLoad) <= big(g.capacity) + share,
        planet, fleet, target, structs, readAt: Date.now(), readHeight: height,
      };
      // unwatched (or its soulstone forgotten) while the read was in flight: do not keep a stale warden
      if (!wallet.byPlayer(playerId) && !this.watched.has(playerId)) return;
      this.players.set(playerId, st);
      this.own(st);
      // your own wardens are kept for the next visit (a watched one is someone else's business)
      if (acct) void cache.set(keepKey(playerId), st, KEEP_MS, KEEP_NS);
      // Keep the vault's label in step with the chain name.
      if (acct && P.name && acct.label !== P.name && (acct.label === 'Commander' || acct.label === 'Warden' || /^Replicant/.test(acct.label))) wallet.setAccount(acct.index, { label: P.name });
      this.emit();
    } catch (e) {
      console.warn('[empire] read failed', playerId, e);
      await sleep(2000);
    } finally {
      this.reading.delete(playerId);
    }
  }

  /** Every struct across the empire. */
  *allStructs(): Iterable<[PlayerState, OwnedStruct]> {
    for (const p of this.players.values()) for (const s of p.structs.values()) yield [p, s];
  }

  ownerOf(objectId: string): PlayerState | null { const pid = this.owner.get(objectId); return pid ? this.players.get(pid) ?? null : null; }
  /** True when the object belongs to a player this wallet commands (not one we only watch). */
  isMine(objectId: string) { const pid = this.owner.get(objectId) ?? (this.players.has(objectId) ? objectId : undefined); return !!pid && this.commands(pid); }
  /** True for any object we track, watched players included. */
  isTracked(objectId: string) { return this.owner.has(objectId) || this.players.has(objectId); }
}

function toOwned(s: StructFull): OwnedStruct {
  const a = s.structAttributes || {};
  const st = num(a.status);
  const x = a as Record<string, unknown>;
  return {
    id: s.Struct.id, typeId: Number(s.Struct.type), type: typeOf(s.Struct.type),
    locationType: s.Struct.locationType, locationId: s.Struct.locationId, ambit: s.Struct.operatingAmbit, slot: num(s.Struct.slot),
    health: num(a.health), status: st,
    ...flags(st),
    blockStartBuild: num(a.blockStartBuild), blockStartOreMine: num(x.blockStartOreMine as string), blockStartOreRefine: num(x.blockStartOreRefine as string),
    defenders: s.structDefenders || [], protectedStructIndex: num(a.protectedStructIndex), ore: num(s.gridAttributes?.ore),
  };
}

/** A struct status mask as its flags (types/keys.go). */
function flags(st: number) {
  return { materialized: !!(st & 1), built: !!(st & 2), online: !!(st & 4), hidden: !!(st & 16), destroyed: !!(st & 32), locked: !!(st & 64) };
}

/** Object ids an event payload touches. */
export function touchedIds(type: string, d: any): string[] {
  if (!d || typeof d !== 'object') return [];
  const out: string[] = [];
  const push = (v: unknown) => { if (typeof v === 'string' && /^\d+-\d+$/.test(v)) out.push(v); };
  // Each typed event's attribute is its single field, so payloads arrive unwrapped; accept both.
  const u = (k: string) => (d[k] && typeof d[k] === 'object' ? d[k] : d) as any;
  const attrObject = (rec: any) => { const m = /^\d+-(\d+)-(\d+)$/.exec(String(rec?.attributeId ?? '')); if (m) out.push(`${m[1]}-${m[2]}`); };
  switch (type) {
    case 'EventGrid': attrObject(u('gridRecord')); break;
    case 'EventStructAttribute': attrObject(u('structAttributeRecord')); break;
    case 'EventPlanetAttribute': attrObject(u('planetAttributeRecord')); break;
    case 'EventStruct': { const x = u('structure'); push(x.id); push(x.owner); push(x.locationId); break; }
    case 'EventPlanet': { const x = u('planet'); push(x.id); push(x.owner); break; }
    case 'EventFleet': { const x = u('fleet'); push(x.id); push(x.owner); push(x.locationId); break; }
    case 'EventPlayer': push(u('player').id); break;
    case 'EventStructDefender': { const x = u('structDefender'); push(x.protectedStructId); push(x.defendingStructId); break; }
    case 'EventAttack': { const a = u('eventAttackDetail'); push(a.attackerStructId); for (const s of a.eventAttackShotDetail || []) { push(s.targetStructId); push(s.targetPlayerId); } break; }
    case 'EventRaid': { const r = u('eventRaidDetail'); push(r.planetId); push(r.fleetId); break; }
    case 'EventOreMine': case 'EventAlphaRefine': case 'EventOreTheft': {
      const x = u(type === 'EventOreMine' ? 'eventOreMineDetail' : type === 'EventAlphaRefine' ? 'eventAlphaRefineDetail' : 'eventOreTheftDetail');
      push(x.playerId); push(x.victimPlayerId); push(x.thiefPlayerId); break;
    }
    case 'EventHashSuccess': { const x = u('eventHashSuccessDetail'); push(x.objectId); push(x.planetId); break; }
    default:
      for (const v of Object.values(d)) { push(v); if (v && typeof v === 'object') for (const w of Object.values(v as object)) push(w); }
  }
  return out;
}

export const empire = new Empire();
