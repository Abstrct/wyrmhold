/* GRASS: a guild's indexer streaming what changed on the ledger, as NATS over a WebSocket.
 * Postgres NOTIFY → structs-grass → NATS, one JSON message per changed row. It needs no sign-in
 * and any origin may connect, so it works from a static build as well as under `vite`.
 *
 * It is a second channel beside the Tendermint feed (live.ts): later (it follows the indexer, a
 * block or so behind), but it says *what* changed — a warden's wildroot, a beast's health, a
 * warband arriving — rather than which transaction ran. Stores use it to patch what they cache
 * instead of reading the whole ledger again.
 *
 * Like the Tendermint feed there is no replay: NATS core delivers at most once, and anything sent
 * while the socket was down is gone. So `onReconnect` fires after every gap, and stores read
 * afresh then. Block heartbeats (`consensus`) are the health signal: the game subjects can be
 * quiet for minutes, the heartbeat never is.
 *
 * Subjects (structs-pg deploy/trigger-grass-*.sql):
 *   consensus                                                  {category:"block", height}
 *   structs.grid.<objectType>.<objectId>.<ownerPlayerId|noPlayer>  {category:<attr>, object_id, value_p, …}
 *   structs.player.<guildId>.<playerId>                        the player row (snake_case)
 *   structs.planet.<planetId>.<ownerPlayerId|noPlayer>         {category, planet_id, player_id, detail:{…}}
 *   structs.inventory.<denom>.<guildId>.<playerId>.<address>   {category:<ledger action>, amount_p, …}
 *   structs.guild.<guildId>, structs.provider.…, structs.agreement.…
 * A row too large for NOTIFY arrives as a stub: {subject, category, id|planet_id, stub:"true"}. */
import { safeEach } from '../core/util';
import type { LinkState } from './live';

export interface GrassMsg {
  subject: string;
  /** The subject split on dots, e.g. ["structs","grid","player","1-3","1-3"]. */
  parts: string[];
  category: string;
  /** The parsed payload. Integers too long for a double arrive as strings. */
  data: any;
  /** The row was too large to send: only its ids came, read the rest yourself. */
  stub: boolean;
}

type Listener<T> = (v: T) => void;

/** Integers beyond 15 digits, quoted before JSON.parse so a NUMERIC (ualpha has 18 places) keeps every digit. */
export function parseGrass(text: string): any {
  return JSON.parse(text.replace(/([:\[,]\s*)(-?\d{16,}(?:\.\d+)?)(?=\s*[,}\]])/g, '$1"$2"'));
}

export function grassMsg(subject: string, text: string): GrassMsg | null {
  let data: any;
  try { data = parseGrass(text); } catch { return null; }
  if (!data || typeof data !== 'object') return null;
  return { subject, parts: subject.split('.'), category: String(data.category ?? ''), data, stub: data.stub === 'true' || data.stub === true };
}

const CRLF = 0x0a;
const enc = new TextEncoder();
const dec = new TextDecoder();

class Grass {
  state: LinkState = 'down';
  /** The newest block the indexer has finished. */
  height = 0;
  url: string | null = null;
  private ws: WebSocket | null = null;
  private backoff = 1000;
  private lastBeat = 0;
  private openedAt = 0;
  private everLive = false;
  private retryT: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private buf = new Uint8Array(0);
  private msgL = new Set<Listener<GrassMsg>>();
  private stateL = new Set<Listener<LinkState>>();
  private reconnectL = new Set<() => void>();

  /** Connect to `url` (a ws:// or wss:// NATS WebSocket), or disconnect with null. Calling again with the same URL does nothing. */
  use(url: string | null) {
    if (url === this.url) return;
    this.url = url;
    this.close();
    this.backoff = 1000;
    if (!url) { this.setState('down'); return; }
    this.connect();
    if (!this.watchdog && typeof window !== 'undefined') {
      // A socket can stay open and carry nothing (a suspended tab, a stuck proxy): silence means recycle.
      this.watchdog = setInterval(() => {
        if (this.state === 'live' && Date.now() - Math.max(this.lastBeat, this.openedAt) > 60_000) this.recycle();
      }, 15_000);
    }
  }

  onMsg(f: Listener<GrassMsg>) { this.msgL.add(f); return () => this.msgL.delete(f); }
  onState(f: Listener<LinkState>) { this.stateL.add(f); f(this.state); return () => this.stateL.delete(f); }
  /** Fires when the stream comes back after a gap: whatever it carried meanwhile is lost, so read afresh. */
  onReconnect(f: () => void) { this.reconnectL.add(f); return () => this.reconnectL.delete(f); }
  get live() { return this.state === 'live'; }

  private setState(s: LinkState) {
    if (s === this.state) return;
    this.state = s;
    safeEach(this.stateL, (f) => f(s));
  }

  private close() {
    if (this.retryT) { clearTimeout(this.retryT); this.retryT = null; }
    const ws = this.ws;
    this.ws = null;
    if (ws) { ws.onclose = null; try { ws.close(); } catch { /* ignore */ } }
  }

  private recycle() { this.close(); this.retry(); }

  private connect() {
    if (!this.url) return;
    this.setState('connecting');
    let ws: WebSocket;
    try { ws = new WebSocket(this.url); } catch { this.retry(); return; }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    this.buf = new Uint8Array(0);
    this.openedAt = Date.now();
    let greeted = false;
    ws.onmessage = (m) => {
      if (this.ws !== ws) return;
      const chunk = typeof m.data === 'string' ? enc.encode(m.data) : new Uint8Array(m.data as ArrayBuffer);
      const joined = new Uint8Array(this.buf.length + chunk.length);
      joined.set(this.buf); joined.set(chunk, this.buf.length);
      this.buf = joined;
      this.drain(ws, () => {
        if (greeted) return;
        greeted = true;
        // headers off, verbose off: the server answers only MSG, PING and -ERR
        ws.send('CONNECT {"verbose":false,"pedantic":false,"headers":false,"lang":"wyrmhold","version":"1","protocol":1,"name":"wyrmhold"}\r\nSUB consensus 1\r\nSUB structs.> 2\r\nPING\r\n');
      });
    };
    ws.onerror = () => { /* onclose follows */ };
    ws.onclose = () => { if (this.ws === ws) { this.ws = null; this.retry(); } };
  }

  /** Read every whole protocol line (and MSG payload) in the buffer. */
  private drain(ws: WebSocket, onInfo: () => void) {
    let at = 0;
    const b = this.buf;
    while (at < b.length) {
      const nl = b.indexOf(CRLF, at);
      if (nl < 0) break;
      const line = dec.decode(b.subarray(at, nl)).replace(/\r$/, '');
      if (line.startsWith('MSG ')) {
        // MSG <subject> <sid> [reply-to] <#bytes>
        const f = line.split(' ');
        const len = Number(f[f.length - 1]);
        if (!(len >= 0) || nl + 1 + len + 2 > b.length) break;   // the payload hasn't all come yet
        const body = dec.decode(b.subarray(nl + 1, nl + 1 + len));
        at = nl + 1 + len + 2;
        this.deliver(f[1], body);
        continue;
      }
      at = nl + 1;
      if (line.startsWith('INFO')) onInfo();
      else if (line === 'PING') { try { ws.send('PONG\r\n'); } catch { /* closing */ } }
      else if (line === 'PONG') {
        // the server took our subscriptions
        this.lastBeat = Date.now();
        this.setState('live');
        if (this.everLive) safeEach(this.reconnectL, (f) => f());
        this.everLive = true;
      } else if (line.startsWith('-ERR')) {
        console.warn('[grass] refused:', line.slice(4).trim());
        this.recycle();
        return;
      }
    }
    this.buf = at >= b.length ? new Uint8Array(0) : b.slice(at);
  }

  private deliver(subject: string, body: string) {
    const m = grassMsg(subject, body);
    if (!m) return;
    if (subject === 'consensus') {
      const h = Number(m.data.height);
      if (h > 0) { this.height = Math.max(this.height, h); this.lastBeat = Date.now(); this.backoff = 1000; }
    }
    safeEach(this.msgL, (f) => f(m));
  }

  private retry() {
    if (!this.url) return;
    this.setState('down');
    const wait = this.backoff;
    this.backoff = Math.min(this.backoff * 2, 30_000);
    if (this.retryT) clearTimeout(this.retryT);
    this.retryT = setTimeout(() => { this.retryT = null; this.connect(); }, wait);
  }
}

export const grass = new Grass();

/* ── Reading a message ─────────────────────────────────────────────────── */

const ID = /^\d+-\d+$/;

/** A grid value as GRASS reports it: the attribute, whose it is, and the raw ledger value (string). */
export function grassGrid(m: GrassMsg): { objectType: string; objectId: string; owner: string | null; attr: string; value: string } | null {
  if (m.parts[1] !== 'grid' || m.parts.length < 4) return null;
  const objectId = String(m.data.object_id ?? m.parts[3]);
  if (!ID.test(objectId)) return null;
  const attr = String(m.data.attribute_type ?? m.category);
  // value_p is the ledger's own number; `value` is a rounded display unit for some attributes
  const raw = m.data.value_p ?? m.data.value;
  if (raw == null || !/^-?\d+(\.\d+)?$/.test(String(raw))) return null;
  const owner = String(m.data.player_id ?? m.parts[4] ?? '');
  return { objectType: String(m.data.object_type ?? m.parts[2]), objectId, owner: ID.test(owner) ? owner : null, attr, value: String(raw).split('.')[0] };
}

/** Every ledger object id a message touches (the player, planet, warband, beasts), for routing. */
export function grassTouches(m: GrassMsg): string[] {
  const out = new Set<string>();
  const push = (v: unknown) => { if (typeof v === 'string' && ID.test(v)) out.add(v); };
  const d = m.data || {};
  switch (m.parts[1]) {
    case 'grid': push(d.object_id ?? m.parts[3]); push(d.player_id ?? m.parts[4]); break;
    case 'player': push(d.id ?? m.parts[3]); push(d.planet_id); push(d.fleet_id); break;
    case 'planet': {
      push(d.planet_id ?? m.parts[2]); push(d.player_id ?? m.parts[3]);
      const x = d.detail && typeof d.detail === 'object' ? d.detail : {};
      for (const k of ['fleet_id', 'struct_id', 'planet_id', 'defender_struct_id', 'protected_struct_id']) push(x[k]);
      for (const f of Array.isArray(x.fleet_list) ? x.fleet_list : []) push(f);
      // struct_attack carries the ledger's own EventAttack, camelCase
      const a = x.eventAttackDetail ?? x;
      push(a.attackerStructId);
      for (const s of Array.isArray(a.eventAttackShotDetail) ? a.eventAttackShotDetail : []) { push(s?.targetStructId); push(s?.targetPlayerId); }
      break;
    }
    case 'inventory': push(d.player_id ?? m.parts[4]); push(d.counterparty_player_id); break;
    default: break;
  }
  return [...out];
}
