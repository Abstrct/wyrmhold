#!/usr/bin/env node
/* The arena: a sky to fight in, on this computer. It starts the mock ledger with a battle-ready sky,
 * serves the game against it, and plays the chain's part for war: strikes, guards, counters,
 * dodges, stone-skin, the Thunder Spire, soaring, riding out, a broken raid and plunder, each told
 * back to the client as the same EventAttack / EventRaid the real ledger emits. The foe fights back.
 *
 *   node qa/arena.mjs                 # http://127.0.0.1:5194/  (prints the warden to swear as)
 *   options: --port N  --blockMs N (bells; default 1000)  --calm (the foe never strikes)
 *
 * In the page, swear as the arena's warden from the console (any soulstone maps to them):
 *   const { wallet } = await import('/src/wallet/wallet.ts'); await wallet.createInstant(); await wallet.resolvePlayers();
 * The rules follow the ledger's attack_context.go; randomness is Math.random, not the block hash. */
import { Ledger } from './lib/ledger.mjs';
import { startApp } from './lib/app.mjs';
import { newWorld, addGuild, addWarden, typeOf, ST } from './lib/world.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i < 0 ? d : args[i + 1]; };
const calm = args.includes('--calm');
const port = Number(opt('--port', 5194));
const blockMs = Number(opt('--blockMs', 1000));

/* ── the sky ─────────────────────────────────────────────────────────── */
export function arenaSky(endpointBase = '') {
  const w = newWorld();
  const hearth = addGuild(w, { name: 'The First Hearth', tag: 'HRT', endpointBase });
  const mire = addGuild(w, { name: 'The Gilded Mire', tag: 'MIRE', endpointBase });
  // you: an Elder Wyrm and a small warband, one beast in each realm
  const me = addWarden(w, { name: 'Aldric', guildId: hearth.id, ore: 1, planetOre: 4, shield: 50, lastAction: 990,
    beasts: [[1], [3], [5], [9], [11]], hallows: [[14], [15], [16]] });
  // the foe: their Wyrm guarded by a Comet Sprite, a veiled owl, wildroot left unbrewed, a Thunder Spire
  const foe = addWarden(w, { name: 'Grimwald', guildId: mire.id, ore: 6, planetOre: 3, shield: 24, lastAction: 960,
    beasts: [[1], [3], [5], [9], [6, ST.veiled]], hallows: [[14], [15], [16], [19]] });
  const wyrm = foe.beasts[0], sprite = foe.beasts[1];
  sprite.structAttributes.protectedStructIndex = wyrm.Struct.index; wyrm.structDefenders = [sprite.Struct.id];
  const NAMES = ['Wynyn', 'Brannoc', 'Ysmay', 'Corvane', 'Thessaly', 'Ulric'];
  NAMES.forEach((n, i) => addWarden(w, { name: n, guildId: [hearth, mire][i % 2].id, ore: i % 3 === 0 ? 3 + i : 0, lastAction: 700 + i * 40, beasts: [[1], [2 + (i % 12)]], hallows: [[14], [15]] }));
  w.anyAddressPlayer = me.pid;
  return { w, me, foe };
}

/* ── reading a signed rite ───────────────────────────────────────────── */
function varint(buf, i) { let x = 0n, s = 0n; for (;;) { const b = buf[i++]; x |= BigInt(b & 0x7f) << s; if (!(b & 0x80)) break; s += 7n; } return [x, i]; }
function fields(buf) {
  const out = []; let i = 0;
  while (buf && i < buf.length) {
    let k; [k, i] = varint(buf, i); const no = Number(k >> 3n), wt = Number(k & 7n);
    if (wt === 0) { let v; [v, i] = varint(buf, i); out.push([no, v]); }
    else if (wt === 2) { let l; [l, i] = varint(buf, i); out.push([no, buf.subarray(i, i + Number(l))]); i += Number(l); }
    else if (wt === 5) i += 4; else if (wt === 1) i += 8; else break;
  }
  return out;
}
export function decodeTx(b64) {
  const body = fields(Buffer.from(b64, 'base64')).find(([n]) => n === 1)?.[1];
  return fields(body).filter(([n]) => n === 1).map(([, any]) => {
    const f = fields(any), value = fields(f.find(([n]) => n === 2)?.[1]);
    const str = (no) => value.filter(([n]) => n === no).map(([, v]) => Buffer.isBuffer(v) ? v.toString() : String(v));
    const int = (no) => Number(value.find(([n]) => n === no)?.[1] ?? 0);
    return { type: f.find(([n]) => n === 1)[1].toString().split('.').pop(), str, int };
  });
}

/* ── the rules of war (attack_context.go, in miniature) ──────────────── */
const AMB = { water: 2, land: 4, air: 8, space: 16 };
const AMBIT_ENUM = { 1: 'water', 2: 'land', 3: 'air', 4: 'space' };

export function makeRules(sky, ledger) {
  const w = sky.w;
  const S = (id) => w.structs.get(id);
  const T = (s) => typeOf(Number(s.Struct.type));
  const st = (s) => Number(s.structAttributes.status);
  const hp = (s) => Number(s.structAttributes.health);
  const P = (pid) => w.players.get(pid);
  const alive = (s) => s && !(st(s) & 32) && (st(s) & 2);
  const awake = (s) => alive(s) && (st(s) & 4);
  const setSt = (s, v) => { s.structAttributes.status = String(v); s.structAttributes.isOnline = !!(v & 4); s.structAttributes.isHidden = !!(v & 16); s.structAttributes.isDestroyed = !!(v & 32); };
  const charge = (pid) => w.height - Number(P(pid).gridAttributes.lastAction);
  const discharge = (pid) => { const p = P(pid); p.gridAttributes.lastAction = String(w.height); const r = w.gridRecords.find((g) => g.attributeId === `11-1-${p.Player.index}`); if (r) r.value = w.height; };
  const fleetOf = (pid) => w.fleets.get(P(pid).Player.fleetId);
  const planetOf = (pid) => w.planets.get(P(pid).Player.planetId);
  const roll = (n, d) => d > 0 && n > 0 && Math.floor(Math.random() * d) + 1 <= n;
  const wpn = (t, ws, k) => t[ws + k];
  const reaches = (mask, from, to) => { if (mask & 32) mask |= AMB[from]; return !!(mask & AMB[to]); };
  /** Where a struct is in the sky: the planet it stands over. */
  const skyOf = (s) => {
    if (s.Struct.locationType === 'planet') return s.Struct.locationId;
    const f = w.fleets.get(s.Struct.locationId); return f ? f.locationId : '';
  };
  const reachable = (a, t) => {
    const fa = a.Struct.locationType === 'fleet' ? w.fleets.get(a.Struct.locationId) : null;
    if (!fa) return false;
    // abroad: anything over that isle; at home: only raiders in our own sky
    if (fa.status === 'away') return skyOf(t) === fa.locationId;
    return t.Struct.locationType === 'fleet' && w.fleets.get(t.Struct.locationId)?.status === 'away' && skyOf(t) === fa.locationId;
  };

  function destroy(s, touched) {
    s.structAttributes.health = '0'; setSt(s, (st(s) | 32) & ~4);
    touched.add(s.Struct.id);
    // a fallen guard guards no more
    for (const o of w.structs.values()) if (o.structDefenders?.includes(s.Struct.id)) o.structDefenders = o.structDefenders.filter((x) => x !== s.Struct.id);
    // a raider's fallen Wyrm breaks its raid: the warband limps home
    if (T(s)?.triggerRaidDefeatByDestruction && s.Struct.locationType === 'fleet') {
      const f = w.fleets.get(s.Struct.locationId);
      if (f && f.status === 'away') {
        const pl = w.planets.get(f.locationId);
        rideHome(f, pl);
        raidEvents.push({ type: 'EventRaid', key: 'eventRaidDetail', data: { fleetId: f.id, planetId: pl?.Planet.id || '', status: 'attackerDefeated', seized_ore: '0' } });
      }
    }
  }
  function hurt(s, n, touched) {
    if (!n) return;
    const left = Math.max(0, hp(s) - n);
    s.structAttributes.health = String(left); touched.add(s.Struct.id);
    if (!left) destroy(s, touched);
  }
  function rideHome(f, pl) {
    if (pl && pl.Planet.locationListStart === f.id) { pl.Planet.locationListStart = ''; pl.Planet.locationListCount = '0'; pl.planetAttributes.blockStartRaid = '0'; }
    f.status = 'onStation'; f.locationId = P(f.owner).Player.planetId;
  }
  let raidEvents = [];

  /** One strike, exactly as the ledger orders it: evade, guards counter, a guard blocks, the volley, the target answers, the spire. */
  function attack(attackerId, targetIds, ws) {
    const a = S(attackerId); if (!a || !alive(a)) return { error: `struct (${attackerId}) is destroyed` };
    const at = T(a), pid = a.Struct.owner, cost = wpn(at, ws, 'Charge');
    if (!awake(a)) return { error: `struct (${attackerId}) is offline but must be online for readiness_check` };
    if (!cost) return { error: `struct type (${at.id}) has no ${ws}` };
    if (charge(pid) < cost) return { error: `struct type (${at.id}) required charge of ${cost} for attack, but player (${pid}) only had ${charge(pid)}` };
    raidEvents = [];
    const touched = new Set([attackerId]);
    setSt(a, st(a) & ~16);   // striking drops the veil
    const detail = { attackerStructId: a.Struct.id, attackerStructTypeId: String(at.id), attackerStructType: at.type, attackerStructLocationType: a.Struct.locationType, attackerStructLocationId: a.Struct.locationId, attackerStructOperatingAmbit: a.Struct.operatingAmbit, attackerStructSlot: a.Struct.slot, weaponSystem: ws, weaponControl: wpn(at, ws, 'Control'), activeWeaponry: wpn(at, '', ws) || '', eventAttackShotDetail: [], attackerPlayerId: pid, attackerHealthBefore: String(hp(a)), attackerHealthMax: String(at.maxHealth) };
    const counterable = at.attackCounterable && wpn(at, ws, 'Counterable') !== false;
    const planets = new Set();
    for (const tid of targetIds) {
      const t = S(tid);
      if (!t || !alive(t)) return { error: `target struct (${tid}) is destroyed from attacker struct (${attackerId})` };
      const tt = T(t);
      if (!reaches(wpn(at, ws, 'Ambits'), a.Struct.operatingAmbit, t.Struct.operatingAmbit)) return { error: `target struct (${tid}) is out_of_range from attacker struct (${attackerId})` };
      if ((st(t) & 16) && t.Struct.operatingAmbit !== a.Struct.operatingAmbit) return { error: `target struct (${tid}) is hidden from attacker struct (${attackerId})` };
      if (!reachable(a, t)) return { error: `target struct (${tid}) is unreachable from attacker struct (${attackerId})` };
      const shot = { targetStructId: tid, targetPlayerId: t.Struct.owner, targetStructTypeId: String(tt.id), targetStructType: tt.type, targetStructLocationType: t.Struct.locationType, targetStructOperatingAmbit: t.Struct.operatingAmbit, targetHealthBefore: String(hp(t)), targetHealthMax: String(tt.maxHealth), eventAttackDefenderCounterDetail: [] };
      // evasion
      const control = wpn(at, ws, 'Control');
      const [n, d] = control === 'guided' ? [tt.guidedDefensiveSuccessRateNumerator, tt.guidedDefensiveSuccessRateDenominator] : [tt.unguidedDefensiveSuccessRateNumerator, tt.unguidedDefensiveSuccessRateDenominator];
      const evaded = roll(n, d);
      if (evaded) { shot.evaded = true; shot.evadedCause = tt.unitDefenses; }
      // guards: every one able counters first; the first in the target's realm blocks
      let blocker = null;
      for (const gid of t.structDefenders || []) {
        const g = S(gid); if (!g || gid === tid || gid === attackerId || !awake(g)) continue;
        const gt = T(g); if (!gt.canDefend) continue;
        if (counterable && reaches(gt.primaryWeaponAmbits | gt.secondaryWeaponAmbits, g.Struct.operatingAmbit, a.Struct.operatingAmbit) && alive(a)) {
          const dmg = g.Struct.operatingAmbit === a.Struct.operatingAmbit ? gt.counterAttackSameAmbit : gt.counterAttack;
          if (dmg) { hurt(a, dmg, touched); shot.eventAttackDefenderCounterDetail.push({ counterByStructId: gid, counterByStructTypeId: String(gt.id), counterByStructType: gt.type, counterByStructOperatingAmbit: g.Struct.operatingAmbit, counterDamage: String(dmg), counterDestroyedAttacker: !alive(a) }); }
        }
        if (!evaded && !blocker && g.Struct.operatingAmbit === t.Struct.operatingAmbit) blocker = g;
        if (!alive(a)) break;
      }
      // the volley lands on the blocker or the target
      if (alive(a) && !evaded) {
        const on = blocker || t, ot = T(on);
        if (blocker) Object.assign(shot, { blocked: true, blockedByStructId: blocker.Struct.id, blockedByStructType: ot.type, blockedByStructTypeId: String(ot.id), blockedByStructOperatingAmbit: blocker.Struct.operatingAmbit, blockerHealthBefore: String(hp(blocker)), blockerHealthMax: String(ot.maxHealth) });
        const shots = wpn(at, ws, 'Shots') || 1, sure = wpn(at, ws, 'GuaranteedShots') || 0;
        let rolled = 0;
        for (let i = 0; i < shots; i++) if (i < sure || roll(wpn(at, ws, 'ShotSuccessRateNumerator') || 1, wpn(at, ws, 'ShotSuccessRateDenominator') || 1)) rolled += wpn(at, ws, 'Damage');
        let red = ot.attackReduction || 0, net = rolled;
        const ap = red > 0 && wpn(at, ws, 'ArmourPiercing');
        if (ap) red = 0;
        if (rolled && red) net = red >= rolled ? 1 : rolled - red;
        Object.assign(shot, { damageDealt: String(rolled), damageReduction: String(rolled ? red : 0), damage: String(net), armourPiercing: !!ap });
        if (red && rolled) shot.damageReductionCause = ot.unitDefenses;
        hurt(on, net, touched);
        if (blocker) { shot.blockerHealthAfter = String(hp(blocker)); shot.blockerDestroyed = !alive(blocker); }
      }
      // the target answers, if it lives and can reach
      if (counterable && alive(a) && alive(t) && awake(t) && reaches(tt.primaryWeaponAmbits | tt.secondaryWeaponAmbits, t.Struct.operatingAmbit, a.Struct.operatingAmbit)) {
        const dmg = t.Struct.operatingAmbit === a.Struct.operatingAmbit ? tt.counterAttackSameAmbit : tt.counterAttack;
        if (dmg) { hurt(a, dmg, touched); Object.assign(shot, { targetCountered: true, targetCounteredDamage: String(dmg), targetCounterDestroyedAttacker: !alive(a) }); }
      }
      shot.targetHealthAfter = String(hp(t)); shot.targetDestroyed = !alive(t);
      if (tt.category === 'planet') planets.add(t.Struct.locationId);
      detail.eventAttackShotDetail.push(shot);
      if (!alive(a)) break;
    }
    // the Thunder Spire answers anyone who strikes its isle's hallows
    if (counterable && alive(a)) {
      let cannon = 0;
      for (const pl of planets) for (const s of w.structs.values()) if (s.Struct.locationId === pl && awake(s) && T(s)?.planetaryDefenses === 'defensiveCannon') cannon++;
      if (cannon) { hurt(a, cannon, touched); Object.assign(detail, { planetaryDefenseCannonDamageToAttacker: true, planetaryDefenseCannonDamage: String(cannon), planetaryDefenseCannonDamageDestroyedAttacker: !alive(a) }); }
    }
    detail.attackerHealthAfter = String(hp(a));
    discharge(pid);
    return { events: [{ type: 'EventAttack', key: 'eventAttackDetail', data: detail }, ...raidEvents], touched };
  }

  /** Can the plunder chant land? Only while the defender's Wyrm cannot guard its isle. */
  function vulnerable(pl) {
    const owner = P(pl.Planet.owner); if (!owner) return true;
    const f = w.fleets.get(owner.Player.fleetId); if (!f || f.status === 'away' || !f.commandStruct) return true;
    const c = S(f.commandStruct); return !c || !awake(c);
  }

  /** Play one signed rite: the events it makes, or the refusal the ledger would give. */
  function play(msg) {
    if (msg.type === 'MsgStructAttack') return attack(msg.str(2)[0], msg.str(3), msg.str(4)[0] || 'primaryWeapon');
    if (msg.type === 'MsgFleetMove') {
      const f = w.fleets.get(msg.str(2)[0]), dest = msg.str(3)[0];
      if (!f) return { error: 'fleet not found' };
      const pl = w.planets.get(f.locationId);
      // a warband rides on its Elder Wyrm (PlanetMoveReadinessCheck)
      const cmd = f.commandStruct && S(f.commandStruct);
      if (!cmd || !alive(cmd)) return { error: `fleet (${f.id}) cannot move: no_command_struct` };
      if (!awake(cmd)) return { error: `fleet (${f.id}) cannot move: command_offline` };
      if (dest === P(f.owner).Player.planetId) { rideHome(f, f.status === 'away' ? pl : null); }
      else {
        const to = w.planets.get(dest); if (!to) return { error: `planet (${dest}) not found` };
        if (f.status === 'away') rideHome(f, pl);
        f.status = 'away'; f.locationId = dest;
        if (!to.Planet.locationListStart) { to.Planet.locationListStart = f.id; to.Planet.locationListCount = '1'; to.planetAttributes.blockStartRaid = String(w.height); to.planetAttributes.blockRaiderArrived = String(w.height); }
      }
      return { events: [{ type: 'EventFleet', key: 'fleet', data: { id: f.id, owner: f.owner, locationId: f.locationId, status: f.status } }], touched: new Set([f.id, f.owner]) };
    }
    if (msg.type === 'MsgStructMove') {
      const s = S(msg.str(2)[0]); if (!s) return { error: 'struct not found' };
      const t = T(s), to = AMBIT_ENUM[msg.int(5)];
      if (charge(s.Struct.owner) < t.moveCharge) return { error: `struct type (${t.id}) required charge of ${t.moveCharge} for move, but player (${s.Struct.owner}) only had ${charge(s.Struct.owner)}` };
      if (!(t.possibleAmbit & AMB[to])) return { error: `struct type (${t.id}) cannot move to ${to}` };
      s.Struct.operatingAmbit = to; discharge(s.Struct.owner);
      return { events: [{ type: 'EventStruct', key: 'structure', data: { id: s.Struct.id, owner: s.Struct.owner } }], touched: new Set([s.Struct.id]) };
    }
    if (msg.type === 'MsgStructDefenseSet' || msg.type === 'MsgStructDefenseClear') {
      const g = S(msg.str(2)[0]); if (!g) return { error: 'struct not found' };
      for (const o of w.structs.values()) if (o.structDefenders?.includes(g.Struct.id)) o.structDefenders = o.structDefenders.filter((x) => x !== g.Struct.id);
      if (msg.type === 'MsgStructDefenseSet') { const p = S(msg.str(3)[0]); g.structAttributes.protectedStructIndex = p.Struct.index; p.structDefenders = [...(p.structDefenders || []), g.Struct.id]; }
      else g.structAttributes.protectedStructIndex = '0';
      discharge(g.Struct.owner);
      return { events: [{ type: 'EventStruct', key: 'structure', data: { id: g.Struct.id, owner: g.Struct.owner } }], touched: new Set([g.Struct.id]) };
    }
    if (msg.type === 'MsgPlanetRaidComplete') {
      const f = w.fleets.get(msg.str(2)[0]); if (!f || f.status !== 'away') return { error: 'fleet cannot raid_complete while on_station' };
      const pl = w.planets.get(f.locationId);
      if (!vulnerable(pl)) return { error: `planet (${pl.Planet.id}) cannot raid_complete while shields_active` };
      const victim = P(pl.Planet.owner), thief = P(f.owner);
      const seized = Number(victim.gridAttributes.ore);
      thief.gridAttributes.ore = String(Number(thief.gridAttributes.ore) + seized); victim.gridAttributes.ore = '0';
      for (const [p, v] of [[thief, thief.gridAttributes.ore], [victim, '0']]) { const r = w.gridRecords.find((g) => g.attributeId === `0-1-${p.Player.index}`); if (r) r.value = Number(v); }
      rideHome(f, pl);
      return { events: [{ type: 'EventOreTheft', key: 'eventOreTheftDetail', data: { victimPlayerId: victim.Player.id, thiefPlayerId: thief.Player.id, amount: String(seized) } }, { type: 'EventRaid', key: 'eventRaidDetail', data: { fleetId: f.id, planetId: pl.Planet.id, status: 'raidSuccessful', seized_ore: String(seized) } }], touched: new Set([f.id, victim.Player.id, thief.Player.id]) };
    }
    if (msg.type === 'MsgStructActivate' || msg.type === 'MsgStructDeactivate') {
      const s = S(msg.str(2)[0]); if (!s) return { error: 'struct not found' };
      setSt(s, msg.type === 'MsgStructActivate' ? st(s) | 4 : st(s) & ~4); if (msg.type === 'MsgStructActivate') discharge(s.Struct.owner);
      return { events: [{ type: 'EventStruct', key: 'structure', data: { id: s.Struct.id, owner: s.Struct.owner } }], touched: new Set([s.Struct.id]) };
    }
    return { events: [], touched: new Set() };
  }

  /** The foe's turn: when your warband hangs in their sky (or theirs in yours), one of their beasts strikes. */
  function foeTurn(foePid, mePid) {
    const fF = fleetOf(foePid), mF = fleetOf(mePid);
    const fight = (mF.status === 'away' && mF.locationId === planetOf(foePid).Planet.id) || (fF.status === 'away' && fF.locationId === planetOf(mePid).Planet.id);
    if (!fight) return null;
    const theirs = [...w.structs.values()].filter((s) => s.Struct.owner === foePid && awake(s) && T(s)?.category === 'fleet');
    const mine = [...w.structs.values()].filter((s) => s.Struct.owner === mePid && alive(s) && T(s)?.category === 'fleet' && !(st(s) & 16));
    const options = [];
    for (const a of theirs) for (const ws of ['primaryWeapon', 'secondaryWeapon']) {
      const at = T(a), cost = wpn(at, ws, 'Charge'); if (!cost || charge(foePid) < cost) continue;
      for (const t of mine) if (reaches(wpn(at, ws, 'Ambits'), a.Struct.operatingAmbit, t.Struct.operatingAmbit) && reachable(a, t)) options.push({ a, t, ws, wyrm: T(t).id === 1 });
    }
    if (!options.length) return null;
    // the foe goes for your Wyrm when it can
    const pool = options.some((o) => o.wyrm) && Math.random() < 0.4 ? options.filter((o) => o.wyrm) : options;
    const o = pool[Math.floor(Math.random() * pool.length)];
    return attack(o.a.Struct.id, [o.t.Struct.id], o.ws);
  }

  return { play, attack, foeTurn, charge, vulnerable };
}

/* ── run it ──────────────────────────────────────────────────────────── */
/** Start the arena: the mock ledger playing war, and the game served against it. */
export async function startArena({ port = 5194, blockMs = 1000, calm = false, log = console.log, foeEvery = 15000 } = {}) {
  const ledger = new Ledger(null);
  await ledger.start({ blockMs });
  const sky = arenaSky(ledger.lcdUrl);
  ledger.world = sky.w;
  const rules = makeRules(sky, ledger);
  const say = (s) => log(`  bell ${sky.w.height} · ${s}`);
  ledger.onSimulate = (raw) => {
    // the queue simulates before it signs for real: refuse what the ledger would refuse, without changing anything
    try {
      for (const m of decodeTx(raw)) {
        if (m.type !== 'MsgStructAttack') continue;
        const s = sky.w.structs.get(m.str(2)[0]); if (!s) return 'struct not found';
        const t = typeOf(Number(s.Struct.type)), ws = m.str(4)[0] || 'primaryWeapon', need = t[ws + 'Charge'];
        if (rules.charge(s.Struct.owner) < need) return `struct type (${t.id}) required charge of ${need} for attack, but player (${s.Struct.owner}) only had ${rules.charge(s.Struct.owner)}`;
      }
    } catch { /* not ours to judge */ }
    return null;
  };
  ledger.onBroadcast = (hash, raw) => {
    let msgs = [];
    try { msgs = decodeTx(raw); } catch (e) { say('could not read a rite: ' + e.message); return; }
    const all = []; let error = '';
    for (const m of msgs) {
      const r = rules.play(m);
      if (r.error) { error = r.error; break; }
      all.push(...r.events);
    }
    const t = ledger.txs.get(hash);
    if (error) { t.code = 1400; t.log = `failed to execute message; message index: 0: ${error}`; say(`refused ${msgs.map((m) => m.type).join(',')}: ${error}`); return; }
    t.events = all.map((e) => ({ type: 'structs.structs.' + e.type, attributes: [{ key: e.key, value: JSON.stringify(e.data) }, { key: 'msg_index', value: '0' }] }));
    say(`${msgs.map((m) => m.type).join(', ')}${all.some((e) => e.type === 'EventAttack') ? ' → ' + all.filter((e) => e.type === 'EventAttack').map((e) => e.data.eventAttackShotDetail.map((s) => s.evaded ? 'dodged' : s.blocked ? `blocked, ${s.damage}` : `${s.damage} dmg${s.targetDestroyed ? ', felled' : ''}`).join('; ')).join(' | ') : ''}`);
    // the node tells the live feed a bell later, when the rite lands
    setTimeout(() => ledger.emitTx(all, { hash }), blockMs);
  };
  /** The foe strikes once, if it can; the blow is told on the live feed. */
  const foeStrike = () => {
    const r = rules.foeTurn(sky.foe.pid, sky.me.pid);
    if (!r || r.error) return null;
    const s = r.events[0].data.eventAttackShotDetail[0];
    say(`Grimwald's ${r.events[0].data.attackerStructType} strikes your ${s.targetStructType}: ${s.evaded ? 'dodged' : s.blocked ? 'blocked' : s.damage + ' dmg'}`);
    ledger.emitTx(r.events);
    return r;
  };
  const timer = calm ? 0 : setInterval(foeStrike, foeEvery);
  const app = await startApp({ port, lcdUrl: ledger.lcdUrl, wsUrl: ledger.wsUrl });
  return { ledger, sky, rules, app, foeStrike, stop: async () => { clearInterval(timer); await app.stop(); await ledger.stop(); } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = await startArena({ port, blockMs, calm });
  console.log(`arena · game ${a.app.url} · ledger ${a.ledger.lcdUrl} · you are ${a.sky.me.pid} (Aldric), the foe ${a.sky.foe.pid} (Grimwald)${calm ? ' · calm' : ''}`);
  console.log(`  open ${a.app.url}#/skirmish/${a.sky.foe.pid}`);
}
