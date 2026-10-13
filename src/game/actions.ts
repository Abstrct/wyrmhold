/* Game verbs: every struct, fleet and planet action as one call that checks what it can,
 * names itself, prices its charge and queues the transaction. UIs (the Command Deck, the
 * planet map, the palette, replicants) all act through here. */
import { txq, type TxJob } from '../wallet/queue';
import { wallet } from '../wallet/wallet';
import { empire, type OwnedStruct, type PlayerState } from './empire';
import { typeOf, type StructType, type WeaponSystem } from '../data/catalogue';
import { beastName, sheaves } from '../lore';

const M = (name: string, value: Record<string, unknown>) => ({ typeUrl: `/structs.structs.${name}`, value });

export interface Verb { id: string; label: string; cost: number; hint: string; danger?: boolean; run: () => TxJob }

function q(p: PlayerState, name: string, value: Record<string, unknown>, label: string, cost?: number, source = 'you'): TxJob {
  return txq.enqueue(M(name, value), {
    account: p.account, playerId: p.playerId, label, source,
    lane: cost != null ? 'action' : 'immediate', chargeCost: cost,
  });
}

export const act = {
  build(p: PlayerState, t: StructType, ambit: string, slot: number, source?: string) {
    return q(p, 'MsgStructBuildInitiate', { playerId: p.playerId, structTypeId: t.id, operatingAmbit: ambit, slot }, `Summoning circle · ${t.type}`, t.buildCharge, source);
  },
  cancelBuild: (p: PlayerState, s: OwnedStruct) => q(p, 'MsgStructBuildCancel', { structId: s.id }, `Cancel ${name(s)}`),
  activate: (p: PlayerState, s: OwnedStruct, source?: string) => q(p, 'MsgStructActivate', { structId: s.id }, `Awaken ${name(s)}`, s.type?.activateCharge ?? 0, source),
  deactivate: (p: PlayerState, s: OwnedStruct) => q(p, 'MsgStructDeactivate', { structId: s.id }, `Slumber ${name(s)}`),
  stealthOn: (p: PlayerState, s: OwnedStruct) => q(p, 'MsgStructStealthActivate', { structId: s.id }, `Veil ${name(s)}`, s.type?.stealthActivateCharge ?? 0),
  stealthOff: (p: PlayerState, s: OwnedStruct) => q(p, 'MsgStructStealthDeactivate', { structId: s.id }, `Drop the veil of ${name(s)}`, s.type?.stealthActivateCharge ?? 0),
  defend: (p: PlayerState, s: OwnedStruct, protectedId: string, source?: string) => q(p, 'MsgStructDefenseSet', { defenderStructId: s.id, protectedStructId: protectedId }, `${name(s)} guards the ${nameOf(protectedId)}`, s.type?.defendChangeCharge ?? 0, source),
  clearDefense: (p: PlayerState, s: OwnedStruct) => q(p, 'MsgStructDefenseClear', { defenderStructId: s.id }, `${name(s)} stands down`, s.type?.defendChangeCharge ?? 0),
  move: (p: PlayerState, s: OwnedStruct, locationType: 'planet' | 'fleet', ambit: string, slot: number) =>
    q(p, 'MsgStructMove', { structId: s.id, locationType, ambit, slot }, `Move ${name(s)} to the ${ambit} realm`, s.type?.moveCharge ?? 0),
  attack(p: PlayerState, s: OwnedStruct, targets: string[], weapon: WeaponSystem, source?: string) {
    const t = s.type!;
    const cost = weapon === 'primaryWeapon' ? t.primaryWeaponCharge : t.secondaryWeaponCharge;
    return q(p, 'MsgStructAttack', { operatingStructId: s.id, targetStructId: targets, weaponSystem: weapon }, `Your ${name(s)} fires on ${targets.map(whoseOf).join(', ')}`, cost, source);
  },
  infuseGenerator: (p: PlayerState, s: OwnedStruct, ualpha: bigint) => q(p, 'MsgStructGeneratorInfuse', { structId: s.id, infuseAmount: `${ualpha}ualpha` }, `Feed ${Number(ualpha) / 1e6} alpha to ${name(s)}`),
  trash: (p: PlayerState, s: OwnedStruct) => q(p, 'MsgStructTrash', { structId: s.id }, `Banish ${name(s)}`, s.type?.buildCharge ?? 8),
  fleetMove: (p: PlayerState, destination: string, source?: string) => q(p, 'MsgFleetMove', { fleetId: p.fleetId, destinationLocationId: destination }, destination === p.planetId ? 'Warband rides home' : `Warband rides for ${isleOf(destination)}`, undefined, source),
  explore: (p: PlayerState, source?: string) => q(p, 'MsgPlanetExplore', { playerId: p.playerId }, p.planetId ? 'Seek a new isle' : 'Find your first isle', undefined, source),
  renamePlanet: (p: PlayerState, nm: string) => q(p, 'MsgPlanetUpdateName', { planetId: p.planetId, name: nm }, `Name the isle “${nm}”`),
  renamePlayer: (p: PlayerState, nm: string) => q(p, 'MsgPlayerUpdateName', { playerId: p.playerId, name: nm }, `Rename to “${nm}”`),
  setPortrait: (p: PlayerState, attrs: Record<string, number>, source?: string) => q(p, 'MsgPlayerUpdatePfpClientRenderAttributes', { playerId: p.playerId, pfpClientRenderAttributes: JSON.stringify(attrs) }, 'New portrait', undefined, source),
  send: (p: PlayerState, to: string, ualpha: bigint, source?: string) => q(p, 'MsgPlayerSend', { from_address: p.address, to_address: to, amount: [{ denom: 'ualpha', amount: ualpha.toString() }] }, `Send ${Number(ualpha) / 1e6} alpha`, undefined, source),
};

/** Why the chain would refuse a build for this player right now (BuildInitiateReadiness and
 * MsgStructBuildInitiate in v0.21), or null when it would take it. */
export function buildBlock(p: PlayerState, t?: StructType): string | null {
  if (!p.online) return 'Your beasts drink more mana than you pour: the sky refuses summonings until it fits';
  const f = p.fleet;
  if (!f || f.status === 'away') return 'Your warband is abroad: summonings need it home';
  const cmd = f.commandStruct ? p.structs.get(f.commandStruct) : undefined;
  if (!cmd || cmd.destroyed) return 'No Elder Wyrm: summonings need one';
  if (!cmd.online) return 'Your Elder Wyrm slumbers: summonings need it awake';
  if (t && p.load + p.structsLoad + BigInt(t.buildDraw) > p.capacity + p.connectionCapacity) return `Not enough spare mana for the ${t.type} (${formatDraw(t.buildDraw)})`;
  return null;
}

/** Why struct actions (attack, guard, move, stealth, activate) would be refused for the player, or null. */
export const actionBlock = (p: PlayerState): string | null => (p.online ? null : 'Your leylines are overdrawn: no beast may act until the drink fits the flow');

/** Slots a queued build or move is already headed for ("planet:land:0"): don't offer them twice. */
export function reservedSlots(playerId: string): Set<string> {
  const out = new Set<string>();
  for (const j of txq.active) {
    if (j.playerId !== playerId) continue;
    for (const m of j.msgs) {
      const v = m.value as Record<string, unknown>;
      if (m.typeUrl.endsWith('MsgStructBuildInitiate')) out.add(`${typeOf(Number(v.structTypeId))?.category}:${v.operatingAmbit}:${v.slot}`);
      // A Command Ship changes battleground without taking a slot.
      if (m.typeUrl.endsWith('MsgStructMove') && empire.players.get(playerId)?.structs.get(String(v.structId))?.typeId !== 1) out.add(`${v.locationType}:${v.ambit}:${v.slot}`);
    }
  }
  return out;
}

/** Seeking a new isle completes the old one. The ledger allows it only once its ground is dug out and
 * the warband is home (msg_server_planet_explore.go, AttemptComplete), and then destroys every hallow
 * on it; the warband, the wildroot in store and the alpha go with the warden. So it is always asked,
 * the hallows lost are named, and staying is the bright answer. A first isle loses nothing. */
export async function exploreConfirmed(p: PlayerState, source?: string): Promise<TxJob | null> {
  if (!p.planetId || !p.planet) return act.explore(p, source);
  const { confirmBox } = await import('../core/dom');
  const ground = Number(p.planet.gridAttributes?.ore || 0);
  if (ground > 0) {
    await confirmBox('Your isle is not dug out yet', [
      `Its ground still holds ${sheaves(ground)} of wildroot for a Root Delver to dig up. That is the marrow left in the isle, not the ${sheaves(p.ore)} in your stores.`,
      'A warden may seek a new isle only once the old one is dug out.'], null, 'player', { stay: 'Stay' });
    return null;
  }
  if (p.fleet?.status === 'away') {
    await confirmBox('Bring your warband home first', 'Your warband is abroad. A warden seeks a new isle with the warband at home.', null, 'player', { stay: 'Stay' });
    return null;
  }
  const lost = hallowsOn(p);
  const ok = await confirmBox('Seek a new isle?', [
    'Your isle is dug out. Seeking a new one leaves it behind for good.',
    lost.length ? `Lost with it: your ${andList(lost)}.` : 'No hallows stand on it, so none are lost.',
    `Coming with you: your warband${p.ore ? `, the ${sheaves(p.ore)} of wildroot in your stores` : ''} and your alpha.`,
  ], !lost.length ? 'Seek a new isle' : lost.length === 1 && !/^\d/.test(lost[0]) ? 'Leave it and seek' : 'Leave them and seek', 'enemy', { stay: 'Stay', safeFirst: true });
  return ok ? act.explore(p, source) : null;
}

/** The hallows standing (or being summoned) on a warden's isle, named and counted: ["Dawn Cauldron", "2 Ward Lanterns"]. */
function hallowsOn(p: PlayerState): string[] {
  const count = new Map<string, number>();
  for (const s of p.structs.values()) {
    if (s.destroyed || s.type?.category !== 'planet' || s.locationId !== p.planetId) continue;
    const nm = beastName(s.typeId).replace(/^The /, '');
    count.set(nm, (count.get(nm) || 0) + 1);
  }
  return [...count].map(([nm, n]) => (n > 1 ? `${n} ${nm}s` : nm));
}
const andList = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0] || '');

/** "Again" is for a refusal just heard. Minutes later the sky has moved on (another raider took the
 * plunder, a beast fell, a new Wyrm hatched), and an old rite sent blind can do harm. So it is offered
 * only for a little while, and only while the rite still makes sense. */
export const AGAIN_MS = 2 * 60_000;
export function canRetry(j: TxJob, now = Date.now()): boolean {
  if (j.status !== 'failed' || now - j.updatedAt > AGAIN_MS) return false;
  if (j.playerId && !wallet.byPlayer(j.playerId)) return false;
  const p = j.playerId ? empire.players.get(j.playerId) : undefined;
  for (const m of j.msgs) {
    const v = m.value as Record<string, unknown>;
    // every beast it names must still stand
    const named = [v.structId, v.operatingStructId, v.defenderStructId, v.protectedStructId, ...(Array.isArray(v.targetStructId) ? v.targetStructId : [])];
    if (named.some((id) => typeof id === 'string' && fallen(id))) return false;
    // a ride to where the warband already hangs does nothing
    if (m.typeUrl.endsWith('MsgFleetMove') && p?.fleet && p.fleet.locationId === v.destinationLocationId) return false;
    // seeking a new isle loses hallows: it is asked afresh, never sent again blind
    if (m.typeUrl.endsWith('MsgPlanetExplore') && p?.planetId) return false;
  }
  return true;
}
function fallen(id: string) { for (const pl of empire.players.values()) { const s = pl.structs.get(id); if (s) return s.destroyed; } return false; }

/** What the warden reads in labels: the beast's kind, never its ledger mark. */
export const name = (s: OwnedStruct) => s.type?.type || 'Beast';
/** A struct anywhere on the ledger we know of, by kind. */
function nameOf(id: string) { for (const pl of empire.players.values()) { const s = pl.structs.get(id); if (s?.type) return s.type.type; } return 'a beast'; }
/** A struct with its warden's name ("Wynyn’s Elder Wyrm"), so a strike between two of a kind says whose is whose. */
function whoseOf(id: string) {
  for (const pl of empire.players.values()) { const s = pl.structs.get(id); if (s?.type) return `${pl.name && pl.name !== pl.playerId ? pl.name : `Warden ${pl.playerId}`}’s ${s.type.type}`; }
  return 'a beast';
}
/** An isle by its warden's name. */
function isleOf(planetId: string) { for (const pl of empire.players.values()) if (pl.planetId === planetId) return `${pl.name && pl.name !== pl.playerId ? pl.name : `Warden ${pl.playerId}`}’s isle`; return 'a far isle'; }

/** What a struct can do right now (and what each costs), for menus and the palette. */
export function verbsFor(p: PlayerState, s: OwnedStruct): Verb[] {
  const t = s.type;
  if (!t || s.destroyed) return [];
  const v: Verb[] = [];
  if (!s.built) {
    v.push({ id: 'cancel', label: 'Cancel build', cost: 0, hint: 'Abandon the half-sung summoning', danger: true, run: () => act.cancelBuild(p, s) });
    return v;
  }
  if (s.online) v.push({ id: 'off', label: 'Slumber', cost: 0, hint: 'Frees the mana it drinks, but it does no work while it sleeps', run: () => act.deactivate(p, s) });
  else v.push({ id: 'on', label: 'Awaken', cost: t.activateCharge, hint: `Needs ${formatDraw(t.passiveDraw)} of mana flow`, run: () => act.activate(p, s) });
  if (t.stealthSystems) {
    if (s.hidden) v.push({ id: 'unstealth', label: 'Leave stealth', cost: t.stealthActivateCharge, hint: 'Visible again', run: () => act.stealthOff(p, s) });
    else v.push({ id: 'stealth', label: 'Stealth', cost: t.stealthActivateCharge, hint: 'Unseen by beasts of other realms', run: () => act.stealthOn(p, s) });
  }
  if (s.protectedStructIndex) v.push({ id: 'undefend', label: 'Stop guarding', cost: t.defendChangeCharge, hint: 'Clears its defense post', run: () => act.clearDefense(p, s) });
  return v;
}

export function formatDraw(mw: number) { return `${Math.round(mw / 1e3).toLocaleString('en-US')} mana`; }

/** Struct types buildable in a slot of this kind and ambit. */
export function buildable(where: 'planet' | 'fleet', ambit: string): StructType[] {
  const flag: Record<string, number> = { water: 2, land: 4, air: 8, space: 16 };
  const out: StructType[] = [];
  for (let id = 1; id < 64; id++) {
    const t = typeOf(id);
    if (!t || t.category !== where || id === 1) continue;
    if (t.possibleAmbit & (flag[ambit] || 0)) out.push(t);
  }
  return out;
}

/** The account a player belongs to, or null if this wallet can't sign for them. */
export const signerFor = (playerId: string) => wallet.byPlayer(playerId);
export const stateOf = (playerId: string) => empire.players.get(playerId) ?? null;
