import { raycastVoxels } from '../core/raycast';
import type { SolidMap } from './solids';

export interface Senses {
  /** How far the creature sees, in cells. */
  sight: number;
  /** Width of its field of view, in radians. */
  fov: number;
  /** Within this distance it notices others even through walls and behind it. */
  hearing: number;
  /** Height of its eyes above the cell it stands in. */
  eye: number;
}

/** Predators see far in a narrow cone; prey see nearly all around and hear what comes close. */
export const PREDATOR_SENSES: Senses = { sight: 24, fov: (120 * Math.PI) / 180, hearing: 2, eye: 1.4 };
export const PREY_SENSES: Senses = { sight: 16, fov: (300 * Math.PI) / 180, hearing: 4, eye: 0.5 };

/** Is there an unobstructed straight line between two points (no placed block in between)? */
export function lineOfSight(solids: SolidMap, ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 1e-6) return true;
  const hit = raycastVoxels({ origin: { x: ax, y: ay, z: az }, direction: { x: dx, y: dy, z: dz } }, dist, (x, y, z) => y >= 0 && solids.solid(x, y, z));
  return hit === null;
}

export interface Viewer {
  x: number;
  y: number;
  z: number;
  heading: number;
}

/** Difference between two angles, in [0, π]. */
export function angleBetween(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d < -Math.PI) d += Math.PI * 2;
  if (d > Math.PI) d -= Math.PI * 2;
  return Math.abs(d);
}

/**
 * Does `viewer` notice a target standing at (x, y, z)? Heard when close, otherwise seen when in
 * range, inside the field of view and in line of sight (eye to the target's middle).
 */
export function notices(solids: SolidMap, viewer: Viewer, senses: Senses, x: number, y: number, z: number, targetMiddle: number): boolean {
  const dx = x - viewer.x;
  const dz = z - viewer.z;
  const flat = Math.hypot(dx, dz);
  if (flat <= senses.hearing && Math.abs(y - viewer.y) <= 3) return true;
  if (flat > senses.sight) return false;
  if (flat > 1e-6 && angleBetween(Math.atan2(dx, dz), viewer.heading) > senses.fov / 2) return false;
  return lineOfSight(solids, viewer.x, viewer.y + senses.eye, viewer.z, x, y + targetMiddle, z);
}
