/* Game verbs: every struct, fleet and planet action as one call that checks what it can,
 * names itself, prices its charge and queues the transaction. UIs (the Command Deck, the
 * planet map, the palette, replicants) all act through here. */
import { txq, type TxJob } from '../wallet/queue';
import { wallet } from '../wallet/wallet';
import { empire, type OwnedStruct, type PlayerState } from './empire';
import { typeOf, type StructType, type WeaponSystem } from '../data/catalogue';

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

/** Explore abandons the current planet and any ore left in it: confirm when there is some. */
export async function exploreConfirmed(p: PlayerState, source?: string): Promise<TxJob | null> {
  const ore = Number(p.planet?.gridAttributes?.ore || 0);
  if (p.planet && p.planet.Planet.status !== 'complete' && ore > 0) {
    const { confirmBox } = await import('../core/dom');
    if (!(await confirmBox('Seek a new isle?', `Your isle still holds ${ore} sheaves of wildroot. Seeking abandons it for a fresh shard.`, 'Seek', 'enemy'))) return null;
  }
  return act.explore(p, source);
}

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
