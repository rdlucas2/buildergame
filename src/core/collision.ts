import { aabbContainsAABB, aabbIntersection, aabbIntersects, type AABB, type Vec3 } from './math';
import type { Rotation } from './rotation';
import type { Structure } from './structure';
import { placementBounds, placementVoxelAt, type Placement } from './world';
import type { WorldIndex } from './world-index';

export type CollisionMode = 'voxel' | 'aabb';

export interface CollisionOptions {
  /** 'voxel' (default) only rejects when solid blocks overlap; 'aabb' rejects any bounding-box overlap. */
  mode?: CollisionMode;
  /** Placements to ignore, e.g. the one being moved. */
  ignoreIds?: ReadonlySet<string>;
  /** Optional world limits; placements must fit entirely inside. */
  worldBounds?: AABB;
}

export type PlacementRejection = 'below-ground' | 'out-of-bounds' | 'overlap';

export interface PlacementCheck {
  ok: boolean;
  reason?: PlacementRejection;
  /** Ids of placements that block this one (only for reason 'overlap'). */
  collidingIds: string[];
  bounds: AABB;
}

/**
 * Decides whether `structure` may be placed at `position` with `rotation`.
 * Broadphase: spatial hash + AABB. Narrow phase (voxel mode): only the overlapping region is scanned.
 */
export function checkPlacement(
  index: WorldIndex,
  structure: Structure,
  position: Vec3,
  rotation: Rotation,
  opts: CollisionOptions = {},
): PlacementCheck {
  const mode = opts.mode ?? 'voxel';
  const bounds = placementBounds(position, structure.voxels.size, rotation);

  if (bounds.min.y < 0) return { ok: false, reason: 'below-ground', collidingIds: [], bounds };
  if (opts.worldBounds && !aabbContainsAABB(opts.worldBounds, bounds)) {
    return { ok: false, reason: 'out-of-bounds', collidingIds: [], bounds };
  }

  const candidate: Placement = { id: '__candidate__', structureId: structure.id, position, rotation };
  const collidingIds: string[] = [];

  for (const other of index.query(bounds)) {
    if (opts.ignoreIds?.has(other.id)) continue;
    const otherStructure = index.getStructure(other.structureId);
    if (!otherStructure) continue;
    const otherBounds = placementBounds(other.position, otherStructure.voxels.size, other.rotation);
    if (!aabbIntersects(bounds, otherBounds)) continue;
    if (mode === 'aabb') {
      collidingIds.push(other.id);
      continue;
    }
    const region = aabbIntersection(bounds, otherBounds);
    if (region && voxelsOverlap(structure, candidate, otherStructure, other, region)) collidingIds.push(other.id);
  }

  if (collidingIds.length > 0) return { ok: false, reason: 'overlap', collidingIds, bounds };
  return { ok: true, collidingIds, bounds };
}

/** True when both placements have a solid voxel at the same world position inside `region`. */
export function voxelsOverlap(sa: Structure, pa: Placement, sb: Structure, pb: Placement, region: AABB): boolean {
  for (let y = region.min.y; y < region.max.y; y++) {
    for (let z = region.min.z; z < region.max.z; z++) {
      for (let x = region.min.x; x < region.max.x; x++) {
        if (placementVoxelAt(sa, pa, x, y, z) !== 0 && placementVoxelAt(sb, pb, x, y, z) !== 0) return true;
      }
    }
  }
  return false;
}
