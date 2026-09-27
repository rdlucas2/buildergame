import { createStructure, normalizeStructure, paletteSlotFor, type PaletteEntry, type Structure } from './structure';
import { AIR, VoxelGrid, type Size3 } from './voxel-grid';

/** A material id, or null for air. */
export type Mat = string | null;

export interface BuildMeta {
  id: string;
  name: string;
  author?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Small authoring API for making structures in code (used by the built-in examples).
 * All box coordinates are inclusive on both ends, which reads naturally when describing
 * "walls from x = 1 to x = 11". Writes outside the grid are ignored.
 */
export class StructureBuilder {
  readonly grid: VoxelGrid;
  readonly palette: PaletteEntry[] = [];

  constructor(readonly size: Size3) {
    this.grid = new VoxelGrid(size);
  }

  private slot(m: Mat): number {
    return m === null ? AIR : paletteSlotFor(this.palette, m);
  }

  set(x: number, y: number, z: number, m: Mat): this {
    this.grid.set(x, y, z, this.slot(m));
    return this;
  }

  get(x: number, y: number, z: number): Mat {
    const v = this.grid.get(x, y, z);
    return v === AIR ? null : (this.palette[v - 1]?.material ?? null);
  }

  isSolid(x: number, y: number, z: number): boolean {
    return this.grid.get(x, y, z) !== AIR;
  }

  /** Fills the inclusive box between two corners (in any order). */
  fill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, m: Mat): this {
    const v = this.slot(m);
    const [ax, bx] = x0 <= x1 ? [x0, x1] : [x1, x0];
    const [ay, by] = y0 <= y1 ? [y0, y1] : [y1, y0];
    const [az, bz] = z0 <= z1 ? [z0, z1] : [z1, z0];
    for (let y = ay; y <= by; y++) for (let z = az; z <= bz; z++) for (let x = ax; x <= bx; x++) this.grid.set(x, y, z, v);
    return this;
  }

  /** The four vertical walls of the inclusive box, without floor or ceiling. */
  walls(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, m: Mat): this {
    this.fill(x0, y0, z0, x1, y1, z0, m);
    this.fill(x0, y0, z1, x1, y1, z1, m);
    this.fill(x0, y0, z0, x0, y1, z1, m);
    this.fill(x1, y0, z0, x1, y1, z1, m);
    return this;
  }

  /** Replaces solid cells (or only cells of material `from`) inside the inclusive box. */
  replace(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, from: Mat | '*', to: Mat): this {
    const target = from === '*' ? -1 : this.slot(from);
    const v = this.slot(to);
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
      for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++)
        for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
          if (!this.grid.inBounds(x, y, z)) continue;
          const cur = this.grid.get(x, y, z);
          if (target === -1 ? cur !== AIR : cur === target) this.grid.set(x, y, z, v);
        }
    return this;
  }

  /**
   * Stepped gable roof whose ridge runs along x, over walls spanning x0..x1 and z0..z1.
   * The first layer sits at `yBase` and overhangs the walls by `overhang`. Each higher layer steps
   * one cell inward on both sides. The triangular gable ends above the walls are filled with
   * `gable`. Returns the y of the ridge.
   */
  gableRoofX(
    x0: number,
    x1: number,
    z0: number,
    z1: number,
    yBase: number,
    roof: Mat,
    opts: { overhang?: number; gable?: Mat; ridge?: Mat } = {},
  ): number {
    const o = opts.overhang ?? 1;
    let k = 0;
    for (; ; k++) {
      const zl = z0 - o + k;
      const zr = z1 + o - k;
      if (zl > zr) break;
      const y = yBase + k;
      const isRidge = zr - zl <= 1;
      const m = isRidge && opts.ridge ? opts.ridge : roof;
      this.fill(x0 - o, y, zl, x1 + o, y, zl, m);
      this.fill(x0 - o, y, zr, x1 + o, y, zr, m);
      if (opts.gable !== undefined && zl + 1 <= zr - 1) {
        const gz0 = Math.max(zl + 1, z0);
        const gz1 = Math.min(zr - 1, z1);
        if (gz0 <= gz1) {
          this.fill(x0, y, gz0, x0, y, gz1, opts.gable);
          this.fill(x1, y, gz0, x1, y, gz1, opts.gable);
        }
      }
    }
    return yBase + k - 1;
  }

  /** Calls `m` for every cell of the grid and writes the returned material (undefined leaves it). */
  paint(fn: (x: number, y: number, z: number) => Mat | undefined): this {
    const { x: sx, y: sy, z: sz } = this.size;
    for (let y = 0; y < sy; y++)
      for (let z = 0; z < sz; z++)
        for (let x = 0; x < sx; x++) {
          const m = fn(x, y, z);
          if (m !== undefined) this.grid.set(x, y, z, this.slot(m));
        }
    return this;
  }

  /** Normalized structure: cropped to its blocks, palette compacted. Throws when empty. */
  build(meta: BuildMeta): Structure {
    return normalizeStructure(
      createStructure({
        id: meta.id,
        name: meta.name,
        author: meta.author ?? '',
        voxels: this.grid,
        palette: this.palette,
        ...(meta.createdAt ? { createdAt: meta.createdAt } : {}),
        ...(meta.updatedAt ? { updatedAt: meta.updatedAt } : {}),
      }),
    );
  }
}
