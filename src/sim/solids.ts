import type { AABB } from '../core/math';
import type { Structure } from '../core/structure';
import { placementVoxelAt, type Placement } from '../core/world';
import { WorldIndex } from '../core/world-index';

const CHUNK = 16;

interface Chunk {
  /** Height of the tallest placement overlapping the chunk (cells at or above are air). */
  height: number;
  /** 1 where a placed block is solid; index x + 16 * (z + 16 * y) in chunk-local coordinates. */
  bits: Uint8Array;
}

function chunkKey(cx: number, cz: number): number {
  return (cx + 32768) * 65536 + (cz + 32768);
}

/**
 * Which world voxels are solid, for creatures: the ground below y = 0 plus every placed block.
 * Built lazily in 16×16 column chunks from the placements and invalidated only where placements
 * change, so movement queries stay cheap even with thousands of structures.
 */
export class SolidMap {
  readonly index: WorldIndex;
  private readonly chunks = new Map<number, Chunk>();

  constructor(lookup: (id: string) => Structure | undefined) {
    this.index = new WorldIndex(lookup);
  }

  reset(placements: readonly Placement[]): void {
    this.index.clear();
    this.chunks.clear();
    for (const p of placements) if (this.index.getStructure(p.structureId)) this.index.add(p);
  }

  add(p: Placement): void {
    if (!this.index.getStructure(p.structureId)) return;
    this.index.add(p);
    this.invalidate(this.index.boundsOf(p.id));
  }

  remove(id: string): void {
    const b = this.index.boundsOf(id);
    this.index.remove(id);
    this.invalidate(b);
  }

  /** True for the ground (y < 0) and for any placed block. */
  solid(x: number, y: number, z: number): boolean {
    if (y < 0) return true;
    const c = this.chunk(Math.floor(x / CHUNK), Math.floor(z / CHUNK));
    if (y >= c.height) return false;
    const lx = x - Math.floor(x / CHUNK) * CHUNK;
    const lz = z - Math.floor(z / CHUNK) * CHUNK;
    return c.bits[lx + CHUNK * (lz + CHUNK * y)] === 1;
  }

  /** True when no placement reaches into the column (x, z) at all: plain open ground. */
  openColumn(x: number, z: number): boolean {
    const c = this.chunk(Math.floor(x / CHUNK), Math.floor(z / CHUNK));
    if (c.height === 0) return true;
    const lx = x - Math.floor(x / CHUNK) * CHUNK;
    const lz = z - Math.floor(z / CHUNK) * CHUNK;
    for (let y = 0; y < c.height; y++) if (c.bits[lx + CHUNK * (lz + CHUNK * y)]) return false;
    return true;
  }


  private invalidate(b: AABB | undefined): void {
    if (!b) return;
    for (let cz = Math.floor(b.min.z / CHUNK); cz <= Math.floor((b.max.z - 1) / CHUNK); cz++)
      for (let cx = Math.floor(b.min.x / CHUNK); cx <= Math.floor((b.max.x - 1) / CHUNK); cx++) this.chunks.delete(chunkKey(cx, cz));
  }

  private chunk(cx: number, cz: number): Chunk {
    const key = chunkKey(cx, cz);
    let c = this.chunks.get(key);
    if (c) return c;
    const x0 = cx * CHUNK;
    const z0 = cz * CHUNK;
    const region: AABB = { min: { x: x0, y: 0, z: z0 }, max: { x: x0 + CHUNK, y: 1 << 20, z: z0 + CHUNK } };
    const hits = this.index.query(region);
    let height = 0;
    for (const p of hits) {
      const b = this.index.boundsOf(p.id);
      if (b && b.min.x < x0 + CHUNK && b.max.x > x0 && b.min.z < z0 + CHUNK && b.max.z > z0) height = Math.max(height, b.max.y);
    }
    const bits = new Uint8Array(CHUNK * CHUNK * Math.max(1, height));
    for (const p of hits) {
      const s = this.index.getStructure(p.structureId);
      const b = this.index.boundsOf(p.id);
      if (!s || !b) continue;
      const xa = Math.max(x0, b.min.x), xb = Math.min(x0 + CHUNK, b.max.x);
      const za = Math.max(z0, b.min.z), zb = Math.min(z0 + CHUNK, b.max.z);
      for (let y = Math.max(0, b.min.y); y < b.max.y; y++)
        for (let z = za; z < zb; z++)
          for (let x = xa; x < xb; x++) if (placementVoxelAt(s, p, x, y, z) !== 0) bits[x - x0 + CHUNK * (z - z0 + CHUNK * y)] = 1;
    }
    c = { height, bits };
    this.chunks.set(key, c);
    return c;
  }
}
