import { Group, Mesh } from 'three';
import type { VoxelGrid } from '../core/voxel-grid';
import { meshDataToGeometry } from './geometry';
import { greedyMesh, type MeshPalette } from './greedy-mesh';
import type { VoxelMaterials } from './voxel-materials';

interface ChunkMeshes {
  opaque: Mesh | null;
  transparent: Mesh | null;
}

/**
 * Renders an editable VoxelGrid as independent 16³ chunk meshes, so a single block edit only
 * rebuilds the chunk it touches (plus a neighbour when the block sits on a chunk border).
 */
export class ChunkedGridMesh {
  readonly group = new Group();
  private grid: VoxelGrid;
  private palette: MeshPalette;
  private readonly chunks = new Map<number, ChunkMeshes>();
  private readonly dirty = new Set<number>();

  constructor(
    grid: VoxelGrid,
    palette: MeshPalette,
    private readonly materials: VoxelMaterials,
    readonly chunkSize = 16,
  ) {
    this.grid = grid;
    this.palette = palette;
    this.group.name = 'chunked-grid';
    this.markAll();
  }

  get currentGrid(): VoxelGrid {
    return this.grid;
  }

  setGrid(grid: VoxelGrid, palette: MeshPalette = this.palette): void {
    this.grid = grid;
    this.palette = palette;
    this.disposeChunks();
    this.markAll();
  }

  setPalette(palette: MeshPalette): void {
    this.palette = palette;
    this.markAll();
  }

  /** Marks the chunk containing a voxel dirty, and neighbours if the voxel lies on a chunk face. */
  markVoxel(x: number, y: number, z: number): void {
    const s = this.chunkSize;
    const cx = Math.floor(x / s), cy = Math.floor(y / s), cz = Math.floor(z / s);
    const counts = this.chunkCounts();
    const mark = (a: number, b: number, c: number) => {
      if (a < 0 || b < 0 || c < 0 || a >= counts.x || b >= counts.y || c >= counts.z) return;
      this.dirty.add(this.key(a, b, c));
    };
    mark(cx, cy, cz);
    if (x % s === 0) mark(cx - 1, cy, cz);
    if (x % s === s - 1) mark(cx + 1, cy, cz);
    if (y % s === 0) mark(cx, cy - 1, cz);
    if (y % s === s - 1) mark(cx, cy + 1, cz);
    if (z % s === 0) mark(cx, cy, cz - 1);
    if (z % s === s - 1) mark(cx, cy, cz + 1);
  }

  markAll(): void {
    const c = this.chunkCounts();
    for (let x = 0; x < c.x; x++) for (let y = 0; y < c.y; y++) for (let z = 0; z < c.z; z++) this.dirty.add(this.key(x, y, z));
  }

  get pendingChunks(): number {
    return this.dirty.size;
  }

  /** Rebuilds every dirty chunk. Call once per frame (or after a batch of edits). */
  update(): number {
    if (this.dirty.size === 0) return 0;
    const s = this.chunkSize;
    const counts = this.chunkCounts();
    let rebuilt = 0;
    for (const key of this.dirty) {
      const cz = Math.floor(key / (counts.x * counts.y));
      const cy = Math.floor((key - cz * counts.x * counts.y) / counts.x);
      const cx = key - cz * counts.x * counts.y - cy * counts.x;
      this.rebuildChunk(key, {
        min: { x: cx * s, y: cy * s, z: cz * s },
        max: {
          x: Math.min((cx + 1) * s, this.grid.size.x),
          y: Math.min((cy + 1) * s, this.grid.size.y),
          z: Math.min((cz + 1) * s, this.grid.size.z),
        },
      });
      rebuilt++;
    }
    this.dirty.clear();
    return rebuilt;
  }

  dispose(): void {
    this.disposeChunks();
    this.dirty.clear();
  }

  private chunkCounts(): { x: number; y: number; z: number } {
    const s = this.chunkSize;
    return { x: Math.ceil(this.grid.size.x / s), y: Math.ceil(this.grid.size.y / s), z: Math.ceil(this.grid.size.z / s) };
  }

  private key(cx: number, cy: number, cz: number): number {
    const c = this.chunkCounts();
    return cx + c.x * (cy + c.y * cz);
  }

  private rebuildChunk(key: number, region: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }): void {
    const existing = this.chunks.get(key);
    if (existing) this.disposeChunk(existing);
    const opaqueGeom = meshDataToGeometry(greedyMesh(this.grid, region, this.palette, { pass: 'opaque' }));
    const transparentGeom = meshDataToGeometry(greedyMesh(this.grid, region, this.palette, { pass: 'transparent' }));
    const entry: ChunkMeshes = { opaque: null, transparent: null };
    if (opaqueGeom) {
      entry.opaque = new Mesh(opaqueGeom, this.materials.opaque);
      this.group.add(entry.opaque);
    }
    if (transparentGeom) {
      entry.transparent = new Mesh(transparentGeom, this.materials.transparent);
      entry.transparent.renderOrder = 10;
      this.group.add(entry.transparent);
    }
    if (entry.opaque || entry.transparent) this.chunks.set(key, entry);
    else this.chunks.delete(key);
  }

  private disposeChunk(c: ChunkMeshes): void {
    for (const m of [c.opaque, c.transparent]) {
      if (!m) continue;
      this.group.remove(m);
      m.geometry.dispose();
    }
  }

  private disposeChunks(): void {
    for (const c of this.chunks.values()) this.disposeChunk(c);
    this.chunks.clear();
  }
}
