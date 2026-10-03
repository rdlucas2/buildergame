import { NO_MODIFIERS, type DefenseModifiers, type DefenseStats, type PerkCard } from '../../core/defense-state';
import type { CreatureKind } from '../../core/world';
import { kindOf } from '../creatures';
import type { Ecosystem } from '../ecosystem';
import { progressOf } from './criteria';
import type { ActionResult, Defense, DefenseAction } from './defense';
import { expansion } from './advisor';
import { TIERS, blockCost } from './materials';
import { DEFENSE_GROUND, startRound } from './replay';
import { WEAPON_UNLOCKS } from './unlocks';
import { WEAPON_LIST } from './weapons';

/** What a player (or a bot) can see of a round, as plain data. */
export interface DefenseObservation {
  clock: number;
  /** Round tick (tenths of a second survived), as replays count them. */
  tick: number;
  wave: number;
  nextWaveIn: number;
  points: number;
  score: number;
  budget: number;
  cost: number;
  budgetPrice: number;
  allocation: number;
  rabbits: number;
  defenders: number;
  breeders: number;
  /** Rabbits too young to defend. */
  young: number;
  predators: Partial<Record<CreatureKind, number>>;
  /** Predators still on their way in the current waves. */
  incoming: number;
  outcome: string;
  stats: DefenseStats;
  /** Blocks of the warren, and how many are damaged. */
  blocks: number;
  damaged: number;
  posts: number;
  /** Points to repair every damaged block. */
  repairPrice: number;
  /** Weapons unlocked, the main one, and how many defenders carry each of the others. */
  unlocked: string[];
  mainWeapon: string;
  loadout: Record<string, number>;
  /** Weapons still locked, with how far along their unlock is (0 to 1). */
  locked: Array<{ weapon: string; progress: number }>;
  /** Material tiers that can be built with, strength levels per tier and the price of the next. */
  tiers: number;
  strength: number[];
  strengthPrices: number[];
  /** The perk cards to choose from now (the oldest offer), and how many offers are waiting. */
  offer: PerkCard[];
  pendingOffers: number;
  perks: number;
  /** Perk offers that can still be redealt this round. */
  rerolls: number;
  /** 5-minute milestones reached. */
  milestones: number;
  /** The core's hit points left and in all (0 once it has fallen: the round is lost). */
  coreHp: number;
  coreMax: number;
  /** Block budget the next wave brings. */
  waveBudget: number;
  /** Rabbits the warren has room for (it grows with the ground the walls enclose). */
  room: number;
  /** Reinforcements bought for the whole warren, and the price of the next (Infinity at the most). */
  reinforced: number;
  reinforcePrice: number;
  /** Block budget a new ring of walls around the warren would take (null when there's no room for one). */
  expansionCost: number | null;
}

/**
 * A Warren Defense round with no rendering: create one from a seed, advance it, look at it and act
 * on it. Used by the balance runner and the test bots; the game itself uses the same simulation.
 */
export class DefenseSession {
  constructor(readonly eco: Ecosystem) {
    if (!eco.defense) throw new Error('Not a Warren Defense ecosystem');
  }

  /** A new round, set up as the game sets one up (so its actions can be replayed in the browser). */
  static create(opts: { seed: number; size?: number; modifiers?: Partial<DefenseModifiers> }): DefenseSession {
    return new DefenseSession(startRound(opts.seed, { ...NO_MODIFIERS, ...opts.modifiers }, opts.size ?? DEFENSE_GROUND));
  }

  get defense(): Defense {
    return this.eco.defense!;
  }

  get over(): boolean {
    return this.defense.over;
  }

  get clock(): number {
    return this.defense.clock;
  }

  /** Runs the round for `seconds` of simulation time, stopping early if it is lost. */
  advance(seconds: number): void {
    const end = this.clock + seconds;
    while (!this.over && this.clock < end - 1e-9) this.eco.tick();
  }

  apply(action: DefenseAction): ActionResult {
    return this.defense.apply(action);
  }

  observe(): DefenseObservation {
    return observeRound(this.eco);
  }
}

/** What a player (or a bot) can see of a Warren Defense round, as plain data. */
export function observeRound(eco: Ecosystem): DefenseObservation {
  const d = eco.defense;
  if (!d) throw new Error('Not a Warren Defense ecosystem');
  const pop = eco.population;
  const predators: Partial<Record<CreatureKind, number>> = {};
  let rabbits = 0;
  let defenders = 0;
  let young = 0;
  for (const c of pop.creatures) {
    if (c.deadFor >= 0) continue;
    if (c.species === 'predator') {
      const k = kindOf(c);
      predators[k] = (predators[k] ?? 0) + 1;
      continue;
    }
    rabbits++;
    if (c.role === 'defender') defenders++;
    if (c.age < pop.maturityOf(c)) young++;
  }
  return {
    clock: Math.round(d.clock * 10) / 10,
    tick: d.tickIndex,
    wave: d.wave,
    nextWaveIn: Math.round(d.nextWaveIn * 10) / 10,
    points: d.points,
    score: d.score,
    budget: d.budget,
    cost: d.base.cost(),
    budgetPrice: d.budgetPrice,
    allocation: d.allocation,
    rabbits,
    defenders,
    breeders: rabbits - defenders,
    young,
    predators,
    incoming: d.orders.reduce((s, o) => s + o.count, 0),
    outcome: d.outcome,
    stats: structuredClone(d.stats),
    blocks: d.base.blocks(),
    damaged: d.base.damaged().length,
    posts: d.base.posts().length,
    repairPrice: d.repairPrice,
    unlocked: [...d.unlocked],
    mainWeapon: d.mainWeapon,
    loadout: { ...d.loadout },
    locked: WEAPON_LIST.filter((w) => !d.unlocked.includes(w.id)).map((w) => ({ weapon: w.id, progress: Math.round(progressOf(WEAPON_UNLOCKS[w.id]!, d.progress) * 100) / 100 })),
    tiers: d.tiers,
    strength: [...d.strength],
    strengthPrices: TIERS.map((_, t) => d.strengthPrice(t)),
    offer: (d.offers[0] ?? []).map((c) => ({ ...c })),
    pendingOffers: d.offers.length,
    perks: d.perks.length,
    rerolls: d.rerolls,
    milestones: d.milestones,
    coreHp: Math.ceil(d.base.coreHp),
    coreMax: d.base.coreMaxHp,
    waveBudget: d.waveBudget,
    room: d.room,
    reinforced: d.base.reinforced,
    reinforcePrice: d.reinforcePrice,
    expansionCost: expansionCost(d),
  };
}

/** Block budget the next ring of walls would take, or null when there is no room for one. */
function expansionCost(d: Defense): number | null {
  const ring = expansion(d);
  return ring ? ring.reduce((s, b) => s + blockCost(b.material), 0) : null;
}
