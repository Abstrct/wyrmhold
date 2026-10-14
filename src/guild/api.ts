/* Reading the ledger through a guild's own API (the structs-webapp Symfony app over the guild's
 * indexed Postgres) rather than the ledger node. One request answers what the node needs dozens
 * for — every warband in an isle's sky, every wellspring's grid, a warden's tithes — and it can
 * filter, which the node cannot.
 *
 * Its limits shape how this module is used:
 *  - Nearly every read needs a signed-in session (a PHP session cookie, SameSite=Lax). Guilds answer
 *    cross-site calls with `Access-Control-Allow-Origin: *`, which browsers refuse to pair with
 *    cookies, so a session lives only in the relay's cookie jar (src/guild/relay.ts). A build with
 *    no relay reads the ledger node instead.
 *  - A guild signs in only its own members: the session is the commander's, at the commander's
 *    guild. A stranger reads the node.
 *  - The indexer follows the chain, usually within a block. Each read checks its lag first and
 *    declines when it is behind, so a caller never paints older news than the node would give.
 * Every read here resolves to null when the API can't answer well; the caller then asks the node.
 * Numbers come as the ledger's own raw values (`*_p` and grid `val`), as strings, like the node's. */
import { RELAY_BASE, relayFetch, relaySession } from './relay';
import { guildApiBase } from './directory';
import { wallet } from '../wallet/wallet';
import { lcd } from '../chain/lcd';
import { live } from '../chain/live';

const ENV = (import.meta as { env?: Record<string, string | undefined> }).env || {};
/** VITE_GUILD_READS=off keeps every read on the ledger node. */
const ENABLED = ENV.VITE_GUILD_READS !== 'off';
/** The indexer may trail the ledger by this many blocks and still be read. */
const MAX_LAG = 3;

interface Envelope<T> { success?: boolean; data?: T; errors?: unknown; meta?: { height?: number } }

/** Who the session belongs to, and where. */
let session: { key: string; guildId: string } | null = null;
let signingIn: Promise<boolean> | null = null;
/** After a refused sign-in or a dead API, leave it alone a while. */
let restUntil = 0;
const guildOf = new Map<string, string>();
let indexer: { at: number; bell: number; height: number; ok: boolean } | null = null;
let asking: Promise<boolean> | null = null;

if (typeof window !== 'undefined') wallet.onForget(() => { session = null; guildOf.clear(); });

function rest(ms: number) { restUntil = Date.now() + ms; }

/** The commander's guild, read once per warden. */
async function homeGuild(playerId: string): Promise<string | null> {
  const known = guildOf.get(playerId);
  if (known) return known;
  const g = await lcd.player(playerId).then((p) => p.Player.guildId || null, () => null);
  if (g) guildOf.set(playerId, g);
  return g;
}

/** Raw call through the relay into `guildId`'s API. */
async function call<T>(guildId: string, path: string, init: RequestInit = {}): Promise<{ status: number; body: Envelope<T> | null }> {
  const headers = { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}) };
  const r = await relayFetch(`/__relay/guild/${guildId}/api/${path.replace(/^\//, '')}`, { ...init, headers, signal: AbortSignal.timeout(10_000) });
  let body: Envelope<T> | null = null;
  try { body = await r.json(); } catch { /* not json */ }
  return { status: r.status, body };
}

/** Sign the active warden in at their own guild: `LOGIN_GUILD{g}ADDRESS{a}DATETIME{t}`, good for ten minutes. */
async function signIn(): Promise<boolean> {
  const acct = wallet.active;
  if (!acct?.playerId || !wallet.unlocked) return false;
  const guildId = await homeGuild(acct.playerId);
  // a guild with no API of its own (or one that can't be read) is asked again only after a while
  if (!guildId || !(await guildApiBase(guildId).catch(() => null))) { rest(5 * 60_000); return false; }
  const key = `${relaySession()}|${guildId}|${acct.address}`;
  if (session?.key === key) return true;
  try {
    const ts = await call<{ unix_timestamp: number }>(guildId, 'timestamp');
    const t = ts.body?.data?.unix_timestamp;
    if (!t) { rest(60_000); return false; }
    const sig = wallet.signMessage(acct.index, `LOGIN_GUILD${guildId}ADDRESS${acct.address}DATETIME${t}`);
    const r = await call(guildId, 'auth/login', {
      method: 'POST',
      body: JSON.stringify({ address: sig.address, pubkey: sig.pubkey, signature: sig.signature, guild_id: guildId, unix_timestamp: t }),
    });
    if (!r.body?.success) {
      console.info('[guild-api] sign-in refused; reading the ledger node instead', r.status, r.body?.errors);
      rest(5 * 60_000);
      return false;
    }
    session = { key, guildId };
    return true;
  } catch {
    rest(60_000);
    return false;
  }
}

/** Whether a read may be tried at all (cheap, synchronous). */
export function guildReadsPossible(): boolean {
  return ENABLED && RELAY_BASE !== null && Date.now() >= restUntil && !!wallet.active?.playerId && wallet.unlocked;
}

async function ready(): Promise<string | null> {
  if (!guildReadsPossible()) return null;
  if (!session || session.key.split('|')[0] !== relaySession()) {
    signingIn ??= signIn().finally(() => { signingIn = null; });
    if (!(await signingIn)) return null;
  }
  return session?.guildId ?? null;
}

/** Whether the indexer is near enough the ledger to read, asked at most once a block. */
function indexerFresh(guildId: string): Promise<boolean> {
  // good for the block it was asked in (and a few seconds, if the node's bells have stopped)
  if (indexer && indexer.bell === live.height && Date.now() - indexer.at < 6000) return Promise.resolve(indexer.ok);
  asking ??= askIndexer(guildId).finally(() => { asking = null; });
  return asking;
}

async function askIndexer(guildId: string): Promise<boolean> {
  const r = await call<{ height: number; lag_blocks: number; status: string }>(guildId, 'block').catch(() => null);
  const d = r?.body?.data;
  const height = Number(d?.height) || 0;
  // trust the node's clock over the indexer's own idea of the tip when we have one
  const lag = live.height ? live.height - height : Number(d?.lag_blocks ?? 99);
  const ok = !!d && (d.status === 'current' || d.status === 'syncing') && lag <= MAX_LAG;
  indexer = { at: Date.now(), bell: live.height, height, ok };
  return ok;
}

/**
 * GET `path` (relative to /api/) from the commander's guild, or null when the API can't answer
 * well (no session possible, indexer behind, any failure).
 */
export async function guildRead<T>(path: string): Promise<T | null> {
  const guildId = await ready();
  if (!guildId) return null;
  try {
    if (!(await indexerFresh(guildId))) return null;
    let r = await call<T>(guildId, path);
    if (r.status === 401) {
      // the guild forgot us (session expiry, a server restart): sign in once more
      session = null;
      if (!(await ready())) return null;
      r = await call<T>(guildId, path);
    }
    if (r.status >= 500 && r.status !== 502) rest(30_000);
    if (r.status !== 200 || !r.body?.success) return null;
    return (r.body.data ?? null) as T | null;
  } catch {
    return null;
  }
}

/** Every row of a `/page/{n}` list (as many pages as it takes, up to `max` rows), or null. */
export async function guildList<T>(path: string, max = 20_000): Promise<T[] | null> {
  const per = 10_000;
  const [base, query] = path.split('?');
  const out: T[] = [];
  for (let page = 1; out.length < max; page++) {
    const rows = await guildRead<T[]>(`${base}/page/${page}?limit=${per}${query ? '&' + query : ''}`);
    if (!rows) return page === 1 ? null : out;
    out.push(...rows);
    if (rows.length < per) break;
  }
  return out;
}

/** Where the reader stands, for the proving ground and for a curious console. */
export function guildReadState() {
  return { possible: guildReadsPossible(), signedIn: session?.guildId ?? null, restingFor: Math.max(0, restUntil - Date.now()), indexer };
}
