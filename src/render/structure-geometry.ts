import { BufferGeometry, Group, Mesh } from 'three';
import { rotationOffset, type Rotation } from '../core/rotation';
import type { Structure } from '../core/structure';
import type { Size3 } from '../core/voxel-grid';
import { meshDataToGeometry } from './geometry';
import { greedyMesh } from './greedy-mesh';
import { meshPaletteFromEntries } from './mesh-palette';
import type { VoxelMaterials } from './voxel-materials';

export interface StructureGeometry {
  opaque: BufferGeometry | null;
  transparent: BufferGeometry | null;
  size: Size3;
  quadCount: number;
}

/** Greedy-meshes a whole structure in local coordinates [0, size). */
export function buildStructureGeometry(s: Structure): StructureGeometry {
  const palette = meshPaletteFromEntries(s.palette);
  const region = { min: { x: 0, y: 0, z: 0 }, max: { ...s.voxels.size } };
  const opaque = greedyMesh(s.voxels, region, palette, { pass: 'opaque' });
  const transparent = greedyMesh(s.voxels, region, palette, { pass: 'transparent' });
  return {
    opaque: meshDataToGeometry(opaque),
    transparent: meshDataToGeometry(transparent),
    size: { ...s.voxels.size },
    quadCount: opaque.quadCount + transparent.quadCount,
  };
}

export function disposeStructureGeometry(g: StructureGeometry): void {
  g.opaque?.dispose();
  g.transparent?.dispose();
}

/**
 * One geometry per structure definition, shared by every placement of it. Rebuilt only when the
 * structure's `updatedAt` changes or `invalidate` is called.
 */
export class StructureGeometryCache {
  private readonly entries = new Map<string, { updatedAt: string; geometry: StructureGeometry }>();

  get(s: Structure): StructureGeometry {
    const cur = this.entries.get(s.id);
    if (cur && cur.updatedAt === s.updatedAt) return cur.geometry;
    if (cur) disposeStructureGeometry(cur.geometry);
    const geometry = buildStructureGeometry(s);
    this.entries.set(s.id, { updatedAt: s.updatedAt, geometry });
    return geometry;
  }

  invalidate(id: string): void {
    const cur = this.entries.get(id);
    if (!cur) return;
    disposeStructureGeometry(cur.geometry);
    this.entries.delete(id);
  }

  dispose(): void {
    for (const e of this.entries.values()) disposeStructureGeometry(e.geometry);
    this.entries.clear();
  }
}

/** Builds a renderable object for a structure geometry using the given materials. */
export function createStructureObject(
  g: StructureGeometry,
  materials: { opaque: Mesh['material']; transparent: Mesh['material'] },
): Group {
  const group = new Group();
  if (g.opaque) group.add(new Mesh(g.opaque, materials.opaque));
  if (g.transparent) {
    const m = new Mesh(g.transparent, materials.transparent);
    m.renderOrder = 10;
    group.add(m);
  }
  return group;
}

/** Positions an object built in structure-local space at a world placement. */
export function applyPlacementTransform(obj: Group, position: { x: number; y: number; z: number }, size: Size3, rotation: Rotation): void {
  const off = rotationOffset(size, rotation);
  obj.rotation.set(0, (rotation * Math.PI) / 2, 0);
  obj.position.set(position.x + off.x, position.y + off.y, position.z + off.z);
  obj.updateMatrixWorld();
}

