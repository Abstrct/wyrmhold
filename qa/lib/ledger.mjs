/* A ledger the tests own: the LCD (REST) and the live feed (Tendermint WebSocket) of a small sky,
 * served from memory with deterministic bells. Faults can be injected (down, slow, failing paths),
 * state can be changed between reads, and events can be struck on the live feed at will.
 * No dependencies: the WebSocket server is the few lines of RFC 6455 the client needs. */
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';

const json = (res, status, body, extra = {}) => { const s = JSON.stringify(body); res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'content-length': Buffer.byteLength(s), ...extra }); res.end(s); };
const notFound = (res, what) => json(res, 404, { code: 5, message: `${what} not found`, details: [] });

export class Ledger {
  constructor(world) {
    this.world = world;
    this.faults = { down: false, latencyMs: 0, failPaths: [], failStatus: 503, wsDown: false };
    this.log = [];
    this.sockets = new Set();
    this.txs = new Map();   // hash → { height, raw }
    this.sequences = new Map();
    this.ticking = 0;
    this.onRequest = null;
  }

  async start({ lcdPort = 0, wsPort = 0, blockMs = 1000 } = {}) {
    this.blockMs = blockMs;
    // a client that gives up mid-request (a timeout, a page that navigates away) aborts the socket: that is
    // the client's right, and must never take the mock ledger down with it
    this.http = createServer((req, res) => { this.handle(req, res).catch(() => { try { res.destroy(); } catch { /* gone */ } }); });
    this.http.on('clientError', (_e, socket) => { try { socket.destroy(); } catch { /* gone */ } });
    await new Promise((r) => this.http.listen(lcdPort, '127.0.0.1', r));
    this.lcdPort = this.http.address().port;
    this.wsServer = createServer((req, res) => { res.writeHead(426); res.end(); });
    this.wsServer.on('upgrade', (req, socket) => this.upgrade(req, socket));
    await new Promise((r) => this.wsServer.listen(wsPort, '127.0.0.1', r));
    this.wsPort = this.wsServer.address().port;
    this.lcdUrl = `http://127.0.0.1:${this.lcdPort}`;
    this.wsUrl = `ws://127.0.0.1:${this.wsPort}/websocket`;
    this.ticking = setInterval(() => this.tick(), blockMs);
    return this;
  }
  async stop() {
    clearInterval(this.ticking);
    for (const s of this.sockets) { try { s.destroy(); } catch { /* ignore */ } }
    await Promise.all([new Promise((r) => this.http.close(() => r())), new Promise((r) => this.wsServer.close(() => r()))]);
  }

  /* ── bells ─────────────────────────────────────────────────────────── */
  tick() {
    if (this.paused) return;
    const w = this.world; w.height++;
    for (const t of this.txs.values()) if (!t.height) t.height = w.height;
    if (!this.faults.wsDown) this.broadcast({ jsonrpc: '2.0', id: 1, result: { query: "tm.event='NewBlock'", data: { type: 'tendermint/event/NewBlock', value: { block: { header: { height: String(w.height), time: new Date().toISOString() }, data: { txs: [] } } } } } });
  }
  /** Strike a transaction's events on the live feed, as the node would. */
  emitTx(events, { hash = randomBytes(16).toString('hex').toUpperCase(), signer = '', action = '' } = {}) {
    const evs = events.map((e) => ({ type: 'structs.structs.' + e.type, attributes: [{ key: e.key || Object.keys(e.data || {})[0] || 'detail', value: typeof e.data === 'string' ? e.data : JSON.stringify(e.data) }] }));
    evs.unshift({ type: 'message', attributes: [{ key: 'sender', value: signer }, { key: 'action', value: action }] });
    this.broadcast({ jsonrpc: '2.0', id: 2, result: { query: "tm.event='Tx'", data: { type: 'tendermint/event/Tx', value: { TxResult: { height: String(this.world.height), result: { events: evs } } } }, events: { 'tx.hash': [hash] } } });
  }
  broadcast(msg) { const frame = encodeFrame(JSON.stringify(msg)); for (const s of this.sockets) { try { s.write(frame); } catch { /* gone */ } } }
  /** Drop every live socket (the node went away); clients reconnect on their own. */
  dropSockets() { for (const s of this.sockets) { try { s.destroy(); } catch { /* ignore */ } } this.sockets.clear(); }

  /* ── the live feed ─────────────────────────────────────────────────── */
  upgrade(req, socket) {
    if (this.faults.wsDown) { socket.destroy(); return; }
    const key = req.headers['sec-websocket-key'];
    const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    this.sockets.add(socket);
    let buf = Buffer.alloc(0);
    socket.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        const f = decodeFrame(buf); if (!f) break;
        buf = buf.subarray(f.size);
        if (f.opcode === 8) { socket.end(); break; }
        if (f.opcode === 9) { socket.write(encodeFrame(f.payload, 10)); continue; }
        if (f.opcode === 1) {
          try { const m = JSON.parse(f.payload.toString()); if (m.method === 'subscribe') socket.write(encodeFrame(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: {} }))); } catch { /* ignore */ }
        }
      }
    });
    socket.on('close', () => this.sockets.delete(socket));
    socket.on('error', () => this.sockets.delete(socket));
  }

  /* ── the LCD ───────────────────────────────────────────────────────── */
  async handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const path = url.pathname;
    this.log.push({ method: req.method, path, q: url.search, at: Date.now() });
    if (this.onRequest) this.onRequest(req.method, path);
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' }); res.end(); return; }
    if (this.faults.down) { req.socket.destroy(); return; }
    if (this.faults.latencyMs) await new Promise((r) => setTimeout(r, this.faults.latencyMs));
    if (this.faults.failPaths.some((re) => re.test(path))) return json(res, this.faults.failStatus, { code: 13, message: 'the keeper stumbled', details: [] });
    let body = '';
    if (req.method === 'POST') { try { for await (const c of req) body += c; } catch { return; } }
    try { return this.route(req.method, path, url.searchParams, body, res); }
    catch (e) { return json(res, 500, { code: 2, message: String(e && e.message || e) }); }
  }

  route(method, path, q, body, res) {
    const w = this.world;
    const seg = path.split('/').filter(Boolean);
    const dec = (s) => decodeURIComponent(s || '');
    // guild.json and the mock Guild API live on the same origin
    const mg = /^\/guilds\/([^/]+)\/guild\.json$/.exec(path);
    if (mg) { const g = w.guilds.get(mg[1]); if (!g) return notFound(res, 'guild'); return json(res, 200, { guild: { id: g.id, name: g.meta.name, tag: g.meta.tag, description: g.meta.description, logo: '', website: '', services: { guild_api: `${this.lcdUrl}/guildapi/${g.id}`, grass_nats_websocket: null, matrix: null, explorer: null } } }); }
    const ma = /^\/guildapi\/([^/]+)\/(.*)$/.exec(path);
    if (ma) return this.guildApi(ma[1], ma[2], method, body, res);
    if (seg[0] === 'structs') {
      const [, kind, id] = seg;
      const page = (rows, field) => { const limit = Number(q.get('pagination.limit') || 100), rev = q.get('pagination.reverse') === 'true'; const list = rev ? [...rows].reverse() : rows; return json(res, 200, { [field]: list.slice(0, limit), pagination: { next_key: null, total: String(rows.length) } }); };
      switch (kind) {
        case 'player': if (id) { const p = w.players.get(dec(id)); return p ? json(res, 200, p) : notFound(res, 'player'); } return page([...w.players.values()].map((p) => p.Player).filter((p) => !p.hidden), 'Player');
        case 'planet': { const p = w.planets.get(dec(id)); return p ? json(res, 200, p) : notFound(res, 'planet'); }
        case 'planet_by_player': return json(res, 200, { Planet: [...w.planets.values()].filter((p) => p.Planet.owner === dec(id)).map((p) => p.Planet) });
        case 'fleet': { const f = w.fleets.get(dec(id)); return f ? json(res, 200, { Fleet: f }) : notFound(res, 'fleet'); }
        case 'struct': { const s = w.structs.get(dec(id)); return s ? json(res, 200, s) : notFound(res, 'struct'); }
        case 'guild': if (id) { const g = w.guilds.get(dec(id)); return g ? json(res, 200, { Guild: g.chain }) : notFound(res, 'guild'); } return page([...w.guilds.values()].map((g) => g.chain), 'Guild');
        case 'reactor': if (id) { const r = w.reactors.get(dec(id)); return r ? json(res, 200, r) : notFound(res, 'reactor'); } return page([...w.reactors.values()].map((r) => r.Reactor), 'Reactor');
        case 'substation': { const s = w.substations.get(dec(id)); return s ? json(res, 200, s) : notFound(res, 'substation'); }
        case 'infusion': return page(w.infusions, 'Infusion');
        case 'address': { const a = dec(id); const pid = w.addresses.get(a) || w.anyAddressPlayer; return pid ? json(res, 200, { playerId: pid }) : notFound(res, 'address'); }
        case 'struct_type': return page(w.structTypes, 'StructType');
        case 'grid': {
          const key = q.get('pagination.key') ? Buffer.from(q.get('pagination.key'), 'base64').toString() : '';
          const recs = w.gridRecords.filter((g) => g.attributeId.startsWith(key)).map((g) => ({ attributeId: g.attributeId, value: String(g.value) }));
          return json(res, 200, { gridRecords: recs, pagination: { next_key: null } });
        }
        default: return notFound(res, kind);
      }
    }
    if (path === '/cosmos/base/tendermint/v1beta1/blocks/latest') return json(res, 200, { block: { header: { height: String(w.height), time: new Date().toISOString(), chain_id: w.chainId } } });
    if (path === '/cosmos/base/tendermint/v1beta1/node_info') return json(res, 200, { default_node_info: { network: w.chainId } });
    if (seg[0] === 'cosmos' && seg[1] === 'auth') { const addr = dec(seg[4]); const n = this.sequences.get(addr) || 0; return json(res, 200, { account: { '@type': '/cosmos.auth.v1beta1.BaseAccount', address: addr, account_number: '7', sequence: String(n) } }); }
    if (seg[0] === 'cosmos' && seg[1] === 'bank') return json(res, 200, { balances: [{ denom: 'ualpha', amount: '5000000' }] });
    if (path === '/cosmos/tx/v1beta1/simulate') {
      if (w.refuse) return json(res, 400, { code: 3, message: w.refuse });
      // a rig that plays the chain's part (the arena) may refuse a rite the way the chain would
      if (this.onSimulate) { let raw = ''; try { raw = JSON.parse(body).tx_bytes || ''; } catch { /* ignore */ } const why = this.onSimulate(raw); if (why) return json(res, 400, { code: 2, message: why }); }
      return json(res, 200, { gas_info: { gas_used: '120000' } });
    }
    if (path === '/cosmos/tx/v1beta1/txs' && method === 'POST') {
      let raw = ''; try { raw = JSON.parse(body).tx_bytes || ''; } catch { /* ignore */ }
      const hash = createHash('sha256').update(Buffer.from(raw, 'base64')).digest('hex').toUpperCase();
      this.txs.set(hash, { height: 0, raw, at: Date.now() });
      this.broadcasts = (this.broadcasts || 0) + 1;
      // the signer's sequence moves on; the client keeps its own and re-reads on a mismatch
      const signer = w.lastSigner; if (signer) this.sequences.set(signer, (this.sequences.get(signer) || 0) + 1);
      if (this.onBroadcast) this.onBroadcast(hash, raw);
      return json(res, 200, { tx_response: { code: 0, codespace: '', raw_log: '[]', txhash: hash } });
    }
    const mt = /^\/cosmos\/tx\/v1beta1\/txs\/([0-9A-Fa-f]+)$/.exec(path);
    if (mt) { const t = this.txs.get(mt[1].toUpperCase()); if (!t || !t.height) return json(res, 404, { code: 5, message: `tx not found: ${mt[1]}` }); return json(res, 200, { tx_response: { txhash: mt[1], height: String(t.height), code: t.code || 0, raw_log: t.log || '[]', gas_used: '110000', events: t.events || [] } }); }
    return notFound(res, path);
  }

  /** The mock coven's scribe: enough of the Guild API for the oath. */
  guildApi(gid, rest, method, body, res) {
    const w = this.world;
    const ok = (data) => json(res, 200, { success: true, status: 200, data, errors: {} });
    if (rest === 'api/auth/signup' && method === 'POST') {
      let b = {}; try { b = JSON.parse(body); } catch { /* ignore */ }
      if (w.signupRefuse) return json(res, 400, { success: false, status: 400, data: null, errors: { username: w.signupRefuse } });
      const pid = w.enlist ? w.enlist(b) : null;
      return ok({ player_id: pid, playerId: pid, username: b.username, address: b.address });
    }
    if (rest === 'api/auth/check-username' || /^api\/username\//.test(rest)) return ok({ available: true });
    return ok({});
  }
}

/* ── RFC 6455, the little we need ─────────────────────────────────── */
export function encodeFrame(payload, opcode = 1) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  let head;
  if (data.length < 126) head = Buffer.from([0x80 | opcode, data.length]);
  else if (data.length < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | opcode; head[1] = 126; head.writeUInt16BE(data.length, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x80 | opcode; head[1] = 127; head.writeBigUInt64BE(BigInt(data.length), 2); }
  return Buffer.concat([head, data]);
}
export function decodeFrame(buf) {
  if (buf.length < 2) return null;
  const opcode = buf[0] & 0x0f, masked = !!(buf[1] & 0x80);
  let len = buf[1] & 0x7f, off = 2;
  if (len === 126) { if (buf.length < 4) return null; len = buf.readUInt16BE(2); off = 4; }
  else if (len === 127) { if (buf.length < 10) return null; len = Number(buf.readBigUInt64BE(2)); off = 10; }
  const mask = masked ? buf.subarray(off, off + 4) : null; if (masked) off += 4;
  if (buf.length < off + len) return null;
  const payload = Buffer.from(buf.subarray(off, off + len));
  if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
  return { opcode, payload, size: off + len };
}
