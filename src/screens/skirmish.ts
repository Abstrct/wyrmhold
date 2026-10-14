/* The Skirmish: your warband against a real warden's hold. Their beasts are read from the ledger
 * (their hallows and any warband at home); yours are your warband. Strikes sign MsgStructAttack;
 * the plunder chant (MsgPlanetRaidComplete) is sung by the chant engine once their ward is open.
 *
 * The screen always says three things: what wins (fell their Elder Wyrm, then plunder), what the
 * chosen blow will likely do (it lands, who takes it, who strikes back), and what each blow did,
 * yours and theirs, as the ledger tells it. A wise blow is chosen for you until you choose. */
import { h, clear, toast, keepFocus } from '../core/dom';
import K from '../world/wyrmkit.js';
import { mountScene, type Ctx, type Screen } from './types';
import { topbar, hearts, icon, ICON } from '../ui/frame';
import { glyph } from '../ui/glyphs';
import { onPlunder, proclaim } from '../ui/omens';
import { claimJob, releaseClaim } from '../core/claims';
import { cursorTip } from '../ui/tip';
import { audio } from '../core/audio';
import { empire, type OwnedStruct, type PlayerState } from '../game/empire';
import { act, actionBlock } from '../game/actions';
import { wallet } from '../wallet/wallet';
import { txq, type TxJob } from '../wallet/queue';
import { live } from '../chain/live';
import { pow } from '../pow/pow';
import { typeOf, type Ambit } from '../data/catalogue';
import { REALM_COLOR, REALM_NAME, WARD_CRAFT, beastName, bellsAsTime, retellError } from '../lore';
import { playerName, raidersAt, realmOf, skyFull } from '../realm';
import { LONG_ASLEEP, NO_MENDING, alive, blowsWord, exposure, forecast, guardsOf, inRealm, isWyrm, kinds, moves, pct, reach, readBlow, tellBlow, wardKeeper, wisest, wyrmOf, type Blow, type Exposure, type Forecast, type Move } from '../game/war';

type Side = 'ours' | 'theirs';
interface Told { blow: Blow; at: number; ours: boolean; fresh: boolean }

export function skirmish(ctx: Ctx): Screen {
  const canvas = h('canvas');
  const tip = cursorTip(canvas);
  const bar = topbar('/skirmish', ctx.oath, { meters: true });
  const ours = h('aside', { class: 'glass panel scroll-y sk-ours', 'aria-label': 'Your warband' });
  const theirs = h('aside', { class: 'glass panel col-l scroll-y', 'aria-label': 'Their hold' });
  // the strike panel keeps its button between paints, so a click never lands on a control being replaced
  const sHead = h('div', { class: 'fc-head' });
  const sBody = h('div', { class: 'fc-body' });
  const sBtnLabel = h('span', { class: 'ub-l' }, 'Unleash');
  const sBtnSub = h('span', { class: 'ub-s' });
  const sBtnFill = h('span', { class: 'ub-fill', 'aria-hidden': 'true' });
  const sBtn = h('button', { type: 'button', class: 'btn ember unleash', 'data-tut': 'unleash', onclick: () => press() }, sBtnFill, sBtnLabel, sBtnSub);
  const sPending = h('div', { class: 'fc-pending', role: 'status', 'aria-live': 'polite' });
  const sNote = h('div');
  const viewSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Camera view' });
  // Fight on: the wisest blow, struck each time breath fills, until the Wyrm would be at risk
  const fightOnBtn = h('button', { type: 'button', class: 'fight-on', 'aria-pressed': 'false', title: 'Strike the wisest blow each time your breath fills. Stops if your Elder Wyrm would be at risk.', onclick: () => { fightOn = !fightOn; fightNote = ''; if (fightOn) chose = false; sigs.strike = ''; paint(); } },
    h('span', { class: 'fo-pip', 'aria-hidden': 'true' }), h('span', null, 'Fight on'));
  const strike = h('section', { class: 'glass panel strike-panel', 'aria-label': 'Strike' }, sHead, sBody,
    h('div', { class: 'row fc-act' }, sBtn, fightOnBtn, viewSeg), sPending, sNote);
  const fray = h('ol', { class: 'fray-list', 'aria-label': 'Blows struck' });
  const frayBox = h('section', { class: 'glass panel fray', 'aria-label': 'The fray' },
    h('div', { class: 'row between', style: { marginBottom: '8px' } }, h('h2', { class: 'display', style: { fontSize: '19px' } }, 'The fray'), h('span', { class: 'faint', style: { fontSize: '12px' } }, 'every blow, as the ledger tells it')), fray);
  const status = h('div', { class: 'warbar-slot' });
  // your side holds your warband and the fray; theirs, their hold; the strike floats between them
  const el = h('div', { class: 'screen' }, h('div', { class: 'stage' }, canvas),
    h('div', { class: 'hud sk-hud' }, bar.el, status,
      h('div', { class: 'isle-window', 'aria-hidden': 'true' }),
      h('div', { class: 'cols through' }, h('div', { class: 'col-l sk-left' }, ours, frayBox), theirs),
      h('div', { class: 'row strike-row' }, strike)));

  let targetPid: string | null = ctx.param || null;
  /** A raid won here this visit: the war bar ends on Plunder ✓ instead of starting over. */
  let won: { pid: string; seized: number; home?: boolean } | null = null;
  const offWon = onPlunder((d) => { const f = foe(); if (f && d.planetId === f.planetId) { won = { pid: f.playerId, seized: d.seized }; paint(); } });
  /** The striker and the mark, and whether the warden chose them (else the wisest blow is kept chosen). */
  let atk: string | null = null, mark: string | null = null, chose = false;
  let sceneKey = '';
  let scene: ReturnType<typeof mountScene<any>> | null = null;
  const watched = new Set<string>();
  const fallen = new Set<string>();
  /** Beasts the ledger says fell whose bolt is still in the air: they tumble when it lands, not before. */
  const fallingSoon = new Set<string>();
  const told: Told[] = [];
  /** This raid's tale: our blows, theirs felled, ours lost (reset when a fight begins). */
  let tally = { blows: 0, felled: [] as string[], lost: [] as string[] }, wasFighting = false;
  const listOf = (xs: string[]) => { const c = new Map<string, number>(); for (const x of xs) c.set(x, (c.get(x) || 0) + 1); const parts = [...c].map(([n, k]) => (k > 1 ? `${k} ${n}s` : `their ${n}`)); return parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0] || ''; };
  const tale = () => tally.blows ? ` In ${tally.blows} ${tally.blows === 1 ? 'blow' : 'blows'} you felled ${tally.felled.length ? listOf(tally.felled) : 'nothing'}${tally.lost.length ? `, and lost ${listOf(tally.lost).replace(/their /g, 'your ')}` : ', and lost nothing'}.` : '';
  const toldKeys = new Set<string>();
  const sigs: Record<string, string> = {};

  const me = () => empire.commander;
  const foe = (): PlayerState | null => (targetPid ? empire.players.get(targetPid) ?? null : null);
  const foeName = () => { const f = foe(); return f ? playerName(f) : 'their warden'; };

  /** If our warband is already abroad, the hold it circles is the foe. */
  let raidLook = 0;
  async function resolveTarget() {
    const p = me();
    if (!targetPid && p?.fleet?.status === 'away' && p.target) targetPid = p.target.Planet.owner;
    // Raiders over our own isle: they are the foe.
    if (!targetPid && p?.planet && Date.now() - raidLook > 4000) {
      raidLook = Date.now();
      const r = await raidersAt(p.planet).catch(() => []);
      if (left) return;
      if (r.length && !targetPid) { targetPid = r[0].owner; paint(); return; }
    }
    if (targetPid && !watched.has(targetPid) && !wallet.byPlayer(targetPid)) { watched.add(targetPid); empire.watch(targetPid); }
  }

  function ourBeasts(p: PlayerState | null) { return p ? [...p.structs.values()].filter((s) => alive(s) && s.type!.category === 'fleet') : []; }
  /** Our warband hangs over their isle. */
  function oursAbroad(): boolean {
    const p = me(), f = foe();
    return !!(p && f && p.fleet?.status === 'away' && p.fleet.locationId === f.planetId);
  }
  /** Their warband hangs over our isle while ours is home: we defend. */
  function defending(): boolean {
    const p = me(), f = foe();
    return !!(p && f && f.fleet?.status === 'away' && f.fleet.locationId === p.planetId && p.fleet?.status !== 'away');
  }
  function theirBeasts(f: PlayerState | null) {
    if (!f) return [];
    if (defending()) return [...f.structs.values()].filter((s) => alive(s) && s.type!.category === 'fleet');
    const home = f.fleet?.status !== 'away';
    return [...f.structs.values()].filter((s) => alive(s) && (s.type!.category === 'planet' || home));
  }
  const inFight = () => oursAbroad() || defending();

  /** Every blow our warband could strike, wisest first. */
  function allMoves(): Move[] { return moves(ourBeasts(me()), theirBeasts(foe()), me(), foe()); }
  /** The blow to suggest: one worth striking (or that wins the raid), never one that would surely fell the striker. */
  function suggestion(list = allMoves()): Move | null { return wisest(wardOpen() ? list.filter((m) => m.t.type?.category === 'fleet') : list); }
  /** In their sky with their ward broken: the raid is won by holding the sky, so hallows are not worth a blow. */
  const wardOpen = () => oursAbroad() && !wardKeeper(foe());

  /** Keep the striker and mark sensible as the fight changes; follow the wisest blow until the warden chooses. */
  function settlePicks(list: Move[]) {
    const p = me(), f = foe();
    const a = p?.structs.get(atk || ''), t = f?.structs.get(mark || '');
    if (atk && (!a || !alive(a))) { atk = null; chose = false; }
    if (mark && (!t || !alive(t) || !theirBeasts(f).some((s) => s.id === mark))) { mark = null; chose = false; }
    if (!chose || !atk || !mark) {
      const best = suggestion(list);
      if (best) { atk = best.a.id; mark = best.t.id; return; }
      // nothing in reach: point the Wyrm at their Wyrm, so the panel can say how to get there
      const ow = wyrmOf(p), tw = wyrmOf(f);
      if (!atk && ow && alive(ow)) atk = ow.id;
      if (!mark && tw && alive(tw) && theirBeasts(f).some((s) => s.id === tw.id)) mark = tw.id;
      else if (!mark) mark = theirBeasts(f).find((s) => s.type?.category === 'fleet')?.id || theirBeasts(f)[0]?.id || null;
    }
  }
  /** Choosing a mark brings a striker that can reach it (the one the warden chose, if it can). */
  function chooseMark(id: string) {
    const list = allMoves().filter((m) => m.t.id === id);
    if (atk && !list.some((m) => m.a.id === atk)) { const best = list[0]; if (best) atk = best.a.id; }
    else if (!atk && list[0]) atk = list[0].a.id;
    mark = id; chose = true; strikeNote = ''; paint();
  }
  /** Choosing a striker keeps the mark if it can reach it, else takes its wisest mark. */
  function chooseStriker(id: string) {
    atk = id; chose = true; strikeNote = '';
    const p = me(), f = foe(), a = p?.structs.get(id), t = f?.structs.get(mark || '');
    if (a && (!t || !reach(a, t).weapon)) { const best = allMoves().find((m) => m.a.id === id); if (best) mark = best.t.id; }
    paint();
  }

  function remountScene(p: PlayerState | null, f: PlayerState | null) {
    // the first sky waits (a few seconds at most) for both warbands, so it is built once, not twice
    if (!scene && Date.now() - openedAt < 4000 && ((targetPid && !f) || (wallet.active?.playerId && !p))) {
      if (!firstWait) firstWait = window.setTimeout(() => { firstWait = 0; paint(); }, 4000 - (Date.now() - openedAt));
      return;
    }
    const mineList = ourBeasts(p), theirList = theirBeasts(f);
    const key = mineList.map((s) => s.id).join(',') + '|' + theirList.map((s) => s.id).join(',');
    if (key === sceneKey && scene) return;
    // beasts that only fell have already tumbled out of the sky: no need to wake the whole isle again
    const had = new Set(sceneKey.split(/[|,]/).filter(Boolean)), now = key.split(/[|,]/).filter(Boolean);
    if (scene?.get() && now.every((id) => had.has(id)) && [...had].every((id) => now.includes(id) || fallen.has(id) || fallingSoon.has(id))) { sceneKey = key; return; }
    // a beast that just fell tumbles on the scene it fell in; rebuild once the tumble is over
    const since = Date.now() - fellAt;
    if (scene && since < 2600) { if (!remountLater) remountLater = window.setTimeout(() => { remountLater = 0; paint(); }, 2700 - since); return; }
    sceneKey = key;
    tip.show(null); // the old scene's hover never says goodbye
    scene?.dispose();
    const pack = (list: OwnedStruct[]) => list.map((s) => ({ id: s.id, type: s.typeId, realm: s.type!.category === 'fleet' ? realmOf(s) : undefined, roams: s.type!.category === 'fleet', label: beastName(s.typeId) }));
    scene = mountScene(canvas, (c) => K.skirmish(c, {
      ours: pack(mineList), theirs: pack(theirList),
      // a nameless warden is "Warden 1-2", never a bare ledger mark
      oursName: me() ? playerName(me()!) : undefined, theirsName: foe() ? playerName(foe()!) : undefined, hasFoe: !!foe(),
      oursAbroad: oursAbroad(), theirsAbroad: defending(),
      // the war bar hangs over the top of the sky: words that rise from the beasts stay below it
      clearTop: () => Math.max(0, status.getBoundingClientRect().bottom - canvas.getBoundingClientRect().top),
      onPick: (id: string | null) => { if (!id) return; if (mineList.some((s) => s.id === id)) chooseStriker(id); else chooseMark(id); },
      onHover: (id: string | null) => {
        const o = mineList.find((s) => s.id === id), t = theirList.find((s) => s.id === id), s = o || t;
        tip.show(s ? `${beastName(s.typeId)} · ${s.health} of ${s.type!.maxHealth} hearts` : null, o ? 'yours · click to strike with it' : 'theirs · click to mark it');
      },
    }), (c) => { c.mark('a', atk); c.mark('t', mark); c.mark('g', guardId); if (view !== 'all') c.view(view); });
  }
  let fellAt = 0, remountLater = 0, firstWait = 0, left = false, guardId: string | null = null;
  const openedAt = Date.now();
  let readingSince = 0, slowCheck = 0, readingFor: string | undefined;   // when we began waiting for a sworn warden's warband to be read

  /* ── striking ─────────────────────────────────────────────────────── */

  /** The strike rite in flight for this warden, if any (one at a time: breath is shared). */
  const pendingStrike = (): TxJob | undefined => { const p = me(); return p ? txq.active.find((j) => j.playerId === p.playerId && j.msgs.some((m) => /MsgStructAttack$/.test(m.typeUrl))) : undefined; };

  /** The big button does the next thing: ride out when at home, strike when in their sky. */
  function press() {
    const p = me(), f = foe();
    if (!p || !f) return;
    if (won && won.pid === targetPid) { ctx.go('/hold'); return; }
    if (!inFight()) {
      const w = wyrmOf(p), g = w && alive(w) && !unguardedOk ? guardFor(p, w) : null;
      if (g && w && !guarding) { guardWyrm(g, w); return; }
      // a Wyrm on its last hearts rides only on a second, deliberate press: a raid rides on it
      if (w && alive(w) && w.health <= 2 && menaced(w) && !confirmed('ride')) return;
      armed = null;
      rideOut(); return;
    }
    const wise = fightDefault();
    if (wise === 'guard') { const w = wyrmOf(p)!, g = guardFor(p, w)!; guardWyrm(g, w); return; }
    if (wise === 'home') { rideHome(); return; }
    const job = pendingStrike();
    if (job && ['queued', 'waiting'].includes(job.status)) {
      txq.cancel(job.id);
      // calling a blow off calls Fight on off too, or it would only strike again
      if (fightOn) { fightOn = false; fightNote = 'Fight on rests: you called the blow off.'; sigs.strike = ''; }
      paint(); return;
    }
    unleash();
  }
  function rideOut() {
    const p = me(), f = foe();
    if (!p || !f) return;
    const full = skyFull(f.planet, p);
    if (full) { say(full); return; }
    try { act.fleetMove(p, f.planetId); toast(`Your warband rides for ${playerName(f)}’s isle.`, 'player', 3000); } catch (e) { say(retellError((e as Error).message)); }
  }
  function rideHome() {
    const p = me(); if (!p) return;
    try { act.fleetMove(p, p.planetId); } catch (e) { say(retellError((e as Error).message)); }
  }
  /** Trouble is told under the button, where the warden is looking. */
  function say(t: string) { if (strike.hidden) { toast(t, 'enemy', 7000); return; } strikeNote = t; paint(); }

  function unleash() {
    const p = me(), f = foe();
    const a = p?.structs.get(atk || ''), t = f?.structs.get(mark || '');
    if (!p || !a || !t) return;
    if (!wallet.unlocked) { say('Your soulstone is sealed: unseal it from the top bar to strike.'); return; }
    const block = actionBlock(p); if (block) { say(retellError(block)); return; }
    if (!a.online) { say(`Your ${beastName(a.typeId)} slumbers: wake it at your Hold to strike with it.`); return; }
    const r = reach(a, t);
    if (!r.weapon) { if (r.soar) soar(a, r.soar); else say(retellError(r.why)); return; }
    // a blow whose answer would likely fell your Wyrm is struck only on a second, deliberate press
    const fc = forecast(a, t, r.weapon, f);
    if (fc && isWyrm(a) && fc.lost >= 0.5 && !fightOn && !confirmed(`${a.id}>${t.id}`)) return;
    armed = null;
    strikeNote = '';
    try {
      const job = act.attack(p, a, [t.id], r.weapon);
      claimJob(job.id); pendingClaims.add(job.id);
      // the queue says "done" a moment before this blow's events are read: Fight on waits for them
      unheard = job.id;
      const off = txq.onSettled((j) => {
        if (j.id !== job.id) return;
        off(); pendingClaims.delete(j.id);
        if (unheard === j.id) unheard = null;
        if (j.status === 'success') hear(j.events || [], j.hash || j.id, j.height);
        else if (j.status === 'failed') {
          // Fight on never strikes again into a refusal: it rests and says why
          if (fightOn) { fightOn = false; fightNote = 'Fight on stops: the last blow was refused.'; }
          say(`The blow did not land: ${retellError(j.error || 'the ledger refused')}.`);
        }
        paint();
      });
      settleOffs.push(off);
      // a strike chosen for us this time is still ours next time: stop following the suggestion
      chose = true;
      paint();
    } catch (e) { say(retellError((e as Error).message)); }
  }
  /** The Elder Wyrm strikes only in its own realm: soaring there is one rite. */
  function soar(a: OwnedStruct, to: Ambit) {
    const p = me(); if (!p) return;
    if (!wallet.unlocked) { say('Your soulstone is sealed: unseal it from the top bar.'); return; }
    try { act.move(p, a, 'fleet', to, 0); toast(`Your Elder Wyrm soars into ${inRealm(to)}.`, 'player', 3500); } catch (e) { say(retellError((e as Error).message)); }
  }
  let strikeNote = '', lastAM = '';
  /** A deadly blow (or ride) pressed once: it waits for a second, deliberate press. */
  let armed: { key: string; at: number } | null = null, armTimer = 0;
  /** A second press this soon after the first is the same tap twice (a double-tap, a held key), not a choice. */
  const ARM_GAP = 600;
  /** True when this press confirms the deadly `key`; otherwise it arms it (or is ignored as too quick) and
   * the button asks again. The question stays while the pointer or the focus is on the button, and goes
   * a few seconds after both have left. */
  function confirmed(key: string): boolean {
    if (armed?.key === key) {
      if (Date.now() - armed.at >= ARM_GAP) return true;
      return false;   // the double-tap's second tap: ignored, the question stands
    }
    armed = { key, at: Date.now() };
    clearTimeout(armTimer);
    const check = () => {
      if (!armed || armed.key !== key || left) return;
      if (sBtn.matches(':hover') || document.activeElement === sBtn) { armTimer = window.setTimeout(check, 1000); return; }
      armed = null; paintButton();
    };
    armTimer = window.setTimeout(check, 5000);
    paintButton();
    // said once, out loud, without a new line under the button: a button that moved would catch a double-tap's
    // second tap on whatever slid under it, and lose the pointer that keeps the question standing
    sAlert.textContent = armWarn;
    return false;
  }
  /** What the armed button will do, in a sentence (set when the button is painted armed). */
  let armWarn = '';
  let fightOn = false, fightNote = '', autoBusy = false, unheard: string | null = null;
  /** The blow Fight on would strike: the wisest that never risks the Elder Wyrm, and never one that could fell the striker outright. */
  function autoMove(list: Move[]): Move | null { return wisest(list, (m) => (isWyrm(m.a) ? m.f.lost === 0 : m.f.lost < 0.5)); }
  /** Each bell: if Fight on is set and breath allows, strike; stop, and say why, when it should not go on. */
  function fightOnTick() {
    if (!fightOn || autoBusy || left) return;
    const p = me(); if (!p) return;
    const stop = (why: string) => { fightOn = false; fightNote = why; sigs.strike = ''; queueMicrotask(paint); };
    if (!inFight() || (won && won.pid === targetPid)) { stop(''); return; }
    // once their ward is broken the raid is won by holding their sky, not by striking: rest
    if (oursAbroad() && !wardKeeper(foe())) { stop('Fight on rests: their ward is broken. Hold their sky while your chant plunders.'); return; }
    if (pendingStrike() || unheard || guarding) return;
    const w = wyrmOf(p);
    // a Wyrm whose guard fell is guarded again before the next blow, as the big button would
    const g = w && alive(w) && !unguardedOk ? guardFor(p, w) : null;
    if (g && w) { autoBusy = true; queueMicrotask(() => { try { guardWyrm(g, w); } finally { autoBusy = false; } }); return; }
    const m = autoMove(allMoves());
    if (!m) { stop('Fight on stops: no blow in reach is safe for your Wyrm.'); return; }
    // a wounded Wyrm fights on only to strike the blow that surely ends it
    const finisher = isWyrm(m.t) && m.f.fellMark >= 0.995;
    if (w && alive(w) && w.health <= 2 && oursAbroad() && menaced(w) && !finisher) { stop(`Fight on stops: your Elder Wyrm has ${w.health} ${w.health === 1 ? 'heart' : 'hearts'}. Strike by hand, or ride home.`); return; }
    if (atk !== m.a.id || mark !== m.t.id) { atk = m.a.id; mark = m.t.id; chose = false; sigs.strike = ''; }
    const cost = m.f.arm.charge;
    if (empire.charge(p) < cost) return;
    autoBusy = true;
    // strike outside this paint: unleash repaints the screen itself
    queueMicrotask(() => {
      try {
        strikeNote = '';
        unleash(); chose = false;
        // a blow that could not even be sent (a sealed soulstone, an overdrawn leyweave) ends Fight on
        if (strikeNote && !pendingStrike()) { fightOn = false; fightNote = 'Fight on stops: ' + strikeNote.charAt(0).toLowerCase() + strikeNote.slice(1); sigs.strike = ''; paint(); }
      } finally { autoBusy = false; }
    });
  }
  const settleOffs: (() => unknown)[] = [];
  const pendingClaims = new Set<string>();

  /* ── the fray: every blow, told and shown ─────────────────────────── */

  const whose = (ownerId?: string) => { const p = me(); if (p && ownerId === p.playerId) return 'your'; const o = ownerId ? empire.players.get(ownerId) : null; return o ? `${playerName(o)}’s` : 'their'; };
  function ownerOf(structId: string): string | undefined { for (const pl of empire.players.values()) if (pl.structs.has(structId)) return pl.playerId; return undefined; }
  const who = (id: string, typeId: number, ownerId?: string) => `${whose(ownerId || ownerOf(id))} ${beastName(typeId || empire.ownerOf(id)?.structs.get(id)?.typeId || 0)}`;

  /** What the ledger says a blow did is true now, before the next read of either warden lands: hearts, falls,
   * and the striker's spent breath. Without this, Fight on struck a beast that had already fallen. */
  function applyBlow(bw: Blow, height?: number) {
    const find = (id: string) => { for (const pl of empire.players.values()) { const st = pl.structs.get(id); if (st) return { pl, st }; } return null; };
    const set = (id: string | undefined, hp: number | undefined, felled: boolean) => {
      const f = id ? find(id) : null; if (!f) return;
      if (hp != null && Number.isFinite(hp)) f.st.health = hp;
      if (felled) { f.st.health = 0; f.st.destroyed = true; }
    };
    for (const sh of bw.shots) {
      set(sh.targetId, sh.targetHpAfter, sh.targetFelled);
      if (sh.blockerId) set(sh.blockerId, sh.blockerHpAfter, sh.blockerFelled);
    }
    set(bw.attackerId, bw.attackerHpAfter, bw.attackerFelled);
    // any rite spends all of a warden's breath: the striker's owner starts again from this bell
    const owner = bw.attackerOwner ? empire.players.get(bw.attackerOwner) : null;
    if (owner && height && height > owner.lastAction) owner.lastAction = height;
  }

  /** A rite's events (from our own settled strike, or the live feed): tell each blow once. */
  function hear(events: { type: string; data: unknown }[], key: string, height?: number) {
    events.forEach((e, i) => {
      if (e.type !== 'EventAttack') return;
      const k = `${key}:${i}`;
      const bw = readBlow(e.data, k, (id) => typeOf(id));
      if (!bw) return;
      // the same blow arrives twice (our settled rite and the live feed): know it by what it was
      const sig = `${bw.attackerId}>${bw.shots.map((s) => `${s.targetId}:${s.targetHpAfter}:${s.evaded}:${s.damage}`).join(',')}:${bw.attackerHpAfter}`;
      if (toldKeys.has(sig)) return;
      const p = me(), f = foe();
      const party = new Set([p?.playerId, f?.playerId].filter(Boolean) as string[]);
      const touches = party.has(bw.attackerOwner) || bw.shots.some((s) => party.has(s.targetOwner));
      if (!touches) return;
      toldKeys.add(sig);
      if (scene?.get()) for (const sh of bw.shots) { if (sh.targetFelled) fallingSoon.add(sh.targetId); if (sh.blockerFelled && sh.blockerId) fallingSoon.add(sh.blockerId); }
      if (scene?.get() && bw.attackerFelled) fallingSoon.add(bw.attackerId);
      applyBlow(bw, height);
      const ours = !!p && bw.attackerOwner === p.playerId;
      told.unshift({ blow: bw, at: Date.now(), ours, fresh: true });
      // the tale keeps count
      if (ours) tally.blows++;
      const fell = (id: string, typeId: number, owner?: string) => { const o = owner || ownerOf(id); if (o === p?.playerId) tally.lost.push(beastName(typeId)); else if (o === f?.playerId) tally.felled.push(beastName(typeId)); };
      for (const sh of bw.shots) { if (sh.targetFelled) fell(sh.targetId, sh.targetType, sh.targetOwner); if (sh.blockerFelled && sh.blockerId) fell(sh.blockerId, sh.blockerType || 0); }
      if (bw.attackerFelled) fell(bw.attackerId, bw.attackerType, bw.attackerOwner);
      if (told.length > 12) told.length = 12;
      show(bw, ours);
      herald(bw, ours);
    });
    paintFray();
    paint();
  }
  const offTx = live.onTx((tx) => { if (tx.events.some((e) => e.type === 'EventAttack')) hear(tx.events, tx.hash || String(tx.height), tx.height); });

  /** The blow in the sky: the bolt, the words that rise, the answers flying back, the fallen tumbling. */
  function show(bw: Blow, ours: boolean) {
    const ctl = scene?.get(); if (!ctl) return;
    const sh = bw.shots[0]; if (!sh) return;
    const color = ours ? 0xffc04a : 0xff5a3a, answer = ours ? 0xb49bff : 0x8fd8ff;
    const onId = sh.blockerId || sh.targetId;
    const fellThem = (id: string) => { fallingSoon.delete(id); if (fallen.has(id)) return; fallen.add(id); fellAt = Date.now(); window.setTimeout(() => ctl.fell(id), 380); };
    ctl.strike(bw.attackerId, onId, { color, guided: bw.guided, miss: sh.evaded, done: () => {
      if (sh.evaded) ctl.pop(sh.targetId, sh.evadedBy ? `${sh.evadedBy}!` : 'Turned aside', 'miss');
      else if (sh.blockerId) { ctl.pop(sh.blockerId, sh.damage ? `−${sh.damage}` : 'No harm', 'guard'); ctl.pop(sh.targetId, 'Guarded', 'guard'); }
      else ctl.pop(sh.targetId, sh.damage ? `−${sh.damage}` : 'No harm', sh.damage ? 'hit' : 'miss');
      if (!sh.evaded) audio.bell(ours ? 220 : 174.6, 0.1, 1.1);
      if (!sh.evaded && sh.damage >= 2) ctl.shake(0.45);
      if (sh.targetFelled || sh.blockerFelled) ctl.shake(isWyrm(empire.ownerOf(sh.targetId)?.structs.get(sh.targetId)) ? 1.3 : 0.8);
      if (sh.blockerFelled && sh.blockerId) { ctl.pop(sh.blockerId, 'Falls!', 'fell'); fellThem(sh.blockerId); }
      if (sh.targetFelled) { ctl.pop(sh.targetId, 'Falls!', 'fell'); fellThem(sh.targetId); audio.bell(130.8, 0.18, 2.6); }
      let delay = 320;
      const back = (from: string, dmg: number) => { window.setTimeout(() => ctl.strike(from, bw.attackerId, { color: answer, dur: 0.55, done: () => ctl.pop(bw.attackerId, `−${dmg}`, 'back') }), delay); delay += 280; };
      for (const c of sh.counters) if (c.dmg) back(c.by, c.dmg);
      if (sh.back) back(sh.targetId, sh.back);
      if (bw.cannon) back(sh.targetId, bw.cannon);
      if (bw.attackerFelled) window.setTimeout(() => { ctl.pop(bw.attackerId, 'Falls!', 'fell'); fellThem(bw.attackerId); }, delay + 500);
    } });
  }

  /** The moments that matter get the whole sky. */
  function herald(bw: Blow, ours: boolean) {
    const p = me(), f = foe();
    const myWyrm = wyrmOf(p)?.id, theirWyrm = wyrmOf(f)?.id;
    const felled = new Set<string>();
    for (const s of bw.shots) { if (s.targetFelled) felled.add(s.targetId); if (s.blockerFelled && s.blockerId) felled.add(s.blockerId); }
    if (bw.attackerFelled) felled.add(bw.attackerId);
    if (theirWyrm && felled.has(theirWyrm)) {
      audio.bell(523.25, 0.2, 3); window.setTimeout(() => audio.bell(783.99, 0.16, 3), 200);
      if (defending()) proclaim('The raid is broken!', `${foeName()}’s Elder Wyrm falls over your isle. Their warband flees.`, 'gold');
      else proclaim('Their Elder Wyrm falls!', `${foeName()}’s ward is broken. Hold their sky: your chant now plunders their wildroot.`, 'gold');
    } else if (myWyrm && felled.has(myWyrm)) {
      audio.stinger('vulnerable', 1);
      proclaim('Your Elder Wyrm has fallen', defending() ? 'Your isle lies open to their chant.' : 'The raid is broken, and your warband limps home. A fallen Wyrm hatches anew at full hearts.', 'ember');
    } else if (!ours && myWyrm && bw.shots.some((s) => s.targetId === myWyrm && !s.evaded && !s.blockerId && s.damage)) {
      const w = p?.structs.get(myWyrm), left = bw.shots.find((s) => s.targetId === myWyrm)?.targetHpAfter ?? w?.health ?? 0;
      if (left <= 2) toast(`Your Elder Wyrm is down to ${left} ${left === 1 ? 'heart' : 'hearts'}, and wounds never mend. If it falls, ${oursAbroad() ? 'the raid breaks' : 'your isle lies open'}.`, 'enemy', 6000);
    }
    // a struck beast's hearts change on the ledger: read both wardens now, not at the next sweep
    if (p) void empire.refresh(p.playerId);
    if (f && f.playerId !== p?.playerId) void empire.refresh(f.playerId);
  }

  function paintFray() {
    clear(fray);
    frayBox.hidden = !told.length;
    for (const t of told.slice(0, 8)) {
      const { head, bits } = tellBlow(t.blow, who);
      // only a blow just told slides in; the rest stay put as the list is rebuilt
      const cls = 'fray-row ' + (t.ours ? 'ours' : 'theirs') + (t.fresh ? ' fresh' : '');
      t.fresh = false;
      fray.append(h('li', { class: cls },
        h('span', { class: 'fray-ic', 'aria-hidden': 'true' }, glyph(t.ours ? 'skirmish' : 'ward', 15)),
        h('div', { class: 'fray-txt' }, h('p', { class: 'fray-head' }, head),
          h('p', { class: 'fray-bits' }, ...bits.map((b) => h('span', { class: 'fb ' + b.tone }, b.text))))));
    }
  }

  /* ── painting ─────────────────────────────────────────────────────── */

  // the panels rebuild as the ledger moves; keyboard focus survives it
  function paint() { if (!left) keepFocus(el, paintNow); }
  function paintNow() {
    if (left) return; // a late ledger answer after leaving must not watch anyone again
    const am = `${atk || ''}|${mark || ''}`;
    if (am !== lastAM) { lastAM = am; strikeNote = ''; }
    void resolveTarget();
    const p = me(), f = foe();
    if (p) { readingSince = 0; clearTimeout(slowCheck); }
    const ctl = scene?.get();
    // fallen beasts tumble once (the ones the fray did not already fell)
    for (const pl of [f, p]) if (pl) for (const s of pl.structs.values()) if (s.destroyed && !fallen.has(s.id) && !fallingSoon.has(s.id)) { fallen.add(s.id); if (ctl) { ctl.fell(s.id); fellAt = Date.now(); } }
    const list = allMoves();
    settlePicks(list);
    const a = p?.structs.get(atk || ''), t = f?.structs.get(mark || '');
    const r = a && t ? reach(a, t) : null;
    const fc: Forecast | null = a && t && r?.weapon ? forecast(a, t, r.weapon, f) : null;
    guardId = fc?.guard?.id || null;
    remountScene(p, f);
    const sc = scene?.get();
    sc?.mark('a', atk); sc?.mark('t', mark); sc?.mark('g', guardId);
    // a warband over the other isle is drawn there, and flies when it rides
    sc?.abroad('ours', oursAbroad()); sc?.abroad('theirs', defending());
    // a fight that begins starts a new tale
    const fighting = inFight();
    if (fighting && !wasFighting && !(won && won.pid === targetPid)) tally = { blows: 0, felled: [], lost: [] };
    wasFighting = fighting;
    // a won raid stays won until the warband rides out again (a new raid, even on the same hold)
    if (won && won.pid === targetPid && !inFight()) won.home = true;
    if (won && won.home && inFight()) won = null;

    paintWarbar(p, f);
    paintOurs(p, list);
    paintTheirs(p, f, list);
    paintStrike(p, a, t, r, fc, list);
    paintButton();
  }

  /** One section repaints only when what it says has changed. */
  const changed = (k: string, sig: string) => { if (sigs[k] === sig) return false; sigs[k] = sig; return true; };

  /** Where the raid stands, what wins it, and the one thing to do next. */
  function paintWarbar(p: PlayerState | null, f: PlayerState | null) {
    const lines: { step?: number; title: string; line: string; tone: 'gold' | 'ember' | 'calm'; act?: [string, () => void, boolean?]; wyrm?: OwnedStruct | null; guards?: OwnedStruct[]; plunder?: number | null; warn?: string }[] = [];
    const myW = wyrmOf(p);
    const lowWyrm = myW && alive(myW) && myW.health <= Math.ceil(myW.type!.maxHealth / 3) && inFight() ? `Your Elder Wyrm has ${myW.health} of ${myW.type!.maxHealth} hearts. If it falls, ${defending() ? 'your isle lies open' : 'the raid breaks'}. ${NO_MENDING}` : undefined;
    // a wounded Wyrm at home: no rite heals it, and the warden should know before riding on it
    const wounded = myW && alive(myW) && myW.health < myW.type!.maxHealth && !inFight() ? `Your Elder Wyrm has ${myW.health} of ${myW.type!.maxHealth} hearts. ${NO_MENDING}` : undefined;
    if (!p) {
      if (!wallet.active?.playerId) lines.push({ title: 'You have no warband yet', line: 'Swear the oath: your Elder Wyrm hatches, and your warband with it.', tone: 'calm', act: ['Swear the oath', ctx.oath, true] });
      else {
        // a ledger that stays silent is said plainly, with a way to ask again
        if (!readingSince || readingFor !== wallet.active.playerId) { readingFor = wallet.active.playerId; readingSince = Date.now(); clearTimeout(slowCheck); slowCheck = window.setTimeout(() => paint(), 15500); }
        lines.push(Date.now() - readingSince < 15000 ? { title: 'Reading your warband…', line: 'From the ledger.', tone: 'calm' }
          : { title: 'The ledger is not answering yet', line: 'Your warband appears the moment it does.', tone: 'calm', act: ['Try again', () => empire.refresh(wallet.active?.playerId)] });
      }
    } else if (won && won.pid === targetPid) {
      lines.push({ step: 4, title: won.seized > 0 ? 'Raid won!' : 'Raid won, but the cupboard was bare', line: (won.seized > 0 ? `${won.seized === 1 ? 'A sheaf of wildroot rides' : `${won.seized} sheaves of wildroot ride`} home with you. Brew ${won.seized === 1 ? 'it' : 'them'} before anyone takes ${won.seized === 1 ? 'it' : 'them'} back.` : 'Their isle held nothing unbrewed this time.') + tale(), tone: 'gold', act: ['Go to your Hold', () => ctx.go('/hold'), true] });
    } else if (!targetPid) {
      lines.push({ step: 0, title: 'Choose a hold to raid', line: 'Wardens with wildroot left unbrewed are worth the ride. Find one in the Sky Atlas.', tone: 'calm', act: ['Open the Atlas', () => ctx.go('/atlas'), true] });
    } else if (!f) {
      lines.push({ step: 0, title: 'Scrying their hold…', line: 'Reading their beasts from the ledger.', tone: 'calm' });
    } else if (defending()) {
      const tw = wyrmOf(f);
      lines.push({ title: 'Raiders over your isle!', line: tw && alive(tw) ? `Fell ${foeName()}’s Elder Wyrm and their raid breaks. Until then they chant against your ward.` : `${foeName()}’s Elder Wyrm has fallen: their raid is broken.`, tone: 'ember', wyrm: tw, guards: tw ? guardsOf(tw, f) : [], warn: lowWyrm });
    } else if (!oursAbroad() && (!myW || !alive(myW) || !myW.online)) {
      // a warband rides on its Elder Wyrm: without one awake, it cannot leave the isle
      const dead = !myW || !alive(myW);
      lines.push({ step: 1, title: dead ? 'Your Elder Wyrm has fallen' : 'Your Elder Wyrm slumbers', line: (dead ? 'Every raid rides on its back. Hatch a new one at your Hold, then come back for them.' : 'A warband rides on its Wyrm: wake it at your Hold before you ride out.') + (dead ? tale() : ''), tone: 'ember', act: [dead ? 'Hatch anew at your Hold' : 'Wake it at your Hold', () => ctx.go('/hold'), true] });
    } else if (!oursAbroad()) {
      const keeper = wardKeeper(f), tw = wyrmOf(f);
      const loot = f.ore > 0 ? `their ${f.ore} ${f.ore === 1 ? 'sheaf' : 'sheaves'} of wildroot` : 'whatever wildroot they leave unbrewed';
      lines.push({ step: 1, title: `Raid ${foeName()}’s hold`, line: keeper ? `Ride out, fell their Elder Wyrm, and your chant carries off ${loot}. While you are away, your own hold stands unguarded.` : `Their Elder Wyrm ${tw && alive(tw) ? 'is away' : 'has fallen'}: their ward is open. Ride out and your chant carries off ${loot}.`, tone: 'gold', wyrm: keeper ? tw : null, guards: keeper && tw ? guardsOf(tw, f) : [], warn: wounded });
    } else {
      const keeper = wardKeeper(f), tw = wyrmOf(f);
      const task = pow.active.find((x) => x.kind === 'raid' && x.playerId === p.playerId);
      const pctDone = task ? Math.round(Math.min(100, ((task.best?.zeros ?? 0) / Math.max(1, pow.required(task))) * 100)) : null;
      if (keeper) {
        const g = guardsOf(keeper, f);
        lines.push({ step: 2, title: `Fell ${foeName()}’s Elder Wyrm`, line: g.length ? `Their ${g.map((x) => beastName(x.typeId)).join(' and ')} ${g.length > 1 ? 'guard' : 'guards'} it and ${g.length > 1 ? 'take' : 'takes'} the blows meant for it. While their Wyrm stands, their ward holds and the plunder waits.` : 'While it stands, their ward holds and the plunder waits.', tone: 'ember', act: ['Ride home', rideHome], wyrm: tw, guards: g, warn: lowWyrm });
      } else {
        lines.push({ step: 3, title: 'Their ward is broken: plundering!', line: f.ore > 0 ? `Hold their sky until your chant lands: ${f.ore} ${f.ore === 1 ? 'sheaf' : 'sheaves'} of wildroot to carry off.` : 'Their isle holds no wildroot unbrewed right now; your chant takes whatever is there when it lands.', tone: 'gold', act: ['Ride home', rideHome], plunder: pctDone, warn: lowWyrm });
      }
    }
    const L = lines[0];
    // a Wyrm without a guard, in a fight or about to ride: one tap sets the best one beside it
    const wg = myW && alive(myW) && !(won && won.pid === targetPid) && f && (inFight() || L.step === 1) ? guardFor(p!, myW) : null;
    // the plunder bar moves every few seconds: it is updated in place, never by a rebuild under the cursor
    const sig = JSON.stringify([L.step, L.title, L.line, L.tone, L.act?.[0], L.wyrm?.health, L.wyrm?.id, (L.guards || []).map((g) => g.id + g.health), L.plunder != null, L.warn, !!p && !defending(), wg?.id, guarding, unguardedOk, inFight()]);
    if (!changed('warbar', sig)) { if (L.plunder != null && plunderBar && plunderPct) { plunderBar.style.width = Math.max(4, L.plunder) + '%'; plunderPct.textContent = `${L.plunder}%`; } return; }
    clear(status);
    plunderBar = L.plunder != null ? h('i', { style: { width: Math.max(4, L.plunder) + '%' } }) : null;
    plunderPct = L.plunder != null ? h('span', { class: 'mono' }, `${L.plunder}%`) : null;
    const steps: [string, number][] = [['Choose a foe', 0], ['Ride out', 1], ['Fell their Wyrm', 2], ['Plunder', 3]];
    const at = L.step ?? -1;
    const stepper = p && !defending() && L.step != null ? h('ol', { class: 'stepper', 'aria-label': 'Raid steps' }, ...steps.map(([label, i]) => {
      const state = at === 4 || i < at ? 'done' : i === at ? (i === 3 ? 'run' : 'now') : '';
      return h('li', { class: state, 'aria-current': state === 'now' || state === 'run' ? 'step' : undefined }, h('span', { class: 'n' }, state === 'done' ? '✓' : String(i + 1)), h('span', { class: 't' }, label));
    })) : null;
    status.append(h('div', { class: `glass warbar ${L.tone}`, role: 'status' },
      stepper,
      h('div', { class: 'wb-main' },
        h('div', { class: 'wb-text' },
          h('p', { class: 'wb-title' }, L.title),
          h('p', { class: 'wb-line' }, L.line),
          L.wyrm && alive(L.wyrm) ? h('p', { class: 'wb-wyrm' }, h('span', { class: 'k' }, 'Their Elder Wyrm'),
            h('span', { class: 'hearts', role: 'img', 'aria-label': `vigor ${L.wyrm.health} of ${L.wyrm.type!.maxHealth}` }, hearts(L.wyrm.health, L.wyrm.type!.maxHealth)),
            ...(L.guards || []).map((g) => h('span', { class: 'wb-guard' }, glyph('ward', 13), `${beastName(g.typeId)} guards it`, h('span', { class: 'hearts', role: 'img', 'aria-label': `vigor ${g.health} of ${g.type!.maxHealth}` }, hearts(g.health, g.type!.maxHealth))))) : null,
          plunderBar && plunderPct ? h('p', { class: 'wb-plunder' }, h('span', { class: 'k' }, 'Plunder chant'), h('span', { class: 'bar' }, plunderBar), plunderPct) : null,
          L.warn ? h('p', { class: 'wb-warn' }, icon(ICON.warn, 14), L.warn) : null,
          wg ? h('p', { class: 'wb-guardme' }, glyph('ward', 14), h('span', null, 'Your Elder Wyrm stands unguarded.'),
            h('button', { type: 'button', class: 'btn small', disabled: guarding, onclick: () => guardWyrm(wg, myW!) }, guarding ? 'Setting the guard…' : `Guard it with your ${beastName(wg.typeId)}`, h('span', { class: 'cost' }, `${wg.type!.defendChangeCharge} breath`)),
            !inFight() && !unguardedOk ? h('button', { type: 'button', class: 'btn small ghost', onclick: () => { unguardedOk = true; sigs.warbar = ''; rideOut(); } }, 'Ride out unguarded') : null) : null),
        L.act ? h('button', { type: 'button', class: L.act[2] ? 'btn gold' : 'btn small', 'data-tut': L.act[0] === 'Ride home' ? 'home' : null, onclick: L.act[1] }, L.act[0]) : null)));
  }

  let plunderBar: HTMLElement | null = null, plunderPct: HTMLElement | null = null;
  let guarding = false;
  /** In a fight, what the big button should do before any blow: guard an unguarded Wyrm again, or take a Wyrm
   * on its last hearts home when something of theirs can still strike it and no blow surely ends their Wyrm. Never while a blow is in flight or chosen by hand. */
  function fightDefault(): 'guard' | 'home' | null {
    const p = me(); if (!p || !inFight() || chose || pendingStrike() || guarding) return null;
    const w = wyrmOf(p); if (!w || !alive(w)) return null;
    if (!unguardedOk && guardFor(p, w)) return 'guard';
    if (oursAbroad() && w.health <= 2 && menaced(w)) {
      const best = suggestion();
      const finisher = best && isWyrm(best.t) && best.f.fellMark >= 0.995 && best.f.lost === 0;
      if (!finisher) return 'home';
    }
    return null;
  }
  /** Something of theirs still stands that can strike our Wyrm in its realm: only then is a low Wyrm in danger. */
  function menaced(w: OwnedStruct): boolean { return theirBeasts(foe()).some((s) => !!reach(s, w).weapon); }
  /** The warden chose to ride without setting a guard: the big button stops offering one. */
  let unguardedOk = false;
  /** The best guard for our Wyrm: one in its realm blocks the blow, any other still strikes back; the hardiest first. */
  function guardFor(p: PlayerState, w: OwnedStruct): OwnedStruct | null {
    if (guardsOf(w, p).length) return null;
    const free = ourBeasts(p).filter((s) => s.id !== w.id && s.online && s.type!.canDefend && !s.protectedStructIndex);
    free.sort((a, b) => Number(b.ambit === w.ambit) - Number(a.ambit === w.ambit) || b.health - a.health);
    return free[0] || null;
  }
  function guardWyrm(g: OwnedStruct, w: OwnedStruct) {
    const p = me(); if (!p) return;
    if (!wallet.unlocked) { say('Your soulstone is sealed: unseal it from the top bar.'); return; }
    try {
      const job = act.defend(p, g, w.id);
      guarding = true; sigs.warbar = ''; paint();
      toast(`Your ${beastName(g.typeId)} ${g.ambit === w.ambit ? 'will take the blows meant for your Elder Wyrm' : 'will strike back at whoever strikes your Elder Wyrm'}.`, 'player', 4500);
      const off = txq.onSettled((j) => { if (j.id !== job.id) return; off(); guarding = false; sigs.warbar = ''; if (j.status === 'failed') { unguardedOk = true; say(`The guard was not set: ${retellError(j.error || 'the ledger refused')}.`); } void empire.refresh(p.playerId); paint(); });
      settleOffs.push(off);
    } catch (e) { say(retellError((e as Error).message)); }
  }

  function paintOurs(p: PlayerState | null, list: Move[]) {
    const mine = ourBeasts(p);
    const sig = JSON.stringify([!!p, wallet.active?.playerId, atk, inFight(), mine.map((s) => [s.id, s.health, s.online, s.ambit, s.defenders, list.filter((m) => m.a.id === s.id).length])]);
    if (!changed('ours', sig)) return;
    clear(ours);
    ours.append(h('h2', { class: 'display', style: { marginBottom: '8px' } }, 'Your warband'));
    if (!mine.length) ours.append(h('p', { class: 'empty' }, !p ? (wallet.active?.playerId ? 'Reading…' : 'No warband yet.')
      : h('span', null, 'No beasts ride with you yet. ', h('a', { href: '/hold' }, 'Summon one at your Hold'), '.')));
    // the Wyrm first: every raid rides on it
    const sorted = [...mine].sort((x, y) => Number(isWyrm(y)) - Number(isWyrm(x)));
    ours.append(h('ul', { class: 'list' }, ...sorted.map((s) => {
      const n = list.filter((m) => m.a.id === s.id).length;
      const t = s.type!;
      const g = guardsOf(s, p);
      const sub = `${REALM_NAME[realmOf(s)]} · ${!s.online ? 'slumbering' : !t.primaryWeaponCharge ? 'cannot strike' : inFight() ? (n ? `${n} in reach` : 'nothing in reach') : `strikes for ${t.primaryWeaponCharge} breath`}${g.length ? ` · guarded by ${g.map((x) => beastName(x.typeId)).join(', ')}` : ''}`;
      return h('li', null, h('button', { type: 'button', class: 'item' + (atk === s.id ? ' on' : ''), 'data-key': 'ours:' + s.id, 'aria-pressed': String(atk === s.id), onclick: () => chooseStriker(s.id) },
        h('span', { class: 'l' }, h('span', { class: 'gem', style: { background: REALM_COLOR[realmOf(s)] } }),
          h('span', { style: { minWidth: '0' } }, h('span', { class: 'nm' }, beastName(s.typeId), isWyrm(s) ? h('span', { class: 'badge wyrm' }, 'heart of the raid') : null), h('span', { class: 'sub' }, sub))),
        h('span', { class: 'hearts', role: 'img', 'aria-label': `vigor ${s.health} of ${t.maxHealth}` }, hearts(s.health, t.maxHealth))));
    })));
  }

  function paintTheirs(p: PlayerState | null, f: PlayerState | null, list: Move[]) {
    // No foe yet: the far isle's own plate says so; empty battle panels would only look broken.
    theirs.hidden = !targetPid;
    const foes = theirBeasts(f);
    const best = suggestion(list);
    const tw = wyrmOf(f);
    const mine = ourBeasts(p);
    const rows = foes.map((s) => {
      const hits = list.filter((m) => m.t.id === s.id);
      const strikers = [...new Set(hits.map((m) => m.a.id))].map((id) => mine.find((x) => x.id === id)!).filter(Boolean);
      // nobody reaches it: say why for the striker in hand (or the Wyrm, who could soar)
      const a = p?.structs.get(atk || '') || wyrmOf(p);
      const why = !strikers.length && a && alive(a) ? reach(a, s) : null;
      const guards = guardsOf(s, f).map((g) => beastName(g.typeId));
      const guarding = tw && s.id !== tw.id && tw.defenders?.includes(s.id);
      return { s, strikers, why, guards, guarding };
    });
    const sig = JSON.stringify([targetPid, !!f, mark, best?.t.id, atk, rows.map((r) => [r.s.id, r.s.health, r.s.hidden, r.strikers.map((x) => x.id), r.why?.why, r.guards])]);
    if (!changed('theirs', sig)) return;
    clear(theirs);
    theirs.append(h('h2', { class: 'display', style: { marginBottom: '8px', color: 'var(--ember-ink)' } }, f ? `${playerName(f)}’s hold` : 'Their hold'));
    if (f && !foes.length) theirs.append(h('p', { class: 'empty' }, 'Nothing stands on their isle.'));
    // their Wyrm first, then its guards, then whatever strikes, then hallows
    const rank = (r: typeof rows[number]) => (isWyrm(r.s) ? 0 : r.guarding ? 1 : r.s.type!.category === 'fleet' ? 2 : 3);
    rows.sort((x, y) => rank(x) - rank(y));
    theirs.append(h('ul', { class: 'list' }, ...rows.map((r) => {
      const s = r.s, hallow = s.type!.category === 'planet';
      const craft = WARD_CRAFT[s.type!.unitDefenses] && s.type!.unitDefenses !== 'noUnitDefenses' ? WARD_CRAFT[s.type!.unitDefenses] : '';
      const tags = [hallow ? 'Hallow' : REALM_NAME[realmOf(s)], s.hidden ? 'Veiled' : '', craft && !s.hidden ? craft : ''].filter(Boolean).join(' · ');
      const reachLine = r.strikers.length ? h('span', { class: 'reach' }, 'in reach of ', ...r.strikers.slice(0, 3).map((x) => h('span', { class: 'rch', style: { color: REALM_COLOR[realmOf(x)] } }, beastName(x.typeId))))
        : r.why ? h('span', { class: 'reach none' }, r.why.soar ? `Your Wyrm can soar into ${inRealm(r.why.soar)} to reach it` : retellError(r.why.why)) : null;
      const off = !r.strikers.length && !(r.why && r.why.soar);
      return h('li', null, h('button', { type: 'button', class: 'item foe' + (mark === s.id ? ' mark' : '') + (off ? ' far' : ''), 'data-key': 'theirs:' + s.id, 'aria-pressed': String(mark === s.id), title: off && r.why ? retellError(r.why.why) : '', onclick: () => chooseMark(s.id) },
        h('span', { class: 'l' }, h('span', { class: 'gem', style: { background: hallow ? 'var(--gold)' : REALM_COLOR[realmOf(s)] } }),
          h('span', { style: { minWidth: '0' } },
            h('span', { class: 'nm' }, beastName(s.typeId),
              isWyrm(s) ? h('span', { class: 'badge foe-wyrm' }, 'keeps their ward') : null,
              r.guarding ? h('span', { class: 'badge guard' }, 'guards their Wyrm') : null,
              best && best.t.id === s.id ? h('span', { class: 'badge best' }, 'wisest blow') : null),
            h('span', { class: 'sub' }, tags, r.guards.length ? ` · guarded by ${r.guards.join(', ')}` : ''),
            reachLine)),
        h('span', { class: 'hearts', role: 'img', 'aria-label': `vigor ${s.health} of ${s.type!.maxHealth}` }, hearts(s.health, s.type!.maxHealth))));
    })));
  }

  /** Hearts with the ones a blow would take shown going. */
  function hpShift(hp: number, lose: number, max: number, label: string) {
    const keep = Math.max(0, hp - lose), going = Math.min(hp, lose);
    return h('span', { class: 'hearts hp-shift', role: 'img', 'aria-label': `${label}: vigor ${hp} of ${max}${going ? `, ${keep} after` : ''}` },
      h('span', null, '♥'.repeat(keep)), h('span', { class: 'lose' }, '♥'.repeat(going)), h('span', { class: 'gone' }, '♡'.repeat(Math.max(0, max - hp))));
  }

  /** Who of theirs can strike `ex.on` while the warbands share a sky, in a sentence. `first`: what this blow's answer takes first. */
  function exposedLine(ex: Exposure, first: number, asleep: boolean): string {
    const f = foe();
    const mine = isWyrm(ex.on) ? 'your Elder Wyrm' : `your ${beastName(ex.on.typeId)}`;
    if (!inFight() && f?.fleet?.status === 'away') return `Their warband is abroad: nothing of theirs at home can strike ${mine}.`;
    const where = defending() ? 'While their warband hangs over your isle' : oursAbroad() ? 'While you hang here' : 'Once you hang over their isle';
    if (!ex.by.length) return `${where}, nothing of theirs can reach ${mine} in ${inRealm(ex.on.ambit)}.`;
    let s = `${where}, their ${kinds(ex.by.map((b) => b.s))} can reach ${mine}`;
    const after = first ? 'after this blow’s answer, ' : '';
    if (ex.blows === Infinity) s += ex.guard ? `, but your ${beastName(ex.guard.typeId)} takes every blow.` : ', but cannot hurt it.';
    else if (ex.guard) s += `. Your ${beastName(ex.guard.typeId)} takes their blows first: ${after}${blowsWord(ex.blows)} in all would fell ${isWyrm(ex.on) ? 'your Wyrm' : 'it'}.`;
    else if (!ex.blows) s += ': this blow’s answer alone would fell it.';
    else s += `: ${after}${blowsWord(ex.blows)} would fell it.`;
    if (asleep && !defending()) s += ` ${foeName()} has long slept, though: unlikely to strike.`;
    return s;
  }
  /** The danger, said once to a screen reader each time it begins (or the Wyrm loses hearts while it lasts). */
  let dangerSaid = '';
  const sAlert = h('p', { role: 'status', 'aria-live': 'polite', style: { position: 'absolute', width: '1px', height: '1px', margin: '-1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } });
  strike.append(sAlert);

  /** The chosen blow, told before it is struck. */
  function paintStrike(p: PlayerState | null, a?: OwnedStruct, t?: OwnedStruct, r?: ReturnType<typeof reach> | null, fc?: Forecast | null, list: Move[] = []) {
    // a won raid is told by the war bar; the strike waits until the warband rides again
    strike.hidden = !targetPid || !p || !!(won && won.pid === targetPid);
    const best = suggestion(list);
    const isBest = !!(best && a && t && best.a.id === a.id && best.t.id === t.id);
    // what of theirs can strike your Elder Wyrm (and the striker) while you hang over their isle, by realm reach
    const f = foe(), myW = wyrmOf(p), foes = theirBeasts(f);
    const answer = a && fc && isWyrm(a) && inFight() ? fc.backMax : 0;
    const exW = p && f && myW && alive(myW) ? exposure(myW, foes, p, answer) : null;
    const exA = p && f && a && !isWyrm(a) && alive(a) ? exposure(a, foes, p) : null;
    const asleep = !!f?.lastAction && live.height - f.lastAction > LONG_ASLEEP;
    // their next round (and this blow's answer) could fell it: say so where the warden is looking
    const danger = !!exW && exW.falls && inFight() && !(asleep && !defending());
    const g = danger && myW ? guardFor(p!, myW) : null;
    const exSig = (ex: Exposure | null) => ex && [ex.on.id, ex.on.health, ex.on.ambit, ex.blows, ex.falls, ex.guard?.id, ex.by.map((b) => b.s.id + ':' + b.dmg)];
    const sig = JSON.stringify([!!p, targetPid, a?.id, a?.health, a?.ambit, a?.online, t?.id, t?.health, t?.hidden, r?.why, fc && [fc.land, fc.dmg, fc.fell, fc.fellMark, fc.backMax, fc.lost, fc.guard?.id, fc.guard?.health, fc.verdict.text], isBest, inFight(), view, strikeNote, won?.pid,
      exSig(exW), exSig(exA), asleep, f?.fleet?.status, danger, g?.id, guarding, oursAbroad()]);
    if (!changed('strike', sig)) return;
    clear(sHead); clear(sBody); clear(sNote);
    const name = (s: OwnedStruct, mine: boolean) => `${mine ? 'Your' : `${foeName()}’s`} ${beastName(s.typeId)}`;
    sHead.append(
      h('p', { class: 'fc-who' },
        h('span', { class: 'fc-a' }, a ? name(a, true) : 'Choose a striker'),
        h('span', { class: 'fc-arrow', 'aria-hidden': 'true' }, icon(ICON.arrow, 16)),
        h('span', { class: 'fc-t' }, t ? name(t, false) : 'choose a mark'),
        isBest ? h('span', { class: 'badge best' }, 'wisest blow') : best && a && t ? h('button', { type: 'button', class: 'btn small ghost fc-best', onclick: () => { atk = best.a.id; mark = best.t.id; chose = false; paint(); } }, 'Suggest a blow') : null));
    const exTone = (ex: Exposure) => (ex.falls ? 'bad' : ex.by.length && ex.blows !== Infinity && !asleep ? 'warn' : 'good');
    if (a && t && fc) {
      const on = fc.hitsOn, guarded = on.id !== t.id;
      const chip = (k: string, v: string, tone = '', sub?: string) => h('span', { class: 'fc-chip ' + tone }, h('span', { class: 'k' }, k), h('span', { class: 'v' }, v), sub ? h('span', { class: 's' }, sub) : null);
      // "Hits back" is this blow's answer; "Their blows" is what can strike your Wyrm while you stay
      const theirBlows = exW ? (!inFight() && f?.fleet?.status === 'away' ? chip('Their blows', 'none home', 'good', 'their warband is abroad')
        : !exW.by.length ? chip('Their blows', 'none reach', 'good', 'your Elder Wyrm')
        : exW.blows === Infinity ? chip('Their blows', 'all held', 'good', `by your ${beastName(exW.guard?.typeId || 0)}`)
        : chip('Their blows', `${exW.blows} to fell`, exTone(exW), asleep ? 'your Wyrm · they sleep' : 'your Elder Wyrm')) : null;
      sBody.append(
        h('div', { class: 'fc-chips' },
          chip('Lands', fc.land >= 0.995 ? 'always' : `${pct(fc.land)}`, fc.land < 0.5 ? 'bad' : ''),
          chip(guarded ? `Hits their ${beastName(on.typeId)}` : 'Deals', fc.dmg.max === fc.dmg.min ? `${fc.dmg.max}` : `${fc.dmg.min}–${fc.dmg.max}`, guarded ? 'guard' : ''),
          fc.fell > 0 ? chip(guarded ? 'Fells the guard' : 'Fells it', fc.fell >= 0.995 ? 'yes' : pct(fc.fell), 'good')
            : chip('Leaves it at', `${Math.max(1, on.health - fc.dmg.max)} ♥`),
          chip('Hits back', fc.backMax ? `up to ${fc.backMax}` : 'none', fc.lost > 0 ? 'bad' : fc.backMax ? 'warn' : 'good', 'this blow only'),
          theirBlows,
          chip('Breath', String(fc.arm.charge))),
        h('div', { class: 'fc-hp' },
          h('span', { class: 'fc-hp-row' }, h('span', { class: 'k' }, `${guarded ? 'Their ' + beastName(on.typeId) + ' (guard)' : 'Their ' + beastName(on.typeId)}`), hpShift(on.health, fc.land > 0 ? fc.dmg.max : 0, on.type!.maxHealth, 'their beast')),
          h('span', { class: 'fc-hp-row' }, h('span', { class: 'k' }, `Your ${beastName(a.typeId)}`), hpShift(a.health, fc.backMax, a.type!.maxHealth, 'your beast'))),
        h('p', { class: 'fc-why' },
          fc.dodgeBy && fc.land < 0.995 ? `${fc.dodgeBy} turns aside ${Math.round((1 - fc.land) * 3) === 2 ? 'two' : 'some'} of every three ${fc.arm.guided ? 'seeking' : 'flung'} blows. ` : '',
          fc.stone ? `Stone-skin softens it by ${fc.stone}. ` : fc.cracks ? 'It cracks stone-skin. ' : '',
          ...fc.back.map((b) => `${b.why === 'guard' ? `Their ${beastName(b.by.typeId)} (a guard)` : b.why === 'spire' ? 'Their Thunder Spire' : 'It'} strikes back for ${b.dmg}${b.why === 'mark' ? ' if it lives' : ''}. `)),
        h('p', { class: 'fc-verdict ' + fc.verdict.tone }, fc.verdict.text));
    } else if (a && t && r && !r.weapon) {
      sBody.append(h('p', { class: 'fc-verdict fair' }, retellError(r.why)));
      if (r.soar) {
        sBody.append(h('p', { class: 'fc-why' }, `The big button soars it there (${a.type!.moveCharge} breath); then strike.`));
        // where it soars to, other beasts of theirs may reach it: say so before it goes
        const there = exposure({ ...a, ambit: r.soar }, foes, p);
        sBody.append(h('p', { class: 'fc-exposed ' + exTone(there) }, there.by.length
          ? `In ${inRealm(r.soar)}, their ${kinds(there.by.map((b) => b.s))} can reach it${there.blows === Infinity ? ', but cannot hurt it' : `: ${blowsWord(there.blows)} would fell it`}.`
          : `In ${inRealm(r.soar)}, nothing of theirs can reach it.`));
      }
    } else if (p && targetPid) {
      sBody.append(h('p', { class: 'fc-why' }, !ourBeasts(p).length ? 'No beasts ride with you yet.' : 'Choose a beast of yours, then one of theirs: the blow is told here before you strike.'));
    }
    // what can strike your Wyrm while you stay, whatever blow is chosen; when it could fall before your next
    // blow, that is said first and loudest, with the safe moves beside it
    const alsoA = exA && exA.by.length && exA.blows !== Infinity ? ` Their ${kinds(exA.by.map((b) => b.s))} can reach your ${beastName(exA.on.typeId)} too: ${blowsWord(exA.blows)} would fell it.` : '';
    if (danger && exW && myW) {
      sBody.append(h('div', { class: 'fc-danger', role: 'group', 'aria-label': 'Your Elder Wyrm is in danger' },
        h('p', null, h('b', null, 'Your Elder Wyrm could fall before your next blow. '),
          `Their ${kinds(exW.by.map((b) => b.s))} can reach it ${defending() ? 'over your isle' : 'here'}, and ${answer ? 'this blow’s answer and ' : ''}one blow from each would fell it.`, alsoA),
        h('div', { class: 'fc-danger-act' },
          oursAbroad() ? h('button', { type: 'button', class: 'btn small gold', 'data-tut': 'home', onclick: () => rideHome() }, 'Ride home') : null,
          g ? h('button', { type: 'button', class: 'btn small', disabled: guarding, onclick: () => guardWyrm(g, myW) }, guarding ? 'Setting the guard…' : `Guard your Wyrm with your ${beastName(g.typeId)}`, h('span', { class: 'cost' }, `${g.type!.defendChangeCharge} breath`)) : null)));
    } else if (exW) sBody.append(h('p', { class: 'fc-exposed ' + exTone(exW) }, icon(ICON.warn, 14), h('span', null, exposedLine(exW, answer, asleep), alsoA)));
    const say = danger && myW ? `${myW.id}:${myW.health}` : '';
    if (say !== dangerSaid) { dangerSaid = say; sAlert.textContent = say ? `Your Elder Wyrm could fall before your next blow.${oursAbroad() ? ' Ride home and it lives to raid again.' : ''}` : ''; }
    if (strikeNote) sNote.append(h('p', { class: 'inline-err', role: 'alert' }, icon(ICON.warn, 15), h('span', null, strikeNote)));
    // the camera
    clear(viewSeg);
    viewSeg.append(h('span', { class: 'k' }, 'View'), ...(['ours', 'all', 'theirs'] as (Side | 'all')[]).map((v) => h('button', { type: 'button', 'aria-pressed': String(view === v), class: view === v ? 'on' : '', onclick: () => { view = v; scene?.get()?.view(v); sigs.strike = ''; paint(); } }, v === 'all' ? 'Both' : v === 'ours' ? 'Ours' : 'Theirs')));
  }

  /** The big button: what it does now, and the breath it is waiting for. */
  function paintButton() {
    const p = me(), f = foe();
    const a = p?.structs.get(atk || ''), t = f?.structs.get(mark || '');
    const r = a && t ? reach(a, t) : null;
    const job = pendingStrike();
    const breath = p ? empire.charge(p) : 0;
    let label = 'Unleash', sub = '', disabled = true, fill = 0, why = '';
    if (!p) why = wallet.active?.playerId ? 'Your warband is still being read.' : 'Swear the oath first.';
    else if (won && won.pid === targetPid) { label = 'Go to your Hold'; sub = 'brew what you carried home'; disabled = false; }
    else if (!f) why = targetPid ? 'Reading their hold…' : 'Choose a foe in the Sky Atlas first.';
    else if (!inFight() && !(wyrmOf(p) && alive(wyrmOf(p)!) && wyrmOf(p)!.online)) { label = 'Ride out'; why = wyrmOf(p) && alive(wyrmOf(p)!) ? 'Your Elder Wyrm slumbers: wake it at your Hold to ride.' : 'No raid can ride without an Elder Wyrm: hatch a new one at your Hold.'; }
    // their sky holds one raider at a time: say so before the ride, not after the ledger refuses it
    else if (!inFight() && !guarding && skyFull(f.planet, p)) { label = 'Ride out'; why = skyFull(f.planet, p)!; }
    else if (!inFight() && guarding) { label = 'Setting the guard…'; sub = 'then ride out'; }
    else if (!inFight() && !unguardedOk && wyrmOf(p) && guardFor(p, wyrmOf(p)!)) { const g = guardFor(p, wyrmOf(p)!)!; label = 'Guard your Wyrm'; sub = `with your ${beastName(g.typeId)} · ${g.type!.defendChangeCharge} breath · then ride out`; disabled = false; }
    else if (!inFight() && armed?.key === 'ride') { label = 'Ride out anyway?'; sub = `your Elder Wyrm has ${wyrmOf(p)!.health} ${wyrmOf(p)!.health === 1 ? 'heart' : 'hearts'} · press again to ride`; disabled = false; armWarn = `Ride out anyway? Their beasts can reach your Elder Wyrm over their isle, and it has only ${wyrmOf(p)!.health} ${wyrmOf(p)!.health === 1 ? 'heart' : 'hearts'} left. ${NO_MENDING} Press again to ride.`; }
    else if (!inFight()) { label = p.fleet?.status === 'away' ? `Ride to ${foeName()}’s isle` : 'Ride out'; sub = (wyrmOf(p)?.health ?? 9) <= 2 ? `your Elder Wyrm has only ${wyrmOf(p)!.health} ${wyrmOf(p)!.health === 1 ? 'heart' : 'hearts'}` : 'you can only strike from their sky'; disabled = false; }
    else if (job) {
      const cost = job.chargeCost || 0;
      if (job.status === 'waiting' || job.status === 'queued') { label = 'Gathering breath…'; sub = cost && breath < cost ? `${breath} of ${cost} · ${bellsAsTime((cost - breath) * (live.blockTime / 6))} · press to call it off` : 'press to call it off'; fill = cost ? Math.min(1, breath / cost) : 0; disabled = false; }
      else { label = 'Striking…'; sub = 'the blow is on the wind'; fill = 1; }
    } else if (fightDefault() === 'guard') {
      const g = guardFor(p, wyrmOf(p)!)!; label = 'Guard your Wyrm'; sub = `with your ${beastName(g.typeId)} · ${g.type!.defendChangeCharge} breath · it stands unguarded`; disabled = false;
    } else if (fightDefault() === 'home') {
      label = 'Ride home'; sub = `your Elder Wyrm has ${wyrmOf(p)!.health} ${wyrmOf(p)!.health === 1 ? 'heart' : 'hearts'}: save it`; disabled = false;
    } else if (wardOpen() && !chose && !suggestion()) {
      const task = pow.active.find((x) => x.kind === 'raid' && x.playerId === p.playerId);
      const pc = task ? Math.round(Math.min(100, ((task.best?.zeros ?? 0) / Math.max(1, pow.required(task))) * 100)) : null;
      label = 'Plundering…'; sub = `hold their sky${pc != null ? ` · ${pc}%` : ''} · nothing left to strike that matters`; fill = pc != null ? pc / 100 : 0;
    } else if (!a) why = 'Choose a striker from your warband.';
    else if (!t) why = 'Choose a mark in their hold.';
    else if (!a.online) why = `Your ${beastName(a.typeId)} slumbers: wake it at your Hold.`;
    else if (!r?.weapon) { if (r?.soar) { label = `Soar into ${inRealm(r.soar)}`; sub = `${a.type!.moveCharge} breath · then strike`; disabled = false; } else why = retellError(r?.why || ''); }
    else {
      const cost = r.weapon === 'primaryWeapon' ? a.type!.primaryWeaponCharge : a.type!.secondaryWeaponCharge;
      disabled = false; fill = Math.min(1, breath / Math.max(1, cost));
      sub = breath >= cost ? `${cost} breath · ready` : `${breath} of ${cost} breath · strikes when full (${bellsAsTime((cost - breath) * (live.blockTime / 6))})`;
      if (armed && armed.key === `${a.id}>${t.id}`) {
        const fc = forecast(a, t, r.weapon, f), sure = !!fc && fc.lost >= 0.995;
        label = 'Unleash anyway?'; sub = `This blow will ${sure ? '' : 'likely '}fell your Elder Wyrm · press again to strike`;
        armWarn = `Unleash anyway? This blow will ${sure ? '' : 'likely '}fell your Elder Wyrm: ${fc ? `the answer strikes for up to ${fc.backMax}, and it has ${a.health} ${a.health === 1 ? 'heart' : 'hearts'}` : 'it cannot take the answer'}. If it falls, the raid breaks. Press again to strike anyway.`;
      }
    }
    sBtnLabel.textContent = label; sBtnSub.textContent = sub;
    sBtn.dataset.tut = /^(Ride|Guard|Setting)/.test(label) ? 'ride' : 'unleash';
    // Fight on only makes sense in their sky (or defending your own)
    fightOnBtn.hidden = !inFight() || !!(won && won.pid === targetPid);
    fightOnBtn.setAttribute('aria-pressed', String(fightOn));
    fightOnBtn.classList.toggle('on', fightOn);
    if (fightOn && !why) { const m = autoMove(allMoves()); why = m ? `Fighting on: next, your ${beastName(m.a.typeId)} strikes their ${beastName(m.t.typeId)} when breath fills.` : ''; }
    if (!inFight() || (won && won.pid === targetPid)) fightNote = '';
    if (!fightOn && fightNote && !why) why = fightNote;
    fightOnTick();
    sBtn.disabled = disabled;
    sBtn.classList.toggle('waiting', !!job || (fill > 0 && fill < 1));
    sBtn.classList.toggle('deadly', /anyway\?$/.test(label));
    sBtn.style.setProperty('--fill', String(fill));
    sBtn.setAttribute('aria-label', sub ? `${label}: ${sub}` : label);
    // why the button waits, in one line
    const w = why ? why : '';
    if (sPending.textContent !== w) sPending.textContent = w;
  }
  let view: Side | 'all' = 'all';

  // the ledger moves, a rite changes state, a bell strikes (breath grows): each repaints what it touches
  const offs = [empire.onChange(paint), wallet.onChange(paint), txq.onChange(() => paintButton()), live.onBlock(() => { if (!left) paintButton(); }), pow.onChange(() => { if (!left && oursAbroad()) paintWarbar(me(), foe()); })];
  paint();
  paintFray();
  return {
    el, title: 'Skirmish',
    leave: () => { left = true; clearTimeout(slowCheck); clearTimeout(firstWait); offWon(); offTx(); settleOffs.forEach((f) => f()); pendingClaims.forEach(releaseClaim); clearTimeout(remountLater); offs.forEach((f) => f()); scene?.dispose(); tip.dispose(); bar.dispose(); for (const w of watched) empire.unwatch(w); },
  };
}
