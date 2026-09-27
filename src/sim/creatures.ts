import type { CreatureSpecies, CreatureState } from '../core/world';
import { DAY_SECONDS, TICK_SECONDS, isNight } from './clock';
import { PREY_BODY, type Body, type Cell, type Navigator } from './navigation';
import { hash3, type Rng } from './rng';
import type { ShoreIndex } from './shores';
import { cellIndex, inGround } from './terrain';
import type { Vegetation } from './vegetation';

export type Activity = 'idle' | 'wander' | 'seekFood' | 'graze' | 'seekWater' | 'drink' | 'seekShelter' | 'rest';
export type DeathCause = 'hunger' | 'thirst' | 'age' | 'eaten';

export interface SpeciesDef {
  name: string;
  body: Body;
  /** Walking speed in cells per second. */
  speed: number;
  lifespan: number;
  maturity: number;
  satietyDrain: number;
  hydrationDrain: number;
  energyDrainMoving: number;
  energyRegenResting: number;
  breedCooldown: number;
  cap: number;
  litter: [number, number];
}

export const SPECIES: Record<CreatureSpecies, SpeciesDef> = {
  prey: {
    name: 'Rabbit',
    body: PREY_BODY,
    speed: 2.4,
    lifespan: DAY_SECONDS * 7,
    maturity: DAY_SECONDS,
    satietyDrain: 1 / 420,
    hydrationDrain: 1 / 300,
    energyDrainMoving: 1 / 360,
    energyRegenResting: 1 / 90,
    breedCooldown: DAY_SECONDS * 1.25,
    cap: 300,
    litter: [1, 2],
  },
  // Predators arrive in the next phase; the definition keeps the types complete.
  predator: {
    name: 'Wolf',
    body: { height: 2, climb: 2, drop: 3 },
    speed: 2.8,
    lifespan: DAY_SECONDS * 10,
    maturity: DAY_SECONDS * 1.5,
    satietyDrain: 1 / 600,
    hydrationDrain: 1 / 360,
    energyDrainMoving: 1 / 300,
    energyRegenResting: 1 / 90,
    breedCooldown: DAY_SECONDS * 3,
    cap: 30,
    litter: [1, 1],
  },
};

/** A live creature: saved state plus behaviour that is recomputed after loading. */
export interface Creature extends CreatureState {
  activity: Activity;
  /** Position at the previous tick, for smooth rendering between ticks. */
  px: number;
  py: number;
  pz: number;
  path: Cell[];
  step: number;
  think: number;
  /** Seconds since death, or -1 while alive (the body fades before it is removed). */
  deadFor: number;
  cause: DeathCause | null;
}

export interface Tally {
  born: number;
  hunger: number;
  thirst: number;
  age: number;
  eaten: number;
}

const GRAZE_RATE = 45; // biomass per second
const SATIETY_PER_BIOMASS = 0.45 / 255;
const DRINK_RATE = 0.35; // hydration per second
const FADE_SECONDS = 3;
const PATH_BUDGET_PER_TICK = 6;
const PATH_NODES = 1500;
const HISTORY_EVERY = 10;
const HISTORY_MAX = 1000;
/** Chance per decision (about every 0.6 s) that a ready adult with a mate nearby breeds. */
const BREED_CHANCE = 0.02;
const MATE_RADIUS = 6;

function lifespanOf(c: CreatureState): number {
  const def = SPECIES[c.species];
  return def.lifespan * (0.8 + 0.4 * (hash3(c.id, 7, 19) / 4294967296));
}

/**
 * All creatures of a wild world and the rules they live by. Deterministic: creatures update in id
 * order and every random choice comes from the ecosystem's seeded stream.
 */
export class Population {
  creatures: Creature[] = [];
  nextId = 1;
  tally: Tally = { born: 0, hunger: 0, thirst: 0, age: 0, eaten: 0 };
  history: Array<[number, number, number]> = [];
  private pathBudget = 0;
  private revalidate = false;
  private lastSample = -Infinity;

  constructor(
    private readonly nav: Navigator,
    private readonly veg: Vegetation,
    private readonly shores: ShoreIndex,
    private readonly rng: Rng,
  ) {}

  // ---- lifecycle -------------------------------------------------------------------------

  spawn(species: CreatureSpecies, x: number, y: number, z: number, init: Partial<CreatureState> = {}): Creature {
    const c: Creature = {
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
      age: SPECIES[species].maturity * 1.2,
      cooldown: 0,
      ...init,
      activity: 'idle',
      px: 0,
      py: 0,
      pz: 0,
      path: [],
      step: 0,
      think: this.rng.range(0, 0.5),
      deadFor: -1,
      cause: null,
    };
    if (init.x !== undefined) c.x = init.x;
    if (init.z !== undefined) c.z = init.z;
    c.px = c.x;
    c.py = c.y;
    c.pz = c.z;
    this.creatures.push(c);
    return c;
  }

  /** Spawns up to `count` adults on free ground within `radius` of (cx, cz). Returns how many. */
  spawnGroup(species: CreatureSpecies, cx: number, cz: number, count: number, radius = 5): number {
    const body = SPECIES[species].body;
    let made = 0;
    for (let attempt = 0; attempt < count * 12 && made < count; attempt++) {
      const x = Math.round(cx + this.rng.range(-radius, radius));
      const z = Math.round(cz + this.rng.range(-radius, radius));
      if (!this.nav.inBounds(x, z) || this.nav.isWater(x, z)) continue;
      const y = this.nav.surfaceBelow(x, 8, z, body);
      if (y === null) continue;
      const def = SPECIES[species];
      this.spawn(species, x, y, z, {
        age: def.maturity * this.rng.range(1.1, 3),
        satiety: this.rng.range(0.7, 0.95),
        hydration: this.rng.range(0.7, 0.95),
        cooldown: this.rng.range(0, def.breedCooldown * 0.6),
      });
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
    return this.creatures.find((c) => c.id === id);
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
      .map((c) => ({
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
      }));
  }

  /** Replaces the population with saved creatures. Draws nothing from the random stream. */
  load(states: readonly CreatureState[], nextId: number | undefined): void {
    this.creatures = states.map((s) => ({
      ...s,
      activity: 'idle' as Activity,
      px: s.x,
      py: s.y,
      pz: s.z,
      path: [],
      step: 0,
      think: 0,
      deadFor: -1,
      cause: null,
    }));
    this.creatures.sort((a, b) => a.id - b.id);
    this.nextId = Math.max(nextId ?? 1, ...this.creatures.map((c) => c.id + 1), 1);
    this.revalidate = true;
  }

  // ---- simulation -------------------------------------------------------------------------

  tick(time: number): void {
    const dt = TICK_SECONDS;
    this.pathBudget = PATH_BUDGET_PER_TICK;
    if (this.revalidate) {
      this.revalidate = false;
      for (const c of this.creatures) if (c.deadFor < 0) this.unstick(c);
    }
    const night = isNight(time);
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
      this.live(c, dt, night);
    }
    if (removed) this.creatures = this.creatures.filter((c) => c.deadFor <= FADE_SECONDS);
    if (time - this.lastSample >= HISTORY_EVERY) {
      this.lastSample = time;
      this.history.push([Math.round(time * 10) / 10, this.count('prey'), this.count('predator')]);
      if (this.history.length > HISTORY_MAX) this.history.splice(0, this.history.length - HISTORY_MAX);
    }
  }

  private live(c: Creature, dt: number, night: boolean): void {
    const def = SPECIES[c.species];
    c.age += dt;
    c.cooldown = Math.max(0, c.cooldown - dt);
    const moving = c.path.length > c.step;
    const resting = c.activity === 'rest';
    const slow = resting ? 0.6 : 1;
    c.satiety = Math.max(0, c.satiety - def.satietyDrain * dt * slow);
    c.hydration = Math.max(0, c.hydration - def.hydrationDrain * dt * slow);
    if (moving) c.energy = Math.max(0, c.energy - def.energyDrainMoving * dt);
    else if (resting) c.energy = Math.min(1, c.energy + def.energyRegenResting * dt);
    if (c.satiety <= 0 || c.hydration <= 0) c.health -= dt / 45;
    else if (c.satiety > 0.3 && c.hydration > 0.3) c.health = Math.min(1, c.health + dt / 240);
    if (c.health <= 0) return this.die(c, c.hydration <= 0 ? 'thirst' : 'hunger');
    if (c.age > lifespanOf(c)) return this.die(c, 'age');

    c.think -= dt;
    if (c.think <= 0 || this.finished(c)) {
      this.decide(c, night);
      c.think = 0.4 + this.rng.next() * 0.4;
    }
    this.act(c, dt);
  }

  private die(c: Creature, cause: DeathCause): void {
    c.deadFor = 0;
    c.cause = cause;
    c.path = [];
    this.tally[cause]++;
  }

  /** True when the current activity has nothing left to do. */
  private finished(c: Creature): boolean {
    switch (c.activity) {
      case 'wander':
      case 'seekFood':
      case 'seekWater':
      case 'seekShelter':
        return c.step >= c.path.length;
      case 'graze':
        return c.satiety > 0.97 || this.veg.biomassAt(Math.floor(c.x), Math.floor(c.z)) < 15 || c.y !== 0;
      case 'drink':
        return c.hydration > 0.99 || !this.atShore(c);
      default:
        return false;
    }
  }

  private decide(c: Creature, night: boolean): void {
    // Arrivals turn into the activity they were heading for.
    if (c.step >= c.path.length && c.path.length > 0) {
      const arrived = c.activity;
      c.path = [];
      c.step = 0;
      if (arrived === 'seekWater' && this.atShore(c)) return void (c.activity = 'drink');
      if (arrived === 'seekFood' && this.foodHere(c) >= 30) return void (c.activity = 'graze');
      if (arrived === 'seekShelter') return void (c.activity = 'rest');
    }
    // Keep doing a useful thing rather than dithering, unless something else became urgent.
    const thirsty = c.hydration < 0.25;
    const starving = c.satiety < 0.25;
    const moving = c.path.length > c.step;
    if (c.activity === 'drink' && c.hydration < 0.99 && this.atShore(c)) return;
    if (c.activity === 'graze' && c.satiety < 0.97 && this.foodHere(c) >= 15 && !thirsty) return;
    if (moving && c.activity === 'seekWater') return;
    if (moving && c.activity === 'seekFood' && !thirsty) return;
    if (moving && c.activity === 'seekShelter' && !thirsty && !starving) return;

    if (thirsty) return this.goDrink(c);
    if (starving) return this.goEat(c);
    if (c.hydration < 0.45) return this.goDrink(c);
    if (c.satiety < 0.55) return this.goEat(c);
    if (night || c.energy < 0.25) {
      if (c.activity === 'rest' && (night || c.energy < 0.9)) return;
      return this.goRest(c);
    }
    if (this.canBreed(c) && this.rng.chance(this.breedChance(c.species)) && this.mateNear(c)) this.breed(c);
    if (c.satiety < 0.85 && this.foodHere(c) >= 60) return void (c.activity = 'graze');
    if (c.hydration < 0.75) {
      const s = this.shores.nearest(c.x, c.z, 12);
      if (s) return this.goDrink(c);
    }
    if (this.rng.chance(0.45)) this.wander(c, 8);
    else {
      c.activity = 'idle';
      c.path = [];
    }
  }

  private act(c: Creature, dt: number): void {
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
        if (c.path.length > c.step) this.follow(c, dt);
    }
  }

  private follow(c: Creature, dt: number): void {
    const def = SPECIES[c.species];
    let budget = def.speed * dt * (c.energy < 0.15 ? 0.6 : 1);
    while (budget > 0 && c.step < c.path.length) {
      const t = c.path[c.step];
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
        // A long straight walk across open ground stays at ground level.
        budget = 0;
      }
    }
  }

  // ---- intentions -------------------------------------------------------------------------

  private goDrink(c: Creature): void {
    if (this.atShore(c)) {
      c.activity = 'drink';
      c.path = [];
      return;
    }
    const body = SPECIES[c.species].body;
    const s = this.shores.nearest(c.x, c.z, 160, (sx, sz) => this.nav.standable(sx, 0, sz, body));
    if (!s || !this.route(c, { x: s.x, y: 0, z: s.z })) return this.wander(c, 16);
    c.activity = 'seekWater';
  }

  private goEat(c: Creature): void {
    if (this.foodHere(c) >= 40) {
      c.activity = 'graze';
      c.path = [];
      return;
    }
    const best = this.findFood(c, 10) ?? this.findFood(c, 24);
    if (!best || !this.route(c, best)) return this.wander(c, 16);
    c.activity = 'seekFood';
  }

  private goRest(c: Creature): void {
    const cx = Math.floor(c.x);
    const cz = Math.floor(c.z);
    if (this.covered(cx, cz)) {
      c.activity = 'rest';
      c.path = [];
      return;
    }
    const body = SPECIES[c.species].body;
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

  private wander(c: Creature, radius: number): void {
    const body = SPECIES[c.species].body;
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

  private canBreed(c: Creature): boolean {
    const def = SPECIES[c.species];
    return c.age >= def.maturity && c.cooldown <= 0 && c.satiety > 0.7 && c.hydration > 0.6 && c.health > 0.8 && this.count(c.species) < def.cap;
  }

  /** Breeding slows as a species nears its cap (crowding), so populations level off smoothly. */
  private breedChance(species: CreatureSpecies): number {
    const room = 1 - this.count(species) / SPECIES[species].cap;
    return room <= 0 ? 0 : BREED_CHANCE * room * room;
  }

  private mateNear(c: Creature): boolean {
    const def = SPECIES[c.species];
    for (const o of this.creatures) {
      if (o === c || o.deadFor >= 0 || o.species !== c.species || o.age < def.maturity) continue;
      if (Math.abs(o.x - c.x) <= MATE_RADIUS && Math.abs(o.z - c.z) <= MATE_RADIUS && Math.abs(o.y - c.y) <= 2) return true;
    }
    return false;
  }

  private breed(c: Creature): void {
    const def = SPECIES[c.species];
    const [lo, hi] = def.litter;
    const n = this.rng.int(lo, hi);
    const cx = Math.floor(c.x);
    const cz = Math.floor(c.z);
    let born = 0;
    for (let i = 0; i < n && this.count(c.species) < def.cap; i++) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const x = cx + this.rng.int(-1, 1);
        const z = cz + this.rng.int(-1, 1);
        if (!this.nav.standable(x, c.y, z, def.body)) continue;
        this.spawn(c.species, x, c.y, z, { age: 0, satiety: 0.7, hydration: 0.7, energy: 1, health: 1, cooldown: 0 });
        born++;
        break;
      }
    }
    if (born > 0) {
      this.tally.born += born;
      c.cooldown = def.breedCooldown;
      c.satiety = Math.max(0, c.satiety - 0.25);
    }
  }

  // ---- helpers ----------------------------------------------------------------------------

  /** Plans a route to `target`: straight across open ground when possible, otherwise A*. */
  private route(c: Creature, target: Cell): boolean {
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
    if (this.pathBudget <= 0) return false;
    this.pathBudget--;
    const path = this.nav.findPath(from, target, SPECIES[c.species].body, PATH_NODES);
    if (!path || path.length === 0) return false;
    c.path = path;
    c.step = 0;
    return true;
  }

  private foodHere(c: Creature): number {
    return c.y === 0 ? this.veg.biomassAt(Math.floor(c.x), Math.floor(c.z)) : 0;
  }

  private findFood(c: Creature, radius: number): Cell | null {
    const body = SPECIES[c.species].body;
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

  private atShore(c: Creature): boolean {
    if (c.y !== 0) return false;
    const x = Math.floor(c.x);
    const z = Math.floor(c.z);
    return this.nav.isWater(x + 1, z) || this.nav.isWater(x - 1, z) || this.nav.isWater(x, z + 1) || this.nav.isWater(x, z - 1) || this.nav.isWater(x, z);
  }

  /** A ground cell with a structure's blocks overhead: shelter from sun and (later) from sight. */
  private covered(x: number, z: number): boolean {
    const size = this.veg.terrain.size;
    return inGround(size, x, z) && this.veg.cover[cellIndex(size, x, z)] > 0;
  }

  /** Moves a creature out of any block that now occupies its cell, and forgets its route. */
  private unstick(c: Creature): void {
    c.path = [];
    c.step = 0;
    if (c.activity !== 'rest' && c.activity !== 'graze' && c.activity !== 'drink') c.activity = 'idle';
    const body = SPECIES[c.species].body;
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

/** Half-width and height of the box used to pick a creature with the crosshair. */
const PICK_BOX: Record<CreatureSpecies, [number, number]> = { prey: [0.35, 0.8], predator: [0.45, 1.6] };

/**
 * The living creature nearest along a ray (origin, unit direction) within `maxDistance`, or null.
 * Each creature is treated as an upright box around its position.
 */
export function pickCreature(
  creatures: readonly Creature[],
  origin: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  maxDistance: number,
): { creature: Creature; distance: number } | null {
  let best: Creature | null = null;
  let bestT = maxDistance;
  for (const c of creatures) {
    if (c.deadFor >= 0) continue;
    const [r, h] = PICK_BOX[c.species];
    const t = rayBox(origin, dir, c.x - r, c.y, c.z - r, c.x + r, c.y + h, c.z + r);
    if (t !== null && t < bestT) {
      bestT = t;
      best = c;
    }
  }
  return best ? { creature: best, distance: bestT } : null;
}

function rayBox(o: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number | null {
  let tmin = 0;
  let tmax = Infinity;
  const axes: Array<[number, number, number, number]> = [
    [o.x, d.x, x0, x1],
    [o.y, d.y, y0, y1],
    [o.z, d.z, z0, z1],
  ];
  for (const [p, v, lo, hi] of axes) {
    if (Math.abs(v) < 1e-9) {
      if (p < lo || p > hi) return null;
      continue;
    }
    let a = (lo - p) / v;
    let b = (hi - p) / v;
    if (a > b) [a, b] = [b, a];
    tmin = Math.max(tmin, a);
    tmax = Math.min(tmax, b);
    if (tmin > tmax) return null;
  }
  return tmin;
}

const ACTIVITY_LABEL: Record<Activity, string> = {
  idle: 'Resting a moment',
  wander: 'Wandering',
  seekFood: 'Looking for food',
  graze: 'Grazing',
  seekWater: 'Looking for water',
  drink: 'Drinking',
  seekShelter: 'Looking for shelter',
  rest: 'Sleeping',
};

/** A short human description of what a creature is doing. */
export function describeActivity(c: Creature): string {
  if (c.deadFor >= 0) return c.cause === 'eaten' ? 'Caught' : c.cause === 'age' ? 'Died of old age' : c.cause === 'thirst' ? 'Died of thirst' : 'Starved';
  return ACTIVITY_LABEL[c.activity];
}
