import { Group, InstancedMesh, Matrix4, Object3D, type BufferGeometry, type Material } from 'three';
import { rotationOffset } from '../core/rotation';
import type { Structure } from '../core/structure';
import type { Placement } from '../core/world';
import type { StructureGeometryCache } from './structure-geometry';
import type { VoxelMaterials } from './voxel-materials';

interface Batch {
  mesh: InstancedMesh;
  /** instance index → placement id */
  ids: string[];
}

interface StructureBatches {
  opaque: Batch | null;
  transparent: Batch | null;
}

const INITIAL_CAPACITY = 8;

/**
 * Draws every placement with one InstancedMesh per structure definition (per opaque/transparent
 * pass), so a world with thousands of copies of a few structures costs a handful of draw calls.
 */
export class PlacementRenderer {
  readonly group = new Group();
  private readonly batches = new Map<string, StructureBatches>();
  private readonly where = new Map<string, { structureId: string; index: number }>();
  private readonly tmp = new Object3D();
  private readonly tmpMatrix = new Matrix4();

  constructor(
    private readonly cache: StructureGeometryCache,
    private readonly materials: VoxelMaterials,
  ) {
    this.group.name = 'placements';
  }

  get count(): number {
    return this.where.size;
  }

  has(id: string): boolean {
    return this.where.has(id);
  }

  add(p: Placement, s: Structure): void {
    if (this.where.has(p.id)) this.remove(p.id);
    let sb = this.batches.get(s.id);
    if (!sb) {
      const g = this.cache.get(s);
      sb = {
        opaque: g.opaque ? this.createBatch(g.opaque, this.materials.opaque, 0) : null,
        transparent: g.transparent ? this.createBatch(g.transparent, this.materials.transparent, 10) : null,
      };
      this.batches.set(s.id, sb);
    }
    this.placementMatrix(p, s);
    let index = -1;
    for (const b of [sb.opaque, sb.transparent]) {
      if (!b) continue;
      const i = this.appendInstance(b, p.id, this.tmpMatrix, s.id);
      index = index < 0 ? i : index;
    }
    this.where.set(p.id, { structureId: s.id, index });
  }

  remove(id: string): boolean {
    const loc = this.where.get(id);
    if (!loc) return false;
    const sb = this.batches.get(loc.structureId);
    if (sb) {
      for (const b of [sb.opaque, sb.transparent]) if (b) this.removeInstance(b, loc.index);
    }
    this.where.delete(id);
    return true;
  }

  /** Drops the cached batch of a structure (after it was edited); callers re-add its placements. */
  invalidateStructure(structureId: string): string[] {
    const sb = this.batches.get(structureId);
    const ids = [...this.where.entries()].filter(([, l]) => l.structureId === structureId).map(([id]) => id);
    for (const id of ids) this.where.delete(id);
    if (sb) {
      for (const b of [sb.opaque, sb.transparent]) if (b) this.disposeBatch(b);
      this.batches.delete(structureId);
    }
    this.cache.invalidate(structureId);
    return ids;
  }

  clear(): void {
    for (const sb of this.batches.values()) for (const b of [sb.opaque, sb.transparent]) if (b) this.disposeBatch(b);
    this.batches.clear();
    this.where.clear();
  }

  dispose(): void {
    this.clear();
  }

  private placementMatrix(p: Placement, s: Structure): Matrix4 {
    const off = rotationOffset(s.voxels.size, p.rotation);
    this.tmp.rotation.set(0, (p.rotation * Math.PI) / 2, 0);
    this.tmp.position.set(p.position.x + off.x, p.position.y + off.y, p.position.z + off.z);
    this.tmp.updateMatrix();
    return this.tmpMatrix.copy(this.tmp.matrix);
  }

  private createBatch(geometry: BufferGeometry, material: Material, renderOrder: number): Batch {
    const mesh = new InstancedMesh(geometry, material, INITIAL_CAPACITY);
    mesh.count = 0;
    mesh.renderOrder = renderOrder;
    mesh.frustumCulled = false; // batches span the whole world; per-instance culling is not worth it
    this.group.add(mesh);
    return { mesh, ids: [] };
  }

  private appendInstance(b: Batch, id: string, matrix: Matrix4, structureId: string): number {
    if (b.mesh.count >= b.mesh.instanceMatrix.count) this.grow(b, structureId);
    const i = b.mesh.count;
    b.mesh.setMatrixAt(i, matrix);
    b.mesh.count = i + 1;
    b.mesh.instanceMatrix.needsUpdate = true;
    b.ids[i] = id;
    return i;
  }

  private removeInstance(b: Batch, index: number): void {
    const last = b.mesh.count - 1;
    if (index < 0 || index > last) return;
    if (index !== last) {
      b.mesh.getMatrixAt(last, this.tmpMatrix);
      b.mesh.setMatrixAt(index, this.tmpMatrix);
      const movedId = b.ids[last];
      b.ids[index] = movedId;
      const loc = this.where.get(movedId);
      if (loc) loc.index = index;
    }
    b.ids.length = last;
    b.mesh.count = last;
    b.mesh.instanceMatrix.needsUpdate = true;
  }

  private grow(b: Batch, structureId: string): void {
    const old = b.mesh;
    const mesh = new InstancedMesh(old.geometry, old.material, old.instanceMatrix.count * 2);
    for (let i = 0; i < old.count; i++) {
      old.getMatrixAt(i, this.tmpMatrix);
      mesh.setMatrixAt(i, this.tmpMatrix);
    }
    mesh.count = old.count;
    mesh.renderOrder = old.renderOrder;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.needsUpdate = true;
    this.group.remove(old);
    old.dispose(); // frees the instance buffer only; geometry belongs to the cache
    this.group.add(mesh);
    b.mesh = mesh;
    void structureId;
  }

  private disposeBatch(b: Batch): void {
    this.group.remove(b.mesh);
    b.mesh.dispose();
  }
}
