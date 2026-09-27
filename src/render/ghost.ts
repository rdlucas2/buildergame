import { Group, Mesh, type BufferGeometry } from 'three';
import type { Rotation } from '../core/rotation';
import type { Size3 } from '../core/voxel-grid';
import { applyPlacementTransform, type StructureGeometry } from './structure-geometry';
import type { VoxelMaterials } from './voxel-materials';

/** Translucent preview of a structure at a candidate placement, tinted by validity. */
export class GhostPreview {
  readonly group = new Group();
  private meshes: Mesh[] = [];
  private size: Size3 = { x: 1, y: 1, z: 1 };
  private valid = true;

  constructor(private readonly materials: VoxelMaterials) {
    this.group.visible = false;
    this.group.renderOrder = 15;
  }

  setGeometry(g: StructureGeometry): void {
    this.clearMeshes();
    this.size = { ...g.size };
    const geoms: BufferGeometry[] = [];
    if (g.opaque) geoms.push(g.opaque);
    if (g.transparent) geoms.push(g.transparent);
    for (const geom of geoms) {
      const m = new Mesh(geom, this.currentMaterial());
      m.renderOrder = 15;
      this.meshes.push(m);
      this.group.add(m);
    }
  }

  setValid(valid: boolean): void {
    if (this.valid === valid) return;
    this.valid = valid;
    for (const m of this.meshes) m.material = this.currentMaterial();
  }

  setTransform(position: { x: number; y: number; z: number }, rotation: Rotation): void {
    applyPlacementTransform(this.group, position, this.size, rotation);
    this.group.visible = true;
  }

  hide(): void {
    this.group.visible = false;
  }

  get visible(): boolean {
    return this.group.visible;
  }

  private currentMaterial() {
    return this.valid ? this.materials.ghostValid : this.materials.ghostInvalid;
  }

  private clearMeshes(): void {
    for (const m of this.meshes) this.group.remove(m); // geometry is owned by the cache
    this.meshes = [];
  }

  dispose(): void {
    this.clearMeshes();
  }
}
