/* The laws of war as the ledger keeps them (attack_context.go): who can reach whom, what a blow is
 * likely to do before it is struck, which blow is wisest, and what the ledger says a blow did.
 * The Skirmish asks; nothing here signs. Numbers come from the catalogue; words from the lore. */
import { AMBIT_FLAG, type Ambit, type StructType, type WeaponSystem } from '../data/catalogue';
import type { OwnedStruct, PlayerState } from './empire';
import { REALM_NAME, REALM_OF_AMBIT, WARD_CRAFT, beastName, type Realm } from '../lore';

export const WEAPONS: WeaponSystem[] = ['primaryWeapon', 'secondaryWeapon'];
const LOCAL = 32;

export interface Arm { system: WeaponSystem; guided: boolean; charge: number; ambits: number; damage: number; shots: number; sure: number; rate: number; ap: boolean; counterable: boolean }
/** A beast's weapon, as plain numbers, or null when it has none in that hand. */
export function arm(t: StructType, w: WeaponSystem): Arm | null {
  const r = t as unknown as Record<string, number | string | boolean>;
  const charge = Number(r[w + 'Charge'] || 0);
  if (!charge) return null;
  const n = Number(r[w + 'ShotSuccessRateNumerator'] || 1), d = Number(r[w + 'ShotSuccessRateDenominator'] || 1);
  return {
    system: w, guided: r[w + 'Control'] === 'guided', charge, ambits: Number(r[w + 'Ambits'] || 0), damage: Number(r[w + 'Damage'] || 0),
    shots: Math.max(1, Number(r[w + 'Shots'] || 1)), sure: Number(r[w + 'GuaranteedShots'] || 0), rate: d ? n / d : 1,
    ap: !!r[w + 'ArmourPiercing'], counterable: t.attackCounterable && r[w + 'Counterable'] !== false,
  };
}

const flag = (a: string) => AMBIT_FLAG[a as Ambit] || 0;
/** A reach mask from one realm to another; "local" reaches the realm the beast stands in. */
export const reaches = (mask: number, from: string, to: string) => !!((mask | (mask & LOCAL ? flag(from) : 0)) & flag(to));
export const realmOfAmbit = (a: string): Realm => REALM_OF_AMBIT[a as Ambit] || 'wilds';
const realmName = (a: string) => REALM_NAME[realmOfAmbit(a)];
/** "the Skies", "Starfall": a realm in a sentence. */
export const inRealm = (a: string) => ({ space: 'Starfall', air: 'the Skies', land: 'the Wilds', water: 'the Deeps' } as Record<string, string>)[a] || 'its realm';

export const alive = (s: OwnedStruct) => !s.destroyed && s.built && !!s.type;
export const isWyrm = (s?: OwnedStruct | null) => !!s && s.typeId === 1;
/** Can this beast answer a blow from a striker standing in `ambit`? */
function answers(s: OwnedStruct, ambit: string) {
  const t = s.type!;
  return alive(s) && s.online && reaches(t.primaryWeaponAmbits | t.secondaryWeaponAmbits, s.ambit, ambit);
}
const counterOf = (s: OwnedStruct, ambit: string) => (s.ambit === ambit ? s.type!.counterAttackSameAmbit : s.type!.counterAttack);

export interface Reach { weapon: WeaponSystem | null; why: string; soar?: Ambit }
/** Which weapon a striker would use on a mark, or why it can't (and the realm a Wyrm could soar to). */
export function reach(a: OwnedStruct, t: OwnedStruct): Reach {
  const at = a.type!, ta = t.ambit;
  if (!alive(t)) return { weapon: null, why: 'Already fallen' };
  if (!at.primaryWeaponCharge && !at.secondaryWeaponCharge) return { weapon: null, why: `The ${beastName(a.typeId)} cannot strike` };
  const soar = at.movable && (at.possibleAmbit & flag(ta)) ? ta as Ambit : undefined;
  if (t.hidden && ta !== a.ambit) return { weapon: null, why: `Veiled: only a beast in ${inRealm(ta)} can find it`, soar };
  for (const w of WEAPONS) { const x = arm(at, w); if (x && reaches(x.ambits, a.ambit, ta)) return { weapon: w, why: '' }; }
  if (soar) return { weapon: null, why: `Your Elder Wyrm strikes only in its own realm: it would soar into ${inRealm(ta)} first`, soar };
  return { weapon: null, why: `A ${beastName(a.typeId)} in ${inRealm(a.ambit)} cannot reach ${inRealm(ta)}` };
}

/* ── Before the blow: what it will likely do ─────────────────────────── */

export interface Forecast {
  arm: Arm;
  /** Chance the blow is not turned aside (0..1), and by what art when it can be. */
  land: number; dodgeBy?: string;
  /** Who takes the blow: the mark, or a guard that steps in front of it. */
  guard?: OwnedStruct; hitsOn: OwnedStruct;
  dmg: { min: number; max: number; avg: number }; stone: number; cracks: boolean;
  /** Chance the one it lands on falls; chance the mark itself falls. */
  fell: number; fellMark: number;
  /** Every blow that can come back at the striker, and the worst of it. */
  back: { by: OwnedStruct; dmg: number; why: 'guard' | 'mark' | 'spire' }[];
  backAvg: number; backMax: number;
  /** Chance the striker falls. */
  lost: number;
  spire: number;
  verdict: { tone: 'good' | 'fair' | 'risky' | 'deadly' | 'futile'; text: string };
}

/** Hit counts for a volley: [hits, chance]. The first `sure` shots always land. */
function volley(x: Arm): [number, number][] {
  const free = Math.max(0, x.shots - x.sure);
  const out: [number, number][] = [];
  // binomial over the free shots
  let comb = 1;
  for (let k = 0; k <= free; k++) {
    if (k > 0) comb = comb * (free - k + 1) / k;
    out.push([x.sure + k, comb * Math.pow(x.rate, k) * Math.pow(1 - x.rate, free - k)]);
  }
  return out;
}

/** The guards that would act for a mark: those awake and still at its side. */
export function guardsOf(t: OwnedStruct, owner: PlayerState | null): OwnedStruct[] {
  if (!owner) return [];
  return (t.defenders || []).map((id) => owner.structs.get(id)).filter((g): g is OwnedStruct => !!g && g.id !== t.id && alive(g) && g.online && !!g.type?.canDefend);
}

/** Hallows on the mark's isle that lash whoever strikes there (the Thunder Spire). */
function spiresOver(t: OwnedStruct, owner: PlayerState | null) {
  if (!owner || t.type?.category !== 'planet') return 0;
  let n = 0;
  for (const s of owner.structs.values()) if (alive(s) && s.online && s.type?.planetaryDefenses === 'defensiveCannon' && s.locationId === t.locationId) n++;
  return n;
}

/** What a blow from `a` on `t` is likely to do, the ledger's order of things followed exactly. */
export function forecast(a: OwnedStruct, t: OwnedStruct, w: WeaponSystem, theirs: PlayerState | null): Forecast | null {
  const x = arm(a.type!, w); if (!x) return null;
  const tt = t.type!;
  const [n, d] = x.guided ? [tt.guidedDefensiveSuccessRateNumerator, tt.guidedDefensiveSuccessRateDenominator] : [tt.unguidedDefensiveSuccessRateNumerator, tt.unguidedDefensiveSuccessRateDenominator];
  const evade = d && n ? n / d : 0;
  const guards = guardsOf(t, theirs);
  const guard = guards.find((g) => g.ambit === t.ambit);
  const counterers = x.counterable ? guards.filter((g) => answers(g, a.ambit)) : [];
  const spire = x.counterable ? spiresOver(t, theirs) : 0;
  const markAnswers = x.counterable && t.online && answers(t, a.ambit) ? counterOf(t, a.ambit) : 0;
  const on = guard || t, ot = on.type!;
  const stone = ot.attackReduction && !x.ap ? ot.attackReduction : 0;
  const net = (rolled: number) => (rolled && stone ? (stone >= rolled ? 1 : rolled - stone) : rolled);
  const hits = volley(x);
  // walk every outcome the dice allow
  let fell = 0, fellMark = 0, lost = 0, backAvg = 0, backMax = 0, dMin = Infinity, dMax = 0, dAvg = 0;
  const outcomes: [boolean, number, number][] = [[true, 0, evade], ...hits.map(([k, p]) => [false, k, p * (1 - evade)] as [boolean, number, number])];
  for (const [dodged, k, p] of outcomes) {
    if (p <= 0) continue;
    let hp = a.health, back = 0;
    for (const g of counterers) { if (hp <= 0) break; const c = counterOf(g, a.ambit); hp -= c; back += c; }
    let onHp = on.health, markHp = t.health;
    if (hp > 0 && !dodged) {
      const dmg = net(k * x.damage);
      onHp -= dmg; if (on === t) markHp = onHp;
      dMin = Math.min(dMin, dmg); dMax = Math.max(dMax, dmg); dAvg += p * dmg / (1 - evade || 1);
    }
    if (hp > 0 && markHp > 0 && markAnswers) { hp -= markAnswers; back += markAnswers; }
    if (hp > 0 && spire) { hp -= spire; back += spire; }
    if (onHp <= 0) fell += p;
    if (markHp <= 0) fellMark += p;
    if (hp <= 0) lost += p;
    backAvg += p * back; backMax = Math.max(backMax, back);
  }
  if (!Number.isFinite(dMin)) dMin = 0;
  const back = [
    ...counterers.map((g) => ({ by: g, dmg: counterOf(g, a.ambit), why: 'guard' as const })),
    ...(markAnswers ? [{ by: t, dmg: markAnswers, why: 'mark' as const }] : []),
    ...(spire ? [{ by: t, dmg: spire, why: 'spire' as const }] : []),
  ];
  const f: Forecast = { arm: x, land: 1 - evade, dodgeBy: evade ? WARD_CRAFT[tt.unitDefenses] : undefined, guard, hitsOn: on, dmg: { min: dMin, max: dMax, avg: dAvg }, stone, cracks: !!(ot.attackReduction && x.ap), fell, fellMark, back, backAvg, backMax, lost, spire, verdict: { tone: 'fair', text: '' } };
  f.verdict = verdictOf(a, t, f);
  return f;
}

const pct = (p: number) => (p >= 0.995 ? 'certain' : p <= 0.005 ? 'no chance' : `${Math.round(p * 100)}%`);
export { pct };

function verdictOf(a: OwnedStruct, t: OwnedStruct, f: Forecast): Forecast['verdict'] {
  const mine = `your ${beastName(a.typeId)}`;
  if (f.lost >= 0.995) return { tone: 'deadly', text: isWyrm(a) ? 'Your Elder Wyrm would fall, and the raid with it. Do not.' : `The answer would fell ${mine}.` };
  if (f.lost > 0) return { tone: 'risky', text: isWyrm(a) ? `Your Elder Wyrm could fall (${pct(f.lost)}), breaking the raid.` : `${mine.replace(/^y/, 'Y')} could fall (${pct(f.lost)}).` };
  if (f.guard && f.dmg.max === 0) return { tone: 'futile', text: `It cannot hurt their ${beastName(f.guard.typeId)}.` };
  if (f.guard && f.fell < 0.995) return { tone: 'fair', text: `Their ${beastName(f.guard.typeId)} takes this blow. Fell the guard first, and the ${beastName(t.typeId)} stands open.` };
  if (f.guard) return { tone: 'good', text: `It fells their ${beastName(f.guard.typeId)}, the ${beastName(t.typeId)}’s guard.` };
  if (f.fell >= 0.995) return { tone: 'good', text: `This fells their ${beastName(t.typeId)}.` };
  if (f.fell > 0) return { tone: 'good', text: `A ${pct(f.fell)} chance to fell it.` };
  if (f.land < 0.5) return { tone: 'fair', text: `Most such blows are turned aside (${f.dodgeBy}).` };
  return { tone: f.backMax ? 'fair' : 'good', text: f.backMax ? 'A fair trade of blows.' : 'Nothing answers this blow.' };
}

/* ── Which blow is wisest ───────────────────────────────────────────── */

export interface Move { a: OwnedStruct; t: OwnedStruct; f: Forecast; score: number; /** it lands on their Wyrm or a guard of it: the way a raid is won */ goal: boolean }

/** A guard of that warden's Elder Wyrm. */
function guardsWyrm(s: OwnedStruct, owner: PlayerState | null) {
  const id = owner?.fleet?.commandStruct, w = id ? owner?.structs.get(id) : undefined;
  return !!w && !!w.defenders?.includes(s.id);
}
/** How much a beast matters in this fight: Wyrms most, then their guards, then anything that strikes. Hallows
 * win nothing in a raid (a ward hallow only slows the plunder a little; a Thunder Spire lashes back). */
function worth(s: OwnedStruct, owner: PlayerState | null) {
  if (isWyrm(s)) return 10;
  if (guardsWyrm(s, owner)) return 6;
  if (s.type?.category === 'planet') return s.type.planetaryShieldContribution ? 1 : 0.4;
  if (s.type?.primaryWeaponCharge) return 4;
  return 1;
}

/** The blow to suggest: the wisest worth striking, else the safest that still wins the raid, else none.
 * `safe` says which risks are acceptable (Fight on is stricter than a suggestion). */
export function wisest(list: Move[], safe: (m: Move) => boolean = (m) => m.f.lost < 0.995): Move | null {
  return list.find((m) => m.score > 0 && safe(m)) || list.find((m) => m.goal && m.f.dmg.max > 0 && safe(m)) || null;
}

/** Every blow our warband can strike now, wisest first. */
export function moves(mine: OwnedStruct[], marks: OwnedStruct[], me: PlayerState | null, foe: PlayerState | null): Move[] {
  const out: Move[] = [];
  for (const a of mine) {
    if (!alive(a) || !a.online) continue;
    for (const t of marks) {
      const r = reach(a, t); if (!r.weapon) continue;
      const f = forecast(a, t, r.weapon, foe); if (!f) continue;
      const v = worth(f.hitsOn, foe), mw = worth(a, me);
      // every heart the Elder Wyrm spends is a heart of the raid: wounds to it weigh more than to any other beast
      const bleed = isWyrm(a) ? 0.8 : 0.4;
      const score = f.fell * v + (f.dmg.avg * f.land / Math.max(1, f.hitsOn.health)) * v * 0.5 + (f.fellMark && f.hitsOn !== t ? f.fellMark * worth(t, foe) : 0)
        - f.lost * mw * 1.5 - (f.backAvg / Math.max(1, a.type!.maxHealth)) * mw * bleed - f.arm.charge * 0.02;
      out.push({ a, t, f, score, goal: isWyrm(f.hitsOn) || guardsWyrm(f.hitsOn, foe) });
    }
  }
  return out.sort((x, y) => y.score - x.score);
}

/* ── While you hang there: what of theirs can strike yours ───────────── */

/** Bells without a rite after which a warden is long asleep, and unlikely to strike (the Atlas says so too). */
export const LONG_ASLEEP = 14400;
/** The truth about hearts, said wherever a wounded beast's hearts are: the ledger has no rite that heals. */
export const NO_MENDING = 'Wounds never mend. A fallen beast can be summoned anew at full hearts.';

export interface Exposure {
  /** The beast at risk: your Elder Wyrm, or a striker. */
  on: OwnedStruct;
  /** Each beast of theirs that can reach it, and the most one blow of it takes from it. */
  by: { s: OwnedStruct; dmg: number }[];
  /** A guard of yours in its realm: their blows land on it first. */
  guard?: OwnedStruct;
  /** The most one of their blows takes from it. */
  worst: number;
  /** How many of their blows, each their worst, would fell it (through its guards first). Infinity when none can. */
  blows: number;
  /** It could fall if each beast that reaches it strikes once (after the hearts this blow's answer takes). */
  falls: boolean;
  /** Hearts it would keep after that round (zero or less: fallen). */
  left: number;
}

/** What of `foes` can strike `on` while the warbands share a sky, by realm reach, stone-skin and guard, the
 * ledger's rules as forecast() keeps them. `first`: hearts it loses before their round (this blow's answer). */
export function exposure(on: OwnedStruct, foes: OwnedStruct[], owner: PlayerState | null, first = 0): Exposure {
  const reaching: { s: OwnedStruct; w: WeaponSystem }[] = [];
  for (const s of foes) {
    if (s.id === on.id || !alive(s) || !s.online || s.type!.category !== 'fleet') continue;
    const r = reach(s, on);
    if (r.weapon) reaching.push({ s, w: r.weapon });
  }
  // the first guard in its realm takes the blow; when it falls, the next does
  const blockers = owner ? guardsOf(on, owner).filter((g) => g.ambit === on.ambit) : [];
  /** The most one blow of `s` takes from `t`, struck with nothing in the way. */
  const hit = (s: OwnedStruct, w: WeaponSystem, t: OwnedStruct) => forecast(s, t, w, null)?.dmg.max ?? 0;
  const per = reaching.map(({ s, w }) => ({ s, me: hit(s, w, on), guards: blockers.map((g) => hit(s, w, g)) }));
  // blow after blow, their worst each time: through the guards, then on it
  let blows = per.length ? 0 : Infinity;
  for (let i = 0; i < blockers.length && blows !== Infinity; i++) {
    const best = Math.max(0, ...per.map((p) => p.guards[i]));
    blows = best ? blows + Math.ceil(blockers[i].health / best) : Infinity;
  }
  const worst = Math.max(0, ...per.map((p) => p.me));
  if (blows !== Infinity) blows = worst ? blows + Math.ceil(Math.max(0, on.health - first) / worst) : Infinity;
  // one round: each that reaches strikes once, the hardest first
  const gh = blockers.map((g) => g.health);
  let hp = on.health - first, g = 0;
  for (const p of [...per].sort((x, y) => y.me - x.me)) {
    while (g < gh.length && gh[g] <= 0) g++;
    if (g < gh.length) gh[g] -= p.guards[g]; else hp -= p.me;
  }
  return { on, by: per.map((p) => ({ s: p.s, dmg: p.me })), guard: blockers[0], worst, blows, falls: per.length > 0 && hp <= 0, left: hp };
}

/** A raid played out on paper: the wisest blow that lands on their Elder Wyrm or its guard, each time, every
 * answer at its worst, until their Wyrm falls or ours does. Their own blows are not struck here (see exposure). */
export function raidRun(me: PlayerState, foe: PlayerState, limit = 16): { wins: boolean; blows: number; breath: number; left: number; reached: boolean } {
  const copy = (p: PlayerState): PlayerState => ({ ...p, structs: new Map([...p.structs].map(([k, s]) => [k, { ...s }])) });
  const m = copy(me), f = copy(foe);
  const myW = wyrmOf(m), tw = wyrmOf(f);
  if (!myW || !alive(myW)) return { wins: false, blows: 0, breath: 0, left: 0, reached: false };
  // their Wyrm fallen, abroad or asleep: the ward is already open, nothing need be struck
  if (!wardKeeper(f)) return { wins: true, blows: 0, breath: 0, left: myW.health, reached: true };
  const home = f.fleet?.status !== 'away';
  let blows = 0, breath = 0;
  for (; blows < limit; ) {
    const mine = [...m.structs.values()].filter((s) => alive(s) && s.online && s.type!.category === 'fleet');
    const marks = [...f.structs.values()].filter((s) => alive(s) && (s.type!.category === 'planet' || home));
    const mv = moves(mine, marks, m, f).find((x) => x.goal && x.f.dmg.max > 0);
    if (!mv) return { wins: false, blows, breath, left: myW.health, reached: blows > 0 };
    blows++; breath += mv.f.arm.charge;
    const fc = mv.f, on = fc.hitsOn, t = mv.t;
    // a blow most often turned aside is counted as turned aside; one that lands, at its least
    if (fc.land >= 0.5) { on.health -= fc.dmg.min; if (on.health <= 0) { on.health = 0; on.destroyed = true; } }
    // every guard answers; the mark answers if it lives; a Thunder Spire lashes
    const back = fc.back.reduce((n, b) => n + (b.why === 'mark' && (t.destroyed || t.health <= 0) ? 0 : b.dmg), 0);
    mv.a.health -= back;
    if (mv.a.health <= 0) { mv.a.health = 0; mv.a.destroyed = true; }
    if (!alive(myW)) return { wins: false, blows, breath, left: 0, reached: true };
    if (!tw || !alive(tw)) return { wins: true, blows, breath, left: myW.health, reached: true };
  }
  return { wins: false, blows, breath, left: myW.health, reached: true };
}

export interface RaidOdds {
  /** A warband like this one comes home from it with its Elder Wyrm, by this reckoning. */
  safe: boolean;
  why: 'fallen' | 'open' | 'asleep' | 'unreached' | 'guarded' | 'reached' | 'answers' | 'unreachable';
  /** Their beasts that can reach your Elder Wyrm while you hang over their isle, and how hard. */
  ex: Exposure | null;
  /** Your blows to break their ward, and the hearts your Wyrm keeps from their answers alone. */
  run: ReturnType<typeof raidRun> | null;
  asleep: boolean;
}

/** Would a raid on `foe` cost `me` the Elder Wyrm? Safe when they have long slept, when nothing of theirs can
 * reach it, or when its guards hold out longer than the raid takes; never when their answers alone fell it. */
export function raidOdds(me: PlayerState, foe: PlayerState, height: number): RaidOdds {
  const w = wyrmOf(me);
  if (!w || !alive(w)) return { safe: false, why: 'fallen', ex: null, run: null, asleep: false };
  const asleep = !!foe.lastAction && height - foe.lastAction > LONG_ASLEEP;
  // their beasts strike only from home: a warband abroad hangs over someone else's isle
  const home = foe.fleet?.status !== 'away';
  const theirs = home ? [...foe.structs.values()].filter((s) => alive(s) && s.type!.category === 'fleet') : [];
  const run = raidRun(me, foe);
  // what reaches it as it rides in (told to the warden), and what is left of it once their answers are taken
  const ex = exposure(w, theirs, me);
  const late = exposure(w, theirs, me, w.health - run.left);
  if (!run.wins && run.left <= 0) return { safe: false, why: 'answers', ex, run, asleep };
  if (!run.wins) return { safe: false, why: 'unreachable', ex, run, asleep };
  if (!wardKeeper(foe) && !ex.by.length) return { safe: true, why: 'open', ex, run, asleep };
  if (asleep) return { safe: true, why: 'asleep', ex, run, asleep };
  if (!ex.by.length) return { safe: true, why: 'unreached', ex, run, asleep };
  // they strike as fast as their breath fills: once at once (breath kept), then once per blow's cost
  const cost = Math.min(...ex.by.map((b) => { const t = b.s.type!; return Math.min(...[t.primaryWeaponCharge, t.secondaryWeaponCharge].filter((c) => c > 0)); }));
  const theirBlows = 1 + Math.floor(run.breath / Math.max(1, cost));
  if (ex.guard && late.blows > theirBlows) return { safe: true, why: 'guarded', ex, run, asleep };
  return { safe: false, why: 'reached', ex, run, asleep };
}

const NUM = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
/** "three blows", "one blow". */
export const blowsWord = (n: number) => `${NUM[n] ?? n} ${n === 1 ? 'blow' : 'blows'}`;
/** "Stone Troll", "Stone Troll and Harpy", "Harpy, Kraken and Stone Troll": each kind once, two alike counted. */
export function kinds(xs: OwnedStruct[]): string {
  const c = new Map<string, number>();
  for (const x of xs) { const n = beastName(x.typeId); c.set(n, (c.get(n) || 0) + 1); }
  const parts = [...c].map(([n, k]) => (k > 1 ? `${NUM[k] ?? k} ${n}s` : n));
  return parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0] || '';
}

/* ── After the blow: what the ledger says happened ──────────────────── */

export interface Shot {
  targetId: string; targetType: number; targetOwner: string;
  evaded: boolean; evadedBy?: string;
  blockerId?: string; blockerType?: number; blockerFelled: boolean; blockerHpAfter?: number;
  damage: number; hits: number; stone: number; cracked: boolean;
  counters: { by: string; type: number; dmg: number }[];
  back: number; targetFelled: boolean; targetHpAfter: number; targetMax: number;
}
export interface Blow {
  key: string; attackerId: string; attackerType: number; attackerOwner: string; guided: boolean;
  shots: Shot[]; cannon: number; attackerHpAfter: number; attackerMax: number; attackerFelled: boolean;
}
const n = (v: unknown) => Number(v ?? 0) || 0;
const b = (v: unknown) => v === true || v === 'true';
const UNIT_DEFENSES = ['noUnitDefenses', 'defensiveManeuver', 'signalJamming', 'armour', 'indirectCombatModule', 'stealthMode', 'perimeterFencing'];
const art = (v: unknown, fallback?: string) => WARD_CRAFT[typeof v === 'number' ? UNIT_DEFENSES[v] : String(v || '')] || (fallback ? WARD_CRAFT[fallback] : '') || '';

/** An EventAttack payload (wrapped or not) as one blow. Rows of one volley are folded into one shot. */
export function readBlow(data: any, key: string, typeOf: (id: number) => StructType | undefined): Blow | null {
  const d = data && typeof data === 'object' && 'eventAttackDetail' in data ? data.eventAttackDetail : data;
  if (!d || !d.attackerStructId) return null;
  const rows: any[] = d.eventAttackShotDetail || [];
  const shots: Shot[] = [];
  for (const r of rows) {
    const id = String(r.targetStructId || '');
    let s = shots[shots.length - 1];
    // a multi-shot volley is told as several rows for one mark; only the last carries the outcome
    if (!s || s.targetId !== id || s.counters.length || s.back || s.targetFelled) {
      s = { targetId: id, targetType: n(r.targetStructTypeId), targetOwner: String(r.targetPlayerId || ''), evaded: false, blockerFelled: false, damage: 0, hits: 0, stone: 0, cracked: false, counters: [], back: 0, targetFelled: false, targetHpAfter: 0, targetMax: n(r.targetHealthMax) };
      shots.push(s);
    }
    if (n(r.damageDealt) > 0) s.hits++;
    s.evaded = s.evaded || b(r.evaded) || b(r.evadedByPlanetaryDefenses);
    if (s.evaded) s.evadedBy = b(r.evadedByPlanetaryDefenses) ? 'the Veil Moon' : art(r.evadedCause, typeOf(s.targetType)?.unitDefenses);
    if (b(r.blocked) || r.blockedByStructId) { s.blockerId = String(r.blockedByStructId); s.blockerType = n(r.blockedByStructTypeId); }
    if (r.damage != null && r.damage !== '') s.damage = n(r.damage);
    s.stone = Math.max(s.stone, n(r.damageReduction)); s.cracked = s.cracked || b(r.armourPiercing);
    for (const c of r.eventAttackDefenderCounterDetail || []) s.counters.push({ by: String(c.counterByStructId), type: n(c.counterByStructTypeId), dmg: n(c.counterDamage) });
    if (b(r.targetCountered)) s.back = n(r.targetCounteredDamage);
    s.targetFelled = s.targetFelled || b(r.targetDestroyed);
    s.blockerFelled = s.blockerFelled || b(r.blockerDestroyed);
    if (r.blockerHealthAfter != null) s.blockerHpAfter = n(r.blockerHealthAfter);
    s.targetHpAfter = n(r.targetHealthAfter); s.targetMax = n(r.targetHealthMax) || s.targetMax;
  }
  const typeId = n(d.attackerStructTypeId);
  return {
    key, attackerId: String(d.attackerStructId), attackerType: typeId, attackerOwner: String(d.attackerPlayerId || ''),
    guided: d.weaponControl === 'guided' || d.weaponControl === 1 || (!d.weaponControl && typeOf(typeId)?.primaryWeaponControl === 'guided'),
    shots, cannon: n(d.planetaryDefenseCannonDamage), attackerHpAfter: n(d.attackerHealthAfter), attackerMax: n(d.attackerHealthMax) || n(typeOf(typeId)?.maxHealth),
    attackerFelled: n(d.attackerHealthAfter) === 0 && d.attackerHealthAfter != null,
  };
}

/** The blow in a sentence or three: `who` names a beast with its warden ("your Harpy", "Grimwald’s Harpy"). */
export function tellBlow(bw: Blow, who: (structId: string, typeId: number, ownerId?: string) => string): { head: string; bits: { text: string; tone: 'hit' | 'miss' | 'guard' | 'back' | 'fell' }[] } {
  const bits: { text: string; tone: 'hit' | 'miss' | 'guard' | 'back' | 'fell' }[] = [];
  const s = bw.shots[0];
  const head = s ? `${cap(who(bw.attackerId, bw.attackerType, bw.attackerOwner))} strikes ${who(s.targetId, s.targetType, s.targetOwner)}` : `${cap(who(bw.attackerId, bw.attackerType, bw.attackerOwner))} strikes`;
  for (const sh of bw.shots) {
    for (const c of sh.counters) if (c.dmg) bits.push({ text: `${cap(who(c.by, c.type))} strikes back −${c.dmg}`, tone: 'back' });
    if (sh.evaded) bits.push({ text: sh.evadedBy ? `Turned aside by ${sh.evadedBy}` : 'Turned aside', tone: 'miss' });
    else if (sh.blockerId) {
      bits.push({ text: `${cap(who(sh.blockerId, sh.blockerType || 0))} takes the blow −${sh.damage}`, tone: 'guard' });
      if (sh.blockerFelled) bits.push({ text: `${cap(who(sh.blockerId, sh.blockerType || 0))} falls`, tone: 'fell' });
    } else if (sh.damage || sh.hits) {
      bits.push({ text: `−${sh.damage}${sh.stone && !sh.cracked ? ' (stone-skin)' : sh.cracked ? ' (cracks stone-skin)' : ''}${sh.targetFelled ? '' : ` · ${sh.targetHpAfter} of ${sh.targetMax} left`}`, tone: 'hit' });
    } else if (bw.attackerFelled && !sh.damage) bits.push({ text: 'Felled before it could land', tone: 'miss' });
    if (sh.targetFelled) bits.push({ text: `${cap(who(sh.targetId, sh.targetType, sh.targetOwner))} falls!`, tone: 'fell' });
    if (sh.back) bits.push({ text: `${cap(who(sh.targetId, sh.targetType, sh.targetOwner))} strikes back −${sh.back}`, tone: 'back' });
  }
  if (bw.cannon) bits.push({ text: `Thunder Spire lashes back −${bw.cannon}`, tone: 'back' });
  if (bw.attackerFelled) bits.push({ text: `${cap(who(bw.attackerId, bw.attackerType, bw.attackerOwner))} falls`, tone: 'fell' });
  return { head, bits };
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/* ── Where a raid stands ─────────────────────────────────────────────── */

/** Their Elder Wyrm, if it stands at home guarding their isle (the one thing that keeps a plunder out). */
export function wardKeeper(p: PlayerState | null): OwnedStruct | null {
  if (!p || p.fleet?.status === 'away' || !p.fleet?.commandStruct) return null;
  const w = p.structs.get(p.fleet.commandStruct);
  return w && alive(w) && w.online ? w : null;
}
/** A warden's Elder Wyrm, standing or not. */
export function wyrmOf(p: PlayerState | null): OwnedStruct | null {
  const id = p?.fleet?.commandStruct; const w = id ? p?.structs.get(id) : undefined;
  return w && w.type ? w : null;
}
export { realmName };
