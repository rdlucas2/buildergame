import { isShore, type Terrain } from './terrain';

const BUCKET = 32;

/**
 * Every dry cell next to water, bucketed on a coarse grid so "where is the nearest place to
 * drink?" only looks at nearby buckets.
 */
export class ShoreIndex {
  private readonly buckets = new Map<number, Int32Array>();
  readonly count: number;

  constructor(terrain: Terrain) {
    const lists = new Map<number, number[]>();
    let n = 0;
    const { half } = terrain;
    for (let z = -half; z < half; z++) {
      for (let x = -half; x < half; x++) {
        if (!isShore(terrain, x, z)) continue;
        const k = this.bucketKey(Math.floor(x / BUCKET), Math.floor(z / BUCKET));
        let list = lists.get(k);
        if (!list) lists.set(k, (list = []));
        list.push(x, z);
        n++;
      }
    }
    for (const [k, list] of lists) this.buckets.set(k, Int32Array.from(list));
    this.count = n;
  }

  /** Nearest shore cell to (x, z) within `maxRadius` cells, skipping cells `accept` rejects. */
  nearest(x: number, z: number, maxRadius = 128, accept?: (sx: number, sz: number) => boolean): { x: number; z: number } | null {
    const bx = Math.floor(x / BUCKET);
    const bz = Math.floor(z / BUCKET);
    const rings = Math.ceil(maxRadius / BUCKET) + 1;
    let best: { x: number; z: number } | null = null;
    let bestD = Infinity;
    for (let r = 0; r <= rings; r++) {
      // Once a hit is closer than anything the next ring could hold, stop.
      if (best && bestD <= ((r - 1) * BUCKET) ** 2) break;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const list = this.buckets.get(this.bucketKey(bx + dx, bz + dz));
          if (!list) continue;
          for (let i = 0; i < list.length; i += 2) {
            const sx = list[i], sz = list[i + 1];
            const d = (sx - x) ** 2 + (sz - z) ** 2;
            if (d < bestD && d <= maxRadius * maxRadius && (!accept || accept(sx, sz))) {
              bestD = d;
              best = { x: sx, z: sz };
            }
          }
        }
      }
    }
    return best;
  }

  private bucketKey(bx: number, bz: number): number {
    return (bx + 1024) * 4096 + (bz + 1024);
  }
}
