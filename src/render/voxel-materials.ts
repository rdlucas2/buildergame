import { DoubleSide, FrontSide, LineBasicMaterial, MeshBasicMaterial, MeshLambertMaterial } from 'three';

/** Shared materials for every voxel mesh. Vertex colours carry material colour and baked AO. */
export interface VoxelMaterials {
  opaque: MeshLambertMaterial;
  transparent: MeshLambertMaterial;
  ghostValid: MeshBasicMaterial;
  ghostInvalid: MeshBasicMaterial;
  ghostBlock: MeshBasicMaterial;
  outline: LineBasicMaterial;
  outlineHover: LineBasicMaterial;
  outlineBounds: LineBasicMaterial;
}

export function createVoxelMaterials(): VoxelMaterials {
  return {
    opaque: new MeshLambertMaterial({ vertexColors: true, side: FrontSide }),
    transparent: new MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false, side: DoubleSide }),
    ghostValid: new MeshBasicMaterial({ color: 0x3ddc84, transparent: true, opacity: 0.45, depthWrite: false }),
    ghostInvalid: new MeshBasicMaterial({ color: 0xff4d4d, transparent: true, opacity: 0.45, depthWrite: false }),
    ghostBlock: new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false }),
    outline: new LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.8 }),
    outlineHover: new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }),
    outlineBounds: new LineBasicMaterial({ color: 0x4aa3ff, transparent: true, opacity: 0.6 }),
  };
}

export function disposeVoxelMaterials(m: VoxelMaterials): void {
  for (const mat of Object.values(m)) mat.dispose();
}
