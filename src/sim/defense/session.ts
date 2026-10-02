import { NO_MODIFIERS, type DefenseModifiers, type DefenseStats } from '../../core/defense-state';
import type { CreatureKind } from '../../core/world';
import { kindOf } from '../creatures';
import { Ecosystem } from '../ecosystem';
import type { ActionResult, Defense, DefenseAction } from './defense';

/** What a player (or a bot) can see of a round, as plain data. */
export interface DefenseObservation {
  clock: number;
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
}

/**
 * A Warren Defense round with no rendering: create one from a seed, advance it, look at it and act
 * on it. Used by the balance runner and the test bots; the game itself uses the same simulation.
 */
export class DefenseSession {
  constructor(readonly eco: Ecosystem) {
    if (!eco.defense) throw new Error('Not a Warren Defense ecosystem');
  }

  static create(opts: { seed: number; size?: number; modifiers?: Partial<DefenseModifiers> }): DefenseSession {
    return new DefenseSession(Ecosystem.create(opts.size ?? 512, opts.seed, { defense: { ...NO_MODIFIERS, ...opts.modifiers } }));
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
    const d = this.defense;
    const pop = this.eco.population;
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
      if (c.age < 480) young++;
    }
    return {
      clock: Math.round(d.clock * 10) / 10,
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
    };
  }
}
