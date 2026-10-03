import type { CreatureKind, PredatorRank } from './world';
import type { Size3 } from './voxel-grid';

/**
 * Saved state of a Warren Defense round (part of a wild world's ecosystem). The simulation in
 * `src/sim/defense` runs it; these are just the data shapes, shared with the file format.
 */

export interface BaseState {
  /** World cell of the buildable area's corner (its y is always 0, ground level). */
  origin: { x: number; z: number };
  size: Size3;
  /** Material ids; voxel value v refers to palette[v - 1]. */
  palette: string[];
  voxels: Uint16Array;
  /** Damage taken per voxel, in tenths of a hit point (0 for intact blocks and air). */
  damage: Uint16Array;
}

export interface SpawnOrder {
  /** Round time when this group appears. */
  at: number;
  kind: CreatureKind;
  count: number;
  /** Direction from the warren the group comes from, in radians. */
  angle: number;
  /** Hit-point multiplier for the group. */
  hpScale: number;
  /** Elites and bosses (their hit points are already in `hpScale`). */
  rank?: PredatorRank;
}

/** Bonuses carried into a round from permanent upgrades (all 0 or 1 for a fresh profile). */
export interface DefenseModifiers {
  /** Extra block budget at the start. */
  budget: number;
  /** Extra rabbits at the start. */
  rabbits: number;
  /** Multiplier on block hit points. */
  blockHp: number;
  /** Multiplier on defenders' damage. */
  damage: number;
  /** Multiplier on damage rabbits take from bites (lower is better). */
  armour: number;
  /** Multiplier on breeders' chance to breed. */
  fertility: number;
  /** Weapons unlocked from the start, beyond the slingshot (1 adds the bow, 2 the crossbow too...). */
  startWeapon: number;
  /** Perk offers that can be redealt in a round. */
  rerolls: number;
  /** Cards in each perk offer. */
  cards: number;
}

export const NO_MODIFIERS: DefenseModifiers = { budget: 0, rabbits: 0, blockHp: 1, damage: 1, armour: 1, fertility: 1, startWeapon: 0, rerolls: 0, cards: 3 };

export interface DefenseStats {
  kills: number;
  /** Kills by weapon id. */
  killsWith: Record<string, number>;
  /** Kills by predator kind. */
  killsOf: Record<string, number>;
  rabbitsLost: number;
  blocksBroken: number;
  shots: number;
  /** Round time when the first rabbit was lost (-1 while none has been). */
  firstLoss: number;
}

export type DefenseOutcome = 'playing' | 'lost';

export type PerkKind = 'damage' | 'rate' | 'range' | 'crit' | 'pierce' | 'splash' | 'multishot' | 'regen' | 'armour' | 'fertility' | 'budget' | 'bounty';
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

/** A bonus offered (or taken) during a round. */
export interface PerkCard {
  kind: PerkKind;
  /** For weapon perks, the weapon class it boosts, or 'all'; empty otherwise. */
  target: string;
  amount: number;
  rarity: Rarity;
}

export interface DefenseState {
  /** The warren's centre. */
  site: { x: number; z: number };
  base: BaseState;
  /** Seconds survived this round. */
  clock: number;
  /** Waves started so far. */
  wave: number;
  /** Round time of the next scheduled wave. */
  nextWaveAt: number;
  /** Predator groups still to arrive. */
  orders: SpawnOrder[];
  /** Points available to spend, and the total ever earned. */
  points: number;
  score: number;
  /** Block budget limit, and how many budget increases were bought. */
  budget: number;
  budgetBuys: number;
  /** How many rabbits should be defenders. */
  allocation: number;
  stats: DefenseStats;
  outcome: DefenseOutcome;
  modifiers: DefenseModifiers;
  /** Weapons unlocked this round, the one defenders carry by default, and how many carry others. */
  unlocked: string[];
  mainWeapon: string;
  loadout: Record<string, number>;
  /** Material tiers that can be built with (0 to `tiers - 1`), and strength levels bought per tier. */
  tiers: number;
  strength: number[];
  /** Perks taken, choices waiting to be made (three cards each), and how many offers were made. */
  perks: PerkCard[];
  offers: PerkCard[][];
  offersMade: number;
  /** Time milestones (every 5 minutes) reached so far. */
  milestones: number;
  /** Perk offers that can still be redealt this round. */
  rerolls: number;
  /** Set once the round's rewards went to the player's profile (so a reload doesn't pay twice). */
  rewarded: boolean;
  /** Boss waves sent so far (one at 10:00, one at 20:00). */
  bosses: number;
}
