import { beforeEach, describe, expect, it } from 'vitest';
import { resolveBundleConflicts } from '../../src/core/format/bundle';
import { encodeStructure, serializeStructure } from '../../src/core/format/structure-file';
import { structureContentEquals } from '../../src/core/structure';
import { createPlacement, createWorld } from '../../src/core/world';
import { buildExampleStructures } from '../../src/examples';
import { StructureLibrary } from '../../src/storage/library';
import { cube } from './helpers';

// Node has no IndexedDB, so the library runs on its in-memory store here.
describe('StructureLibrary with built-in examples', () => {
  const examples = buildExampleStructures();
  const eiffel = examples.find((e) => e.id === 'example-eiffel-tower')!;
  let lib: StructureLibrary;

  beforeEach(async () => {
    lib = new StructureLibrary(examples);
    await lib.open();
  });

  it("serves examples through get() without counting them as the player's own", async () => {
    expect(lib.get(eiffel.id)).toBe(eiffel);
    expect(lib.has(eiffel.id)).toBe(true);
    expect(lib.isExample(eiffel.id)).toBe(true);
    expect(lib.examples().map((e) => e.id)).toEqual(examples.map((e) => e.id));
    expect(lib.all()).toEqual([]);
    expect(lib.size).toBe(0);
    await lib.save(cube('mine', 2, 'mine'));
    expect(lib.all().map((s) => s.id)).toEqual(['mine']);
    expect(lib.isExample('mine')).toBe(false);
  });

  it('never lets an example be overwritten or deleted', async () => {
    await expect(lib.save({ ...eiffel, name: 'Hacked' })).rejects.toThrow(/built-in example/);
    await expect(lib.saveMany([cube('ok', 1, 'ok'), { ...eiffel }])).rejects.toThrow(/built-in example/);
    expect(lib.get('ok')).toBeUndefined(); // saveMany is all-or-nothing
    expect(await lib.remove(eiffel.id)).toBe(false);
    expect(lib.get(eiffel.id)?.name).toBe('Eiffel Tower');
  });

  it('importing an example file reuses it; a modified copy with the same id gets a new id', async () => {
    const same = await lib.importText(serializeStructure(eiffel));
    expect(same.outcome).toBe('reused');
    expect(same.structure).toBe(eiffel);

    const file = encodeStructure(eiffel);
    const modified = JSON.stringify({ ...file, palette: [...file.palette].reverse() });
    const r = await lib.importText(modified);
    expect(r.outcome).toBe('renamed');
    expect(r.structure.id).not.toBe(eiffel.id);
    expect(lib.all()).toHaveLength(1);
    expect(structureContentEquals(lib.get(eiffel.id)!, eiffel)).toBe(true);
  });

  it('world bundles that carry an example resolve to the built-in copy', () => {
    const w = createWorld({ name: 'Paris' });
    w.placements.push(createPlacement(eiffel.id, { x: 0, y: 0, z: 0 }, 0, 'p1'));
    const r = resolveBundleConflicts({ world: w, structures: [eiffel] }, (id) => lib.get(id), () => false);
    expect(r.reused).toEqual([eiffel.id]);
    expect(r.bundle.structures).toEqual([]);
    expect(r.bundle.world.placements[0].structureId).toBe(eiffel.id);
  });
});
