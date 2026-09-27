import { z } from 'zod';
import { MAX_STRUCTURE_EDGE, type PaletteEntry, type Structure } from '../structure';
import { VoxelGrid } from '../voxel-grid';
import { FileFormatError, formatZodError, parseJsonText } from './errors';
import { decodeVoxelData, encodeVoxelData } from './rle';

export const STRUCTURE_FORMAT = 'buildergame.structure';
export const STRUCTURE_FORMAT_VERSION = 1;
export const STRUCTURE_FILE_EXTENSION = '.structure.json';

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const edge = z.number().int().min(1).max(MAX_STRUCTURE_EDGE * 8);

export const PaletteEntrySchema = z.object({
  material: z.string().min(1).max(64),
  color: z.string().regex(HEX, 'must be a hex colour like #a1b2c3'),
  transparent: z.boolean().optional(),
  emissive: z.boolean().optional(),
});

export const StructureFileSchema = z.object({
  format: z.literal(STRUCTURE_FORMAT),
  version: z.literal(STRUCTURE_FORMAT_VERSION),
  id: z.string().min(1).max(128),
  name: z.string().max(200),
  author: z.string().max(200).default(''),
  createdAt: z.string().max(64),
  updatedAt: z.string().max(64),
  size: z.object({ x: edge, y: edge, z: edge }),
  palette: z.array(PaletteEntrySchema).max(65535),
  voxels: z.object({
    encoding: z.literal('rle-u16-base64'),
    order: z.literal('xzy'),
    data: z.string(),
  }),
  thumbnail: z.string().max(2_000_000).optional(),
});

export type StructureFile = z.infer<typeof StructureFileSchema>;

export function encodeStructure(s: Structure): StructureFile {
  const file: StructureFile = {
    format: STRUCTURE_FORMAT,
    version: STRUCTURE_FORMAT_VERSION,
    id: s.id,
    name: s.name,
    author: s.author,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    size: { ...s.voxels.size },
    palette: s.palette.map(cleanPaletteEntry),
    voxels: { encoding: 'rle-u16-base64', order: 'xzy', data: encodeVoxelData(s.voxels.data) },
  };
  if (s.thumbnail) file.thumbnail = s.thumbnail;
  return file;
}

function cleanPaletteEntry(p: PaletteEntry): PaletteEntry {
  const e: PaletteEntry = { material: p.material, color: p.color };
  if (p.transparent) e.transparent = true;
  if (p.emissive) e.emissive = true;
  return e;
}

export function serializeStructure(s: Structure): string {
  return JSON.stringify(encodeStructure(s));
}

/** Validates an already-parsed JSON value and rebuilds the structure. Throws FileFormatError. */
export function decodeStructure(json: unknown): Structure {
  const parsed = StructureFileSchema.safeParse(json);
  if (!parsed.success) throw new FileFormatError(formatZodError('structure', parsed.error));
  const f = parsed.data;
  const length = f.size.x * f.size.y * f.size.z;
  let data: Uint16Array;
  try {
    data = decodeVoxelData(f.voxels.data, length);
  } catch (e) {
    throw new FileFormatError(`Invalid structure file: voxel data is corrupt (${(e as Error).message})`);
  }
  for (let i = 0; i < data.length; i++) {
    if (data[i] > f.palette.length) {
      throw new FileFormatError(`Invalid structure file: voxel ${i} refers to palette slot ${data[i]} of ${f.palette.length}`);
    }
  }
  const s: Structure = {
    id: f.id,
    name: f.name,
    author: f.author,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
    palette: f.palette.map(cleanPaletteEntry),
    voxels: new VoxelGrid(f.size, data),
  };
  if (f.thumbnail) s.thumbnail = f.thumbnail;
  return s;
}

export function parseStructure(text: string): Structure {
  return decodeStructure(parseJsonText(text, 'structure'));
}

/** Suggested download name for a structure. */
export function structureDownloadName(s: Structure): string {
  const base = s.name.trim().replace(/[^a-z0-9-_ ]/gi, '').replace(/\s+/g, '_').slice(0, 48) || 'structure';
  return `${base}${STRUCTURE_FILE_EXTENSION}`;
}
