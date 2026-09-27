/** Integer 3-D vector. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type Vec3Tuple = [number, number, number];

/** Axis-aligned box over integer voxel coordinates. `min` inclusive, `max` exclusive. */
export interface AABB {
  min: Vec3;
  max: Vec3;
}

export function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

export function vec3FromTuple(t: Vec3Tuple): Vec3 {
  return { x: t[0], y: t[1], z: t[2] };
}

export function vec3ToTuple(v: Vec3): Vec3Tuple {
  return [v.x, v.y, v.z];
}

export function vec3Add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function vec3Sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function vec3Equals(a: Vec3, b: Vec3): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

export function aabb(min: Vec3, max: Vec3): AABB {
  return { min: { ...min }, max: { ...max } };
}

/** Box whose min corner is `pos` and whose extent is `size` (all axes exclusive at max). */
export function aabbFromPosSize(pos: Vec3, size: Vec3): AABB {
  return { min: { ...pos }, max: { x: pos.x + size.x, y: pos.y + size.y, z: pos.z + size.z } };
}

export function aabbSize(b: AABB): Vec3 {
  return { x: b.max.x - b.min.x, y: b.max.y - b.min.y, z: b.max.z - b.min.z };
}

export function aabbVolume(b: AABB): number {
  const s = aabbSize(b);
  return Math.max(0, s.x) * Math.max(0, s.y) * Math.max(0, s.z);
}

/** True when the two half-open boxes share at least one voxel. Touching faces do not intersect. */
export function aabbIntersects(a: AABB, b: AABB): boolean {
  return (
    a.min.x < b.max.x &&
    b.min.x < a.max.x &&
    a.min.y < b.max.y &&
    b.min.y < a.max.y &&
    a.min.z < b.max.z &&
    b.min.z < a.max.z
  );
}

/** Overlapping region of two boxes, or null when they do not intersect. */
export function aabbIntersection(a: AABB, b: AABB): AABB | null {
  if (!aabbIntersects(a, b)) return null;
  return {
    min: { x: Math.max(a.min.x, b.min.x), y: Math.max(a.min.y, b.min.y), z: Math.max(a.min.z, b.min.z) },
    max: { x: Math.min(a.max.x, b.max.x), y: Math.min(a.max.y, b.max.y), z: Math.min(a.max.z, b.max.z) },
  };
}

export function aabbContainsPoint(b: AABB, p: Vec3): boolean {
  return p.x >= b.min.x && p.x < b.max.x && p.y >= b.min.y && p.y < b.max.y && p.z >= b.min.z && p.z < b.max.z;
}

export function aabbContainsAABB(outer: AABB, inner: AABB): boolean {
  return (
    inner.min.x >= outer.min.x &&
    inner.min.y >= outer.min.y &&
    inner.min.z >= outer.min.z &&
    inner.max.x <= outer.max.x &&
    inner.max.y <= outer.max.y &&
    inner.max.z <= outer.max.z
  );
}

export function aabbEquals(a: AABB, b: AABB): boolean {
  return vec3Equals(a.min, b.min) && vec3Equals(a.max, b.max);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Floor division that behaves for negative numbers (used for spatial-hash cells). */
export function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}
