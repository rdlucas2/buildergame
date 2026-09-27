import { rotateLocal } from '../core/rotation';
import type { Structure } from '../core/structure';
import type { Placement } from '../core/world';
import { fbm } from './noise';
import { cellIndex, inGround, type Terrain } from './terrain';

/** Biomass gained per growth update in full daylight (0 to full in roughly half a day). */
export const GROWTH_PER_UPDATE = 6;
/** Biomass lost per update where a structure blocks the sky above. */
export const SHADE_DECAY_PER_UPDATE = 12;
/** Every cell is updated once per this many ticks. */
export const SWEEP_TICKS = 50;
export const MAX_BIOMASS = 255;

/** Columns (x, z) of a structure that contain at least one block, in its own unrotated frame. */
export interface RoofMask {
  sx: number;
  sz: number;
  cells: Uint8Array;
}

const roofCache = new WeakMap<Structure, RoofMask>();

export function roofMask(s: Structure): RoofMask {
  let m = roofCache.get(s);
  if (m) return m;
  const { x: sx, y: sy, z: sz } = s.voxels.size;
  const cells = new Uint8Array(sx * sz);
  for (let y = 0; y < sy; y++)
    for (let z = 0; z < sz; z++)
      for (let x = 0; x < sx; x++) if (s.voxels.data[x + sx * (z + sz * y)] !== 0) cells[x + sx * z] = 1;
  m = { sx, sz, cells };
  roofCache.set(s, m);
  return m;
}

/**
 * Grass on the ground grid. Food only grows where sunlight reaches the ground: a column with any
 * placed block above it is "covered" and its grass dies back. Growth is processed in a rolling sweep
 * so each tick only touches a slice of the grid.
 */
export class Vegetation {
  readonly biomass: Uint8Array;
  /** Number of placements with a block somewhere above each ground cell. */
  readonly cover: Uint16Array;
  private readonly stamps = new Map<string, Int32Array>();
  private cursor = 0;

  constructor(
    readonly terrain: Terrain,
    biomass?: Uint8Array,
  ) {
    const n = terrain.size * terrain.size;
    if (biomass && biomass.length !== n) throw new Error(`biomass has ${biomass.length} cells, expected ${n}`);
    this.biomass = biomass ?? new Uint8Array(n);
    this.cover = new Uint16Array(n);
    for (let i = 0; i < n; i++) if (terrain.water[i]) this.biomass[i] = 0;
  }

  /** Starting grass: patchy meadows, none on water. */
  static initialBiomass(terrain: Terrain, seed: number): Uint8Array {
    const { size, half, water } = terrain;
    const b = new Uint8Array(size * size);
    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
        const i = x + z * size;
        if (water[i]) continue;
        const lush = fbm(seed ^ 0x6c8e9cf5, (x - half) / 48, (z - half) / 48, 3);
        b[i] = Math.round(70 + 185 * Math.min(1, Math.max(0, (lush - 0.2) / 0.6)));
      }
    }
    return b;
  }

  // ---- sky cover from placements ----------------------------------------------------------

  /** Marks the ground under a placement's blocks as covered. Replaces any earlier stamp for the id. */
  addPlacement(p: Placement, s: Structure): void {
    this.removePlacement(p.id);
    const mask = roofMask(s);
    const size = this.terrain.size;
    const cells: number[] = [];
    for (let z = 0; z < mask.sz; z++) {
      for (let x = 0; x < mask.sx; x++) {
        if (!mask.cells[x + mask.sx * z]) continue;
        const [rx, rz] = rotateLocal(x, z, s.voxels.size, p.rotation);
        const wx = p.position.x + rx;
        const wz = p.position.z + rz;
        if (!inGround(size, wx, wz)) continue;
        const i = cellIndex(size, wx, wz);
        this.cover[i]++;
        cells.push(i);
      }
    }
    this.stamps.set(p.id, Int32Array.from(cells));
  }

  removePlacement(id: string): void {
    const cells = this.stamps.get(id);
    if (!cells) return;
    for (let k = 0; k < cells.length; k++) this.cover[cells[k]]--;
    this.stamps.delete(id);
  }

  clearPlacements(): void {
    this.cover.fill(0);
    this.stamps.clear();
  }

  get placementCount(): number {
    return this.stamps.size;
  }

  // ---- queries ----------------------------------------------------------------------------

  isSkylit(x: number, z: number): boolean {
    return inGround(this.terrain.size, x, z) && this.cover[cellIndex(this.terrain.size, x, z)] === 0;
  }

  biomassAt(x: number, z: number): number {
    return inGround(this.terrain.size, x, z) ? this.biomass[cellIndex(this.terrain.size, x, z)] : 0;
  }

  /** Removes up to `amount` biomass from a cell and returns how much was eaten. */
  graze(x: number, z: number, amount: number): number {
    if (!inGround(this.terrain.size, x, z)) return 0;
    const i = cellIndex(this.terrain.size, x, z);
    const eaten = Math.min(this.biomass[i], Math.max(0, Math.round(amount)));
    this.biomass[i] -= eaten;
    return eaten;
  }

  // ---- growth -----------------------------------------------------------------------------

  /** Advances the rolling growth sweep by one tick, given the current daylight (0..1). */
  tick(light: number): void {
    const n = this.biomass.length;
    const per = Math.ceil(n / SWEEP_TICKS);
    const grow = Math.round(GROWTH_PER_UPDATE * light);
    const { water } = this.terrain;
    const b = this.biomass;
    const cover = this.cover;
    let i = this.cursor;
    for (let k = 0; k < per; k++, i++) {
      if (i >= n) i = 0;
      if (water[i]) continue;
      if (cover[i] > 0) {
        const v = b[i] - SHADE_DECAY_PER_UPDATE;
        b[i] = v < 0 ? 0 : v;
      } else if (grow > 0) {
        const v = b[i] + grow;
        b[i] = v > MAX_BIOMASS ? MAX_BIOMASS : v;
      }
    }
    this.cursor = i >= n ? 0 : i;
  }

  /** Share of dry, skylit ground that is well grown (biomass at least half). */
  coverage(): number {
    const { water } = this.terrain;
    let dry = 0;
    let lush = 0;
    for (let i = 0; i < this.biomass.length; i++) {
      if (water[i]) continue;
      dry++;
      if (this.biomass[i] >= 128) lush++;
    }
    return dry ? lush / dry : 0;
  }
}
