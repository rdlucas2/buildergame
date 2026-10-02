import { NO_MODIFIERS, type DefenseModifiers, type DefenseOutcome, type DefenseState, type DefenseStats, type SpawnOrder } from '../../core/defense-state';
import { getMaterial } from '../../core/materials';
import type { CreatureKind } from '../../core/world';
import { TICK_SECONDS } from '../clock';
import { Rng, hash3 } from '../rng';
import { KINDS, PREY, atHome, decidePrey, defOf, type Behaviour, type Creature, type DeathInfo, type HomeArea } from '../creatures';
import type { Ecosystem } from '../ecosystem';
import type { BreachCell, BreachCost, Cell, Navigator } from '../navigation';
import { lineOfSight } from '../senses';
import { DefenseBase } from './base';
import { Combat, EYE } from './combat';
import { BreachField, SolidSnapshot } from './field';
import type { DefenseContext } from './context';
import { makeDefender } from './defender';
import { blockCost } from './materials';
import { makeRaider } from './raider';
import { OPENING_SECONDS, SPAWN_DISTANCE, WAVE_INTERVAL, planWave } from './waves';
import { DEFAULT_WEAPON, WEAPONS, type WeaponDef } from './weapons';

export type DefenseAction =
  | { type: 'allocate'; defenders: number }
  | { type: 'callWave' }
  | { type: 'buyBudget' }
  | { type: 'place'; x: number; y: number; z: number; material: string }
  /** Several blocks at once (a library structure stamped into the warren): all of them or none. */
  | { type: 'placeMany'; blocks: Array<{ x: number; y: number; z: number; material: string }> }
  | { type: 'remove'; x: number; y: number; z: number };

export interface ActionResult {
  ok: boolean;
  reason?: string;
}

export type DefenseEvent =
  | { kind: 'wave'; n: number; counts: Partial<Record<CreatureKind, number>> }
  | { kind: 'lost'; clock: number };

/** Block budget a round starts with. */
export const START_BUDGET = 700;
/** Budget added by each purchase, and the price of the first purchase (it grows each time). */
export const BUDGET_STEP = 100;
const BUDGET_PRICE = 150;
const BUDGET_PRICE_GROWTH = 1.18;
/** Defenders a round starts with. */
export const START_DEFENDERS = 4;
/** Path searches per tick in a defense round (predators plan their way in through walls). */
const WAVE_SALT = 0x3a7e;
/** Breach fields cover the buildable area and this many columns around it. */
const FIELD_MARGIN = 12;
/** Seconds a breach field is used before it is rebuilt (rabbits move, and blocks wear down). */
const FIELD_REFRESH = 2;
/** After blocks are built or broken, fields are rebuilt once they are at least this old. */
const FIELD_MIN_AGE = 0.5;
const SEARCH_BUDGET = { normal: 10, urgent: 6 };

export function emptyStats(): DefenseStats {
  return { kills: 0, killsWith: {}, killsOf: {}, rabbitsLost: 0, blocksBroken: 0, shots: 0 };
}

/**
 * A Warren Defense round running inside an ecosystem: the warren, the wave schedule, defenders and
 * breeders, predators that break in, shots, points and the loss condition. Deterministic like the
 * rest of the simulation; player and bot decisions arrive through `apply` between ticks.
 */
export class Defense implements DefenseContext {
  readonly base: DefenseBase;
  readonly combat: Combat;
  readonly site: { x: number; z: number };
  clock: number;
  wave: number;
  nextWaveAt: number;
  orders: SpawnOrder[];
  points: number;
  score: number;
  budget: number;
  budgetBuys: number;
  allocation: number;
  stats: DefenseStats;
  outcome: DefenseOutcome;
  readonly modifiers: DefenseModifiers;
  /** Things worth telling the player, collected until the view drains them. */
  events: DefenseEvent[] = [];
  private readonly postOf = new Map<number, string>();
  private readonly unreachable = new Map<number, Set<string>>();
  private roleTimer = 0;
  private safetyDirty = false;
  private lastSafety = -Infinity;
  /** The solid snapshot the breach fields are built on, and the fields built on it, by kind. */
  private snapshot: { at: number; shape: number; nav: Navigator; snap: SolidSnapshot } | null = null;
  private readonly fields = new Map<CreatureKind, BreachField>();
  private readonly breeder: Behaviour;
  private readonly defender: Behaviour;
  private readonly raider: Behaviour;

  constructor(
    private readonly eco: Ecosystem,
    state: DefenseState,
  ) {
    this.site = { ...state.site };
    this.base = new DefenseBase(state.base);
    this.clock = state.clock;
    this.wave = state.wave;
    this.nextWaveAt = state.nextWaveAt;
    this.orders = state.orders.map((o) => ({ ...o }));
    this.points = state.points;
    this.score = state.score;
    this.budget = state.budget;
    this.budgetBuys = state.budgetBuys;
    this.allocation = state.allocation;
    this.stats = structuredClone(state.stats);
    this.outcome = state.outcome;
    this.modifiers = { ...NO_MODIFIERS, ...state.modifiers };
    this.base.hpMultiplier = this.modifiers.blockHp;
    this.combat = new Combat(eco.population, eco.solids);
    this.breeder = {
      needs: true,
      decide: (pop, c, env) => decidePrey(pop, c, env.night, { breedBoost: this.modifiers.fertility, home: this.home }),
      interval: PREY.interval,
    };
    this.defender = makeDefender(this);
    this.raider = makeRaider(this);
    this.install();
  }

  /** The state of a new round: the starter warren at `site`, built into `base`. */
  static initialState(site: { x: number; z: number }, base: DefenseBase, modifiers: DefenseModifiers = NO_MODIFIERS): DefenseState {
    return {
      site: { ...site },
      base: base.toState(),
      clock: 0,
      wave: 0,
      nextWaveAt: OPENING_SECONDS,
      orders: [],
      points: 0,
      score: 0,
      budget: START_BUDGET + modifiers.budget,
      budgetBuys: 0,
      allocation: START_DEFENDERS,
      stats: emptyStats(),
      outcome: 'playing',
      modifiers: { ...modifiers },
    };
  }

  private install(): void {
    const { population: pop, solids, vegetation: veg } = this.eco;
    pop.searchBudget = { ...SEARCH_BUDGET };
    pop.behaviourFor = (c) => (c.species === 'predator' ? this.raider : c.role === 'defender' ? this.defender : this.breeder);
    pop.onDeath = (c, info) => this.onDeath(c, info);
    solids.setBase(this.base);
    for (let z = this.base.origin.z; z < this.base.origin.z + this.base.size.z; z++)
      for (let x = this.base.origin.x; x < this.base.origin.x + this.base.size.x; x++) if (this.base.columnCovered(x, z)) veg.setExternalCover(x, z, true);
    this.base.onChange = (x, y, z) => {
      veg.setExternalCover(x, z, this.base.columnCovered(x, z));
      this.safetyDirty = true;
      if (this.base.solidAt(x, y, z)) pop.worldChanged();
    };
    this.eco.safety.invalidate();
  }

  /** Where the rabbits live: the columns the warren spans (or around the site, if it has no blocks). */
  get home(): HomeArea {
    return this.base.footprint() ?? { x0: this.site.x - 7, z0: this.site.z - 7, x1: this.site.x + 7, z1: this.site.z + 7 };
  }

  get over(): boolean {
    return this.outcome !== 'playing';
  }

  // ---- per tick ----------------------------------------------------------------------------

  /** Runs after the population's tick: waves, shots, roles, safety and the loss check. */
  tick(): void {
    if (this.outcome !== 'playing') {
      this.combat.tick();
      return;
    }
    const dt = TICK_SECONDS;
    this.clock += dt;
    if (this.clock >= this.nextWaveAt) this.startWave();
    while (this.orders.length > 0 && this.orders[0].at <= this.clock) this.spawn(this.orders.shift()!);
    this.combat.tick();
    this.stats.shots += this.combat.fired;
    this.combat.fired = 0;
    this.roleTimer -= dt;
    if (this.roleTimer <= 0) {
      this.roleTimer = 1;
      this.assignRoles();
    }
    if (this.safetyDirty && this.clock - this.lastSafety >= 1) {
      this.safetyDirty = false;
      this.lastSafety = this.clock;
      this.eco.safety.invalidate();
    }
    if (this.eco.population.count('prey') === 0) {
      this.outcome = 'lost';
      this.events.push({ kind: 'lost', clock: this.clock });
    }
  }

  private startWave(): void {
    this.wave++;
    // Each wave draws from its own stream, so a seed always brings the same waves whatever the
    // creatures did in between (rounds stay comparable across players and bots).
    const plan = planWave(this.wave, this.clock, new Rng(hash3(this.eco.seed, WAVE_SALT, this.wave)));
    this.orders.push(...plan.orders);
    this.orders.sort((a, b) => a.at - b.at);
    this.nextWaveAt = this.clock + WAVE_INTERVAL;
    const counts: Partial<Record<CreatureKind, number>> = {};
    for (const o of plan.orders) counts[o.kind] = (counts[o.kind] ?? 0) + o.count;
    this.events.push({ kind: 'wave', n: this.wave, counts });
  }

  /** Brings a group of predators in from the edge of the land, `SPAWN_DISTANCE` from the warren. */
  private spawn(o: SpawnOrder): void {
    const { population: pop, nav, terrain, rng } = this.eco;
    const def = KINDS[o.kind];
    const half = terrain.half - 4;
    let made = 0;
    for (let r = SPAWN_DISTANCE; r >= 20 && made < o.count; r -= 6) {
      const cx = Math.max(-half, Math.min(half, this.site.x + Math.sin(o.angle) * r));
      const cz = Math.max(-half, Math.min(half, this.site.z + Math.cos(o.angle) * r));
      for (let attempt = 0; attempt < o.count * 6 && made < o.count; attempt++) {
        const x = Math.round(cx + rng.range(-3, 3));
        const z = Math.round(cz + rng.range(-3, 3));
        if (!nav.inBounds(x, z) || nav.isWater(x, z) || !nav.standable(x, 0, z, def.body)) continue;
        pop.spawnKind(o.kind, x, 0, z, { maxHp: Math.round(def.maxHp * o.hpScale), age: def.maturity * 2, satiety: 1, hydration: 1 });
        made++;
      }
    }
  }

  /** Keeps the number of defenders at the allocation, preferring rabbits that already defend. */
  private assignRoles(): void {
    const rabbits = this.eco.population.creatures.filter((c) => c.species === 'prey' && c.deadFor < 0);
    const maturity = KINDS.rabbit.maturity;
    const eligible = (c: Creature) => c.age >= maturity && c.health > 0.35;
    const setRole = (c: Creature, role: 'breeder' | 'defender') => {
      if (c.role === role) return;
      c.role = role;
      c.activity = 'idle';
      c.path = [];
      c.think = 0;
      if (role === 'breeder') this.postOf.delete(c.id);
    };
    for (const c of rabbits) if (!c.role || (c.role === 'defender' && !eligible(c))) setRole(c, 'breeder');
    const defenders = rabbits.filter((c) => c.role === 'defender');
    const want = Math.min(this.allocation, rabbits.filter(eligible).length);
    for (let i = defenders.length - 1; i >= want; i--) setRole(defenders[i], 'breeder');
    let missing = want - Math.min(want, defenders.length);
    // New defenders come from the rabbits at home first.
    const home = this.home;
    const away = (c: Creature) => (atHome(home, Math.floor(c.x), Math.floor(c.z)) ? 0 : 1);
    for (const c of missing > 0 ? [...rabbits].sort((a, b) => away(a) - away(b)) : []) {
      if (missing <= 0) break;
      if (c.role === 'breeder' && eligible(c)) {
        setRole(c, 'defender');
        missing--;
      }
    }
  }

  private onDeath(c: Creature, info: DeathInfo): void {
    if (c.species === 'predator') {
      if (info.cause !== 'slain') return;
      const kind = defOf(c).kind;
      this.stats.kills++;
      if (info.weapon) this.stats.killsWith[info.weapon] = (this.stats.killsWith[info.weapon] ?? 0) + 1;
      this.stats.killsOf[kind] = (this.stats.killsOf[kind] ?? 0) + 1;
      const earned = Math.round(KINDS[kind].points * (1 + this.clock / 600));
      this.points += earned;
      this.score += earned;
      return;
    }
    this.postOf.delete(c.id);
    if (info.cause === 'eaten') this.stats.rabbitsLost++;
  }

  // ---- actions ------------------------------------------------------------------------------

  /** The price of the next budget increase. */
  get budgetPrice(): number {
    return Math.round(BUDGET_PRICE * BUDGET_PRICE_GROWTH ** this.budgetBuys);
  }

  /** Seconds until the next wave. */
  get nextWaveIn(): number {
    return Math.max(0, this.nextWaveAt - this.clock);
  }

  /** Applies a player's (or bot's) decision. Never throws; reports why when it can't. */
  apply(action: DefenseAction): ActionResult {
    if (this.outcome !== 'playing') return { ok: false, reason: 'The round is over.' };
    switch (action.type) {
      case 'allocate': {
        const rabbits = this.eco.population.count('prey');
        this.allocation = Math.max(0, Math.min(rabbits, Math.round(action.defenders)));
        this.assignRoles();
        return { ok: true };
      }
      case 'callWave': {
        const early = this.nextWaveIn;
        if (early < 1) return { ok: false, reason: 'The next wave is already coming.' };
        const bonus = Math.round(early * 2 * (1 + this.wave / 5));
        this.points += bonus;
        this.score += bonus;
        this.nextWaveAt = this.clock;
        return { ok: true };
      }
      case 'buyBudget': {
        const price = this.budgetPrice;
        if (this.points < price) return { ok: false, reason: `Needs ${price} points.` };
        this.points -= price;
        this.budget += BUDGET_STEP;
        this.budgetBuys++;
        return { ok: true };
      }
      case 'place':
        return this.place(action.x, action.y, action.z, action.material);
      case 'placeMany':
        return this.placeMany(action.blocks);
      case 'remove': {
        const { x, y, z } = action;
        if (!this.base.contains(x, y, z)) return { ok: false, reason: 'Outside the warren.' };
        if (!this.base.solidAt(x, y, z)) return { ok: false, reason: 'Nothing there.' };
        this.base.set(x, y, z, null);
        return { ok: true };
      }
    }
  }

  private placeMany(blocks: ReadonlyArray<{ x: number; y: number; z: number; material: string }>): ActionResult {
    if (blocks.length === 0) return { ok: false, reason: 'Nothing to place.' };
    let cost = 0;
    for (const b of blocks) {
      if (!getMaterial(b.material)) return { ok: false, reason: 'Unknown material.' };
      if (!this.base.contains(b.x, b.y, b.z)) return { ok: false, reason: 'It does not fit inside the warren area.' };
      if (this.base.solidAt(b.x, b.y, b.z)) return { ok: false, reason: 'It overlaps blocks already there.' };
      cost += blockCost(b.material);
    }
    if (this.base.cost() + cost > this.budget) return { ok: false, reason: `Needs ${cost} budget; ${this.budget - this.base.cost()} left.` };
    for (const b of blocks) this.base.set(b.x, b.y, b.z, b.material);
    return { ok: true };
  }

  private place(x: number, y: number, z: number, material: string): ActionResult {
    if (!getMaterial(material)) return { ok: false, reason: 'Unknown material.' };
    if (!this.base.contains(x, y, z)) return { ok: false, reason: 'Outside the warren area.' };
    if (this.base.solidAt(x, y, z)) return { ok: false, reason: 'There is already a block there.' };
    const cost = blockCost(material);
    if (this.base.cost() + cost > this.budget) return { ok: false, reason: 'Over the block budget.' };
    for (const c of this.eco.population.creatures) {
      if (c.deadFor >= 0 || Math.floor(c.x) !== x || Math.floor(c.z) !== z) continue;
      if (y >= c.y && y < c.y + defOf(c).body.height) return { ok: false, reason: 'An animal is standing there.' };
    }
    this.base.set(x, y, z, material);
    return { ok: true };
  }

  // ---- DefenseContext ------------------------------------------------------------------------

  inWave(): boolean {
    return this.orders.length > 0 || this.eco.population.count('predator') > 0;
  }

  postFor(c: Creature): Cell | null {
    const posts = this.base.posts();
    const key = this.postOf.get(c.id);
    if (key) {
      const p = posts.find((q) => `${q.x},${q.y},${q.z}` === key);
      if (p) return p;
      this.postOf.delete(c.id);
    }
    const taken = new Set(this.postOf.values());
    const blocked = this.unreachable.get(c.id);
    let best: Cell | null = null;
    let bestD = Infinity;
    for (const p of posts) {
      const k = `${p.x},${p.y},${p.z}`;
      if (taken.has(k) || blocked?.has(k)) continue;
      const d = (p.x - c.x) ** 2 + (p.z - c.z) ** 2 + (p.y - c.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (best) this.postOf.set(c.id, `${best.x},${best.y},${best.z}`);
    return best;
  }

  postUnreachable(c: Creature): void {
    const key = this.postOf.get(c.id);
    if (!key) return;
    this.postOf.delete(c.id);
    let set = this.unreachable.get(c.id);
    if (!set) this.unreachable.set(c.id, (set = new Set()));
    set.add(key);
  }

  weaponFor(): WeaponDef {
    return WEAPONS[DEFAULT_WEAPON];
  }

  damageMult(): number {
    return this.modifiers.damage;
  }

  cooldownMult(): number {
    return 1;
  }

  rangeBonus(): number {
    return 0;
  }

  findTarget(c: Creature, _w: WeaponDef, range: number): Creature | null {
    const solids = this.eco.solids;
    const ex = c.x;
    const ey = c.y + EYE;
    const ez = c.z;
    let best: Creature | null = null;
    let bestScore = Infinity;
    for (const p of this.eco.population.creatures) {
      if (p.species !== 'predator' || p.deadFor >= 0) continue;
      const def = defOf(p);
      const reach = range * (1 - 0.5 * (def.abilities.stealth ?? 0));
      const d = Math.hypot(p.x - ex, p.y + def.box[1] * 0.5 - ey, p.z - ez);
      if (d > reach) continue;
      // Predators already at the walls or the rabbits come first.
      const score = d - (p.activity === 'breach' || p.activity === 'bite' ? 6 : 0);
      if (score >= bestScore) continue;
      if (!lineOfSight(solids, ex, ey, ez, p.x, p.y + def.box[1] * 0.5, p.z)) continue;
      best = p;
      bestScore = score;
    }
    return best;
  }

  breachCost(c: Creature): BreachCost {
    const def = defOf(c);
    const rate = Math.max(0.5, def.blockDamage);
    return (x, y, z) => (this.base.solidAt(x, y, z) ? (this.base.hpAt(x, y, z) / rate) * def.speed : null);
  }

  fieldPath(c: Creature, max: number): BreachCell[] {
    const field = this.fieldFor(c);
    return field ? field.descend(this.eco.nav, { x: Math.floor(c.x), y: c.y, z: Math.floor(c.z) }, max) : [];
  }

  /**
   * The breach field for this predator's kind. Fields are rebuilt every `FIELD_REFRESH` seconds, as
   * the rabbits move and blocks wear, and sooner when blocks are built or broken.
   */
  fieldFor(c: Creature): BreachField | null {
    const snap = this.snapshot;
    const age = snap ? this.clock - snap.at : Infinity;
    if (!snap || age >= FIELD_REFRESH || (snap.shape !== this.base.shape && age >= FIELD_MIN_AGE)) {
      const { origin, size } = this.base;
      const s = new SolidSnapshot(this.eco.solids, origin.x - FIELD_MARGIN, origin.z - FIELD_MARGIN, size.x + FIELD_MARGIN * 2, size.z + FIELD_MARGIN * 2, Math.min(31, size.y + 3));
      this.snapshot = { at: this.clock, shape: this.base.shape, nav: s.navigator(this.eco.terrain), snap: s };
      this.fields.clear();
    }
    const kind = defOf(c).kind;
    let field = this.fields.get(kind);
    if (!field) {
      const { snap: s, nav } = this.snapshot!;
      const goals = this.eco.population.creatures.filter((r) => r.species === 'prey' && r.deadFor < 0).map((r) => ({ x: Math.floor(r.x), y: r.y, z: Math.floor(r.z) }));
      field = new BreachField(s, nav, defOf(c).body, this.breachCost(c), goals);
      this.fields.set(kind, field);
    }
    return field;
  }

  chew(_c: Creature, x: number, y: number, z: number, amount: number): void {
    if (this.base.damage(x, y, z, amount) === 'broken') this.stats.blocksBroken++;
  }

  biteMult(): number {
    return this.modifiers.armour;
  }

  // ---- saving --------------------------------------------------------------------------------

  toState(): DefenseState {
    return {
      site: { ...this.site },
      base: this.base.toState(),
      clock: Math.round(this.clock * 10) / 10,
      wave: this.wave,
      nextWaveAt: Math.round(this.nextWaveAt * 10) / 10,
      orders: this.orders.map((o) => ({ ...o })),
      points: this.points,
      score: this.score,
      budget: this.budget,
      budgetBuys: this.budgetBuys,
      allocation: this.allocation,
      stats: structuredClone(this.stats),
      outcome: this.outcome,
      modifiers: { ...this.modifiers },
    };
  }
}
