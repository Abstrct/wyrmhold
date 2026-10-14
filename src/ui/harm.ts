/* Being raided, told: what others did to your hold in plain realm words, the "While you were away"
 * card, the Chronicle's lines of harm, an alert that stays on every screen while raiders hang over
 * your isle, and a quiet voice for screen readers when one of your beasts falls. */
import './harm.css';
import { h, clear, keepFocus, toast } from '../core/dom';
import { go as goTo, here } from '../core/nav';
import { icon, ICON } from './frame';
import { live } from '../chain/live';
import { empire, type PlayerState } from '../game/empire';
import { wallet } from '../wallet/wallet';
import { followRaidlog, harms, onHarm, onRaidlog, knownName, foeHoldsIsle, type Harm } from '../game/raidlog';
import { followAway, onAway, awayReport, dismissAway, markSeen, type AwayReport } from '../game/away';
import { BEASTS, agoMs, fmtAlpha, sheaves } from '../lore';
import { playerName, raidersAt } from '../realm';
import type { ChronicleLine, ChronicleExtra } from './chants';

/* ── Words ─────────────────────────────────────────────────────────────── */

/** A beast by its lore name ("beast" for a kind this build does not know). */
const kind = (typeId?: number) => (typeId && BEASTS[typeId] ? BEASTS[typeId].name : 'beast');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** A warden by name ("Leo", "Warden 1-23"), or "a raider" when the ledger has not said who. */
export const who = (pid?: string) => (pid ? playerName({ name: knownName(pid) || '', playerId: pid }) : 'a raider');
const whose = (pid?: string) => `${who(pid)}’s`;
const listOf = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0] || '');
const plural = (name: string) => (/y$/.test(name) ? name.slice(0, -1) + 'ies' : /Kraken$/.test(name) ? name : name + 's');
const NUM = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
/** "Elder Wyrm and two Stone Trolls". */
function tally(names: string[]) {
  const c = new Map<string, number>();
  for (const n of names) c.set(n, (c.get(n) || 0) + 1);
  return listOf([...c].map(([n, k]) => (k > 1 ? `${NUM[k] || k} ${plural(n)}` : n)));
}
const uniq = <T>(xs: T[]) => [...new Set(xs)];

/** One deed, said as a warden would say it. */
export function harmLine(x: Harm): string {
  const foe = whose(x.foe);
  if (x.kind === 'raid') {
    switch (x.stage) {
      case 'initiated': return `${cap(foe)} warband came to plunder your isle.`;
      case 'shieldsVulnerable': return `${cap(foe)} warband broke your ward: your isle lay open to their plunder.`;
      case 'raidSuccessful': return x.seized ? `${cap(foe)} warband plundered your isle: ${sheaves(x.seized)} of wildroot carried off.` : `${cap(foe)} warband broke into your isle, but found no unbrewed wildroot to take.`;
      case 'attackerDefeated': return `${cap(foe)} Elder Wyrm fell over your isle: their raid is broken.`;
      default: return `${cap(foe)} warband rode home without plunder.`;
    }
  }
  const theirs = `${foe} ${kind(x.by)}`, ours = `your ${kind(x.target)}`;
  if (x.answered) return `Your ${kind(x.target)} fell striking ${theirs}.`;
  if (x.guard) return x.guardFell ? `Your ${kind(x.guard)} fell guarding ${ours} from ${theirs}.` : `Your ${kind(x.guard)} took a blow from ${theirs} meant for ${ours}.`;
  if (x.evaded) return `Your ${kind(x.target)} turned aside a blow from ${theirs}.`;
  if (x.fell) return `${cap(theirs)} felled ${ours}.`;
  return x.damage ? `${cap(theirs)} struck ${ours}: ${x.damage} ${x.damage === 1 ? 'heart' : 'hearts'} lost.` : `${cap(theirs)} struck ${ours}, but it took no hurt.`;
}
/** Whether a deed cost the warden something (a beast, wildroot) or only threatened. */
const grave = (x: Harm) => !!(x.fell || x.guardFell || (x.kind === 'raid' && (x.stage === 'raidSuccessful' || x.stage === 'shieldsVulnerable')));

/** The beasts a report says fell. */
function fallenIn(r: AwayReport) {
  const names: string[] = [];
  for (const x of r.harms) { if (x.fell) names.push(kind(x.target)); if (x.guardFell) names.push(kind(x.guard)); }
  for (const l of r.lost) names.push(kind(l.typeId));
  return names;
}
const ORDER = { raidSuccessful: 5, attackerDefeated: 4, attackerRetreated: 3, shieldsVulnerable: 2, initiated: 1 } as const;
/** Each raider once, with how their raid ended (the furthest it got) and what they carried off. */
function raidsIn(r: AwayReport) {
  const by = new Map<string, { foe?: string; stage: keyof typeof ORDER; seized: number; times: number; at: number }>();
  for (const x of r.harms) {
    if (x.kind !== 'raid' || !x.stage) continue;
    const k = x.foe || '?';
    const e = by.get(k) || { foe: x.foe, stage: x.stage, seized: 0, times: 0, at: x.at };
    if (ORDER[x.stage] > ORDER[e.stage]) e.stage = x.stage;
    if (x.stage === 'raidSuccessful') { e.seized += x.seized || 0; e.times++; }
    e.at = Math.max(e.at, x.at);
    by.set(k, e);
  }
  return [...by.values()].sort((a, b) => b.at - a.at);
}

/** "While you were away: Leo plundered your isle and your Elder Wyrm fell." ('' when there is nothing to say.) */
export function awaySummary(r: AwayReport | null): string {
  if (!r) return '';
  const parts: string[] = [];
  const raids = raidsIn(r);
  const by = (stage: string[]) => raids.filter((x) => stage.includes(x.stage));
  const took = by(['raidSuccessful']), broke = by(['attackerDefeated']), left = by(['attackerRetreated']), came = by(['initiated', 'shieldsVulnerable']);
  if (took.length) parts.push(`${listOf(took.map((x) => who(x.foe)))} plundered your isle`);
  if (broke.length) parts.push(`${listOf(broke.map((x) => whose(x.foe)))} ${broke.length > 1 ? 'raids were' : 'raid was'} broken`);
  if (left.length) parts.push(`${listOf(left.map((x) => who(x.foe)))} came to raid your isle but rode home with nothing`);
  if (came.length) parts.push(`${listOf(came.map((x) => who(x.foe)))} came to raid your isle`);
  const raiders = new Set(raids.map((x) => x.foe));
  const strikers = uniq(r.harms.filter((x) => x.kind === 'blow' && !x.answered && !raiders.has(x.foe)).map((x) => x.foe));
  if (strikers.length) parts.push(`${listOf(strikers.map(who))} struck your beasts`);
  const fallen = fallenIn(r);
  if (fallen.length) parts.push(`your ${tally(fallen)} fell`);
  for (const g of r.good) {
    if (g.kind === 'woke') continue;
    if (g.kind === 'delved') parts.push(`${sheaves(g.n || 0)} of wildroot ${g.n === 1 ? 'was' : 'were'} delved`);
    if (g.kind === 'brewed') parts.push(`${fmtAlpha(BigInt(g.n || 0))} alpha was brewed`);
  }
  const woke = r.good.filter((g) => g.kind === 'woke').map((g) => kind(g.typeId));
  if (woke.length) parts.push(`your ${tally(woke)} woke`);
  return parts.length ? `While you were away: ${listOf(parts)}.` : '';
}

/** A raid back makes sense with an Elder Wyrm to ride on, against a warden who still holds an isle. */
function canRaidBack(p: PlayerState | null, foe?: string): boolean {
  if (!p || !foe || foe === p.playerId || wallet.byPlayer(foe)) return false;
  const wyrm = [...p.structs.values()].some((s) => s.typeId === 1 && s.built && !s.destroyed);
  return wyrm && foeHoldsIsle(foe) === true;
}
const hasWyrm = (p: PlayerState | null) => !!p && [...p.structs.values()].some((s) => s.typeId === 1 && s.built && !s.destroyed);
const raidBack = (foe: string, go: (route: string) => void) => h('button', { type: 'button', class: 'btn small ember raid-back', 'data-key': `back:${foe}`, 'aria-label': `Raid ${who(foe)} back`, onclick: () => go(`/skirmish/${foe}`) }, 'Raid them back');

/* ── A quiet voice for screen readers ──────────────────────────────────── */

let voice: HTMLElement | null = null;
/** Say a line once, politely, to assistive tech only. */
export function say(text: string) {
  if (!voice || !voice.isConnected) { voice = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite', 'data-voice': 'harm' }); document.body.append(voice); }
  const v = voice;
  v.textContent = '';
  // a fresh node in a cleared region is heard even when the words repeat
  setTimeout(() => { v.append(h('p', null, text)); }, 60);
}

/* ── While you were away: the Hold's card ──────────────────────────────── */

/** Reports already heard (on the Gate's polite welcome, or by the card's voice): each is heard once. */
const toldReports = new Set<number>();
/** The Gate's one line of news for a warden (it speaks it in its own polite welcome, so the card will not again). */
export function awayLine(pid: string): string {
  const r = awayReport(pid);
  const line = awaySummary(r);
  if (r && line) toldReports.add(r.id);
  return line;
}

/** The card for the Hold. `player` is the hold shown (only a warden's own gets a card). */
export function awayCard(player: () => PlayerState | null, mine: () => boolean, go: (route: string) => void) {
  const el = h('section', { class: 'glass panel away-card', role: 'region', 'aria-labelledby': 'away-head', 'aria-label': 'While you were away', hidden: true });
  let sig = '';
  const paint = () => {
    const p = player();
    const own = !!p && mine();
    // what is done to a warden whose own Hold is before them is not news later
    if (own) markSeen(p!.playerId);
    const r = own ? awayReport(p!.playerId) : null;
    const s = r ? JSON.stringify([r.id, r.harms.map((x) => x.key + (x.foe || '')), r.good, r.lost, raidsIn(r).map((x) => [x.foe, canRaidBack(p, x.foe)]), hasWyrm(p), r.harms.map((x) => who(x.foe)), agoMs(r.since)]) : '';
    if (s === sig) return;
    sig = s;
    el.hidden = !r;
    if (!r) { clear(el); return; }
    keepFocus(el, () => build(r, p));
    // heard once, politely, the first time it shows
    if (!toldReports.has(r.id)) { toldReports.add(r.id); const line = awaySummary(r); if (line) say(line); }
  };
  function build(r: AwayReport, p: PlayerState | null) {
    clear(el);
    const rows: HTMLElement[] = [];
    const row = (tone: 'bad' | 'good' | 'calm', text: string, at?: number, extra?: Node | null) =>
      rows.push(h('li', { class: `away-row ${tone}` }, h('span', { class: 'away-text' }, text, at ? h('span', { class: 'when' }, ` · ${agoMs(at)}`) : null), extra || null));
    const raids = raidsIn(r);
    for (const x of raids) {
      const foe = whose(x.foe);
      const text = x.stage === 'raidSuccessful'
        ? (x.seized ? `${cap(foe)} warband plundered your isle${x.times === 2 ? ' twice' : x.times > 2 ? ` ${NUM[x.times] || x.times} times` : ''}: ${sheaves(x.seized)} of wildroot carried off.` : `${cap(foe)} warband broke into your isle, but found no unbrewed wildroot to take.`)
        : x.stage === 'attackerDefeated' ? `${cap(foe)} raid was broken: their Elder Wyrm fell over your isle.`
          : x.stage === 'attackerRetreated' ? `${cap(foe)} warband rode home without plunder.`
            : x.stage === 'shieldsVulnerable' ? `${cap(foe)} warband broke your ward.` : `${cap(foe)} warband came to plunder your isle.`;
      row(x.stage === 'attackerDefeated' || x.stage === 'attackerRetreated' ? 'calm' : 'bad', text, x.at, canRaidBack(p, x.foe) ? raidBack(x.foe!, go) : null);
    }
    // beasts lost, each told with who felled it; other blows only counted
    const blows = r.harms.filter((x) => x.kind === 'blow');
    for (const x of blows.filter((b) => b.fell || b.guardFell).slice(0, 5)) row('bad', harmLine(x), x.at);
    for (const l of r.lost) row('bad', `Your ${kind(l.typeId)} fell.`);
    const rest = blows.filter((b) => !b.fell && !b.guardFell);
    if (rest.length) {
      const dodged = rest.filter((b) => b.evaded).length, hit = rest.length - dodged;
      const strikers = uniq(rest.map((b) => b.foe));
      const from = strikers.length === 1 ? ` from ${whose(strikers[0])} warband` : '';
      row('calm', hit && dodged ? `Your beasts took ${hit} ${hit === 1 ? 'blow' : 'blows'}${from}, and turned aside ${dodged}.` : hit ? `Your beasts took ${hit} ${hit === 1 ? 'blow' : 'blows'}${from}.` : `Your beasts turned aside ${dodged} ${dodged === 1 ? 'blow' : 'blows'}${from}.`);
    }
    // a raider struck without a raid (their warband never came for your isle): a way back at them too
    const raiders = new Set(raids.map((x) => x.foe));
    for (const foe of uniq(blows.filter((b) => !b.answered && b.foe && !raiders.has(b.foe)).map((b) => b.foe!))) {
      if (canRaidBack(p, foe)) row('calm', `${who(foe)} struck your beasts.`, undefined, raidBack(foe, go));
    }
    for (const g of r.good) {
      if (g.kind === 'woke') row('good', `Your ${kind(g.typeId)} woke: its summoning is sung.`);
      else if (g.kind === 'delved') row('good', `${cap(sheaves(g.n || 0))} of wildroot delved.`);
      else row('good', `${fmtAlpha(BigInt(g.n || 0))} alpha brewed. No raider can take it.`);
    }
    const lead = awaySummary(r).replace(/^While you were away: /, '');
    const foes = uniq([...raids.map((x) => x.foe), ...blows.map((b) => b.foe)]).filter(Boolean);
    const kids: (Node | null)[] = [
      h('div', { class: 'row between', style: { alignItems: 'baseline' } }, h('h2', { class: 'display', id: 'away-head' }, 'While you were away'), h('span', { class: 'when' }, `last here ${agoMs(r.since)}`)),
      lead ? h('p', { class: 'away-lead' }, cap(lead)) : null,
      h('ul', { class: 'away-list' }, ...rows),
      foes.length && !hasWyrm(p) ? h('p', { class: 'faint away-note' }, 'Hatch a new Elder Wyrm, and you can raid them back.') : null,
      h('div', { class: 'row end' }, h('button', { type: 'button', class: 'btn small ghost', 'data-key': 'away-done', 'aria-label': 'Got it: put the news away', onclick: () => {
        dismissAway(r.pid);
        // the card is gone: the warden's focus waits on the panel that takes its place
        const next = el.nextElementSibling as HTMLElement | null;
        if (next) { next.tabIndex = -1; next.focus({ preventScroll: true }); }
      } }, 'Got it')),
    ];
    el.append(...kids.filter((k): k is Node => !!k));
  }
  const offs = [onAway(paint), onRaidlog(() => paint()), empire.onChange(paint)];
  paint();
  return { el, paint, dispose: () => offs.forEach((f) => f()) };
}

/* ── The Chronicle's lines of harm ─────────────────────────────────────── */

/** What others did to the shown hold, for the Chronicle beside the warden's own rites. */
export function harmChronicle(player: () => PlayerState | null, mine: () => boolean, go: (route: string) => void): ChronicleExtra {
  return {
    lines(): ChronicleLine[] {
      const p = player();
      if (!p || !mine()) return [];
      const list = harms(p.playerId).slice(0, 60);
      // the newest raid of each raider carries the way back at them
      const backOn = new Map<string, string>();
      for (const x of list) if (x.kind === 'raid' && x.foe && !backOn.has(x.foe) && x.stage !== 'attackerDefeated' && x.stage !== 'attackerRetreated') backOn.set(x.foe, x.key);
      const out: { at: number; key: string; text: string; n: number; tone: string; back?: string }[] = [];
      for (const x of list) {
        const text = harmLine(x);
        // the same blow again and again reads as one line with a count
        const prev = out[out.length - 1];
        if (prev && prev.text === text) { prev.n = (prev.n || 1) + 1; continue; }
        const back = backOn.get(x.foe || '') === x.key && canRaidBack(p, x.foe);
        out.push({ at: x.at, key: x.key, text, n: 0, tone: grave(x) ? 'grave' : 'told', back: back ? x.foe : undefined });
      }
      return out.map((l) => ({ at: l.at, key: l.key, sig: `${l.key}|${l.text}|${l.n}|${l.back || ''}`, el: () => h('li', { class: `harm ${l.tone}` },
        h('span', { class: 'when', title: new Date(l.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }, agoMs(l.at)),
        h('span', null, l.text, l.n ? h('span', { class: 'herald-n', style: { marginLeft: '6px' } }, `×${l.n}`) : null,
          l.back ? [' ', raidBack(l.back, go)] : null)) }));
    },
    on(repaint: () => void) { const offs = [onRaidlog(repaint), onAway(repaint)]; return () => offs.forEach((f) => f()); },
  };
}

/* ── Raiders overhead: an alert on every screen until they leave ───────── */

/** The route the warden is on, whether the address carries it as a path or (an old link) a hash. */
const routeNow = () => (/^#\//.test(location.hash) ? decodeURIComponent(location.hash.slice(1)) : here());

let overhead: { fleetId: string; owner: string }[] = [];
let asked = 0, asking = false, lastIsle = '';
/** Ask who hangs over the warden's isle (when something says it may have changed, and every 20 s while anyone does). */
function checkOverhead(force = false) {
  const p = empire.commander;
  const isle = p?.planet ?? null;
  const mark = isle ? `${isle.Planet.id}|${isle.Planet.locationListStart}|${isle.Planet.locationListCount}|${isle.planetAttributes?.blockStartRaid || ''}` : '';
  if (!force && mark === lastIsle && Date.now() - asked < 20_000) return;
  if (asking) return;
  lastIsle = mark;
  if (!p || !isle?.Planet.locationListStart) { setOverhead([]); return; }
  asking = true; asked = Date.now();
  raidersAt(isle).then((r) => { if (empire.commander?.playerId === p.playerId) setOverhead(r); }, () => { /* asked again soon */ }).finally(() => { asking = false; });
}
const overheadL = new Set<() => void>();
function setOverhead(r: { fleetId: string; owner: string }[]) {
  if (JSON.stringify(r) === JSON.stringify(overhead)) return;
  const fresh = r.filter((x) => !overhead.some((o) => o.fleetId === x.fleetId));
  overhead = r;
  for (const f of overheadL) f();
  if (fresh.length) say(`Raiders hang over your isle: ${listOf(fresh.map((x) => whose(x.owner)))} ${fresh.length > 1 ? 'warbands' : 'warband'}. You can defend it in the Skirmish.`);
}

function mountAlert() {
  const text = h('span', { class: 'raid-alert-text' });
  const defend = h('button', { type: 'button', class: 'btn small ember', 'data-key': 'raid-alert-defend', onclick: () => { const r = overhead[0]; if (r) goTo(`/skirmish/${r.owner}`); } }, 'Defend');
  const el = h('aside', { class: 'raid-alert glass', 'aria-label': 'Raiders over your isle', hidden: true }, icon(ICON.warn, 16), text, defend);
  document.body.append(el);
  let sig = '';
  const paint = () => {
    const p = empire.commander;
    const [, , param] = routeNow().split('/');
    const route = document.body.dataset.route;
    // the warden's own Hold already says it in its notices; a Skirmish defending against them is the defence itself
    const quiet = !p || !overhead.length
      || (route === 'hold' && (!param || !!wallet.byPlayer(param)))
      || (route === 'skirmish' && (param ? overhead.some((r) => r.owner === param) : p.fleet?.status !== 'away'))
      || !!document.querySelector('.prologue');
    const names = overhead.map((r) => whose(r.owner));
    const s = JSON.stringify([quiet, names]);
    if (s === sig) return;
    sig = s;
    el.hidden = quiet;
    if (quiet) return;
    text.textContent = overhead.length > 1 ? `${listOf(names)} warbands hang over your isle.` : `${names[0]} warband hangs over your isle.`;
    defend.setAttribute('aria-label', `Defend your isle against ${names[0]} warband`);
  };
  overheadL.add(paint);
  onRaidlog(paint);
  empire.onChange(() => { checkOverhead(); paint(); });
  wallet.onChange(() => { checkOverhead(true); paint(); });
  live.onBlock(() => { if (overhead.length) checkOverhead(); });
  // a raid on our isle, in any stage: ask again at once
  onHarm((x) => { if (x.kind === 'raid') { lastIsle = ''; setTimeout(() => checkOverhead(true), 400); } });
  new MutationObserver(paint).observe(document.body, { attributes: true, attributeFilter: ['data-route'] });
  window.addEventListener('popstate', paint);
  window.addEventListener('hashchange', paint);
  window.addEventListener('wyrm:route', paint);
  checkOverhead(true);
  paint();
}

/* ── One of yours falls ─────────────────────────────────────────────────── */

function tellFalls() {
  onHarm((x, heardLive) => {
    if (!heardLive || !(x.fell || x.guardFell)) return;
    const line = harmLine(x);
    const lost = kind(x.guardFell ? x.guard : x.target);
    // after every other listener of this rite: the omens may already have told this one as a herald
    queueMicrotask(() => {
      if ([...document.querySelectorAll('#heralds .herald')].some((e) => (e.textContent || '').includes(`felled your ${lost}`))) return;
      // in the Skirmish the fray shows it; elsewhere it is a herald too
      if (document.body.dataset.route === 'skirmish') say(line); else toast(line, 'enemy', 9000);
    });
  });
}

let started = false;
/** Start hearing and telling raids on the warden's hold (once, at boot). */
export function watchRaids() {
  if (started) return;
  started = true;
  followRaidlog();
  followAway();
  tellFalls();
  mountAlert();
}
