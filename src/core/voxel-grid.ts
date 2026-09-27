import type { AABB, Vec3 } from './math';

export interface Size3 {
  x: number;
  y: number;
  z: number;
}

/** Value stored for empty space. */
export const AIR = 0;

/**
 * Dense 3-D grid of 16-bit values. 0 is air; any other value is a slot into the owner's palette.
 *
 * Memory order is "xzy": x varies fastest, then z, then y.
 *   index = x + size.x * (z + size.z * y)
 * This is the order used by the structure file format, so encoding is a straight copy.
 */
export class VoxelGrid {
  readonly size: Size3;
  readonly data: Uint16Array;

  constructor(size: Size3, data?: Uint16Array) {
    if (!Number.isInteger(size.x) || !Number.isInteger(size.y) || !Number.isInteger(size.z)) {
      throw new Error('VoxelGrid size must be integers');
    }
    if (size.x < 0 || size.y < 0 || size.z < 0) throw new Error('VoxelGrid size must be non-negative');
    const length = size.x * size.y * size.z;
    if (data && data.length !== length) {
      throw new Error(`VoxelGrid data length ${data.length} does not match size ${length}`);
    }
    this.size = { x: size.x, y: size.y, z: size.z };
    this.data = data ?? new Uint16Array(length);
  }

  get length(): number {
    return this.data.length;
  }

  index(x: number, y: number, z: number): number {
    return x + this.size.x * (z + this.size.z * y);
  }

  inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < this.size.x && y < this.size.y && z < this.size.z;
  }

  /** Returns AIR for out-of-bounds coordinates so callers can sample freely. */
  get(x: number, y: number, z: number): number {
    if (!this.inBounds(x, y, z)) return AIR;
    return this.data[this.index(x, y, z)];
  }

  /** Returns false (and does nothing) when out of bounds. */
  set(x: number, y: number, z: number, value: number): boolean {
    if (!this.inBounds(x, y, z)) return false;
    this.data[this.index(x, y, z)] = value;
    return true;
  }

  fill(value: number): void {
    this.data.fill(value);
  }

  clear(): void {
    this.data.fill(AIR);
  }

  /** Number of non-air voxels. */
  count(): number {
    let n = 0;
    const d = this.data;
    for (let i = 0; i < d.length; i++) if (d[i] !== AIR) n++;
    return n;
  }

  isEmpty(): boolean {
    const d = this.data;
    for (let i = 0; i < d.length; i++) if (d[i] !== AIR) return false;
    return true;
  }

  forEachSolid(cb: (x: number, y: number, z: number, value: number) => void): void {
    const { x: sx, y: sy, z: sz } = this.size;
    let i = 0;
    for (let y = 0; y < sy; y++) {
      for (let z = 0; z < sz; z++) {
        for (let x = 0; x < sx; x++, i++) {
          const v = this.data[i];
          if (v !== AIR) cb(x, y, z, v);
        }
      }
    }
  }

  /** Smallest half-open box containing every solid voxel, or null when the grid is empty. */
  tightBounds(): AABB | null {
    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity;
    this.forEachSolid((x, y, z) => {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    });
    if (minX === Infinity) return null;
    return { min: { x: minX, y: minY, z: minZ }, max: { x: maxX + 1, y: maxY + 1, z: maxZ + 1 } };
  }

  /** Copy of the voxels inside `bounds` (half-open) as a new grid with its own origin. */
  crop(bounds: AABB): VoxelGrid {
    const size = {
      x: Math.max(0, bounds.max.x - bounds.min.x),
      y: Math.max(0, bounds.max.y - bounds.min.y),
      z: Math.max(0, bounds.max.z - bounds.min.z),
    };
    const out = new VoxelGrid(size);
    for (let y = 0; y < size.y; y++) {
      for (let z = 0; z < size.z; z++) {
        const srcRow = this.index(bounds.min.x, bounds.min.y + y, bounds.min.z + z);
        const dstRow = out.index(0, y, z);
        for (let x = 0; x < size.x; x++) {
          const sx = bounds.min.x + x;
          const sy = bounds.min.y + y;
          const sz = bounds.min.z + z;
          out.data[dstRow + x] = this.inBounds(sx, sy, sz) ? this.data[srcRow + x] : AIR;
        }
      }
    }
    return out;
  }

  /** Copy of this grid's contents into a new grid of a different size (extra space is air). */
  resized(size: Size3, offset: Vec3 = { x: 0, y: 0, z: 0 }): VoxelGrid {
    const out = new VoxelGrid(size);
    this.forEachSolid((x, y, z, v) => {
      out.set(x + offset.x, y + offset.y, z + offset.z, v);
    });
    return out;
  }

  clone(): VoxelGrid {
    return new VoxelGrid(this.size, new Uint16Array(this.data));
  }

  /** Remaps every value through `map` (values missing from the map are left unchanged). */
  remap(map: ReadonlyMap<number, number>): void {
    const d = this.data;
    for (let i = 0; i < d.length; i++) {
      const m = map.get(d[i]);
      if (m !== undefined) d[i] = m;
    }
  }

  static equals(a: VoxelGrid, b: VoxelGrid): boolean {
    if (a.size.x !== b.size.x || a.size.y !== b.size.y || a.size.z !== b.size.z) return false;
    const da = a.data;
    const db = b.data;
    for (let i = 0; i < da.length; i++) if (da[i] !== db[i]) return false;
    return true;
  }
}
