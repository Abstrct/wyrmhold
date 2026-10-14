/* While you were away: what changed in a warden's hold since they last looked. The bad (raids, blows,
 * beasts lost, wildroot carried off) comes from the record of harm; the good (summonings that woke,
 * wildroot delved, alpha brewed) from a sketch of the hold taken while the warden is here and when
 * they leave. A report is made when the page opens and when the warden comes back to it after a
 * while, once the ledger has been read again, and it stays until the warden says they have seen it. */
import { empire, type PlayerState } from './empire';
import { live } from '../chain/live';
import { wallet } from '../wallet/wallet';
import { harms, readBackOnce, readAgain, onRaidlog, type Harm } from './raidlog';
import { safeEach } from '../core/util';

/** The Hold's old "while you were away" note lived under this key; the sketch keeps it. */
const KEY = (pid: string) => `wyrmhold.away.${pid}`;
/** Gone this long, and the good news is worth telling too. */
export const ABSENT_MS = 2 * 60_000;
const TICK_MS = 30_000;

/** What the warden last saw of their hold. `seen` is the bell up to which the harm was before them, and
 * `seenKeys` the deeds of that very bell they saw (another may land in the same bell after they looked). */
interface Sketch { at: number; alpha?: string; ore?: number; seen?: number; seenKeys?: string[]; beasts?: Record<string, [number, number, number]> }

export interface Good { kind: 'woke' | 'delved' | 'brewed'; n?: number; typeId?: number; id?: string }
export interface AwayReport {
  pid: string;
  /** Told once: a report that only grows keeps its number. */
  id: number;
  /** When the warden was last here. */
  since: number;
  harms: Harm[];
  good: Good[];
  /** Beasts that stood when they left and have fallen since, that no deed in the record tells of. */
  lost: { id: string; typeId: number }[];
  base: Sketch;
}

const reports = new Map<string, AwayReport>();
const listeners = new Set<() => void>();
/** Hear when a report is made, grows, or is put away. */
export function onAway(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; }
const emit = () => safeEach(listeners, (f) => f());
/** The report waiting for this warden, if any. */
export const awayReport = (pid: string | null | undefined) => (pid ? reports.get(pid) ?? null : null);
/** The warden has seen it. */
export function dismissAway(pid: string) { if (reports.delete(pid)) emit(); }

function readSketch(pid: string): Sketch | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY(pid)) || 'null') as Sketch | null;
    return s && typeof s.at === 'number' ? s : null;
  } catch { return null; }
}
function writeSketch(pid: string, s: Sketch) { try { localStorage.setItem(KEY(pid), JSON.stringify(s)); } catch { /* storage refused: the next visit only hears the harm */ } }

/** What the warden holds now. Beasts this read did not see keep what the last sketch knew of them: a read
 * missing the warband (its own read failed) must not make the next visit tell them as new or lost. */
function sketchOf(p: PlayerState, prev?: Sketch | null): Omit<Sketch, 'at' | 'seen'> {
  const beasts: Record<string, [number, number, number]> = { ...(prev?.beasts || {}) };
  for (const s of p.structs.values()) if (s.typeId) beasts[s.id] = [s.typeId, s.built ? 1 : 0, s.destroyed ? 1 : 0];
  return { alpha: p.alpha.toString(), ore: p.ore, beasts };
}
const topOf = (list: Harm[]) => list.reduce((m, h) => Math.max(m, h.height), 0);
/** The bell seen up to, and the deeds of that bell, once `list` has been before the warden. */
function seenUpTo(prev: Sketch | null, list: Harm[], top: number): Pick<Sketch, 'seen' | 'seenKeys'> {
  const was = prev?.seen || 0;
  if (was > top) return { seen: was, seenKeys: prev?.seenKeys };
  const at = list.filter((h) => h.height === top).map((h) => h.key);
  return { seen: top, seenKeys: was === top ? [...new Set([...(prev?.seenKeys || []), ...at])] : at };
}
const isUnseen = (prev: Sketch, h: Harm) => (prev.seen ? h.height > prev.seen || (h.height === prev.seen && !(prev.seenKeys || []).includes(h.key)) : h.at > prev.at);

function goodNews(base: Sketch, p: PlayerState, seized: number): Good[] {
  const out: Good[] = [];
  if (base.beasts) {
    for (const s of p.structs.values()) {
      if (s.destroyed || !s.built || !s.typeId) continue;
      const was = base.beasts[s.id];
      // only a summoning the sketch saw still being sung: a beast it never saw may only have been missed
      // (a warband read that failed publishes the warden without its warband), and would be told as new
      if (was && !was[1]) out.push({ kind: 'woke', typeId: s.typeId, id: s.id });
    }
  }
  if (base.ore != null) { const d = p.ore - base.ore + seized; if (d > 0) out.push({ kind: 'delved', n: d }); }
  if (base.alpha != null) { try { const d = p.alpha - BigInt(base.alpha); if (d > 0n) out.push({ kind: 'brewed', n: Number(d) }); } catch { /* an old sketch */ } }
  return out;
}

function lostSince(base: Sketch, p: PlayerState, told: Harm[]) {
  const named = new Set<string>();
  for (const h of told) { if (h.fell && h.targetId) named.add(h.targetId); if (h.guardFell && h.guardId) named.add(h.guardId); }
  const out: { id: string; typeId: number }[] = [];
  for (const [id, [typeId, built, fallen]] of Object.entries(base.beasts || {})) {
    const s = p.structs.get(id);
    if (built && !fallen && s?.destroyed && !named.has(id)) out.push({ id, typeId });
  }
  return out;
}

let seq = 0;
/** Made once per visit (and again after each return), only after the record has been read back. */
const made = new Set<string>(), making = new Set<string>();
const tries: Record<string, number> = {};

function make(pid: string) {
  const p = empire.players.get(pid);
  if (!p || p.restored) return;
  made.add(pid);
  const prev = readSketch(pid);
  const now = sketchOf(p, prev);
  const all = harms(pid);
  const top = Math.max(live.height, topOf(all));
  // a first visit in this browser has no "since": it only starts the sketch
  if (!prev) { writeSketch(pid, { ...now, at: Date.now(), ...seenUpTo(null, all, top) }); return; }
  const old = reports.get(pid);
  const unseen = all.filter((h) => isUnseen(prev, h));
  const keys = new Set<string>();
  const list = [...unseen, ...(old?.harms || [])].filter((h) => !keys.has(h.key) && !!keys.add(h.key)).sort((a, b) => b.height - a.height || b.at - a.at);
  const base = old?.base ?? prev;
  const seized = list.reduce((n, h) => n + (h.kind === 'raid' && h.stage === 'raidSuccessful' ? h.seized || 0 : 0), 0);
  const good = goodNews(base, p, seized);
  const lost = lostSince(base, p, list);
  const away = Date.now() - prev.at > ABSENT_MS;
  if (old || unseen.length || (away && (good.length || lost.length))) {
    reports.set(pid, { pid, id: old?.id ?? ++seq, since: old?.since ?? prev.at, harms: list, good, lost, base });
  }
  writeSketch(pid, { ...now, at: Date.now(), ...seenUpTo(prev, all, top) });
  emit();
}

function consider() {
  for (const pid of wallet.playerIds()) {
    const p = empire.players.get(pid);
    if (!p || p.restored || made.has(pid) || making.has(pid)) continue;
    making.add(pid);
    // what was done meanwhile is read back first: told before it is read, a raid found later would never be news.
    // A ledger that will not answer is asked again (the record retries), and the report waits for it.
    // (a node that cannot search at all, its index turned off, is given up on after a few tries: then only
    // what was heard live and the good news are told)
    void readBackOnce(pid).then((ok) => {
      making.delete(pid);
      if (ok || (tries[pid] = (tries[pid] || 0) + 1) >= 3) make(pid); else setTimeout(consider, 20_500);
    });
  }
}

/** Keep the sketch current while the warden is here (and the page is in sight), and as they leave. */
function keepSketch(leaving = false) {
  if (!leaving && document.visibilityState !== 'visible') return;
  for (const pid of made) {
    const p = empire.players.get(pid);
    if (!p || p.restored) continue;
    const prev = readSketch(pid);
    writeSketch(pid, { ...sketchOf(p, prev), at: Date.now(), seen: prev?.seen, seenKeys: prev?.seenKeys });
  }
}

/** The warden has the harm before them (their own Hold, in sight): it will not be told again as news. */
export function markSeen(pid: string) {
  if (!made.has(pid) || document.visibilityState !== 'visible') return;
  const prev = readSketch(pid);
  if (!prev) return;
  // only a new deed moves it (not every bell), so the sketch is not rewritten as the sky beats
  const all = harms(pid), top = topOf(all);
  if (!all.some((h) => isUnseen(prev, h))) return;
  writeSketch(pid, { ...prev, ...seenUpTo(prev, all, top) });
}

let started = false;
export function followAway() {
  if (started) return;
  started = true;
  empire.onChange(consider);
  setInterval(() => keepSketch(), TICK_MS);
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { keepSketch(true); hiddenAt = Date.now(); return; }
    // back after a while: read the ledger again, and say what changed
    if (hiddenAt && Date.now() - hiddenAt > ABSENT_MS) { made.clear(); void readAgain(); consider(); }
    hiddenAt = 0;
  });
  window.addEventListener('pagehide', () => keepSketch(true));
  // a report that is up grows with what the record learns (a raider named, a deed read back late)
  onRaidlog((pid) => { if (pid ? reports.has(pid) : reports.size) emit(); });
  wallet.onForget(() => {
    reports.clear(); made.clear();
    try { for (const k of Object.keys(localStorage)) if (k.startsWith('wyrmhold.away.')) localStorage.removeItem(k); } catch { /* ignore */ }
    emit();
  });
  consider();
}
