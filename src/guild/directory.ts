/* The guild directory: every guild on chain with what its guild.json says about itself —
 * name, tag, logo, description, and the services it runs (Guild API, GRASS, Matrix).
 * With a relay (dev) the relay reads each guild.json; without one (a build) the page reads it
 * straight from the endpoint the chain names, which works only if that host sends CORS. Either
 * way it must name the same guild as the chain. A guild that can't be read is listed unnamed,
 * from the chain alone. Cached for 10 minutes, served stale while it refreshes. */
import { cached } from '../cache/idb';
import { relayFetch, RELAY_BASE } from './relay';
import { lcd, LCD_URL, type RawGuild } from '../chain/lcd';
import { wallet } from '../wallet/wallet';

export interface GuildMeta {
  name: string; tag: string; description: string; logo: string; website: string;
  domain?: string; webapp?: string; socials?: Record<string, string>; denom?: Record<string, string>; baseEnergy?: string;
}
export interface GuildServices { guild_api: string | null; grass: string | null; matrix: string | null; explorer: string | null }
export interface GuildEntry { id: string; chain: RawGuild; meta: GuildMeta | null; services: GuildServices | null; error: string | null }

/** SN Corp: the guild whose infrastructure backs this client by default. */
const ENV = (import.meta as { env?: Record<string, string | undefined> }).env || {};
export const DEFAULT_GUILD = ENV.VITE_DEFAULT_GUILD || '0-5';
/** VITE_GRASS_URL points a devnet client at its own stream; "off" disables GRASS entirely. */
export const FALLBACK_GRASS = ENV.VITE_GRASS_URL || 'wss://beta.playstructs.com:1443';
const TTL = 10 * 60_000;

let last: GuildEntry[] | null = null;
const listeners = new Set<(g: GuildEntry[]) => void>();

/** The latest directory already in hand (null until the first load), for synchronous lookups. */
export function guildsNow(): GuildEntry[] | null { return last; }
export function onGuilds(f: (g: GuildEntry[]) => void) { listeners.add(f); if (last) f(last); return () => { listeners.delete(f); }; }

function publish(list: GuildEntry[]) {
  last = list;
  for (const f of listeners) { try { f(list); } catch (e) { console.error(e); } }
}

async function fromRelay(fresh: boolean): Promise<GuildEntry[]> {
  const r = await relayFetch('/__relay/guilds' + (fresh ? '?fresh=1' : ''));
  const ct = r.headers.get('content-type') || '';
  if (!r.ok || !ct.includes('json')) throw new Error('relay unavailable');
  const body = await r.json() as { guilds?: GuildEntry[] };
  return (body.guilds || []).map(clean);
}

/** Every guild on chain, each with the guild.json its own server hands this page. */
async function direct(): Promise<GuildEntry[]> {
  const list = await lcd.list<RawGuild>('guild', 'Guild');
  return Promise.all(list.slice(0, 80).map(readGuild));
}

async function readGuild(g: RawGuild): Promise<GuildEntry> {
  const entry: GuildEntry = { id: g.id, chain: g, meta: null, services: null, error: null };
  if (!openUrl(g.endpoint)) return { ...entry, error: 'no endpoint' };
  try {
    const r = await fetch(g.endpoint, { headers: { accept: 'application/json' }, credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(8000) });
    const text = await r.text();
    if (text.length > 64 * 1024) return { ...entry, error: 'guild.json too large' };
    const doc = (JSON.parse(text) as { guild?: Record<string, unknown> } | null)?.guild;
    if (!doc) return { ...entry, error: 'guild.json unreadable' };
    if (doc.id !== g.id) return { ...entry, error: 'guild.json names another guild' };
    const s = (doc.services && typeof doc.services === 'object' ? doc.services : {}) as Record<string, unknown>;
    const str = (v: unknown, n = 400) => (typeof v === 'string' ? v.slice(0, n) : '');
    const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, string> : {});
    const url = (v: unknown, schemes?: string[]) => (typeof v === 'string' && openUrl(v, schemes) ? v.replace(/\/+$/, '') : null);
    return clean({
      ...entry,
      meta: { name: str(doc.name, 80), tag: str(doc.tag, 12), description: str(doc.description, 600), logo: str(doc.logo), website: str(doc.website),
        domain: str(doc.domain, 120), webapp: str(doc.webapp, 120), socials: obj(doc.socials), denom: obj(doc.denom), baseEnergy: str(doc.baseEnergy, 30) },
      services: { guild_api: url(s.guild_api), grass: url(s.grass_nats_websocket, ['wss:']), matrix: url(s.matrix), explorer: url(s.explorer) },
    });
  } catch (e) {
    // A host that sends no CORS header lands here too: the browser reports it only as a failed fetch.
    return { ...entry, error: String((e as Error).message || e).slice(0, 200) };
  }
}

const loopback = (h: string) => /^(localhost|127(\.\d{1,3}){3}|::1)$/i.test(h);
/** A devnet's guilds live on this machine: loopback guild hosts count only when the ledger does too. */
const LOCAL_LEDGER = (() => { try { return loopback(new URL(LCD_URL).hostname); } catch { return false; } })();

/** An https URL to a named public host — no IP literals, no local names — so a guild.json can't
 * point this page at the player's own network. */
function openUrl(u: string, schemes = ['https:']): boolean {
  try {
    const x = new URL(u);
    if (x.username || x.password) return false;
    const h = x.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (LOCAL_LEDGER && loopback(h)) return true;
    if (!schemes.includes(x.protocol)) return false;
    return h.includes('.') && !h.includes(':') && !/^[\d.]+$/.test(h) && !/(^|\.)(localhost|local|internal|lan|home|arpa)$/.test(h);
  } catch { return false; }
}

async function fromChain(): Promise<GuildEntry[]> {
  const list = await lcd.list<RawGuild>('guild', 'Guild');
  return list.map((g) => ({ id: g.id, chain: g, meta: null, services: null, error: 'directory relay unavailable' }));
}

/** Whatever a guild.json says is still a third party's self-description: keep strings strings. */
function clean(g: GuildEntry): GuildEntry {
  const s = (v: unknown) => (typeof v === 'string' ? v : '');
  const m = g.meta;
  return {
    id: s(g.id), chain: g.chain, error: g.error ? s(g.error) : null,
    meta: m ? { name: s(m.name), tag: s(m.tag), description: s(m.description), logo: safeUrl(s(m.logo)), website: safeUrl(s(m.website)), domain: s(m.domain), webapp: s(m.webapp),
      socials: m.socials && typeof m.socials === 'object' ? m.socials : {}, denom: m.denom && typeof m.denom === 'object' ? m.denom : {}, baseEnergy: s(m.baseEnergy) } : null,
    services: g.services ? { guild_api: g.services.guild_api || null, grass: g.services.grass || null, matrix: g.services.matrix || null, explorer: g.services.explorer || null } : null,
  };
}

/** Only http(s) links leave this module: a guild.json can't smuggle javascript: into an href/src. */
export function safeUrl(u: string): string {
  try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:' ? x.toString() : ''; } catch { return ''; }
}

/** Every guild on chain with its directory entry. */
export async function guilds(opts: { fresh?: boolean } = {}): Promise<GuildEntry[]> {
  try {
    const list = await cached(RELAY_BASE === null ? 'guilds-direct' : 'guilds', TTL, () => (RELAY_BASE === null ? direct() : fromRelay(!!opts.fresh)), {
      ns: 'directory', staleWhileRevalidate: true, force: opts.fresh, onUpdate: publish, keep: (v) => v.length > 0,
    });
    publish(list);
    return list;
  } catch {
    const list = await fromChain();
    if (!last) publish(list);
    return list;
  }
}

export async function guildEntry(id: string): Promise<GuildEntry | null> {
  return (await guilds()).find((g) => g.id === id) ?? null;
}

/** Name, tag, logo and description, with sensible fallbacks for guilds that publish nothing. */
export async function guildMeta(id: string): Promise<GuildMeta> {
  const e = await guildEntry(id).catch(() => null);
  return e?.meta?.name ? e.meta : fallbackMeta(id, e?.chain);
}

export function fallbackMeta(id: string, chain?: RawGuild): GuildMeta {
  return { name: chain?.name || `Guild ${id}`, tag: '', description: '', logo: '', website: '' };
}

/** Synchronous best name for a guild: directory, then a plain fallback. */
export function guildLabel(id: string): { name: string; tag: string } {
  const e = last?.find((g) => g.id === id);
  if (e?.meta?.name) return { name: e.meta.name, tag: e.meta.tag || '' };
  return { name: e?.chain?.name || `Guild ${id}`, tag: '' };
}

export async function servicesFor(id: string): Promise<GuildServices | null> {
  return (await guildEntry(id).catch(() => null))?.services ?? null;
}

/** Where a guild's own API answers ("https://host/api/"), reading the directory afresh once if it
 * isn't known yet; null if the guild publishes none or its guild.json can't be read. */
export async function guildApiBase(id: string): Promise<string | null> {
  let api = (await guildEntry(id).catch(() => null))?.services?.guild_api;
  if (!api) api = (await guilds({ fresh: true }).catch(() => [] as GuildEntry[])).find((g) => g.id === id)?.services?.guild_api;
  return api ? api.replace(/\/+$/, '').replace(/\/api$/, '') + '/api/' : null;
}

/** The guild of the player this browser acts as. */
export async function homeGuild(): Promise<string | null> {
  const pid = wallet.active?.playerId;
  if (!pid) return null;
  try { return (await lcd.player(pid)).Player.guildId || null; } catch { return null; }
}
