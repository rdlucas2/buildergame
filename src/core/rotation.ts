import type { Vec3 } from './math';
import { VoxelGrid, type Size3 } from './voxel-grid';

/**
 * Structure rotation: number of 90° turns counter-clockwise around +Y (Three.js `rotation.y = r * PI/2`).
 * Rotating by 1 turn maps local +X toward -Z.
 */
export type Rotation = 0 | 1 | 2 | 3;

export const ROTATIONS: readonly Rotation[] = [0, 1, 2, 3];

export function normalizeRotation(r: number): Rotation {
  return ((((r | 0) % 4) + 4) % 4) as Rotation;
}

export function isRotation(r: unknown): r is Rotation {
  return r === 0 || r === 1 || r === 2 || r === 3;
}

/** Footprint of a structure after rotation (x and z swap for odd turns). */
export function rotatedSize(size: Size3, r: Rotation): Size3 {
  return r % 2 === 0 ? { x: size.x, y: size.y, z: size.z } : { x: size.z, y: size.y, z: size.x };
}

/**
 * Maps a voxel at (x, z) in the unrotated structure to its (x, z) in the rotated structure's own
 * min-corner frame (0..rotatedSize). This is the single source of truth for rotation; the mesh
 * transform (see `rotationOffset`) is derived to agree with it.
 */
export function rotateLocal(x: number, z: number, size: Size3, r: Rotation): [number, number] {
  switch (r) {
    case 0:
      return [x, z];
    case 1:
      return [z, size.x - 1 - x];
    case 2:
      return [size.x - 1 - x, size.z - 1 - z];
    case 3:
      return [size.z - 1 - z, x];
  }
}

/** Inverse of `rotateLocal`: rotated-frame (rx, rz) back to unrotated (x, z). */
export function unrotateLocal(rx: number, rz: number, size: Size3, r: Rotation): [number, number] {
  return rotateLocal(rx, rz, rotatedSize(size, r), normalizeRotation(4 - r));
}

/**
 * Translation to apply after `rotation.y = r * PI/2` so that geometry built in [0,size) lands with
 * its min corner at the origin.
 */
export function rotationOffset(size: Size3, r: Rotation): Vec3 {
  switch (r) {
    case 0:
      return { x: 0, y: 0, z: 0 };
    case 1:
      return { x: 0, y: 0, z: size.x };
    case 2:
      return { x: size.x, y: 0, z: size.z };
    case 3:
      return { x: size.z, y: 0, z: 0 };
  }
}

/** New grid holding `grid` rotated by `r` turns. */
export function rotateGrid(grid: VoxelGrid, r: Rotation): VoxelGrid {
  if (r === 0) return grid.clone();
  const out = new VoxelGrid(rotatedSize(grid.size, r));
  grid.forEachSolid((x, y, z, v) => {
    const [rx, rz] = rotateLocal(x, z, grid.size, r);
    out.set(rx, y, rz, v);
  });
  return out;
}
