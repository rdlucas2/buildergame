import { newId, nowIso } from './ids';
import { aabbFromPosSize, type AABB, type Vec3, type Vec3Tuple } from './math';
import { rotatedSize, unrotateLocal, type Rotation } from './rotation';
import type { Structure } from './structure';
import type { Size3 } from './voxel-grid';

/** One instance of a structure inside a world. `position` is the min corner of its rotated footprint. */
export interface Placement {
  id: string;
  structureId: string;
  position: Vec3;
  rotation: Rotation;
}

export interface GroundSettings {
  material: string;
  /** Edge length of the square ground plane in voxels, centred on the origin. */
  size: number;
}

export interface Spawn {
  position: Vec3Tuple;
  yaw: number;
  pitch: number;
}

/**
 * State of a wild world's ecosystem. Terrain is regenerated from `seed`; `time` is simulation seconds
 * since the world began (0 is midnight of day 1); `biomass` is grass per ground cell (0..255).
 */
export interface EcosystemState {
  seed: number;
  time: number;
  biomass?: Uint8Array;
  creatures?: CreatureState[];
  /** Next id to hand out to a newborn creature. */
  nextCreatureId?: number;
  /** State of the simulation's random stream, so a reloaded world continues deterministically. */
  rng?: number;
  /** Population samples over time: [time, prey, predators]. */
  history?: Array<[number, number, number]>;
  /** Running totals of births and deaths by cause. */
  tally?: Record<string, number>;
}

export type CreatureSpecies = 'prey' | 'predator';

/** The saved state of one living creature (behaviour and paths are recomputed on load). */
export interface CreatureState {
  id: number;
  species: CreatureSpecies;
  x: number;
  y: number;
  z: number;
  heading: number;
  satiety: number;
  hydration: number;
  energy: number;
  health: number;
  age: number;
  cooldown: number;
}

/** A player's world: metadata plus where each structure instance sits. */
export interface World {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  ground: GroundSettings;
  spawn: Spawn;
  placements: Placement[];
  /** Present only for wild worlds (chosen when the world is created). */
  ecosystem?: EcosystemState;
}

/** Reference to a structure file as listed in a world file. */
export interface StructureRef {
  id: string;
  name: string;
  file: string;
}

export const DEFAULT_GROUND: GroundSettings = { material: 'grass', size: 1024 };
export const DEFAULT_SPAWN: Spawn = { position: [0, 4, 12], yaw: 0, pitch: -0.15 };

/** Where players start in a wild world: high enough to see the land and the nearest pond. */
export const WILD_SPAWN: Spawn = { position: [0, 26, 44], yaw: 0, pitch: -0.42 };

export function createWorld(o: { name: string; id?: string; ground?: GroundSettings; spawn?: Spawn; ecosystem?: EcosystemState }): World {
  const now = nowIso();
  const spawn = o.spawn ?? (o.ecosystem ? WILD_SPAWN : DEFAULT_SPAWN);
  const w: World = {
    id: o.id ?? newId(),
    name: o.name,
    createdAt: now,
    updatedAt: now,
    ground: { ...(o.ground ?? DEFAULT_GROUND) },
    spawn: { ...spawn, position: [...spawn.position] as Vec3Tuple },
    placements: [],
  };
  if (o.ecosystem) w.ecosystem = { ...o.ecosystem };
  return w;
}

export function isWild(w: World): boolean {
  return !!w.ecosystem;
}

export function createPlacement(structureId: string, position: Vec3, rotation: Rotation, id = newId()): Placement {
  return { id, structureId, position: { ...position }, rotation };
}

/** World-space half-open box occupied by a placement of a structure with the given unrotated size. */
export function placementBounds(position: Vec3, size: Size3, rotation: Rotation): AABB {
  return aabbFromPosSize(position, rotatedSize(size, rotation));
}

/**
 * Voxel value of `structure` as placed by `placement` at world voxel (wx, wy, wz); 0 when air or outside.
 */
export function placementVoxelAt(structure: Structure, placement: Placement, wx: number, wy: number, wz: number): number {
  const size = structure.voxels.size;
  const rs = rotatedSize(size, placement.rotation);
  const lx = wx - placement.position.x;
  const ly = wy - placement.position.y;
  const lz = wz - placement.position.z;
  if (lx < 0 || ly < 0 || lz < 0 || lx >= rs.x || ly >= rs.y || lz >= rs.z) return 0;
  const [ux, uz] = unrotateLocal(lx, lz, size, placement.rotation);
  return structure.voxels.get(ux, ly, uz);
}

/** File path (inside a world bundle) where a structure is stored. */
export function structureFileName(structureId: string): string {
  return `structures/${structureId}.structure.json`;
}

export function touchWorld(w: World): World {
  return { ...w, updatedAt: nowIso() };
}

/** Ids of structures referenced by at least one placement, in first-use order. */
export function referencedStructureIds(world: World): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of world.placements) {
    if (seen.has(p.structureId)) continue;
    seen.add(p.structureId);
    out.push(p.structureId);
  }
  return out;
}
