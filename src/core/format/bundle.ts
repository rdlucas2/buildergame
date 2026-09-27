import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { newId } from '../ids';
import { structureContentEquals, type Structure } from '../structure';
import { structureFileName, type World } from '../world';
import { FileFormatError } from './errors';
import { parseStructure, serializeStructure } from './structure-file';
import { parseWorld, serializeWorld } from './world-file';

export const WORLD_BUNDLE_WORLD_FILE = 'world.json';

/** A world together with every structure it references: everything needed to recreate it elsewhere. */
export interface WorldBundle {
  world: World;
  structures: Structure[];
}

export function encodeWorldBundle(bundle: WorldBundle): Uint8Array {
  const byId = new Map(bundle.structures.map((s) => [s.id, s]));
  const files: Record<string, Uint8Array> = {};
  files[WORLD_BUNDLE_WORLD_FILE] = strToU8(serializeWorld(bundle.world, (id) => byId.get(id)?.name));
  for (const s of bundle.structures) files[structureFileName(s.id)] = strToU8(serializeStructure(s));
  return zipSync(files, { level: 6 });
}

export function decodeWorldBundle(bytes: Uint8Array): WorldBundle {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch (e) {
    throw new FileFormatError(`Invalid world bundle: not a zip archive (${(e as Error).message})`);
  }
  const worldBytes = files[WORLD_BUNDLE_WORLD_FILE];
  if (!worldBytes) throw new FileFormatError(`Invalid world bundle: missing ${WORLD_BUNDLE_WORLD_FILE}`);
  const { world, structureRefs } = parseWorld(strFromU8(worldBytes));
  const structures: Structure[] = [];
  for (const ref of structureRefs) {
    const data = files[ref.file];
    if (!data) throw new FileFormatError(`Invalid world bundle: missing structure file ${ref.file}`);
    const s = parseStructure(strFromU8(data));
    if (s.id !== ref.id) {
      throw new FileFormatError(`Invalid world bundle: ${ref.file} contains structure ${s.id}, expected ${ref.id}`);
    }
    structures.push(s);
  }
  return { world, structures };
}

export interface ConflictResolution {
  bundle: WorldBundle;
  /** Structures whose ids were changed because a different structure already used the id. */
  renamed: Array<{ from: string; to: string }>;
  /** Structures skipped because an identical one already exists under the same id. */
  reused: string[];
}

/**
 * Makes an imported bundle safe to merge into an existing library: structures identical to existing
 * ones are reused, structures that clash with a *different* existing structure get fresh ids (and the
 * world's placements are remapped). The world itself gets a fresh id when `worldExists` says so.
 */
export function resolveBundleConflicts(
  bundle: WorldBundle,
  existing: (id: string) => Structure | undefined,
  worldExists: (id: string) => boolean,
): ConflictResolution {
  const idMap = new Map<string, string>();
  const renamed: Array<{ from: string; to: string }> = [];
  const reused: string[] = [];
  const structures: Structure[] = [];
  for (const s of bundle.structures) {
    const cur = existing(s.id);
    if (!cur) {
      structures.push(s);
    } else if (structureContentEquals(cur, s)) {
      reused.push(s.id);
    } else {
      const to = newId();
      idMap.set(s.id, to);
      renamed.push({ from: s.id, to });
      structures.push({ ...s, id: to });
    }
  }
  const world: World = {
    ...bundle.world,
    id: worldExists(bundle.world.id) ? newId() : bundle.world.id,
    placements: bundle.world.placements.map((p) => ({
      ...p,
      id: newId(),
      structureId: idMap.get(p.structureId) ?? p.structureId,
    })),
  };
  return { bundle: { world, structures }, renamed, reused };
}
