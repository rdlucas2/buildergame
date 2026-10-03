import type { CreatureKind, CreatureSpecies, CreatureState } from '../../core/world';
import { DAY_SECONDS } from '../clock';
import { PREDATOR_BODY, PREY_BODY, type Body } from '../navigation';
import { hash3 } from '../rng';
import { PREDATOR_SENSES, PREY_SENSES, type Senses } from '../senses';

/** Special traits that change how a kind moves or fights. */
export interface Abilities {
  /** Flies over walls; only a roof keeps it from what is underneath. */
  flier?: boolean;
  /** Harder to spot: defenders and rabbits notice it this much closer (0–1 of their range). */
  stealth?: number;
  /** Sprints at this multiple of its speed over the last few cells to its prey. */
  pounce?: number;
  /** Breaking a block also cracks the blocks beside it, by this share of the damage. */
  smash?: number;
}

export interface KindDef {
  kind: CreatureKind;
  name: string;
  species: CreatureSpecies;
  /** How it fits the world for path-finding (may differ from how big the model looks). */
  body: Body;
  senses: Senses;
  /** Walking speed in cells per second. */
  speed: number;
  lifespan: number;
  maturity: number;
  satietyDrain: number;
  hydrationDrain: number;
  energyDrainMoving: number;
  energyRegenResting: number;
  /** Seconds a creature lasts once it is out of food or water. */
  starve: number;
  breedCooldown: number;
  cap: number;
  litter: [number, number];
  /** Hit points at full health (before wave scaling). */
  maxHp: number;
  /** Damage of one bite. */
  bite: number;
  /** Seconds between bites. */
  biteCooldown: number;
  /** Damage per second to a block it is breaking through. */
  blockDamage: number;
  /** Cost against a wave's budget: tougher kinds cost more. */
  threat: number;
  /** Points for killing one. */
  points: number;
  /** Half-width and height of the box used for picking and for hits. */
  box: [number, number];
  abilities: Abilities;
}

const RABBIT: KindDef = {
  kind: 'rabbit',
  name: 'Rabbit',
  species: 'prey',
  body: PREY_BODY,
  senses: PREY_SENSES,
  speed: 2.4,
  lifespan: DAY_SECONDS * 7,
  maturity: DAY_SECONDS,
  satietyDrain: 1 / 420,
  hydrationDrain: 1 / 300,
  energyDrainMoving: 1 / 360,
  energyRegenResting: 1 / 90,
  starve: 45,
  breedCooldown: DAY_SECONDS * 1.25,
  cap: 300,
  litter: [1, 2],
  maxHp: 20,
  bite: 0,
  biteCooldown: 1,
  blockDamage: 0,
  threat: 0,
  points: 0,
  box: [0.35, 0.8],
  abilities: {},
};

/** Shared by all predators unless a kind says otherwise (wild-world needs and breeding). */
const PREDATOR_BASE = {
  species: 'predator' as const,
  senses: PREDATOR_SENSES,
  lifespan: DAY_SECONDS * 10,
  maturity: DAY_SECONDS * 1.5,
  satietyDrain: 1 / 720,
  hydrationDrain: 1 / 400,
  energyDrainMoving: 1 / 400,
  energyRegenResting: 1 / 90,
  starve: 180,
  breedCooldown: DAY_SECONDS * 2.5,
  cap: 30,
  litter: [1, 2] as [number, number],
  biteCooldown: 1,
  abilities: {},
};

/**
 * Every kind of animal. Only foxes are slight enough (1 tall) to follow rabbits through a 1-high
 * gap; a badger looks low but is too broad, so it digs through walls instead.
 */
export const KINDS: Record<CreatureKind, KindDef> = {
  rabbit: RABBIT,
  wolf: { ...PREDATOR_BASE, kind: 'wolf', name: 'Wolf', body: PREDATOR_BODY, speed: 2.8, maxHp: 30, bite: 6, blockDamage: 6, threat: 3, points: 30, box: [0.5, 1.3] },
  fox: { ...PREDATOR_BASE, kind: 'fox', name: 'Fox', body: { height: 1, climb: 1, drop: 3 }, speed: 3.3, maxHp: 10, bite: 4, blockDamage: 3, threat: 1, points: 10, box: [0.4, 0.8] },
  badger: { ...PREDATOR_BASE, kind: 'badger', name: 'Badger', body: { height: 2, climb: 1, drop: 2 }, speed: 2.0, maxHp: 50, bite: 6, blockDamage: 24, threat: 4, points: 40, box: [0.5, 0.8] },
  // A slow tank: lots of hit points, and it smashes through walls, cracking the blocks beside.
  bear: { ...PREDATOR_BASE, kind: 'bear', name: 'Bear', body: PREDATOR_BODY, speed: 2.0, maxHp: 220, bite: 18, blockDamage: 40, threat: 20, points: 150, box: [0.6, 1.6], abilities: { smash: 0.35 } },
  // Leaps 3 blocks (walls must be 4 high to stop it), is hard to spot, and pounces.
  tiger: { ...PREDATOR_BASE, kind: 'tiger', name: 'Tiger', body: { height: 2, climb: 3, drop: 4 }, speed: 3.4, maxHp: 90, bite: 14, blockDamage: 6, threat: 11, points: 90, box: [0.5, 1.3], abilities: { stealth: 0.5, pounce: 1.8 } },
  // Flies over walls and dives at rabbits in the open; a roof keeps it off.
  hawk: { ...PREDATOR_BASE, kind: 'hawk', name: 'Hawk', body: PREY_BODY, speed: 5, maxHp: 25, bite: 6, blockDamage: 0, threat: 6, points: 50, box: [0.5, 0.6], abilities: { flier: true } },
};

/** The kind of a creature (older saves have none: rabbits for prey, wolves for predators). */
export function kindOf(c: Pick<CreatureState, 'kind' | 'species'>): CreatureKind {
  return c.kind ?? (c.species === 'prey' ? 'rabbit' : 'wolf');
}

export function defOf(c: Pick<CreatureState, 'kind' | 'species'>): KindDef {
  return KINDS[kindOf(c)];
}

/** Hit points at full health. */
export function maxHpOf(c: Pick<CreatureState, 'kind' | 'species' | 'maxHp'>): number {
  return c.maxHp ?? defOf(c).maxHp;
}

/** Species-wide settings used by wild worlds: rabbits for prey, wolves for predators. */
export const SPECIES: Record<CreatureSpecies, KindDef> = { prey: KINDS.rabbit, predator: KINDS.wolf };

export function lifespanOf(c: CreatureState): number {
  return defOf(c).lifespan * (0.8 + 0.4 * (hash3(c.id, 7, 19) / 4294967296));
}
