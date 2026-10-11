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

export async function startApp({ port = 5193, lcdUrl, wsUrl, env = {} } = {}) {
  port = await freePort(port);
  const e = { ...process.env, VITE_LCD_URL: lcdUrl, VITE_RPC_WS_URL: wsUrl, VITE_GRASS_URL: 'off', VITE_RELAY_URL: 'off', VITE_DEFAULT_GUILD: '0-1', BROWSER: 'none', ...env };
  // its own process group, so stopping it takes vite with it, not only the npx wrapper
  const proc = spawn('npx', ['vite', '--port', String(port), '--strictPort', '--host', '127.0.0.1', '--clearScreen', 'false'], { cwd: ROOT, env: e, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let out = '';
  proc.stdout.on('data', (d) => { out += d; if (out.length > 60000) out = out.slice(-30000); });
  proc.stderr.on('data', (d) => { out += d; if (out.length > 60000) out = out.slice(-30000); });
  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 300; i++) {
    if (proc.exitCode != null) throw new Error('vite exited: ' + out.slice(-800));
    try { const r = await fetch(url); if (r.ok) break; } catch { /* not yet */ }
    await sleep(100);
  }
  const killGroup = (sig) => { try { process.kill(-proc.pid, sig); } catch { try { proc.kill(sig); } catch { /* gone */ } } };
  const stop = () => new Promise((r) => { if (proc.exitCode != null) return r(); proc.once('exit', r); killGroup('SIGTERM'); setTimeout(() => { killGroup('SIGKILL'); r(); }, 3000); });
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { killGroup('SIGKILL'); process.exit(130); });
  process.on('exit', () => killGroup('SIGKILL'));
  return { url, proc, logs: () => out, alive: () => proc.exitCode == null, stop };
}
