import type { Structure } from '../core/structure';
import { NO_MODIFIERS, type DefenseModifiers } from '../core/defense-state';
import type { CreatureSpecies, EcosystemState, Placement } from '../core/world';
import { DAY_SECONDS, START_TIME, TICK_SECONDS, daylight } from './clock';
import { Population, SPECIES, type Tally } from './creatures';
import { Defense } from './defense/defense';
import { buildStarterWarren, chooseWarrenSite, createBase } from './defense/starter';
import { Navigator } from './navigation';
import { Rng, hash3 } from './rng';
import { SafetyMap } from './safety';
import { ShoreIndex } from './shores';
import { SolidMap } from './solids';
import { generateTerrain, type Terrain } from './terrain';
import { Vegetation } from './vegetation';

export type StructureLookup = (id: string) => Structure | undefined;

/** Rabbits a new wild world starts with, grazing near the starter pond. */
export const STARTER_HERD = 14;
/** Wolves that arrive together, first late on day 1 and again whenever wolves have died out. */
export const PACK_SIZE = 3;
/** Seconds until the first pack arrives in a new world (about 17:30 on day 1). */
export const FIRST_PACK = DAY_SECONDS * 0.44;
/** Seconds without any wolves before a new pack wanders in. */
export const PACK_RETURN = DAY_SECONDS * 1.5;
/** How far from the herd a pack appears. */
const PACK_DISTANCE = 80;

export type EcosystemEvent = { kind: 'pack'; x: number; z: number; count: number };

/**
 * Everything that lives in a wild world, independent of rendering: terrain, vegetation, creatures
 * and time. Deterministic: the same seed, placements and number of ticks always give the same state.
 */
export class Ecosystem {
  readonly terrain: Terrain;
  readonly vegetation: Vegetation;
  readonly solids: SolidMap;
  readonly nav: Navigator;
  readonly shores: ShoreIndex;
  readonly population: Population;
  readonly safety: SafetyMap;
  readonly rng: Rng;
  readonly seed: number;
  time: number;
  ticks = 0;
  /** Seconds until a wolf pack arrives, counting down only while there are no wolves. */
  packTimer: number;
  /** Things worth telling the player about, collected until the view drains them. */
  events: EcosystemEvent[] = [];
  /** The Warren Defense round, in defense worlds. */
  defense: Defense | null = null;
  private lookup: StructureLookup = () => undefined;
  /** Worlds saved before creatures existed get their starter herd once placements are known. */
  private herdPending: boolean;

  private constructor(size: number, state: EcosystemState) {
    this.seed = state.seed >>> 0;
    this.time = state.time;
    this.terrain = generateTerrain(size, this.seed);
    const biomass = state.biomass && state.biomass.length === size * size ? new Uint8Array(state.biomass) : Vegetation.initialBiomass(this.terrain, this.seed);
    this.vegetation = new Vegetation(this.terrain, biomass);
    this.rng = new Rng(state.rng ?? hash3(this.seed, 0x5eed, 0xc0ffee));
    this.solids = new SolidMap((id) => this.lookup(id));
    this.nav = new Navigator(this.solids, this.terrain);
    this.shores = new ShoreIndex(this.terrain);
    this.safety = new SafetyMap(this.nav);
    this.population = new Population(this.nav, this.vegetation, this.shores, this.rng, this.safety);
    this.packTimer = state.packTimer ?? FIRST_PACK;
    if (state.creatures) this.population.load(state.creatures, state.nextCreatureId);
    if (state.history) this.population.history = state.history.map(([t, a, b]) => [t, a, b]);
    if (state.tally) {
      const t = this.population.tally;
      for (const k of Object.keys(t) as Array<keyof Tally>) if (Number.isFinite(state.tally[k])) t[k] = state.tally[k];
    }
    this.herdPending = state.creatures === undefined;
    if (state.defense) {
      this.defense = new Defense(this, state.defense);
      this.herdPending = false;
    }
  }

  /**
   * A brand-new wild world starting in the morning, with a herd of rabbits near water. With
   * `defense`, it is a Warren Defense round instead: the herd starts inside a walled warren and
   * waves of predators come for it.
   */
  static create(size: number, seed: number, opts: { defense?: Partial<DefenseModifiers> } = {}): Ecosystem {
    if (!opts.defense) {
      const e = new Ecosystem(size, { seed, time: START_TIME });
      e.spawnStarterHerd();
      return e;
    }
    const e = new Ecosystem(size, { seed, time: START_TIME, creatures: [] });
    const modifiers = { ...NO_MODIFIERS, ...opts.defense };
    const site = chooseWarrenSite(e.terrain);
    const base = createBase(site);
    buildStarterWarren(base, site);
    e.defense = new Defense(e, Defense.initialState(site, base, modifiers));
    e.population.spawnGroup('prey', site.x, site.z, STARTER_HERD + modifiers.rabbits, 5);
    return e;
  }

  /** Restores a saved state (a missing biomass grid is regenerated from the seed). */
  static restore(size: number, state: EcosystemState): Ecosystem {
    return new Ecosystem(size, state);
  }

  get size(): number {
    return this.terrain.size;
  }

  /** Rebuilds sky cover and solidity from a full set of placements. */
  setPlacements(placements: readonly Placement[], lookup: StructureLookup): void {
    this.lookup = lookup;
    this.vegetation.clearPlacements();
    this.solids.reset(placements);
    this.safety.invalidate();
    for (const p of placements) {
      const s = lookup(p.structureId);
      if (s) this.vegetation.addPlacement(p, s);
    }
    this.population.worldChanged();
    if (this.herdPending) this.spawnStarterHerd();
  }

  placementAdded(p: Placement, lookup: StructureLookup): void {
    this.lookup = lookup;
    const s = lookup(p.structureId);
    if (!s) return;
    this.vegetation.addPlacement(p, s);
    this.solids.add(p);
    this.safety.invalidate();
    this.population.worldChanged();
  }

  placementRemoved(id: string): void {
    this.vegetation.removePlacement(id);
    this.solids.remove(id);
    this.safety.invalidate();
    this.population.worldChanged();
  }

  tick(): void {
    // Replayed actions land between ticks, exactly where they were first taken.
    this.defense?.beforeTick();
    if (this.herdPending) this.spawnStarterHerd();
    this.time += TICK_SECONDS;
    this.ticks++;
    this.vegetation.tick(daylight(this.time));
    this.population.tick(this.time);
    if (this.defense) this.defense.tick();
    else this.wolves();
  }

  /** Wolves wander in from far away once there have been none for a while (and there is prey). */
  private wolves(): void {
    const pop = this.population;
    if (pop.count('predator') > 0) {
      this.packTimer = Math.max(this.packTimer, PACK_RETURN);
      return;
    }
    this.packTimer -= TICK_SECONDS;
    if (this.packTimer > 0) return;
    const prey = pop.creatures.filter((c) => c.species === 'prey' && c.deadFor < 0);
    if (prey.length < 6) {
      this.packTimer = DAY_SECONDS * 0.25;
      return;
    }
    const cx = prey.reduce((s, c) => s + c.x, 0) / prey.length;
    const cz = prey.reduce((s, c) => s + c.z, 0) / prey.length;
    const half = this.terrain.half;
    for (let attempt = 0; attempt < 8; attempt++) {
      const a = this.rng.range(0, Math.PI * 2);
      const x = Math.round(Math.max(-half + 8, Math.min(half - 8, cx + Math.cos(a) * PACK_DISTANCE)));
      const z = Math.round(Math.max(-half + 8, Math.min(half - 8, cz + Math.sin(a) * PACK_DISTANCE)));
      const n = pop.spawnGroup('predator', x, z, PACK_SIZE, 3);
      if (n > 0) {
        this.events.push({ kind: 'pack', x, z, count: n });
        this.packTimer = PACK_RETURN;
        return;
      }
    }
    this.packTimer = DAY_SECONDS * 0.1;
  }

  /** Runs whole ticks covering `seconds` of simulation time. */
  advance(seconds: number): void {
    const n = Math.round(seconds / TICK_SECONDS);
    for (let i = 0; i < n; i++) this.tick();
  }

  /**
   * Releases up to `count` creatures on free ground around (x, z). Returns how many appeared
   * (fewer when the area is built over or the species is at its population cap).
   */
  release(species: CreatureSpecies, x: number, z: number, count: number, radius = 4): number {
    const room = Math.max(0, SPECIES[species].cap - this.population.count(species));
    return this.population.spawnGroup(species, x, z, Math.min(count, room), radius);
  }

  /** A herd on the near shore of the water closest to the origin (where players start). */
  private spawnStarterHerd(): void {
    this.herdPending = false;
    const shore = this.shores.nearest(0, 0, this.size, (x, z) => this.nav.standable(x, 0, z, SPECIES.prey.body));
    let cx = 0;
    let cz = 0;
    if (shore) {
      // A few cells back from the water, towards the origin, so the herd stands on dry grass.
      const d = Math.hypot(shore.x, shore.z) || 1;
      const back = Math.min(6, d);
      cx = Math.round(shore.x - (shore.x / d) * back);
      cz = Math.round(shore.z - (shore.z / d) * back);
    }
    this.population.spawnGroup('prey', cx, cz, STARTER_HERD, 5);
  }

  /** State to persist (copies the grids so later ticks don't mutate the saved object). */
  snapshot(): EcosystemState {
    const p = this.population;
    return {
      seed: this.seed,
      time: this.time,
      biomass: new Uint8Array(this.vegetation.biomass),
      creatures: p.toState(),
      nextCreatureId: p.nextId,
      rng: this.rng.seedState,
      history: p.history.map(([t, a, b]) => [t, a, b]),
      tally: { ...p.tally },
      packTimer: Math.round(this.packTimer * 10) / 10,
      ...(this.defense ? { defense: this.defense.toState() } : {}),
    };
  }
}
