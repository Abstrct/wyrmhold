/* The Skirmish: your warband against a real warden's hold. Their beasts are read from the ledger
 * (their hallows and any warband at home); yours are your fleet. Strikes sign MsgStructAttack;
 * the plunder chant (MsgPlanetRaidComplete) is ground by the chant engine once you are in orbit. */
import { h, clear, toast, keepFocus } from '../core/dom';
import K from '../world/wyrmkit.js';
import { mountScene, type Ctx, type Screen } from './types';
import { topbar, hearts, icon, ICON } from '../ui/frame';
import { chantsPanel, chroniclePanel } from '../ui/chants';
import { onPlunder } from '../ui/omens';
import { claimJob, releaseClaim } from '../core/claims';
import { cursorTip } from '../ui/tip';
import { empire, type OwnedStruct, type PlayerState } from '../game/empire';
import { act, actionBlock } from '../game/actions';
import { wallet } from '../wallet/wallet';
import { txq } from '../wallet/queue';
import { AMBIT_FLAG, type Ambit, type WeaponSystem } from '../data/catalogue';
import { num } from '../chain/lcd';
import { REALM_COLOR, REALM_NAME, WARD_CRAFT, beastName, retellError } from '../lore';
import { playerName, raidersAt, realmOf } from '../realm';

type Side = 'ours' | 'theirs';

export function skirmish(ctx: Ctx): Screen {
  const canvas = h('canvas');
  const tip = cursorTip(canvas);
  const bar = topbar('#/skirmish', ctx.oath, { meters: true });
  const ours = h('aside', { class: 'glass panel col-l scroll-y', 'aria-label': 'Your warband' });
  const theirs = h('aside', { class: 'glass panel col-l scroll-y', 'aria-label': 'Their hold' });
  const strike = h('section', { class: 'glass panel', 'aria-label': 'Strike', style: { flex: '0 1 560px', minWidth: '280px' } });
  const chants = chantsPanel();
  const chron = chroniclePanel((j) => /Attack|RaidComplete|FleetMove/.test(j.msgs.map((m) => m.typeUrl).join()), 12);
  const status = h('div');
  const el = h('div', { class: 'screen' }, h('div', { class: 'stage' }, canvas),
    h('div', { class: 'hud' }, bar.el, status,
      h('div', { class: 'isle-window', 'aria-hidden': 'true' }),
      h('div', { class: 'cols through' }, ours, theirs),
      h('div', { class: 'row strike-row', style: { justifyContent: 'center', alignItems: 'flex-end', gap: '12px' } }, strike,
        h('div', { class: 'stack', style: { flex: '0 1 380px', minWidth: '260px' } }, chants.el, h('div', { class: 'sk-chron' }, chron.el)))));

  let targetPid: string | null = ctx.param || null;
  /** A raid won here this visit: the stepper ends on Plunder ✓ instead of starting over. */
  let won: { pid: string; seized: number; home?: boolean } | null = null;
  const offWon = onPlunder((d) => { const f = foe(); if (f && d.planetId === f.planetId) { won = { pid: f.playerId, seized: d.seized }; paint(); } });
  let atk: string | null = null, mark: string | null = null;
  let sceneKey = '';
  let scene: ReturnType<typeof mountScene<any>> | null = null;
  const watched = new Set<string>();
  const fallen = new Set<string>();

  const me = () => empire.commander;
  const foe = (): PlayerState | null => (targetPid ? empire.players.get(targetPid) ?? null : null);

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

  const alive = (s: OwnedStruct) => !s.destroyed && s.built && !!s.type;
  function ourBeasts(p: PlayerState | null) { return p ? [...p.structs.values()].filter((s) => alive(s) && s.type!.category === 'fleet') : []; }
  /** Their warband hangs over our isle while ours is home: we defend. */
  function oursAbroad(): boolean {
    const p = me(), f = foe();
    return !!(p && f && p.fleet?.status === 'away' && p.fleet.locationId === f.planetId);
  }
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

  /** Which weapon (if any) can reach `t` from `a`, and why not. */
  function reach(a: OwnedStruct, t: OwnedStruct): { weapon: WeaponSystem | null; why: string } {
    const at = a.type!, ta = t.ambit as Ambit;
    if (t.hidden && t.ambit !== a.ambit) return { weapon: null, why: 'Veiled — only its own realm can find it' };
    const can = (mask: number) => (mask & AMBIT_FLAG[ta]) || ((mask & AMBIT_FLAG.local) && a.ambit === t.ambit);
    if (at.primaryWeaponCharge && can(at.primaryWeaponAmbits)) return { weapon: 'primaryWeapon', why: '' };
    if (at.secondaryWeaponCharge && can(at.secondaryWeaponAmbits)) return { weapon: 'secondaryWeapon', why: '' };
    if (at.primaryWeaponAmbits & AMBIT_FLAG.local) return { weapon: null, why: 'The Wyrm must soar into that realm first' };
    return { weapon: null, why: `Out of reach for the ${beastName(a.typeId)}` };
  }

  function odds(a: OwnedStruct, t: OwnedStruct, w: WeaponSystem): string {
    const at = a.type!, tt = t.type!;
    const pre = w === 'primaryWeapon' ? 'primaryWeapon' : 'secondaryWeapon';
    const control = (at as unknown as Record<string, string>)[pre + 'Control'];
    const dmg = (at as unknown as Record<string, number>)[pre + 'Damage'];
    const ap = (at as unknown as Record<string, boolean>)[pre + 'ArmourPiercing'];
    const charge = (at as unknown as Record<string, number>)[pre + 'Charge'];
    const bits = [`${control === 'guided' ? 'A seeking blow' : 'A flung blow'} for ${charge} breath.`];
    const tr = tt as unknown as Record<string, number>;
    const [n, d] = control === 'guided' ? [tr.guidedDefensiveSuccessRateNumerator, tr.guidedDefensiveSuccessRateDenominator] : [tr.unguidedDefensiveSuccessRateNumerator, tr.unguidedDefensiveSuccessRateDenominator];
    if (d) bits.push(`${WARD_CRAFT[tt.unitDefenses]} lets ${n} in ${d} through.`);
    const red = tt.attackReduction && !ap ? tt.attackReduction : 0;
    bits.push(`${Math.max(0, dmg - red)} damage${red ? ' (stone-skin)' : ap && tt.attackReduction ? ' — it cracks stone-skin' : ''}.`);
    const counter = a.ambit === t.ambit ? tt.counterAttackSameAmbit : tt.counterAttack;
    bits.push(!at.attackCounterable ? 'It cannot answer.' : counter ? `If it lives, it answers for ${counter}.` : 'It cannot answer.');
    return bits.join(' ');
  }

  function remountScene(p: PlayerState | null, f: PlayerState | null) {
    const mineList = ourBeasts(p), theirList = theirBeasts(f);
    const key = mineList.map((s) => s.id).join(',') + '|' + theirList.map((s) => s.id).join(',');
    if (key === sceneKey && scene) return;
    // a beast that just fell tumbles on the scene it fell in; rebuild once the tumble is over
    const since = Date.now() - fellAt;
    if (scene && since < 2600) { if (!remountLater) remountLater = window.setTimeout(() => { remountLater = 0; paint(); }, 2700 - since); return; }
    sceneKey = key;
    tip.show(null); // the old scene's hover never says goodbye
    scene?.dispose();
    const pack = (list: OwnedStruct[]) => list.map((s) => ({ id: s.id, type: s.typeId, realm: s.type!.category === 'fleet' ? realmOf(s) : undefined, roams: s.type!.category === 'fleet', label: beastName(s.typeId) }));
    scene = mountScene(canvas, (c) => K.skirmish(c, {
      ours: pack(mineList), theirs: pack(theirList),
      oursName: me()?.name || undefined, theirsName: foe() ? playerName(foe()!) : undefined, hasFoe: !!foe(),
      oursAbroad: oursAbroad(), theirsAbroad: defending(),
      onPick: (id: string | null) => { if (!id) return; if (mineList.some((s) => s.id === id)) atk = id; else mark = id; paint(); },
      onHover: (id: string | null) => {
        const ours = mineList.find((s) => s.id === id), theirs = theirList.find((s) => s.id === id), s = ours || theirs;
        tip.show(s ? beastName(s.typeId) : null, ours ? 'yours · click to strike with it' : 'theirs · click to mark it');
      },
    }), (c) => { c.mark('a', atk); c.mark('t', mark); if (view !== 'all') c.view(view); });
  }
  let fellAt = 0, remountLater = 0, left = false;
  let readingSince = 0, slowCheck = 0, readingFor: string | undefined;   // when we began waiting for a sworn warden's warband to be read

  function unleash() {
    const p = me(), f = foe();
    const a = p?.structs.get(atk || ''), t = f?.structs.get(mark || '');
    if (!p || !a || !t) return;
    // trouble with a blow is told under Unleash, where the warden is looking
    // under Unleash when the strike panel shows; at the edge when it is hidden (a won raid)
    const say = (t2: string) => { if (strike.hidden) { toast(t2, 'enemy', 7000); return; } strikeNote = t2; paint(); };
    if (!wallet.unlocked) { say('Your soulstone is sealed: unseal it from the top bar to strike.'); return; }
    const block = actionBlock(p); if (block) { say(retellError(block)); return; }
    const r = reach(a, t); if (!r.weapon) { say(retellError(r.why)); return; }
    strikeNote = '';
    try {
      const job = act.attack(p, a, [t.id], r.weapon);
      claimJob(job.id); pendingClaims.add(job.id);
      const control = (a.type as unknown as Record<string, string>)[r.weapon + 'Control'];
      const off = txq.onSettled((j) => {
        if (j.id !== job.id) return;
        off(); pendingClaims.delete(j.id);
        if (j.status === 'success') scene?.get()?.strike(a.id, t.id, { color: 0xffc04a, guided: control === 'guided' });
        else if (j.status === 'failed') say(`The blow did not land: ${retellError(j.error || 'the ledger refused')}.`);
      });
      settleOffs.push(off);
      toast(`The ${beastName(a.typeId)} gathers itself to strike.`, 'player', 2500);
    } catch (e) { say(retellError((e as Error).message)); }
  }
  let strikeNote = '', lastAM = '';
  const settleOffs: (() => unknown)[] = [];
  const pendingClaims = new Set<string>();

  // the panels rebuild as the ledger moves; keyboard focus survives it
  function paint() { if (!left) keepFocus(el, paintNow); }
  function paintNow() {
    if (left) return; // a late ledger answer after leaving must not watch anyone again
    // a new striker or mark clears the last blow's trouble
    const am = `${atk || ''}|${mark || ''}`;
    if (am !== lastAM) { lastAM = am; strikeNote = ''; }
    void resolveTarget();
    const p = me(), f = foe();
    if (p) { readingSince = 0; clearTimeout(slowCheck); }
    const ctl = scene?.get();
    // fallen beasts tumble once
    if (f) for (const s of f.structs.values()) if (s.destroyed && !fallen.has(s.id)) { fallen.add(s.id); if (ctl) { ctl.fell(s.id); fellAt = Date.now(); } }
    if (p) for (const s of p.structs.values()) if (s.destroyed && !fallen.has(s.id)) { fallen.add(s.id); if (ctl) { ctl.fell(s.id); fellAt = Date.now(); } }
    remountScene(p, f);
    scene?.get()?.mark('a', atk); scene?.get()?.mark('t', mark);
    // a warband over the other isle is drawn there, and flies when it rides
    scene?.get()?.abroad('ours', oursAbroad()); scene?.get()?.abroad('theirs', defending());

    clear(status);
    const inOrbit = !!(p && f && p.fleet?.status === 'away' && p.fleet.locationId === f.planetId) || defending();
    // a won raid stays won until the warband rides out again (a new raid, even on the same hold)
    if (won && won.pid === targetPid && !inOrbit) won.home = true;
    if (won && won.home && inOrbit) won = null;
    // where you are in a raid, at a glance: choose a foe, ride out, strike, and the plunder that follows
    if (p && !defending()) {
      const st = (done: boolean, now: boolean, run = false) => (done ? 'done' : run ? 'run' : now ? 'now' : '');
      const w = won && won.pid === targetPid;
      const steps: [string, string][] = [
        ['Choose a foe', st(!!f, !targetPid || !f)],
        ['Ride out', st(inOrbit || !!w, !!f && !inOrbit && !w)],
        ['Strike', st(!!w, inOrbit && !w)],
        ['Plunder', st(!!w, false, inOrbit && !w)],
      ];
      status.append(h('ol', { class: 'stepper', 'aria-label': 'Raid steps' }, ...steps.map(([label, state], i) =>
        h('li', { class: state, 'aria-current': state === 'now' ? 'step' : undefined }, h('span', { class: 'n' }, state === 'done' ? '✓' : String(i + 1)), h('span', { class: 't' }, label)))));
    }
    if (p && won && won.pid === targetPid) status.append(banner(won.seized > 0
      ? `Raid won! ${won.seized} ${won.seized === 1 ? 'sheaf' : 'sheaves'} of wildroot ride home with you. Brew them before anyone takes them back.`
      : 'Raid won, but their isle held nothing unbrewed this time.', ['Go to your Hold', () => ctx.go('#/hold')], true));
    // a sworn warden whose warband is still being read is not sent back to the oath
    else if (!p) {
      if (!wallet.active?.playerId) status.append(banner('You have no warband yet.', ['Swear the oath', ctx.oath]));
      else {
        // a ledger that stays silent is said plainly, with a way to ask again
        if (!readingSince || readingFor !== wallet.active.playerId) { readingFor = wallet.active.playerId; readingSince = Date.now(); clearTimeout(slowCheck); slowCheck = window.setTimeout(() => paint(), 15500); }
        status.append(Date.now() - readingSince < 15000 ? banner('Reading your warband from the ledger…')
          : banner('The ledger is not answering yet. Your warband appears the moment it does.', ['Try again', () => empire.refresh(wallet.active?.playerId)]));
      }
    }
    else if (!targetPid) status.append(banner('Choose a hold to raid from the Sky Atlas.', ['Open the Atlas', () => ctx.go('#/atlas')]));
    else if (!f) status.append(banner('Scrying their hold from the ledger…'));
    else if (defending()) status.append(banner(`Raiders over your isle! ${playerName(f)}’s warband hangs in your sky. Fell their Elder Wyrm and the plunder breaks.`));
    else if (!inOrbit) status.append(banner(`Your warband is ${p.fleet?.status === 'away' ? 'abroad' : 'at home'}. Ride to ${playerName(f)}’s isle to strike and plunder. While you are away, your own hold stands unguarded.`,
      ['Ride out', () => { try { act.fleetMove(p, f.planetId); } catch (e) { toast(retellError((e as Error).message), 'enemy'); } }], true, 'ride'));
    else {
      const ward = num(f.planet?.planetAttributes?.planetaryShield);
      status.append(banner(`Over ${playerName(f)}’s isle · ward ${ward} · ${f.ore} wildroot to plunder. The plunder chant runs while you hold their sky.`,
        ['Ride home', () => { try { act.fleetMove(p, p.planetId); } catch (e) { toast(retellError((e as Error).message), 'enemy'); } }]));
    }

    const aS = p?.structs.get(atk || '');
    clear(ours);
    ours.append(h('h2', { class: 'display', style: { marginBottom: '8px' } }, 'Your warband'));
    const mine = ourBeasts(p);
    if (!mine.length) ours.append(h('p', { class: 'empty' }, !p ? (wallet.active?.playerId ? 'Reading…' : 'No warband yet.')
      : h('span', null, 'No beasts ride with you yet. ', h('a', { href: '#/hold' }, 'Summon one at your Hold'), '.')));
    ours.append(h('ul', { class: 'list' }, ...mine.map((s) => h('li', null, h('button', { type: 'button', class: 'item' + (atk === s.id ? ' on' : ''), 'data-key': 'ours:' + s.id, onclick: () => { atk = s.id; paint(); } },
      h('span', { class: 'l' }, h('span', { class: 'gem', style: { background: REALM_COLOR[realmOf(s)] } }),
        h('span', { style: { minWidth: '0' } }, h('span', { class: 'nm' }, beastName(s.typeId)), h('span', { class: 'sub' }, `${REALM_NAME[realmOf(s)]} · ${s.type!.primaryWeaponCharge ? `strikes for ${s.type!.primaryWeaponCharge} breath` : 'cannot strike'}${s.online ? '' : ' · slumbering'}`))),
      h('span', { class: 'hearts', role: 'img', 'aria-label': `vigor ${s.health} of ${s.type!.maxHealth}` }, hearts(s.health, s.type!.maxHealth)))))));

    clear(theirs);
    // No foe yet: the far isle's own plate says so; empty battle panels would only look broken.
    theirs.hidden = !targetPid;
    strike.hidden = !targetPid || !!(won && won.pid === targetPid);
    theirs.append(h('h2', { class: 'display', style: { marginBottom: '8px', color: 'var(--ember-ink)' } }, f ? `${playerName(f)}’s hold` : 'Their hold'));
    const foes = theirBeasts(f);
    if (f && !foes.length) theirs.append(h('p', { class: 'empty' }, 'Nothing stands on their isle.'));
    theirs.append(h('ul', { class: 'list' }, ...foes.map((s) => {
      const r = aS ? reach(aS, s) : { weapon: 'primaryWeapon' as WeaponSystem, why: '' };
      const hallow = s.type!.category === 'planet';
      return h('li', null, h('button', { type: 'button', class: 'item' + (mark === s.id ? ' mark' : ''), 'data-key': 'theirs:' + s.id, disabled: !r.weapon, title: r.why, onclick: () => { mark = s.id; paint(); } },
        h('span', { class: 'l' }, h('span', { class: 'gem', style: { background: hallow ? 'var(--gold)' : REALM_COLOR[realmOf(s)] } }),
          h('span', { style: { minWidth: '0' } }, h('span', { class: 'nm' }, beastName(s.typeId)),
            h('span', { class: 'sub', style: { color: r.weapon ? undefined : '#ff9f7a' } }, r.weapon ? `${hallow ? 'Hallow' : REALM_NAME[realmOf(s)]}${s.hidden ? ' · Veiled' : ''}${WARD_CRAFT[s.type!.unitDefenses] && s.type!.unitDefenses !== 'noUnitDefenses' ? ' · ' + WARD_CRAFT[s.type!.unitDefenses] : ''}` : r.why))),
        h('span', { class: 'hearts', role: 'img', 'aria-label': `vigor ${s.health} of ${s.type!.maxHealth}` }, hearts(s.health, s.type!.maxHealth))));
    })));

    clear(strike);
    const tS = f?.structs.get(mark || '');
    const r = aS && tS ? reach(aS, tS) : null;
    strike.append(
      h('p', { style: { margin: 0, fontSize: '16px' } }, h('span', { style: { color: 'var(--gold)' } }, aS ? `Your ${beastName(aS.typeId)}` : 'Choose a striker'), h('span', { class: 'faint' }, ' → '), h('span', { style: { color: '#ff9f7a' } }, tS ? (foe() ? `${playerName(foe()!)}’s ${beastName(tS.typeId)}` : beastName(tS.typeId)) : 'choose a mark')),
      h('p', { class: 'muted', style: { margin: '4px 0 0', fontSize: '14px', minHeight: '20px' } }, aS && tS ? (r?.weapon ? odds(aS, tS, r.weapon) : r?.why || '') : 'Your striker’s reach decides which of their beasts can be marked.'),
      h('div', { class: 'row', style: { marginTop: '12px', alignItems: 'center' } },
        h('button', { type: 'button', class: 'btn ember', 'data-tut': 'unleash', style: { flex: '1 1 200px', minHeight: '54px', borderRadius: '14px' }, disabled: !(r?.weapon && inOrbit), onclick: unleash }, 'Unleash'),
        h('div', { class: 'seg', role: 'group', 'aria-label': 'Camera view' }, h('span', { class: 'k' }, 'View'),
          ...(['ours', 'all', 'theirs'] as (Side | 'all')[]).map((v) => h('button', { type: 'button', 'aria-pressed': String(view === v), class: view === v ? 'on' : '', onclick: () => { view = v; scene?.get()?.view(v); paint(); } }, v === 'all' ? 'Both' : v === 'ours' ? 'Ours' : 'Theirs')))),
      // why Unleash waits, in one line
      strikeNote ? h('p', { class: 'inline-err', role: 'alert' }, icon(ICON.warn, 15), h('span', null, strikeNote)) : '',
      !(r?.weapon && inOrbit) ? h('p', { class: 'why-line' }, !p ? (wallet.active?.playerId ? 'Your warband is still being read.' : 'Swear the oath first: your Elder Wyrm hatches, and your warband with it.') : !targetPid ? 'Choose a foe in the Sky Atlas first.' : !inOrbit ? 'Ride out to their isle first: you can only strike from their sky.' : !aS ? 'Choose a striker from your warband.' : !tS ? 'Choose a mark in their hold.' : retellError(r?.why || '')) : '');
  }
  let view: Side | 'all' = 'all';

  function banner(text: string, action?: [string, () => void], primary = false, tut?: string) {
    return h('div', { class: 'glass row', role: 'status', style: { alignSelf: 'center', margin: '0 auto', width: 'fit-content', maxWidth: '100%', padding: '8px 10px 8px 16px', borderRadius: '999px', flexWrap: 'wrap' } },
      h('span', null, text), action ? h('button', { type: 'button', class: primary ? 'btn small gold' : 'btn small', 'data-tut': tut || null, onclick: action[1] }, action[0]) : null);
  }

  const offs = [empire.onChange(paint), wallet.onChange(paint)];
  paint();
  return {
    el, title: 'Skirmish',
    leave: () => { left = true; clearTimeout(slowCheck); offWon(); settleOffs.forEach((f) => f()); pendingClaims.forEach(releaseClaim); clearTimeout(remountLater); offs.forEach((f) => f()); scene?.dispose(); tip.dispose(); bar.dispose(); chants.dispose(); chron.dispose(); for (const w of watched) empire.unwatch(w); },
  };
}
