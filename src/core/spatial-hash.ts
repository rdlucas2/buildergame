import { floorDiv, type AABB, type Vec3 } from './math';

const BITS = 17; // per axis → cells in ±65536; with cellSize 16 that is ±1M voxels
const OFFSET = 1 << (BITS - 1);
const MASK = (1 << BITS) - 1;

function packCell(cx: number, cy: number, cz: number): number {
  // Non-overlapping bit ranges; 3 * 17 = 51 bits fits in a double's exact-integer range.
  return ((cx + OFFSET) & MASK) * 2 ** (2 * BITS) + ((cy + OFFSET) & MASK) * 2 ** BITS + ((cz + OFFSET) & MASK);
}

/**
 * Uniform-grid spatial hash over integer AABBs. Each key is registered in every cell its box
 * overlaps, so a query touches only the cells under the query box regardless of world size.
 */
export class SpatialHash<K = string> {
  readonly cellSize: number;
  private readonly cells = new Map<number, Set<K>>();
  private readonly boxes = new Map<K, AABB>();

  constructor(cellSize = 16) {
    if (!(cellSize > 0)) throw new Error('cellSize must be positive');
    this.cellSize = cellSize;
  }

  get size(): number {
    return this.boxes.size;
  }

  has(key: K): boolean {
    return this.boxes.has(key);
  }

  boundsOf(key: K): AABB | undefined {
    return this.boxes.get(key);
  }

  insert(key: K, bounds: AABB): void {
    if (this.boxes.has(key)) this.remove(key);
    const copy: AABB = { min: { ...bounds.min }, max: { ...bounds.max } };
    this.boxes.set(key, copy);
    this.forEachCell(copy, (c) => {
      let set = this.cells.get(c);
      if (!set) {
        set = new Set();
        this.cells.set(c, set);
      }
      set.add(key);
    });
  }

  remove(key: K): boolean {
    const b = this.boxes.get(key);
    if (!b) return false;
    this.boxes.delete(key);
    this.forEachCell(b, (c) => {
      const set = this.cells.get(c);
      if (!set) return;
      set.delete(key);
      if (set.size === 0) this.cells.delete(c);
    });
    return true;
  }

  clear(): void {
    this.cells.clear();
    this.boxes.clear();
  }

  /** Keys whose cells overlap `bounds`. Candidates only: callers must still test the boxes. */
  query(bounds: AABB): K[] {
    const out = new Set<K>();
    this.forEachCell(bounds, (c) => {
      const set = this.cells.get(c);
      if (set) for (const k of set) out.add(k);
    });
    return [...out];
  }

  queryPoint(p: Vec3): K[] {
    return this.query({ min: p, max: { x: p.x + 1, y: p.y + 1, z: p.z + 1 } });
  }

  private forEachCell(b: AABB, cb: (cell: number) => void): void {
    const s = this.cellSize;
    // max is exclusive, so the last occupied voxel is max - 1.
    const x0 = floorDiv(b.min.x, s), x1 = floorDiv(b.max.x - 1, s);
    const y0 = floorDiv(b.min.y, s), y1 = floorDiv(b.max.y - 1, s);
    const z0 = floorDiv(b.min.z, s), z1 = floorDiv(b.max.z - 1, s);
    if (x1 < x0 || y1 < y0 || z1 < z0) return; // empty box
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) cb(packCell(x, y, z));
  }
}
