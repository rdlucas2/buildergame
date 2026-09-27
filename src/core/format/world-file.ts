import { z } from 'zod';
import { vec3FromTuple, vec3ToTuple } from '../math';
import { isRotation } from '../rotation';
import { referencedStructureIds, structureFileName, type EcosystemState, type StructureRef, type World } from '../world';
import { FileFormatError, formatZodError, parseJsonText } from './errors';
import { decodeVoxelData, encodeVoxelData } from './rle';

export const WORLD_FORMAT = 'buildergame.world';
/** Newest version written. Version 1 files (no ecosystem) are still read, and plain worlds still write 1. */
export const WORLD_FORMAT_VERSION = 2;
/** Biomass is stored quantised to this many levels so that large even areas compress well. */
export const BIOMASS_LEVELS = 16;
const BIOMASS_STEP = 255 / (BIOMASS_LEVELS - 1);
export const WORLD_FILE_EXTENSION = '.world.json';
export const WORLD_BUNDLE_EXTENSION = '.world.zip';

const int = z.number().int();
const coord = int.min(-1_000_000).max(1_000_000);

export const WorldFileSchema = z.object({
  format: z.literal(WORLD_FORMAT),
  version: z.union([z.literal(1), z.literal(2)]),
  id: z.string().min(1).max(128),
  name: z.string().max(200),
  createdAt: z.string().max(64),
  updatedAt: z.string().max(64),
  ground: z.object({ material: z.string().min(1).max(64), size: int.min(16).max(65536) }),
  spawn: z.object({
    position: z.tuple([z.number(), z.number(), z.number()]),
    yaw: z.number(),
    pitch: z.number(),
  }),
  structures: z.array(z.object({ id: z.string().min(1).max(128), name: z.string().max(200), file: z.string().min(1).max(512) })),
  placements: z.array(
    z.object({
      id: z.string().min(1).max(128),
      structureId: z.string().min(1).max(128),
      position: z.tuple([coord, coord, coord]),
      rotation: int.refine(isRotation, 'rotation must be 0, 1, 2 or 3'),
    }),
  ),
  ecosystem: z
    .object({
      seed: int.min(0).max(0xffffffff),
      time: z.number().min(0).max(1e12),
      biomass: z
        .object({
          encoding: z.literal('rle-u16-base64'),
          levels: z.literal(BIOMASS_LEVELS),
          data: z.string(),
        })
        .optional(),
    })
    .optional(),
});

export type WorldFile = z.infer<typeof WorldFileSchema>;

/** `structureName` supplies display names for the structure reference list. */
export function encodeWorld(world: World, structureName: (id: string) => string | undefined): WorldFile {
  const file: WorldFile = {
    format: WORLD_FORMAT,
    version: world.ecosystem ? 2 : 1,
    id: world.id,
    name: world.name,
    createdAt: world.createdAt,
    updatedAt: world.updatedAt,
    ground: { ...world.ground },
    spawn: { position: [...world.spawn.position], yaw: world.spawn.yaw, pitch: world.spawn.pitch },
    structures: referencedStructureIds(world).map((id) => ({ id, name: structureName(id) ?? '', file: structureFileName(id) })),
    placements: world.placements.map((p) => ({
      id: p.id,
      structureId: p.structureId,
      position: vec3ToTuple(p.position),
      rotation: p.rotation,
    })),
  };
  if (world.ecosystem) file.ecosystem = encodeEcosystem(world.ecosystem);
  return file;
}

function encodeEcosystem(e: EcosystemState): NonNullable<WorldFile['ecosystem']> {
  const out: NonNullable<WorldFile['ecosystem']> = { seed: e.seed >>> 0, time: e.time };
  if (e.biomass) {
    const q = new Uint16Array(e.biomass.length);
    for (let i = 0; i < q.length; i++) q[i] = Math.round(e.biomass[i] / BIOMASS_STEP);
    out.biomass = { encoding: 'rle-u16-base64', levels: BIOMASS_LEVELS, data: encodeVoxelData(q) };
  }
  return out;
}

function decodeEcosystem(e: NonNullable<WorldFile['ecosystem']>, groundSize: number): EcosystemState {
  const out: EcosystemState = { seed: e.seed, time: e.time };
  if (e.biomass) {
    let q: Uint16Array;
    try {
      q = decodeVoxelData(e.biomass.data, groundSize * groundSize);
    } catch (err) {
      throw new FileFormatError(`Invalid world file: ecosystem biomass is corrupt (${(err as Error).message})`);
    }
    const b = new Uint8Array(q.length);
    for (let i = 0; i < q.length; i++) {
      if (q[i] >= BIOMASS_LEVELS) throw new FileFormatError('Invalid world file: ecosystem biomass level out of range');
      b[i] = Math.round(q[i] * BIOMASS_STEP);
    }
    out.biomass = b;
  }
  return out;
}

export function serializeWorld(world: World, structureName: (id: string) => string | undefined): string {
  return JSON.stringify(encodeWorld(world, structureName), null, 2);
}

export interface DecodedWorld {
  world: World;
  structureRefs: StructureRef[];
}

export function decodeWorld(json: unknown): DecodedWorld {
  const parsed = WorldFileSchema.safeParse(json);
  if (!parsed.success) throw new FileFormatError(formatZodError('world', parsed.error));
  const f = parsed.data;
  const refIds = new Set(f.structures.map((s) => s.id));
  const placementIds = new Set<string>();
  for (const p of f.placements) {
    if (!refIds.has(p.structureId)) {
      throw new FileFormatError(`Invalid world file: placement ${p.id} refers to unlisted structure ${p.structureId}`);
    }
    if (placementIds.has(p.id)) throw new FileFormatError(`Invalid world file: duplicate placement id ${p.id}`);
    placementIds.add(p.id);
  }
  const world: World = {
    id: f.id,
    name: f.name,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
    ground: { ...f.ground },
    spawn: { position: [...f.spawn.position], yaw: f.spawn.yaw, pitch: f.spawn.pitch },
    placements: f.placements.map((p) => ({
      id: p.id,
      structureId: p.structureId,
      position: vec3FromTuple(p.position),
      rotation: p.rotation,
    })),
  };
  if (f.ecosystem) world.ecosystem = decodeEcosystem(f.ecosystem, f.ground.size);
  return { world, structureRefs: f.structures.map((s) => ({ ...s })) };
}

export function parseWorld(text: string): DecodedWorld {
  return decodeWorld(parseJsonText(text, 'world'));
}

export function worldDownloadName(world: World, ext = WORLD_BUNDLE_EXTENSION): string {
  const base = world.name.trim().replace(/[^a-z0-9-_ ]/gi, '').replace(/\s+/g, '_').slice(0, 48) || 'world';
  return `${base}${ext}`;
}
