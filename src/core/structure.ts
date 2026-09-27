import { newId, nowIso } from './ids';
import { getMaterial, isValidHexColor, type MaterialDef } from './materials';
import type { Size3 } from './voxel-grid';
import { VoxelGrid } from './voxel-grid';

/**
 * One entry of a structure's local palette. Voxel value `v` (1-based) refers to `palette[v - 1]`.
 * The colour is stored alongside the material id so a file still renders on a machine whose
 * material registry does not know that material.
 */
export interface PaletteEntry {
  material: string;
  color: string;
  transparent?: boolean;
  emissive?: boolean;
}

/** A finite voxel creation. `voxels.size` is its length (x) × height (y) × depth (z). */
export interface Structure {
  id: string;
  name: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  palette: PaletteEntry[];
  voxels: VoxelGrid;
  /** Optional data-URL PNG preview for galleries. */
  thumbnail?: string;
}

export const MAX_STRUCTURE_EDGE = 128;

export function structureSize(s: Structure): Size3 {
  return s.voxels.size;
}

export function structureBlockCount(s: Structure): number {
  return s.voxels.count();
}

export function paletteEntryFromMaterial(m: MaterialDef): PaletteEntry {
  const e: PaletteEntry = { material: m.id, color: m.color };
  if (m.transparent) e.transparent = true;
  if (m.emissive) e.emissive = true;
  return e;
}

export function paletteEntryForMaterialId(id: string): PaletteEntry {
  const m = getMaterial(id);
  if (m) return paletteEntryFromMaterial(m);
  return { material: id, color: '#ff00ff' };
}

/**
 * Returns the 1-based slot for `materialId` in `palette`, appending a new entry when needed.
 * Mutates `palette`.
 */
export function paletteSlotFor(palette: PaletteEntry[], materialId: string): number {
  const i = palette.findIndex((p) => p.material === materialId);
  if (i >= 0) return i + 1;
  palette.push(paletteEntryForMaterialId(materialId));
  return palette.length;
}

export function paletteEntriesEqual(a: PaletteEntry, b: PaletteEntry): boolean {
  return (
    a.material === b.material &&
    a.color.toLowerCase() === b.color.toLowerCase() &&
    !!a.transparent === !!b.transparent &&
    !!a.emissive === !!b.emissive
  );
}

export interface CreateStructureOptions {
  name: string;
  author?: string;
  voxels: VoxelGrid;
  palette: PaletteEntry[];
  id?: string;
  createdAt?: string;
  updatedAt?: string;
  thumbnail?: string;
}

export function createStructure(o: CreateStructureOptions): Structure {
  const now = nowIso();
  const s: Structure = {
    id: o.id ?? newId(),
    name: o.name,
    author: o.author ?? '',
    createdAt: o.createdAt ?? now,
    updatedAt: o.updatedAt ?? now,
    palette: o.palette.map((p) => ({ ...p })),
    voxels: o.voxels,
  };
  if (o.thumbnail) s.thumbnail = o.thumbnail;
  return s;
}

export class EmptyStructureError extends Error {
  constructor() {
    super('A structure must contain at least one block');
    this.name = 'EmptyStructureError';
  }
}

/**
 * Produces the canonical form used for saving: voxels cropped to their tight bounds (so size is the
 * real length × height × depth) and the palette compacted to the entries actually used, in first-use
 * order. Throws when the structure has no blocks.
 */
export function normalizeStructure(s: Structure): Structure {
  const bounds = s.voxels.tightBounds();
  if (!bounds) throw new EmptyStructureError();
  const cropped = s.voxels.crop(bounds);

  const remap = new Map<number, number>();
  const palette: PaletteEntry[] = [];
  cropped.forEachSolid((_x, _y, _z, v) => {
    if (remap.has(v)) return;
    const entry = s.palette[v - 1] ?? { material: 'unknown', color: '#ff00ff' };
    palette.push({ ...entry });
    remap.set(v, palette.length);
  });
  cropped.remap(remap);

  const out: Structure = { ...s, palette, voxels: cropped };
  return out;
}

export function validatePaletteEntry(e: PaletteEntry): string | null {
  if (!e.material || e.material.length > 64) return 'palette material id must be 1-64 characters';
  if (!isValidHexColor(e.color)) return `palette colour "${e.color}" is not a hex colour`;
  return null;
}

/** True when both structures would look identical when placed (metadata ignored). */
export function structureContentEquals(a: Structure, b: Structure): boolean {
  if (a.palette.length !== b.palette.length) return false;
  for (let i = 0; i < a.palette.length; i++) if (!paletteEntriesEqual(a.palette[i], b.palette[i])) return false;
  return VoxelGrid.equals(a.voxels, b.voxels);
}

export function touchStructure(s: Structure): Structure {
  return { ...s, updatedAt: nowIso() };
}
