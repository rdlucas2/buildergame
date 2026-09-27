import type { Structure } from '../core/structure';
import type { EcosystemState, Placement } from '../core/world';
import { START_TIME, TICK_SECONDS, daylight } from './clock';
import { generateTerrain, type Terrain } from './terrain';
import { Vegetation } from './vegetation';

export type StructureLookup = (id: string) => Structure | undefined;

/**
 * Everything that lives in a wild world, independent of rendering: terrain, vegetation and time.
 * Deterministic: the same seed, placements and number of ticks always give the same state.
 */
export class Ecosystem {
  readonly terrain: Terrain;
  readonly vegetation: Vegetation;
  readonly seed: number;
  time: number;
  ticks = 0;

  private constructor(size: number, state: EcosystemState) {
    this.seed = state.seed >>> 0;
    this.time = state.time;
    this.terrain = generateTerrain(size, this.seed);
    const biomass = state.biomass && state.biomass.length === size * size ? new Uint8Array(state.biomass) : Vegetation.initialBiomass(this.terrain, this.seed);
    this.vegetation = new Vegetation(this.terrain, biomass);
  }

  /** A brand-new wild world starting in the morning. */
  static create(size: number, seed: number): Ecosystem {
    return new Ecosystem(size, { seed, time: START_TIME });
  }

  /** Restores a saved state (a missing biomass grid is regenerated from the seed). */
  static restore(size: number, state: EcosystemState): Ecosystem {
    return new Ecosystem(size, state);
  }

  get size(): number {
    return this.terrain.size;
  }

  /** Rebuilds sky cover from a full set of placements. */
  setPlacements(placements: readonly Placement[], lookup: StructureLookup): void {
    this.vegetation.clearPlacements();
    for (const p of placements) this.placementAdded(p, lookup);
  }

  placementAdded(p: Placement, lookup: StructureLookup): void {
    const s = lookup(p.structureId);
    if (s) this.vegetation.addPlacement(p, s);
  }

  placementRemoved(id: string): void {
    this.vegetation.removePlacement(id);
  }

  tick(): void {
    this.time += TICK_SECONDS;
    this.ticks++;
    this.vegetation.tick(daylight(this.time));
  }

  /** Runs whole ticks covering `seconds` of simulation time. */
  advance(seconds: number): void {
    const n = Math.round(seconds / TICK_SECONDS);
    for (let i = 0; i < n; i++) this.tick();
  }

  /** State to persist (copies the grids so later ticks don't mutate the saved object). */
  snapshot(): EcosystemState {
    return { seed: this.seed, time: this.time, biomass: new Uint8Array(this.vegetation.biomass) };
  }
}
