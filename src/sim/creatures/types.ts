import type { CreatureState } from '../../core/world';
import type { Cell } from '../navigation';
import type { Population } from './population';

export type Activity =
  // Rabbits.
  | 'idle'
  | 'wander'
  | 'seekFood'
  | 'graze'
  | 'seekWater'
  | 'drink'
  | 'seekShelter'
  | 'rest'
  | 'flee'
  | 'hide'
  // Wild predators.
  | 'patrol'
  | 'ambush'
  | 'stalk'
  | 'pounce'
  | 'eat'
  // Warren Defense: defenders walk to a post and guard it; raiders close in, break through and bite.
  | 'post'
  | 'guard'
  | 'raid'
  | 'breach'
  | 'bite';

export type DeathCause = 'hunger' | 'thirst' | 'age' | 'eaten' | 'slain';

/** A step of a planned path. `breach` marks a cell whose blocks must be broken before entering. */
export interface PathCell extends Cell {
  breach?: boolean;
}

/** A live creature: saved state plus behaviour that is recomputed after loading. */
export interface Creature extends CreatureState {
  activity: Activity;
  /** Position at the previous tick, for smooth rendering between ticks. */
  px: number;
  py: number;
  pz: number;
  path: PathCell[];
  step: number;
  think: number;
  /** Seconds since death, or -1 while alive (the body fades before it is removed). */
  deadFor: number;
  cause: DeathCause | null;
  /** The creature being hunted (predators) or fled from (prey), or -1. */
  target: number;
  /** Seconds left of the current wait: an ambush, a hiding spell, a meal, a pounce. */
  wait: number;
  /** Sprinting reserve, 0–1: a pounce spends it, rest restores it. */
  stamina: number;
}

export interface Tally {
  born: number;
  hunger: number;
  thirst: number;
  age: number;
  eaten: number;
  /** Predators killed by defenders. */
  slain: number;
}

export interface TickEnv {
  time: number;
  night: boolean;
  /** Daylight from 0 (night) to 1 (full sun). */
  light: number;
}

/**
 * How one sort of creature thinks and acts. The population picks a behaviour per creature each
 * tick, so a game mode can add its own (defenders, raiders) without touching the others.
 */
export interface Behaviour {
  /** Whether hunger, thirst and old age apply. */
  readonly needs: boolean;
  /** Multiplier on hunger and thirst drain (1 when absent). */
  needsRate?(pop: Population, c: Creature): number;
  decide(pop: Population, c: Creature, env: TickEnv): void;
  /** Seconds until the next decision. */
  interval(pop: Population, c: Creature): number;
  /** Per-tick work. Return false to fall back to plain grazing, drinking and path following. */
  act?(pop: Population, c: Creature, dt: number): boolean;
}
