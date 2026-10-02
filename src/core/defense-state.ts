import type { CreatureKind } from './world';
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
}

export const NO_MODIFIERS: DefenseModifiers = { budget: 0, rabbits: 0, blockHp: 1, damage: 1, armour: 1, fertility: 1 };

export interface DefenseStats {
  kills: number;
  /** Kills by weapon id. */
  killsWith: Record<string, number>;
  /** Kills by predator kind. */
  killsOf: Record<string, number>;
  rabbitsLost: number;
  blocksBroken: number;
  shots: number;
}

export type DefenseOutcome = 'playing' | 'lost';

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
}
