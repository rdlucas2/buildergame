import type { Structure } from '../core/structure';
import type { CreatureSpecies, EcosystemState, Placement } from '../core/world';
import { START_TIME, TICK_SECONDS, daylight } from './clock';
import { Population, SPECIES, type Tally } from './creatures';
import { Navigator } from './navigation';
import { Rng, hash3 } from './rng';
import { ShoreIndex } from './shores';
import { SolidMap } from './solids';
import { generateTerrain, type Terrain } from './terrain';
import { Vegetation } from './vegetation';

export type StructureLookup = (id: string) => Structure | undefined;

/** Rabbits a new wild world starts with, grazing near the starter pond. */
export const STARTER_HERD = 14;

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
  readonly rng: Rng;
  readonly seed: number;
  time: number;
  ticks = 0;
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
    this.population = new Population(this.nav, this.vegetation, this.shores, this.rng);
    if (state.creatures) this.population.load(state.creatures, state.nextCreatureId);
    if (state.history) this.population.history = state.history.map(([t, a, b]) => [t, a, b]);
    if (state.tally) {
      const t = this.population.tally;
      for (const k of Object.keys(t) as Array<keyof Tally>) if (Number.isFinite(state.tally[k])) t[k] = state.tally[k];
    }
    this.herdPending = state.creatures === undefined;
  }

  /** A brand-new wild world starting in the morning, with a herd of rabbits near water. */
  static create(size: number, seed: number): Ecosystem {
    const e = new Ecosystem(size, { seed, time: START_TIME });
    e.spawnStarterHerd();
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
    this.population.worldChanged();
  }

  placementRemoved(id: string): void {
    this.vegetation.removePlacement(id);
    this.solids.remove(id);
    this.population.worldChanged();
  }

  tick(): void {
    if (this.herdPending) this.spawnStarterHerd();
    this.time += TICK_SECONDS;
    this.ticks++;
    this.vegetation.tick(daylight(this.time));
    this.population.tick(this.time);
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
    };
  }
}
