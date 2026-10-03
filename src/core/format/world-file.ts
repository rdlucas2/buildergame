import { z } from 'zod';
import { vec3FromTuple, vec3ToTuple } from '../math';
import { isRotation } from '../rotation';
import type { DefenseState } from '../defense-state';
import { CREATURE_KINDS, referencedStructureIds, structureFileName, type CreatureKind, type EcosystemState, type StructureRef, type World } from '../world';
import { FileFormatError, formatZodError, parseJsonText } from './errors';
import { decodeVoxelData, encodeVoxelData } from './rle';

export const WORLD_FORMAT = 'buildergame.world';
/**
 * Newest version written. Plain worlds still write 1, wild worlds 2 and Warren Defense worlds 3;
 * every older version is still read.
 */
export const WORLD_FORMAT_VERSION = 3;
/** Biomass is stored quantised to this many levels so that large even areas compress well. */
export const BIOMASS_LEVELS = 16;
const BIOMASS_STEP = 255 / (BIOMASS_LEVELS - 1);
/**
 * Largest ground a wild world may have. Its simulation keeps several grids with one entry per ground
 * cell, and position keys assume coordinates within ±2048.
 */
export const MAX_WILD_GROUND = 2048;
export const WORLD_FILE_EXTENSION = '.world.json';
export const WORLD_BUNDLE_EXTENSION = '.world.zip';

const int = z.number().int();
const coord = int.min(-1_000_000).max(1_000_000);
const unit = z.number().min(0).max(1);
/** More creatures than any population cap allows, so a file can't make the game do unbounded work. */
export const MAX_CREATURES = 5000;

const KindSchema = z.enum(CREATURE_KINDS as unknown as [CreatureKind, ...CreatureKind[]]);

const CreatureSchema = z.object({
  id: int.min(1),
  species: z.enum(['prey', 'predator']),
  x: z.number().min(-1_000_000).max(1_000_000),
  y: int.min(0).max(1_000_000),
  z: z.number().min(-1_000_000).max(1_000_000),
  heading: z.number().min(-100).max(100),
  satiety: unit,
  hydration: unit,
  energy: unit,
  health: unit,
  age: z.number().min(0).max(1e12),
  cooldown: z.number().min(0).max(1e12),
  kind: KindSchema.optional(),
  role: z.enum(['breeder', 'defender']).optional(),
  maxHp: z.number().min(0).max(1e9).optional(),
  rank: z.enum(['elite', 'boss']).optional(),
});

const rle = z.object({ encoding: z.literal('rle-u16-base64'), data: z.string() });
const count = int.min(0).max(1e12);

const PerkSchema = z.object({
  kind: z.enum(['damage', 'rate', 'range', 'crit', 'pierce', 'splash', 'multishot', 'regen', 'armour', 'fertility', 'budget', 'bounty']),
  target: z.string().max(64),
  amount: z.number().min(-1e6).max(1e6),
  rarity: z.enum(['common', 'uncommon', 'rare', 'epic', 'legendary']),
});

const DefenseSchema = z.object({
  site: z.object({ x: coord, z: coord }),
  base: z.object({
    origin: z.object({ x: coord, z: coord }),
    size: z.object({ x: int.min(1).max(256), y: int.min(1).max(256), z: int.min(1).max(256) }),
    palette: z.array(z.string().min(1).max(64)).max(1024),
    voxels: rle,
    damage: rle,
  }),
  clock: z.number().min(0).max(1e9),
  wave: int.min(0).max(1_000_000),
  nextWaveAt: z.number().min(0).max(1e9),
  orders: z
    .array(
      z.object({
        at: z.number().min(0).max(1e9),
        kind: KindSchema,
        count: int.min(0).max(1000),
        angle: z.number().min(-1000).max(1000),
        hpScale: z.number().min(0).max(1e6),
        rank: z.enum(['elite', 'boss']).optional(),
      }),
    )
    .max(5000),
  points: z.number().min(0).max(1e12),
  score: z.number().min(0).max(1e12),
  budget: count,
  budgetBuys: count,
  allocation: int.min(0).max(100_000),
  stats: z.object({
    kills: count,
    killsWith: z.record(z.string().max(64), count),
    killsOf: z.record(z.string().max(64), count),
    rabbitsLost: count,
    blocksBroken: count,
    shots: count,
    firstLoss: z.number().min(-1).max(1e9).default(-1),
  }),
  outcome: z.enum(['playing', 'lost']),
  modifiers: z.object({
    budget: z.number().min(0).max(1e9),
    rabbits: int.min(0).max(10_000),
    blockHp: z.number().min(0).max(1000),
    damage: z.number().min(0).max(1000),
    armour: z.number().min(0).max(1000),
    fertility: z.number().min(0).max(1000),
    startWeapon: int.min(0).max(64).default(0),
    rerolls: int.min(0).max(1000).default(0),
    cards: int.min(1).max(8).default(3),
  }),
  // In-round progression (added after the first version-3 files, so every field has a default).
  unlocked: z.array(z.string().min(1).max(64)).max(64).default(['slingshot']),
  mainWeapon: z.string().min(1).max(64).default('slingshot'),
  loadout: z.record(z.string().max(64), int.min(0).max(100_000)).default({}),
  tiers: int.min(0).max(16).default(3),
  strength: z.array(int.min(0).max(100)).max(16).default([]),
  perks: z.array(PerkSchema).max(10_000).default([]),
  offers: z.array(z.array(PerkSchema).max(16)).max(1000).default([]),
  offersMade: count.default(0),
  milestones: count.default(0),
  rerolls: count.default(0),
  rewarded: z.boolean().default(false),
  bosses: count.default(0),
});

export const WorldFileSchema = z.object({
  format: z.literal(WORLD_FORMAT),
  version: z.union([z.literal(1), z.literal(2), z.literal(3)]),
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
      creatures: z.array(CreatureSchema).max(MAX_CREATURES).optional(),
      nextCreatureId: int.min(1).optional(),
      rng: int.min(0).max(0xffffffff).optional(),
      history: z.array(z.tuple([z.number().min(0), int.min(0), int.min(0)])).max(5000).optional(),
      tally: z.record(z.string().max(32), int.min(0)).optional(),
      packTimer: z.number().min(0).max(1e9).optional(),
      defense: DefenseSchema.optional(),
    })
    .optional(),
});

export type WorldFile = z.infer<typeof WorldFileSchema>;

/** `structureName` supplies display names for the structure reference list. */
export function encodeWorld(world: World, structureName: (id: string) => string | undefined): WorldFile {
  const file: WorldFile = {
    format: WORLD_FORMAT,
    version: world.ecosystem?.defense ? 3 : world.ecosystem ? 2 : 1,
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
  if (e.creatures) out.creatures = e.creatures.map((c) => ({ ...c }));
  if (e.nextCreatureId !== undefined) out.nextCreatureId = e.nextCreatureId;
  if (e.rng !== undefined) out.rng = e.rng >>> 0;
  if (e.history) out.history = e.history.map(([t, a, b]) => [t, a, b]);
  if (e.tally) out.tally = { ...e.tally };
  if (e.packTimer !== undefined) out.packTimer = Math.max(0, e.packTimer);
  if (e.defense) out.defense = encodeDefense(e.defense);
  if (e.biomass) {
    const q = new Uint16Array(e.biomass.length);
    for (let i = 0; i < q.length; i++) q[i] = Math.round(e.biomass[i] / BIOMASS_STEP);
    out.biomass = { encoding: 'rle-u16-base64', levels: BIOMASS_LEVELS, data: encodeVoxelData(q) };
  }
  return out;
}

function decodeEcosystem(e: NonNullable<WorldFile['ecosystem']>, groundSize: number): EcosystemState {
  const out: EcosystemState = { seed: e.seed, time: e.time };
  if (e.creatures) {
    const ids = new Set<number>();
    for (const c of e.creatures) {
      if (ids.has(c.id)) throw new FileFormatError(`Invalid world file: duplicate creature id ${c.id}`);
      ids.add(c.id);
    }
    out.creatures = e.creatures.map((c) => ({ ...c }));
  }
  if (e.nextCreatureId !== undefined) out.nextCreatureId = e.nextCreatureId;
  if (e.rng !== undefined) out.rng = e.rng;
  if (e.history) out.history = e.history.map(([t, a, b]) => [t, a, b]);
  if (e.tally) out.tally = { ...e.tally };
  if (e.packTimer !== undefined) out.packTimer = e.packTimer;
  if (e.defense) out.defense = decodeDefense(e.defense);
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

type DefenseFile = NonNullable<NonNullable<WorldFile['ecosystem']>['defense']>;

function encodeDefense(d: DefenseState): DefenseFile {
  return {
    site: { ...d.site },
    base: {
      origin: { ...d.base.origin },
      size: { ...d.base.size },
      palette: [...d.base.palette],
      voxels: { encoding: 'rle-u16-base64', data: encodeVoxelData(d.base.voxels) },
      damage: { encoding: 'rle-u16-base64', data: encodeVoxelData(d.base.damage) },
    },
    clock: d.clock,
    wave: d.wave,
    nextWaveAt: d.nextWaveAt,
    orders: d.orders.map((o) => ({ ...o })),
    points: d.points,
    score: d.score,
    budget: d.budget,
    budgetBuys: d.budgetBuys,
    allocation: d.allocation,
    stats: structuredClone(d.stats),
    outcome: d.outcome,
    modifiers: { ...d.modifiers },
    unlocked: [...d.unlocked],
    mainWeapon: d.mainWeapon,
    loadout: { ...d.loadout },
    tiers: d.tiers,
    strength: [...d.strength],
    perks: d.perks.map((p) => ({ ...p })),
    offers: d.offers.map((o) => o.map((p) => ({ ...p }))),
    offersMade: d.offersMade,
    milestones: d.milestones,
    rerolls: d.rerolls,
    rewarded: d.rewarded,
    bosses: d.bosses,
  };
}

function decodeDefense(f: DefenseFile): DefenseState {
  const { size } = f.base;
  const n = size.x * size.y * size.z;
  let voxels: Uint16Array;
  let damage: Uint16Array;
  try {
    voxels = decodeVoxelData(f.base.voxels.data, n);
    damage = decodeVoxelData(f.base.damage.data, n);
  } catch (err) {
    throw new FileFormatError(`Invalid world file: the warren's blocks are corrupt (${(err as Error).message})`);
  }
  for (let i = 0; i < n; i++) {
    if (voxels[i] > f.base.palette.length) throw new FileFormatError('Invalid world file: a warren block refers to a missing material');
  }
  return {
    site: { ...f.site },
    base: { origin: { ...f.base.origin }, size: { ...size }, palette: [...f.base.palette], voxels, damage },
    clock: f.clock,
    wave: f.wave,
    nextWaveAt: f.nextWaveAt,
    orders: f.orders.map((o) => ({ ...o })),
    points: f.points,
    score: f.score,
    budget: f.budget,
    budgetBuys: f.budgetBuys,
    allocation: f.allocation,
    stats: structuredClone(f.stats),
    outcome: f.outcome,
    modifiers: { ...f.modifiers },
    unlocked: [...f.unlocked],
    mainWeapon: f.mainWeapon,
    loadout: { ...f.loadout },
    tiers: f.tiers,
    strength: [...f.strength],
    perks: f.perks.map((p) => ({ ...p })),
    offers: f.offers.map((o) => o.map((p) => ({ ...p }))),
    offersMade: f.offersMade,
    milestones: f.milestones,
    rerolls: f.rerolls,
    rewarded: f.rewarded,
    bosses: f.bosses,
  };
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
  if (f.ecosystem) {
    if (f.ground.size > MAX_WILD_GROUND) throw new FileFormatError(`Invalid world file: a wild world's ground can be at most ${MAX_WILD_GROUND} cells across`);
    world.ecosystem = decodeEcosystem(f.ecosystem, f.ground.size);
  }
  return { world, structureRefs: f.structures.map((s) => ({ ...s })) };
}

export function parseWorld(text: string): DecodedWorld {
  return decodeWorld(parseJsonText(text, 'world'));
}

export function worldDownloadName(world: World, ext = WORLD_BUNDLE_EXTENSION): string {
  const base = world.name.trim().replace(/[^a-z0-9-_ ]/gi, '').replace(/\s+/g, '_').slice(0, 48) || 'world';
  return `${base}${ext}`;
}
