import type { Vec3 } from './math';

export interface Ray {
  origin: { x: number; y: number; z: number };
  /** Need not be normalised. */
  direction: { x: number; y: number; z: number };
}

export interface VoxelHit {
  /** The solid voxel that was hit. */
  voxel: Vec3;
  /** Unit axis normal of the face entered; all zeros when the origin starts inside a solid voxel. */
  normal: Vec3;
  /** Distance along the (normalised) ray. */
  distance: number;
}

/**
 * Voxel traversal (Amanatides & Woo). Steps through every voxel the ray passes and returns the first
 * one for which `isSolid` is true, up to `maxDistance` world units.
 */
export function raycastVoxels(
  ray: Ray,
  maxDistance: number,
  isSolid: (x: number, y: number, z: number) => boolean,
): VoxelHit | null {
  const { origin } = ray;
  const len = Math.hypot(ray.direction.x, ray.direction.y, ray.direction.z);
  if (!(len > 0)) return null;
  const dx = ray.direction.x / len;
  const dy = ray.direction.y / len;
  const dz = ray.direction.z / len;

  let x = Math.floor(origin.x);
  let y = Math.floor(origin.y);
  let z = Math.floor(origin.z);

  if (isSolid(x, y, z)) return { voxel: { x, y, z }, normal: { x: 0, y: 0, z: 0 }, distance: 0 };

  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;

  const tDeltaX = stepX !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dz) : Infinity;

  let tMaxX = stepX !== 0 ? ((stepX > 0 ? x + 1 - origin.x : origin.x - x) * tDeltaX) : Infinity;
  let tMaxY = stepY !== 0 ? ((stepY > 0 ? y + 1 - origin.y : origin.y - y) * tDeltaY) : Infinity;
  let tMaxZ = stepZ !== 0 ? ((stepZ > 0 ? z + 1 - origin.z : origin.z - z) * tDeltaZ) : Infinity;

  let t = 0;
  // Guard against pathological loops; each iteration advances at least one voxel.
  const maxSteps = Math.ceil(maxDistance) * 3 + 8;
  for (let i = 0; i < maxSteps; i++) {
    let nx = 0, ny = 0, nz = 0;
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX; t = tMaxX; tMaxX += tDeltaX; nx = -stepX;
    } else if (tMaxY < tMaxZ) {
      y += stepY; t = tMaxY; tMaxY += tDeltaY; ny = -stepY;
    } else {
      z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; nz = -stepZ;
    }
    if (t > maxDistance) return null;
    if (isSolid(x, y, z)) return { voxel: { x, y, z }, normal: { x: nx, y: ny, z: nz }, distance: t };
  }
  return null;
}

/** Distance along a normalised ray to the horizontal plane y = planeY, or null when parallel/behind. */
export function rayPlaneY(ray: Ray, planeY: number): number | null {
  const len = Math.hypot(ray.direction.x, ray.direction.y, ray.direction.z);
  if (!(len > 0)) return null;
  const dy = ray.direction.y / len;
  if (Math.abs(dy) < 1e-9) return null;
  const t = (planeY - ray.origin.y) / dy;
  return t >= 0 ? t : null;
}
