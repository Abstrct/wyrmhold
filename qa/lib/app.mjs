/* The game under test: Vite serving src/ against the mock ledger, on its own port. */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

import { createServer } from 'node:net';

/** A port nobody is listening on, starting from `from`: a stale server must never answer for the game under test. */
async function freePort(from) {
  for (let p = from; p < from + 200; p++) {
    const ok = await new Promise((res) => { const s = createServer(); s.once('error', () => res(false)); s.listen(p, '127.0.0.1', () => s.close(() => res(true))); });
    if (ok) return p;
  }
  throw new Error('no free port from ' + from);
}

export async function startApp({ port, lcdUrl, wsUrl, env = {} } = {}) {
  // a caller that names its port (the arena's launch config) gets it if it is free; the runner's default jitters
  const asked = port != null;
  port = port ?? 5193;
  // Runs started together (other worktrees, other sessions) can race for the same free port: a port is
  // ours only when our own Vite says it serves there. If Vite cannot bind it, try again further along.
  let last = '';
  for (let attempt = 0; attempt < 5; attempt++) {
    const app = await tryStart(await freePort(asked && attempt === 0 ? port : port + attempt * 7 + Math.floor(Math.random() * 40)), { lcdUrl, wsUrl, env });
    if (app.url) return app;
    last = app.error;
  }
  throw new Error('vite would not start: ' + last);
}

async function tryStart(port, { lcdUrl, wsUrl, env }) {
  const e = { ...process.env, VITE_LCD_URL: lcdUrl, VITE_RPC_WS_URL: wsUrl, VITE_GRASS_URL: 'off', VITE_RELAY_URL: 'off', VITE_DEFAULT_GUILD: '0-1', BROWSER: 'none', ...env };
  // its own process group, so stopping it takes vite with it, not only the npx wrapper
  const proc = spawn('npx', ['vite', '--port', String(port), '--strictPort', '--host', '127.0.0.1', '--clearScreen', 'false'], { cwd: ROOT, env: e, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let out = '';
  proc.stdout.on('data', (d) => { out += d; if (out.length > 60000) out = out.slice(-30000); });
  proc.stderr.on('data', (d) => { out += d; if (out.length > 60000) out = out.slice(-30000); });
  const url = `http://127.0.0.1:${port}/`;
  const killGroup = (sig) => { try { process.kill(-proc.pid, sig); } catch { try { proc.kill(sig); } catch { /* gone */ } } };
  let ready = false;
  for (let i = 0; i < 300 && !ready; i++) {
    if (proc.exitCode != null) return { error: out.slice(-800) };
    // another run's server may answer on this port: only our own Vite's banner makes it ours
    if (out.includes(`:${port}/`)) { try { const r = await fetch(url); if (r.ok) ready = true; } catch { /* not yet */ } }
    if (!ready) await sleep(100);
  }
  if (!ready) { killGroup('SIGKILL'); return { error: 'no answer on ' + url + ': ' + out.slice(-400) }; }
  const stop = () => new Promise((r) => { if (proc.exitCode != null) return r(); proc.once('exit', r); killGroup('SIGTERM'); setTimeout(() => { killGroup('SIGKILL'); r(); }, 3000); });
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { killGroup('SIGKILL'); process.exit(130); });
  process.on('exit', () => killGroup('SIGKILL'));
  return { url, proc, logs: () => out, alive: () => proc.exitCode == null, stop };
}
