import type { CreatureKind, CreatureSpecies, CreatureState } from '../../core/world';
import { TICK_SECONDS, daylight, isNight } from '../clock';
import type { Cell, Navigator } from '../navigation';
import type { Rng } from '../rng';
import type { SafetyMap } from '../safety';
import type { ShoreIndex } from '../shores';
import { cellIndex, inGround } from '../terrain';
import type { Vegetation } from '../vegetation';
import { PREY } from './prey';
import { WOLF } from './predator';
import { KINDS, SPECIES, defOf, lifespanOf, maxHpOf } from './species';
import type { Behaviour, Creature, DeathCause, PathCell, Tally, TickEnv } from './types';

const GRAZE_RATE = 45; // biomass per second
const SATIETY_PER_BIOMASS = 0.45 / 255;
const DRINK_RATE = 0.35; // hydration per second
const FADE_SECONDS = 3;
/** Path searches per tick, and extra ones reserved for creatures running for their lives. */
export interface SearchBudget {
  normal: number;
  urgent: number;
}
const DEFAULT_BUDGET: SearchBudget = { normal: 6, urgent: 4 };
export const PATH_NODES = 1500;
const HISTORY_EVERY = 10;
const HISTORY_MAX = 1000;
/** Chance per decision (about every 0.5 s) that a ready adult with a mate nearby breeds. */
const BREED_CHANCE = 0.02;
const MATE_RADIUS = 6;
const STAMINA_REGEN = 1 / 20;
/** Wolves only breed while there are at least this many rabbits per wolf (counting the newborn). */
const PREY_PER_WOLF = 8;
/** Pace multipliers for following a path in a given activity. */
const PACE: Partial<Record<Creature['activity'], number>> = { flee: 1.5, patrol: 0.8 };

/** Who or what killed a creature, for game modes that keep score. */
export interface DeathInfo {
  cause: DeathCause;
  /** The creature responsible (a predator for rabbits; for predators, the defender that fired). */
  killer?: Creature;
  /** What it was killed with (a weapon id), when known. */
  weapon?: string;
}

/**
 * All creatures of a wild world and the rules they live by. Deterministic: creatures update in id
 * order and every random choice comes from the ecosystem's seeded stream.
 *
 * What each creature decides is up to its {@link Behaviour}; the helpers below (routing, needs,
 * breeding) are shared by all behaviours.
 */
export class Population {
  creatures: Creature[] = [];
  nextId = 1;
  tally: Tally = { born: 0, hunger: 0, thirst: 0, age: 0, eaten: 0, slain: 0 };
  history: Array<[number, number, number]> = [];
  /** Picks the behaviour for a creature; game modes replace it to add their own. */
  behaviourFor: (c: Creature) => Behaviour = (c) => (c.species === 'prey' ? PREY : WOLF);
  /** Population limits that replace the species' own (a game mode's carrying capacity). */
  caps: Partial<Record<CreatureSpecies, number>> = {};
  /** Called when a creature dies (after its tally is counted). */
  onDeath?: (c: Creature, info: DeathInfo) => void;
  /** Path searches allowed per tick (a game mode with many attackers raises it). */
  searchBudget: SearchBudget = { ...DEFAULT_BUDGET };
  private readonly byId = new Map<number, Creature>();
  private pathBudget = 0;
  private urgentBudget = 0;
  private revalidate = false;
  private lastSample = -Infinity;

  constructor(
    readonly nav: Navigator,
    readonly veg: Vegetation,
    readonly shores: ShoreIndex,
    readonly rng: Rng,
    readonly safety: SafetyMap,
  ) {}

  // ---- lifecycle -------------------------------------------------------------------------

  spawn(species: CreatureSpecies, x: number, y: number, z: number, init: Partial<CreatureState> = {}): Creature {
    const def = init.kind ? KINDS[init.kind] : SPECIES[species];
    const c = this.make({
      id: this.nextId++,
      species,
      x: x + 0.5,
      y,
      z: z + 0.5,
      heading: this.rng.range(0, Math.PI * 2),
      satiety: 0.8,
      hydration: 0.8,
      energy: 1,
      health: 1,
      age: def.maturity * 1.2,
      cooldown: 0,
      ...init,
    });
    c.think = this.rng.range(0, 0.5);
    this.creatures.push(c);
    this.byId.set(c.id, c);
    return c;
  }

  /** Spawns one creature of a kind (its species follows from the kind). */
  spawnKind(kind: CreatureKind, x: number, y: number, z: number, init: Partial<CreatureState> = {}): Creature {
    const def = KINDS[kind];
    return this.spawn(def.species, x, y, z, kind === 'rabbit' || kind === 'wolf' ? init : { kind, ...init });
  }

  private make(s: CreatureState): Creature {
    return { ...s, activity: 'idle', px: s.x, py: s.y, pz: s.z, path: [], step: 0, think: 0, deadFor: -1, cause: null, target: -1, wait: 0, stamina: 1, reload: 0 };
  }

  /** Spawns up to `count` adults on free ground within `radius` of (cx, cz). Returns how many. */
  spawnGroup(species: CreatureSpecies, cx: number, cz: number, count: number, radius = 5, kind?: CreatureKind): number {
    const def = kind ? KINDS[kind] : SPECIES[species];
    let made = 0;
    for (let attempt = 0; attempt < count * 12 && made < count; attempt++) {
      const x = Math.round(cx + this.rng.range(-radius, radius));
      const z = Math.round(cz + this.rng.range(-radius, radius));
      if (!this.nav.inBounds(x, z) || this.nav.isWater(x, z)) continue;
      const y = this.nav.surfaceBelow(x, 8, z, def.body);
      if (y === null) continue;
      const init: Partial<CreatureState> = {
        age: def.maturity * this.rng.range(1.1, 3),
        satiety: this.rng.range(0.7, 0.95),
        hydration: this.rng.range(0.7, 0.95),
        cooldown: this.rng.range(0, def.breedCooldown * 0.6),
      };
      if (kind) this.spawnKind(kind, x, y, z, init);
      else this.spawn(species, x, y, z, init);
      made++;
    }
    return made;
  }

  count(species?: CreatureSpecies): number {
    let n = 0;
    for (const c of this.creatures) if (c.deadFor < 0 && (!species || c.species === species)) n++;
    return n;
  }

  get(id: number): Creature | undefined {
    return this.byId.get(id);
  }

  /** Structures changed: drop planned paths and move anyone now stuck inside a block. */
  worldChanged(): void {
    this.revalidate = true;
  }

  // ---- saving -----------------------------------------------------------------------------

  toState(): CreatureState[] {
    const r = (v: number) => Math.round(v * 1000) / 1000;
    return this.creatures
      .filter((c) => c.deadFor < 0)
      .map((c) => {
        const s: CreatureState = {
          id: c.id,
          species: c.species,
          x: r(c.x),
          y: c.y,
          z: r(c.z),
          heading: r(c.heading),
          satiety: r(c.satiety),
          hydration: r(c.hydration),
          energy: r(c.energy),
          health: r(c.health),
          age: r(c.age),
          cooldown: r(c.cooldown),
        };
        if (c.kind) s.kind = c.kind;
        if (c.role) s.role = c.role;
        if (c.maxHp !== undefined) s.maxHp = r(c.maxHp);
        return s;
      });
  }

  /** Replaces the population with saved creatures. Draws nothing from the random stream. */
  load(states: readonly CreatureState[], nextId: number | undefined): void {
    this.creatures = states.map((s) => this.make({ ...s }));
    this.creatures.sort((a, b) => a.id - b.id);
    this.byId.clear();
    for (const c of this.creatures) this.byId.set(c.id, c);
    this.nextId = Math.max(nextId ?? 1, ...this.creatures.map((c) => c.id + 1), 1);
    this.revalidate = true;
  }

  // ---- simulation -------------------------------------------------------------------------

  /** Refills this tick's path searches (`tick` does this; tests driving decisions directly call it). */
  refillSearches(): void {
    this.pathBudget = this.searchBudget.normal;
    this.urgentBudget = this.searchBudget.urgent;
  }

  tick(time: number): void {
    const dt = TICK_SECONDS;
    this.refillSearches();
    if (this.revalidate) {
      this.revalidate = false;
      for (const c of this.creatures) if (c.deadFor < 0) this.unstick(c);
    }
    const env: TickEnv = { time, night: isNight(time), light: daylight(time) };
    let removed = false;
    for (const c of this.creatures) {
      c.px = c.x;
      c.py = c.y;
      c.pz = c.z;
      if (c.deadFor >= 0) {
        c.deadFor += dt;
        if (c.deadFor > FADE_SECONDS) removed = true;
        continue;
      }
      this.live(c, dt, env);
    }
    if (removed) {
      this.creatures = this.creatures.filter((c) => {
        if (c.deadFor <= FADE_SECONDS) return true;
        this.byId.delete(c.id);
        return false;
      });
    }
    if (time - this.lastSample >= HISTORY_EVERY) {
      this.lastSample = time;
      this.history.push([Math.round(time * 10) / 10, this.count('prey'), this.count('predator')]);
      if (this.history.length > HISTORY_MAX) this.history.splice(0, this.history.length - HISTORY_MAX);
    }
  }

  private live(c: Creature, dt: number, env: TickEnv): void {
    const def = defOf(c);
    const b = this.behaviourFor(c);
    c.age += dt;
    c.cooldown = Math.max(0, c.cooldown - dt);
    c.wait = Math.max(0, c.wait - dt);
    if (c.activity !== 'pounce') c.stamina = Math.min(1, c.stamina + STAMINA_REGEN * dt);
    if (b.needs) {
      const moving = c.path.length > c.step;
      const resting = c.activity === 'rest' || c.activity === 'hide' || c.activity === 'ambush' || c.activity === 'guard';
      const slow = (c.activity === 'rest' ? 0.6 : 1) * (b.needsRate ? b.needsRate(this, c) : 1);
      c.satiety = Math.max(0, c.satiety - def.satietyDrain * dt * slow);
      c.hydration = Math.max(0, c.hydration - def.hydrationDrain * dt * slow);
      const sprinting = c.activity === 'pounce' || c.activity === 'flee';
      if (moving) c.energy = Math.max(0, c.energy - def.energyDrainMoving * dt * (sprinting ? 2 : 1));
      else if (resting) c.energy = Math.min(1, c.energy + def.energyRegenResting * dt);
      if (c.satiety <= 0 || c.hydration <= 0) c.health -= dt / def.starve;
      else if (c.satiety > 0.3 && c.hydration > 0.3) c.health = Math.min(1, c.health + dt / 240);
      if (c.health <= 0) return this.die(c, { cause: c.hydration <= 0 ? 'thirst' : 'hunger' });
      if (c.age > lifespanOf(c)) return this.die(c, { cause: 'age' });
    }

    c.think -= dt;
    if (c.think <= 0 || this.finished(c)) {
      b.decide(this, c, env);
      c.think = b.interval(this, c);
    }
    if (c.deadFor >= 0) return;
    if (!b.act || !b.act(this, c, dt)) this.defaultAct(c, dt);
  }

  die(c: Creature, info: DeathInfo): void {
    if (c.deadFor >= 0) return;
    c.deadFor = 0;
    c.cause = info.cause;
    c.path = [];
    this.tally[info.cause]++;
    this.onDeath?.(c, info);
  }

  /** Takes `amount` hit points off a creature; it dies when its health runs out. */
  damage(c: Creature, amount: number, info: DeathInfo): void {
    if (c.deadFor >= 0 || amount <= 0) return;
    c.health -= amount / maxHpOf(c);
    if (c.health <= 0) this.die(c, info);
  }

  /** True when the current activity has nothing left to do. */
  private finished(c: Creature): boolean {
    switch (c.activity) {
      case 'wander':
      case 'patrol':
      case 'seekFood':
      case 'seekWater':
      case 'seekShelter':
      case 'flee':
      case 'stalk':
      case 'post':
        return c.step >= c.path.length;
      case 'graze':
        return c.satiety > 0.97 || this.veg.biomassAt(Math.floor(c.x), Math.floor(c.z)) < 15 || c.y !== 0;
      case 'drink':
        return c.hydration > 0.99 || !this.atShore(c);
      case 'eat':
      case 'hide':
        return c.wait <= 0;
      case 'ambush':
        return c.step >= c.path.length && c.wait <= 0;
      default:
        return false;
    }
  }

  // ---- shared behaviour helpers (used by the behaviour modules) ---------------------------

  /** Grazing, drinking, and walking any planned path. */
  defaultAct(c: Creature, dt: number): void {
    switch (c.activity) {
      case 'graze': {
        const eaten = this.veg.graze(Math.floor(c.x), Math.floor(c.z), GRAZE_RATE * dt);
        c.satiety = Math.min(1, c.satiety + eaten * SATIETY_PER_BIOMASS);
        break;
      }
      case 'drink':
        c.hydration = Math.min(1, c.hydration + DRINK_RATE * dt);
        break;
      default:
        if (c.path.length > c.step) this.follow(c, dt, PACE[c.activity] ?? 1);
    }
  }

  /**
   * Walks the planned path at `pace` times the kind's speed. Stops in front of a breach step whose
   * blocks still stand (the behaviour breaks them first).
   */
  follow(c: Creature, dt: number, pace: number): void {
    const def = defOf(c);
    let budget = def.speed * pace * dt * (c.energy < 0.15 ? 0.6 : 1);
    while (budget > 0 && c.step < c.path.length) {
      const t = c.path[c.step];
      if (t.breach && !this.nav.clear(t.x, t.y, t.z, def.body.height)) return;
      const tx = t.x + 0.5;
      const tz = t.z + 0.5;
      const dx = tx - c.x;
      const dz = tz - c.z;
      const dist = Math.hypot(dx, dz);
      const inWater = c.y === 0 && this.nav.isWater(Math.floor(c.x), Math.floor(c.z));
      const speed = inWater ? 0.45 : 1;
      if (dist > 1e-6) c.heading = Math.atan2(dx, dz);
      const move = budget * speed;
      if (move >= dist) {
        c.x = tx;
        c.z = tz;
        c.y = t.y;
        c.step++;
        budget -= dist / speed;
      } else {
        c.x += (dx / dist) * move;
        c.z += (dz / dist) * move;
        budget = 0;
      }
    }
  }

  goDrink(c: Creature): void {
    if (this.atShore(c)) {
      c.activity = 'drink';
      c.path = [];
      return;
    }
    const body = defOf(c).body;
    const s = this.shores.nearest(c.x, c.z, 160, (sx, sz) => this.nav.standable(sx, 0, sz, body));
    if (!s || !this.route(c, { x: s.x, y: 0, z: s.z })) return this.wander(c, 16);
    c.activity = 'seekWater';
  }

  goEat(c: Creature): void {
    if (this.foodHere(c) >= 40) {
      c.activity = 'graze';
      c.path = [];
      return;
    }
    const best = this.findFood(c, 10) ?? this.findFood(c, 24);
    if (!best || !this.route(c, best)) return this.wander(c, 16);
    c.activity = 'seekFood';
  }

  /** Beds down for the night: somewhere safe from predators if one is near, else under a roof. */
  goRest(c: Creature): void {
    const cx = Math.floor(c.x);
    const cz = Math.floor(c.z);
    if (this.safeHere(c)) {
      c.activity = 'rest';
      c.path = [];
      return;
    }
    const safe = this.safety.nearestSafe(cx, c.y, cz, 16);
    if (safe && this.route(c, safe)) {
      c.activity = 'seekShelter';
      return;
    }
    if (this.covered(cx, cz)) {
      c.activity = 'rest';
      c.path = [];
      return;
    }
    const body = defOf(c).body;
    for (let r = 1; r <= 12; r++) {
      for (let k = 0; k < 8; k++) {
        const a = this.rng.range(0, Math.PI * 2);
        const x = Math.round(cx + Math.cos(a) * r);
        const z = Math.round(cz + Math.sin(a) * r);
        if (this.covered(x, z) && this.nav.standable(x, 0, z, body) && this.route(c, { x, y: 0, z })) {
          c.activity = 'seekShelter';
          return;
        }
      }
    }
    c.activity = 'rest';
    c.path = [];
  }

  wander(c: Creature, radius: number): void {
    const body = defOf(c).body;
    for (let attempt = 0; attempt < 4; attempt++) {
      const a = this.rng.range(0, Math.PI * 2);
      const r = this.rng.range(radius * 0.4, radius);
      const x = Math.round(c.x + Math.cos(a) * r);
      const z = Math.round(c.z + Math.sin(a) * r);
      if (!this.nav.inBounds(x, z)) continue;
      const y = this.nav.surfaceBelow(x, c.y + 1, z, body);
      if (y === null) continue;
      if (this.route(c, { x, y, z })) {
        c.activity = 'wander';
        return;
      }
    }
    c.activity = 'idle';
    c.path = [];
  }

  /** Walks to somewhere within `spread` cells of another creature. */
  goNear(c: Creature, o: Creature, spread: number): boolean {
    const body = defOf(c).body;
    for (let attempt = 0; attempt < 3; attempt++) {
      const x = Math.round(o.x + this.rng.range(-spread, spread));
      const z = Math.round(o.z + this.rng.range(-spread, spread));
      if (!this.nav.inBounds(x, z)) continue;
      const y = this.nav.surfaceBelow(x, o.y + 1, z, body);
      if (y !== null && this.route(c, { x, y, z })) {
        c.activity = 'wander';
        return true;
      }
    }
    return false;
  }

  /** The nearest other living creature of a species within `radius` (by smell: walls don't matter). */
  nearest(c: Creature, species: CreatureSpecies, radius: number, accept?: (o: Creature) => boolean): Creature | null {
    let best: Creature | null = null;
    let bestD = radius * radius;
    for (const o of this.creatures) {
      if (o === c || o.species !== species || o.deadFor >= 0) continue;
      const d = (o.x - c.x) ** 2 + (o.z - c.z) ** 2;
      if (d < bestD && (!accept || accept(o))) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  canBreed(c: Creature): boolean {
    const def = defOf(c);
    if (!(c.age >= def.maturity && c.cooldown <= 0 && c.satiety > 0.7 && c.hydration > 0.6 && c.health > 0.8 && this.count(c.species) < this.capOf(c.species))) return false;
    // Wolves raise young only while prey is plentiful, so a pack doesn't outgrow its food.
    return c.species === 'prey' || this.count('prey') >= PREY_PER_WOLF * (this.count('predator') + 1);
  }

  /** The most of a species there can be (breeding stops there). */
  capOf(species: CreatureSpecies): number {
    return this.caps[species] ?? SPECIES[species].cap;
  }

  /** Breeding slows as a species nears its cap (crowding), so populations level off smoothly. */
  breedChance(species: CreatureSpecies, boost = 1): number {
    const room = 1 - this.count(species) / this.capOf(species);
    return room <= 0 ? 0 : BREED_CHANCE * boost * room * room;
  }

  mateNear(c: Creature, accept?: (o: Creature) => boolean): boolean {
    const def = defOf(c);
    for (const o of this.creatures) {
      if (o === c || o.deadFor >= 0 || o.species !== c.species || o.age < def.maturity) continue;
      if (accept && !accept(o)) continue;
      if (Math.abs(o.x - c.x) <= MATE_RADIUS && Math.abs(o.z - c.z) <= MATE_RADIUS && Math.abs(o.y - c.y) <= 2) return true;
    }
    return false;
  }

  breed(c: Creature): Creature[] {
    const def = defOf(c);
    const [lo, hi] = def.litter;
    const n = this.rng.int(lo, hi);
    const cx = Math.floor(c.x);
    const cz = Math.floor(c.z);
    const young: Creature[] = [];
    for (let i = 0; i < n && this.count(c.species) < this.capOf(c.species); i++) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const x = cx + this.rng.int(-1, 1);
        const z = cz + this.rng.int(-1, 1);
        if (!this.nav.standable(x, c.y, z, def.body)) continue;
        const init: Partial<CreatureState> = { age: 0, satiety: 0.7, hydration: 0.7, energy: 1, health: 1, cooldown: 0 };
        if (c.kind) init.kind = c.kind;
        if (c.role) init.role = 'breeder';
        young.push(this.spawn(c.species, x, c.y, z, init));
        break;
      }
    }
    if (young.length > 0) {
      this.tally.born += young.length;
      c.cooldown = def.breedCooldown;
      c.satiety = Math.max(0, c.satiety - 0.25);
    }
    return young;
  }

  /**
   * Plans a route to `target`: straight across open ground when possible, otherwise A*. Urgent
   * searches (running away, pouncing) draw on their own per-tick budget. `breach` lets the search
   * cut through breakable blocks, at the cost it reports.
   */
  route(c: Creature, target: Cell, urgent = false, nodes = PATH_NODES, breach?: (x: number, y: number, z: number) => number | null): boolean {
    const from: Cell = { x: Math.floor(c.x), y: c.y, z: Math.floor(c.z) };
    if (from.x === target.x && from.z === target.z && from.y === target.y) {
      c.path = [];
      c.step = 0;
      return true;
    }
    if (this.nav.straightOnGround(from, target)) {
      c.path = [target];
      c.step = 0;
      return true;
    }
    if (!this.spendSearch(urgent)) return false;
    const path: PathCell[] | null = this.nav.findPath(from, target, defOf(c).body, nodes, undefined, breach);
    if (!path || path.length === 0) return false;
    c.path = path;
    c.step = 0;
    return true;
  }

  /** Takes one path search from this tick's budget; false when it is used up. */
  spendSearch(urgent = false): boolean {
    if (urgent ? this.urgentBudget <= 0 : this.pathBudget <= 0) return false;
    if (urgent) this.urgentBudget--;
    else this.pathBudget--;
    return true;
  }

  foodHere(c: Creature): number {
    return c.y === 0 ? this.veg.biomassAt(Math.floor(c.x), Math.floor(c.z)) : 0;
  }

  private findFood(c: Creature, radius: number): Cell | null {
    const body = defOf(c).body;
    let best: Cell | null = null;
    let bestScore = 40;
    for (let i = 0; i < 20; i++) {
      const x = Math.round(c.x + this.rng.range(-radius, radius));
      const z = Math.round(c.z + this.rng.range(-radius, radius));
      const b = this.veg.biomassAt(x, z);
      const score = b - Math.hypot(x - c.x, z - c.z) * 4;
      if (b >= 40 && score > bestScore && this.nav.standable(x, 0, z, body)) {
        bestScore = score;
        best = { x, y: 0, z };
      }
    }
    return best;
  }

  atShore(c: Creature): boolean {
    if (c.y !== 0) return false;
    const x = Math.floor(c.x);
    const z = Math.floor(c.z);
    return this.nav.isWater(x + 1, z) || this.nav.isWater(x - 1, z) || this.nav.isWater(x, z + 1) || this.nav.isWater(x, z - 1) || this.nav.isWater(x, z);
  }

  safeHere(c: Creature): boolean {
    return this.safety.isSafe(Math.floor(c.x), c.y, Math.floor(c.z));
  }

  /** A ground cell with a structure's blocks overhead: shelter from the sun, if not from wolves. */
  covered(x: number, z: number): boolean {
    const size = this.veg.terrain.size;
    return inGround(size, x, z) && this.veg.cover[cellIndex(size, x, z)] > 0;
  }

  /** Moves a creature out of any block that now occupies its cell, and forgets its route. */
  private unstick(c: Creature): void {
    c.path = [];
    c.step = 0;
    if (c.activity !== 'rest' && c.activity !== 'graze' && c.activity !== 'drink' && c.activity !== 'eat') c.activity = 'idle';
    const body = defOf(c).body;
    const x = Math.floor(c.x);
    const z = Math.floor(c.z);
    if (this.nav.standable(x, c.y, z, body)) return;
    for (let up = 0; up <= 6; up++) {
      if (this.nav.standable(x, c.y + up, z, body)) {
        c.y += up;
        return;
      }
    }
    const below = this.nav.surfaceBelow(x, c.y, z, body);
    if (below !== null) {
      c.y = below;
      return;
    }
    for (let r = 1; r <= 8; r++)
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const y = this.nav.surfaceBelow(x + dx, c.y + 2, z + dz, body);
          if (y !== null) {
            c.x = x + dx + 0.5;
            c.z = z + dz + 0.5;
            c.y = y;
            c.px = c.x;
            c.pz = c.z;
            c.py = y;
            return;
          }
        }
  }
}
