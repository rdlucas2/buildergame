import type { Creature } from '../creatures';
import type { BreachCell, BreachCost, Cell } from '../navigation';
import type { DefenseBase } from './base';
import type { Combat } from './combat';
import type { WeaponDef } from './weapons';

/** What the defender and raider behaviours need from the running defense. */
export interface DefenseContext {
  readonly base: DefenseBase;
  readonly combat: Combat;
  /** The warren's centre, where raiders head when they have nothing better to do. */
  readonly site: { x: number; z: number };
  /** True while predators of the current waves are still about. */
  inWave(): boolean;
  /** The post a defender should stand at, or null when it has none. */
  postFor(c: Creature): Cell | null;
  /** A defender could not reach its post: give it another one next time. */
  postUnreachable(c: Creature): void;
  /** The weapon a defender carries, with perks and upgrades applied. */
  weaponFor(c: Creature): WeaponDef;
  /** Chance that a shot does double damage. */
  critChance(c: Creature, w: WeaponDef): number;
  /** The best predator for a defender to shoot at, or null. */
  findTarget(c: Creature, w: WeaponDef, range: number): Creature | null;
  /** How costly it is for a predator to break the block at (x, y, z), or null when it can't. */
  breachCost(c: Creature): BreachCost;
  /**
   * The next steps for a predator towards the nearest breeder (or, once there are none, the core),
   * breaking through the weakest wall if it has to (see `BreachField`). Empty when the predator is
   * too far out for the field.
   */
  fieldPath(c: Creature, max: number): BreachCell[];
  /** Damages a block on a predator's behalf. */
  chew(c: Creature, x: number, y: number, z: number, amount: number): void;
  /** Hit-point multiplier for rabbits' bites taken (armour from upgrades). */
  biteMult(target: Creature): number;
  /** True while any breeder is alive: predators go for breeders before the core. */
  breedersLeft(): boolean;
  /** The middle of the core and the height of its top, or null once it has fallen. */
  coreSpot(): { x: number; z: number; top: number } | null;
  /** A core block the predator is touching (beside it or standing on it), or null. */
  coreNear(c: Creature): Cell | null;
}
