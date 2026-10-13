/* The bestiary's mechanics: every beast and hallow's numbers as the sky keeps them (vigor, mana
 * drawn, chant length, reach, ward-craft codes, breath costs). Names here are the realm's own. */
import raw from './structTypes.json';

export type Ambit = 'space' | 'air' | 'land' | 'water';
export const AMBITS: Ambit[] = ['space', 'air', 'land', 'water'];
/** The reach bitmask (water 2, land 4, air 8, space 16; local 32 = its own realm). */
export const AMBIT_FLAG: Record<Ambit | 'local', number> = { water: 2, land: 4, air: 8, space: 16, local: 32 };

export interface StructType {
  id: number; type: string; category: 'fleet' | 'planet';
  buildLimit: number; buildDifficulty: number; buildDraw: number; maxHealth: number; passiveDraw: number;
  possibleAmbit: number; movable: boolean;
  primaryWeapon: string; primaryWeaponControl: string; primaryWeaponCharge: number; primaryWeaponAmbits: number; primaryWeaponDamage: number; primaryWeaponArmourPiercing: boolean;
  secondaryWeapon: string; secondaryWeaponControl: string; secondaryWeaponCharge: number; secondaryWeaponAmbits: number; secondaryWeaponDamage: number; secondaryWeaponArmourPiercing: boolean;
  unitDefenses: string; planetaryMining: string; planetaryRefinery: string; powerGeneration: string;
  activateCharge: number; buildCharge: number; defendChangeCharge: number; moveCharge: number; stealthActivateCharge: number;
  attackReduction: number; attackCounterable: boolean; stealthSystems: boolean; counterAttack: number; counterAttackSameAmbit: number;
  generatingRate: number; planetaryShieldContribution: number; oreMiningDifficulty: number; oreRefiningDifficulty: number;
  unguidedDefensiveSuccessRateNumerator: number; unguidedDefensiveSuccessRateDenominator: number;
  guidedDefensiveSuccessRateNumerator: number; guidedDefensiveSuccessRateDenominator: number;
  /** War's finer print: who may guard, what a hallow does to raiders, what breaks a raid. */
  canDefend: boolean; planetaryDefenses: string; passiveWeaponry: string; triggerRaidDefeatByDestruction: boolean;
}

export const STRUCT_TYPES: StructType[] = (raw as { types: unknown[] }).types as StructType[];
const BY_ID: Record<number, StructType> = Object.fromEntries(STRUCT_TYPES.map((t) => [t.id, t]));
export const typeOf = (id: number | string) => BY_ID[Number(id)];
export type WeaponSystem = 'primaryWeapon' | 'secondaryWeapon';
