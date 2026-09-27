import type { AABB } from './math';
import { SpatialHash } from './spatial-hash';
import type { Structure } from './structure';
import { placementBounds, type Placement, type World } from './world';

export type StructureLookup = (structureId: string) => Structure | undefined;

/**
 * Fast lookups over a world's placements: by id, and by region via a spatial hash.
 * Kept in sync by the world mode whenever placements are added or removed.
 */
export class WorldIndex {
  private readonly placements = new Map<string, Placement>();
  readonly hash = new SpatialHash<string>(16);

  constructor(readonly getStructure: StructureLookup) {}

  load(world: World): void {
    this.clear();
    for (const p of world.placements) this.add(p);
  }

  clear(): void {
    this.placements.clear();
    this.hash.clear();
  }

  get size(): number {
    return this.placements.size;
  }

  get(id: string): Placement | undefined {
    return this.placements.get(id);
  }

  all(): Placement[] {
    return [...this.placements.values()];
  }

  /** Adds a placement to the index. Throws when its structure is unknown. */
  add(p: Placement): void {
    const s = this.getStructure(p.structureId);
    if (!s) throw new Error(`Unknown structure ${p.structureId} for placement ${p.id}`);
    this.placements.set(p.id, p);
    this.hash.insert(p.id, placementBounds(p.position, s.voxels.size, p.rotation));
  }

  remove(id: string): Placement | undefined {
    const p = this.placements.get(id);
    if (!p) return undefined;
    this.placements.delete(id);
    this.hash.remove(id);
    return p;
  }

  boundsOf(id: string): AABB | undefined {
    return this.hash.boundsOf(id);
  }

  /** Placements whose boxes may overlap `bounds` (broadphase). */
  query(bounds: AABB): Placement[] {
    const out: Placement[] = [];
    for (const id of this.hash.query(bounds)) {
      const p = this.placements.get(id);
      if (p) out.push(p);
    }
    return out;
  }

  /** Placements that occupy voxels whose structures are missing from the lookup (e.g. after a bad import). */
  orphaned(): Placement[] {
    return this.all().filter((p) => !this.getStructure(p.structureId));
  }
}
