/* Incantations (the proof-of-work engine's tasks) and the Chronicle (the transaction queue),
 * told in the realm's words. Both are live views over the borrowed ledger modules. */
import { h, clear, toast, keepFocus } from '../core/dom';
import { pow, type PowTask } from '../pow/pow';
import { txq, type TxJob } from '../wallet/queue';
import { live } from '../chain/live';
import { retell, retellError, bellsAsTime, agoMs } from '../lore';
import { canRetry } from '../game/actions';
import { wallet } from '../wallet/wallet';
import { powAgeFor } from '../core/util';
import { audio } from '../core/audio';
import { proclaim } from './omens';

const KIND: Record<PowTask['kind'], [string, string]> = {
  build: ['Summoning chant', 'var(--gold)'], mine: ['Delving chant', 'var(--root)'], refine: ['Brewing chant', '#7dffb0'], raid: ['Plunder chant', 'var(--ember)'],
};
/** What each chant is for, so a summoning's drawn circle, or the sheaf before, never reads as this chant done. */
const LEAD: Record<PowTask['kind'], string> = { build: 'Circle drawn', mine: 'Next sheaf', refine: 'Next alpha', raid: 'Through their ward' };

function fmtRate(r: number) { return r >= 1e9 ? `${(r / 1e9).toFixed(1)} G` : r >= 1e6 ? `${(r / 1e6).toFixed(1)} M` : r >= 1e3 ? `${(r / 1e3).toFixed(0)} k` : `${Math.round(r)}`; }

/* ── How long a chant takes, told plainly ─────────────────────────────
 * The ledger lowers a chant's bar with every bell (pow.required), whether or not Wyrmhodl is open. A closed
 * tab loses nothing: once the bar has fallen to what this device finds in moments, the chant is ripe, and on
 * return it is finished in moments. An open tab only adds luck (it keeps chanting, so a strong chant may land
 * early). The one thing that needs the page is the final word, so a ripe chant waits for its warden. */

/** A bell on the live realm. The devnet strikes far faster, so its estimates read long there; that is expected. */
const BELL_MS = 6000;

let felt = 0, feltAt = 0;
/** Tries a second this device manages, felt over about half a minute. Before it has chanted (or while another
 * tab does the chanting), what its threads usually manage, as the chant engine itself assumes. */
function strength(): number {
  const now = Date.now();
  if (pow.rate > 0) { felt += (pow.rate - felt) * (felt && feltAt ? Math.min(1, (now - feltAt) / 30_000) : 1); feltAt = now; }
  return felt || pow.settings.threads * 2.5e6;
}

/** The chant strength this device finds within about a minute: a chant whose bar has fallen that far is ripe. */
export function quickZeros(): number { return Math.max(1, Math.floor(Math.log(strength() * 60) / Math.log(16))); }

/** Bells until a chant is ripe: its bar falls to the best chant already found, or to one found in moments. */
export function bellsToRipe(t: PowTask): number { return pow.blocksUntil(t, Math.max(t.best?.zeros ?? 0, quickZeros())); }

/** A wait, roughly, as a person says it: "~40 min", "~9 h", "~2 days" (hours and days as bellsAsTime has them). */
export function roughWait(bells: number): string {
  const m = (Math.max(0, bells) * BELL_MS) / 60_000;
  if (m < 1.5) return '~1 min';
  if (m < 10) return `~${Math.round(m)} min`;
  if (m < 50) return `~${Math.round(m / 5) * 5} min`;
  if (m < 90) return '~1 h';
  return '~' + bellsAsTime(bells);
}

/** About how long a chant of this length takes from its first bell until it is ripe ("~40 min"). */
export function chantTime(range: number): string { return roughWait(powAgeFor(quickZeros(), range)); }

/** When a wait ends, as a person says it: "this evening", "late tonight", "tomorrow morning", "Friday night". */
export function whenAfter(bells: number, now = new Date()): string {
  const at = new Date(now.getTime() + Math.max(0, bells) * BELL_MS);
  const hr = at.getHours();
  const part = hr < 5 ? 'night' : hr < 12 ? 'morning' : hr < 17 ? 'afternoon' : hr < 21 ? 'evening' : 'night';
  const day = (d: Date) => Math.round(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 864e5);
  const days = day(at) - day(now);
  if (days <= 0) return hr < 5 ? 'before dawn' : part === 'night' ? 'tonight' : `this ${part}`;
  if (days === 1) return hr < 5 ? 'late tonight' : `tomorrow ${part}`;
  if (days < 7) return `${at.toLocaleDateString('en-US', { weekday: 'long' })} ${part}`;
  return `in ${days} days`;
}

/** "ripe in ~40 min", or for a longer wait "ripe this evening (~9 h)". */
export function ripeWhen(bells: number): string {
  return bells * BELL_MS < 90 * 60_000 ? `ripe in ${roughWait(bells)}` : `ripe ${whenAfter(bells)} (${roughWait(bells)})`;
}

/* ── Chanting gently: one thread and no lantern (the GPU), for a phone's sake ── */

/** The chant engine's own default: half the device's threads, up to eight. */
const FULL_THREADS = Math.max(1, Math.min(8, Math.floor((typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4) / 2)));
const isGentle = () => pow.settings.threads <= 1 && pow.settings.engine === 'cpu';
function chantGently(on: boolean) { pow.save(on ? { threads: 1, engine: 'cpu' } : { threads: FULL_THREADS, engine: 'auto' }); }
// Only the signing tab chants, and the engine reads its settings once: when another tab changes how hard
// to chant, this one follows (saving only a difference, so two tabs never echo each other).
if (typeof window !== 'undefined') window.addEventListener('storage', (e) => {
  if (e.key !== 'wyrmhold.chant' || !e.newValue) return;
  try {
    const s = JSON.parse(e.newValue) as { threads?: number; engine?: 'auto' | 'cpu' | 'gpu' };
    if (s.threads && s.engine && (s.threads !== pow.settings.threads || s.engine !== pow.settings.engine)) pow.save({ threads: s.threads, engine: s.engine });
  } catch { /* not a setting this tab can read */ }
});

export function chantsPanel() {
  const list = h('ul', { class: 'list', style: { gap: '12px' } });
  const meta = h('span', { class: 'mono faint', style: { fontSize: '11px' } });
  const pace = (on: boolean, label: string, title: string) => h('button', { type: 'button', class: 'chip', title, onclick: () => { chantGently(on); mark(); } }, label);
  const gently = pace(true, 'Chant gently', 'Uses less of this device: cooler, and kinder to a phone. Chants may ripen a little later.');
  const fully = pace(false, 'Chant with all my strength', 'Uses this device’s spare strength: a lucky chant lands sooner, and a phone may grow warm.');
  // built once and only marked, so a press never loses its focus to a repaint
  const mark = () => { for (const [b, on] of [[gently, isGentle()], [fully, !isGentle()]] as const) if (b.getAttribute('aria-pressed') !== String(on)) { b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); } };
  const el = h('section', { class: 'glass panel', 'aria-label': 'Incantations' },
    h('div', { class: 'row between', style: { marginBottom: '10px' } }, h('h2', { class: 'display', style: { fontSize: '19px' } }, 'Incantations'), meta), list,
    // the truth about time (see above): a closed Wyrmhodl loses nothing, an open one only adds luck
    h('p', { class: 'faint chant-truth', style: { margin: '10px 0 0', fontSize: '12px' } },
      'Chants ripen even while Wyrmhodl is closed: come back to finish them in moments. Left open, a lucky one may land sooner.'),
    h('div', { class: 'chips', role: 'group', 'aria-label': 'How hard this device chants while Wyrmhodl is open', style: { marginTop: '8px' } }, gently, fully));
  mark();
  let sig = '';
  const paint = () => {
    const tasks = pow.active.filter((t) => t.account >= 0);
    // the rate is for the curious; the warden only needs to know the Hold is singing
    const singing = pow.rate ? (isGentle() ? 'singing softly…' : 'singing…') : '';
    if (meta.textContent !== singing) meta.textContent = singing;
    meta.title = pow.rate ? `${fmtRate(pow.rate)} chants a second, on this device` : '';
    // An empty panel only explains itself: it shows once a chant is sounding.
    el.hidden = !tasks.length;
    if (!tasks.length) { sig = ''; return; }
    const rows = tasks.map((t) => {
      const [name, color] = KIND[t.kind];
      const need = pow.required(t), best = t.best?.zeros ?? 0;
      const left = live.height ? bellsToRipe(t) : Infinity;
      const ripe = t.status === 'submitting' || best >= need || left <= 0;
      // the bar fills with time as the chant ripens: steady, whatever luck the open tab has
      const age = Math.max(0, live.height + 1 - t.blockStart);
      const pct = ripe ? 100 : Number.isFinite(left) ? Math.min(99, Math.floor((age / Math.max(1, age + left)) * 100)) : 0;
      const state = t.waits ? `waits: ${t.waits}. Fell it and the plunder lands`
        : ripe ? (wallet.state === 'locked' ? 'ripe: waits for your soulstone to be unsealed' : 'ripe: finishing…')
        : Number.isFinite(left) ? ripeWhen(left) : 'listening for the bells…';
      const what = retell(t.label).replace(/^[^·]*chant · /i, '').replace(/ · chant of \d+$/, '');
      const note = `${LEAD[t.kind]} · ${state}` + (t.error ? ` · ${retellError(t.error).replace(/\bunder_raid\b/, 'raiders overhead')}` : '');
      return { name, color, what, pct, note };
    });
    // repaint only when what is shown changes: the engine reports many times a second
    const next = JSON.stringify(rows);
    if (next === sig) return;
    sig = next;
    clear(list);
    for (const r of rows) {
      list.append(h('li', { class: 'chant' },
        h('div', { class: 'top' }, h('span', null, r.name, h('span', { class: 'faint' }, ' · ' + r.what)), h('span', { class: 'mono faint', style: { fontSize: '12px' }, 'aria-hidden': 'true' }, `${r.pct}%`)),
        h('span', { class: 'bar', role: 'progressbar', 'aria-label': `${r.name} · ${r.what}`, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(r.pct), 'aria-valuetext': `${r.pct}% ripe` }, h('i', { style: { width: Math.max(4, r.pct) + '%', background: r.color } })),
        h('span', { class: 'faint', style: { fontSize: '12px' } }, r.note)));
    }
  };
  const offs = [pow.onChange(() => { paint(); mark(); }), live.onBlock(paint)];
  paint();
  return { el, dispose: () => offs.forEach((f) => f()) };
}

/* ── A chant sung to its end, told once ───────────────────────────────
 * main.ts's herald hands every chant that lands here. A beast that wakes is a moment (a banner, and a word for
 * screen readers, whom a freshly drawn banner does not reach); a sheaf delved or brewed is one plain herald.
 * The same kind is told at most once a minute and a half: on a fast sky they land every few bells. */

let news: HTMLElement | null = null;
/** Say something once to a screen reader, politely, through a region that was there before the words. */
function say(text: string) {
  if (!news) { news = h('div', { class: 'chant-news', role: 'status', 'aria-live': 'polite', style: { position: 'absolute', width: '1px', height: '1px', margin: '-1px', overflow: 'hidden', clipPath: 'inset(50%)', whiteSpace: 'nowrap' } }); document.body.append(news); }
  const n = news;
  n.textContent = '';
  setTimeout(() => { n.textContent = text; }, 150);
}

const toldAt = new Map<string, number>();
export function chantSung(j: TxJob) {
  const what = retell(j.label).replace(/ · chant of \d+$/, '');
  // a crewmate's chant, sung by this device on their behalf
  if (!j.playerId || !wallet.byPlayer(j.playerId)) { toast(`${what}: sung to its end.`, 'player'); return; }
  const msg = j.msgs.map((m) => m.typeUrl).join();
  if (/StructBuildComplete/.test(msg)) {
    const beast = what.replace(/^.*chant · /i, '').replace(/^The /, '') || 'beast';
    proclaim(`The ${beast} wakes`, 'Your summoning is sung. It is bound to you now, and works on its own.', 'gold', { quiet: true });
    say(`Your ${beast} has woken. It is bound to you now.`);
    audio.stinger('alpha', 0.6);
    return;
  }
  // a plunder is told by the omens, from the raid itself
  if (/PlanetRaidComplete/.test(msg)) return;
  const brew = /OreRefineryComplete/.test(msg), key = (brew ? 'brew|' : 'delve|') + j.playerId;
  if (Date.now() - (toldAt.get(key) || 0) < 90_000) return;
  toldAt.set(key, Date.now());
  toast(brew ? 'A sheaf of wildroot was brewed into alpha. No raider can take it now.' : 'A sheaf of wildroot was delved. Your Dawn Cauldron brews it on its own; until then, raiders can steal it.', 'player', 5000);
  audio.stinger('alpha', 0.5);
}

const STATUS: Record<TxJob['status'], [string, string]> = {
  queued: ['awaits', 'var(--muted)'], waiting: ['gathers breath', 'var(--verdigris)'], signing: ['is sealed', 'var(--gold)'], pending: ['is spoken', 'var(--gold)'],
  success: ['is done', '#7dffb0'], failed: ['failed', 'var(--ember)'], cancelled: ['was let go', 'var(--faint)'],
};

/** A line the Chronicle tells beside the warden's own rites (what others did to their hold). `sig` changes
 * whenever its words or controls would. */
export interface ChronicleLine { at: number; key: string; sig: string; el: () => HTMLElement }
export interface ChronicleExtra { lines(): ChronicleLine[]; on(repaint: () => void): () => void }

export function chroniclePanel(filter: (j: TxJob) => boolean = () => true, max = 30, extra?: ChronicleExtra) {
  const list = h('ol', { class: 'list chron scroll-y', style: { gap: '6px', maxHeight: '170px' } });
  const el = h('section', { class: 'glass panel', 'aria-label': 'Chronicle', style: { display: 'flex', flexDirection: 'column' } },
    h('h2', { class: 'display', style: { fontSize: '19px', marginBottom: '8px' } }, 'Chronicle'), list);
  let last: TxJob[] = [];
  let sig = '';
  const paint = (jobs: TxJob[]) => {
    last = jobs;
    // the same rite done again and again reads as one line with a count; so does the same refusal,
    // however the rows between fell (eight taps on a full sky are one line, ×8, newest first)
    const sorted = jobs.filter(filter).slice().sort((a, b) => b.updatedAt - a.updatedAt);
    const shown: TxJob[] = [], times = new Map<TxJob, number>();
    const keys = new Map<TxJob, string>();
    const said = (j: TxJob) => { let k = keys.get(j); if (k == null) { k = j.label.replace(/ · chant of \d+$/, '') + (j.status === 'failed' ? '|' + retellError(j.error || '') : ''); keys.set(j, k); } return k; };
    for (const j of sorted) {
      const prev = shown[shown.length - 1];
      const same = j.status === 'failed' ? shown.find((s) => s.status === 'failed' && said(s) === said(j))
        : prev && prev.status === 'success' && j.status === 'success' && said(prev) === said(j) ? prev : undefined;
      if (same) { times.set(same, (times.get(same) || 1) + 1); continue; }
      if (shown.length >= max) break;
      shown.push(j);
    }
    // the warden's rites and what was done to them, interleaved, newest first
    const rows: ({ at: number; job: TxJob } | { at: number; line: ChronicleLine })[] = [...shown.map((j) => ({ at: j.updatedAt, job: j })), ...(extra ? extra.lines().map((l) => ({ at: l.at, line: l })) : [])];
    rows.sort((a, b) => b.at - a.at);
    if (rows.length > max) rows.length = max;
    // repaint only when what it says changes, so a reader or a focused button is not reset
    const now = rows.map((r) => ('job' in r ? `${r.job.id}|${r.job.status}|${times.get(r.job) || 0}|${r.job.waitReason || ''}|${r.job.error || ''}|${canRetry(r.job)}|${agoMs(r.at)}` : `${r.line.sig}|${agoMs(r.at)}`)).join('\n');
    if (now === sig && list.childElementCount) return;
    sig = now;
    // Like the chants: an empty chronicle waits out of sight until there is something to tell.
    el.hidden = !rows.length;
    keepFocus(list, () => { clear(list); for (const r of rows) list.append('job' in r ? jobRow(r.job, times.get(r.job)) : r.line.el()); });
  };
  const jobRow = (j: TxJob, n?: number) => {
    const [word, color] = STATUS[j.status];
    return h('li', null,
      h('span', { class: 'when', title: (j.height ? `Bell ${j.height} · ` : '') + new Date(j.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }, agoMs(j.updatedAt)),
      h('span', null, h('span', null, retell(j.label).replace(/ · chant of \d+$/, '')), ' ', h('span', { style: { color } }, word), n ? h('span', { class: 'herald-n', style: { marginLeft: '6px' } }, `×${n}`) : null,
        j.status === 'waiting' && j.waitReason ? h('span', { class: 'faint' }, ` — ${retellError(j.waitReason)}`) : null,
        j.status === 'failed' && j.error ? h('span', { style: { color: 'var(--ember-ink)' } }, ` — ${retellError(j.error)}`) : null,
        // a stale refusal is only told: sent again blind, it could ride a new Wyrm to a plundered isle
        j.status === 'failed' && canRetry(j) ? [' ', h('button', { type: 'button', class: 'btn small ghost', style: { marginLeft: '6px', minHeight: '28px' }, 'aria-label': `Again: ${retell(j.label).replace(/ · chant of \d+$/, '')}`, onclick: () => { if (canRetry(j)) txq.retry(j.id); else paint(last); } }, 'Again')] : null));
  };
  const off = txq.onChange(paint);
  const offExtra = extra?.on(() => paint(last));
  // "just now" ages: refresh the times twice a minute
  const tick = setInterval(() => paint(last), 30_000);
  // repaint: the filter's answer changed without the queue changing (whose rites these are)
  return { el, repaint: () => paint(last), dispose: () => { off(); offExtra?.(); clearInterval(tick); } };
}
