/* A small WebSocket client over a plain TCP socket, for the Firefox driver. Node's built-in WebSocket closed every
 * BiDi connection the runner opened about fourteen minutes into a full run (code 1006, within 200 ms of opening),
 * while a second process reached the same Firefox at once; this one has no shared state between connections, and
 * says who closed a socket and why. It speaks the subset the driver uses: text frames in and out, ping/pong,
 * close, and the event-handler properties of the browser's WebSocket (onopen, onmessage, onclose, onerror). */
import { connect } from 'node:net';
import { randomBytes } from 'node:crypto';

export class MiniSocket {
  constructor(url) {
    const u = new URL(url);
    this.onopen = this.onmessage = this.onclose = this.onerror = null;
    this.open = false; this.closed = false;
    this.buf = Buffer.alloc(0); this.parts = [];
    this.sock = connect({ host: u.hostname, port: Number(u.port) });
    this.sock.setNoDelay(true);
    const key = randomBytes(16).toString('base64');
    this.sock.on('connect', () => this.sock.write(`GET ${u.pathname}${u.search} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`));
    this.sock.on('data', (d) => this.data(d));
    this.sock.on('error', (e) => { this.why = `socket error: ${e.code || e.message}`; if (!this.open) this.onerror?.({ message: this.why }); });
    this.sock.on('end', () => { this.why ||= 'the other end closed the connection without a close frame'; });
    this.sock.on('close', () => this.finish(1006, this.why || 'connection lost'));
  }
  data(d) {
    this.buf = Buffer.concat([this.buf, d]);
    if (!this.open) {
      const end = this.buf.indexOf('\r\n\r\n');
      if (end < 0) return;
      const head = this.buf.subarray(0, end).toString();
      this.buf = this.buf.subarray(end + 4);
      if (!/^HTTP\/1\.1 101/.test(head)) { this.why = 'refused: ' + head.split('\r\n')[0]; this.onerror?.({ message: this.why }); this.sock.destroy(); return; }
      this.open = true;
      this.onopen?.({});
    }
    // frames from a server are never masked
    for (;;) {
      if (this.buf.length < 2) return;
      const fin = this.buf[0] & 0x80, op = this.buf[0] & 0x0f;
      let len = this.buf[1] & 0x7f, at = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); at = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); at = 10; }
      if (this.buf.length < at + len) return;
      const payload = this.buf.subarray(at, at + len);
      this.buf = this.buf.subarray(at + len);
      if (op === 8) { const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005; this.frame(8, payload.subarray(0, 2)); this.why = 'closed by the other end'; this.finish(code, payload.subarray(2).toString()); this.sock.end(); return; }
      if (op === 9) { this.frame(10, payload); continue; }
      if (op === 10) continue;
      this.parts.push(Buffer.from(payload));
      if (fin) { const text = Buffer.concat(this.parts).toString('utf8'); this.parts = []; this.onmessage?.({ data: text }); }
    }
  }
  /** One masked frame, as a client must send. */
  frame(op, payload) {
    if (this.sock.destroyed) return;
    const n = payload.length, mask = randomBytes(4);
    const head = n < 126 ? Buffer.from([0x80 | op, 0x80 | n]) : n < 65536 ? Buffer.from([0x80 | op, 0x80 | 126, n >> 8, n & 255]) : Buffer.concat([Buffer.from([0x80 | op, 0x80 | 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; })()]);
    const body = Buffer.from(payload);
    for (let i = 0; i < n; i++) body[i] ^= mask[i & 3];
    this.sock.write(Buffer.concat([head, mask, body]));
  }
  send(text) { if (!this.open || this.closed) throw new Error('socket not open'); this.frame(1, Buffer.from(String(text), 'utf8')); }
  close(code = 1000, reason = '') {
    if (this.closed) return;
    const p = Buffer.alloc(2 + Buffer.byteLength(reason)); p.writeUInt16BE(code, 0); p.write(reason, 2);
    this.frame(8, p);
    this.why = `closed by us (${code}${reason ? ' ' + reason : ''})`;
    this.finish(code, reason);
    setTimeout(() => this.sock.destroy(), 200);
  }
  finish(code, reason) { if (this.closed) return; this.closed = true; this.open = false; this.onclose?.({ code, reason, why: this.why }); }
}
