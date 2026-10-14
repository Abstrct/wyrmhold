/* What other wardens did to your hold: blows struck at your beasts, raids on your isle with every stage
 * the ledger tells of them (a warband came, the ward broke, the plunder landed, the raid broke, they rode
 * home), and your beasts that fell. Heard live from the node's feed, and read back from the node's search
 * of past rites when the warden arrives and when they come back to the page, so a raid that landed while
 * they were away is never lost.
 *
 * Kept per warden in this browser (localStorage, newest few hundred), with the last bell the search read
 * up to, so each search asks only for what came after. Every deed is known by its rite's mark and its
 * place in that rite, so the live feed and the search, which overlap, never tell one twice. */
import { live, type ChainTxEvent } from '../chain/live';
import { LCD_URL, lcd } from '../chain/lcd';
import { empire } from './empire';
import { wallet } from '../wallet/wallet';
import { safeEach } from '../core/util';
import { STRUCT_TYPES } from '../data/catalogue';

export type RaidStage = 'initiated' | 'shieldsVulnerable' | 'raidSuccessful' | 'attackerDefeated' | 'attackerRetreated';

export interface Harm {
  /** The rite's mark and the deed's place in it: the same in the live feed and the search. */
  key: string;
  /** Which of our wardens it was done to. */
  pid: string;
  kind: 'blow' | 'raid';
  height: number;
  /** When (ms): the ledger's time for a deed read back, the moment it was heard for a live one. */
  at: number;
  /** The other warden: the striker, or the raider. Unknown until resolved for some raids. */
  foe?: string;
  /* a blow: the striker's kind, our beast's kind (and mark), what it did */
  by?: number;
  target?: number;
  targetId?: string;
  damage?: number;
  evaded?: boolean;
  fell?: boolean;
  /** Hearts our beast has left. */
  left?: number;
  /** One of our guards stepped in: its kind, and whether it fell doing so. */
  guard?: number;
  guardId?: string;
  guardFell?: boolean;
  /** Our beast struck theirs and fell to its answer (we struck; `by` is theirs, `target` ours). */
  answered?: boolean;
  /* a raid on our isle */
  stage?: RaidStage;
  fleetId?: string;
  isle?: string;
  /** Sheaves of wildroot carried off. */
  seized?: number;
}

interface Book {
  v: 1;
  /** The bell the search has read up to (0: never searched). */
  height: number;
  list: Harm[];
  /** Names of the wardens in the list, kept so a closed page still knows who it was. */
  names: Record<string, string>;
  /** Warbands we have learned the warden of. */
  fleets: Record<string, string>;
}

const PREFIX = 'wyrmhold.raidlog.';
const MAX = 300;
const books = new Map<string, Book>();
const changeL = new Set<(pid: string) => void>();
const harmL = new Set<(h: Harm, heardLive: boolean) => void>();

/** Hear when a warden's record changes (a deed added); '' when a warden named in it is learned. */
export function onRaidlog(f: (pid: string) => void) { changeL.add(f); return () => { changeL.delete(f); }; }
/** Hear each new deed as it is recorded; `heardLive` is true when it came on the live feed just now. */
export function onHarm(f: (h: Harm, heardLive: boolean) => void) { harmL.add(f); return () => { harmL.delete(f); }; }
const changed = (pid: string) => safeEach(changeL, (f) => f(pid));

function load(pid: string): Book {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFIX + pid) || 'null') as Book | null;
    if (raw && raw.v === 1 && Array.isArray(raw.list)) return { v: 1, height: Number(raw.height) || 0, list: raw.list, names: raw.names || {}, fleets: raw.fleets || {} };
  } catch { /* a record that will not read starts afresh */ }
  return { v: 1, height: 0, list: [], names: {}, fleets: {} };
}
function book(pid: string): Book {
  let b = books.get(pid);
  if (!b) { b = load(pid); books.set(pid, b); }
  return b;
}
/** Write a warden's record, folding in whatever another tab wrote meanwhile. */
function save(pid: string) {
  const b = book(pid);
  const other = load(pid);
  const keys = new Set(b.list.map((h) => h.key));
  for (const h of other.list) if (!keys.has(h.key)) b.list.push(h);
  b.list.sort(newestFirst);
  if (b.list.length > MAX) b.list.length = MAX;
  b.height = Math.max(b.height, other.height);
  b.names = { ...other.names, ...b.names };
  b.fleets = { ...other.fleets, ...b.fleets };
  try { localStorage.setItem(PREFIX + pid, JSON.stringify(b)); } catch { /* storage full or refused: this visit still remembers */ }
}
const newestFirst = (a: Harm, b: Harm) => b.height - a.height || b.at - a.at || (a.key < b.key ? 1 : a.key > b.key ? -1 : 0);

/** Every deed done to this warden that this browser knows of, newest first. */
export function harms(pid: string): Harm[] { return book(pid).list; }

/** The name a warden goes by ("" for one who never took a name), if known; asked of the ledger if not. */
export function knownName(pid: string): string | undefined {
  const held = empire.players.get(pid);
  if (held) return held.name && held.name !== pid ? held.name : '';
  const f = foes.get(pid);
  if (f) return f.name;
  for (const b of books.values()) if (pid in b.names) return b.names[pid];
  learn(pid);
  return undefined;
}

/* ── Who they are: names and isles of the wardens in the record ───────── */

const foes = new Map<string, { name: string; isle: string; at: number }>();
const asking = new Set<string>();
/** Wardens the ledger would not tell us of just now: not asked again for a minute (screens ask on every paint). */
const missed = new Map<string, number>();
/** Whether a warden still holds an isle (null: not known yet; asked for, and the record changes when it lands). */
export function foeHoldsIsle(pid: string): boolean | null {
  const p = empire.players.get(pid);
  if (p && !p.restored) return !!p.planetId;
  const f = foes.get(pid);
  if (f && Date.now() - f.at < 120_000) return !!f.isle;
  learn(pid);
  return f ? !!f.isle : null;
}
/** Read a warden's name and isle from the ledger (at most once every two minutes). */
function learn(pid: string) {
  if (asking.has(pid) || !/^1-\d+$/.test(pid) || Date.now() - (missed.get(pid) || 0) < 60_000) return;
  const f = foes.get(pid);
  if (f && Date.now() - f.at < 120_000) return;
  asking.add(pid);
  lcd.player(pid).then((r) => {
    const name = r.Player.name && r.Player.name !== pid ? r.Player.name : '';
    const was = foes.get(pid);
    foes.set(pid, { name, isle: r.Player.planetId || '', at: Date.now() });
    if (!was || was.name !== name || was.isle !== (r.Player.planetId || '')) {
      for (const [owner, b] of books) if (b.list.some((h) => h.foe === pid)) { b.names[pid] = name; save(owner); }
      // '' : a name or an isle learned, for whoever shows it
      changed('');
    }
  }, () => { missed.set(pid, Date.now()); }).finally(() => asking.delete(pid));
}

/** The warden a warband belongs to: from what the rite itself says, else the ledger (never guessed from its mark). */
function fleetOwnerIn(events: ChainTxEvent[], fleetId: string): string | undefined {
  for (const e of events) {
    if (e.type === 'EventFleet') { const f = unwrap(e, 'fleet') as { id?: string; owner?: string } | null; if (f?.id === fleetId && f.owner) return f.owner; }
  }
  for (const e of events) {
    if (e.type === 'EventOreTheft') { const t = unwrap(e, 'eventOreTheftDetail') as { thiefPlayerId?: string } | null; if (t?.thiefPlayerId) return t.thiefPlayerId; }
    if (e.type === 'EventAttack') {
      const a = unwrap(e, 'eventAttackDetail') as AttackDetail | null;
      if (!a) continue;
      if (a.attackerStructLocationId === fleetId && a.attackerPlayerId) return a.attackerPlayerId;
      for (const s of a.eventAttackShotDetail || []) if (s.targetStructLocationId === fleetId && s.targetPlayerId) return s.targetPlayerId;
    }
  }
  return undefined;
}
const resolving = new Set<string>();
function resolveFleet(pid: string, fleetId: string) {
  if (resolving.has(fleetId)) return;
  resolving.add(fleetId);
  lcd.fleet(fleetId).then((f) => {
    if (!f?.owner) return;
    for (const [owner, b] of books) {
      let hit = false;
      b.fleets[fleetId] = f.owner;
      for (const h of b.list) if (h.fleetId === fleetId && !h.foe) { h.foe = f.owner; hit = true; }
      if (hit || owner === pid) { save(owner); changed(owner); }
    }
    learn(f.owner);
  }, () => { /* asked again on the next search */ }).finally(() => resolving.delete(fleetId));
}

/* ── Reading deeds out of a rite's events ──────────────────────────────── */

interface Shot {
  targetStructId?: string; targetPlayerId?: string; targetStructTypeId?: string; targetStructType?: string; targetStructLocationId?: string;
  evaded?: boolean; evadedByPlanetaryDefenses?: boolean; blocked?: boolean; blockedByStructId?: string; blockedByStructTypeId?: string; blockedByStructType?: string; blockerDestroyed?: boolean;
  damage?: string; damageDealt?: string; targetDestroyed?: boolean; targetHealthAfter?: string;
  targetCounterDestroyedAttacker?: boolean; postDestructionDamageDestroyedAttacker?: boolean;
}
interface AttackDetail {
  attackerStructId?: string; attackerStructTypeId?: string; attackerStructType?: string; attackerStructLocationId?: string; attackerPlayerId?: string;
  eventAttackShotDetail?: Shot[]; recoilDamageDestroyedAttacker?: boolean; planetaryDefenseCannonDamageDestroyedAttacker?: boolean;
}
interface RaidDetail { fleetId?: string; planetId?: string; status?: string; seized_ore?: string; seizedOre?: string }

/** A beast's kind by its number, or (a ledger that sends only the name) by the ledger's name for it. */
const kindOf = (id?: string, name?: string) => Number(id) || (name ? Number(STRUCT_TYPES.find((t) => t.type === name)?.id) || 0 : 0);
const unwrap = (e: ChainTxEvent, key: string): unknown => (e.data && typeof e.data === 'object' && key in e.data ? e.data[key] : e.data);
const STAGES: RaidStage[] = ['initiated', 'shieldsVulnerable', 'raidSuccessful', 'attackerDefeated', 'attackerRetreated'];

/** Ours: the wardens this soulstone commands, their isles and their warbands. */
function ourSide() {
  const ids = new Set(wallet.playerIds());
  const isles = new Map<string, string>(), fleets = new Set<string>();
  for (const id of ids) {
    const p = empire.players.get(id);
    if (p?.planetId) isles.set(p.planetId, id);
    if (p?.fleetId) fleets.add(p.fleetId);
  }
  return { ids, isles, fleets };
}

/** The deeds done to our wardens in one rite. `hash` and the order of its events name each one. */
function deedsIn(events: ChainTxEvent[], hash: string, height: number, at: number, side = ourSide()): Harm[] {
  const out: Harm[] = [];
  const tag = hash || `bell${height}`;
  const n: Record<string, number> = {};
  for (const e of events) {
    const i = (n[e.type] = (n[e.type] ?? -1) + 1);
    if (e.type === 'EventAttack') {
      const a = unwrap(e, 'eventAttackDetail') as AttackDetail | null;
      if (!a || typeof a !== 'object') continue;
      const striker = a.attackerPlayerId || '';
      const by = kindOf(a.attackerStructTypeId, a.attackerStructType);
      const shots = a.eventAttackShotDetail || [];
      shots.forEach((s, k) => {
        if (!s.targetPlayerId || !side.ids.has(s.targetPlayerId) || side.ids.has(striker)) return;
        out.push({
          key: `${tag}:A${i}:${k}`, pid: s.targetPlayerId, kind: 'blow', height, at, foe: striker || undefined, by,
          target: kindOf(s.targetStructTypeId, s.targetStructType), targetId: s.targetStructId,
          damage: Number(s.damage ?? s.damageDealt ?? 0) || 0, evaded: !!(s.evaded || s.evadedByPlanetaryDefenses), fell: !!s.targetDestroyed,
          left: s.targetHealthAfter == null ? undefined : Number(s.targetHealthAfter),
          ...(s.blocked && (Number(s.blockedByStructTypeId) || s.blockedByStructType) ? { guard: kindOf(s.blockedByStructTypeId, s.blockedByStructType), guardId: s.blockedByStructId, guardFell: !!s.blockerDestroyed } : {}),
        });
      });
      // one of ours struck and fell to what answered it (a counter-blow, a recoil, the isle's guns)
      if (side.ids.has(striker)) {
        const fellBy = shots.find((s) => s.targetCounterDestroyedAttacker || s.postDestructionDamageDestroyedAttacker);
        const dead = fellBy || a.recoilDamageDestroyedAttacker || a.planetaryDefenseCannonDamageDestroyedAttacker;
        const other = shots.find((s) => s.targetPlayerId && !side.ids.has(s.targetPlayerId));
        if (dead && other) out.push({ key: `${tag}:A${i}:x`, pid: striker, kind: 'blow', height, at, foe: other.targetPlayerId, by: kindOf(other.targetStructTypeId, other.targetStructType), target: by, targetId: a.attackerStructId, fell: true, answered: true });
      }
    } else if (e.type === 'EventRaid') {
      const d = unwrap(e, 'eventRaidDetail') as RaidDetail | null;
      if (!d?.planetId || !d.status) continue;
      const pid = side.isles.get(d.planetId);
      if (!pid || (d.fleetId && side.fleets.has(d.fleetId))) continue;
      const stage = (STAGES as string[]).includes(d.status) ? (d.status as RaidStage) : null;
      if (!stage) continue;
      const theft = events.find((x) => x.type === 'EventOreTheft');
      const seized = Number(d.seized_ore ?? d.seizedOre ?? (theft ? (unwrap(theft, 'eventOreTheftDetail') as { amount?: string })?.amount : 0) ?? 0) || 0;
      const foe = (d.fleetId && (fleetOwnerIn(events, d.fleetId) || book(pid).fleets[d.fleetId])) || undefined;
      out.push({ key: `${tag}:R${i}:${stage}`, pid, kind: 'raid', height, at, foe, stage, fleetId: d.fleetId, isle: d.planetId, seized });
    }
  }
  return out;
}

/** Add deeds to the record; the new ones are told to every listener. */
function record(found: Harm[], heardLive: boolean): Harm[] {
  const byPid = new Map<string, Harm[]>();
  for (const h of found) { const l = byPid.get(h.pid) || []; l.push(h); byPid.set(h.pid, l); }
  const fresh: Harm[] = [];
  for (const [pid, list] of byPid) {
    const b = book(pid);
    const known = new Set(b.list.map((h) => h.key));
    const add = list.filter((h) => !known.has(h.key));
    if (!add.length) continue;
    for (const h of add) {
      if (h.foe) { const nm = knownName(h.foe); if (nm != null) b.names[h.foe] = nm; else learn(h.foe); }
      if (h.fleetId && h.foe) b.fleets[h.fleetId] = h.foe;
      if (h.kind === 'raid' && !h.foe && h.fleetId) resolveFleet(pid, h.fleetId);
    }
    b.list.push(...add);
    b.list.sort(newestFirst);
    if (b.list.length > MAX) b.list.length = MAX;
    save(pid);
    fresh.push(...add);
    changed(pid);
  }
  for (const h of fresh.sort((a, b) => a.height - b.height)) safeEach(harmL, (f) => f(h, heardLive));
  return fresh;
}

/* ── Reading back: the node's search of past rites ─────────────────────── */

interface TxResponse { height: string; txhash: string; timestamp?: string; code?: number; events?: { type: string; attributes?: { key: string; value: string }[] }[] }

/** The node's events of one rite, as the live feed gives them (typed events only, payloads parsed). */
function typedEvents(t: TxResponse): ChainTxEvent[] {
  const out: ChainTxEvent[] = [];
  for (const e of t.events || []) {
    if (!String(e.type).startsWith('structs.structs.')) continue;
    const attr = (e.attributes || []).find((a) => a.key !== 'msg_index');
    let payload: unknown = null;
    if (attr) { try { payload = JSON.parse(attr.value); } catch { payload = attr.value; } }
    out.push({ type: e.type.slice('structs.structs.'.length), data: payload });
  }
  return out;
}

/** One search, newest first, up to `pages` pages of 100. Throws if the first page cannot be read. */
async function search(query: string, pages: number): Promise<TxResponse[]> {
  const out: TxResponse[] = [];
  for (let page = 1; page <= pages; page++) {
    // newer nodes page with page/limit and ignore pagination.*; older ones the other way round
    const url = `${LCD_URL}/cosmos/tx/v1beta1/txs?query=${encodeURIComponent(query)}&order_by=ORDER_BY_DESC&page=${page}&limit=100&pagination.limit=100`;
    // generous: a page busy waking its sky may hear the answer late
    const r = await fetch(url, { signal: AbortSignal.timeout(45000) });
    if (!r.ok) { if (page === 1) throw new Error(`the ledger answered ${r.status}`); break; }
    const body = await r.json() as { tx_responses?: TxResponse[]; total?: string };
    const rows = body.tx_responses || [];
    out.push(...rows);
    if (rows.length < 100 || Number(body.total || 0) <= page * 100) break;
  }
  return out;
}

const reading = new Map<string, Promise<boolean>>();
/** Read back what was done to a warden since the last search (on a first search, the newest few hundred).
 * True once the ledger has answered. */
export function backfill(pid: string): Promise<boolean> {
  const running = reading.get(pid);
  if (running) return running;
  const p = (async () => {
    const b = book(pid);
    const since = b.height;
    const top = live.height || (await lcd.latestHeight().then((r) => r.height).catch(() => 0));
    const isle = empire.players.get(pid)?.planetId;
    const bound = since > 0 ? ` AND tx.height>${since}` : '';
    const queries = [`structs.structs.EventAttack.eventAttackDetail CONTAINS '"targetPlayerId":"${pid}"'${bound}`];
    if (isle) queries.push(`structs.structs.EventRaid.eventRaidDetail CONTAINS '"planetId":"${isle}"'${bound}`);
    const pages = since > 0 ? 3 : 1;
    const rows = (await Promise.all(queries.map((q) => search(q, pages)))).flat();
    const side = ourSide();
    // a backfill may run before the empire knows the isle's warden: say whose it is
    if (isle) side.isles.set(isle, pid);
    side.ids.add(pid);
    const found: Harm[] = [];
    for (const t of rows) {
      if (t.code) continue;
      const at = t.timestamp ? Date.parse(t.timestamp) || Date.now() : Date.now();
      found.push(...deedsIn(typedEvents(t), t.txhash, Number(t.height) || 0, at, side).filter((h) => h.pid === pid));
    }
    record(found, false);
    // the indexer may trail the newest bell by a little: read the last few again next time (repeats are known)
    if (top > 0) { b.height = Math.max(b.height, top - 5); save(pid); }
    return true;
  })().catch((e) => {
    console.warn('[raidlog] reading back failed', pid, e);
    // ask again in a while (the next change in the empire starts it)
    setTimeout(() => { if (visits.get(pid) === p) visits.delete(pid); }, 20_000);
    return false;
  }).finally(() => reading.delete(pid));
  reading.set(pid, p);
  return p;
}

/* ── Following ──────────────────────────────────────────────────────────── */

/** This visit's reading back of each warden (made again after a gap in the feed or a long absence). */
const visits = new Map<string, Promise<boolean>>();
/** Read a warden back once this visit; later callers share that reading (true once the ledger answered). */
export function readBackOnce(pid: string): Promise<boolean> {
  let p = visits.get(pid);
  if (!p) { p = backfill(pid); visits.set(pid, p); }
  return p;
}
/** Read every warden back again (the feed was away, or the warden has come back to the page after a while). */
export function readAgain(): Promise<void> {
  visits.clear();
  return Promise.all(wallet.playerIds().filter((pid) => empire.players.get(pid)).map(readBackOnce)).then(() => undefined);
}

let started = false;
/** Hear deeds live, and read back each of our wardens once the empire knows them (and again after a gap). */
export function followRaidlog() {
  if (started) return;
  started = true;
  live.onTx((tx) => { record(deedsIn(tx.events, tx.hash, tx.height, Date.now()), true); });
  empire.onChange(() => { for (const pid of wallet.playerIds()) if (!visits.has(pid) && empire.players.get(pid)) void readBackOnce(pid); });
  // the feed was away: whatever passed then is only in the search
  live.onReconnect(() => { void readAgain(); });
  // another tab heard something: take its record
  window.addEventListener('storage', (e) => {
    if (!e.key?.startsWith(PREFIX)) return;
    const pid = e.key.slice(PREFIX.length);
    if (!books.has(pid)) return;
    books.set(pid, load(pid));
    changed(pid);
  });
  wallet.onForget(() => {
    books.clear(); visits.clear();
    try { for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX)) localStorage.removeItem(k); } catch { /* ignore */ }
  });
}

/** For the proving ground's logic suite: the reading of one rite's events. */
export const __deeds = (events: ChainTxEvent[], hash: string, height: number, ids: string[], isles: Record<string, string> = {}) =>
  deedsIn(events, hash, height, 0, { ids: new Set(ids), isles: new Map(Object.entries(isles)), fleets: new Set() });
